import { createApp } from '../apps/api/app.js';
import { createEmbeddedDatabase } from '../packages/server/embedded.js';
import { migrate } from '../packages/server/database.js';
import { loadEnvironment, log, readConfig } from '../packages/server/config.js';
import { createProvider } from '../packages/server/providers.js';
import { createGuide, recoverExpired } from '../packages/server/repository.js';
import { dispatchOutbox } from '../packages/server/dispatch.js';
import { processMessage } from '../packages/server/processor.js';
import { messageSchema, type JobMessage } from '../packages/shared/contracts.js';
import { sampleGuides } from '../packages/shared/samples.js';
import { setTimeout as sleep } from 'node:timers/promises';
import { parseArgs } from 'node:util';

loadEnvironment();
const { values } = parseArgs({
  options: { host: { type: 'string' }, port: { type: 'string' }, strictPort: { type: 'boolean' } },
});
const config = readConfig({
  ...process.env,
  AI_PROVIDER: 'mock',
  GEMINI_API_KEY: '',
  HOST: values.host ?? process.env.HOST ?? '127.0.0.1',
  PORT: values.port ?? process.env.PORT,
});
const db = await createEmbeddedDatabase(process.env.DEMO_DATA_DIR ?? '.demo-data');
await migrate(db);
const provider = createProvider(config);
const controller = new AbortController();
const pending: JobMessage[] = [];
// Rehydrate unpublished/queued jobs after a preview restart. This adapter is not RabbitMQ.
await db.query(
  "UPDATE study_outbox SET published_at=NULL WHERE kind='process' AND guide_id IN (SELECT id FROM study_guides WHERE status IN ('pending','queued','retrying'))",
);
for (const [index, guide] of sampleGuides.entries()) await createGuide(db, guide, `study-sample-v2-${index}`);
const server = createApp(db, config, 'preview').listen(config.PORT, config.HOST, () => {
  log('preview_ready', { port: config.PORT, provider: 'mock', transport: 'simulated_in_process_queue' });
});
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.once(signal, () => {
    controller.abort();
    server.close();
  });
try {
  while (!controller.signal.aborted) {
    try {
      await recoverExpired(db, config.MAX_CRASH_RECOVERIES);
      await dispatchOutbox(db, {
        publish: async (kind, payload) => {
          if (kind === 'process') pending.push(messageSchema.parse(payload));
        },
      });
      const message = pending.shift();
      if (message) await processMessage(db, provider, message, 'preview-worker', config, controller.signal);
    } catch {
      if (!controller.signal.aborted) log('preview_retrying');
    }
    await sleep(100, undefined, { signal: controller.signal }).catch(() => undefined);
  }
} finally {
  await db.close();
}
