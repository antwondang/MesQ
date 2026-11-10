import { expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { once } from 'node:events';
import { setTimeout as sleep } from 'node:timers/promises';
import { createEmbeddedDatabase } from '../../packages/server/embedded.js';
import { migrate } from '../../packages/server/database.js';
import { createApp } from '../../apps/api/app.js';
import { readConfig } from '../../packages/server/config.js';
import { createProvider } from '../../packages/server/providers.js';
import { dispatchOutbox } from '../../packages/server/dispatch.js';
import { processMessage } from '../../packages/server/processor.js';
import { messageSchema, type JobMessage } from '../../packages/shared/contracts.js';

it('runs the benchmark command against a live API and writes complete mock results', async () => {
  const db = await createEmbeddedDatabase();
  await migrate(db);
  const config = readConfig({ MOCK_DELAY_MS: '0' });
  const provider = createProvider(config);
  const server = createApp(db, config, 'preview').listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No API port assigned');
  const queue: JobMessage[] = [];
  let running = true;
  const worker = (async () => {
    while (running) {
      await dispatchOutbox(db, {
        publish: async (kind, payload) => {
          if (kind === 'process') queue.push(messageSchema.parse(payload));
        },
      });
      const message = queue.shift();
      if (message) await processMessage(db, provider, message, 'benchmark-smoke-worker', config);
      await sleep(10);
    }
  })();
  try {
    const { stdout } = await promisify(execFile)(
      process.execPath,
      [
        '--import',
        'tsx',
        'scripts/benchmark.ts',
        '--provider=mock',
        '--guides=8',
        '--concurrency=2',
        '--timeout-ms=10000',
      ],
      {
        env: { ...process.env, BASE_URL: `http://127.0.0.1:${address.port}` },
        timeout: 15000,
      },
    );
    const report = JSON.parse(stdout);
    expect(report.completed).toBe(8);
    expect(report.failed).toBe(0);
    expect(report.pending).toBe(0);
    expect(report.transport).toBe('preview');
    expect(report.acceptanceP95Ms).toBeGreaterThan(0);
    expect(report.file).toMatch(/^test-results\/benchmark-/);
  } finally {
    running = false;
    await worker;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await db.close();
  }
});
