# Pandora Memory Supabase Source Parity & Recovery — 2026-08-19

## Scope

This evidence lane reconciles current read-only Supabase provider reality with canonical source without changing production. It supersedes the conclusions—but not the immutable historical artifact—of closed, unmerged PR #41.

## Current verified provider reality

- Project `ivmvufhcsezyhczzondn` is `Memory`, organization `lqvpjqbgfodmtswxizwf`, region `ap-southeast-2`, status `ACTIVE_HEALTHY`, PostgreSQL `17.6.1.147`.
- The default branch exact item is `c6231bc3-73fa-4a05-9558-61372df01bcf`, PostgreSQL 17 GA, `ACTIVE_HEALTHY`. The full branch list and current branch pricing are not freshly proven because the list body is blocked; no branch or cost was created.
- The live ordered migration identity list is exactly 68. Its compact payload is 5,018 bytes, SHA-256 `0d6110e17a01304eebb57cca57369f7b9b6961eb7a23b2c40871c8d90f5da0f3`, and reproduces provider ETag `W/"139a-Rb+o60KCJ/jLFibPKSwymerAMcU"` exactly.
- Source classification remains 14 exact/authentic, 1 sanitized, and 53 identity-known/source-missing. This proof does not invent SQL or qualify rollback.
- Three required Edge Functions are current and ACTIVE: bridge v13, learning v1, gateway v3. Their current provider hashes are in the observation. The complete function list and exact executable diffs remain blocked because list decoding and bundle fetch are unavailable.
- The security advisor baseline is 27: 21 RLS-enabled/no-policy INFO findings and six WARN findings (four mutable search paths, vector in public, leaked-password protection disabled). No warning was automatically repaired.

## Reconstruction answer

Pandora Memory is **partially reconstructable**, not fully reconstructable. Project identity, ordered migration identities, the three required Edge metadata identities, and current advisor summary are exact. Authentic historical SQL is still missing for 53 migrations; complete live Edge source, schema, grants, SECURITY DEFINER routines, triggers, event triggers, and scheduled jobs are not freshly captured.

## Recovery answer today

There is no evidence-qualified database rollback point. Recovery must preserve production data, restore exact source where available, capture a fresh catalog, and use independently reviewed forward recovery for unknown or irreversible state. An older web deployment alone is not a database rollback.

## Security interpretation

- RLS enabled with no policy may be intentional deny-all, but it cannot be accepted without direct privilege and RPC-path verification.
- The four mutable-search-path warnings remain real hardening findings; the historical transaction-only candidate remains unapplied.
- `vector` in `public` is an operational hardening finding, not permission to relocate it blindly.
- Leaked-password protection disabled is an Auth hardening gap that requires reviewed production policy change, not an automatic toggle.

## Proof boundaries

- **Documented:** this current provider observation and recovery matrix.
- **Implemented:** versioned evidence, recovery matrix, verifier, and dedicated workflow are prepared for the dedicated branch.
- **Tested:** the local Node 22 verifier passed 12 positive/negative cases; hosted exact-head CI remains required.
- **Deployed:** no production deployment is needed or authorized for parity documentation.
- **Production-verified:** project identity, migration identity/order, three required Edge metadata records, and security-advisor summary only. Full parity/reconstruction is not production-verified.

## Safety

No database/schema/data mutation, migration replay, Edge deployment, Supabase branch, new spending, Vercel production release, secret persistence, Worker 1 source change, merge, or production release occurred.
