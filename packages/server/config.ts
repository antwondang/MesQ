import { z } from 'zod';

const environmentSchema = z.object({
  DATABASE_URL: z.string().default('postgres://triageflow:triageflow_dev@localhost:5432/triageflow'),
  RABBITMQ_URL: z.string().default('amqp://triageflow:triageflow_dev@localhost:5672'),
  AI_PROVIDER: z.enum(['mock', 'gemini']).default('mock'),
  GEMINI_API_KEY: z.string().default(''),
  GEMINI_MODEL: z.string().default(''),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  HOST: z.string().default('127.0.0.1'),
  AI_TIMEOUT_MS: z.coerce.number().int().min(100).max(120000).default(30000),
  LEASE_MS: z.coerce.number().int().min(200).max(180000).default(45000),
  RETRY_BASE_MS: z.coerce.number().int().min(10).max(60000).default(2000),
  MAX_ATTEMPTS: z.coerce.number().int().min(1).max(5).default(3),
  MAX_CRASH_RECOVERIES: z.coerce.number().int().min(1).max(10).default(3),
  MOCK_DELAY_MS: z.coerce.number().int().min(0).max(60000).default(700),
  QUEUE_PREFIX: z
    .string()
    .regex(/^[a-zA-Z0-9_.-]+$/)
    .default('triageflow'),
});
export type Config = z.infer<typeof environmentSchema>;
export function readConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const config = environmentSchema.parse(env);
  if (config.LEASE_MS < config.AI_TIMEOUT_MS + 5000)
    throw new Error('LEASE_MS must exceed AI_TIMEOUT_MS by at least 5000ms');
  if (config.AI_PROVIDER === 'gemini' && (!config.GEMINI_API_KEY || !config.GEMINI_MODEL)) {
    throw new Error('Gemini mode requires GEMINI_API_KEY and GEMINI_MODEL');
  }
  return config;
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
