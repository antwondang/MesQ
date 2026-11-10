import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { connectPostgres, migrate, type Database } from '../packages/server/database.js';
import { loadEnvironment, readConfig } from '../packages/server/config.js';
import { createGuide, getGuide, recoverExpired } from '../packages/server/repository.js';
import { dispatchOutbox } from '../packages/server/dispatch.js';
import { connectBroker, declareTopology, queueNames, RabbitPublisher } from '../packages/server/rabbit.js';
import type { ChannelModel } from 'amqplib';
import type { GuideInput } from '../packages/shared/contracts.js';

// Runs ONLY with real PostgreSQL and RabbitMQ. Uses a private schema and queue
// prefix; it never truncates application tables or deletes application queues.
loadEnvironment();
const suffix = randomUUID().replaceAll('-', '');
const schema = `it_${suffix}`;
const url = new URL(
  process.env.DATABASE_URL ?? 'postgres://triageflow:triageflow_dev@localhost:5432/triageflow',
);
const admin = connectPostgres(url.toString());
url.searchParams.set('options', `-c search_path=${schema}`);
const config = readConfig({
  ...process.env,
  DATABASE_URL: url.toString(),
  QUEUE_PREFIX: `triageflow.it.${suffix}`,
  AI_PROVIDER: 'mock',
  GEMINI_API_KEY: '',
  AI_TIMEOUT_MS: '1000',
  LEASE_MS: '6500',
  RETRY_BASE_MS: '30',
  MOCK_DELAY_MS: '500',
  MAX_ATTEMPTS: '3',
  MAX_CRASH_RECOVERIES: '3',
});
let db: Database | undefined;
let connection: ChannelModel | undefined;
let worker: ChildProcess | undefined;
let schemaCreated = false;
const input: GuideInput = {
  title: 'Integration MIPS notes',
  body: 'MIPS arithmetic operates on registers; loads and stores access memory.',
  demoScenario: 'normal',
  mode: 'notes',
  subject: 'computer-science',
};
function startWorker(delay = '500') {
  const child = spawn(process.execPath, ['--import', 'tsx', 'apps/worker/index.ts'], {
    stdio: 'ignore',
    env: {
      ...process.env,
      DATABASE_URL: config.DATABASE_URL,
      RABBITMQ_URL: config.RABBITMQ_URL,
      QUEUE_PREFIX: config.QUEUE_PREFIX,
      AI_PROVIDER: 'mock',
      GEMINI_API_KEY: '',
      AI_TIMEOUT_MS: '1000',
      LEASE_MS: '6500',
      RETRY_BASE_MS: '30',
      MOCK_DELAY_MS: delay,
      MAX_ATTEMPTS: '3',
      MAX_CRASH_RECOVERIES: '3',
    },
  });
  return child;
}
async function stopWorker() {
  if (!worker || worker.exitCode !== null || worker.signalCode !== null) return;
  const child = worker;
  const stopped = new Promise<void>((resolve) => child.once('exit', () => resolve()));
  child.kill('SIGKILL');
  await stopped;
}
try {
  await admin.query('SELECT 1');
  connection = await connectBroker(config);
  await admin.exec(`CREATE SCHEMA "${schema}"`);
  schemaCreated = true;
  db = connectPostgres(config.DATABASE_URL);
  await migrate(db);
  let channel = await connection.createConfirmChannel();
  channel.on('error', () => undefined);
  await declareTopology(channel, config.QUEUE_PREFIX);
  let publisher = new RabbitPublisher(channel, config.QUEUE_PREFIX);
  const pump = async () => {
    await recoverExpired(db!, 3);
    await dispatchOutbox(db!, publisher);
  };
  async function waitUntil(check: () => Promise<boolean>, timeout = 20000) {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      await pump();
      if (await check()) return;
      await sleep(50);
    }
    throw new Error('Integration condition timed out');
  }
  worker = startWorker();
  const first = await createGuide(db, input, 'same-key');
  assert.equal((await createGuide(db, input, 'same-key')).id, first.id);
  await waitUntil(async () => (await getGuide(db!, first.id))?.status === 'completed');
  await publisher.publish('process', { schemaVersion: 2, guideId: first.id, generation: 1 }, randomUUID());
  await sleep(200);
  assert.equal((await getGuide(db, first.id))?.history.length, 1);
  console.log('PASS: durable acceptance, idempotency, processing, and duplicate delivery');

  const transient = await createGuide(db, { ...input, demoScenario: 'transient' }, 'transient');
  await waitUntil(async () => (await getGuide(db!, transient.id))?.status === 'completed');
  assert.equal((await getGuide(db, transient.id))?.attempts, 2);
  const exhausted = await createGuide(db, { ...input, demoScenario: 'exhausted' }, 'exhausted');
  await waitUntil(async () => (await getGuide(db!, exhausted.id))?.status === 'failed');
  assert.equal((await getGuide(db, exhausted.id))?.attempts, 3);
  await pump();
  const dead = await channel.get(queueNames(config.QUEUE_PREFIX).dead, { noAck: true });
  assert.ok(dead);
  assert.equal(JSON.parse(dead.content.toString()).guideId, exhausted.id);
  console.log('PASS: bounded delayed retries and confirmed dead-letter publication');

  const interrupted = await createGuide(db, input, 'crash');
  await waitUntil(async () => (await getGuide(db!, interrupted.id))?.status === 'processing');
  await stopWorker();
  worker = startWorker('10');
  await waitUntil(async () => (await getGuide(db!, interrupted.id))?.status === 'completed');
  assert.equal((await getGuide(db, interrupted.id))?.crashCount, 1);
  console.log('PASS: killed worker, lease recovery, and replacement worker completion');

  await channel.close();
  const disconnected = await createGuide(db, input, 'disconnected-publisher');
  await assert.rejects(() => dispatchOutbox(db!, publisher));
  assert.equal((await getGuide(db, disconnected.id))?.status, 'pending');
  channel = await connection.createConfirmChannel();
  channel.on('error', () => undefined);
  publisher = new RabbitPublisher(channel, config.QUEUE_PREFIX);
  await waitUntil(async () => (await getGuide(db!, disconnected.id))?.status === 'completed');
  console.log('PASS: publisher disconnect leaves accepted work recoverable');

  await stopWorker();
  await channel.deleteQueue(queueNames(config.QUEUE_PREFIX).jobs);
  await assert.rejects(
    () => publisher.publish('process', { schemaVersion: 2, guideId: first.id, generation: 1 }, randomUUID()),
    /unroutable/,
  );
  console.log('PASS: unroutable messages are rejected even when the broker confirms receipt');
  console.log('Real PostgreSQL/RabbitMQ integration checks passed. Gemini was mocked.');
} catch (error) {
  const reason =
    error instanceof AggregateError
      ? error.errors
          .map(
            (item: { code?: string; message?: string }) => item.code ?? item.message ?? 'connection failed',
          )
          .join(', ')
      : error instanceof Error
        ? error.message || error.name
        : 'unknown error';
  console.error(`Integration checks failed: ${reason}`);
  console.error('Start local dependencies with: docker compose up -d postgres rabbitmq');
  process.exitCode = 1;
} finally {
  await stopWorker();
  if (connection) {
    try {
      const channel = await connection.createChannel();
      channel.on('error', () => undefined);
      const names = queueNames(config.QUEUE_PREFIX);
      await channel.deleteQueue(names.jobs);
      await channel.deleteQueue(names.dead);
      await channel.deleteExchange(names.deadExchange);
      await channel.close();
    } catch {
      /* A lost connection cannot clean up its test queues. Prefix is printed below. */
    }
    await connection.close().catch(() => undefined);
  }
  await db?.close();
  if (schemaCreated) await admin.exec(`DROP SCHEMA "${schema}" CASCADE`);
  await admin.close();
  console.log(`Test namespace: ${schema}; RabbitMQ prefix: ${config.QUEUE_PREFIX}`);
}
