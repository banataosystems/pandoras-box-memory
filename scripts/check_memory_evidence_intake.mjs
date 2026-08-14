import fs from "node:fs";
import assert from "node:assert/strict";
import ts from "typescript";

const routePath = "app/api/projectos/memory/evidence-candidates/route.ts";
const bridgePath = "supabase/functions/pandora-projectos-bridge/index.ts";

const route = fs.readFileSync(routePath, "utf8");
const bridge = fs.readFileSync(bridgePath, "utf8");

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
  "evidenceSensitiveReason",
  '"direct_identifier_email"',
  '"credential_signature"',
  '"jwt_signature"',
  '"secret_assignment"',
  '.from("memory_capture_candidates")',
  'memory_type: "business_fact"',
  "requires_review: true",
  'status: "pending"',
  '.from("memory_review_queue_items")',
  "candidate_type: EVIDENCE_CANDIDATE_TYPE",
  'status: "pending_review"',
  'proposed_operation: "append"',
  "canonical_memory_written: false",
  'privacy_policy: "metadata_only_v1"',
  'body.action === "submit_evidence_candidate"',
]) {
  assert.ok(bridge.includes(marker), `bridge marker missing: ${marker}`);
}

const helperStart = bridge.indexOf("const EVIDENCE_PROOF_STAGES");
const serveStart = bridge.search(/Deno\.serve\(/);
assert.ok(helperStart >= 0 && serveStart > helperStart, "evidence helper boundary missing");

const helper = bridge.slice(helperStart, serveStart);
assert.ok(!helper.includes('.from("memory_items")'), "candidate helper must not access canonical memory_items");
assert.ok(!helper.includes("hard_canon"), "candidate helper must not promote hard canon");
assert.ok(!helper.includes("soft_canon"), "candidate helper must not promote soft canon");
assert.ok(helper.includes("raw_excerpt: null"), "candidate helper must force raw excerpt null");
assert.ok(helper.includes("imported_personal_identifiers: false"), "privacy metadata missing");
assert.ok(helper.includes("imported_secrets: false"), "secret exclusion metadata missing");

const dispatch = bridge.slice(serveStart);
assert.ok(dispatch.includes('body.action === "submit_evidence_candidate"'), "evidence dispatch missing");
assert.ok(
  dispatch.indexOf('body.action === "submit_evidence_candidate"') <
    dispatch.indexOf('body.action === "search"'),
  "evidence dispatch must be explicit before search/unsupported fallback",
);

console.log("Governed Memory evidence intake source contract: PASS");
