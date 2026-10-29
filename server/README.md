# Lattice Server

Statistical calculation engine, database persistence, and REST API for Lattice Lab.

## Example studies (first-run seed)

A new database starts with five worked example studies (Tunnel Blast, Microchannel Cold Plate,
Cement Skyscraper, Emulsion/Microcapsule microscopy, Hair Cuticle wear microscopy). They are
applied on server start by `lattice_server/examples.py` from the generated bundle
`lattice_server/seeds/example_studies.sql`.

- **Idempotent and insert-only.** A study that already exists is skipped entirely, so restarts and
  existing databases are unaffected. It never deletes or edits anything; an example a user archives
  stays archived.
- **Clearly illustrative.** Every example description ends with "Example values — replace with your
  own." and seeded evidence notes say it is an illustrative record.
- **Opt out:** set `LATTICE_SEED_EXAMPLES=0` (tests do this by default).
- **Regenerate the bundle** from a local database (read-only; a scratch copy is used for any
  recomputation): `uv run python scripts/export_example_seed.py [--source ../data/lattice.sqlite]`.
  Review the diff before committing; the file is generated and must not be edited by hand.
