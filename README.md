# StudyFlow

A personal study app built with React, TypeScript, Express, PostgreSQL, RabbitMQ, and the Gemini SDK. Paste lecture notes or enter a topic to create a saved summary, key concepts, and practice questions with answers you can reveal. Search your library by topic, subject, or processing status.

The default is **mock mode**. MIPS, red-black trees, and probability have fixed educational examples. Other topics show a labeled study template. Mock mode does not analyze arbitrary notes. Configure Gemini for generated study guides; review its explanations against your course material.

## Quick start without Docker

Use Node.js 22.12+ (tested with 24.22.1). Run these commands in the folder containing `package.json`:

```bash
npm ci
npm run build
npm run demo
```

The app listens on port 3000. This preview uses a persistent PGlite database in `.demo-data`, a simulated in-process queue, and mock AI regardless of `.env`. It seeds study examples once. `npm run dev` is an alias; rebuild after frontend changes, or use `npm run dev:web` in another terminal for Vite hot reload on port 5173.

## Run PostgreSQL and RabbitMQ with Docker

From the folder containing `compose.yaml`, with Docker Desktop running:

```bash
# Preserve an existing .env. Create one only if absent.
test -f .env || cp .env.example .env
docker compose up --build -d
docker compose ps
```

The application listens on port 3000 and RabbitMQ management on 15672. Local development broker credentials are `triageflow` / `triageflow_dev`; these are local defaults, not production credentials. Services are postgres, rabbitmq, migrate, api, relay, and worker. New submissions are processed asynchronously. In mock mode, use “Load sample guides” to populate the library.

```bash
docker compose logs --tail=100 api relay worker
docker compose up -d --scale worker=3
docker compose down
```

`down` preserves named volumes. Do not add `-v` during an upgrade. This personal app has no authentication; Compose binds its published ports to localhost.

### Existing TriageFlow installation

Read [the upgrade instructions](docs/UPGRADE.md) before replacing an existing installation. Keep its directory/Compose project name, `.env`, and named volumes. The new migration creates separate study tables; old support data and queues remain intact but are not shown in StudyFlow.

### Gemini

Set these in your private `.env`, using a model available to your account:

```dotenv
AI_PROVIDER=gemini
GEMINI_API_KEY=your_private_key
GEMINI_MODEL=your_model_name
```

Then run `docker compose up -d --force-recreate api relay worker`. The worker reads the key; it is never included in browser config. Live requests can consume quota. The no-Docker demo intentionally stays mocked. Live Gemini has not been verified without an actual key.

### Native development with real services

```bash
npm ci
test -f .env || cp .env.example .env
docker compose up -d postgres rabbitmq
npm run migrate
npm run build
```

Run `npm run dev:api`, `npm run relay`, `npm run worker`, and `npm run dev:web` in separate terminals. Vite proxies API requests to port 3000.

## Checks

```bash
npm run typecheck
npm run lint
npm test
npm run build
npm run format:check
npm run evaluate -- --provider=mock --limit=4
# Requires real PostgreSQL and RabbitMQ:
npm run test:integration
```

Unit tests use PGlite; integration tests create an isolated schema and queue namespace against real services. Evaluation checks bounded output shape and completeness, not educational accuracy. See [manual evaluation](docs/EVALUATION.md), [architecture](docs/ARCHITECTURE.md), and [demo walkthrough](docs/DEMO.md).

## HTTP API

`POST /api/guides` returns 202 after the guide and outbox event commit together. Include `Idempotency-Key` to retry submissions safely. `GET /api/guides` supports `q`, `subject`, `status`, `page`, and `pageSize`; `GET /api/guides/:id` includes the result and attempt history. `/api/metrics`, `/api/config`, and `/health` expose counts, non-secret configuration, and database health. Health does not prove broker connectivity.

```json
{ "title": "Red-black trees", "mode": "topic", "subject": "computer-science", "body": "Focus on rotations" }
```
