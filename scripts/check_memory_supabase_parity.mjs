#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { argv, exit } from "node:process";

const ROOT = process.cwd();
const OBS = "docs/provider-observations/PANDORA_SUPABASE_PROVIDER_OBSERVATION_2026-08-19.json";
const MATRIX = "docs/recovery/PANDORA_SUPABASE_RECOVERY_MATRIX_2026-08-19.json";
const REPORT = "docs/recovery/PANDORA_SUPABASE_RECOVERY_REPORT_2026-08-19.md";
const EXPECTED_PROJECT = "ivmvufhcsezyhczzondn";
const HEX40 = /^[0-9a-f]{40}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");
const clone = (x) => JSON.parse(JSON.stringify(x));
const weakEtag = (buf) => `W/"${Buffer.byteLength(buf).toString(16)}-${createHash("sha1").update(buf).digest("base64").slice(0, 27)}"`;

function verifySidecar(path) {
  const raw = readFileSync(path);
  const sidecar = readFileSync(`${path}.sha256`, "utf8").trim();
  const match = sidecar.match(/^([0-9a-f]{64})  (.+)$/);
  if (!match) return [`${path}.sha256 has invalid format`];
  const expectedRelative = path;
  const errors = [];
  if (match[2] !== expectedRelative) errors.push(`${path}.sha256 names ${match[2]}, expected ${expectedRelative}`);
  if (match[1] !== sha256(raw)) errors.push(`${path}.sha256 digest mismatch`);
  return errors;
}

export function validateObservation(d) {
  const e = [];
  const requireFalse = (v, label) => { if (v !== false) e.push(`${label} must be false`); };
  if (d?.schema_version !== "2.0.0") e.push("schema_version must be 2.0.0");
  if (d?.observation_id !== "pandora-memory-supabase-source-parity-2026-08-19") e.push("unexpected observation_id");
  if (!d?.captured_at?.endsWith("Z") || Number.isNaN(Date.parse(d.captured_at))) e.push("captured_at must be UTC ISO-8601");
  if (d?.authority?.canonical_context?.degraded !== true) e.push("canonical freshness degradation was erased");
  if (d?.source?.repository !== "banataosystems/pandoras-box-memory") e.push("wrong canonical repository");
  for (const key of ["canonical_main_at_capture","canonical_main_tree_at_capture","base_commit","base_tree"]) {
    if (!HEX40.test(d?.source?.[key] ?? "")) e.push(`source.${key} must be a full Git object id`);
  }
  if (d?.source?.worker_branch !== "recovery/memory-supabase-source-parity-20260819") e.push("wrong Worker 2 branch");
  if (d?.source?.closed_predecessor?.state !== "closed_unmerged") e.push("closed predecessor state changed");
  if (d?.provider_transport?.implementation_owner !== "worker_1_issue_55") e.push("Worker 1 boundary missing");
  requireFalse(d?.provider_transport?.worker_2_changed_connector_code, "provider_transport.worker_2_changed_connector_code");

  const p = d?.project ?? {};
  if (p.project_ref !== EXPECTED_PROJECT || p.name !== "Memory") e.push("wrong project identity");
  if (p.region !== "ap-southeast-2" || p.status !== "ACTIVE_HEALTHY" || p.postgres_version !== "17.6.1.147") e.push("project metadata drift");
  if (!UUID.test(p?.default_branch?.id ?? "")) e.push("invalid default branch id");
  if (p?.branch_list?.inventory_complete !== false || p?.branch_list?.non_default_branch_count !== null || p?.branch_list?.current_branch_cost_usd_per_hour !== null) e.push("unverified branch inventory/cost was promoted");

  const m = d?.migrations ?? {};
  const rows = Array.isArray(m.ordered_identities) ? m.ordered_identities : [];
  if (rows.length !== 68 || m.live_count !== 68) e.push("migration count must be 68");
  const seen = new Set();
  let last = "";
  for (const row of rows) {
    if (!/^\d{14}$/.test(row?.version ?? "") || typeof row?.name !== "string" || !row.name) e.push("invalid migration identity row");
    const k = `${row.version}:${row.name}`;
    if (seen.has(k)) e.push(`duplicate migration ${k}`);
    seen.add(k);
    if (row.version <= last) e.push("migration versions must be strictly increasing");
    last = row.version;
  }
  const payload = Buffer.from(JSON.stringify(rows.map(({version,name}) => ({version,name}))));
  if (payload.length !== 5018 || m.ordered_identity_payload_bytes !== 5018) e.push("migration identity payload byte count mismatch");
  const identityHash = sha256(payload);
  if (identityHash !== "0d6110e17a01304eebb57cca57369f7b9b6961eb7a23b2c40871c8d90f5da0f3" || m.ordered_identity_payload_sha256 !== identityHash) e.push("migration identity SHA-256 mismatch");
  const etag = weakEtag(payload);
  if (etag !== 'W/"139a-Rb+o60KCJ/jLFibPKSwymerAMcU"' || m.list_head_etag !== etag || m.computed_weak_etag !== etag || m.etag_match !== true) e.push("migration provider ETag proof mismatch");
  const c = m.classifications ?? {};
  const classTotal = [c.A_exact_source_match,c.B_authentic_source_recovered,c.C_identity_recovered_source_missing,c.D_sanitized_recovery_artifact,c.E_source_divergence,c.F_unknown].reduce((a,b)=>a+(Number.isInteger(b)?b:0),0);
  if (classTotal !== 68 || c.A_exact_source_match !== 14 || c.C_identity_recovered_source_missing !== 53 || c.D_sanitized_recovery_artifact !== 1) e.push("migration source classifications changed");
  if (m.rollback_metadata_present !== 0 || m.source_parity_complete !== false || m.reconstruction_status !== "partial") e.push("migration recovery limits were overstated");

  const f = d?.edge_functions ?? {};
  if (f.inventory_complete !== false || f.live_bundle_source_fetched !== false || f.exact_executable_diff_complete !== false || f.comment_only_equivalence_freshly_proven !== false) e.push("Edge parity was overstated");
  const expectedFunctions = new Map([
    ["pandora-projectos-bridge", [13,"3c63c366389e9cc294b548643738b06d0e594a6ee064a6976dd558e489f5fe0a"]],
    ["pandora-projectos-learning", [1,"eec5a67e3e9af88850aa2a0e98dca7a344a54086b51166b5cc0a91e2b0ac82fe"]],
    ["pandora-machine-gateway", [3,"6dcdce080275161311a3a872c821db826d09adc02eee5ff9866fcb406d02a30f"]],
  ]);
  const funcs = Array.isArray(f.minimum_relevant_exact_reads) ? f.minimum_relevant_exact_reads : [];
  if (funcs.length !== 3) e.push("expected exactly three required Edge metadata records");
  for (const fn of funcs) {
    const expected = expectedFunctions.get(fn.slug);
    if (!expected || fn.version !== expected[0] || fn.provider_source_hash !== expected[1] || fn.status !== "ACTIVE" || !UUID.test(fn.id ?? "")) e.push(`Edge metadata mismatch for ${fn?.slug ?? "unknown"}`);
  }

  const s = d?.security_and_database_inventory ?? {};
  const a = s.security_advisors ?? {};
  if (a.total !== 27 || a.info_rls_enabled_no_policy !== 21 || a.warn_mutable_function_search_path !== 4 || a.warn_extension_in_public !== 1 || a.warn_leaked_password_protection_disabled !== 1) e.push("security advisor summary mismatch");
  for (const key of ["schemas","tables_columns_constraints_indexes","privilege_inventory","security_definer_inventory","trigger_inventory","scheduled_job_inventory"]) {
    if (s?.[key]?.inventory !== null || !["blocked","historical_only_not_fresh"].includes(s?.[key]?.status)) e.push(`${key} was promoted without catalog proof`);
  }

  if (d?.recovery?.overall_reconstructability !== "partial" || d?.recovery?.rollback_qualified !== false || d?.recovery?.known_good_database_rollback_point !== null || d?.recovery?.forward_recovery_required !== true) e.push("recovery qualification is unsafe");
  for (const [k,v] of Object.entries(d?.safety ?? {})) requireFalse(v, `safety.${k}`);

  const raw = JSON.stringify(d);
  const forbiddenKeys = /"(created_by|password|access_token|refresh_token|service_role_key|jwt_secret|hmac_secret|private_key)"\s*:/i;
  const literalSecret = /(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,}|sb_secret_[A-Za-z0-9_-]{20,}|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}|-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----)/;
  if (forbiddenKeys.test(raw)) e.push("forbidden sensitive/direct-identifier key persisted");
  if (literalSecret.test(raw)) e.push("literal secret pattern persisted");
  return e;
}

export function validateMatrix(d) {
  const e = [];
  if (d?.schema_version !== "1.0.0" || d?.project_ref !== EXPECTED_PROJECT) e.push("invalid recovery matrix identity");
  const rows = Array.isArray(d?.subsystems) ? d.subsystems : [];
  const expected = ["migration_ledger","memory_schema","projectos_lifecycle","review_promotion_system","outbox","scheduled_jobs","pandora_projectos_bridge","pandora_projectos_learning","pandora_machine_gateway","web_api_runtime"];
  if (rows.length !== expected.length || rows.map(x=>x.subsystem).join("|") !== expected.join("|")) e.push("recovery matrix subsystem coverage mismatch");
  if (rows.some(x => x.rollback_qualified !== false || typeof x.forward_recovery !== "string" || !x.forward_recovery)) e.push("unqualified rollback or missing forward recovery");
  if (d?.summary?.rollback_qualified_subsystems !== 0 || d?.summary?.forward_recovery_required_subsystems !== 10 || d?.summary?.production_mutation_performed !== false) e.push("recovery matrix summary mismatch");
  return e;
}

function selfTest(observation, matrix) {
  const cases = [];
  const reject = (name, mutate, needle) => {
    const copy = clone(observation); mutate(copy);
    const errors = validateObservation(copy);
    if (!errors.some(x => x.includes(needle))) throw new Error(`${name}: expected rejection containing ${needle}; got ${errors.join(" | ")}`);
    cases.push(name);
  };
  if (validateObservation(observation).length) throw new Error(`positive observation failed: ${validateObservation(observation).join(" | ")}`);
  if (validateMatrix(matrix).length) throw new Error(`positive matrix failed: ${validateMatrix(matrix).join(" | ")}`);
  cases.push("positive");
  reject("changed migration etag", x => x.migrations.list_head_etag = 'W/"1-bad"', "ETag");
  reject("changed migration count", x => x.migrations.live_count = 67, "count");
  reject("changed migration identity", x => x.migrations.ordered_identities[0].name += "_drift", "SHA-256");
  reject("changed function hash", x => x.edge_functions.minimum_relevant_exact_reads[0].provider_source_hash = "0".repeat(64), "Edge metadata");
  reject("false complete function inventory", x => x.edge_functions.inventory_complete = true, "Edge parity");
  reject("false schema inventory", x => x.security_and_database_inventory.schemas = {status:"verified", inventory:[]}, "schemas");
  reject("false rollback qualification", x => x.recovery.rollback_qualified = true, "recovery qualification");
  reject("production mutation", x => x.safety.production_database_mutation = true, "must be false");
  reject("secret literal", x => x.debug = "s" + "k-" + "abcdefghijklmnopqrstuvwxyz123456", "literal secret");
  reject("direct identifier key", x => x.created_by = "someone", "forbidden sensitive");
  const matrixCopy = clone(matrix); matrixCopy.subsystems[0].rollback_qualified = true;
  if (!validateMatrix(matrixCopy).some(x=>x.includes("rollback"))) throw new Error("matrix unsafe rollback mutation was accepted");
  cases.push("matrix unsafe rollback");
  console.log(`Self-test passed: ${cases.length} cases`);
}

const observation = JSON.parse(readFileSync(OBS, "utf8"));
const matrix = JSON.parse(readFileSync(MATRIX, "utf8"));
let errors = [...verifySidecar(OBS), ...verifySidecar(MATRIX), ...verifySidecar(REPORT), ...validateObservation(observation), ...validateMatrix(matrix)];
if (argv.includes("--self-test")) {
  try { selfTest(observation, matrix); } catch (error) { errors.push(error.message); }
}
if (errors.length) {
  for (const error of errors) console.error(`ERROR: ${error}`);
  exit(1);
}
console.log("Pandora Memory Supabase parity evidence verified.");
console.log(`Migration identities: ${observation.migrations.live_count}; payload SHA-256: ${observation.migrations.ordered_identity_payload_sha256}`);
console.log(`Required Edge metadata records: ${observation.edge_functions.minimum_relevant_exact_reads.length}; full inventory complete: ${observation.edge_functions.inventory_complete}`);
console.log(`Rollback qualified: ${observation.recovery.rollback_qualified}; forward recovery required: ${observation.recovery.forward_recovery_required}`);
