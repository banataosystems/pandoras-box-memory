#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { argv, exit } from "node:process";

const M = "supabase/migrations/20260819000100_enforce_memory_canon_promotion_gate.sql";
const E = "docs/capabilities/evidence/MEMORY_CANON_PROMOTION_GATE_2026-08-19.json";
const S = `${E}.sha256`;
const sha = (x) => createHash("sha256").update(x, "utf8").digest("hex");
const clone = (x) => JSON.parse(JSON.stringify(x));
const H40 = /^[0-9a-f]{40}$/;
const H64 = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const PLANS = new Set([
  "62026a32-9bbb-4441-9f75-203906b73b31", "a0ba735f-d23f-4d14-b13d-e77fe27dccbd",
  "0c2adef8-2372-4823-a5c7-8c5cabadb417", "3b985644-7893-41b7-b356-a76fd7e16937",
  "65fe78ea-8bce-4057-abd0-9928c75b4597", "9c306b09-ebec-4585-9ff3-c12e4537deea",
  "76c1d531-a1dc-485d-a2e4-cf0cef75227d",
]);

function keys(v, wanted, label, e) {
  if (!v || typeof v !== "object" || Array.isArray(v)) return e.push(`${label} must be an object`);
  const got = Object.keys(v).sort().join("|");
  const expected = [...wanted].sort().join("|");
  if (got !== expected) e.push(`${label} keys changed: ${got}`);
}
function req(ok, msg, e) { if (!ok) e.push(msg); }
function forbiddenKeys(v, path, e) {
  if (Array.isArray(v)) return v.forEach((x, i) => forbiddenKeys(x, `${path}[${i}]`, e));
  if (!v || typeof v !== "object") return;
  for (const [k, x] of Object.entries(v)) {
    if (/^(user_id|email|phone|message|message_body|credential|credential_value|secret|secret_value|token|token_value|password|jwt)$/i.test(k)) e.push(`${path}.${k} forbidden`);
    forbiddenKeys(x, `${path}.${k}`, e);
  }
}

export function validateSql(raw) {
  const s = raw.replace(/\r\n/g, "\n");
  const l = s.toLowerCase();
  const e = [];
  req(/drop\s+policy\s+if\s+exists\s+memory_items_insert_own\s+on\s+public\.memory_items\s*;/i.test(s), "policy not deterministically replaced", e);
  req(/create\s+policy\s+memory_items_insert_own\s+on\s+public\.memory_items\s+for\s+insert\s+to\s+authenticated\s+with\s+check\s*\(/i.test(s), "insert policy missing", e);
  for (const p of [
    "auth.uid() = user_id", "canon_status = 'draft'::public.canon_status", "approved_by is null",
    "approved_at is null", "effective_at is null", "superseded_by is null", "superseded_at is null",
    "revoked_at is null", "revocation_reason is null", "is_active is true",
  ]) req(l.includes(p), `policy missing ${p}`, e);
  req(l.includes("if p_canon_status is distinct from 'draft'::public.canon_status then"), "non-draft guard missing", e);
  req(l.includes("raise exception 'candidate_canon_status_must_be_draft'"), "stable rejection missing", e);
  req(/p_confidence\s*,\s*'draft'::public\.canon_status\s*,\s*p_source_summary/i.test(s), "insert not literal draft", e);
  req(!/p_confidence\s*,\s*p_canon_status\s*,\s*p_source_summary/i.test(s), "caller status reaches insert", e);
  req(l.split("p_canon_status").length - 1 === 2, "p_canon_status appears outside signature/guard", e);
  req(/revoke\s+all\s+on\s+function\s+public\.save_validated_memory_candidate_transaction\([\s\S]*?\)\s+from\s+public\s*,\s*anon\s*,\s*authenticator\s*;/i.test(s), "unsafe execute roles not revoked", e);
  req(/grant\s+execute\s+on\s+function\s+public\.save_validated_memory_candidate_transaction\([\s\S]*?\)\s+to\s+authenticated\s*,\s*service_role\s*;/i.test(s), "safe execute grant missing", e);
  req(!/grant\s+execute[\s\S]*?\bto\s+(public|anon|authenticator)\b/i.test(s), "unsafe execute grant", e);
  for (const r of [/\bdrop\s+table\b/i,/\btruncate\b/i,/\bdelete\s+from\s+public\.memory_items\b/i,/\bupdate\s+public\.memory_items\b/i,/\balter\s+type\s+public\.canon_status\b/i]) req(!r.test(s), `destructive SQL: ${r}`, e);
  for (const r of [/service[_-]?role[_-]?key\s*[:=]/i,/supabase[_-]?access[_-]?token\s*[:=]/i,/postgres(?:ql)?:\/\//i,/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/]) req(!r.test(s), "literal secret pattern", e);
  return e;
}

export function validateEvidence(x, migration) {
  const e = [];
  keys(x,["schema_version","evidence_id","captured_at","project","lane","finding","candidate","provider_proofs","recovery_observations","safety","proof_ladder"],"root",e);
  req(x?.schema_version === "1.0.0", "bad schema", e);
  req(x?.evidence_id === "memory-canon-promotion-gate-2026-08-19", "bad evidence id", e);
  req(typeof x?.captured_at === "string" && x.captured_at.endsWith("Z") && !Number.isNaN(Date.parse(x.captured_at)), "bad captured_at", e);
  keys(x?.project,["repository","canonical_main_at_capture","canonical_main_tree_at_capture","supabase_project_ref"],"project",e);
  req(x?.project?.repository === "banataosystems/pandoras-box-memory", "wrong repo", e);
  req(H40.test(x?.project?.canonical_main_at_capture ?? "") && H40.test(x?.project?.canonical_main_tree_at_capture ?? ""), "bad git identity", e);
  req(x?.project?.supabase_project_ref === "ivmvufhcsezyhczzondn", "wrong project", e);
  keys(x?.lane,["worker","branch","worker_1_paths_modified","parity_evidence_paths_modified"],"lane",e);
  req(x?.lane?.worker === "Pandora Worker 2 — Supabase / Memory Source Parity / Recovery", "wrong worker", e);
  req(x?.lane?.branch === "security/memory-canon-promotion-gate-20260819", "wrong branch", e);
  req(x?.lane?.worker_1_paths_modified === false && x?.lane?.parity_evidence_paths_modified === false, "lane boundary crossed", e);
  keys(x?.finding,["classification","current_boundary_permits_authenticated_non_draft_insert","current_insert_policy_expression","current_function_definition_sha256","origin_migration_version","origin_migration_name","origin_statement_sha256","authenticated_update_or_delete_policy_present","candidate_rpc_trace_count","existing_rows_reclassified"],"finding",e);
  req(x?.finding?.classification === "security_correctness_defect", "finding changed", e);
  req(x?.finding?.current_boundary_permits_authenticated_non_draft_insert === true, "finding erased", e);
  req(x?.finding?.current_insert_policy_expression === "(auth.uid() = user_id)", "live policy changed", e);
  req(H64.test(x?.finding?.current_function_definition_sha256 ?? "") && H64.test(x?.finding?.origin_statement_sha256 ?? ""), "bad source hash", e);
  req(x?.finding?.origin_migration_version === "20260620000500" && x?.finding?.origin_migration_name === "memory_candidate_transaction", "origin changed", e);
  req(x?.finding?.authenticated_update_or_delete_policy_present === false && x?.finding?.candidate_rpc_trace_count === 0 && x?.finding?.existing_rows_reclassified === 0, "live boundary/recovery facts changed", e);
  keys(x?.candidate,["migration_path","migration_sha256","behavior","data_rewrite","destructive_ddl","rollback_classification","transaction_rollback_verified"],"candidate",e);
  req(x?.candidate?.migration_path === M && x?.candidate?.migration_sha256 === sha(migration), "migration bytes detached", e);
  req(x?.candidate?.behavior === "authenticated candidate creation is draft-only; canonical promotion remains service-role and review-gated", "behavior changed", e);
  req(x?.candidate?.data_rewrite === false && x?.candidate?.destructive_ddl === false, "unsafe candidate", e);
  req(x?.candidate?.rollback_classification === "forward_recovery" && x?.candidate?.transaction_rollback_verified === true, "false rollback claim", e);
  const proofs = Array.isArray(x?.provider_proofs) ? x.provider_proofs : [];
  req(proofs.length === PLANS.size, "proof count changed", e);
  const seen = new Set();
  proofs.forEach((p,i) => {
    keys(p,["plan_id","proof","persistent_mutation"],`proof[${i}]`,e);
    req(UUID.test(p?.plan_id ?? "") && !seen.has(p.plan_id), `bad/duplicate plan ${p?.plan_id}`, e);
    seen.add(p?.plan_id);
    req(typeof p?.proof === "string" && p.proof.length >= 20 && p?.persistent_mutation === false, `invalid proof ${p?.plan_id}`, e);
  });
  for (const p of PLANS) req(seen.has(p), `missing plan ${p}`, e);
  keys(x?.recovery_observations,["hard_canon_rows_observed","hard_canon_rows_without_governance_evidence","unrestricted_candidate_rpc_trace_count","unproven_rows_automatically_changed","required_next_action"],"recovery",e);
  req(x?.recovery_observations?.hard_canon_rows_observed === 239 && x?.recovery_observations?.hard_canon_rows_without_governance_evidence === 87, "row counts changed", e);
  req(x?.recovery_observations?.unrestricted_candidate_rpc_trace_count === 0 && x?.recovery_observations?.unproven_rows_automatically_changed === 0, "unproven data changed", e);
  req(x?.recovery_observations?.required_next_action === "independent provenance review; do not downgrade or delete rows without row-level evidence", "recovery instruction changed", e);
  const safety=["production_schema_mutated","production_data_mutated","migration_replayed","edge_function_deployed","supabase_branch_created","new_cost_incurred","production_release_performed","secret_values_recorded","direct_user_identifiers_recorded"];
  keys(x?.safety,safety,"safety",e); for (const k of safety) req(x?.safety?.[k] === false, `safety.${k} must be false`, e);
  const ladder=["documented","implemented","source_tested","transaction_tested","independently_reviewed","merged","deployed","production_verified_after_repair"];
  keys(x?.proof_ladder,ladder,"proof ladder",e);
  for (const k of ladder.slice(0,4)) req(x?.proof_ladder?.[k] === true, `${k} must be true`, e);
  for (const k of ladder.slice(4)) req(x?.proof_ladder?.[k] === false, `${k} must be false`, e);
  forbiddenKeys(x,"evidence",e);
  const text=JSON.stringify(x);
  for (const r of [/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i,/postgres(?:ql)?:\/\//i,/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/]) req(!r.test(text), "secret/direct identifier in evidence", e);
  return e;
}

function selfTest(sql,evidence) {
  const sqlCases=[
    [sql,false],[sql.replace("canon_status = 'draft'::public.canon_status","canon_status = 'soft_canon'::public.canon_status"),true],
    [sql.replace("IF p_canon_status IS DISTINCT FROM 'draft'::public.canon_status THEN","IF FALSE THEN"),true],
    [sql.replace("'draft'::public.canon_status,\n    p_source_summary","p_canon_status,\n    p_source_summary"),true],
    [sql.replace("  AND approved_by IS NULL\n",""),true],[sql.replace("FROM PUBLIC, anon, authenticator;","FROM anon, authenticator;"),true],
    [sql.replace("TO authenticated, service_role;","TO authenticated, service_role, PUBLIC;"),true],[`${sql}\nTRUNCATE public.memory_items;\n`,true],
  ];
  const mut=(f)=>{const x=clone(evidence);f(x);return x;};
  const evCases=[
    [evidence,false],[mut(x=>x.safety.production_schema_mutated=true),true],[mut(x=>x.proof_ladder.production_verified_after_repair=true),true],
    [mut(x=>x.candidate.migration_sha256="0".repeat(64)),true],[mut(x=>x.production_verified=true),true],[mut(x=>x.provider_proofs.pop()),true],
    [mut(x=>x.provider_proofs[0].persistent_mutation=true),true],[mut(x=>x.candidate.rollback_classification="rollback_qualified"),true],
    [mut(x=>x.recovery_observations.unproven_rows_automatically_changed=87),true],[mut(x=>x.finding.email="owner@example.com"),true],
    [mut(x=>x.provider_proofs[0].plan_id="00000000-0000-4000-8000-000000000000"),true],
  ];
  let failures=0;
  for (const [v,reject] of sqlCases) if ((validateSql(v).length>0)!==reject) failures++;
  for (const [v,reject] of evCases) if ((validateEvidence(v,sql).length>0)!==reject) failures++;
  if (failures) { console.error(`Self-test failures: ${failures}`); exit(1); }
  console.log(`Canon-promotion self-test passed (${sqlCases.length+evCases.length} cases).`);
}

const migration=readFileSync(M,"utf8");
const evidenceRaw=readFileSync(E,"utf8");
const evidence=JSON.parse(evidenceRaw);
if (argv.includes("--self-test")) selfTest(migration,evidence);
const errors=[...validateSql(migration),...validateEvidence(evidence,migration)];
const side=readFileSync(S,"utf8").trim().split(/\s+/);
if (side.length!==2 || !H64.test(side[0]??"") || side[1]!==E || side[0]!==sha(evidenceRaw)) errors.push("evidence sidecar mismatch");
if (errors.length) { console.error("Canon-promotion gate FAILED:"); errors.forEach(x=>console.error(`  - ${x}`)); exit(1); }
console.log(`Canon-promotion gate passed: migration ${sha(migration)}; evidence ${sha(evidenceRaw)}.`);
