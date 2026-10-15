CREATE TABLE schema_version (version INTEGER NOT NULL);

CREATE TABLE studies (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  description TEXT NOT NULL DEFAULT '',
  domain TEXT NOT NULL DEFAULT 'generic',
  exclusion_threshold REAL NOT NULL DEFAULT 0.05 CHECK (exclusion_threshold > 0 AND exclusion_threshold < 1),
  confidence REAL NOT NULL DEFAULT 0.95 CHECK (confidence >= 0.5 AND confidence < 1),
  cost_expression TEXT,
  budget REAL,
  max_engine_evaluations INTEGER NOT NULL DEFAULT 50000,
  settings_json TEXT NOT NULL DEFAULT '{}',
  rng_seed INTEGER NOT NULL,
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE parameters (
  id TEXT PRIMARY KEY,
  study_id TEXT NOT NULL REFERENCES studies(id),
  key TEXT NOT NULL,
  label TEXT NOT NULL,
  unit TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL CHECK (kind IN ('continuous','integer','categorical')),
  role TEXT NOT NULL CHECK (role IN ('controlled','uncertain','fixed')),
  spec_json TEXT NOT NULL,
  position INTEGER NOT NULL,
  UNIQUE (study_id, key)
);

CREATE TABLE outcomes (
  id TEXT PRIMARY KEY,
  study_id TEXT NOT NULL REFERENCES studies(id),
  key TEXT NOT NULL,
  label TEXT NOT NULL,
  unit TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL CHECK (kind IN ('continuous','binary')),
  direction TEXT NOT NULL DEFAULT 'none' CHECK (direction IN ('minimize','maximize','none')),
  criterion_json TEXT,
  position INTEGER NOT NULL,
  UNIQUE (study_id, key)
);

CREATE TABLE sources (
  id TEXT PRIMARY KEY,
  study_id TEXT NOT NULL REFERENCES studies(id),
  kind TEXT NOT NULL CHECK (kind IN ('field','lab','literature','simulation','expert','import')),
  citation TEXT NOT NULL DEFAULT '',
  doi TEXT, url TEXT, file_name TEXT, file_sha256 TEXT,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE constraints (
  id TEXT PRIMARY KEY,
  study_id TEXT NOT NULL REFERENCES studies(id),
  label TEXT NOT NULL,
  expression TEXT NOT NULL CHECK (length(expression) <= 500),
  kind TEXT NOT NULL CHECK (kind IN ('hard','soft')),
  penalty REAL,
  rationale TEXT NOT NULL CHECK (length(rationale) >= 3),
  source_id TEXT REFERENCES sources(id),
  enabled INTEGER NOT NULL DEFAULT 1,
  position INTEGER NOT NULL
);

CREATE TABLE model_versions (
  id TEXT PRIMARY KEY,
  study_id TEXT NOT NULL REFERENCES studies(id),
  version INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('flow','none')),
  project_json TEXT,
  parameter_bindings_json TEXT NOT NULL DEFAULT '[]',
  outcome_bindings_json TEXT NOT NULL DEFAULT '[]',
  engine_version TEXT,
  signature TEXT,
  validation_status TEXT NOT NULL DEFAULT 'unvalidated'
    CHECK (validation_status IN ('unvalidated','validated','failed')),
  validation_json TEXT,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  UNIQUE (study_id, version)
);

CREATE TABLE candidate_sets (
  id TEXT PRIMARY KEY,
  study_id TEXT NOT NULL REFERENCES studies(id),
  method TEXT NOT NULL CHECK (method IN ('grid','lhs','sobol','imported')),
  settings_json TEXT NOT NULL,
  parameters_hash TEXT NOT NULL,
  count INTEGER NOT NULL,
  active INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE candidates (
  id TEXT PRIMARY KEY,
  candidate_set_id TEXT NOT NULL REFERENCES candidate_sets(id),
  idx INTEGER NOT NULL,
  label TEXT,
  values_json TEXT NOT NULL,
  values_hash TEXT NOT NULL,
  UNIQUE (candidate_set_id, idx)
);
CREATE INDEX candidates_hash ON candidates(values_hash);

CREATE TABLE run_sheets (
  id TEXT PRIMARY KEY,
  study_id TEXT NOT NULL REFERENCES studies(id),
  screening_run_id TEXT,
  seed INTEGER NOT NULL,
  rows_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE evidence (
  id TEXT PRIMARY KEY,
  study_id TEXT NOT NULL REFERENCES studies(id),
  kind TEXT NOT NULL CHECK (kind IN ('field','lab','literature','simulation','expert')),
  source_id TEXT REFERENCES sources(id),
  values_json TEXT NOT NULL,
  outcomes_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'valid' CHECK (status IN ('valid','failed_run','outlier')),
  status_reason TEXT,
  candidate_id TEXT,
  run_sheet_id TEXT REFERENCES run_sheets(id),
  replicate INTEGER,
  supersedes_id TEXT REFERENCES evidence(id),
  recorded_at TEXT,
  recorded_by TEXT NOT NULL DEFAULT 'local-user',
  notes TEXT NOT NULL DEFAULT '',
  retracted_at TEXT,
  retraction_reason TEXT,
  created_at TEXT NOT NULL,
  CHECK (status = 'valid' OR status_reason IS NOT NULL)
);
CREATE INDEX evidence_study ON evidence(study_id, created_at);

-- Immutability: evidence is never deleted; only a one-time retraction is allowed.
CREATE TRIGGER evidence_no_delete BEFORE DELETE ON evidence
BEGIN SELECT RAISE(ABORT, 'evidence is immutable'); END;

CREATE TRIGGER evidence_only_retract BEFORE UPDATE ON evidence
WHEN NOT (
  OLD.retracted_at IS NULL AND NEW.retracted_at IS NOT NULL AND NEW.retraction_reason IS NOT NULL
  AND NEW.id = OLD.id AND NEW.study_id = OLD.study_id AND NEW.kind = OLD.kind
  AND NEW.values_json = OLD.values_json AND NEW.outcomes_json = OLD.outcomes_json
  AND NEW.status = OLD.status AND IFNULL(NEW.source_id,'') = IFNULL(OLD.source_id,'')
  AND IFNULL(NEW.supersedes_id,'') = IFNULL(OLD.supersedes_id,'')
  AND NEW.created_at = OLD.created_at
)
BEGIN SELECT RAISE(ABORT, 'evidence is immutable; create a superseding record'); END;

CREATE TABLE screening_runs (
  id TEXT PRIMARY KEY,
  study_id TEXT NOT NULL REFERENCES studies(id),
  candidate_set_id TEXT NOT NULL REFERENCES candidate_sets(id),
  model_version_id TEXT REFERENCES model_versions(id),
  evidence_fingerprint TEXT NOT NULL,
  settings_json TEXT NOT NULL,
  summary_json TEXT NOT NULL,
  job_id TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE decisions (
  screening_run_id TEXT NOT NULL REFERENCES screening_runs(id),
  candidate_id TEXT NOT NULL REFERENCES candidates(id),
  status TEXT NOT NULL CHECK (status IN ('open','excluded','deprioritised','recommended','tested_pass','tested_fail')),
  filter TEXT NOT NULL,
  p_hat REAL, p_upper REAL,
  reason TEXT NOT NULL,
  details_json TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY (screening_run_id, candidate_id)
);
CREATE INDEX decisions_status ON decisions(screening_run_id, status);

CREATE TABLE overrides (
  id TEXT PRIMARY KEY,
  study_id TEXT NOT NULL REFERENCES studies(id),
  values_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open','excluded','deprioritised','recommended')),
  reason TEXT NOT NULL CHECK (length(reason) >= 3),
  created_by TEXT NOT NULL DEFAULT 'local-user',
  created_at TEXT NOT NULL,
  revoked_at TEXT
);

CREATE TABLE analyses (
  id TEXT PRIMARY KEY,
  study_id TEXT NOT NULL REFERENCES studies(id),
  kind TEXT NOT NULL CHECK (kind IN ('morris','sobol','validation','backtest','tost','power')),
  model_version_id TEXT REFERENCES model_versions(id),
  input_json TEXT NOT NULL,
  result_json TEXT NOT NULL,
  job_id TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE jobs (
  id TEXT PRIMARY KEY,
  study_id TEXT REFERENCES studies(id),
  kind TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued','running','done','failed','cancelled')),
  progress REAL NOT NULL DEFAULT 0,
  message TEXT NOT NULL DEFAULT '',
  input_json TEXT NOT NULL,
  result_json TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT
);

CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  study_id TEXT,
  at TEXT NOT NULL,
  actor TEXT NOT NULL DEFAULT 'local-user',
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT,
  details_json TEXT NOT NULL DEFAULT '{}'
);
CREATE TRIGGER audit_no_delete BEFORE DELETE ON audit_log
BEGIN SELECT RAISE(ABORT, 'audit log is append-only'); END;
CREATE TRIGGER audit_no_update BEFORE UPDATE ON audit_log
BEGIN SELECT RAISE(ABORT, 'audit log is append-only'); END;

INSERT INTO schema_version VALUES (1);
