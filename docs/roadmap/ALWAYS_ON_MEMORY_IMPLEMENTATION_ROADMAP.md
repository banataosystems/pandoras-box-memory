# Pandora Memory — Always-On Implementation Roadmap

**Status:** Execution roadmap  
**Target:** turn Pandora Memory into an always-on, MCP-independent operating-memory service  
**Branch:** `architecture/always-on-memory-v1`

## Phase 0 — Source recovery and exact-state reconciliation

### Objective
Recover the historical Memory application into the canonical `banataosystems/pandoras-box-memory` repository without pretending the recovery shell already contains the running product.

### Tasks
- inventory preserved Memory repository archives;
- identify newest credible source snapshot and parent lineage;
- compute archive/source hashes;
- compare recovered package files against active Vercel build/runtime evidence;
- record exact legacy commit/deployment relationships;
- import source history additively where technically possible;
- preserve the legacy repository as recovery-only evidence;
- produce a source-recovery manifest;
- identify current Supabase project/environment and live schema migrations from verified evidence;
- identify all live MCP/OAuth routes and auth boundaries;
- identify rollback deployment and database backup state.

### Exit proof
- canonical repository contains the recovered application source or a verified equivalent snapshot;
- source hash/manifest exists;
- active deployment lineage is documented;
- live schema compatibility is known;
- no secret value has been copied into GitHub;
- rollback evidence remains available.

## Phase 1 — Event and idempotency foundation

### Objective
Create append-first ingestion so meaningful project changes do not depend on ChatGPT manually saving Memory.

### Tasks
- add project event model;
- add source references/hashes;
- add idempotency keys;
- add processing lifecycle;
- add sensitivity classification;
- add audit events for mutations;
- add positive/negative RLS tests;
- add duplicate-delivery tests.

### Exit proof
An authorized synthetic event can be written exactly once, read back with source metadata, duplicated safely without duplicate mutation, and denied across unauthorized project/tenant boundaries.

## Phase 2 — Durable queues

### Objective
Ensure temporary provider/network failures do not lose approved knowledge work.

### Tasks
- provision queue classes for ingest, extract, verify, reconcile, embed, consolidate, retry, dead-letter;
- implement bounded consumers;
- implement visibility/retry policy;
- implement idempotent consumer contract;
- implement dead-letter incident path;
- expose queue-health metrics without payload leakage.

### Exit proof
Synthetic jobs survive worker failure, retry, complete exactly once at the canonical-effect layer, and dead-letter after controlled exhaustion without data loss.

## Phase 3 — Three-layer memory

### Objective
Separate immutable evidence, revisable working intelligence, and policy-promoted canonical memory.

### Tasks
- formalize evidence records;
- formalize working-intelligence records;
- formalize canonical records;
- add confidence/lifecycle fields;
- add supersession graph;
- add dispute/stale states;
- add source/evidence links;
- add canonical-promotion authorization policy.

### Exit proof
A conflicting synthetic fact does not overwrite prior evidence; it enters reconciliation and produces traceable supersession only after the required promotion rule is satisfied.

## Phase 4 — Memory Scholar

### Objective
Continuously study approved project evidence and generate bounded, auditable intelligence.

### Tasks
- incremental change analysis;
- contradiction detection;
- stale-record detection;
- duplicate/consolidation detection;
- task/dependency resolution candidates;
- deployment/test/source reconciliation;
- next-autonomous-action proposals;
- model/provider/version and source logging;
- evaluation corpus for hallucination, unsupported promotion, and contradiction behavior.

### Exit proof
Scholar output is source-linked, reproducible enough for audit, cannot self-promote to hard canon, and fails closed when required evidence is absent.

## Phase 5 — Scheduler / continuous operation

### Objective
Run bounded work continuously without one long-lived AI process.

### Target cadence
- every minute: ingestion/retry + critical heartbeat;
- every 5 minutes: recent reconciliation/open-loop candidates;
- every 15 minutes: semantic/index refresh and contradiction scans;
- hourly: project Scholar pass;
- nightly: deep consolidation/integrity pass;
- weekly: portfolio synthesis/quality review.

### Exit proof
Schedules execute from the production scheduler with durable run history, failed jobs are visible/recoverable, and queue growth remains bounded under synthetic load.

## Phase 6 — Memory Guardian

### Objective
Make Memory detect its own degradation.

### Tasks
- scheduler heartbeat;
- ingestion latency monitor;
- queue-depth/oldest-job monitor;
- dead-letter monitor;
- last Scholar pass monitor;
- last canonical write/read-after-write monitor;
- MCP health monitor;
- DB/index health monitor;
- backup freshness monitor;
- restore-test freshness monitor;
- authorization-negative-test freshness monitor;
- durable incident records and ProjectOS surfacing.

### Exit proof
Controlled failure injections produce the expected incident, preserve evidence, and recover without losing queued work.

## Phase 7 — MCP isolation and permanent connection repair

### Objective
Make MCP a secure client access layer, not a single point of Memory operation.

### Tasks
- canonicalize external machine endpoint;
- preserve app-internal route compatibility where needed;
- repair Vercel automation/bootstrap gate without anonymous privileged access;
- verify MCP OAuth/workload identity;
- verify ProjectOS project/tool authorization;
- verify RLS/data authorization;
- test authorized health/search/write/read;
- test wrong identity/missing identity denial;
- test Memory continuing to process while MCP is intentionally unavailable.

### Exit proof
MCP outage does not halt Memory internal operations; after reconnection, queued state is retrievable and consistent. Authorized and denied identity paths are both proven.

## Phase 8 — Secret consolidation

### Objective
Centralize durable application/provider secrets without introducing a bootstrap deadlock.

### Tasks
- inventory secret names and consumers, never values in GitHub;
- classify bootstrap/edge secrets vs application/provider secrets;
- move eligible durable secrets into Supabase Vault or function-secret storage;
- keep only minimal edge/bootstrap configuration where required;
- add rotation metadata and ownership;
- test revoked/rotated secret behavior;
- verify no secret values appear in Memory, logs, analytics, screenshots, or source.

### Exit proof
Secret scanning passes; rotation is documented/tested; no runtime path requires AI/model access to credentials.

## Phase 9 — Backup, restore, and disaster recovery

### Objective
Ensure Memory survives provider/repository/deployment failure.

### Tasks
- database backup policy;
- source snapshots and hashes;
- deployment manifest;
- restore runbook;
- periodic restore drill;
- queue recovery behavior;
- canonical-memory integrity verification after restore;
- GitHub source mirror durability;
- provider-independent recovery evidence where practical.

### Exit proof
A tested restore reconstructs a known checkpoint, validates canonical hashes/records, and documents recovery time/evidence.

## Phase 10 — Production verification and ongoing quality

### Objective
Prove the whole memory lifecycle, not only individual components.

### End-to-end synthetic scenario
1. create approved project event;
2. enqueue it;
3. worker extracts/validates;
4. working intelligence is generated;
5. policy promotes the correct canonical result;
6. search retrieves it;
7. duplicate event is harmless;
8. conflicting evidence enters reconciliation;
9. Guardian records a forced worker failure;
10. retry succeeds;
11. MCP is disabled while internal processing continues;
12. MCP is restored and retrieves the processed state;
13. wrong identity is denied;
14. backup/rollback target is recorded.

### Production-verification gate
Do not call Pandora Memory permanently repaired until this scenario passes with exact source SHA, deployment ID, environment, audit records, timestamps, and rollback proof.

## Current status

- Architecture: **documented**.
- Implementation: **not yet proven in canonical source**.
- Testing: **not started for this architecture**.
- Deployment: **not performed for this architecture**.
- Production verification: **not performed**.

## Highest-value safe next action

Complete Phase 0 exact source recovery and reconciliation, because applying queue/cron/schema changes before recovering the running Memory source could create schema drift or destroy rollback confidence.
