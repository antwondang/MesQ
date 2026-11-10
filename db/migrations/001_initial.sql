CREATE TABLE tickets (
  id uuid PRIMARY KEY,
  idempotency_key text NOT NULL UNIQUE,
  request_hash text NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  demo_scenario text NOT NULL DEFAULT 'normal',
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','queued','processing','retrying','completed','failed')),
  generation integer NOT NULL DEFAULT 1 CHECK (generation > 0),
  fence integer NOT NULL DEFAULT 0,
  attempts integer NOT NULL DEFAULT 0,
  crash_count integer NOT NULL DEFAULT 0,
  lease_until timestamptz,
  next_attempt_at timestamptz,
  result jsonb,
  provider text,
  model text,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  queued_at timestamptz,
  first_started_at timestamptz,
  completed_at timestamptz
);
CREATE INDEX tickets_status_created ON tickets(status, created_at DESC);
CREATE INDEX tickets_expired_lease ON tickets(lease_until) WHERE status='processing';

CREATE TABLE attempts (
  id uuid PRIMARY KEY,
  ticket_id uuid NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  generation integer NOT NULL,
  fence integer NOT NULL,
  worker_id text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  ended_at timestamptz,
  outcome text NOT NULL DEFAULT 'running',
  error_code text,
  duration_ms integer,
  tokens integer,
  UNIQUE(ticket_id, fence)
);

CREATE TABLE outbox (
  id uuid PRIMARY KEY,
  ticket_id uuid NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('process','dead')),
  generation integer NOT NULL,
  payload jsonb NOT NULL,
  available_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX outbox_due ON outbox(available_at, created_at) WHERE published_at IS NULL;
