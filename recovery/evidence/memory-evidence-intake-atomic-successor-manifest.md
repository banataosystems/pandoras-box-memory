# Pandora Memory atomic evidence-intake successor manifest

Status: **SOURCE-ONLY SUCCESSOR / BLOCKED**. This candidate repairs PR #55's
candidate/review atomicity defect. It does not authorize merge, migration,
deployment, evidence submission, canonical Memory promotion, or PXE-0008
closure.

## Lineage and scope

- Canonical repository: `banataosystems/pandoras-box-memory`
- Canonical base: `478105057c1ca5fb5b356750ba1fa1fb58b1f42c`
- Canonical base tree: `fb4909bd962ddf32df3a63fbd46c136d7b3d9d88`
- PR #55 source parent: `edb82476b2dfefef0e94ced1456b241f79caa889`
- PR #55 source parent tree: `18740e6a0691067a7c18def2e6623a625ff97b35`
- Successor branch: `fix/memory-evidence-intake-atomic-successor-20260821`
- Production target, when separately authorized: Supabase project
  `ivmvufhcsezyhczzondn`, function `pandora-projectos-bridge`
- Exact principal: `projectos-mcpmaster-production`
- Exact namespace/project: `real_life` /
  `7c686cbd-d968-49d5-86cc-918f5e777bd2` /
  `mcpmaster-pandoras-box`

PRs #55 and #57 remain unchanged. The production bridge, principal scopes,
Vercel deployment, hosted migration ledger, and Memory rows remain unchanged.

## Concrete defect repaired

PR #55 performs candidate and review-queue inserts as separate service-role
requests. If the second request fails, the pending candidate commits without a
review item or immutable intake audit. A later retry may heal that orphan, but
no retry is guaranteed. That violates the lifecycle atomicity gate.

The successor moves persistence into
`public.submit_projectos_evidence_candidate_atomic`. One PostgreSQL transaction:

1. revalidates the exact principal, namespace, project, sole proposal grant,
   write scope, and no approval capability;
2. computes the content fingerprint inside PostgreSQL;
3. inserts one `pending` candidate;
4. inserts its one `pending_review`, append-only review item;
5. inserts one metadata-only audit row with action
   `projectos_evidence_candidate_atomic_created`;
6. verifies the joined postcondition before returning; and
7. rolls back all three writes if any statement or postcondition fails.

The audit row has a unique candidate binding and a trigger that rejects UPDATE
or DELETE. Execute permission on the RPC is revoked from `PUBLIC`, `anon`, and
`authenticated`, and granted only to `service_role`. The RPC does not reference
`public.memory_items` or any canonical status.

The Edge Function performs validation and project/grant lookup, then makes one
RPC call. It no longer directly reads or writes `memory_capture_candidates` or
`memory_review_queue_items` in the evidence-intake path.

## Exact source artifacts

- Bridge `supabase/functions/pandora-projectos-bridge/index.ts`
  - SHA-256: `63c8d4ced312744933d8d036034f9796c7f043740d1f63301ee75ee11e691555`
  - Git blob SHA-1: `9adabe26f62205b0f94adc5744151c2d68c2c46e`
  - Bytes: 34,998
- Import map `supabase/functions/pandora-projectos-bridge/deno.json`
  - SHA-256: `ca096542a83daaeb67db79e8a5a66bb5ecdd9e0e773e99c5177cc366f0aacbaf`
  - Git blob SHA-1: `915cbeb478c0c52cc8be8f03cb307f4f72fed7d3`
  - Bytes: 113
- Atomic migration
  `supabase/migrations/20260821160000_submit_projectos_evidence_candidate_atomic.sql`
  - SHA-256: `1218cbb9f8d0748557e785b75561f79cd2a3140413c3c8872d0954acd9cca863`
  - Git blob SHA-1: `c14097ca35b9efef902449fa882f5f60a892d585`
  - Bytes: 17,268
- Behavioral test `scripts/test_memory_evidence_intake_behavior.mjs`
  - SHA-256: `b8ff137aed85406b4a38a3aa3291b0cf34e5b2f7da04920b47148961ee2b6b88`
- PostgreSQL integration test `scripts/test_memory_evidence_atomic_rpc.sh`
  - SHA-256: `9ea4dc5fef90faa31deef1c1111584c1ece9fb3280ae21e2a52b0bc4ad5a8c2b`
- Schema fixture `scripts/fixtures/memory_evidence_atomic_rpc_schema.sql`
  - SHA-256: `ca9ddb72422a69a8a1a38422007bc4ed235b67bebee0c002ec96110ed4df16d9`
- Assertion fixture
  `scripts/fixtures/memory_evidence_atomic_rpc_assertions.sql`
  - SHA-256: `d8ea1c076c3397d85b4cb707ec4235035de690ffc1f3434554ccb4a61a74559d`

The exact successor commit and tree are reported by the draft PR and its
exact-head CI. They are intentionally not embedded in a file inside that same
commit, which would create a self-referential commit identity.

## Required proof and current boundary

Source checks cover syntax, privacy rejection before database I/O, authorization
failure, identical replay, changed-content conflict, eight-way concurrency,
review-insert failure, audit-insert failure, one candidate/review/audit
postcondition, audit immutability, function privileges, literal-secret scan,
dependency audit, typecheck, and build.

The PostgreSQL test runs against a disposable PostgreSQL 17 service in exact-head
CI. It injects failures after candidate staging and after candidate+review
staging and proves zero rows persist in all three tables.

This does **not** resolve the existing migration-parity blocker. Current evidence
remains: 69 hosted ledger versions, 17 active source migrations, 15 matching
versions, 54 hosted-only versions, and two local-only versions before this
successor. This additive migration is therefore another local-only candidate
until the canonical migration chain is recovered and replayed. Hosted history
must not be edited, renamed, deleted, or fabricated.

## Production and rollback gates

Issue #56's artifact authorization binds the superseded bridge SHA-256
`09f7c95fc18333ae708a84f7f0476669c41fdb70a34c24bd7d8edff0f7692656`.
Because this successor changes the bridge and adds an RPC migration, refreshed
owner authorization must bind the final successor head, bridge hash, atomic
migration hash, forward scope migration, import map, and rollback artifacts.

Before any activation, require:

1. exact-head CI success, including disposable PostgreSQL proof;
2. recovered migration parity and clean zero-to-head replay;
3. a qualified different-vendor explicit PASS bound to the final head/tree and
   every bridge/migration/rollback hash;
4. transaction-only hosted apply/readback/rollback proof with zero persistent
   state;
5. a rehearsed content-addressed restore of live bridge v15;
6. one new exact durable ProjectOS plan and approval; and
7. fresh provider readback immediately before mutation.

Rollback order remains: restore and verify content-addressed live v15 source
`7cdb0e6a2ae74a6ea970ba537f8ff04c64cfd2c608e8b8e6c4a394dcff8d07cf`,
then remove only `memory:write` with the existing forward-recovery rollback,
then verify health/search and fail-closed evidence submission. The additive RPC
may remain dormant because it independently requires the exact active principal
with `memory:write`; cleanup is a later reviewed migration, not an emergency
history rewrite.

PXE-0008 remains FAIL/HOLD. Its literal B1/B2 contract must be recovered or
explicitly superseded by canonical owner action, followed by a new independent
runtime review. This source candidate does not satisfy or close that gate.
