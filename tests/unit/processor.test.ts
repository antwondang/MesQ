import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createEmbeddedDatabase } from '../../packages/server/embedded.js';
import { migrate, type Database } from '../../packages/server/database.js';
import { readConfig } from '../../packages/server/config.js';
import { createGuide, getGuide, recoverExpired, claimGuide } from '../../packages/server/repository.js';
import { processMessage } from '../../packages/server/processor.js';
import { createProvider } from '../../packages/server/providers.js';
import type { GuideInput } from '../../packages/shared/contracts.js';

let db: Database;
const config = readConfig({ MOCK_DELAY_MS: '0', RETRY_BASE_MS: '10' });
const input: GuideInput = {
  title: 'Test processing request',
  body: 'A synthetic request used to exercise the full processing lifecycle.',
  demoScenario: 'normal',
  mode: 'notes',
  subject: 'computer-science',
};
beforeAll(async () => {
  db = await createEmbeddedDatabase();
  await migrate(db);
});
beforeEach(async () => {
  await db.exec('TRUNCATE study_guides,study_attempts,study_outbox');
});
afterAll(async () => {
  await db.close();
});

describe('processing lifecycle', () => {
  it('stops after exactly three transient failures', async () => {
    const guide = await createGuide(db, { ...input, demoScenario: 'exhausted' }, 'exhaust');
    for (let generation = 1; generation <= 3; generation++) {
      await db.query(
        "UPDATE study_guides SET next_attempt_at=clock_timestamp()-interval '1 second' WHERE id=$1",
        [guide.id],
      );
      await processMessage(
        db,
        createProvider(config),
        { schemaVersion: 2, guideId: guide.id, generation },
        'test-worker',
        config,
      );
    }
    const result = await getGuide(db, guide.id);
    expect(result?.status).toBe('failed');
    expect(result?.history.map((x) => x.outcome)).toEqual(['retrying', 'retrying', 'failed']);
    expect((await db.query("SELECT * FROM study_outbox WHERE kind='dead'")).rows).toHaveLength(1);
  });
  it('times out an unresponsive provider and records a retry', async () => {
    const guide = await createGuide(db, input, 'timeout');
    await processMessage(
      db,
      { analyze: () => new Promise(() => undefined) },
      { schemaVersion: 2, guideId: guide.id, generation: 1 },
      'test-worker',
      { ...config, AI_TIMEOUT_MS: 20 },
    );
    const result = await getGuide(db, guide.id);
    expect(result?.status).toBe('retrying');
    expect(result?.lastError).toBe('provider_timeout');
  });
  it('recovers a transient provider failure into a completed result', async () => {
    const guide = await createGuide(db, { ...input, demoScenario: 'transient' }, 'transient');
    await processMessage(
      db,
      createProvider(config),
      { schemaVersion: 2, guideId: guide.id, generation: 1 },
      'test-worker',
      config,
    );
    await db.query(
      "UPDATE study_guides SET next_attempt_at=clock_timestamp()-interval '1 second' WHERE id=$1",
      [guide.id],
    );
    await processMessage(
      db,
      createProvider(config),
      { schemaVersion: 2, guideId: guide.id, generation: 2 },
      'test-worker',
      config,
    );
    expect((await getGuide(db, guide.id))?.status).toBe('completed');
  });
  it('bounds repeated crashes separately from application retries', async () => {
    const guide = await createGuide(db, input, 'crash-budget');
    for (let crash = 0; crash < 3; crash++) {
      await claimGuide(db, { schemaVersion: 2, guideId: guide.id, generation: 1 }, 'doomed-worker', 45000);
      await db.query(
        "UPDATE study_guides SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",
        [guide.id],
      );
      await recoverExpired(db, 3);
    }
    const result = await getGuide(db, guide.id);
    expect(result?.status).toBe('failed');
    expect(result?.lastError).toBe('crash_budget_exhausted');
    expect(result?.attempts).toBe(1);
    expect(result?.crashCount).toBe(3);
  });
});
