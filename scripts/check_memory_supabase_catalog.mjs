#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const P = {
  manifest: "docs/provider-observations/memory-supabase-20260819/LIVE_CATALOG_MANIFEST.json",
  boundaries: "docs/provider-observations/memory-supabase-20260819/SECURITY_BOUNDARIES.json",
  timeline: "docs/provider-observations/memory-supabase-20260819/scheduled-jobs/OBSERVATION_TIMELINE.json",
  report: "docs/recovery/PANDORA_SUPABASE_CATALOG_SUPPLEMENT_2026-08-19.md",
  capability: "docs/capabilities/evidence/MEMORY_SUPABASE_LIVE_CATALOG_2026-08-19.json",
  verifier: "scripts/check_memory_supabase_catalog.mjs",
  workflow: ".github/workflows/memory-supabase-catalog-evidence.yml",
};
const bytes = path => readFileSync(path);
const json = path => JSON.parse(readFileSync(path, "utf8"));
const sha256 = value => createHash("sha256").update(value).digest("hex");
const hex64 = value => /^[0-9a-f]{64}$/.test(value ?? "");
const fail = (condition, message, errors) => { if (!condition) errors.push(message); };

const manifest = json(P.manifest);
const boundaries = json(P.boundaries);
const timeline = json(P.timeline);
const capability = json(P.capability);
const errors = [];

for (const key of ["manifest", "boundaries", "report", "verifier", "workflow"]) {
  const expected = capability.source?.[`${key}_sha256`];
  fail(hex64(expected), `${key}: missing content address`, errors);
  fail(expected === sha256(bytes(P[key])), `${key}: content-address mismatch`, errors);
}

fail(manifest.provider?.project_ref === "ivmvufhcsezyhczzondn", "wrong project", errors);
fail(manifest.migrations?.live_count === 68, "migration count drift", errors);
fail(manifest.migrations?.stored_statement_count === 542, "statement count drift", errors);
fail(manifest.migrations?.stored_statement_bytes === 246216, "statement bytes drift", errors);
fail(Object.values(manifest.migrations?.source_classification ?? {}).reduce((a, b) => a + b, 0) === 68, "classification total mismatch", errors);
fail(manifest.migrations?.rollback_qualified === false && manifest.migrations?.forward_recovery_required === true, "unsafe recovery claim", errors);
fail(boundaries.scheduled_jobs?.length === 1 && boundaries.scheduled_jobs[0]?.command_persisted === false, "historical cron capture drift", errors);
fail(boundaries.application_triggers?.length === 14, "trigger inventory drift", errors);
fail(boundaries.security_definer_functions?.length === 11, "SECURITY DEFINER inventory drift", errors);
fail(Object.values(boundaries.privacy ?? {}).every(value => value === false), "privacy exclusion failed", errors);

fail(timeline.status === "RED", "current RED status erased", errors);
fail(timeline.stable_pass_verified === false, "stable PASS falsely asserted", errors);
fail(timeline.worker6_verdict?.verdict === "FAIL" && timeline.worker6_verdict?.blocking === true, "Worker 6 verdict erased", errors);
fail(timeline.reconciliation?.historical_three_job_observation_explained === false, "cron contradiction falsely resolved", errors);
fail(timeline.reconciliation?.production_verified_complete_catalog === false, "historical capture promoted to complete catalog", errors);
fail(timeline.reconciliation?.live_parity_proven === false, "live parity falsely proven", errors);

fail(capability.lifecycle?.production_verified_read_only === false, "capability still claims production verification", errors);
fail(capability.provider_proof?.current_catalog_production_verified === false, "provider proof still claims complete catalog", errors);
fail(capability.provider_proof?.original_committed_active_job_count === 1, "original count erased", errors);
fail(capability.provider_proof?.prior_authenticated_active_job_count === 3, "three-job contradiction erased", errors);
fail(capability.provider_proof?.latest_bounded_active_job_count === 1, "latest bounded count drift", errors);
fail(capability.provider_proof?.projectos_audit_result_digest_available === false, "audit binding gap hidden", errors);
fail(capability.verification?.current_parity_status === "RED" && capability.verification?.stable_pass_verified === false, "capability parity gate not RED", errors);

const raw = JSON.stringify({ manifest, boundaries, timeline, capability });
fail(!/(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,}|sb_secret_[A-Za-z0-9_-]{20,}|-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----)/.test(raw), "literal secret pattern", errors);
fail(!/"(password|access_token|refresh_token|service_role_key|jwt_secret|hmac_secret|private_key)"\s*:/.test(raw), "forbidden secret key", errors);

if (errors.length) {
  for (const error of errors) console.error(`ERROR: ${error}`);
  process.exit(1);
}
console.log("Pandora Memory historical catalog capture verified; current live parity remains RED.");
console.log(`migrations=${manifest.migrations.live_count} triggers=${boundaries.application_triggers.length} historical_jobs=${boundaries.scheduled_jobs.length} status=${timeline.status}`);
