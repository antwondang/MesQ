import { mkdtemp, copyFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, it } from 'vitest';
import { createEmbeddedDatabase } from '../../packages/server/embedded.js';
import { migrate } from '../../packages/server/database.js';
import { createApplication, getApplication, updateApplication } from '../../packages/server/repository.js';
import { applicationInputSchema } from '../../packages/shared/contracts.js';

it('upgrades without touching old study data and persists applications across restarts', async () => {
  const data = await mkdtemp(join(tmpdir(), 'internship-storage-'));
  const migrations = await mkdtemp(join(tmpdir(), 'internship-migrations-'));
  let db = await createEmbeddedDatabase(data);
  try {
    for (const name of ['001_initial.sql', '002_study.sql'])
      await copyFile(join('db/migrations', name), join(migrations, name));
    await migrate(db, migrations);
    await db.query(
      "INSERT INTO study_guides(id,idempotency_key,request_hash,title,body,mode,subject) VALUES($1,'old-key','old-hash','Old study notes','Keep this content','notes','science')",
      ['00000000-0000-4000-a000-000000000001'],
    );
    await migrate(db);
    const created = await createApplication(
      db,
      applicationInputSchema.parse({ company: 'Persistent', role: 'Intern', notes: 'Keep interview notes' }),
      'persistence-1',
    );
    await updateApplication(db, created.id, { version: 1, status: 'interview' });
    await db.close();
    db = await createEmbeddedDatabase(data);
    await migrate(db);
    expect(await getApplication(db, created.id)).toMatchObject({
      company: 'Persistent',
      status: 'interview',
      notes: 'Keep interview notes',
      version: 2,
    });
    expect((await db.query('SELECT body FROM study_guides')).rows).toEqual([{ body: 'Keep this content' }]);
    expect((await db.query('SELECT name FROM schema_migrations')).rows).toHaveLength(3);
  } finally {
    await db.close();
    await rm(data, { recursive: true, force: true });
    await rm(migrations, { recursive: true, force: true });
  }
});
