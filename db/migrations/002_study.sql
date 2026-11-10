-- Additive transition: legacy tickets, attempts and outbox remain untouched.
CREATE TABLE study_guides (
  id uuid PRIMARY KEY,
  idempotency_key text NOT NULL UNIQUE,
  request_hash text NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  mode text NOT NULL CHECK (mode IN ('notes','topic')),
  subject text NOT NULL CHECK (subject IN ('computer-science','mathematics','science','other')),
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
CREATE INDEX study_guides_status_created ON study_guides(status, created_at DESC);
CREATE INDEX study_guides_expired_lease ON study_guides(lease_until) WHERE status='processing';

CREATE TABLE study_attempts (
  id uuid PRIMARY KEY,
  guide_id uuid NOT NULL REFERENCES study_guides(id) ON DELETE CASCADE,
  generation integer NOT NULL,
  fence integer NOT NULL,
  worker_id text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  ended_at timestamptz,
  outcome text NOT NULL DEFAULT 'running',
  error_code text,
  duration_ms integer,
  tokens integer,
  UNIQUE(guide_id, fence)
);

CREATE TABLE study_outbox (
  id uuid PRIMARY KEY,
  guide_id uuid NOT NULL REFERENCES study_guides(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('process','dead')),
  generation integer NOT NULL,
  payload jsonb NOT NULL,
  available_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX study_outbox_due ON study_outbox(available_at, created_at) WHERE published_at IS NULL;
