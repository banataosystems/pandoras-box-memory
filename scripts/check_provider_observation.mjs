#!/usr/bin/env node
// Fail-closed freshness gate for the 2026-08-19 Worker 2 Supabase readback.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { argv, exit } from "node:process";

const PATH = "docs/provider-observations/PANDORA_SUPABASE_PROVIDER_OBSERVATION_2026-08-19.json";
const SIDECAR = `${PATH}.sha256`;
const REF = "ivmvufhcsezyhczzondn";
const HEX40 = /^[0-9a-f]{40}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const REQUIRED = [
  "supabase.get_project",
  "supabase.list_migrations",
  "supabase.execute_sql.identity",
  "projectos.supabase.list-accounts",
];
const hash = (s) => createHash("sha256").update(s, "utf8").digest("hex");
const copy = (x) => JSON.parse(JSON.stringify(x));

export function validateObservation(d) {
  const e = [];
  const requireFalse = (value, label) => {
    if (value !== false) e.push(`${label} must be false`);
  };

  if (d?.schema_version !== "1.0.0") e.push("schema_version must be 1.0.0");
  if (d?.observation_id !== "pandora-supabase-provider-observation-2026-08-19") {
    e.push("unexpected observation_id");
  }
  if (typeof d?.captured_at !== "string" || Number.isNaN(Date.parse(d.captured_at)) || !d.captured_at.endsWith("Z")) {
    e.push("captured_at must be an ISO-8601 UTC timestamp");
  }
  if (d?.capture_status !== "blocked_fail_closed") {
    e.push("capture_status must remain blocked_fail_closed");
  }

  const s = d?.source ?? {};
  if (s.repository !== "banataosystems/pandoras-box-memory") e.push("non-canonical repository");
  if (s.branch !== "recovery/memory-supabase-provider-observation-20260819") {
    e.push("non-dedicated Worker 2 branch");
  }
  for (const k of ["base_head", "base_tree", "canonical_main_at_capture", "canonical_main_tree_at_capture"]) {
    if (!HEX40.test(s[k] ?? "")) e.push(`source.${k} must be a full Git object id`);
  }

  const p = d?.provider ?? {};
  if (p.name !== "supabase" || p.project_ref !== REF) e.push("wrong provider identity");
  for (const k of ["production_mutation_performed", "branch_created", "new_cost_incurred", "secret_values_recorded"]) {
    requireFalse(p[k], `provider.${k}`);
  }

  const c = d?.authority?.canonical_context ?? {};
  if (c.degraded !== true) e.push("freshness degradation was erased");
  if (!Array.isArray(c.fallback_authority) || !c.fallback_authority.includes("github") || !c.fallback_authority.includes("supabase")) {
    e.push("fallback authority must include github and supabase");
  }

  const attempts = Array.isArray(d?.read_attempts) ? d.read_attempts : [];
  const ids = new Set();
  for (const a of attempts) {
    if (typeof a?.attempt_id !== "string") {
      e.push("attempt without attempt_id");
      continue;
    }
    if (ids.has(a.attempt_id)) e.push(`duplicate attempt ${a.attempt_id}`);
    ids.add(a.attempt_id);
    requireFalse(a.authoritative_success, `${a.attempt_id}.authoritative_success`);
    requireFalse(a.mutation_performed, `${a.attempt_id}.mutation_performed`);
    requireFalse(a.secret_values_recorded, `${a.attempt_id}.secret_values_recorded`);
  }
  for (const id of REQUIRED) if (!ids.has(id)) e.push(`missing required attempt ${id}`);

  const ledgerRead = attempts.find((a) => a.attempt_id === "supabase.list_migrations");
  if (ledgerRead?.outcome !== "authorization_denied") e.push("migration denial not preserved");
  const accountRead = attempts.find((a) => a.attempt_id === "projectos.supabase.list-accounts");
  if (
    accountRead?.outcome !== "connector_response_schema_rejected" ||
    accountRead?.provider_response_shape !== "array" ||
    accountRead?.connector_expected_shape !== "object" ||
    accountRead?.implementation_changed_by_worker_2 !== false
  ) e.push("Worker 1 account-list schema failure not preserved exactly");

  const old = d?.last_preserved_migration_observation ?? {};
  const cls = old.classifications ?? {};
  if (old.migration_count !== 68 || (cls.authentic ?? 0) + (cls.sanitized ?? 0) + (cls.missing ?? 0) !== 68) {
    e.push("historical 68-entry classification does not balance");
  }
  if (old.current_as_of_capture !== false || old.readback_status !== "not_reverified") {
    e.push("historical migration ledger promoted to current");
  }

  const edge = d?.last_preserved_edge_observation ?? {};
  if (edge.current_as_of_capture !== false || edge.readback_status !== "not_reverified") {
    e.push("historical Edge observation promoted to current");
  }
  for (const f of edge.functions ?? []) {
    if (f.status !== "historical_not_reverified") e.push(`${f.slug ?? "Edge Function"} promoted to current`);
  }

  const live = d?.current_live_state ?? {};
  requireFalse(live.verified, "current_live_state.verified");
  requireFalse(live.production_verified, "current_live_state.production_verified");
  requireFalse(live.reconstruction_verified, "current_live_state.reconstruction_verified");
  for (const k of [
    "migration_count", "migration_ledger_sha256", "schema_inventory",
    "rls_policy_inventory", "privilege_inventory", "security_definer_inventory",
    "trigger_inventory", "scheduled_job_inventory", "edge_function_inventory",
    "edge_function_source_hashes", "security_advisors",
  ]) if (live[k] !== null) e.push(`current_live_state.${k} must remain null`);

  requireFalse(d?.coupled_runtime_readback?.production_release_performed, "production_release_performed");
  if (!Array.isArray(d?.next_required_capture?.requirements) || d.next_required_capture.requirements.length < 5) {
    e.push("read-only proof gap is incomplete");
  }
  return e;
}

function selfTest() {
  const base = JSON.parse(readFileSync(PATH, "utf8"));
  const mutate = (fn) => { const x = copy(base); fn(x); return x; };
  const cases = [
    ["valid", base, false],
    ["stale count current", mutate((x) => { x.current_live_state.migration_count = 68; }), true],
    ["historical ledger current", mutate((x) => { x.last_preserved_migration_observation.current_as_of_capture = true; }), true],
    ["production mutation", mutate((x) => { x.provider.production_mutation_performed = true; }), true],
    ["secret recorded", mutate((x) => { x.read_attempts[0].secret_values_recorded = true; }), true],
    ["migration denial omitted", mutate((x) => { x.read_attempts = x.read_attempts.filter((a) => a.attempt_id !== "supabase.list_migrations"); }), true],
    ["schema rejection rewritten", mutate((x) => { x.read_attempts.find((a) => a.attempt_id === "projectos.supabase.list-accounts").outcome = "success"; }), true],
    ["classification mismatch", mutate((x) => { x.last_preserved_migration_observation.classifications.missing = 52; }), true],
    ["reconstruction invented", mutate((x) => { x.current_live_state.reconstruction_verified = true; }), true],
  ];
  let failed = 0;
  for (const [name, value, reject] of cases) {
    const rejected = validateObservation(value).length > 0;
    if (rejected !== reject) {
      console.error(`SELF-TEST FAIL: ${name}: expected ${reject ? "rejection" : "acceptance"}`);
      failed += 1;
    }
  }
  if (failed) exit(1);
  console.log(`Provider-observation self-test passed (${cases.length} cases).`);
}

function main() {
  if (argv.includes("--self-test")) selfTest();
  const raw = readFileSync(PATH, "utf8");
  const errors = validateObservation(JSON.parse(raw));
  const [recorded, path, ...extra] = readFileSync(SIDECAR, "utf8").trim().split(/\s+/);
  const actual = hash(raw);
  if (extra.length || !HEX64.test(recorded ?? "") || path !== PATH) {
    errors.push("invalid digest sidecar");
  } else if (recorded !== actual) {
    errors.push(`observation drift: indexed ${recorded}, actual ${actual}`);
  }
  if (errors.length) {
    console.error("Provider-observation gate FAILED:");
    for (const error of errors) console.error(`  - ${error}`);
    exit(1);
  }
  console.log(`Provider-observation gate passed: ${actual}; current production facts remain null.`);
}
main();
