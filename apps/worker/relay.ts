import { setTimeout as sleep } from 'node:timers/promises';
import type { ChannelModel } from 'amqplib';
import { connectPostgres } from '../../packages/server/database.js';
import { loadEnvironment, log, readConfig } from '../../packages/server/config.js';
import { dispatchOutbox } from '../../packages/server/dispatch.js';
import { recoverExpired } from '../../packages/server/repository.js';
import { connectBroker, declareTopology, RabbitPublisher } from '../../packages/server/rabbit.js';

loadEnvironment();
const config = readConfig();
const db = connectPostgres(config.DATABASE_URL);
const controller = new AbortController();
let connection: ChannelModel | undefined;
let publisher: RabbitPublisher | undefined;
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.once(signal, () => {
    controller.abort();
    void connection?.close().catch(() => undefined);
  });
try {
  while (!controller.signal.aborted) {
    try {
      await recoverExpired(db, config.MAX_CRASH_RECOVERIES);
      if (!publisher) {
        connection = await connectBroker(config);
        connection.on('close', () => {
          publisher = undefined;
        });
        const channel = await connection.createConfirmChannel();
        channel.on('error', () => log('relay_channel_error'));
        channel.on('close', () => {
          publisher = undefined;
        });
        await declareTopology(channel, config.QUEUE_PREFIX);
        publisher = new RabbitPublisher(channel, config.QUEUE_PREFIX);
        log('relay_ready');
      }
      await dispatchOutbox(db, publisher);
    } catch {
      log('relay_retrying');
      publisher = undefined;
      await connection?.close().catch(() => undefined);
      connection = undefined;
    }
    await sleep(publisher ? 250 : 1500, undefined, { signal: controller.signal }).catch(() => undefined);
  }
} finally {
  await connection?.close().catch(() => undefined);
  await db.close();
}
