import fs from "node:fs";
import assert from "node:assert/strict";
import ts from "typescript";

const routePath = "app/api/projectos/memory/evidence-candidates/route.ts";
const bridgePath = "supabase/functions/pandora-projectos-bridge/index.ts";
const atomicMigrationPath =
  "supabase/migrations/20260821160000_submit_projectos_evidence_candidate_atomic.sql";

const route = fs.readFileSync(routePath, "utf8");
const bridge = fs.readFileSync(bridgePath, "utf8");
const atomicMigration = fs.readFileSync(atomicMigrationPath, "utf8");

for (const [name, source] of [["route", route], ["bridge", bridge]]) {
  const result = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
    },
    reportDiagnostics: true,
  });
  const errors = (result.diagnostics || []).filter(
    (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
  );
  assert.equal(errors.length, 0, `${name} syntax diagnostics: ${errors.map((e) => e.messageText).join("; ")}`);
}

for (const marker of [
  "MAX_BODY_BYTES = 16 * 1024",
  '"idempotency_key"',
  'error: "unexpected_field"',
  'action: "submit_evidence_candidate"',
  "proxyProjectOSMemoryRequest",
]) {
  assert.ok(route.includes(marker), `route marker missing: ${marker}`);
}

for (const marker of [
  'principal.scopes.includes("memory:write")',
  "principal.allowed_namespaces.includes(namespace)",
  "EVIDENCE_PROOF_STAGES",
  "EVIDENCE_ISO_TIMESTAMP_PATTERN",
  "evidenceSensitiveReason",
  '"direct_identifier_email"',
  '"credential_signature"',
  '"jwt_signature"',
  '"secret_assignment"',
  '.from("pandora_projects")',
  '.from("pandora_project_grants")',
  '.eq("can_propose", true)',
  '.eq("environment", principal.environment)',
  'EVIDENCE_ATOMIC_RPC = "submit_projectos_evidence_candidate_atomic"',
  "admin.rpc(",
  "p_idempotency_key: idempotencyKey",
  'error: "idempotency_conflict"',
  'error: "candidate_transaction_failed"',
  'status: "pending_review"',
  "audit_id: atomicResult.audit_id",
  "atomic_transaction: true",
  "canonical_memory_written: false",
  "EVIDENCE_PRIVACY_SCAN_VERSION",
  '"direct_identifier_phone"',
  '"direct_identifier_name"',
  '"direct_identifier_address"',
  '"cloud_credential_signature"',
  '"private_key_material"',
  'body.action === "submit_evidence_candidate"',
]) {
  assert.ok(bridge.includes(marker), `bridge marker missing: ${marker}`);
}

const helperStart = bridge.indexOf("const EVIDENCE_PROOF_STAGES");
const serveStart = bridge.search(/Deno\.serve\(/);
assert.ok(helperStart >= 0 && serveStart > helperStart, "evidence helper boundary missing");

const helper = bridge.slice(helperStart, serveStart);
assert.ok(!helper.includes('.from("memory_items")'), "candidate helper must not access canonical memory_items");
assert.ok(
  !helper.includes('.from("memory_capture_candidates")'),
  "bridge must not persist candidates outside the atomic RPC",
);
assert.ok(
  !helper.includes('.from("memory_review_queue_items")'),
  "bridge must not persist review rows outside the atomic RPC",
);
assert.ok(!helper.includes("hard_canon"), "candidate helper must not promote hard canon");
assert.ok(!helper.includes("soft_canon"), "candidate helper must not promote soft canon");
assert.ok(!helper.includes("imported_personal_identifiers: false"), "categorical identifier claim must not be persisted");
assert.ok(!helper.includes("imported_secrets: false"), "categorical secret claim must not be persisted");

for (const marker of [
  "begin;",
  "commit;",
  "submit_projectos_evidence_candidate_atomic",
  "security definer",
  "insert into public.memory_capture_candidates",
  "insert into public.memory_review_queue_items",
  "insert into public.audit_logs",
  "projectos_evidence_candidate_atomic_created",
  "prevent_projectos_evidence_intake_audit_mutation",
  "on conflict (user_id, namespace, source, source_ref)",
  "'outcome', 'idempotency_conflict'",
  "'outcome', 'deduplicated'",
  "'outcome', 'created'",
  "'canonical_memory_written', false",
  "'privacy_policy', 'metadata_only_v2_fail_closed'",
  "'privacy_scan_version', 'evidence_privacy_v2'",
  "'privacy_scan_passed', true",
  "raw_excerpt",
  "null,",
  "grant execute on function public.submit_projectos_evidence_candidate_atomic",
]) {
  assert.ok(atomicMigration.includes(marker), `atomic migration marker missing: ${marker}`);
}
assert.ok(
  atomicMigration.indexOf("insert into public.memory_capture_candidates") <
    atomicMigration.indexOf("insert into public.memory_review_queue_items"),
  "candidate insert must precede review insert inside one RPC transaction",
);
assert.ok(
  atomicMigration.indexOf("insert into public.memory_review_queue_items") <
    atomicMigration.indexOf("insert into public.audit_logs"),
  "review insert must precede immutable audit insert inside one RPC transaction",
);
assert.ok(
  !atomicMigration.includes("public.memory_items"),
  "atomic candidate migration must not touch canonical memory",
);
assert.ok(
  !/delete\s+from\s+public\.(?:memory_|audit_logs)/i.test(atomicMigration),
  "atomic candidate migration must not delete Memory or audit rows",
);

const dispatch = bridge.slice(serveStart);
assert.ok(dispatch.includes('body.action === "submit_evidence_candidate"'), "evidence dispatch missing");
assert.ok(
  dispatch.indexOf('body.action === "submit_evidence_candidate"') <
    dispatch.indexOf('body.action === "search"'),
  "evidence dispatch must be explicit before search/unsupported fallback",
);

console.log("Governed Memory evidence intake source contract: PASS");
