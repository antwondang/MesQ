import { z } from 'zod';
const environmentSchema = z.object({
  DATABASE_URL: z.string().default('postgres://triageflow:triageflow_dev@localhost:5432/triageflow'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  HOST: z.string().default('127.0.0.1'),
});
export function readConfig(env: NodeJS.ProcessEnv = process.env) {
  return environmentSchema.parse(env);
}
export function loadEnvironment() {
  try {
    process.loadEnvFile('.env');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}
export function log(event: string, fields: Record<string, string | number | boolean | null> = {}) {
  console.log(JSON.stringify({ time: new Date().toISOString(), event, ...fields }));
}
