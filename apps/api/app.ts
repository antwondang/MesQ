import express, { type ErrorRequestHandler } from 'express';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { listQuerySchema, applicationInputSchema, updateSchema } from '../../packages/shared/contracts.js';
import type { Database } from '../../packages/server/database.js';
import {
  createApplication,
  getSummary,
  getApplication,
  listApplications,
  updateApplication,
  deleteApplication,
  exportApplications,
  RepositoryError,
} from '../../packages/server/repository.js';
import { log } from '../../packages/server/config.js';

export function createApp(db: Database) {
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
  app.use(express.json({ limit: '64kb', strict: true }));
  app.use((req, res, next) => {
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && req.headers.origin) {
      try {
        if (new URL(req.headers.origin).host !== req.get('host')) throw new Error('origin');
      } catch {
        res
          .status(403)
          .json({ error: { code: 'origin_rejected', message: 'Cross-origin writes are not allowed.' } });
        return;
      }
    }
    next();
  });
  app.get('/health', async (_req, res) => {
    await db.query('SELECT 1');
    res.json({ status: 'ok', app: 'Internship Log', database: 'connected' });
  });
  app.get('/api/summary', async (_req, res) => {
    res.json(await getSummary(db));
  });
  app.get('/api/applications/export.csv', async (req, res) => {
    const csv = await exportApplications(db, listQuerySchema.parse(req.query));
    res.setHeader('Content-Disposition', 'attachment; filename="internship-applications.csv"');
    res.type('text/csv').send(csv);
  });
  app.get('/api/applications', async (req, res) => {
    res.json(await listApplications(db, listQuerySchema.parse(req.query)));
  });
  app.post('/api/applications', async (req, res) => {
    const input = applicationInputSchema.parse(req.body);
    const key = z
      .string()
      .regex(/^[a-zA-Z0-9._:-]{1,128}$/)
      .parse(req.get('Idempotency-Key') ?? randomUUID());
    const application = await createApplication(db, input, key);
    res.status(201).location(`/api/applications/${application.id}`).json(application);
  });
  app.get('/api/applications/:id', async (req, res) => {
    res.json(await getApplication(db, z.uuid().parse(req.params.id)));
  });
  app.patch('/api/applications/:id', async (req, res) => {
    res.json(await updateApplication(db, z.uuid().parse(req.params.id), updateSchema.parse(req.body)));
  });
  app.delete('/api/applications/:id', async (req, res) => {
    const { version } = z.object({ version: z.number().int().positive() }).strict().parse(req.body);
    await deleteApplication(db, z.uuid().parse(req.params.id), version);
    res.status(204).end();
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
          message: error.issues[0]?.message ?? 'Check the application fields.',
          fields: error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
        },
      });
      return;
    }
    if (error instanceof RepositoryError) {
      res
        .status(error.code === 'not_found' ? 404 : 409)
        .json({ error: { code: error.code, message: error.message } });
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
      error: { code: 'service_unavailable', message: 'Could not reach the database. Please try again.' },
    });
  };
  app.use(errors);
  return app;
}
