# Pandora Memory evidence-candidate activation release manifest

Status: **ATOMIC SUCCESSOR / BLOCKED**. This is a source-only, draft successor.
It does not authorize merge, database migration, Edge deployment, evidence
submission, canonical promotion, production verification, or PXE-0008 closure.

## Exact boundary and current production state

- Repository/base: `banataosystems/pandoras-box-memory` at
  `478105057c1ca5fb5b356750ba1fa1fb58b1f42c`.
- Production Supabase project, unchanged: `ivmvufhcsezyhczzondn`.
- Live function, unchanged: `pandora-projectos-bridge@15`, function ID
  `0e7e24e6-7cb7-46d0-b474-3d626898d7e6`, package SHA-256
  `7d2388c4c101ea3ca023e7c354aa5e08e7e02c49db5d51baf752ef27debfcb0a`.
- Recoverable live v15 source: commit
  `523fec111bfb2c327f69c2abdf0784775ab49a90`, Git blob
  `07ebf082e15867faae27c74ce9c1074d466e7f08`, raw SHA-256
  `7cdb0e6a2ae74a6ea970ba537f8ff04c64cfd2c608e8b8e6c4a394dcff8d07cf`.
- Memory Vercel production, unchanged: deployment
  `dpl_7d7WTrvGvrv8cC9ZMrCc59qmDUUk`, exact base Git SHA above.
- Principal/scopes, unchanged: `projectos-mcpmaster-production` with only
  `memory:health` and `memory:read`.
- Governed test-candidate hash:
  `0fcacb20c0ff46ca224ca1769098ac3db14bb83d9bb264b755c23a58f2382e78`.

Issue `banataosystems/pandoras-box-memory#56` records predecessor-only
authorization. **Issue #56 does not authorize this successor.** Fresh owner
authorization must use
`memory-evidence-atomic-successor-exact-artifact-authorization`, bind the final
head/tree, exact artifacts, and an independent PASS, and record
`issue_56_authorizes_successor=false`.

The separately authorized production activation must use the exact activation
ID `memory-evidence-atomic-successor-prod-activation-20260821`.

## Exact successor artifacts

| Artifact | SHA-256 | Git blob | Bytes |
|---|---|---|---:|
| Bridge `supabase/functions/pandora-projectos-bridge/index.ts` | `383c1cac600f0381aba21fe492bc5d04777a91e361ba5bd2ac0e088449103d83` | `2a056ec4997d7daeeed797a2eb89e9c75c25b8f3` | 39,055 |
| Import map `supabase/functions/pandora-projectos-bridge/deno.json` | `5089831e8691c1b4183e7d5f5c0703ca861d4bb46d5fc7f8dbee0c0f76d3a88b` | `a4c2351c4bc2d8f41937fe05690f6fd72f3ebbf7` | 119 |
| Historical read-only marker `20260820113000_enable_projectos_evidence_candidate_write_scope.sql` | `9e48d386d445e0cda489893a7667968404fef8da7c64c22aaf6639aa047fc515` | `d236434d384914a5af0d73ff73745ad6bc1dd217` | 4,563 |
| Atomic boundary `20260821160000_submit_projectos_evidence_candidate_atomic.sql` | `ed97a4254879c1acea18a08aefa3dce0612339bdf1b55dc64df015aa3479af81` | `d83e77608c4e6c2dbd2fa59e9dd778c5852a8d1e` | 47,878 |
| Sole scope activation `20260821163000_forward_reactivate_projectos_evidence_candidate_write_scope.sql` | `f40060e7bb5a7e79cbb8122369d1cd8da6d68f2b68bedbe298b6fbd888ae49c6` | `ee5debe1544a962aee33780a6567f81aad3a7611` | 22,970 |
| Scope rollback `supabase/recovery/20260821_disable_projectos_evidence_candidate_write_scope_forward_recovery.sql` | `a9ab3376e1dca1b795c5a2d9184ae4626e4e30e554a3c70c6a829276da34d773` | `7933c37e47e96e60173d01afd8772b68a90b3809` | 15,011 |

The Edge runtime type import is pinned to
`jsr:@supabase/functions-js@2.110.9/edge-runtime.d.ts`; the Supabase client is
pinned to `npm:@supabase/supabase-js@2.110.9`; JOSE is pinned to
`npm:jose@5.10.0`. No floating bridge dependency is claimed.

## Repair contract

The historical `20260820113000` source migration is deliberately read-only: it
does not widen the scope constraint, grant `memory:write`, or synthesize an
activation audit. The `20260821160000` migration installs the service-role-only
transactional RPC, exact-key index, reserved-row provenance triggers, immutable
governance-audit triggers, exhaustive ACL reset, and durable privacy boundary
while the principal remains read-only. The `20260821163000` migration is the
sole truthful read-to-write transition and requires an exact successor
authorization plus exact owner/ACL/index/trigger/principal/project/grant/hash
readback.

The RPC creates exactly one candidate, one `pending_review` item, and one
immutable audit in the same transaction. It rejects forged pre-seeds, changed
idempotent content, direct reserved writes, mutation/truncation, percent,
HTML/numeric-entity, Unicode/hex-escape, and zero-width obfuscation; recursive
whole, embedded, whitespace/punctuation-split base64/data-URL payloads; bounded
person-name, labelled birth-date/phone/government/financial identifier corpora;
and secrets/credentials. Three exact safe technical phrases remain usable. It
never writes canonical Memory.

Predecessor activation/deactivation audits are preserved as untrusted history
because hosted records may already exist. They are made prospectively immutable
and are never consulted for deduplication, successor authorization, or successor
activation. Any pre-existing row claiming the successor activation or rollback
ID blocks boundary installation for explicit reconciliation.

## Evidence-artifact bindings

| Evidence/check artifact | SHA-256 |
|---|---|
| `scripts/check_memory_evidence_activation.mjs` | `bfa883a77fc95d86e8fd2aab4cc366e86c114ea8bafd212dbc6cbbdbb31f8892` |
| `.github/workflows/memory-evidence-intake.yml` | `d18efe0fedc89d25b9fd421f034bd51701e587fcbb64b430178276236a2254f5` |
| `docs/capabilities/evidence/MEMORY_BRIDGE_EXACT_SOURCE_REPAIR_CANDIDATE_2026-08-21.json` | `ca768a497f758a147960e9ee943bbff84f5e1d8cbc99c912b85d1b20b6ac2f8f` |
| `scripts/check_memory_bridge_repair_candidate.mjs` | `a59a9d08b069ad4f1a0486d3e213ba17169c93d6cf9c8c00bb6c8d17c5453cc6` |
| `docs/capabilities/evidence/MEMORY_BRIDGE_ATOMIC_INTAKE_SUCCESSOR_CANDIDATE_2026-08-21.json` | `d10307f30e8e0c96b2c4b6d1dd0e437d34d617bfab27e4bf871cf0bd74c71e67` |
| `scripts/test_memory_evidence_atomic_rpc.sh` | `c3897e58f1a6c775bae0f56ab8ee9cf701021eb6d4829bc7eed67c10988ac30d` |
| `recovery/evidence/memory-evidence-intake-atomic-successor-manifest.md` | `ca0861a64a6fdcdc9484fcf66840fe0fda674724b2a99af86d2e3027e666bac4` |

## Hard release gates

Migration parity remains RED: 69 hosted versions, 19 successor source versions,
15 matches, 54 hosted-only, and four local-only. No hosted migration-history
mutation is authorized. Release remains blocked until all of the following are
bound to the same final head/tree:

1. exact-head PostgreSQL, Deno, source/behavior, secret, dependency, typecheck,
   and build CI success under the unique `memory-evidence-intake` job;
2. fresh independent qualified review with no unresolved blocker;
3. fresh exact-artifact owner authorization distinct from issue #56;
4. hosted/local migration reconciliation and a transaction-only nonproduction
   rehearsal with exact rollback/readback;
5. fresh provider-native readback immediately before any separately authorized
   execution; and
6. rehearsed content-addressed v15 restoration plus qualified scope rollback.

## Separately authorized activation order

Only after every hard gate:

1. Apply `supabase/migrations/20260821160000_submit_projectos_evidence_candidate_atomic.sql` first and read back the exact owner, ACL, index, triggers, and read-only scopes.
2. Insert/read back the immutable exact successor authorization bound to the final head/tree, review, and artifact hashes.
3. Apply `supabase/migrations/20260821163000_forward_reactivate_projectos_evidence_candidate_write_scope.sql` second and read back the sole truthful activation and exact write-scoped principal.
4. Deploy/read back only bridge SHA-256 `383c1cac600f0381aba21fe492bc5d04777a91e361ba5bd2ac0e088449103d83` with the exact import map.
5. Submit at most the separately authorized governed candidate and verify one pending candidate, one pending review item, one immutable audit, and `canonical_memory_written=false`.

No automatic canonical Memory promotion is authorized.

## Rollback order

1. Restore the content-addressed live v15 source and verify exact raw files.
2. Run the successor scope rollback exactly once; preserve activation and pending-candidate history.
3. Verify only `memory:health` and `memory:read`, health/search continuity, and fail-closed evidence submission.

PXE-0008 remains **FAIL/HOLD**. This manifest does not close it.
