# Migration history recovery

**Proof stage: `documented`.** The parity gate is `implemented` and `source_tested`.
Nothing here was replayed, applied, or mutated against production.

## The gap

| | Count |
| --- | --- |
| Migrations applied in production | **68** |
| Migrations present in `supabase/migrations` | **15** |
| Live migrations with no canonical source | **53** |

The project's capability registry already carries this as blocker
`live-migration-68-source-gap`. This lane does not close the gap by inventing
SQL. It closes the *provenance* gap: every one of the 68 is now classified,
content-addressed, and CI-enforced.

## What was actually recovered

The provider retains authentic SQL. `supabase_migrations.schema_migrations`
stores a `statements` array for every applied migration:

- **68 / 68** migrations retain statement text (542 statements, ~240 kB).
- **42 / 68** are single-element, meaning the provider retained the **whole
  original migration file text** verbatim.
- **26 / 68** are multi-element, meaning statements were parsed and split; the
  statement text is authentic but the original *file framing* is not recoverable.
- **0 / 68** carry rollback metadata. There is no provider-side down-migration
  for any applied migration.

## Parity result for committed source

Every one of the 15 committed migrations was hash-compared against the provider's
recorded statement content:

| Classification | Count | Meaning |
| --- | --- | --- |
| `authentic` | **14** | Committed source hashes exactly to what production ran. |
| `sanitized` | **1** | Deliberate, documented divergence. |
| `missing` | **53** | No source here. None fabricated. |

Trailing whitespace is normalized before comparison — the provider does not
store a consistent trailing newline, and that difference is not semantic.
Everything else is treated as a real difference.

### The one sanitized migration

`20260808220117_record_owner_env_admin_recovery_grant` differs from production
**on purpose**, and says so in its own header. Production additionally executed:

```sql
insert into private.pandora_recovery_auth_changes(user_id, change_type, details)
values ('<owner principal UUID>', 'grant_env_admin', ...);
```

That statement writes audit data about a specific principal. Its UUID is a
direct identifier and is intentionally kept out of public source. Schema and
privilege effects are fully preserved in the committed file.

This is recorded as `source_availability: "sanitized"` with an explicit
`divergence_reason` — not as `authentic` (which would be false) and not as
`missing` (which would be misleading).

## Why the 53 are not bulk-materialized

The authentic text exists at the provider and is content-addressed here, so
materializing it is mechanically trivial. It is **deliberately not automatic**,
for one reason: the sanitized migration above proves that live migration bodies
can embed direct identifiers. Copying all 68 into git would re-import precisely
the data that was deliberately removed from canonical source.

`scripts/recover_live_migrations.mjs` therefore:

1. hash-verifies every exported row against the committed ledger before writing;
2. runs a privacy scan (emails, JWTs, secret keys, private keys, principal UUIDs
   in `INSERT ... VALUES`) and **refuses** to write anything that trips it;
3. writes only into `supabase/recovery/live-migrations/`, never
   `supabase/migrations/`, so recovered material can never be replayed as a
   pending migration;
4. stamps each file with version, name, provider, observation time, SHA-256, and
   an explicit authenticity statement distinguishing *original file text* from
   *authentic statements with reconstructed framing*.

### Completing the recovery

```bash
# 1. Export (read-only; applies nothing):
#    select json_agg(json_build_object(
#      'version', version, 'sql', array_to_string(statements, E';\n')))
#    from supabase_migrations.schema_migrations;

node scripts/recover_live_migrations.mjs --input export.json          # dry run
node scripts/recover_live_migrations.mjs --input export.json --write  # materialize
npm run verify -- --only migrations
```

Anything the privacy scan blocks must be sanitized by hand and classified as
`sanitized` with a stated reason — the same treatment `20260808220117` received.

## What CI now enforces

`scripts/check_migration_parity.mjs` runs in `npm run verify` and fails if:

- a live migration is unaccounted for in the manifest;
- the manifest names a migration production never applied;
- a migration version is duplicated in source, in recovery, or in the manifest;
- a migration name drifts from the live ledger;
- a committed migration's content changes without the manifest being updated;
- a provider hash in the manifest diverges from the ledger;
- an entry claims `authentic` but does not hash to production's content;
- an entry claims `sanitized` while being byte-identical, or gives no reason;
- the same version appears in both active migrations and recovery evidence.

It never contacts the provider. The ledger is a committed, immutable observation;
refreshing it is a deliberate, reviewable act.

## Rollback posture

**No applied migration has rollback metadata at the provider.** Down-migrations
do not exist for any of the 68. Any rollback of a schema change must be authored
and reviewed as a new forward migration. This is a real, unresolved risk and is
recorded as such rather than papered over.

## Explicitly NOT proven

- That the 53 missing migrations can be replayed to reproduce the live schema.
  **They were not replayed.** Replaying them against production to manufacture
  parity was explicitly out of scope.
- That the recovered statement text for the 26 multi-statement migrations
  reproduces the original files. It reproduces the original *statements*.
- That any schema change is reversible. See rollback posture above.
