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
//
// A third defect was found in review: the first version tried to keep moving
// refs out by BLOCKLISTING `origin/*`, `refs/*`, `main`, and `HEAD`. That set is
// unenumerable — `v1.2.3`, `release/foo`, and `feature/x` all sailed through and
// could be marked production_verified, letting the exact model the registry
// prohibits return silently. Identifiers are therefore validated against a
// per-provider ALLOWLIST of immutable artifact shapes. An unknown provider
// cannot contribute a target at all.

import { existsSync, readFileSync } from "node:fs";
import { argv, exit } from "node:process";

const REGISTRY_PATH = "docs/rollback/RELEASE_ARTIFACT_REGISTRY.json";
const EVIDENCE_PATH =
  "docs/capabilities/evidence/EVIDENCE_EDGE_PARITY_ROLLBACK_2026-08-17.json";

/**
 * Immutable artifact-id shapes, per provider.
 *
 * Allowlist, not blocklist. The question is "is this a real deployment id?",
 * never "does this happen to look like a branch name?". Enumerating every ref
 * naming convention is impossible; enumerating a provider's own id format is
 * exact.
 */
const PROVIDER_ARTIFACT_ID_PATTERNS = {
  // Vercel deployment ids: dpl_ followed by a long base62 token.
  vercel: /^dpl_[A-Za-z0-9]{20,}$/,
};
const VERIFICATIONS = ["production_verified", "rehearsal_verified", "unverified"];
const QUALIFYING_VERIFICATIONS = new Set([
  "production_verified",
  "rehearsal_verified",
]);

/**
 * Cross-check the durable evidence against the registry.
 *
 * A fourth review finding was that the validator had been corrected while the
 * committed evidence still asserted the rejected "resolve from origin/main"
 * model — code and evidence disagreeing, with the evidence being what a future
 * operator actually reads. Requiring the evidence to name a QUALIFIED artifact
 * id, rather than describe a target in prose, makes that disagreement
 * mechanically impossible: prose cannot satisfy this check.
 */
export function validateEvidenceAgainstRegistry(evidence, registry) {
  const errors = [];
  const rollback = evidence?.rollback;
  if (!rollback || typeof rollback !== "object") {
    return ["rollback evidence has no 'rollback' block"];
  }

  const named = rollback.release_candidate_artifact_id;
  if (typeof named !== "string" || !named.trim()) {
    errors.push(
      "rollback evidence must name release_candidate_artifact_id. Describing the " +
        "target in prose is how the rejected moving-ref model survived in the " +
        "evidence after the validator had already rejected it.",
    );
    return errors;
  }

  const artifact = (registry?.artifacts ?? []).find((a) => a?.artifact_id === named);
  if (!artifact) {
    errors.push(
      `rollback evidence names release candidate '${named}', which is not in the ` +
        `release-artifact registry`,
    );
  } else if (artifact.qualified !== true) {
    errors.push(
      `rollback evidence names release candidate '${named}', which the registry ` +
        `records as NOT qualified`,
    );
  }

  // A stale field left behind is exactly how the contradiction persisted.
  if ("release_candidate" in rollback) {
    errors.push(
      "rollback evidence still carries the superseded 'release_candidate' prose " +
        "field; use release_candidate_artifact_id",
    );
  }

  return errors;
}

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

    // Allowlist by provider. This covers every branch, tag, and ref naming
    // convention without trying to enumerate them.
    const pattern = PROVIDER_ARTIFACT_ID_PATTERNS[artifact?.provider];
    if (!pattern) {
      errors.push(
        `${id}: provider '${artifact?.provider}' has no registered immutable ` +
          `artifact-id format, so its identifiers cannot be validated. Register ` +
          `the provider's id shape before listing artifacts for it.`,
      );
    } else if (
      typeof artifact?.artifact_id !== "string" ||
      !pattern.test(artifact.artifact_id)
    ) {
      errors.push(
        `${id}: artifact_id is not a valid immutable ${artifact.provider} ` +
          `artifact id. A rollback target must be a pinned provider artifact — ` +
          `a branch, tag, or any other moving reference cannot be one.`,
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
      artifact_id: "dpl_7CbTiMxMXQZjrLQDKchf455iBxi4",
      provider: "vercel",
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
    // Moving references of every shape, not just those a blocklist named.
    // v1.2.3, release/foo and feature/x all passed the first version.
    ["origin/main as artifact id", clone((r) => { r.artifacts[0].artifact_id = "origin/main"; }), true],
    ["main as artifact id", clone((r) => { r.artifacts[0].artifact_id = "main"; }), true],
    ["HEAD as artifact id", clone((r) => { r.artifacts[0].artifact_id = "HEAD"; }), true],
    ["semver tag as artifact id", clone((r) => { r.artifacts[0].artifact_id = "v1.2.3"; }), true],
    ["release branch as artifact id", clone((r) => { r.artifacts[0].artifact_id = "release/foo"; }), true],
    ["feature branch as artifact id", clone((r) => { r.artifacts[0].artifact_id = "feature/x"; }), true],
    ["bare word as artifact id", clone((r) => { r.artifacts[0].artifact_id = "production"; }), true],
    ["truncated deployment id", clone((r) => { r.artifacts[0].artifact_id = "dpl_abc"; }), true],
    ["unregistered provider", clone((r) => { r.artifacts[0].provider = "someprovider"; }), true],
    ["missing provider", clone((r) => { delete r.artifacts[0].provider; }), true],
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

  const evidenceCases = [
    ["evidence naming the qualified artifact", { rollback: { release_candidate_artifact_id: "dpl_7CbTiMxMXQZjrLQDKchf455iBxi4" } }, base, false],
    ["evidence describing the target in prose", { rollback: { release_candidate: "current canonical main, resolved at rollback time" } }, base, true],
    ["evidence naming an unknown artifact", { rollback: { release_candidate_artifact_id: "dpl_notInTheRegistryAtAll000" } }, base, true],
    ["evidence naming a disqualified artifact", { rollback: { release_candidate_artifact_id: "dpl_7CbTiMxMXQZjrLQDKchf455iBxi4" } }, clone((r) => { r.artifacts[0].qualified = false; r.current_status.qualified_targets = 0; r.current_status.rollback_available_for_a_future_deployment = false; }), true],
    ["evidence keeping the superseded prose field alongside the id", { rollback: { release_candidate_artifact_id: "dpl_7CbTiMxMXQZjrLQDKchf455iBxi4", release_candidate: "origin/main" } }, base, true],
    ["evidence with no rollback block", {}, base, true],
  ];

  let failures = 0;
  for (const [label, evidence, registry, shouldReject] of evidenceCases) {
    const rejected = validateEvidenceAgainstRegistry(evidence, registry).length > 0;
    if (rejected !== shouldReject) {
      console.error(
        `SELF-TEST FAIL: '${label}' expected ${shouldReject ? "rejection" : "acceptance"}`,
      );
      failures += 1;
    }
  }

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
  console.log(
    `Rollback target self-test passed (${cases.length + evidenceCases.length} cases).`,
  );
}

function main() {
  if (argv.includes("--self-test")) selfTest();

  if (!existsSync(REGISTRY_PATH)) {
    console.error(`Missing ${REGISTRY_PATH}`);
    exit(1);
  }
  const registry = JSON.parse(readFileSync(REGISTRY_PATH, "utf8"));
  const errors = validateRegistry(registry);

  if (existsSync(EVIDENCE_PATH)) {
    errors.push(
      ...validateEvidenceAgainstRegistry(
        JSON.parse(readFileSync(EVIDENCE_PATH, "utf8")),
        registry,
      ),
    );
  }

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
