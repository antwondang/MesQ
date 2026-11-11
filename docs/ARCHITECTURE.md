# Architecture

Internship Log is a manual, single-user tracker built with React, TypeScript, Vite, Express, and PostgreSQL-compatible storage. The frontend uses native controls and a modal form, with a table on larger screens and application cards on phones. Fonts and icons do not require external network requests.

## Storage

`npm start` uses PGlite in `.internship-data/`. Docker uses PostgreSQL 17 and a named volume. These stores are independent. Both use the same database adapter, repository, API, and SQL migrations.

Migration `003_internships.sql` adds `internship_applications` and `internship_activity`. Earlier migrations remain intact to preserve old study/support tables on existing installations. Those tables are not shown by the tracker. The new app does not contact Gemini or RabbitMQ.

Applications contain validated fields in JSONB plus a UUID, revision number, timestamps, and an idempotency key/hash. Updates lock the row inside a transaction, compare the submitted revision, and append activity atomically. Partial updates have no field defaults: editing a stage does not reset other data. Delete cascades only to that application's activity.

Dates are ISO calendar strings, not UTC timestamps. The browser determines Today and Overdue in its local timezone. Upcoming items are ordered by the earlier of the next-action date and (only while Saved) the application deadline. Closed and archived records are excluded.

## HTTP interface

| Method | Route                          | Purpose                                      |
| ------ | ------------------------------ | -------------------------------------------- |
| GET    | `/health`                      | Database readiness and app identity          |
| GET    | `/api/summary`                 | Counts excluding archive, plus archive count |
| GET    | `/api/applications`            | Search and list applications                 |
| POST   | `/api/applications`            | Create; optional `Idempotency-Key` header    |
| GET    | `/api/applications/:id`        | Read application and activity                |
| PATCH  | `/api/applications/:id`        | Partial fields plus required `version`       |
| DELETE | `/api/applications/:id`        | Required JSON body `{ "version": 1 }`        |
| GET    | `/api/applications/export.csv` | All matching rows, not only one page         |

List/export parameters: `view=applications|upcoming|archive`, optional `status`, `q` (company, role, location). Lists also accept `page` (default 1) and `pageSize` (default 20, maximum 100). Search treats SQL wildcard characters literally. A repeated create key returns its existing application; using that key with different content returns 409. Stale update/delete revisions also return 409. Invalid fields return 400, missing records 404, and unavailable storage 503.

SQL values are parameterized, links accept only HTTP(S), JSON body size and field lengths are bounded, and mutations reject a browser Origin with a different host. API responses are not cached. CSV quotes fields and prefixes potentially executable spreadsheet formulas. User content is rendered as text, never HTML. Logs contain events rather than application notes.

The app has no user authentication or tenant isolation. Localhost is the default network boundary. Access from another device requires a private connection with authentication; do not expose the bare API publicly.

## Code map

- `apps/web`: list, filters, editor, accessible form interactions, CSV download.
- `apps/api`: JSON API, validation, origin checks, static frontend.
- `packages/shared`: shared validation, types, status labels, and calendar rules.
- `packages/server`: persistence, transactions, migrations, and CSV formatting.
- `scripts/demo.ts`: local persistent application entry point.
- `tests/unit`: API integration tests with real embedded SQL, field/date contracts, and HTTP-compatible request keys.
