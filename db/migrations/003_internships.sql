-- Separate tables preserve older study guides and support tickets during upgrades.
CREATE TABLE internship_applications (
  id uuid PRIMARY KEY,
  payload jsonb NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  request_key text NOT NULL UNIQUE,
  request_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX internship_updated_idx ON internship_applications (updated_at DESC, id);
CREATE TABLE internship_activity (
  id uuid PRIMARY KEY,
  application_id uuid NOT NULL REFERENCES internship_applications(id) ON DELETE CASCADE,
  description text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX internship_activity_application_idx ON internship_activity (application_id, created_at DESC);
