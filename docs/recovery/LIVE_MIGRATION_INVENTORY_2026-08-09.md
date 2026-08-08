# Live Supabase Migration Inventory — 2026-08-09

**Project:** `ivmvufhcsezyhczzondn` (Memory)  
**Observed migration count:** 53  
**Latest migration:** `20260808170034_migrate_pandora_integration_credentials_to_vault`

This inventory records live migration identity only. Historical migration SQL is **not** copied verbatim into the canonical repository because Phase 0 recovery found literal legacy credential material embedded in some historical statements. Exact parity for those migrations is therefore tracked by version/name plus server-side SHA-256 fingerprints, not by unsafe source replication.

## Inventory

- `20260620000100` — `core_database_schema`
- `20260620000200` — `rls_policy_foundation`
- `20260620000210` — `rls_real_life_tables`
- `20260620000220` — `rls_au_tables`
- `20260620000300` — `persistent_idempotency`
- `20260620000400` — `idempotency_rpc_strategy`
- `20260620000500` — `memory_candidate_transaction`
- `20260620000600` — `memory_ingest_response_cache_contract`
- `20260620000700` — `memory_ingest_transactional_rpc_boundary`
- `20260620000800` — `memory_review_queue_storage_boundary`
- `20260620000900` — `memory_review_decision_append_rpc`
- `20260620006200` — `memory_review_queue_rls_tables`
- `20260623006600` — `memory_execute_approved_review_persistence`
- `20260626040000` — `phase_4a_memory_proposals`
- `20260626041000` — `phase_4a_daily_chatgpt_memory_bridge`
- `20260627040000` — `phase_4c_adaptive_memory_intelligence`
- `20260628050000` — `phase_5b_memory_feedback_events`
- `20260628070000` — `env_broker`
- `20260629000000` — `phase_5d_memory_scoring`
- `20260701000000` — `phase_6a_operating_brain`
- `20260701010000` — `phase_6b_project_context_engine`
- `20260704114354` — `adaptive_log_rls_policies`
- `20260715200029` — `adaptive_profile_versioning_columns`
- `20260715200058` — `pandora_operator_action_center`
- `20260715200108` — `pandora_operator_action_runner_statuses`
- `20260715200130` — `pandora_shadow_context_pack_lab`
- `20260715200149` — `pandora_shadow_pack_preflight`
- `20260715200514` — `pandora_promotion_request_board`
- `20260716000000` — `pandora_promotion_executor`
- `20260731111248` — `posthog_product_intelligence`
- `20260731111340` — `product_intelligence_deny_policies`
- `20260731125443` — `remove_mistaken_product_intelligence_fabric_v2`
- `20260731190810` — `projectos_oidc_memory_bridge`
- `20260801163126` — `pandora_fxpass_growth_bridge`
- `20260803111852` — `rebind_mcpmaster_memory_principal_to_canonical_vercel_identity`
- `20260806083053` — `pandora_governed_memory_model`
- `20260806083532` — `pandora_governed_approval_operations`
- `20260806083632` — `pandora_approval_denial_audit_correctness`
- `20260807050123` — `add_pandora_source_snapshots`
- `20260807053859` — `enable_http_extension_for_source_recovery`
- `20260807054503` — `lock_down_pandora_source_snapshots`
- `20260807054513` — `remove_temporary_http_recovery_extension`
- `20260807055209` — `temporary_fxpass_snapshot_export_gate`
- `20260807055550` — `remove_temporary_fxpass_snapshot_export_gate`
- `20260807081540` — `temporary_fxpass_privacy_snapshot_export_gate`
- `20260807081642` — `remove_blocked_fxpass_privacy_snapshot_export_gate`
- `20260807082820` — `projectos_post_task_learning_foundation`
- `20260807084620` — `projectos_daily_pack_and_runtime_reconciliation`
- `20260807085215` — `projectos_bridge_v13_evidence_reconciliation`
- `20260807085935` — `projectos_native_hydration_gate_evidence`
- `20260807090642` — `projectos_memory_daily_pack_private_execution_boundary`
- `20260807090844` — `projectos_no_github_final_security_evidence`
- `20260808170034` — `migrate_pandora_integration_credentials_to_vault`

## Recovery rules

1. Do not copy secret-bearing historical SQL into GitHub.
2. Preserve exact live statement hashes separately from sanitized migration replacements.
3. Reconstruct sanitized historical migrations only when necessary for disaster recovery and only after secret replacement/rotation.
4. New migrations from `20260808170034` forward must be committed to the canonical repository at the time they are applied.
5. Literal secret detection is a release blocker.
