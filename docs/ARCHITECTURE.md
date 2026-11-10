# Architecture

The React library submits to Express and polls saved state every two seconds. The database owns job state; RabbitMQ delivers work notifications. The Gemini adapter uses the official SDK, a server-side key, bounded output schema, one SDK attempt, and application-managed retries.

1. Input is trimmed and validated. A hash covers title, mode, subject, notes/context, and mock scenario. The guide and its outbox event commit together before HTTP 202. Repeated keys return the existing guide; changed content returns 409.
2. The relay publishes durable messages with mandatory routing and publisher confirms. It marks the outbox event published only after confirmation. A crash between confirmation and commit may redeliver.
3. Workers consume manually acknowledged messages with prefetch 1. Claims increment a fencing token and establish an expiring lease. Duplicates or stale generations cannot create a second result.
4. Provider output is validated before completion. Notes are untrusted content, not prompt instructions. Notes-mode concepts distinguish source material from additional explanations; gaps are explicit. Topic mode requests general explanations.
5. Transient errors schedule durable delayed outbox events with bounded retries and provider retry hints. Terminal failure commits with a dead-letter event. Expired leases are recovered by the relay with a separate crash budget.
6. Only the current unexpired claim may commit a result. Exactly-once AI execution is not guaranteed: a recovered call may run again and incur additional quota.

Migration 002 introduces study tables and version-2 messages/queues without touching the legacy support workflow. See UPGRADE.md. A single database/broker is not a highly available deployment. `/health` checks database reachability, not the broker.

The preview substitutes PGlite and a simulated queue; it remains mock-only. It exercises UI and job state but is not evidence for real RabbitMQ reliability. Integration tests use isolated real PostgreSQL schemas and RabbitMQ queues.
