import { connectPostgres, migrate } from '../packages/server/database.js';
import { loadEnvironment, log, readConfig } from '../packages/server/config.js';
loadEnvironment();
const db = connectPostgres(readConfig().DATABASE_URL);
try {
  await migrate(db);
  log('migrations_applied');
} finally {
  await db.close();
}
