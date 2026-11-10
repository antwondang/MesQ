import express, { type ErrorRequestHandler } from 'express';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { listQuerySchema, guideInputSchema, type AppConfig } from '../../packages/shared/contracts.js';
import type { Database } from '../../packages/server/database.js';
import { createGuide, getMetrics, getGuide, listGuides } from '../../packages/server/repository.js';
import { log, type Config } from '../../packages/server/config.js';

export function createApp(db: Database, config: Config, transport: AppConfig['transport'] = 'rabbitmq') {
  const app = express();
  app.disable('x-powered-by');
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    next();
  });
  app.use('/api', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.use(express.json({ limit: '48kb', strict: true }));
  app.use((req, res, next) => {
    if (req.method === 'POST' && req.headers.origin) {
      try {
        if (new URL(req.headers.origin).host !== req.get('host')) {
          res
            .status(403)
            .json({ error: { code: 'origin_rejected', message: 'Cross-origin writes are not allowed.' } });
          return;
        }
      } catch {
        res.status(403).json({ error: { code: 'origin_rejected', message: 'Invalid request origin.' } });
        return;
      }
    }
    next();
  });
  app.get('/health', async (_req, res) => {
    await db.query('SELECT 1');
    res.json({ status: 'ok', database: 'connected', transport });
  });
  app.get('/api/config', (_req, res) => {
    const publicConfig: AppConfig = {
      provider: config.AI_PROVIDER,
      model: config.AI_PROVIDER === 'mock' ? 'study-examples-v2' : config.GEMINI_MODEL,
      transport,
      maxAttempts: config.MAX_ATTEMPTS,
    };
    res.json(publicConfig);
  });
  app.post('/api/guides', async (req, res) => {
    const input = guideInputSchema.parse(req.body);
    if (config.AI_PROVIDER === 'gemini' && input.demoScenario !== 'normal') {
      res.status(400).json({
        error: {
          code: 'demo_unavailable',
          message: 'Failure simulations are available only in mock mode.',
        },
      });
      return;
    }
    const key = z
      .string()
      .regex(/^[a-zA-Z0-9._:-]{1,128}$/)
      .parse(req.get('Idempotency-Key') ?? randomUUID());
    const guide = await createGuide(db, input, key);
    const statusUrl = `/api/guides/${guide.id}`;
    res.status(202).location(statusUrl).json({ id: guide.id, status: guide.status, statusUrl });
  });
  app.get('/api/guides', async (req, res) => {
    res.json(await listGuides(db, listQuerySchema.parse(req.query)));
  });
  app.get('/api/guides/:id', async (req, res) => {
    const guide = await getGuide(db, z.uuid().parse(req.params.id));
    if (!guide) {
      res.status(404).json({ error: { code: 'not_found', message: 'Guide not found.' } });
      return;
    }
    res.json(guide);
  });
  app.get('/api/metrics', async (_req, res) => {
    res.json(await getMetrics(db));
  });
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: { code: 'not_found', message: 'Endpoint not found.' } });
  });
  const web = resolve('dist/web');
  if (existsSync(resolve(web, 'index.html'))) {
    app.use(express.static(web));
    app.get('/{*path}', (_req, res) => {
      res.sendFile(resolve(web, 'index.html'));
    });
  }
  const errors: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
    if (error instanceof z.ZodError) {
      res.status(400).json({
        error: {
          code: 'validation_error',
          message: 'Check the input lengths, allowed values, and required fields.',
          fields: error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
        },
      });
      return;
    }
    if (error instanceof Error && error.message === 'idempotency_conflict') {
      res.status(409).json({
        error: {
          code: 'idempotency_conflict',
          message: 'This request key was already used for different content.',
        },
      });
      return;
    }
    const status = Number((error as { status?: number })?.status);
    if (status === 400 || status === 413) {
      res
        .status(status)
        .json({ error: { code: 'invalid_body', message: 'The JSON body is malformed or too large.' } });
      return;
    }
    log('api_error');
    res.status(503).json({
      error: {
        code: 'service_unavailable',
        message: 'The service is temporarily unavailable. Retry with the same request key.',
      },
    });
  };
  app.use(errors);
  return app;
}
