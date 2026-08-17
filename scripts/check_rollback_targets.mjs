#!/usr/bin/env node
// Validate the release-artifact registry that rollback targets are drawn from.
//
// Two rollback-target models have already been rejected in review:
//
//   1. A hard-coded SHA in a document. It rots silently every time `main`
//      advances, and the document keeps asserting it.
//   2. "Whatever `origin/main` points at, at rollback time." This fixed the
//      rot but introduced a worse failure: current `main` can contain work that
//      was merged but never production-authorized, deployed, rehearsed, or
//      verified. Promoting it during an incident ships unreleased changes
//      instead of restoring known-good state.
//
// The model this enforces: a rollback target is an IMMUTABLE provider artifact
// with an exact source commit, a capability manifest, and real verification
// evidence. Anything without all four is a candidate, not a target — and if no
// artifact qualifies, rollback is unavailable and forward recovery is the safe
// path. Saying so is the honest outcome; inventing a target is not.

import { existsSync, readFileSync } from "node:fs";
import { argv, exit } from "node:process";

const REGISTRY_PATH = "docs/rollback/RELEASE_ARTIFACT_REGISTRY.json";
const VERIFICATIONS = ["production_verified", "rehearsal_verified", "unverified"];
const QUALIFYING_VERIFICATIONS = new Set([
  "production_verified",
  "rehearsal_verified",
]);

export function validateRegistry(registry) {
  const errors = [];

  if (!registry || !Array.isArray(registry.artifacts)) {
    return ["registry must be an object with an 'artifacts' array"];
  }
  if (!Array.isArray(registry.required_capability_routes) ||
      registry.required_capability_routes.length === 0) {
    errors.push("registry must declare required_capability_routes");
  }

  const seen = new Set();
  for (const artifact of registry.artifacts) {
    const id = artifact?.artifact_id ?? "<missing artifact_id>";

    if (typeof artifact?.artifact_id !== "string" || !artifact.artifact_id.trim()) {
      errors.push(`${id}: artifact_id must be a non-empty string`);
    }
    if (seen.has(artifact?.artifact_id)) {
      errors.push(`${id}: duplicate artifact_id`);
    }
    seen.add(artifact?.artifact_id);

    // A moving ref can never be an artifact id.
    if (
      typeof artifact?.artifact_id === "string" &&
      /^(origin\/|refs\/|main$|HEAD$)/.test(artifact.artifact_id)
    ) {
      errors.push(
        `${id}: artifact_id looks like a git ref. A rollback target must be an ` +
          `immutable provider artifact, not a moving reference.`,
      );
    }

    if (!VERIFICATIONS.includes(artifact?.verification)) {
      errors.push(`${id}: verification must be one of ${VERIFICATIONS.join(", ")}`);
    }
    if (typeof artifact?.qualified !== "boolean") {
      errors.push(`${id}: qualified must be a boolean`);
    }

    if (artifact?.qualified === true) {
      // Everything a target must carry, or it is not a target.
      if (!QUALIFYING_VERIFICATIONS.has(artifact.verification)) {
        errors.push(
          `${id}: qualified=true requires production_verified or rehearsal_verified, ` +
            `not '${artifact.verification}'`,
        );
      }
      if (artifact.capability_manifest_covers_required_routes !== true) {
        errors.push(
          `${id}: qualified=true requires a capability manifest covering the ` +
            `required routes — a target that drops capabilities is a partial ` +
            `outage, not a rollback`,
        );
      }
      if (typeof artifact.source_commit !== "string" || !/^[0-9a-f]{40}$/.test(artifact.source_commit)) {
        errors.push(`${id}: qualified=true requires an exact 40-hex source_commit`);
      }
      if (!Array.isArray(artifact.limitations)) {
        errors.push(`${id}: qualified=true requires an explicit limitations array`);
      }
    }

    if (
      artifact?.capability_manifest_covers_required_routes === false &&
      artifact?.qualified === true
    ) {
      errors.push(`${id}: cannot be qualified while missing required capabilities`);
    }
  }

  // The summary must not overstate what the artifact list supports.
  const qualified = registry.artifacts.filter((a) => a?.qualified === true);
  const status = registry.current_status ?? {};
  if (status.qualified_targets !== qualified.length) {
    errors.push(
      `current_status.qualified_targets (${status.qualified_targets}) does not ` +
        `match the ${qualified.length} artifact(s) marked qualified`,
    );
  }
  if (qualified.length === 0 && status.rollback_available_for_a_future_deployment === true) {
    errors.push(
      "no artifact qualifies, so rollback cannot be reported as available",
    );
  }
  if (status.rollback_rehearsed === true && !status.rehearsal_evidence) {
    errors.push(
      "rollback_rehearsed=true requires rehearsal_evidence naming the rehearsal",
    );
  }

  return errors;
}

function selfTest() {
  const base = {
    required_capability_routes: ["/api/projectos/health"],
    artifacts: [{
      artifact_id: "dpl_abc",
      verification: "production_verified",
      capability_manifest_covers_required_routes: true,
      source_commit: "a".repeat(40),
      limitations: [],
      qualified: true,
    }],
    current_status: { qualified_targets: 1, rollback_available_for_a_future_deployment: true },
  };
  const clone = (mutate) => {
    const copy = JSON.parse(JSON.stringify(base));
    mutate(copy);
    return copy;
  };

  const cases = [
    ["valid registry", base, false],
    ["git ref as artifact id", clone((r) => { r.artifacts[0].artifact_id = "origin/main"; }), true],
    ["qualified but unverified", clone((r) => { r.artifacts[0].verification = "unverified"; }), true],
    ["qualified but drops capabilities", clone((r) => { r.artifacts[0].capability_manifest_covers_required_routes = false; }), true],
    ["qualified without exact source", clone((r) => { r.artifacts[0].source_commit = null; }), true],
    ["qualified without limitations", clone((r) => { delete r.artifacts[0].limitations; }), true],
    ["count mismatch", clone((r) => { r.current_status.qualified_targets = 5; }), true],
    ["availability claimed with no qualified target", clone((r) => {
      r.artifacts[0].qualified = false;
      r.current_status.qualified_targets = 0;
    }), true],
    ["rehearsal claimed without evidence", clone((r) => { r.current_status.rollback_rehearsed = true; }), true],
    ["duplicate artifact id", clone((r) => { r.artifacts.push({ ...r.artifacts[0] }); r.current_status.qualified_targets = 2; }), true],
  ];

  let failures = 0;
  for (const [label, registry, shouldReject] of cases) {
    const rejected = validateRegistry(registry).length > 0;
    if (rejected !== shouldReject) {
      console.error(
        `SELF-TEST FAIL: '${label}' expected ${shouldReject ? "rejection" : "acceptance"}`,
      );
      failures += 1;
    }
  }
  if (failures > 0) exit(1);
  console.log(`Rollback target self-test passed (${cases.length} cases).`);
}

function main() {
  if (argv.includes("--self-test")) selfTest();

  if (!existsSync(REGISTRY_PATH)) {
    console.error(`Missing ${REGISTRY_PATH}`);
    exit(1);
  }
  const registry = JSON.parse(readFileSync(REGISTRY_PATH, "utf8"));
  const errors = validateRegistry(registry);

  if (errors.length > 0) {
    console.error("Rollback target gate FAILED:");
    for (const message of errors) console.error(`  - ${message}`);
    exit(1);
  }

  const qualified = registry.artifacts.filter((a) => a.qualified);
  console.log(
    `Rollback target gate passed: ${registry.artifacts.length} artifacts, ` +
      `${qualified.length} qualified` +
      (registry.current_status?.rollback_rehearsed ? "" : " (rehearsal outstanding)") +
      ".",
  );
}

main();
