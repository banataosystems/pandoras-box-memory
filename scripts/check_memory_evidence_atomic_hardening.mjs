import assert from "node:assert/strict";
import fs from "node:fs";

// This exact-head contract anchors verification after the transaction fixture repair.
const bridgePath = "supabase/functions/pandora-projectos-bridge/index.ts";
const migrationPath =
  "supabase/migrations/20260820073000_atomic_projectos_evidence_candidate_review_queue.sql";

const bridge = fs.readFileSync(bridgePath, "utf8");
const migration = fs.readFileSync(migrationPath, "utf8");

assert.ok(
  bridge.includes(
    'const RETRIEVABLE_CANON_STATUSES = new Set(["hard_canon", "soft_canon"]);',
  ),
  "ProjectOS Edge search must expose approved canon only",
);
assert.ok(
  !bridge.includes(
    'const RETRIEVABLE_CANON_STATUSES = new Set(["hard_canon", "soft_canon", "draft"]);',
  ),
  "ProjectOS Edge search must not accept requested draft status",
);
assert.ok(
  bridge.includes('privacy_policy: "metadata_only_v2_fail_closed"'),
  "evidence response must match the persisted v2 privacy contract",
);
assert.ok(
  !bridge.includes('privacy_policy: "metadata_only_v1"'),
  "evidence response must not downgrade the privacy contract",
);

for (const marker of [
  "memory_enqueue_projectos_evidence_review",
  "memory_projectos_evidence_candidate_review_atomic",
  "after insert on public.memory_capture_candidates",
  "projectos_evidence_candidate_v1",
  "projectos_evidence_candidate_role_not_allowed",
  "projectos_evidence_candidate_authority_not_allowed",
  "metadata_only_v2_fail_closed",
  "evidence_privacy_v2",
  "projectos_evidence_review_atomic_insert_failed",
  "on conflict do nothing",
  "set search_path = ''",
  "security invoker",
  "to service_role",
]) {
  assert.ok(migration.includes(marker), `atomic migration marker missing: ${marker}`);
}

assert.ok(
  migration.includes("current_user is distinct from 'service_role'"),
  "atomic trigger must reject non-service-role callers",
);
assert.ok(
  migration.includes("'memory:evidence-candidate:submit' = any(principal.scopes)"),
  "atomic trigger must re-check the narrow evidence scope",
);
assert.ok(
  migration.includes("project_grant.can_propose = true"),
  "atomic trigger must re-check proposal authority",
);
assert.ok(
  migration.includes("project_grant.revoked_at is null"),
  "atomic trigger must reject revoked grants",
);
assert.ok(
  migration.includes("array['search_path=\"\"']::text[]"),
  "migration must verify the fixed empty search path exactly",
);
assert.ok(
  migration.indexOf("insert into public.memory_review_queue_items") <
    migration.indexOf("projectos_evidence_review_atomic_insert_failed"),
  "atomic migration must verify the review row after insert",
);
assert.ok(
  !migration.includes("insert into public.memory_items"),
  "atomic intake must never write canonical Memory",
);
assert.ok(
  !migration.includes("update public.memory_items"),
  "atomic intake must never update canonical Memory",
);
assert.ok(
  !migration.includes("delete from public.memory_items"),
  "atomic intake must never delete canonical Memory",
);

console.log("Atomic ProjectOS evidence hardening source contract: PASS");
