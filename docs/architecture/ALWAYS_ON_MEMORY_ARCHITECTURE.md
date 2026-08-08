# Pandora Memory — Always-On Architecture

**Status:** Canonical design proposal for implementation  
**Repository:** `banataosystems/pandoras-box-memory`  
**Branch:** `architecture/always-on-memory-v1`  
**Effective design date:** 2026-08-09 PHT  

## 1. Mission

Pandora Memory must be an always-running project operating-memory service. ChatGPT, MCPMaster, ProjectOS, GitHub, Vercel, Supabase, analytics systems, and owner input are clients or event sources; none of them individually keep Memory alive.

A temporary MCP outage must mean only: **a client cannot currently query Memory**. It must not mean that Memory stops ingesting approved events, processing work, maintaining durable project state, studying accumulated evidence, reconciling contradictions, or preserving history.

Pandora must become smarter by continuously processing evidence, not by indiscriminately copying everything. New AI conclusions are working intelligence until promoted by policy and evidence into canonical state.

## 2. Non-negotiable principles

1. **Always-on service, not chat-bound memory.**
2. **Append evidence before interpreting it.**
3. **No silent promotion of AI inference to canon.**
4. **History is superseded, never erased for cosmetic cleanliness.**
5. **Secrets never enter semantic project memory.**
6. **Customer operational data remains in its application data plane.**
7. **Every meaningful write is idempotent and auditable.**
8. **MCP is an access plane, not the memory engine.**
9. **Failures queue and recover; they do not silently drop knowledge.**
10. **Health is proven by heartbeats and end-to-end checks, not deployment status alone.**

## 3. Security topology

Use four distinct boundaries:

1. **Infrastructure/bootstrap boundary** — Vercel Deployment Protection or equivalent edge protection.
2. **Machine identity boundary** — MCP OAuth/workload identity.
3. **Authorization boundary** — ProjectOS policy and project/tool scope.
4. **Data boundary** — Supabase/Postgres RLS and server-side authorization.

Supabase Vault or server-side function secrets should hold durable application/provider secrets. Only credentials required before Supabase can be reached may remain at the consuming edge/bootstrap layer. Secret values must never be stored in GitHub, Pandora semantic memory, analytics, screenshots, or ordinary logs.

## 4. Core architecture

```text
GitHub ───────┐
Vercel ───────┤
Supabase ─────┤
PostHog ──────┤
ProjectOS ────┤
ChatGPT ──────┤
Owner input ──┤
              ▼
       EVENT INGESTION
              │
              ▼
       DURABLE QUEUES
              │
      ┌───────┼────────┐
      ▼       ▼        ▼
   Extract  Verify   Analyze
      │       │        │
      └───────┼────────┘
              ▼
       MEMORY SCHOLAR
              │
         Reconciliation
              │
              ▼
       CANONICAL MEMORY
              │
       ┌──────┴──────┐
       ▼             ▼
    MCPMaster     ProjectOS
       │
       ▼
     ChatGPT

        MEMORY GUARDIAN
               │
      health / retries / audit
               │
               ▼
        recovery + alerts
```

## 5. Event inbox

Every meaningful external or internal change first becomes an append-only event with provenance. Example event kinds:

- `github.commit`
- `github.pull_request.merged`
- `github.issue.changed`
- `vercel.deployment.ready`
- `vercel.production_verified`
- `project.requirement`
- `project.decision`
- `project.blocker`
- `project.task.changed`
- `test.completed`
- `source.snapshot`
- `memory.correction`
- `memory.supersession`
- `owner.approval`

Minimum event metadata:

- event ID;
- project ID/key;
- source system;
- source object/ref;
- event type;
- actor/workload identity;
- observed/effective time;
- ingestion time;
- source hash where practical;
- sensitivity class;
- confidence/evidence state;
- idempotency key;
- raw evidence pointer or governed body;
- processing state.

No secret value is permitted in event payloads.

## 6. Durable queue model

Preferred queue classes:

- `memory_ingest`
- `memory_extract`
- `memory_verify`
- `memory_reconcile`
- `memory_embed`
- `memory_consolidate`
- `memory_retry`
- `memory_dead_letter`

A processing failure must retain the work item for retry. Every consumer must be idempotent. Duplicate delivery must not create duplicate canonical records.

## 7. Three-layer memory model

### 7.1 Evidence layer

Immutable or append-oriented observations and source snapshots.

Examples:

- commit X exists;
- test Y passed at SHA Z;
- deployment D returned HTTP 200;
- owner approved decision Q.

Evidence is not rewritten when a later fact supersedes it.

### 7.2 Working intelligence

Machine-generated or analyst-generated interpretations, such as:

- likely stale record;
- contradiction detected;
- task dependency appears satisfied;
- deployment likely supersedes another;
- recommended next safe action.

Working intelligence is revisable and cannot silently become hard canon.

### 7.3 Canonical memory

The state ProjectOS is allowed to rely on for project operation:

- project identity and purpose;
- approved requirements;
- roadmap and task state;
- decisions and constraints;
- blockers/open loops;
- architecture;
- source snapshots/hashes;
- migrations/environments;
- verified deployments;
- test/review/security/privacy evidence;
- release/rollback state;
- current phase;
- next autonomous action.

Promotion into canon must record policy/rationale, provenance, effective time, and supersession lineage.

## 8. Memory lifecycle states

Every durable knowledge record should support at least:

- `observed`
- `inferred`
- `verified`
- `approved`
- `hard_canon`
- `disputed`
- `stale`
- `superseded`

Recommended metadata:

- `source_refs`
- `source_hash`
- `confidence`
- `effective_at`
- `verified_at`
- `review_after`
- `supersedes`
- `superseded_by`
- `created_by`
- `approved_by`
- `policy_version`

## 9. Memory Scholar

The Scholar is a recurring analysis layer. It does not run forever in one process. It consumes bounded queued jobs and writes proposed intelligence or governed reconciliations.

It should ask continuously:

- What changed since the last pass?
- What is stale?
- What contradicts current canon?
- Which open loops are now resolvable?
- Which dependencies are satisfied?
- What is the newest production-verified deployment?
- Which records are duplicates?
- Which claims lack proof?
- Which project has become unexpectedly inactive?
- Which assumption should be downgraded?
- Which record should be superseded?
- What is the highest-value safe next autonomous action?

No Scholar output becomes hard canon solely because an AI generated it.

## 10. Scheduling model

Use recurring jobs only after exact recovered source/schema compatibility is verified.

Target cadence:

### Every minute
- drain ingestion/retry work;
- update critical health heartbeats.

### Every 5 minutes
- reconcile recent project events;
- update open loops and task-dependency candidates.

### Every 15 minutes
- refresh semantic indexes/embeddings;
- scan new deployment/test/source contradictions.

### Hourly
- run bounded project-level Scholar analyses;
- produce next-action candidates.

### Nightly
- deep consolidation;
- duplicate/stale-memory detection;
- source/hash integrity checks;
- rollback/reference verification.

### Weekly
- portfolio synthesis;
- architecture drift review;
- stale-project review;
- memory-quality report;
- unresolved-blocker escalation candidates.

## 11. Memory Guardian

The Guardian independently monitors Memory itself.

Required signals:

- ingestion queue depth;
- age of oldest unprocessed event;
- retry count;
- dead-letter count;
- cron/scheduler heartbeat;
- last successful Scholar pass;
- last successful canonical write;
- last successful read-after-write verification;
- MCP health;
- database health;
- semantic-index health;
- source-integrity status;
- backup freshness;
- restore-test freshness;
- authorization negative-test freshness.

Critical failures must create durable incidents and surface them to ProjectOS. A dead MCP connection must not stop internal Memory processing.

## 12. Self-learning safety contract

“Always learn” means:

- continuously process approved evidence;
- derive proposed knowledge;
- compare new evidence to canon;
- identify contradictions and uncertainty;
- consolidate duplicate/redundant knowledge;
- improve retrieval/index quality;
- learn project patterns and next-action candidates;
- preserve provenance and review state.

It does **not** mean:

- scrape or ingest arbitrary private data without a lawful/approved basis;
- train/fine-tune external models on customer data automatically;
- copy credentials or confidential operational payloads into semantic memory;
- let AI mark its own conclusions as independently verified;
- overwrite history;
- silently publish or execute consequential actions.

## 13. Failure behavior

- AI provider unavailable → queue retains work.
- GitHub unavailable → retry and retain source reference.
- Vercel unavailable → Memory remains operational.
- MCPMaster unavailable → internal Memory remains operational.
- Scholar job fails → retry or dead-letter with incident.
- duplicate event → idempotency prevents duplicate canonical mutation.
- conflicting evidence → create reconciliation state; do not silently overwrite canon.
- scheduler failure → Guardian incident.
- backup failure → release/maintenance risk gate.

## 14. Proof ladder

Always report separately:

1. Documented
2. Implemented
3. Tested
4. Deployed
5. Production-verified

A queue schema existing is not proof that ingestion works. A cron job existing is not proof that it runs. A deployment marked READY is not proof that Memory is healthy. Production verification requires end-to-end evidence including authorized and denied identity paths, queue processing, read-after-write, health heartbeat, and rollback/restore evidence.

## 15. Current known recovery constraint

The canonical repository is presently a recovery shell. Historical application source exists in preserved recovery archives, while the active Vercel deployment still has lineage to the legacy `mbanatao/Memory` repository. No database migration or production change should be generated from this document until the exact recovered source/schema is imported and compared with the active deployment.

## 16. Desired end state

Pandora Memory is considered structurally healthy when:

- it continues ingesting and processing while MCP is disconnected;
- no approved event is silently lost;
- canonical state retains provenance and supersession history;
- Scholar analyses are bounded, auditable, and policy-gated;
- Guardian detects failures independently;
- secrets are resolved server-side and excluded from semantic memory;
- authorized MCP health/search/write/read succeeds;
- wrong/missing identity is denied;
- backup and restore proof is current;
- exact source, deployment, environment, and rollback target are recorded.
