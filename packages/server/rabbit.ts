import amqp, { type ChannelModel, type ConfirmChannel } from 'amqplib';
import { setTimeout as sleep } from 'node:timers/promises';
import { messageSchema } from '../shared/contracts.js';
import type { Database } from './database.js';
import type { Publisher } from './dispatch.js';
import type { AiProvider } from './providers.js';
import { processMessage } from './processor.js';
import { log, type Config } from './config.js';

export function queueNames(prefix: string) {
  return {
    jobs: `${prefix}.study.v2.jobs`,
    dead: `${prefix}.study.v2.dead`,
    deadExchange: `${prefix}.study.v2.dead.exchange`,
  };
}
export async function connectBroker(config: Config): Promise<ChannelModel> {
  const url = new URL(config.RABBITMQ_URL);
  url.searchParams.set('heartbeat', '10');
  const connection = await amqp.connect(url.toString(), { timeout: 5000 });
  connection.on('error', () => log('broker_connection_error'));
  return connection;
}
export async function declareTopology(channel: amqp.Channel, prefix: string) {
  const names = queueNames(prefix);
  await channel.assertExchange(names.deadExchange, 'direct', { durable: true });
  await channel.assertQueue(names.dead, { durable: true });
  await channel.bindQueue(names.dead, names.deadExchange, 'dead');
  await channel.assertQueue(names.jobs, {
    durable: true,
    arguments: {
      'x-dead-letter-exchange': names.deadExchange,
      'x-dead-letter-routing-key': 'dead',
    },
  });
}

export class RabbitPublisher implements Publisher {
  private returned = new Set<string>();
  constructor(
    private channel: ConfirmChannel,
    private prefix: string,
  ) {
    channel.on('error', () => log('publisher_channel_error'));
    channel.on('return', (message) => {
      if (message.properties.messageId) this.returned.add(message.properties.messageId);
    });
  }
  async publish(kind: 'process' | 'dead', payload: unknown, id: string): Promise<void> {
    const queue = kind === 'process' ? queueNames(this.prefix).jobs : queueNames(this.prefix).dead;
    await new Promise<void>((resolve, reject) => {
      let finished = false;
      const finish = (error?: Error | null) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        this.channel.off('close', closed);
        const unrouted = this.returned.delete(id);
        if (error || unrouted) reject(error ?? new Error('unroutable_publication'));
        else resolve();
      };
      const closed = () => finish(new Error('publisher_closed'));
      const timer = setTimeout(() => {
        finish(new Error('publish_confirm_timeout'));
        void this.channel.close().catch(() => undefined);
      }, 8000);
      this.channel.once('close', closed);
      try {
        this.channel.sendToQueue(
          queue,
          Buffer.from(JSON.stringify(payload)),
          { persistent: true, mandatory: true, contentType: 'application/json', messageId: id },
          finish,
        );
      } catch (error) {
        finish(error as Error);
      }
    });
  }
}

export async function runConsumer(
  config: Config,
  db: Database,
  provider: AiProvider,
  workerId: string,
  shutdown: AbortSignal,
) {
  while (!shutdown.aborted) {
    let connection: ChannelModel | undefined;
    const inFlight = new Set<Promise<void>>();
    const session = new AbortController();
    const signal = AbortSignal.any([shutdown, session.signal]);
    const stop = () => {
      session.abort();
      void connection?.close().catch(() => undefined);
    };
    shutdown.addEventListener('abort', stop, { once: true });
    try {
      connection = await connectBroker(config);
      const closed = new Promise<void>((resolve) =>
        connection!.once('close', () => {
          session.abort();
          resolve();
        }),
      );
      const channel = await connection.createChannel();
      channel.on('error', () => log('consumer_channel_error'));
      channel.on('close', stop);
      await declareTopology(channel, config.QUEUE_PREFIX);
      await channel.prefetch(1);
      if (shutdown.aborted) {
        stop();
        await closed;
        continue;
      }
      await channel.consume(
        queueNames(config.QUEUE_PREFIX).jobs,
        (message) => {
          if (!message) {
            stop();
            return;
          }
          const task = (async () => {
            let body: unknown;
            try {
              body = JSON.parse(message.content.toString('utf8'));
            } catch {
              channel.reject(message, false);
              return;
            }
            const parsed = messageSchema.safeParse(body);
            if (!parsed.success) {
              channel.reject(message, false);
              return;
            }
            await processMessage(db, provider, parsed.data, workerId, config, signal);
            if (!signal.aborted) channel.ack(message);
          })().catch(() => {
            log('consumer_session_recovering', { workerId });
            stop();
          });
          inFlight.add(task);
          void task.finally(() => inFlight.delete(task));
        },
        { noAck: false },
      );
      log('worker_ready', { workerId, provider: config.AI_PROVIDER });
      await closed;
    } catch {
      if (!shutdown.aborted) log('worker_reconnecting', { workerId });
    } finally {
      shutdown.removeEventListener('abort', stop);
      session.abort();
      await connection?.close().catch(() => undefined);
      await Promise.allSettled(inFlight);
    }
    if (!shutdown.aborted) await sleep(1000, undefined, { signal: shutdown }).catch(() => undefined);
  }
}
