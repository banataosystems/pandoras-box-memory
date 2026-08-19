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

const sha256 = value => createHash("sha256").update(value).digest("hex");
const bytes = path => readFileSync(path);
const text = path => readFileSync(path, "utf8");
const json = path => JSON.parse(text(path));
const hex64 = value => /^[0-9a-f]{64}$/.test(value ?? "");

function validate({ capture, timeline, capability, contents }) {
  const errors = [];
  const bad = (condition, message) => {
    if (!condition) errors.push(message);
  };

  const source = capability.source ?? {};
  const expectedHashes = {
    sql: source.scheduled_job_query_sha256,
    capture: source.scheduled_job_capture_sha256,
    timeline: source.scheduled_job_timeline_sha256,
    report: source.scheduled_job_report_sha256,
    verifier: source.scheduled_job_verifier_sha256,
    workflow: source.workflow_sha256,
  };

  for (const [name, expected] of Object.entries(expectedHashes)) {
    bad(hex64(expected), `${name}: missing content addres`);
    bad(expected === sha256(contents[ame]), `${name}: content-address mismatch`);
  }

  bad(capture.schema_version === "1.0.0", "capture schema drift");
  bad(capture.status === "captured_read_only", "capture is not read-only");
  bad(capture.provider?.project_ref === "ivmvufhcsezyhczzondn", "wrong project");
  bad(capture.provider?.capture_role === "supabase_read_only_user", "wrong capture role");
  bad(capture.source_binding?.query_path === P.sql, "query path drift");
  bad(capture.source_binding?.query_bytes === Buffer.byteLength(contents.sql), "query byte count mismatch");
  bad(capture.source_binding?.query_sha256 === sha256(contents.sql), "query digest mismatch");
  bad(capture.projectos?.plan_id === "f632066d-3b69-4c15-b955-dcd744d6cdde", "plan identity drift");
  bad(capture.projectos?.request_id === "14d016ae-16ee-4ae5-9e70-5e8265c50ada", "request identity drift");
  bad(capture.projectos?.intake_id === "160a8fd1-9cd8-496a-bc67-d27940998334", "intake identity drift");
  bad(hex64(capture.projectos?.plan_payload_sha256), "plan payload digest missing");

  const audit = capture.projectos?.audit ?? {};
  for (const stage of ["created", "approved", "claimed", "finished"]) {
    bad(Number.isInteger(audit[stage]?.sequence), `${stage}: audit sequence missing`);
    bad(hex64(audit[stage]?.event_hash), `${stage}: audit event hash missing`);
    bad(Boolean(audit[stage]?.occurred_at), `${stage}: audit time missing`);
  }
  bad(audit.finished?.status === "completed", "capture execution did not complete");
  bad(capture.projectos?.audit_result_digest_available === false, "audit result digest gap hidden");
  bad(capture.binding?.overall === "partial_not_audit_result_bound", "binding overstated");

  const provider = capture.provider_response ?? {};
  bad(typeof provider.payload_canonical_json === "string", "provider payload bytes missing");
  bad(provider.payload_bytes === Buffer.byteLength(provider.payload_canonical_json ?? ""), "provider byte count mismatch");
  bad(provider.payload_sha256 === sha256(provider.payload_canonical_json ?? ""), "provider payload digest mismatch");

  let rowset = null;
  try {
    rowset = JSON.parse(provider.payload_canonical_json);
  } catch {
    errors.push("provider payload is not valid JSON");
  }

  if (rowset) {
    const jobs = rowset.current_jobs ?? {};
    const jobRows = jobs.rows ?? [];
    const history = rowset.run_history_7d ?? {};
    const historyRows = history.rows ?? [];

    bad(jobs.row_count === jobRows.length, "current job count does not match rowset");
    bad(jobs.active_count === jobRows.filter(row => row.active).length, "active job count does not match rowset");
    bad(jobs.inactive_count === jobRows.filter(row => !row.active).length, "inactive job count does not match rowset");
    bad(provider.current_job_row_count === jobRows.length, "capture summary row count mismatch");
    bad(provider.current_active_job_count === jobs.active_count, "capture summary active count mismatch");
    bad(provider.current_inactive_job_count === jobs.inactive_count, "capture summary inactive count mismatch");
    bad(history.distinct_job_id_count === new Set(historyRows.map(row => row.job_id)).size, "history distinct-job count mismatch");
    bad(provider.seven_day_distinct_job_id_count === history.distinct_job_id_count, "capture history count mismatch");

    for (const row of jobRows) {
      bad(Number.isInteger(row.job_id), "job ID  missing");
      bad(Boolean(row.name && row.schedule && row.database && row.username), `job ${row.job_id}: identity incomplete`);
      bad(hex64(row.command_sha256), `job ${row.job_id}: command digest missing`);
      bad(Number.isInteger(row.command_bytes) && row.command_bytes > 0, `job ${row.job_id}: command byte count missing`);
      bad(!("command" in row), `job ${row.job_id}: raw command persisted`);
      bad(Array.isArray(row.migration_sources), `job ${row.job_id}: migration provenance missing`);
      bad(Array.isArray(row.referenced_functions), `job ${row.job_id}: function provenance missing`);
    }

    for (const row of historyRows) {
      bad(row.run_count === row.succeeded_count + row.failed_count + row.other_status_count, `job ${row.job_id}: run totals mismatch`);
      bad(hex64(row.command_sha256), `job ${row.job_id}: history command digest missing`);
      bad(!("command" in row) && !("return_message" in row), `job ${row.job_id}: private history text persisted`);
    }

    bad(rowset.privacy?.raw_commands_included === false, "raw-command privacy claim failed");
    bad(rowset.privacy?.return_messages_included === false, "return-message privacy claim failed");
    bad(rowset.privacy?.secret_values_included === false, "secret privacy claim failed");
  }

  bad(provider.privacy?.raw_commands_included === false, "capture raw-command privacy failed");
  bad(provider.privacy?.return_messages_included === false, "capture return-message privacy failed");
  bad(provider.privacy?.secret_values_included === false, "capture secret privacy failed");
  bad(capture.interpretation?.stable_live_parity_proven === false, "capture falsely claims stable parity");
  bad(capture.interpretation?.production_verified_catalog_claim_permitted === false, "capture falsely permits production-verified catalog");

  bad(timeline.status === "RED", "timeline must remain RED");
  bad(timeline.stable_pass_verified === false, "stable PASS falsely asserted");
  bad(timeline.worker6_verdict?.verdict === "FAIL" && timeline.worker6_verdict?.blocking === true, "Worker 6 verdict erased");

  const observations = timeline.observations ?? [];
  const prior = observations.find(item => item.id === "authenticated-three-job-observation");
  const current = observations.find(item => item.id === "bounded-capture-20260819T030551Z");
  bad(prior?.active_job_count === 3, "three-job authenticated contradiction missing");
  bad(prior?.binding === "insufficient_result_provenance", "prior provenance limitation erased");
  bad(prior?.job_ids === null && prior?.rowset_digest === null, "unavailable prior rowset was fabricated");
  bad(current?.active_job_count === 1, "current bounded count drift");
  bad(current?.capture_sha256 === sha256(contents.capture), "timeline capture pin mismatch");
  bad(current?.provider_payload_sha256 === capture.provider_response?.payload_sha256, "timeline provider digest mismatch");
  bad(current?.query_sha256 === sha256(contents.sql), "timeline query pin mismatch");

  const reconciliation = timeline.reconciliation ?? {};
  bad(reconciliation.result === "unresolved_authenticated_observation_drift", "contradiction marked resolved");
  bad(reconciliation.prior_authenticated_active_job_count === 3, "prior count erased");
  bad(reconciliation.latest_bounded_active_job_count === 1, "latest bounded count drift");
  bad(reconciliation.historical_three_job_observation_explained === false, "unexplained jobs falsely explained");
  bad(reconciliation.production_verified_complete_catalog === false, "complete catalog falsely production-verified");
  bad(reconciliation.live_parity_proven === false, "live parity falsely proven");
  bad(reconciliation.rollback_qualified === false && reconciliation.forward_recovery_required === true, "unsafe recovery classification");

  const semantics = timeline.job_semantics ?? {};
  bad(semantics.name_schedule_divergence === true, "daily/15-minute divergence hidden");
  bad(semantics.cadence === "every_15_minutes", "cadence misreported");
  bad(semantics.observed_overlap_count_7d === 0, "observed overlap count drift");
  bad(semantics.code_level_overlap_prevention_proven === false, "overlap prevention overstated");
  bad(semantics.idempotency_proven === false, "idempotency overstated");
  bad(semantics.explicit_retry_contract_proven === false, "retry contract overstated");
  bad(semantics.authentic_migration_source_available === false, "missing source falsely recovered");

  bad(capability.lifecycle?.production_verified_read_only === false, "capability still claims current production verification");
  bad(capability.provider_proof?.current_catalog_production_verified === false, "provider proof still claims current complete catalog");
  bad(capability.verification?.current_parity_status === "RED", "capability parity status is not RED");
  bad(capability.verification?.stable_pass_verified === false, "capability falsely claims stable PASS");

  const joined = JSON.stringify({ capture, timeline, capability });
  bad(!/(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,}|sb_secret_[A-Za-z0-9_-]{20,}|-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----)/.test(joined), "literal secret pattern");
  bad(!/"(password|access_token|refresh_token|service_role_key|jwt_secret|hmac_secret|private_key)"\s*:/.test(joined), "forbidden secret key");

  return errors;
}

const base = {
  capture: json(P.capture),
  timeline: json(P.timeline),
  capability: json(P.capability),
  contents: {
    sql: bytes(P.sql),
    capture: bytes(P.capture),
    timeline: bytes(P.timeline),
    report: bytes(P.report),
    verifier: bytes(P.verifier),
    workflow: bytes(P.workflow),
  },
};

const errors = validate(base);
if (errors.length) {
  for (const error of errors) console.error(`ERROR: ${error}`);
  process.exit(1);
}

function clone(value) {
  return structuredClone(value);
}

function expectFailure(name, mutate) {
  const candidate = clone(base);
  mutate(candidate);
  const candidateErrors = validate(candidate);
  if (!candidateErrors.length) {
    console.error(`ERROR: adversarial case passed unexpectedly: ${name}`);
    process.exit(1);
  }
}

if (process.argv.includes("--self-test")) {
  const cases = [
    ["provider digest mutation", c => { c.capture.provider_response.payload_sha256 = "0".repeat(64); }],
    ["provider row count mutation", c => {
      const rowset = JSON.parse(c.capture.provider_response.payload_canonical_json);
      rowset.current_jobs.row_count = 3;
      c.capture.provider_response.payload_canonical_json = JSON.stringify(rowset);
      c.capture.provider_response.payload_bytes = Buffer.byteLength(c.capture.provider_response.payload_canonical_json);
      c.capture.provider_response.payload_sha256 = sha256(c.capture.provider_response.payload_canonical_json);
    }],
    ["false PASS", c => { c.timeline.status = "PASS"; c.timeline.stable_pass_verified = true; }],
    ["erase three-job contradiction", c => { c.timeline.observations = c.timeline.observations.filter(x => x.id !== "authenticated-three-job-observation"); }],
    ["fabricate prior job identities", c => {
      const prior = c.timeline.observations.find(x => x.id === "authenticated-three-job-observation");
      prior.job_ids = [1, 2, 3];
    }],
    ["raw command leak", c => {
      const rowset = JSON.parse(c.capture.provider_response.payload_canonical_json);
      rowset.current_jobs.rows[0].command = "select private.example();";
      c.capture.provider_response.payload_canonical_json = JSON.stringify(rowset);
      c.capture.provider_response.payload_bytes = Buffer.byteLength(c.capture.provider_response.payload_canonical_json);
      c.capture.provider_response.payload_sha256 = sha256(c.capture.provider_response.payload_canonical_json);
    }],
    ["overstate audit binding", c => { c.capture.binding.overall = "complete"; }],
    ["query digest mutation", c => { c.capture.source_binding.query_sha256 = "f".repeat(64); }],
    ["capture pin mutation", c => {
      const current = c.timeline.observations.find(x => x.id === "bounded-capture-20260819T030551Z");
      current.capture_sha256 = "a".repeat(64);
    }],
    ["history total mutation", c => {
      const rowset = JSON.parse(c.capture.provider_response.payload_canonical_json);
      rowset.run_history_7d.rows[0].succeeded_count = 671;
      c.capture.provider_response.payload_canonical_json = JSON.stringify(rowset);
      c.capture.provider_response.payload_bytes = Buffer.byteLength(c.capture.provider_response.payload_canonical_json);
      c.capture.provider_response.payload_sha256 = sha256(c.capture.provider_response.payload_canonical_json);
    }],
    ["idempotency overclaim", c => { c.timeline.job_semantics.idempotency_proven = true; }],
    ["production verification overclaim", c => {
      c.capability.lifecycle.production_verified_read_only = true;
      c.capability.provider_proof.current_catalog_production_verified = true;
    }],
  ];
  for (const [name, mutate] of cases) expectFailure(name, mutate);
  console.log(`Scheduled-job evidence self-tests passed: ${cases.length}`);
}

const payload = JSON.parse(base.capture.provider_response.payload_canonical_json);
console.log("Pandora Memory scheduled-job evidence verified fail-closed.");
console.log(`status=${base.timeline.status} current_jobs=${payload.current_jobs.active_count} prior_authenticated_jobs=3 seven_day_runs=${payload.run_history_7d.rows[0]?.run_count ?? 0}`);
