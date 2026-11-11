import { createApp } from './app.js';
import { connectPostgres } from '../../packages/server/database.js';
import { loadEnvironment, log, readConfig } from '../../packages/server/config.js';

loadEnvironment();
const config = readConfig();
const db = connectPostgres(config.DATABASE_URL);
const server = createApp(db).listen(config.PORT, config.HOST, () =>
  log('api_listening', { port: config.PORT }),
);
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.once(signal, () => {
    server.close(() => {
      void db.close();
    });
    setTimeout(() => process.exit(0), 10000).unref();
  });
