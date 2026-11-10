import { PGlite } from '@electric-sql/pglite';
import type { Database, Row, Sql } from './database.js';

// Development/test adapter only. The Docker services always use pg + PostgreSQL.
export async function createEmbeddedDatabase(dataDir?: string): Promise<Database> {
  const db = new PGlite(dataDir);
  await db.waitReady;
  const wrap = (client: Pick<PGlite, 'query' | 'exec'>): Sql => ({
    async exec(text) {
      await client.exec(text);
    },
    async query<T extends Row>(text: string, values?: unknown[]) {
      const result = await client.query<T>(text, values);
      return { rows: result.rows, rowCount: Math.max(result.affectedRows ?? 0, result.rows.length) };
    },
  });
  return { ...wrap(db), transaction: (fn) => db.transaction((tx) => fn(wrap(tx))), close: () => db.close() };
}
