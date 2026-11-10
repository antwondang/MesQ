import { randomUUID } from 'node:crypto';
import { connectPostgres } from '../../packages/server/database.js';
import { loadEnvironment, readConfig } from '../../packages/server/config.js';
import { createProvider } from '../../packages/server/providers.js';
import { runConsumer } from '../../packages/server/rabbit.js';

loadEnvironment();
const config = readConfig();
const db = connectPostgres(config.DATABASE_URL);
const controller = new AbortController();
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => controller.abort());
try {
  await runConsumer(
    config,
    db,
    createProvider(config),
    `worker-${randomUUID().slice(0, 8)}`,
    controller.signal,
  );
} finally {
  await db.close();
}
