PRAGMA foreign_keys = OFF;

CREATE TABLE parameters_new (
  id TEXT PRIMARY KEY,
  study_id TEXT NOT NULL REFERENCES studies(id),
  key TEXT NOT NULL,
  label TEXT NOT NULL,
  unit TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL CHECK (kind IN ('continuous','integer','categorical')),
  role TEXT NOT NULL CHECK (role IN ('controlled','uncertain','fixed','dependent')),
  spec_json TEXT NOT NULL,
  position INTEGER NOT NULL,
  UNIQUE (study_id, key)
);

INSERT INTO parameters_new (id, study_id, key, label, unit, kind, role, spec_json, position)
SELECT id, study_id, key, label, unit, kind, role, spec_json, position FROM parameters;

DROP TABLE parameters;

ALTER TABLE parameters_new RENAME TO parameters;

PRAGMA foreign_keys = ON;

INSERT INTO schema_version VALUES (3);
