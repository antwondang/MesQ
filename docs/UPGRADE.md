# Upgrading from TriageFlow

Back up the existing project and database before installing the new source. Preserve your `.env` and volumes. Stop old API/relay/worker processes before applying the new code; do not delete their database or queues.

Migration `001_initial.sql` is unchanged. Additive migration `002_study.sql` creates `study_guides`, `study_attempts`, and `study_outbox`. Existing `tickets`, `attempts`, and `outbox` remain unchanged. The new UI/API only reads study tables; old support results are not silently reinterpreted.

Every queue name now includes `.study.v2` after the configured `QUEUE_PREFIX`, including when an old `.env` still sets `QUEUE_PREFIX=triageflow`. Old queues are not consumed or purged. Study job payloads use `{schemaVersion:2,guideId,generation}`. Old pending work remains in the old workflow for a deliberate later decision.

Database names, local development credentials, service names and volume declarations remain compatible. Keep the **same Compose project name** you previously used. By default Compose derives it from the directory: moving from `triageflow` to `MesQ` creates different volumes even when their declarations have the same names. Use the original directory or `docker compose -p YOUR_EXISTING_PROJECT ...`. Check `docker compose ls` to identify it; do not guess. Two stacks cannot both bind port 3000.

```bash
# In the existing project directory; preserve .env.
docker compose stop api relay worker
# Install the updated source, including the added migration.
docker compose up --build -d
```

The preview retains `.demo-data`; new study samples use separate idempotency keys. Old support rows are retained there too. Do not use `docker compose down -v` or delete `.demo-data` as a migration step.

Rollback: stop the new processes and restore the original source, keeping the same database, queue prefix, and Compose project. The original tables/queues still exist. Study tables and queues can remain dormant; no destructive down migration is needed. No existing production migration or real user dataset was available during development; tests exercise preservation using synthetic legacy data.
