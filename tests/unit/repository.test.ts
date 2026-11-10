import { studyFixture } from '../study-fixture.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createEmbeddedDatabase } from '../../packages/server/embedded.js';
import { migrate, type Database } from '../../packages/server/database.js';
import {
  createGuide,
  getGuide,
  claimGuide,
  completeGuide,
  recoverExpired,
  failGuide,
} from '../../packages/server/repository.js';
import { dispatchOutbox } from '../../packages/server/dispatch.js';
import { ProviderError } from '../../packages/server/retry.js';
import type { GuideInput, StudyResult } from '../../packages/shared/contracts.js';

let db: Database;
const input: GuideInput = {
  title: 'MIPS registers',
  body: 'MIPS uses registers for arithmetic. The lw instruction loads a word.',
  demoScenario: 'normal',
  mode: 'notes',
  subject: 'computer-science',
};
const output: StudyResult = studyFixture;
beforeEach(async () => {
  db = await createEmbeddedDatabase();
  await migrate(db);
});
afterEach(async () => {
  await db?.close();
});

describe('durable acceptance', () => {
  it('returns the same job for a repeated key and enqueues only one event', async () => {
    const first = await createGuide(db, input, 'test-key');
    const second = await createGuide(db, input, 'test-key');
    expect(first.id).toBe(second.id);
    expect((await db.query('SELECT * FROM study_guides')).rowCount).toBe(1);
    expect((await db.query('SELECT * FROM study_outbox')).rowCount).toBe(1);
    await expect(createGuide(db, { ...input, title: 'Different request' }, 'test-key')).rejects.toThrow(
      'idempotency_conflict',
    );
  });
  it('keeps the outbox event pending after a broker failure', async () => {
    const guide = await createGuide(db, input, 'broker-down');
    await expect(
      dispatchOutbox(db, {
        publish: async () => {
          throw new Error('broker unavailable');
        },
      }),
    ).rejects.toThrow();
    expect((await db.query('SELECT * FROM study_outbox WHERE published_at IS NULL')).rowCount).toBe(1);
    expect((await getGuide(db, guide.id))?.status).toBe('pending');
    await dispatchOutbox(db, { publish: async () => undefined });
    expect((await getGuide(db, guide.id))?.status).toBe('queued');
  });
});

describe('claims and recovery', () => {
  it('stores one result and ignores repeated deliveries', async () => {
    const guide = await createGuide(db, input, 'duplicate');
    const message = { schemaVersion: 2 as const, guideId: guide.id, generation: 1 };
    const claim = await claimGuide(db, message, 'worker-a', 45000);
    expect(claim).not.toBeNull();
    expect(await claimGuide(db, message, 'worker-b', 45000)).toBeNull();
    expect(
      await completeGuide(db, claim!, output, {
        provider: 'mock',
        model: 'rules-v1',
        durationMs: 10,
        tokens: null,
      }),
    ).toBe(true);
    expect(
      await completeGuide(
        db,
        claim!,
        { ...output, summary: 'Must not overwrite.' },
        { provider: 'mock', model: 'rules-v1', durationMs: 10, tokens: null },
      ),
    ).toBe(false);
    expect(await claimGuide(db, message, 'worker-b', 45000)).toBeNull();
    expect((await getGuide(db, guide.id))?.result?.summary).toBe(output.summary);
  });
  it('fences out an expired worker and recovers the same logical attempt', async () => {
    const guide = await createGuide(db, input, 'crash');
    const message = { schemaVersion: 2 as const, guideId: guide.id, generation: 1 };
    const stale = await claimGuide(db, message, 'worker-a', 45000);
    await db.query("UPDATE study_guides SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1", [
      guide.id,
    ]);
    expect(await recoverExpired(db, 3)).toBe(1);
    const current = await claimGuide(db, message, 'worker-b', 45000);
    expect(current!.fence).toBeGreaterThan(stale!.fence);
    expect(
      await completeGuide(db, stale!, output, {
        provider: 'mock',
        model: 'rules-v1',
        durationMs: 10,
        tokens: null,
      }),
    ).toBe(false);
    expect(
      await completeGuide(db, current!, output, {
        provider: 'mock',
        model: 'rules-v1',
        durationMs: 10,
        tokens: null,
      }),
    ).toBe(true);
    const detail = await getGuide(db, guide.id);
    expect(detail?.crashCount).toBe(1);
    expect(detail?.attempts).toBe(1);
    expect(detail?.history.map((x) => x.outcome)).toEqual(['interrupted', 'completed']);
  });
  it('delays retries and rejects stale generations', async () => {
    const guide = await createGuide(db, input, 'retry');
    const message = { schemaVersion: 2 as const, guideId: guide.id, generation: 1 };
    const claim = await claimGuide(db, message, 'worker-a', 45000);
    await failGuide(db, claim!, new ProviderError('provider_rate_limit', true), 5000, 3, 10);
    expect((await getGuide(db, guide.id))?.status).toBe('retrying');
    expect(await claimGuide(db, message, 'worker-a', 45000)).toBeNull();
    expect(await claimGuide(db, { ...message, generation: 2 }, 'worker-a', 45000)).toBeNull();
    await db.query(
      "UPDATE study_guides SET next_attempt_at=clock_timestamp()-interval '1 second' WHERE id=$1",
      [guide.id],
    );
    const next = await claimGuide(db, { ...message, generation: 2 }, 'worker-a', 45000);
    expect(next?.generation).toBe(2);
  });
  it('persists a terminal failure and its dead-letter event atomically', async () => {
    const guide = await createGuide(db, input, 'dead');
    const claim = await claimGuide(
      db,
      { schemaVersion: 2, guideId: guide.id, generation: 1 },
      'worker-a',
      45000,
    );
    await failGuide(db, claim!, new ProviderError('provider_credentials', false), 0, 3, 10);
    expect((await getGuide(db, guide.id))?.status).toBe('failed');
    expect((await db.query("SELECT * FROM study_outbox WHERE kind='dead'")).rowCount).toBe(1);
  });
});

it('includes study mode, subject and notes in idempotency and worker claims', async () => {
  const guide = await createGuide(db, input, 'study-hash');
  for (const changed of [
    { mode: 'topic' as const },
    { subject: 'mathematics' as const },
    { body: 'Different notes about registers and memory.' },
  ]) {
    await expect(createGuide(db, { ...input, ...changed }, 'study-hash')).rejects.toThrow(
      'idempotency_conflict',
    );
  }
  const claim = await claimGuide(db, { schemaVersion: 2, guideId: guide.id, generation: 1 }, 'test', 45000);
  expect(claim?.input).toEqual(input);
});
it('migrates an existing support database without changing its rows or pending events', async () => {
  await db.exec('DROP TABLE study_outbox, study_attempts, study_guides');
  await db.query("DELETE FROM schema_migrations WHERE name='002_study.sql'");
  const id = '00000000-0000-4000-8000-000000000001';
  await db.query(
    `INSERT INTO tickets(id,idempotency_key,request_hash,title,body,result) VALUES($1,'legacy','hash','Old support ticket','Preserved customer text',$2::jsonb)`,
    [id, JSON.stringify({ category: 'billing', suggestedReply: 'Original reply' })],
  );
  await db.query(
    `INSERT INTO outbox(id,ticket_id,kind,generation,payload) VALUES($1,$1,'process',1,$2::jsonb)`,
    [id, JSON.stringify({ schemaVersion: 1, ticketId: id, generation: 1 })],
  );
  await migrate(db);
  expect(await getGuide(db, id)).toBeNull();
  const published: unknown[] = [];
  await dispatchOutbox(db, {
    publish: async (_kind, payload) => {
      published.push(payload);
    },
  });
  expect(published).toEqual([]);
  expect((await db.query('SELECT result FROM tickets WHERE id=$1', [id])).rows[0].result).toEqual({
    category: 'billing',
    suggestedReply: 'Original reply',
  });
  expect((await db.query('SELECT * FROM outbox WHERE published_at IS NULL')).rowCount).toBe(1);
});
