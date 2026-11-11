# Upgrade to Internship Log

This version replaces the StudyFlow/TriageFlow interfaces with a personal internship tracker. The package, browser title, and visible app name are now **Internship Log**. Old worker, AI-provider, broker, and study-generation code has been removed.

## If you downloaded a ZIP

1. Stop the old app with Ctrl+C (or stop the Docker services).
2. Download and extract the latest ZIP from the repository. Open a terminal in that **new folder**, not an older download.
3. Use Node.js 24 LTS. Run `node -v` to check. Node 18 causes the `node:util styleText` build error; installing dependencies again does not fix an outdated Node executable.
4. Run:

   ```bash
   npm ci
   npm run build
   npm start
   ```

5. Open http://localhost:3000 and refresh. If another app still owns that port, stop it or use `npm start -- --port 3001` and open that port instead.

When updating an existing Internship Log installation from a fresh ZIP, stop the old process and copy its hidden `.internship-data/` directory into the new project folder before starting. On macOS, Cmd+Shift+. shows hidden folders. Keep a backup first.

Older `.demo-data/` study records remain in their original folder and are not converted into internship applications. Keep them if you want that historical data. Local `.env` files are ignored by Git; AI/broker settings from earlier versions are no longer used.

## If you cloned the repository

In your project folder:

```bash
git pull --ff-only
npm ci
npm run build
npm start
```

Commit or save your own source edits before pulling. The build cleans stale compiled assets automatically. Your ignored `.internship-data/` directory stays in place.

## If you use Docker

Run from the existing checkout using the same Compose project name as before:

```bash
git pull --ff-only
docker compose up --build -d --wait --remove-orphans
```

`--remove-orphans` removes the obsolete worker, relay, and RabbitMQ containers. It does not delete their named volumes. The PostgreSQL service, credentials, and volume name are retained to reuse your database. Migration 003 adds new tracker tables; earlier tables remain intact.

If you extracted a new folder, retain your original Compose project name with `docker compose -p <original-project-name> up --build -d --wait --remove-orphans`. Changing the project name creates a different database volume. Never use `down -v` to update.

Local and Docker databases are separate; moving between them does not transfer records. CSV export is for a readable copy, not import or automatic migration.
