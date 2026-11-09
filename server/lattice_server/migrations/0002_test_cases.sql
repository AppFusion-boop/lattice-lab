CREATE TABLE test_cases (
  id TEXT PRIMARY KEY,
  study_id TEXT NOT NULL REFERENCES studies(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  description TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT 'custom' CHECK (category IN ('benchmark', 'corner_case', 'boundary', 'regression', 'nominal', 'custom')),
  parameters_json TEXT NOT NULL DEFAULT '{}',
  expected_outcomes_json TEXT NOT NULL DEFAULT '{}',
  last_run_status TEXT NOT NULL DEFAULT 'untested' CHECK (last_run_status IN ('untested', 'passed', 'failed', 'error')),
  last_run_at TEXT,
  last_run_outputs_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_test_cases_study ON test_cases(study_id, created_at);

CREATE TABLE test_case_runs (
  id TEXT PRIMARY KEY,
  study_id TEXT NOT NULL REFERENCES studies(id) ON DELETE CASCADE,
  model_version_id TEXT REFERENCES model_versions(id),
  total_count INTEGER NOT NULL,
  passed_count INTEGER NOT NULL,
  failed_count INTEGER NOT NULL,
  duration_ms REAL NOT NULL,
  results_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL
);

CREATE INDEX idx_test_case_runs_study ON test_case_runs(study_id, created_at);

INSERT INTO schema_version VALUES (2);
