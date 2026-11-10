import pg from 'pg';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';

export type Row = Record<string, unknown>;
export interface Sql {
  query<T extends Row = Row>(text: string, values?: unknown[]): Promise<{ rows: T[]; rowCount: number }>;
  exec(text: string): Promise<void>;
}
export interface Database extends Sql {
  transaction<T>(fn: (sql: Sql) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

function wrap(client: pg.Pool | pg.PoolClient): Sql {
  return {
    async exec(text) {
      await client.query(text);
    },
    async query<T extends Row>(text: string, values?: unknown[]) {
      const result = await client.query<T>(text, values);
      return { rows: result.rows, rowCount: result.rowCount ?? 0 };
    },
  };
}
export function connectPostgres(url: string): Database {
  const pool = new pg.Pool({
    connectionString: url,
    max: 10,
    connectionTimeoutMillis: 5000,
    statement_timeout: 20000,
  });
  pool.on('error', () => console.error(JSON.stringify({ event: 'database_connection_error' })));
  return {
    ...wrap(pool),
    async transaction<T>(fn: (sql: Sql) => Promise<T>) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await fn(wrap(client));
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}

export async function migrate(db: Database, directory = resolve('db/migrations')) {
  await db.query(
    'CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())',
  );
  for (const name of (await readdir(directory)).filter((name) => name.endsWith('.sql')).sort()) {
    if ((await db.query('SELECT name FROM schema_migrations WHERE name=$1', [name])).rowCount) continue;
    const sql = await readFile(resolve(directory, name), 'utf8');
    await db.transaction(async (tx) => {
      await tx.exec(sql);
      await tx.query('INSERT INTO schema_migrations(name) VALUES($1)', [name]);
    });
  }
}
