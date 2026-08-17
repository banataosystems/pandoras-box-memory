# Recovered live migration evidence

**This directory is recovery evidence, not active migrations.**

Files here are historical SQL recovered from the provider's
`supabase_migrations.schema_migrations` table for migrations that were applied to
production but have no canonical source in `supabase/migrations/`.

Rules:

- **Nothing here is ever replayed.** These migrations are already applied in
  production. `supabase db push` must never see them, which is why they live
  outside `supabase/migrations/`.
- **Every file is hash-verified** against
  `docs/migrations/LIVE_MIGRATION_LEDGER_2026-08-17.json` before being written.
- **Every file states its own authenticity** — whether it is the original file
  text the provider retained, or authentic statements whose file framing was
  reconstructed.
- **No file may contain direct identifiers or credentials.**
  `scripts/recover_live_migrations.mjs` refuses to write content that trips its
  privacy scan; such migrations must be sanitized by hand and classified as
  `sanitized` in the parity manifest.

Populate with:

```bash
node scripts/recover_live_migrations.mjs --input export.json --write
```

See `docs/migrations/MIGRATION_RECOVERY.md`.
