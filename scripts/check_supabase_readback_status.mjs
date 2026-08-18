#!/usr/bin/env node
// Fail-closed freshness gate for the Supabase production readback evidence.
//
// This checker does not contact Supabase. It verifies that a blocked provider
// read is recorded as a blocked read — never as a refreshed "live" inventory —
// and binds the dated fallback count to the exact committed provider ledger.
//
// The purpose is truthful recovery: stale authenticated evidence may remain
// valuable, but a failed read cannot silently renew its production timestamp.

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { argv, exit } from "node:process";

const STATUS_PATH =
  "supabase/recovery/provider-observations/2026-08-19_supabase_readback_status.json";
const LEDGER_PATH = "docs/migrations/LIVE_MIGRATION_LEDGER_2026-08-17.json";

const EXPECTED = Object.freeze({
  repository: "banataosystems/pandoras-box-memory",
  projectRef: "ivmvufhcsezyhczzondn",
  branch: "recovery/migration-provenance-20260817",
  pullRequest: 31,
  canonicalMain: "27a3db9c009b0f5282308588d6a9a8ef3cb7d416",
  canonicalMainTree: "349d686418bcc4fd2d1bf933544146d72cb005d4",
  priorLedgerObservedAt: "2026-08-17T10:20:00Z",
  priorMigrationCount: 68,
  priorStatementCount: 542,
  priorSqlBytes: 246216,
  priorRollbackMetadataCount: 0,
});

const EXPECTED_ATTEMPTS = new Map([
  [
    "Supabase.get_project",
    {
      result: "permission_denied",
      ownership: "worker_2_provider_read",
      implementationAction: "none_read_only_attempt",
    },
  ],
  [
    "Supabase.list_projects",
    {
      result: "authenticated_zero_project_scope",
      ownership: "worker_2_provider_read",
      implementationAction: "none_read_only_attempt",
    },
  ],
  [
    "Supabase.list_migrations",
    {
      result: "permission_denied",
      ownership: "worker_2_provider_read",
      implementationAction: "none_read_only_attempt",
    },
  ],
  [
    "Pandoras-box.supabase.list-accounts",
    {
      result: "response_schema_validation_error",
      ownership: "worker_1_projectos_reliability",
      implementationAction: "documented_only_no_competing_fix",
    },
  ],
]);

const SHA1_RE = /^[0-9a-f]{40}$/;
const SHA256_RE = /^[0-9a-f]{64}$/;

function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function parse(path) {
  if (!existsSync(path)) throw new Error(`Missing required file: ${path}`);
  return JSON.parse(readFileSync(path, "utf8"));
}

function timestamp(value) {
  return typeof value === "string" &&
    !Number.isNaN(Date.parse(value)) &&
    /(?:Z|[+-]\d\d:\d\d)$/.test(value);
}

function validate(document, ledger) {
  const errors = [];
  const add = (condition, message) => {
    if (!condition) errors.push(message);
  };

  add(document?.schema_version === "1.0.0", "status: schema_version changed");
  add(
    document?.evidence_id === "supabase-provider-readback-status-2026-08-19",
    "status: evidence_id changed",
  );

  const payload = document?.evidence_payload;
  add(payload && typeof payload === "object", "status: evidence_payload missing");
  if (!payload || typeof payload !== "object") return errors;

  add(
    SHA256_RE.test(document.evidence_payload_sha256 ?? ""),
    "status: evidence_payload_sha256 missing",
  );
  add(
    sha256(JSON.stringify(payload)) === document.evidence_payload_sha256,
    "status: evidence payload digest mismatch",
  );

  add(timestamp(payload.captured_at), "status: captured_at is not a timestamp");
  add(payload.repository === EXPECTED.repository, "status: repository mismatch");

  const source = payload.source_context ?? {};
  add(source.canonical_main_sha === EXPECTED.canonicalMain, "source: main SHA mismatch");
  add(
    source.canonical_main_tree === EXPECTED.canonicalMainTree,
    "source: main tree mismatch",
  );
  add(source.lane_branch === EXPECTED.branch, "source: lane branch mismatch");
  add(source.lane_pull_request === EXPECTED.pullRequest, "source: PR mismatch");
  add(source.lane_base_sha === EXPECTED.canonicalMain, "source: lane base mismatch");
  add(SHA1_RE.test(source.pre_observation_head_sha ?? ""), "source: lane head missing");
  add(SHA1_RE.test(source.pre_observation_tree_sha ?? ""), "source: lane tree missing");
  add(
    source.edge_parity_owner_pull_request === 34,
    "source: Edge Function parity ownership boundary missing",
  );

  const authority = payload.memory_authority ?? {};
  add(authority.health?.ok === true, "memory: health was not recorded as ok");
  add(
    authority.health?.status === "projectos-connected",
    "memory: ProjectOS connection state mismatch",
  );
  add(authority.health?.auth === "vercel_oidc", "memory: auth mode mismatch");
  add(
    authority.canonical_context?.degraded === true,
    "memory: degraded canonical context must be explicit",
  );
  add(
    authority.canonical_context?.fallback_authority === "github_and_supabase",
    "memory: fallback authority mismatch",
  );
  add(
    timestamp(authority.canonical_context?.freshest_approved_record_at),
    "memory: freshest approved record timestamp missing",
  );

  const readback = payload.supabase_readback ?? {};
  add(readback.provider === "supabase", "readback: provider mismatch");
  add(readback.project_ref === EXPECTED.projectRef, "readback: project ref mismatch");
  add(readback.environment === "production", "readback: environment mismatch");
  add(
    readback.status === "blocked_authorization_and_response_schema",
    "readback: blocked status mismatch",
  );
  add(
    readback.current_provider_state_refreshed === false,
    "readback: blocked reads cannot refresh provider state",
  );
  add(
    readback.current_live_migration_count === null,
    "readback: current migration count must remain null while readback is blocked",
  );
  add(
    readback.current_edge_function_inventory_verified === false,
    "readback: current Edge Function inventory cannot be marked verified",
  );
  add(
    readback.current_schema_security_inventory_verified === false,
    "readback: current schema/security inventory cannot be marked verified",
  );

  const prior = readback.last_verified_ledger ?? {};
  add(prior.path === LEDGER_PATH, "readback: prior ledger path mismatch");
  add(
    prior.classification ===
      "last_authenticated_provider_observation_not_current_readback",
    "readback: prior ledger must be classified as dated evidence",
  );

  add(ledger?.provider_resource_id === EXPECTED.projectRef, "ledger: project ref mismatch");
  add(ledger?.observed_at === EXPECTED.priorLedgerObservedAt, "ledger: observed_at mismatch");
  add(ledger?.totals?.migrations === EXPECTED.priorMigrationCount, "ledger: migration count mismatch");
  add(ledger?.totals?.statements === EXPECTED.priorStatementCount, "ledger: statement count mismatch");
  add(ledger?.totals?.sql_bytes === EXPECTED.priorSqlBytes, "ledger: SQL byte count mismatch");
  add(
    ledger?.totals?.with_rollback_metadata === EXPECTED.priorRollbackMetadataCount,
    "ledger: rollback metadata count mismatch",
  );
  add(prior.observed_at === ledger?.observed_at, "readback: prior observed_at is not bound to ledger");
  add(prior.migration_count === ledger?.totals?.migrations, "readback: prior migration count is not bound to ledger");
  add(prior.statement_count === ledger?.totals?.statements, "readback: prior statement count is not bound to ledger");
  add(prior.sql_bytes === ledger?.totals?.sql_bytes, "readback: prior SQL byte count is not bound to ledger");
  add(
    prior.rollback_metadata_count === ledger?.totals?.with_rollback_metadata,
    "readback: prior rollback count is not bound to ledger",
  );

  if (timestamp(payload.captured_at) && timestamp(prior.observed_at)) {
    add(
      Date.parse(payload.captured_at) > Date.parse(prior.observed_at),
      "readback: capture must occur after the dated provider observation",
    );
  }

  const attempts = Array.isArray(readback.attempts) ? readback.attempts : [];
  add(
    attempts.length === EXPECTED_ATTEMPTS.size,
    `readback: expected ${EXPECTED_ATTEMPTS.size} distinct attempts`,
  );
  const seen = new Set();
  for (const attempt of attempts) {
    add(typeof attempt?.tool === "string", "readback: attempt tool missing");
    if (typeof attempt?.tool !== "string") continue;
    add(!seen.has(attempt.tool), `readback: duplicate attempt '${attempt.tool}'`);
    seen.add(attempt.tool);

    const expected = EXPECTED_ATTEMPTS.get(attempt.tool);
    add(Boolean(expected), `readback: unexpected attempt '${attempt.tool}'`);
    if (!expected) continue;

    add(attempt.result === expected.result, `readback: '${attempt.tool}' result mismatch`);
    add(
      attempt.ownership === expected.ownership,
      `readback: '${attempt.tool}' ownership mismatch`,
    );
    add(
      attempt.implementation_action === expected.implementationAction,
      `readback: '${attempt.tool}' implementation action violates lane boundary`,
    );
    add(
      SHA256_RE.test(attempt.request_sha256 ?? ""),
      `readback: '${attempt.tool}' request fingerprint missing`,
    );
    add(
      SHA256_RE.test(attempt.sanitized_result_sha256 ?? ""),
      `readback: '${attempt.tool}' result fingerprint missing`,
    );
    add(
      typeof attempt.sanitized_result === "string" &&
        sha256(attempt.sanitized_result) === attempt.sanitized_result_sha256,
      `readback: '${attempt.tool}' sanitized result digest mismatch`,
    );
  }
  for (const tool of EXPECTED_ATTEMPTS.keys()) {
    add(seen.has(tool), `readback: required attempt '${tool}' missing`);
  }

  add(
    payload.lane_boundaries?.worker_1_issue === 55,
    "lane: Worker 1 issue boundary missing",
  );
  add(
    payload.lane_boundaries?.worker_2_action_on_worker_1_defect ===
      "documented_only_no_competing_fix",
    "lane: Worker 1 defect must remain documentation-only in this lane",
  );
  add(
    payload.lane_boundaries?.edge_function_parity_owned_by_pull_request === 34,
    "lane: Edge Function parity PR boundary missing",
  );

  const safety = payload.safety ?? {};
  for (const field of [
    "production_database_mutated",
    "production_edge_function_deployed",
    "production_release_performed",
    "billable_supabase_branch_created",
    "migration_replayed",
    "historical_evidence_overwritten",
    "secret_values_recorded",
  ]) {
    add(safety[field] === false, `safety: '${field}' must be false`);
  }

  const serialized = JSON.stringify(document);
  const forbidden = [
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
    /\bghp_[A-Za-z0-9]{20,}\b/,
    /\bgithub_pat_[A-Za-z0-9_]{20,}\b/,
    /\bsk_live_[A-Za-z0-9]{12,}\b/,
    /\bAKIA[0-9A-Z]{16}\b/,
    /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./,
  ];
  add(!forbidden.some((pattern) => pattern.test(serialized)), "safety: secret-like literal detected");

  return errors;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function rehash(document) {
  document.evidence_payload_sha256 = sha256(JSON.stringify(document.evidence_payload));
  return document;
}

function selfTest(document, ledger) {
  const cases = [];

  cases.push(["valid baseline", clone(document), false]);

  const currentCount = clone(document);
  currentCount.evidence_payload.supabase_readback.current_live_migration_count = 68;
  cases.push(["blocked read claims a current count", rehash(currentCount), true]);

  const missingAttempt = clone(document);
  missingAttempt.evidence_payload.supabase_readback.attempts =
    missingAttempt.evidence_payload.supabase_readback.attempts.filter(
      (attempt) => attempt.tool !== "Supabase.list_migrations",
    );
  cases.push(["migration read attempt omitted", rehash(missingAttempt), true]);

  const stolenLane = clone(document);
  const projectos = stolenLane.evidence_payload.supabase_readback.attempts.find(
    (attempt) => attempt.tool === "Pandoras-box.supabase.list-accounts",
  );
  projectos.ownership = "worker_2_provider_read";
  cases.push(["Worker 1 defect claimed by Worker 2", rehash(stolenLane), true]);

  const refreshed = clone(document);
  refreshed.evidence_payload.supabase_readback.current_provider_state_refreshed = true;
  cases.push(["blocked read marked refreshed", rehash(refreshed), true]);

  const wrongCount = clone(document);
  wrongCount.evidence_payload.supabase_readback.last_verified_ledger.migration_count = 69;
  cases.push(["prior count detached from ledger", rehash(wrongCount), true]);

  const tamperedResult = clone(document);
  tamperedResult.evidence_payload.supabase_readback.attempts[0].sanitized_result += " changed";
  cases.push(["result changed without fingerprint update", rehash(tamperedResult), true]);

  const productionMutation = clone(document);
  productionMutation.evidence_payload.safety.production_database_mutated = true;
  cases.push(["production mutation hidden in recovery evidence", rehash(productionMutation), true]);

  const wrongProject = clone(document);
  wrongProject.evidence_payload.supabase_readback.project_ref = "wrong-project";
  cases.push(["wrong Supabase project", rehash(wrongProject), true]);

  const staleDigest = clone(document);
  staleDigest.evidence_payload.repository = "changed/repository";
  cases.push(["payload changed without evidence digest update", staleDigest, true]);

  let failures = 0;
  for (const [label, candidate, shouldReject] of cases) {
    const rejected = validate(candidate, ledger).length > 0;
    if (rejected !== shouldReject) {
      console.error(
        `SELF-TEST FAIL: '${label}' expected ${shouldReject ? "rejection" : "acceptance"}, ` +
          `got ${rejected ? "rejection" : "acceptance"}`,
      );
      failures += 1;
    }
  }

  if (failures > 0) exit(1);
  console.log(`Supabase readback status self-test passed (${cases.length} cases).`);
}

function main() {
  let document;
  let ledger;
  try {
    document = parse(STATUS_PATH);
    ledger = parse(LEDGER_PATH);
  } catch (error) {
    console.error(error.message);
    exit(1);
  }

  if (argv.includes("--self-test")) selfTest(document, ledger);

  const errors = validate(document, ledger);
  if (errors.length > 0) {
    console.error("Supabase readback status gate FAILED:");
    for (const error of errors) console.error(`  - ${error}`);
    exit(1);
  }

  const readback = document.evidence_payload.supabase_readback;
  const prior = readback.last_verified_ledger;
  console.log(
    "Supabase readback status gate passed: current provider inventory is UNVERIFIED; " +
      `${prior.migration_count} migrations are retained only as the authenticated ` +
      `provider observation from ${prior.observed_at}; ${readback.attempts.length} ` +
      "blocked read attempts are content-addressed; production was not mutated.",
  );
}

main();
