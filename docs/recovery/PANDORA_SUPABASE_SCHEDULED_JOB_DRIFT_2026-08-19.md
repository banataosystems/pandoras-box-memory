# Pandora Memory Supabase Scheduled-Job Drift — 2026-08-19

## Status

**RED. No stable live-parity PASS is verified.**

This report supersedes any use of the earlier one-job catalog as a current complete scheduling inventory. It preserves that capture as historical evidence and adds a later, privacy-safe authenticated rowset. It does not erase Worker 6's contradictory three-job provider observation.

## Exact source and review boundary

- Repository: `banataosystems/pandoras-box-memory`
- Pull request: `#42`
- Reviewed failed head: `ca1646a357eae324b482854370f66f1c050d671c`
- Reviewed failed tree: `bfb8d2546691f868a294b1eacbfb489f67f656f1`
- Worker 6 review: `PRR_kwDOTxzn3c8AAAABKA_wfA`
- Verdict: `FAIL`
- Findings: `W2-R3-F1`, `W2-R3-F2`, `W2-R3-F3`

Any remediation commit requires a new exact-head review. The old review cannot approve a later source head.

## Contradictory authenticated observations

| Observation | Evidence | Active jobs | Recoverable job identities | Provider-result binding |
| --- | --- | ---: | --- | --- |
| Original committed catalog | `SECURITY_BOUNDARIES.json` | 1 | job 1 | internal repository consistency only |
| Later provider attestation | plan `4e8c36ba-c019-4465-a08c-9c649b84bc19` | 3 | no | no result bytes or digest available |
| New bounded rowset | plan `f632066d-3b69-4c15-b955-dcd744d6cdde` | 1 | job 1 | exact payload bytes and digest committed; ProjectOS audit still lacks result digest |

The later three-job observation cannot be dismissed. Its reported capture epoch is also temporally inconsistent with its GitHub submission timestamp, and its two additional job identities were not preserved. The newest rowset and seven-day execution ledger contain only job 1. This proves temporal contradiction, not stable parity.

## New content-addressed capture

- Query: `docs/provider-observations/memory-supabase-20260819/scheduled-jobs/SCHEDULED_JOBS_CAPTURE.sql`
- Query bytes: `5943`
- Query SHA-256: `abe450c881278184d4854ad1d2207a219b88b7ce0bf963bf0d6dab5cb011c6d5`
- Capture: `docs/provider-observations/memory-supabase-20260819/scheduled-jobs/CAPTURE_2026-08-19T030551Z.json`
- Capture SHA-256: `30e93ff475cf62036974b33b693edf832214b51c3aa3fa40d93294dee70a47f6`
- Provider payload bytes: `1904`
- Provider payload SHA-256: `507272c1f623fe91b158ec1efd14d78585a5c9bc3f147f31cf9488b37d892ef6`
- Capture role: `supabase_read_only_user`
- Transaction snapshot: `17116:17116:`
- Capture epoch: `2026-08-19T03:05:51.805068Z`

ProjectOS audit events bind the query execution lifecycle and plan payload:

- plan created: sequence `4938`, event hash `7b3168b29aab6a221362d51bfcff935fbe335772516914a342b8b754862665f2`
- approved: sequence `4940`, event hash `0c0b834d451e48b8cda8e2ff535108913e5e7e9c28740d47c3e7585504fba587`
- claimed: sequence `4941`, event hash `b9bd8a6bd40dc7a40a09a10a4b64f3628981f9f8be4c7ddcc4f7287fcbfe720c`
- completed: sequence `4942`, event hash `6c2ceeedf12462170a2229cc589d52861b394413b9c619b8abbcf0440e1e6dc3`

The audit completion record still exposes only `resultSummary:{type:"object"}`. It does not contain the provider result digest. The repository now preserves exact result bytes and digest, but cryptographic audit-to-result binding remains a Worker 1 control-path blocker.

## Current job semantics

Current authenticated rowset:

- Job ID: `1`
- Name: `projectos-memory-daily-context-pack`
- Schedule: `*/15 * * * *`
- Database/user: `postgres` / `postgres`
- Command bytes: `54`
- Command SHA-256: `1abab78475b233c52db64e595e411b5d0b0c5b7c84a6908d2cb525becb8b9f90`
- Raw command persisted: no
- Function: `private.refresh_projectos_daily_context_pack()`
- Function owner: `postgres`
- `SECURITY DEFINER`: yes
- Fixed `search_path`: empty
- Function-definition SHA-256: `9448d0ad4de46a769be7c9a225fca8478eaaa5a9818445942706fcccf57bb6d9`

Seven-day history:

- Runs: `672`
- Succeeded: `672`
- Failed: `0`
- Overlaps observed: `0`
- Average duration: `92.971 ms`
- Maximum duration: `397.554 ms`
- Interval: `900,000 ms`

The job name says “daily” while cron evaluates every 15 minutes. Runtime history shows short, non-overlapping success, but it does not prove source-level idempotency, overlap exclusion, or retry safety. The referenced function has an exception block but no detected `ON CONFLICT`, advisory lock, or `SKIP LOCKED` marker. The three migration identities that mention this job are C-class: identity known, authentic SQL source missing.

## Recovery consequence

The scheduling subsystem is not rollback-qualified. Recovery must treat scheduled execution as forward recovery:

1. capture a fresh bounded job rowset;
2. preserve exact command digests without raw commands or secrets;
3. reconcile every current job to authentic source or explicitly missing provenance;
4. independently review cadence, idempotency, overlap, retry, role, and function authorization;
5. recreate or retire jobs only through reviewed migrations;
6. verify post-recovery rowsets and execution history before production promotion.

## Remaining gates

- Worker 1 must expose a privacy-safe provider-result digest in ProjectOS audit.
- The unexplained three-job authenticated observation must remain in the evidence timeline.
- Exact-head source tests must pass on the remediation commit.
- A qualified separate reviewer must review the remediation head.
- No merge, cron mutation, database mutation, Edge deployment, or production release is authorized.
