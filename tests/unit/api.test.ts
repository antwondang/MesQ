import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../apps/api/app.js';
import { createEmbeddedDatabase } from '../../packages/server/embedded.js';
import { migrate, type Database } from '../../packages/server/database.js';
import { readConfig } from '../../packages/server/config.js';

let db: Database;
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
const input = {
  title: 'MIPS registers',
  mode: 'notes',
  subject: 'computer-science',
  body: 'MIPS uses registers for arithmetic and load/store for memory.',
};
const app = () => createApp(db, readConfig(), 'preview');
describe('HTTP API', () => {
  it('accepts a job without an AI call and exposes its tracking URL', async () => {
    const accepted = await request(app())
      .post('/api/guides')
      .set('Idempotency-Key', 'http-1')
      .send(input)
      .expect(202);
    const detail = await request(app()).get(accepted.body.statusUrl).expect(200);
    expect(detail.body.status).toBe('pending');
    expect(detail.body.result).toBeNull();
    expect(detail.body.history).toEqual([]);
  });
  it('enforces request idempotency across retries and conflicting bodies', async () => {
    const first = await request(app())
      .post('/api/guides')
      .set('Idempotency-Key', 'http-2')
      .send(input)
      .expect(202);
    const second = await request(app())
      .post('/api/guides')
      .set('Idempotency-Key', 'http-2')
      .send(input)
      .expect(202);
    expect(first.body.id).toBe(second.body.id);
    await request(app())
      .post('/api/guides')
      .set('Idempotency-Key', 'http-2')
      .send({ ...input, title: 'A different request' })
      .expect(409);
  });
  it('rejects malformed content, IDs, pagination, and cross-origin writes', async () => {
    await request(app()).post('/api/guides').send({ title: 'a', body: '' }).expect(400);
    await request(app()).get('/api/guides/not-a-uuid').expect(400);
    await request(app()).get('/api/guides?pageSize=900').expect(400);
    await request(app())
      .post('/api/guides')
      .set('Origin', 'https://unrelated.example')
      .send(input)
      .expect(403);
    expect((await db.query('SELECT * FROM study_guides')).rows).toHaveLength(0);
  });
  it('filters, paginates, and reports measured counts', async () => {
    for (let i = 0; i < 3; i++)
      await request(app())
        .post('/api/guides')
        .send({ ...input, title: `MIPS registers ${i}` })
        .expect(202);
    const page = await request(app()).get('/api/guides?page=2&pageSize=2&status=pending').expect(200);
    expect(page.body.items).toHaveLength(1);
    expect(page.body.total).toBe(3);
    const metrics = await request(app()).get('/api/metrics').expect(200);
    expect(metrics.body.total).toBe(3);
    expect(metrics.body.p50CompletionMs).toBeNull();
    expect(metrics.body.pendingPublications).toBe(3);
  });
  it('never exposes the Gemini key through config or errors', async () => {
    const api = createApp(db, readConfig({ GEMINI_API_KEY: 'private-test-secret' }), 'preview');
    const response = await request(api).get('/api/config').expect(200);
    expect(JSON.stringify(response.body)).not.toContain('private-test-secret');
  });
});

it('accepts topic-only study requests and filters by subject', async () => {
  const accepted = await request(app())
    .post('/api/guides')
    .send({ title: 'Bayes theorem', mode: 'topic', subject: 'mathematics' })
    .expect(202);
  const guide = await request(app()).get(accepted.body.statusUrl).expect(200);
  expect(guide.body).toMatchObject({ mode: 'topic', subject: 'mathematics', body: '' });
  expect((await request(app()).get('/api/guides?subject=mathematics&q=Bayes')).body.total).toBe(1);
  expect((await request(app()).get('/api/guides?subject=science')).body.total).toBe(0);
  await request(app()).get('/api/guides?subject=billing').expect(400);
  await request(app())
    .post('/api/guides')
    .send({ title: 'Bayes theorem', mode: 'notes', body: ' ' })
    .expect(400);
});
it('rejects simulation scenarios in Gemini mode', async () => {
  const live = createApp(
    db,
    readConfig({ AI_PROVIDER: 'gemini', GEMINI_MODEL: 'test-model', GEMINI_API_KEY: 'test-key' }),
  );
  await request(live)
    .post('/api/guides')
    .send({ ...input, demoScenario: 'transient' })
    .expect(400);
  expect((await db.query('SELECT * FROM study_guides')).rows).toHaveLength(0);
});
