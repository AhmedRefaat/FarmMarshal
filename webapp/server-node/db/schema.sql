-- =============================================================================
-- FarmMarshal — PostgreSQL schema v2 (ADR-004) + TimescaleDB for telemetry
-- P0 scope: farms/personas/issues/entitlements/audit (+ existing entities).
-- Later phases extend this file; migrations run in order under db/migrations/.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS timescaledb;

-- G0.1b identity -------------------------------------------------------------
CREATE TABLE users (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        TEXT NOT NULL,
  email       TEXT UNIQUE NOT NULL,
  password_hash TEXT,                          -- bcrypt/argon2 (plaintext only in dev seed)
  locale      TEXT NOT NULL DEFAULT 'ar',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE user_personas (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID REFERENCES users(id),
  persona    TEXT CHECK (persona IN ('admin','owner','agri_expert','moderator','worker',
                                     'accountant','learner','crowd_expert','academic_expert')),
  status     TEXT CHECK (status IN ('active','pending_verification','suspended'))
             NOT NULL DEFAULT 'pending_verification',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, persona)
);

-- Tenancy --------------------------------------------------------------------
CREATE TABLE farms (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  owner_id   UUID REFERENCES users(id),
  name       TEXT NOT NULL,
  center_lat DOUBLE PRECISION,
  center_lng DOUBLE PRECISION,
  boundary   JSONB,
  metadata   JSONB,                            -- extensibility rule (F4a)
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE farm_members (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  farm_id     UUID REFERENCES farms(id),
  user_id     UUID REFERENCES users(id),
  role_in_farm TEXT CHECK (role_in_farm IN ('owner','moderator','worker','accountant')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (farm_id, user_id)
);

-- Existing operational entities (migrated from Firestore / memory store) ------
CREATE TABLE tasks (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  farm_id         UUID REFERENCES farms(id),
  title           TEXT NOT NULL,
  description     TEXT,
  lat             DOUBLE PRECISION,
  lng             DOUBLE PRECISION,
  status          TEXT CHECK (status IN ('assigned','in_progress','submitted','approved','rejected')),
  assignee_id     UUID REFERENCES users(id),
  worker_id       UUID REFERENCES users(id),
  before_photo_url TEXT, after_photo_url TEXT,
  before_photo_lat DOUBLE PRECISION, before_photo_lng DOUBLE PRECISION,
  after_photo_lat  DOUBLE PRECISION, after_photo_lng  DOUBLE PRECISION,
  review_note     TEXT,
  created_at      TIMESTAMPTZ DEFAULT now(),
  started_at TIMESTAMPTZ, submitted_at TIMESTAMPTZ, reviewed_at TIMESTAMPTZ
);

-- G0.2 universal workflow ------------------------------------------------------
CREATE TABLE issues (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  farm_id    UUID REFERENCES farms(id),
  kind       TEXT NOT NULL,                    -- water_leak|panel_cleaning|pest|equipment|general
  stage      TEXT CHECK (stage IN ('detected','inspected','identified','recommended',
                                   'implemented','reviewed','closed')),
  source     TEXT CHECK (source IN ('sensor_rule','human_report','ai_detection')),
  title      TEXT NOT NULL,
  severity   TEXT CHECK (severity IN ('low','medium','high','critical')),
  task_id    UUID REFERENCES tasks(id),        -- IMPLEMENTED gate link
  created_by UUID REFERENCES users(id),
  closed_at  TIMESTAMPTZ,
  metadata   JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Hot query: open issues per farm (board).
CREATE INDEX idx_issues_open ON issues (farm_id, stage) WHERE stage <> 'closed';

CREATE TABLE issue_events (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  issue_id   UUID REFERENCES issues(id),
  from_stage TEXT, to_stage TEXT,
  actor_id   UUID REFERENCES users(id),
  actor_role TEXT,
  note       TEXT,
  evidence   JSONB,                            -- photo URLs, GPS, readings…
  at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Entitlements (SUBSCRIPTION_AND_PAYMENTS_DESIGN §1–3) -------------------------
CREATE TABLE plans (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code        TEXT UNIQUE NOT NULL,
  name        TEXT NOT NULL,
  monthly_egp NUMERIC(10,2) NOT NULL DEFAULT 0,
  metadata    JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE plan_features (
  plan_id    UUID REFERENCES plans(id),
  feature_key TEXT CHECK (feature_key IN ('water_iot','solar_iot','chat_translation',
                                         'video_platform','robot_integration','marketplace','reports')),
  enabled    BOOLEAN NOT NULL DEFAULT false,
  limits     JSONB,                            -- e.g. {provider:'deepl', monthlyChars:100000}
  PRIMARY KEY (plan_id, feature_key)
);

CREATE TABLE subscriptions (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  farm_id      UUID REFERENCES farms(id),
  plan_id      UUID REFERENCES plans(id),
  status       TEXT CHECK (status IN ('trial','active','past_due','cancelled')),
  period_start TIMESTAMPTZ NOT NULL,
  period_end   TIMESTAMPTZ NOT NULL,
  auto_renew   BOOLEAN DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_subs_active ON subscriptions (farm_id, status);

CREATE TABLE payments (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  payer_user_id    UUID REFERENCES users(id),
  subscription_id  UUID REFERENCES subscriptions(id),
  amount_egp       NUMERIC(10,2) NOT NULL,
  method           TEXT CHECK (method IN ('manual','visa','mastercard')),
  gateway_ref      TEXT,                       -- idempotency anchor for webhooks (P6)
  bank_confirmed_at TIMESTAMPTZ,
  note             TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Cross-cutting -----------------------------------------------------------------
CREATE TABLE audit_log (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor_id    UUID REFERENCES users(id),
  persona     TEXT NOT NULL,                   -- WHICH persona acted (G0.1b)
  action      TEXT NOT NULL,
  target_type TEXT, target_id TEXT,
  detail      JSONB
);

CREATE TABLE feature_flags (
  key     TEXT NOT NULL,
  farm_id UUID REFERENCES farms(id),            -- NULL = global
  enabled BOOLEAN NOT NULL,
  PRIMARY KEY (key, farm_id)
);

-- Future-phase placeholders created NOW to lock naming conventions:
-- devices, telemetry (hypertable), valve_commands, water_tariffs, weather_cache,
-- panels, daily_panel_reports, report_archive, conversations, messages,
-- videos, video_annotations, schedules, trees, tree_events, species,
-- expert_profiles, expert_verifications, consultations, consultation_responses.
-- DDL lands with each phase (EVOLUTION_PLAN §2 keeps the full sketch).
