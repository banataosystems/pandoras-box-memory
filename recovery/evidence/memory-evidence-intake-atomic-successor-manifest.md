# Pandora Memory atomic evidence-intake successor manifest

Status: **SOURCE-ONLY SUCCESSOR / BLOCKED**. This draft-only candidate repairs
the concrete PR #55 intake defects. It does not authorize merge, Supabase
migration, Edge deployment, candidate submission, canonical Memory promotion,
or PXE-0008 closure.

## Exact lineage and boundary

- Repository: `banataosystems/pandoras-box-memory`
- Canonical base: `478105057c1ca5fb5b356750ba1fa1fb58b1f42c`
- Canonical base tree: `fb4909bd962ddf32df3a63fbd46c136d7b3d9d88`
- Successor branch: `fix/memory-evidence-intake-atomic-successor-20260821`
- Production project, unchanged: `ivmvufhcsezyhczzondn`
- Live bridge, unchanged: `pandora-projectos-bridge@15`
- Exact principal: `projectos-mcpmaster-production`
- Exact namespace/project: `real_life` /
  `7c686cbd-d968-49d5-86cc-918f5e777bd2` /
  `mcpmaster-pandoras-box`

PRs #55 and #57, production principal scopes, the hosted migration ledger,
Vercel, Supabase Edge Functions, and all Memory rows remain unchanged.

Issue #56 records predecessor-only authorization. It does not authorize this
successor. Any eventual authorization must use
`memory-evidence-atomic-successor-exact-artifact-authorization`, bind the exact
final head/tree and independent PASS, and explicitly record
`issue_56_authorizes_successor=false`.

## Defects repaired

1. Candidate, `pending_review` item, and immutable audit are created by one
   SECURITY DEFINER PostgreSQL RPC transaction. Failure at any stage rolls back
   all three rows; identical replays deduplicate and changed content conflicts.
2. Authenticated and service-role direct inserts, updates, deletes, benign-row
   relabels, and truncation cannot forge or erase the reserved ProjectOS
   lifecycle. Three exact row triggers bind reserved writes to the database
   owner of the RPC. All seven DB-boundary functions are reassigned to the
   migration owner, stale function ACLs are stripped, and only service_role gets
   non-grantable RPC EXECUTE.
3. The durable RPC independently validates canonical evidence/provenance shapes
   and rejects a bounded corpus of plain, contextual, all-caps, and Unicode
   person names; labelled common birth-date formats; formatted phones;
   addresses; secrets; credentials; percent, HTML/numeric-entity, Unicode/hex
   escape, and zero-width obfuscation; and recursive whole, embedded,
   whitespace/punctuation-split base64/data-URL payloads. Three exact technical
   phrases are accepted as non-person artifacts. Bridge and RPC use the same
   fail-closed v3 policy and regression corpus.
4. Historical migration
   `20260820113000_enable_projectos_evidence_candidate_write_scope.sql` is an
   explicit read-only superseded marker. It never widens the constraint, grants
   `memory:write`, or emits activation evidence.
5. `20260821160000_submit_projectos_evidence_candidate_atomic.sql` installs the
   atomic DB boundary while the principal remains read-only.
6. `20260821163000_forward_reactivate_projectos_evidence_candidate_write_scope.sql`
   performs the sole truthful read-to-write transition only after exact owner,
   ACL, trigger, index, privacy, principal, grant, authorization, and historical
   ledger readback. It writes one before-not-equal-after activation audit.
7. Activation, deactivation, successor authorization, and atomic lifecycle
   audits all reject service_role UPDATE and DELETE. Rollback restores read-only
   scope and writes a separately immutable truthful deactivation audit.

## Exact source artifacts

| Artifact | SHA-256 | Git blob | Bytes |
|---|---|---|---:|
| `supabase/functions/pandora-projectos-bridge/index.ts` | `383c1cac600f0381aba21fe492bc5d04777a91e361ba5bd2ac0e088449103d83` | `2a056ec4997d7daeeed797a2eb89e9c75c25b8f3` | 39,055 |
| `supabase/functions/pandora-projectos-bridge/deno.json` | `5089831e8691c1b4183e7d5f5c0703ca861d4bb46d5fc7f8dbee0c0f76d3a88b` | `a4c2351c4bc2d8f41937fe05690f6fd72f3ebbf7` | 119 |
| `supabase/migrations/20260820113000_enable_projectos_evidence_candidate_write_scope.sql` | `9e48d386d445e0cda489893a7667968404fef8da7c64c22aaf6639aa047fc515` | `d236434d384914a5af0d73ff73745ad6bc1dd217` | 4,563 |
| `supabase/migrations/20260821160000_submit_projectos_evidence_candidate_atomic.sql` | `ed97a4254879c1acea18a08aefa3dce0612339bdf1b55dc64df015aa3479af81` | `d83e77608c4e6c2dbd2fa59e9dd778c5852a8d1e` | 47,878 |
| `supabase/migrations/20260821163000_forward_reactivate_projectos_evidence_candidate_write_scope.sql` | `f40060e7bb5a7e79cbb8122369d1cd8da6d68f2b68bedbe298b6fbd888ae49c6` | `ee5debe1544a962aee33780a6567f81aad3a7611` | 22,970 |
| `supabase/recovery/20260821_disable_projectos_evidence_candidate_write_scope_forward_recovery.sql` | `a9ab3376e1dca1b795c5a2d9184ae4626e4e30e554a3c70c6a829276da34d773` | `7933c37e47e96e60173d01afd8772b68a90b3809` | 15,011 |

The bridge dependencies are exact: Edge runtime types use
`jsr:@supabase/functions-js@2.110.9/edge-runtime.d.ts`, the import map uses
`npm:@supabase/supabase-js@2.110.9`, and JOSE uses `npm:jose@5.10.0`.
Exact-head CI performs a full Deno module check in addition to the isolated
behavior harness.

## Required exact-head proof

The disposable PostgreSQL 17 runner proves:

- zero-to-head ordering checkpoints with no write before the atomic boundary;
- wrong-key and wrong-predicate same-name index rejection;
- stale low-role function owner and custom EXECUTE ACL repair;
- authenticated and service_role preseed/relabel/truncate rejection;
- direct service_role RPC privacy rejection, including whole, embedded, and
  1/2/3-character whitespace- and punctuation-split base64; data URL; percent,
  HTML/numeric-entity, Unicode/hex-escape, and zero-width text; quoted secret;
  artifact-prefix, all-caps, and Unicode names; common labelled DOB
  formats; formatted phone; and idempotency-key attacks;
- acceptance of the exact safe technical-name corpus without weakening the
  remainder-of-string person-name checks;
- an explicit unique disposable PostgreSQL database identity before any schema
  reset, plus refusal without the opt-in marker;
- identical replay, conflict, eight-way concurrency, review failure, and audit
  failure behavior;
- exact one-candidate/one-review/one-audit postcondition;
- immutable atomic, authorization, activation, and deactivation audits;
- truthful activation and rollback transitions; and
- preservation, but non-trust, of predecessor hosted audit history. Those
  historical rows are never consulted for deduplication, authorization, or the
  successor activation; rows claiming successor activation/rollback IDs are
  rejected before boundary installation.

Source evidence still reports migration parity RED: 69 hosted versions, 19
successor source versions, 15 matching, 54 hosted-only, and four local-only.
No hosted migration history mutation is authorized. Provider reconciliation,
clean replay, a transaction-only hosted rehearsal, and fresh exact-head
independent review remain hard gates.

## Activation and rollback order

If separately authorized after every gate:

1. Apply and read back
   `supabase/migrations/20260821160000_submit_projectos_evidence_candidate_atomic.sql`.
2. Insert/read back the exact immutable successor authorization bound to final
   head/tree, review, bridge, import map, atomic migration, forward migration,
   and rollback hashes.
3. Apply and read back
   `supabase/migrations/20260821163000_forward_reactivate_projectos_evidence_candidate_write_scope.sql`.
4. Deploy/read back only bridge SHA-256
   `383c1cac600f0381aba21fe492bc5d04777a91e361ba5bd2ac0e088449103d83`.

Rollback order remains content-addressed and fail-closed: restore verified live
v15 SHA-256
`7cdb0e6a2ae74a6ea970ba537f8ff04c64cfd2c608e8b8e6c4a394dcff8d07cf`,
then run the successor scope rollback, then verify exact read-only scopes,
health/search continuity, and rejected evidence submission. Pending candidates
are preserved; canonical Memory is never automatically promoted or deleted.

PXE-0008 remains FAIL/HOLD. This source candidate neither satisfies nor closes
that gate.
