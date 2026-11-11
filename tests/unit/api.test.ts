import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../apps/api/app.js';
import { createEmbeddedDatabase } from '../../packages/server/embedded.js';
import { migrate, type Database } from '../../packages/server/database.js';

let db: Database;
beforeAll(async () => {
  db = await createEmbeddedDatabase();
  await migrate(db);
});
beforeEach(async () => {
  await db.exec('TRUNCATE internship_applications,internship_activity');
});
afterAll(async () => {
  await db.close();
});
const app = () => createApp(db);
const input = {
  company: 'Northstar Labs',
  role: 'Software engineering intern',
  location: 'Remote',
  notes: 'Ask about the team.',
  nextAction: 'Prepare portfolio',
  nextActionDate: '2026-11-15',
};
const create = (overrides: object = {}) =>
  request(app())
    .post('/api/applications')
    .send({ ...input, ...overrides })
    .expect(201);
describe('internship application API', () => {
  it('persists complete applications and records stage history', async () => {
    const created = await create();
    const id = created.body.id;
    const loaded = await request(app()).get(`/api/applications/${id}`).expect(200);
    expect(loaded.body).toMatchObject({ ...input, status: 'saved', version: 1 });
    expect(loaded.body.history[0].description).toBe('Added to Saved');
    const updated = await request(app())
      .patch(`/api/applications/${id}`)
      .send({ status: 'interview', version: 1 })
      .expect(200);
    expect(updated.body).toMatchObject({ ...input, status: 'interview', version: 2 });
    const history = (await request(app()).get(`/api/applications/${id}`)).body.history;
    expect(history.map((event: { description: string }) => event.description)).toEqual([
      'Moved from Saved to Interview',
      'Added to Saved',
    ]);
    expect((await request(app()).get('/api/summary')).body).toMatchObject({
      total: 1,
      active: 1,
      interviews: 1,
      offers: 0,
    });
  });
  it('deduplicates network retries and rejects reuse with different content', async () => {
    const first = await request(app())
      .post('/api/applications')
      .set('Idempotency-Key', 'retry-1')
      .send(input)
      .expect(201);
    const second = await request(app())
      .post('/api/applications')
      .set('Idempotency-Key', 'retry-1')
      .send(input)
      .expect(201);
    expect(second.body.id).toBe(first.body.id);
    await request(app())
      .post('/api/applications')
      .set('Idempotency-Key', 'retry-1')
      .send({ ...input, company: 'Different' })
      .expect(409);
    expect((await request(app()).get('/api/applications')).body.total).toBe(1);
  });
  it('prevents stale tabs from overwriting or deleting newer edits', async () => {
    const { body } = await create();
    const url = `/api/applications/${body.id}`;
    await request(app()).patch(url).send({ notes: 'New notes', version: 1 }).expect(200);
    await request(app()).patch(url).send({ notes: 'Stale notes', version: 1 }).expect(409);
    await request(app()).delete(url).send({ version: 1 }).expect(409);
    expect((await request(app()).get(url)).body.notes).toBe('New notes');
    await request(app()).delete(url).send({ version: 2 }).expect(204);
    await request(app()).get(url).expect(404);
    expect((await db.query('SELECT * FROM internship_activity')).rows).toHaveLength(0);
  });
  it('archives and restores without losing stage or notes', async () => {
    const { body } = await create({ status: 'offer' });
    const url = `/api/applications/${body.id}`;
    await request(app()).patch(url).send({ archived: true, version: 1 }).expect(200);
    expect((await request(app()).get('/api/applications')).body.total).toBe(0);
    expect((await request(app()).get('/api/applications?view=archive')).body.items[0]).toMatchObject({
      status: 'offer',
      notes: input.notes,
    });
    expect((await request(app()).get('/api/summary')).body).toMatchObject({
      total: 0,
      offers: 0,
      archived: 1,
    });
    await request(app()).patch(url).send({ archived: false, version: 2 }).expect(200);
    expect((await request(app()).get('/api/applications')).body.total).toBe(1);
  });
  it('searches literal text, filters status, and paginates', async () => {
    await create({ company: '100% Labs', status: 'applied' });
    await create({ company: 'Other Labs' });
    await create({ company: 'Third Labs' });
    expect((await request(app()).get('/api/applications?page=2&pageSize=2')).body.items).toHaveLength(1);
    expect((await request(app()).get('/api/applications?q=100%25')).body.total).toBe(1);
    expect((await request(app()).get('/api/applications?q=remote&status=applied')).body.total).toBe(1);
    expect((await request(app()).get('/api/applications?q=missing')).body.total).toBe(0);
  });
  it('orders upcoming items and excludes closed, archived, and passed application deadlines', async () => {
    await create({ company: 'Action', nextActionDate: '2026-11-14', status: 'applied' });
    await create({ company: 'Deadline', nextActionDate: null, deadline: '2026-11-13' });
    await create({ company: 'Rejected', status: 'rejected' });
    await create({ company: 'Archived', archived: true });
    await create({
      company: 'Already applied',
      status: 'applied',
      deadline: '2026-11-01',
      nextActionDate: null,
    });
    const result = await request(app()).get('/api/applications?view=upcoming').expect(200);
    expect(result.body.items.map((row: { company: string }) => row.company)).toEqual(['Deadline', 'Action']);
  });
  it('exports all filtered rows and makes spreadsheet formulas inert', async () => {
    await create({ company: '=1+1', notes: '  @SUM(1,2)\n"quoted"' });
    await create({ company: 'Normal, Inc' });
    await create({ company: 'Archived', archived: true });
    const result = await request(app()).get('/api/applications/export.csv?pageSize=1').expect(200);
    expect(result.headers['content-type']).toContain('text/csv');
    expect(result.text).toContain('"\'=1+1"');
    expect(result.text).toContain('"\'@SUM'); // input trims leading whitespace
    expect(result.text).toContain('""quoted""');
    expect(result.text).toContain('"Normal, Inc"');
    expect(result.text).not.toContain('"Archived","Software');
    const filtered = await request(app()).get('/api/applications/export.csv?q=Normal');
    expect(filtered.text).not.toContain('=1+1');
  });
  it('rejects invalid input, unknown fields, malformed JSON, and writes from other origins', async () => {
    await request(app())
      .post('/api/applications')
      .send({ ...input, company: '' })
      .expect(400);
    await request(app())
      .post('/api/applications')
      .send({ ...input, url: 'javascript:alert(1)' })
      .expect(400);
    await request(app())
      .post('/api/applications')
      .send({ ...input, deadline: '2026-02-30' })
      .expect(400);
    await request(app())
      .post('/api/applications')
      .send({ ...input, surprise: true })
      .expect(400);
    await request(app())
      .post('/api/applications')
      .set('Content-Type', 'application/json')
      .send('{bad')
      .expect(400);
    await request(app()).get('/api/applications?pageSize=900').expect(400);
    await request(app()).get('/api/applications/not-a-uuid').expect(400);
    const client = request(app());
    for (const method of ['post', 'patch', 'delete'] as const)
      await client[method]('/api/applications/00000000-0000-4000-a000-000000000000')
        .set('Origin', 'https://other.example')
        .send({ ...input, version: 1 })
        .expect(403);
    expect((await db.query('SELECT * FROM internship_applications')).rows).toHaveLength(0);
  });
  it('returns JSON for missing API routes and identifies the new app', async () => {
    expect((await request(app()).get('/health').expect(200)).body.app).toBe('Internship Log');
    expect((await request(app()).get('/api/guides').expect(404)).body.error.code).toBe('not_found');
  });
});
