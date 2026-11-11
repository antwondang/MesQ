import { parseArgs } from 'node:util';
import { createApp } from '../apps/api/app.js';
import { createEmbeddedDatabase } from '../packages/server/embedded.js';
import { migrate } from '../packages/server/database.js';
import { loadEnvironment, log, readConfig } from '../packages/server/config.js';

loadEnvironment();
const { values } = parseArgs({
  options: { host: { type: 'string' }, port: { type: 'string' }, strictPort: { type: 'boolean' } },
});
const config = readConfig({
  ...process.env,
  HOST: values.host ?? process.env.HOST,
  PORT: values.port ?? process.env.PORT,
});
const dataDir = process.env.DATA_DIR ?? '.internship-data';
const db = await createEmbeddedDatabase(dataDir);
await migrate(db);
const server = createApp(db).listen(config.PORT, config.HOST, () => {
  log('internship_log_ready', { port: config.PORT });
  console.log(`Internship Log is ready at http://${config.HOST}:${config.PORT}`);
});
server.once('error', async (error: NodeJS.ErrnoException) => {
  console.error(
    error.code === 'EADDRINUSE'
      ? `Port ${config.PORT} is in use. Stop the other app or run npm run demo -- --port 3001.`
      : 'The app could not start.',
  );
  await db.close();
  process.exitCode = 1;
});
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.once(signal, () => {
    server.close(() => {
      void db.close();
    });
    setTimeout(() => process.exit(0), 10000).unref();
  });
