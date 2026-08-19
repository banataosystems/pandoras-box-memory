#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const P = {
  sql: "docs/provider-observations/memory-supabase-20260819/scheduled-jobs/SCHEDULED_JOBS_CAPTURE.sql",
  capture: "docs/provider-observations/memory-supabase-20260819/scheduled-jobs/CAPTURE_2026-08-19T030551Z.json",
  timeline: "docs/provider-observations/memory-supabase-20260819/scheduled-jobs/OBSERVATION_TIMELINE.json",
  report: "docs/recovery/PANDORA_SUPABASE_SCHEDULED_JOB_DRIFT_2026-08-19.md",
  capability: "docs/capabilities/evidence/MEMORY_SUPABASE_LIVE_CATALOG_2026-08-19.json",
  verifier: "scripts/check_memory_supabase_scheduled_jobs.mjs",
  workflow: ".github/workflows/memory-supabase-catalog-evidence.yml",
};
const buf = p => readFileSync(p);
const obj = p => JSON.parse(readFileSync(p, "utf8"));
const sha = x => createHash("sha256").update(x).digest("hex");
const hex = x => /^[0-9a-f]{64}$/.test(x ?? "");
const copy = x => structuredClone(x);

function validate(x) {
  const e = [];
  const ok = (v, m) => { if (!v) e.push(m); };
  const { capture: c, timeline: t, capability: k, content } = x;
  const s = k.source ?? {};
  const pins = {
    sql: s.scheduled_job_query_sha256,
    capture: s.scheduled_job_capture_sha256,
    timeline: s.scheduled_job_timeline_sha256,
    report: s.scheduled_job_report_sha256,
    verifier: s.scheduled_job_verifier_sha256,
    workflow: s.workflow_sha256,
  };
  for (const [name, expected] of Object.entries(pins)) {
    ok(hex(expected), `${name}: missing pin`);
    ok(expected === sha(content[name]), `${name}: pin mismatch`);
  }

  ok(c.status === "captured_read_only", "capture not read-only");
  ok(c.provider?.project_ref === "ivmvufhcsezyhczzondn", "project drift");
  ok(c.provider?.capture_role === "supabase_read_only_user", "capture-role drift");
  ok(c.source_binding?.query_path === P.sql, "query-path drift");
  ok(c.source_binding?.query_bytes === Buffer.byteLength(content.sql), "query-byte drift");
  ok(c.source_binding?.query_sha256 === sha(content.sql), "query-digest drift");
  ok(c.projectos?.plan_id === "f632066d-3b69-4c15-b955-dcd744d6cdde", "plan drift");
  ok(c.projectos?.request_id === "14d016ae-16ee-4ae5-9e70-5e8265c50ada", "request drift");
  ok(c.projectos?.intake_id === "160a8fd1-9cd8-496a-bc67-d27940998334", "intake drift");
  ok(hex(c.projectos?.plan_payload_sha256), "plan digest missing");
  for (const stage of ["created", "approved", "claimed", "finished"]) {
    const a = c.projectos?.audit?.[stage];
    ok(Number.isInteger(a?.sequence) && hex(a?.event_hash) && a?.occurred_at, `${stage}: audit binding missing`);
  }
  ok(c.projectos?.audit?.finished?.status === "completed", "capture not completed");
  ok(c.projectos?.audit_result_digest_available === false, "audit-result gap hidden");
  ok(c.binding?.overall === "partial_not_audit_result_bound", "audit binding overstated");

  const p = c.provider_response ?? {};
  ok(typeof p.payload_canonical_json === "string", "provider payload missing");
  ok(p.payload_bytes === Buffer.byteLength(p.payload_canonical_json ?? ""), "provider bytes drift");
  ok(p.payload_sha256 === sha(p.payload_canonical_json ?? ""), "provider digest drift");
  let r;
  try { r = JSON.parse(p.payload_canonical_json); } catch { e.push("provider payload invalid JSON"); }
  if (r) {
    const jobs = r.current_jobs ?? {};
    const rows = jobs.rows ?? [];
    const hist = r.run_history_7d ?? {};
    const hrows = hist.rows ?? [];
    ok(jobs.row_count === rows.length, "job row-count mismatch");
    ok(jobs.active_count === rows.filter(v => v.active).length, "active-count mismatch");
    ok(jobs.inactive_count === rows.filter(v => !v.active).length, "inactive-count mismatch");
    ok(p.current_job_row_count === rows.length && p.current_active_job_count === jobs.active_count && p.current_inactive_job_count === jobs.inactive_count, "capture summary mismatch");
    ok(hist.distinct_job_id_count === new Set(hrows.map(v => v.job_id)).size, "history distinct count mismatch");
    ok(p.seven_day_distinct_job_id_count === hist.distinct_job_id_count, "history summary mismatch");
    for (const v of rows) {
      ok(Number.isInteger(v.job_id) && v.name && v.schedule && v.database && v.username, "job identity incomplete");
      ok(hex(v.command_sha256) && Number.isInteger(v.command_bytes) && v.command_bytes > 0, "job command digest incomplete");
      ok(!("command" in v), "raw command persisted");
      ok(Array.isArray(v.migration_sources) && Array.isArray(v.referenced_functions), "job provenance incomplete");
    }
    for (const v of hrows) {
      ok(v.run_count === v.succeeded_count + v.failed_count + v.other_status_count, "history totals mismatch");
      ok(hex(v.command_sha256), "history command digest missing");
      ok(!("command" in v) && !("return_message" in v), "private history text persisted");
    }
    ok(r.privacy?.raw_commands_included === false && r.privacy?.return_messages_included === false && r.privacy?.secret_values_included === false, "rowset privacy failed");
  }
  ok(p.privacy?.raw_commands_included === false && p.privacy?.return_messages_included === false && p.privacy?.secret_values_included === false, "capture privacy failed");
  ok(c.interpretation?.stable_live_parity_proven === false && c.interpretation?.production_verified_catalog_claim_permitted === false, "capture overclaims parity");

  ok(t.status === "RED" && t.stable_pass_verified === false, "timeline must remain RED");
  ok(t.worker6_verdict?.verdict === "FAIL" && t.worker6_verdict?.blocking === true, "Worker 6 verdict erased");
  const prior = (t.observations ?? []).find(v => v.id === "authenticated-three-job-observation");
  const now = (t.observations ?? []).find(v => v.id === "bounded-capture-20260819T030551Z");
  ok(prior?.active_job_count === 3 && prior?.binding === "insufficient_result_provenance", "three-job contradiction missing");
  ok(prior?.job_ids === null && prior?.rowset_digest === null, "prior rowset fabricated");
  ok(now?.active_job_count === 1, "bounded count drift");
  ok(now?.capture_sha256 === sha(content.capture), "capture pin drift");
  ok(now?.provider_payload_sha256 === p.payload_sha256, "provider pin drift");
  ok(now?.query_sha256 === sha(content.sql), "query pin drift");

  const q = t.reconciliation ?? {};
  ok(q.result === "unresolved_authenticated_observation_drift", "contradiction marked resolved");
  ok(q.prior_authenticated_active_job_count === 3 && q.latest_bounded_active_job_count === 1, "observation counts erased");
  ok(q.historical_three_job_observation_explained === false && q.production_verified_complete_catalog === false && q.live_parity_proven === false, "false parity claim");
  ok(q.rollback_qualified === false && q.forward_recovery_required === true, "unsafe recovery claim");

  const sem = t.job_semantics ?? {};
  ok(sem.name_schedule_divergence === true && sem.cadence === "every_15_minutes", "daily/15-minute divergence hidden");
  ok(sem.observed_overlap_count_7d === 0, "observed overlap drift");
  ok(sem.code_level_overlap_prevention_proven === false && sem.idempotency_proven === false && sem.explicit_retry_contract_proven === false, "job semantics overstated");
  ok(sem.authentic_migration_source_available === false, "missing migration source fabricated");

  ok(k.lifecycle?.production_verified_read_only === false, "capability still claims production verification");
  ok(k.provider_proof?.current_catalog_production_verified === false, "catalog still claims production verification");
  ok(k.verification?.current_parity_status === "RED" && k.verification?.stable_pass_verified === false, "capability gate not RED");
  ok(k.provider_proof?.prior_authenticated_active_job_count === 3 && k.provider_proof?.latest_bounded_active_job_count === 1, "capability contradiction erased");
  ok(k.provider_proof?.projectos_audit_result_digest_available === false, "audit result gap hidden in capability");

  const raw = JSON.stringify({ c, t, k });
  ok(!/(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,}|sb_secret_[A-Za-z0-9_-]{20,}|-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----)/.test(raw), "literal secret pattern");
  ok(!/"(password|access_token|refresh_token|service_role_key|jwt_secret|hmac_secret|private_key)"\s*:/.test(raw), "forbidden secret key");
  return e;
}

const base = {
  capture: obj(P.capture), timeline: obj(P.timeline), capability: obj(P.capability),
  content: { sql: buf(P.sql), capture: buf(P.capture), timeline: buf(P.timeline), report: buf(P.report), verifier: buf(P.verifier), workflow: buf(P.workflow) },
};
const errors = validate(base);
if (errors.length) { for (const v of errors) console.error(`ERROR: ${v}`); process.exit(1); }

function expectFailure(name, mutate) {
  const x = copy(base); mutate(x);
  if (!validate(x).length) { console.error(`ERROR: adversarial case passed: ${name}`); process.exit(1); }
}
if (process.argv.includes("--self-test")) {
  const tests = [
    ["provider digest", x => { x.capture.provider_response.payload_sha256 = "0".repeat(64); }],
    ["row-count mismatch", x => { const r = JSON.parse(x.capture.provider_response.payload_canonical_json); r.current_jobs.row_count = 3; x.capture.provider_response.payload_canonical_json = JSON.stringify(r); x.capture.provider_response.payload_bytes = Buffer.byteLength(x.capture.provider_response.payload_canonical_json); x.capture.provider_response.payload_sha256 = sha(x.capture.provider_response.payload_canonical_json); }],
    ["false PASS", x => { x.timeline.status = "PASS"; x.timeline.stable_pass_verified = true; }],
    ["erase contradiction", x => { x.timeline.observations = x.timeline.observations.filter(v => v.id !== "authenticated-three-job-observation"); }],
    ["fabricate job ids", x => { x.timeline.observations.find(v => v.id === "authenticated-three-job-observation").job_ids = [1,2,3]; }],
    ["raw command", x => { const r = JSON.parse(x.capture.provider_response.payload_canonical_json); r.current_jobs.rows[0].command = "redacted"; x.capture.provider_response.payload_canonical_json = JSON.stringify(r); x.capture.provider_response.payload_bytes = Buffer.byteLength(x.capture.provider_response.payload_canonical_json); x.capture.provider_response.payload_sha256 = sha(x.capture.provider_response.payload_canonical_json); }],
    ["audit binding", x => { x.capture.binding.overall = "complete"; }],
    ["query digest", x => { x.capture.source_binding.query_sha256 = "f".repeat(64); }],
    ["capture pin", x => { x.timeline.observations.find(v => v.id === "bounded-capture-20260819T030551Z").capture_sha256 = "a".repeat(64); }],
    ["history total", x => { const r = JSON.parse(x.capture.provider_response.payload_canonical_json); r.run_history_7d.rows[0].succeeded_count = 671; x.capture.provider_response.payload_canonical_json = JSON.stringify(r); x.capture.provider_response.payload_bytes = Buffer.byteLength(x.capture.provider_response.payload_canonical_json); x.capture.provider_response.payload_sha256 = sha(x.capture.provider_response.payload_canonical_json); }],
    ["idempotency", x => { x.timeline.job_semantics.idempotency_proven = true; }],
    ["production verified", x => { x.capability.lifecycle.production_verified_read_only = true; x.capability.provider_proof.current_catalog_production_verified = true; }],
  ];
  for (const [name, mutate] of tests) expectFailure(name, mutate);
  console.log(`Scheduled-job evidence self-tests passed: ${tests.length}`);
}
const payload = JSON.parse(base.capture.provider_response.payload_canonical_json);
console.log("Pandora Memory scheduled-job evidence verified fail-closed.");
console.log(`status=${base.timeline.status} current_jobs=${payload.current_jobs.active_count} prior_authenticated_jobs=3 seven_day_runs=${payload.run_history_7d.rows[0]?.run_count ?? 0}`);
