import assert from "node:assert/strict";
import fs from "node:fs";

const migrationPath =
  "supabase/migrations/20260820113000_enable_projectos_evidence_candidate_write_scope.sql";
const rollbackPath =
  "supabase/recovery/20260820_disable_projectos_evidence_candidate_write_scope.sql";
const manifestPath =
  "recovery/evidence/memory-evidence-intake-activation-release-manifest.md";
const workflowPath = ".github/workflows/memory-evidence-intake.yml";

const migration = fs.readFileSync(migrationPath, "utf8");
const rollback = fs.readFileSync(rollbackPath, "utf8");
const manifest = fs.readFileSync(manifestPath, "utf8");
const workflow = fs.readFileSync(workflowPath, "utf8");

for (const [name, source] of [
  ["migration", migration],
  ["rollback", rollback],
]) {
  assert.match(source, /^begin;/m, `${name} must be transactional`);
  assert.match(source, /^commit;/m, `${name} must commit explicitly`);
  assert.ok(source.includes("set local lock_timeout = '5s'"));
  assert.ok(source.includes("set local statement_timeout = '30s'"));
  assert.ok(source.includes("projectos-mcpmaster-production"));
  assert.ok(source.includes("mcpmaster-pandoras-box"));
  assert.ok(source.includes("7c686cbd-d968-49d5-86cc-918f5e777bd2"));
  assert.ok(source.includes("prj_Y5rZVcq8xJVzHVt4uvfmg9wPvXMk"));
  assert.ok(source.includes("can_propose"));
  assert.ok(source.includes("v_grant.can_approve"));
  assert.ok(source.includes("additional proposal grants exist"));
  assert.ok(source.includes("allowed_namespaces"));
  assert.ok(source.includes("array['real_life']::text[]"));
  assert.ok(!/insert\s+into\s+public\.pandora_(?:projects|project_grants|service_principals)/i.test(source));
  assert.ok(!/update\s+public\.pandora_(?:projects|project_grants)/i.test(source));
  assert.ok(!/set\s+allowed_namespaces\s*=/i.test(source));
}

for (const marker of [
  "drop constraint if exists pandora_service_principals_scopes_check",
  "add constraint pandora_service_principals_scopes_check",
  "'memory:health'::text",
  "'memory:read'::text",
  "'memory:write'::text",
  "set scopes = array['memory:health', 'memory:read', 'memory:write']::text[]",
  "review-gated candidate proposal only",
]) {
  assert.ok(migration.includes(marker), `migration marker missing: ${marker}`);
}

for (const marker of [
  "set scopes = array_remove(scopes, 'memory:write'::text)",
  "drop constraint if exists pandora_service_principals_scopes_check",
  "add constraint pandora_service_principals_scopes_check",
  "Evidence-candidate write scope is disabled",
]) {
  assert.ok(rollback.includes(marker), `rollback marker missing: ${marker}`);
}
assert.ok(!rollback.includes("set scopes = array['memory:health', 'memory:read', 'memory:write']::text[]"));

const activate = (scopes) => {
  const allowed = new Set(["memory:health", "memory:read", "memory:write"]);
  assert.ok(scopes.includes("memory:health"));
  assert.ok(scopes.includes("memory:read"));
  assert.ok(scopes.every((scope) => allowed.has(scope)));
  return ["memory:health", "memory:read", "memory:write"];
};
const deactivate = (scopes) => scopes.filter((scope) => scope !== "memory:write");
assert.deepEqual(activate(["memory:health", "memory:read"]), [
  "memory:health",
  "memory:read",
  "memory:write",
]);
assert.deepEqual(activate(activate(["memory:health", "memory:read"])), [
  "memory:health",
  "memory:read",
  "memory:write",
]);
assert.deepEqual(deactivate(["memory:health", "memory:read", "memory:write"]), [
  "memory:health",
  "memory:read",
]);
assert.deepEqual(deactivate(deactivate(["memory:health", "memory:read"])), [
  "memory:health",
  "memory:read",
]);
assert.throws(() => activate(["memory:health", "memory:read", "memory:admin"]));

for (const path of [migrationPath, rollbackPath, manifestPath]) {
  assert.ok(workflow.includes(path), `workflow path filter missing: ${path}`);
}
assert.ok(workflow.includes("node scripts/check_memory_evidence_activation.mjs"));

for (const marker of [
  "LIVE / BLOCKED",
  "63d133f6e865a2cf6f4a874c6304ce351df9ac4a",
  "3c63c366389e9cc294b548643738b06d0e594a6ee064a6976dd558e489f5fe0a",
  "09f7c95fc18333ae708a84f7f0476669c41fdb70a34c24bd7d8edff0f7692656",
  "0fcacb20c0ff46ca224ca1769098ac3db14bb83d9bb264b755c23a58f2382e78",
  "No automatic canonical Memory promotion",
  "Explicit owner production authorization",
]) {
  assert.ok(manifest.includes(marker), `manifest marker missing: ${marker}`);
}

console.log("Governed Memory evidence-intake activation contract: PASS");
