# Pandora Memory — Verified Live State

**Observed:** 2026-08-09 PHT  
**Supabase project:** `ivmvufhcsezyhczzondn` (`Memory`)  
**Status:** `ACTIVE_HEALTHY`  
**Purpose:** distinguish what is already implemented in the live data plane from the new always-on target architecture.

## 1. Important correction to the recovery assumption

The canonical GitHub repository is currently only a recovery/governance shell, but the live Supabase project already contains substantial Memory implementation. The always-on program must therefore **recover and extend the existing implementation**, not rebuild it from scratch.

## 2. Existing platform capabilities verified live

Installed extensions include:

- `pg_cron` 1.6.4
- `supabase_vault` 0.3.1
- `pgcrypto` 1.3
- `vector` 0.8.2
- `pg_stat_statements`

This means scheduling, encrypted secret storage capability, hashing/crypto primitives, and vector indexing support already exist in the live data plane.

## 3. Existing Memory architecture verified live

The live schema already contains important components aligned with the target design, including:

### Event / learning / ingestion
- `memory_events`
- `memory_capture_candidates`
- `memory_session_digests`
- `memory_feedback_events`
- `memory_model_call_logs`
- `pandora_ingestion_failures`
- `pandora_sync_runs`

### Canonical and retrieval memory
- `memory_items`
- `memory_profiles`
- `memory_context_packs`
- `memory_embeddings`
- `memory_sources`
- `memory_retrieval_logs`
- `memory_open_loops`

### Review and promotion
- `memory_proposals`
- `memory_review_queue_items`
- `memory_review_queue_decisions`
- `pandora_memory_conflicts`
- `pandora_memory_record_versions`
- `pandora_promotion_requests`
- `pandora_promotion_request_events`
- `pandora_promotion_executions`
- `pandora_promotion_execution_events`

### Project operating state
- `operating_projects`
- `operating_project_tasks`
- `operating_project_open_loops`
- `operating_project_decisions`
- `operating_project_constraints`
- `operating_project_artifacts`
- `one_best_next_actions`

### Source recovery and provenance
- `pandora_source_snapshots`
- `pandora_source_snapshot_files`

### Machine identity / authorization
- `pandora_service_principals`
- `pandora_project_grants`

### Idempotency / audit
- `idempotency_records`
- `audit_logs`
- multiple append-oriented Pandora event/audit tables

## 4. Current record counts observed

At the time of verification:

- `memory_events`: 1
- `memory_items`: 87
- `memory_proposals`: 0
- `memory_review_queue_items`: 2
- `pandora_memory_conflicts`: 1
- `pandora_memory_record_versions`: 42
- `pandora_project_grants`: 7
- `pandora_service_principals`: 1
- `pandora_source_snapshots`: 22
- `pandora_sync_runs`: 0
- `idempotency_records`: 0
- `pandora_ingestion_failures`: 0

Counts are point-in-time evidence only.

## 5. Existing scheduler loop is active and working

A live cron job exists:

- job name: `projectos-memory-daily-context-pack`
- schedule: every 15 minutes
- command: `select private.refresh_projectos_daily_context_pack();`
- active: yes

The latest twenty observed executions all reported `succeeded` / `1 row`, including the 2026-08-08 16:45 UTC run.

The active daily context pack was observed with title:

`Pandoras-Box Daily Operating Pack — 2026-08-09 Asia/Manila`

This proves Pandora Memory is already partially operating continuously inside Supabase even while normal MCP retrieval is unavailable.

## 6. Existing ProjectOS bridge

Active Edge Function:

- name: `pandora-projectos-bridge`
- version: 13
- status: ACTIVE
- code hash: `3c63c366389e9cc294b548643738b06d0e594a6ee064a6976dd558e489f5fe0a`
- platform JWT verification: disabled at the Edge Function wrapper because the function implements its own workload-token verification.

Verified behavior from source inspection:

- expects principal key `projectos-mcpmaster-production`;
- accepts a Vercel OIDC token from `x-pandora-vercel-oidc` or Bearer authorization;
- verifies Vercel OIDC signature/JWKS;
- verifies issuer, audience, subject, owner, project, project name and environment against the stored service principal;
- enforces `memory:health` and `memory:read` scopes;
- enforces namespace allowlists;
- retrieves approved canonical memory by default (`hard_canon`, `soft_canon`);
- returns open loops, context packs, recent events, semantic-style keyword matches, and canonical records;
- writes retrieval audit metadata;
- exposes `health` and `search` actions.

This means the internal Memory→ProjectOS authorization design already exists. The unresolved failure remains the outer machine-access path through MCPMaster/Vercel and source durability.

## 7. Existing ProjectOS learning path

Active Edge Function:

- name: `pandora-projectos-learning`
- version: 1
- status: ACTIVE
- code hash: `eec5a67e3e9af88850aa2a0e98dca7a344a54086b51166b5cc0a91e2b0ac82fe`

Verified behavior from source inspection:

- POST only;
- 32 KiB payload cap;
- privacy policy must be `metadata_only_v1`;
- validates UUIDs, hashes, timing and bounded fields;
- requires a five-minute HMAC timestamp window;
- resolves a server-side integration credential;
- never imports raw arguments, results, errors, personal identifiers or secrets;
- creates/reuses a `memory_capture_candidate`;
- creates/reuses a review queue item;
- creates/reuses a session digest;
- records audit evidence;
- returns `canonical_memory_written: false`;
- explicitly requires human review before canonical persistence.

This is already close to the desired evidence → working intelligence → reviewed canon separation.

## 8. Secret-storage finding

The live project has Supabase Vault installed, but a private table named `private.pandora_integration_credentials` currently contains a `secret_value` text column along with integration key, memory user ID, allowed products and active state.

No secret values were read during this assessment.

Target architecture should migrate eligible durable secret values into Supabase Vault/function-secret storage after source parity is recovered and a rotation/rollback plan exists. The private table can retain non-secret metadata/reference IDs if useful.

## 9. RLS posture observed

RLS is enabled on key Memory/project/principal/grant tables inspected, including:

- `memory_events`
- `memory_items` (also FORCE RLS)
- `memory_capture_candidates`
- `memory_embeddings`
- `memory_open_loops`
- `memory_profiles`
- `memory_proposals`
- `memory_review_queue_items`
- `memory_session_digests`
- `operating_projects`
- `operating_project_tasks`
- `operating_project_open_loops`
- `pandora_project_grants`
- `pandora_service_principals`

Several policies are granted to the Postgres `public` role but are named as owner/user-scoped policies. The exact policy predicates still need to be reviewed before security can be marked verified; role name alone is not sufficient evidence of exposure or safety.

## 10. Revised gap analysis

### Already implemented or substantially present
- durable Memory database;
- event/candidate/digest structures;
- canonical memory with provenance fields;
- conflicts and version history;
- review queue;
- project operating-state tables;
- source snapshots;
- service-principal and project-grant model;
- 15-minute scheduler loop;
- ProjectOS search/health bridge;
- review-gated post-task learning ingestion;
- vector extension;
- Vault capability;
- RLS on core tables.

### Still missing or not production-verified
- exact source recovery into canonical GitHub;
- exact live schema ↔ migration/source parity;
- durable queue implementation matching the always-on target (`pgmq`/Supabase Queues is not yet verified installed);
- broader Scholar loops beyond current context-pack refresh/post-task capture;
- Memory Guardian/self-health incident system;
- continuous ingestion coverage across intended providers;
- complete secret migration into Vault;
- outer MCPMaster/Vercel machine access repair;
- authorized MCP health/search/write/read end-to-end proof;
- wrong/missing identity end-to-end denial proof through the full external path;
- backup/restore drill freshness;
- full production synthetic lifecycle.

## 11. Current phase

**Phase 0 — source recovery and live-state reconciliation.**

The live data plane is healthier and more capable than the disconnected MCP experience suggests. The correct strategy is incremental recovery and extension, not replacement.

## 12. Highest-value next action

Recover the exact source/migrations corresponding to these live tables/functions into `banataosystems/pandoras-box-memory`, then compare source hashes and migration history against the live Supabase state. Only after parity is established should new queue/Guardian/Scholar migrations be authored or production secrets moved.
