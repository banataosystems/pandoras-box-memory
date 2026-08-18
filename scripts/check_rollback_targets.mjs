#!/usr/bin/env node
// Validate the release-artifact registry that rollback targets are drawn from.
//
// Five rollback-target models have been rejected in review. The first four were
// about WHAT a target is:
//
//   1. A hard-coded SHA in a document. It rots every time `main` advances.
//   2. "Whatever `origin/main` points at." Current main can carry work merged
//      but never production-authorized, so promoting it ships unreleased
//      changes while claiming to restore known-good state.
//   3. A blocklist of `origin/*`, `refs/*`, `main`, `HEAD`. Unenumerable —
//      `v1.2.3`, `release/foo` and `feature/x` all sailed through. Replaced by
//      a per-provider ALLOWLIST of immutable artifact-id shapes.
//   4. Prose describing the target in the durable evidence, while the validator
//      demanded an id. Evidence and validator disagreed, and the evidence is
//      what an operator reads mid-incident.
//
// The fifth and sixth are about WHO GETS BELIEVED, and they are the same
// defect wearing different clothes:
//
//   5. Resolution accepted an artifact because its registry entry said
//      `qualified: true` — a boolean the entry asserts about itself.
//   6. Removing that dependency was not enough. `verification`,
//      `capability_manifest_covers_required_routes`, `source_commit` and
//      `source_commit_binding` are equally self-asserted. An adversarial entry
//      could simply forge all four instead of only `qualified`, and a forged
//      entry with zero backing evidence still resolved.
//
// The seventh was about HOW EVIDENCE IS READ:
//
//   7. Qualification resolved evidence and then asked three independent
//      questions of its raw text: does it contain the artifact id, does it
//      contain each required route, does it contain the source commit. Nothing
//      tied the three answers together. One document describing two
//      deployments answers "yes" to all three for the WRONG pairing, so
//      deployment A qualified on deployment B's commit and B's routes. Every
//      check passed and the conclusion was false. Replaced by a structured
//      `observations` contract: exactly one observation is selected by exact
//      (artifact_id, provider) equality, and every fact is then read from that
//      one record by structured comparison. See selectObservation().
//
// So qualification is DERIVED here, never read:
//
//   * Capability completeness is computed by comparing a concrete
//     `capability_manifest` against `required_capability_routes`, and every
//     required route must be a member of the selected observation's exact
//     `observed_routes` set.
//   * Verification resolves a concrete evidence entry that must be CURRENT,
//     belong to the same provider, and carry a single observation for this
//     exact artifact id. Both the document's classification AND that
//     observation must carry the proof stage the claimed verification class
//     requires, so a production-classified document cannot lend its stage to a
//     preview observation inside it.
//   * Source binding resolves the observation for this exact artifact id and
//     requires `observation.source_commit === source_commit` exactly. `source_commit_binding` prose is retained as
//     provenance, but it is not proof of anything.
//
// `qualified` survives only as a generated readability field: CI asserts
// `qualified === (targetQualificationErrors(...).length === 0)`.
//
// If nothing qualifies, rollback is UNAVAILABLE and forward recovery is the
// safe path. Saying so is the honest outcome; inventing a target is not.

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { argv, exit } from "node:process";

const REGISTRY_PATH = "docs/rollback/RELEASE_ARTIFACT_REGISTRY.json";
const EVIDENCE_PATH =
  "docs/capabilities/evidence/EVIDENCE_EDGE_PARITY_ROLLBACK_2026-08-17.json";
const EVIDENCE_INDEX_PATH = "docs/evidence/EVIDENCE_INDEX.json";

/**
 * Immutable artifact-id shapes, per provider. Allowlist, not blocklist: the
 * question is "is this a real deployment id?", never "does this happen to look
 * like a branch name?".
 */
const PROVIDER_ARTIFACT_ID_PATTERNS = {
  vercel: /^dpl_[A-Za-z0-9]{20,}$/,
};

const VERIFICATIONS = ["production_verified", "rehearsal_verified", "unverified"];
const QUALIFYING_VERIFICATIONS = new Set([
  "production_verified",
  "rehearsal_verified",
]);

/**
 * Fields that were once believed on the artifact's own say-so. Their presence
 * is now an error naming what replaced them, so a stale registry cannot quietly
 * keep qualifying through the old self-asserted route.
 */
const SELF_ASSERTED_SUBSTITUTES = {
  capability_manifest_covers_required_routes:
    "replaced by capability_manifest (a concrete route list) plus " +
    "capability_manifest_evidence, which are compared against " +
    "required_capability_routes and resolved against the evidence index",
};

/**
 * Build the context qualification is derived from.
 *
 * `entries` is a list of { entry, text, hashMismatch }, where `entry` is an
 * evidence-index record and `text` is the artifact's bytes. Kept injectable so
 * the self-tests exercise the real derivation rather than a stub.
 */
export function buildEvidenceContext(requiredRoutes, entries) {
  const evidence = new Map();
  for (const item of entries ?? []) {
    if (item?.entry?.evidence_id) evidence.set(item.entry.evidence_id, item);
  }
  return { requiredRoutes: [...(requiredRoutes ?? [])], evidence };
}

/** Load the evidence context from disk, hash-verifying every artifact. */
export function loadEvidenceContextFromDisk(requiredRoutes) {
  if (!existsSync(EVIDENCE_INDEX_PATH)) return buildEvidenceContext(requiredRoutes, []);
  const index = JSON.parse(readFileSync(EVIDENCE_INDEX_PATH, "utf8"));
  const entries = [];
  for (const entry of index.entries ?? []) {
    if (typeof entry?.path !== "string" || !existsSync(entry.path)) {
      entries.push({ entry, text: null, hashMismatch: true });
      continue;
    }
    const bytes = readFileSync(entry.path);
    const digest = createHash("sha256").update(bytes).digest("hex");
    entries.push({
      entry,
      text: bytes.toString("utf8"),
      hashMismatch: digest !== entry.evidence_sha256,
    });
  }
  return buildEvidenceContext(requiredRoutes, entries);
}

/**
 * A STRUCTURED OBSERVATION is the only thing that can qualify a target.
 *
 * The seventh rejected model was substring co-occurrence. Qualification used
 * three independent `evidence.text.includes(...)` calls — one for the artifact
 * id, one for each required route, one for the source commit. Nothing tied the
 * three hits to each other. A single evidence document that legitimately
 * describes two deployments:
 *
 *     deployment A (dpl_aaa), commit aaaa…, routes /x
 *     deployment B (dpl_bbb), commit bbbb…, routes /y /z
 *
 * satisfies `includes("dpl_aaa")`, `includes("bbbb…")` and `includes("/y")`
 * simultaneously, so deployment A qualified on deployment B's commit and
 * deployment B's routes. Every individual check passed and the conclusion was
 * false. Prose proximity is not a relation.
 *
 * So evidence must now carry an explicit `observations` array, and exactly one
 * observation is selected by exact (artifact_id, provider) equality. Every
 * subsequent fact is read from THAT record by structured comparison. Nothing is
 * inferred from surrounding text, and a document that merely mentions an id
 * proves nothing about it.
 *
 * Returns { observation } on success, or { error } describing why not.
 * Unstructured historical evidence returns an error rather than being
 * reinterpreted: prose stays prose.
 */
export function selectObservation(found, artifactId, provider) {
  if (typeof found?.text !== "string") {
    return { error: "its bytes could not be read" };
  }

  let parsed;
  try {
    parsed = JSON.parse(found.text);
  } catch {
    return {
      error:
        "it is not structured evidence (no parseable JSON body). Historical " +
        "prose remains valid historical evidence, but it cannot qualify a " +
        "rollback target — co-occurrence of an id, a commit and a route in " +
        "free text does not bind them to each other",
    };
  }

  const observations = parsed?.observations;
  if (!Array.isArray(observations)) {
    return {
      error:
        "it declares no 'observations' array, so there is no record that binds " +
        "an artifact to a commit and a route set",
    };
  }

  const matches = observations.filter(
    (observation) =>
      observation?.artifact_id === artifactId &&
      observation?.provider === provider,
  );
  if (matches.length === 0) {
    return {
      error:
        `it carries no observation whose artifact_id is exactly '${artifactId}' ` +
        `and whose provider is exactly '${provider}'`,
    };
  }
  if (matches.length > 1) {
    return {
      error:
        `it carries ${matches.length} observations for '${artifactId}', so the ` +
        `binding is ambiguous and is refused rather than guessed`,
    };
  }
  return { observation: matches[0] };
}

/**
 * Derive whether an artifact may serve as a rollback target.
 *
 * Every assertion here resolves a fact against evidence the artifact does not
 * control. Called with no context it refuses outright rather than falling
 * back to the artifact's own claims, so resolution stays safe standalone.
 */
export function targetQualificationErrors(artifact, label, context) {
  const id = artifact?.artifact_id;
  const prefix = label ?? id ?? "<missing artifact_id>";
  const errors = [];

  if (!context || !(context.evidence instanceof Map) ||
      !Array.isArray(context.requiredRoutes)) {
    return [
      `${prefix}: qualification cannot be derived without an evidence context, ` +
        `so it is refused. Reading the artifact's own qualification fields is ` +
        `the fail-open pattern this check exists to prevent.`,
    ];
  }
  if (typeof id !== "string" || !id.trim()) {
    return [`${prefix}: artifact_id must be a non-empty string`];
  }

  for (const [field, replacement] of Object.entries(SELF_ASSERTED_SUBSTITUTES)) {
    if (field in (artifact ?? {})) {
      errors.push(`${prefix}: '${field}' is self-asserted and no longer accepted — ${replacement}`);
    }
  }

  /** Resolve a cited evidence id to an artifact that actually binds to this target. */
  const resolve = (field, purpose) => {
    const cited = artifact?.[field];
    if (typeof cited !== "string" || !cited.trim()) {
      errors.push(
        `${prefix}: ${field} must name the evidence proving ${purpose}. A value ` +
          `stated on the artifact's own registry entry is a claim, not proof.`,
      );
      return null;
    }
    const found = context.evidence.get(cited);
    if (!found) {
      errors.push(`${prefix}: ${field} names evidence '${cited}', which is not in the evidence index`);
      return null;
    }
    if (found.hashMismatch) {
      errors.push(
        `${prefix}: evidence '${cited}' does not match its indexed sha256, so it ` +
          `cannot be relied on to prove ${purpose}`,
      );
      return null;
    }
    if (found.entry?.current !== true) {
      errors.push(
        `${prefix}: evidence '${cited}' is superseded by ` +
          `'${found.entry?.superseded_by ?? "an unnamed successor"}' and cannot ` +
          `qualify a rollback target — a newer observation has replaced it`,
      );
      return null;
    }
    if (found.entry?.provider !== artifact.provider) {
      errors.push(
        `${prefix}: evidence '${cited}' is ${found.entry?.provider} evidence, ` +
          `but this is a ${artifact.provider} artifact`,
      );
      return null;
    }
    // Structured binding, not co-occurrence: exactly one observation in the
    // cited evidence must name this artifact id AND this provider.
    const selected = selectObservation(found, id, artifact.provider);
    if (selected.error) {
      errors.push(
        `${prefix}: evidence '${cited}' cannot bind to ${id} because ${selected.error}`,
      );
      return null;
    }
    return { ...found, observation: selected.observation };
  };

  // --- verification -------------------------------------------------------
  if (!VERIFICATIONS.includes(artifact?.verification)) {
    errors.push(`${prefix}: verification must be one of ${VERIFICATIONS.join(", ")}`);
  } else if (!QUALIFYING_VERIFICATIONS.has(artifact.verification)) {
    errors.push(
      `${prefix}: a rollback target requires production_verified or ` +
        `rehearsal_verified, not '${artifact.verification}'`,
    );
  } else {
    const proof = resolve("verification_evidence", "the claimed verification");
    if (proof) {
      const entry = proof.entry;
      // The index entry classifies the DOCUMENT; the observation states what was
      // seen for THIS artifact. Both must agree, so a production-classified
      // document cannot lend its stage to a preview observation inside it.
      const seen = proof.observation;
      if (artifact.verification === "production_verified") {
        if (entry.proof_stage !== "production_verified" ||
            entry.production_verified !== true ||
            entry.environment !== "production" ||
            entry.deployment_status !== "production_deployed") {
          errors.push(
            `${prefix}: verification_evidence '${entry.evidence_id}' does not ` +
              `carry production proof (stage '${entry.proof_stage}', environment ` +
              `'${entry.environment}', deployment '${entry.deployment_status}')`,
          );
        }
        if (seen.environment !== "production" ||
            seen.deployment_status !== "production_deployed" ||
            seen.proof_stage !== "production_verified") {
          errors.push(
            `${prefix}: the observation for ${id} in '${entry.evidence_id}' is ` +
              `environment '${seen.environment}', deployment ` +
              `'${seen.deployment_status}', stage '${seen.proof_stage}' — not a ` +
              `production-verified observation`,
          );
        }
      } else if (entry.environment !== "preview" ||
                 entry.deployment_status !== "preview_deployed") {
        errors.push(
          `${prefix}: rehearsal_verified requires evidence from a non-production ` +
            `deployment; '${entry.evidence_id}' is environment '${entry.environment}'`,
        );
      } else if (seen.environment !== "preview" ||
                 seen.deployment_status !== "preview_deployed") {
        errors.push(
          `${prefix}: the observation for ${id} in '${entry.evidence_id}' is ` +
            `environment '${seen.environment}', deployment ` +
            `'${seen.deployment_status}' — not a preview rehearsal observation`,
        );
      }
      if (typeof seen.observed_at !== "string" || !seen.observed_at.trim()) {
        errors.push(
          `${prefix}: the observation for ${id} in '${entry.evidence_id}' records ` +
            `no observed_at, so it does not state when it was seen`,
        );
      }
    }
  }

  // --- capability completeness -------------------------------------------
  const manifest = artifact?.capability_manifest;
  if (!Array.isArray(manifest) || manifest.some((r) => typeof r !== "string" || !r.trim())) {
    errors.push(
      `${prefix}: capability_manifest must be a concrete list of routes the ` +
        `artifact serves, so completeness can be computed rather than asserted`,
    );
  } else {
    const served = new Set(manifest);
    const missing = context.requiredRoutes.filter((route) => !served.has(route));
    if (missing.length > 0) {
      errors.push(
        `${prefix}: capability manifest is missing required route(s) ` +
          `${missing.join(", ")} — a target that drops capabilities is a ` +
          `partial outage, not a rollback`,
      );
    }
    const proof = resolve("capability_manifest_evidence", "the capability manifest");
    if (proof) {
      const observed = proof.observation.observed_routes;
      if (!Array.isArray(observed) ||
          observed.some((route) => typeof route !== "string" || !route.trim())) {
        errors.push(
          `${prefix}: the observation for ${id} in ` +
            `'${proof.entry.evidence_id}' declares no observed_routes array, so ` +
            `no route was actually observed on this artifact`,
        );
      } else {
        // Exact set membership. A route mentioned elsewhere in the document,
        // or bound to a different deployment, is not a route observed here.
        const observedSet = new Set(observed);
        const unproven = context.requiredRoutes.filter(
          (route) => !observedSet.has(route),
        );
        if (unproven.length > 0) {
          errors.push(
            `${prefix}: capability_manifest_evidence '${proof.entry.evidence_id}' ` +
              `does not observe route(s) ${unproven.join(", ")} on this artifact`,
          );
        }
      }
    }
  }

  // --- source binding -----------------------------------------------------
  const commit = artifact?.source_commit;
  if (typeof commit !== "string" || !/^[0-9a-f]{40}$/.test(commit)) {
    errors.push(`${prefix}: a rollback target requires an exact 40-hex source_commit`);
  } else {
    const proof = resolve("source_commit_evidence", "that this artifact was built from this commit");
    if (proof && proof.observation.source_commit !== commit) {
      errors.push(
        `${prefix}: source_commit_evidence '${proof.entry.evidence_id}' binds ` +
          `${id} to source_commit ` +
          `'${proof.observation.source_commit ?? "<none>"}', not ${commit}. A ` +
          `commit appearing elsewhere in that document belongs to a different ` +
          `observation.`,
      );
    }
  }
  if (typeof artifact?.source_commit_binding !== "string" ||
      !artifact.source_commit_binding.trim()) {
    errors.push(
      `${prefix}: source_commit_binding must state how the binding was obtained. ` +
        `It is provenance for a reader, not proof — the proof is ` +
        `source_commit_evidence.`,
    );
  }

  if (!Array.isArray(artifact?.limitations)) {
    errors.push(`${prefix}: a rollback target requires an explicit limitations array`);
  }

  return errors;
}

/**
 * Cross-check the durable evidence against the registry.
 *
 * Resolution derives qualification itself, so it is safe called alone.
 */
export function validateEvidenceAgainstRegistry(evidence, registry, context) {
  const errors = [];
  const rollback = evidence?.rollback;
  if (!rollback || typeof rollback !== "object") {
    return ["rollback evidence has no 'rollback' block"];
  }

  // A stale prose field left behind is how the rejected model persisted.
  if ("release_candidate" in rollback) {
    errors.push(
      "rollback evidence still carries the superseded 'release_candidate' prose " +
        "field; use release_candidate_artifact_id",
    );
  }

  const artifacts = registry?.artifacts ?? [];
  const derivedQualified = artifacts.filter(
    (a) => targetQualificationErrors(a, a?.artifact_id, context).length === 0,
  );

  const named = rollback.release_candidate_artifact_id;
  if (named === null || named === undefined) {
    // The honest "no target" path. It cannot be used to smuggle prose back in,
    // because it requires the registry to independently derive zero targets.
    if (typeof rollback.rollback_unavailable_reason !== "string" ||
        !rollback.rollback_unavailable_reason.trim()) {
      errors.push(
        "rollback evidence names no release candidate and gives no " +
          "rollback_unavailable_reason. Rollback being unavailable is a valid " +
          "state, but it must be stated, not left blank.",
      );
    }
    if (derivedQualified.length > 0) {
      errors.push(
        `rollback evidence declares rollback unavailable, but ` +
          `${derivedQualified.length} registry artifact(s) do qualify`,
      );
    }
    return errors;
  }

  if (typeof named !== "string" || !named.trim()) {
    errors.push(
      "rollback evidence must name release_candidate_artifact_id, or null with a " +
        "rollback_unavailable_reason. Describing the target in prose is how the " +
        "rejected moving-ref model survived in the evidence.",
    );
    return errors;
  }

  const artifact = artifacts.find((a) => a?.artifact_id === named);
  if (!artifact) {
    errors.push(
      `rollback evidence names release candidate '${named}', which is not in the ` +
        `release-artifact registry`,
    );
    return errors;
  }

  errors.push(
    ...targetQualificationErrors(
      artifact,
      `rollback evidence names release candidate '${named}'`,
      context,
    ),
  );
  return errors;
}

export function validateRegistry(registry, context) {
  const errors = [];

  if (!registry || !Array.isArray(registry.artifacts)) {
    return ["registry must be an object with an 'artifacts' array"];
  }
  if (!Array.isArray(registry.required_capability_routes) ||
      registry.required_capability_routes.length === 0) {
    errors.push("registry must declare required_capability_routes");
  }

  const seen = new Set();
  let derivedQualified = 0;

  for (const artifact of registry.artifacts) {
    const id = artifact?.artifact_id ?? "<missing artifact_id>";

    if (typeof artifact?.artifact_id !== "string" || !artifact.artifact_id.trim()) {
      errors.push(`${id}: artifact_id must be a non-empty string`);
    }
    if (seen.has(artifact?.artifact_id)) errors.push(`${id}: duplicate artifact_id`);
    seen.add(artifact?.artifact_id);

    const pattern = PROVIDER_ARTIFACT_ID_PATTERNS[artifact?.provider];
    if (!pattern) {
      errors.push(
        `${id}: provider '${artifact?.provider}' has no registered immutable ` +
          `artifact-id format, so its identifiers cannot be validated. Register ` +
          `the provider's id shape before listing artifacts for it.`,
      );
    } else if (typeof artifact?.artifact_id !== "string" ||
               !pattern.test(artifact.artifact_id)) {
      errors.push(
        `${id}: artifact_id is not a valid immutable ${artifact.provider} ` +
          `artifact id. A rollback target must be a pinned provider artifact — ` +
          `a branch, tag, or any other moving reference cannot be one.`,
      );
    }

    // `qualified` is a GENERATED field. Its only permitted role is to agree
    // with the derivation, and CI proves that here.
    const derivation = targetQualificationErrors(artifact, `${id}: derivation`, context);
    const derived = derivation.length === 0;
    if (derived) derivedQualified += 1;

    if (typeof artifact?.qualified !== "boolean") {
      errors.push(`${id}: qualified must be a boolean generated from the derivation`);
    } else if (artifact.qualified !== derived) {
      errors.push(
        `${id}: qualified=${artifact.qualified} contradicts the derivation, which ` +
          `says ${derived}. 'qualified' is generated, never authoritative.`,
      );
      if (!derived) errors.push(...derivation.map((message) => `  ↳ ${message}`));
    }
  }

  const status = registry.current_status ?? {};
  if (status.qualified_targets !== derivedQualified) {
    errors.push(
      `current_status.qualified_targets (${status.qualified_targets}) does not ` +
        `match the ${derivedQualified} artifact(s) the derivation qualifies`,
    );
  }
  if (derivedQualified === 0 && status.rollback_available_for_a_future_deployment === true) {
    errors.push("no artifact qualifies, so rollback cannot be reported as available");
  }
  if (status.rollback_rehearsed === true && !status.rehearsal_evidence) {
    errors.push("rollback_rehearsed=true requires rehearsal_evidence naming the rehearsal");
  }

  return errors;
}

function selfTest() {
  const ROUTES = ["/api/projectos/health", "/api/mcp"];
  const ID = "dpl_AAAAAAAAAAAAAAAAAAAAAAAA";
  const COMMIT = "a".repeat(40);
  // A second, unrelated deployment described in the SAME evidence document.
  const OTHER_ID = "dpl_BBBBBBBBBBBBBBBBBBBBBBBB";
  const OTHER_COMMIT = "b".repeat(40);

  const proofEntry = (over = {}) => ({
    evidence_id: "live-proof",
    provider: "vercel",
    environment: "production",
    deployment_status: "production_deployed",
    proof_stage: "production_verified",
    production_verified: true,
    current: true,
    superseded_by: null,
    ...over,
  });
  // A STRUCTURED observation. Every fact about ID lives in one record, so no
  // fact can be borrowed from a neighbouring deployment described in the same
  // document.
  const observation = (over = {}) => ({
    provider: "vercel",
    artifact_id: ID,
    environment: "production",
    deployment_status: "production_deployed",
    proof_stage: "production_verified",
    source_commit: COMMIT,
    observed_routes: [...ROUTES],
    observed_at: "2026-08-17T00:00:00Z",
    ...over,
  });
  const proofDoc = (observations) => JSON.stringify({ observations });
  const proofText = proofDoc([observation()]);

  const ctx = (over = {}, text = proofText) =>
    buildEvidenceContext(ROUTES, [
      { entry: proofEntry(over), text, hashMismatch: over.hashMismatch === true },
    ]);
  const context = ctx();

  const target = {
    artifact_id: ID,
    provider: "vercel",
    verification: "production_verified",
    verification_evidence: "live-proof",
    capability_manifest: [...ROUTES],
    capability_manifest_evidence: "live-proof",
    source_commit: COMMIT,
    source_commit_evidence: "live-proof",
    source_commit_binding: "operator deployment record",
    limitations: [],
    qualified: true,
  };
  const t = (mutate) => {
    const copy = JSON.parse(JSON.stringify(target));
    mutate(copy);
    return copy;
  };

  // The round-6 blocking test, exactly as specified by review: every
  // qualifying field asserted, zero backing evidence.
  const forged = {
    artifact_id: ID,
    provider: "vercel",
    verification: "production_verified",
    capability_manifest_covers_required_routes: true,
    source_commit: COMMIT,
    source_commit_binding: "asserted_by_prior_evidence_not_rebound_in_this_pass",
    limitations: [],
    qualified: true,
  };

  const qualificationCases = [
    ["derived target with real backing evidence", target, context, false],
    ["ROUND 6: every field forged, zero backing evidence", forged, context, true],
    ["no evidence context at all", target, null, true],
    ["evidence context missing required routes", target, { evidence: new Map() }, true],
    ["cites evidence that does not exist", t((a) => { a.verification_evidence = "nope"; }), context, true],
    ["cites superseded evidence", target, ctx({ current: false, superseded_by: "newer" }), true],
    ["cites evidence that never names the artifact", target, ctx({}, "some unrelated production record"), true],
    ["cites evidence whose bytes do not match its hash", target, ctx({ hashMismatch: true }), true],
    ["cites another provider's evidence", target, ctx({ provider: "supabase" }), true],
    ["manifest omits a required route", t((a) => { a.capability_manifest = ["/api/mcp"]; }), context, true],
    ["manifest complete but evidence never observes a route", target, ctx({}, `deployment ${ID} built from ${COMMIT}, serves /api/mcp`), true],
    ["manifest is a boolean rather than a route list", t((a) => { a.capability_manifest = true; }), context, true],
    ["evidence does not connect artifact to the commit", target, ctx({}, `deployment ${ID} serves /api/projectos/health and /api/mcp`), true],
    ["source_commit is not 40 hex", t((a) => { a.source_commit = "abc"; }), context, true],
    ["no source_commit_evidence cited", t((a) => { delete a.source_commit_evidence; }), context, true],
    ["no verification_evidence cited", t((a) => { delete a.verification_evidence; }), context, true],
    ["no capability_manifest_evidence cited", t((a) => { delete a.capability_manifest_evidence; }), context, true],
    ["source_commit_binding not stated", t((a) => { delete a.source_commit_binding; }), context, true],
    ["no limitations array", t((a) => { delete a.limitations; }), context, true],
    ["verification is unverified", t((a) => { a.verification = "unverified"; }), context, true],
    ["production_verified claimed on non-production evidence", target, ctx({ environment: "preview", deployment_status: "preview_deployed" }), true],
    ["rehearsal_verified on production evidence", t((a) => { a.verification = "rehearsal_verified"; }), context, true],
    // CASE 8: a genuine preview rehearsal. Both the index entry AND the
    // observation must say preview — a production observation inside a
    // preview-classified document does not become a rehearsal.
    ["rehearsal_verified on preview evidence", t((a) => { a.verification = "rehearsal_verified"; }), ctx({ environment: "preview", deployment_status: "preview_deployed" }, proofDoc([observation({ environment: "preview", deployment_status: "preview_deployed", proof_stage: "deployed" })])), false],
    ["rehearsal claimed on a preview document holding a production observation", t((a) => { a.verification = "rehearsal_verified"; }), ctx({ environment: "preview", deployment_status: "preview_deployed" }), true],
    ["legacy self-asserted capability boolean present", t((a) => { a.capability_manifest_covers_required_routes = true; }), context, true],

    // ------------------------------------------------------------------
    // ADVERSARIAL CASES for the substring-co-occurrence defect.
    //
    // CASE 1 is the defect itself. One evidence document legitimately
    // describes deployment A and deployment B. Under the old three
    // independent includes() checks, A qualified using B's commit and B's
    // routes, because every string it looked for was somewhere in the text.
    // ------------------------------------------------------------------
    [
      "CASE 1: co-occurring deployment B's commit and routes cannot qualify A",
      target,
      ctx({}, proofDoc([
        observation({ source_commit: OTHER_COMMIT, observed_routes: [] }),
        observation({
          artifact_id: OTHER_ID,
          source_commit: COMMIT,
          observed_routes: [...ROUTES],
        }),
      ])),
      true,
    ],
    [
      "CASE 2: exact artifact, wrong source_commit",
      target,
      ctx({}, proofDoc([observation({ source_commit: OTHER_COMMIT })])),
      true,
    ],
    [
      "CASE 3: exact artifact and commit, one required route absent",
      target,
      ctx({}, proofDoc([observation({ observed_routes: [ROUTES[0]] })])),
      true,
    ],
    [
      "CASE 4: superseded evidence entry",
      target,
      ctx({ current: false, superseded_by: "newer-proof" }),
      true,
    ],
    [
      "CASE 5: evidence hash mismatch",
      target,
      ctx({ hashMismatch: true }),
      true,
    ],
    [
      "CASE 6: wrong provider on the observation",
      target,
      ctx({}, proofDoc([observation({ provider: "supabase" })])),
      true,
    ],
    [
      "CASE 6b: wrong provider on the evidence index entry",
      target,
      ctx({ provider: "supabase" }),
      true,
    ],
    [
      "CASE 7: valid structured production observation qualifies",
      target,
      context,
      false,
    ],
    [
      "prose evidence cannot qualify a target",
      target,
      ctx({}, `production deployment ${ID} serves ${ROUTES.join(" and ")} from commit ${COMMIT}`),
      true,
    ],
    [
      "two observations for the same artifact are ambiguous",
      target,
      ctx({}, proofDoc([observation(), observation()])),
      true,
    ],
    [
      "an observation with no observed_routes array proves no route",
      target,
      ctx({}, proofDoc([observation({ observed_routes: undefined })])),
      true,
    ],
    [
      "an observation with no observed_at does not say when it was seen",
      target,
      ctx({}, proofDoc([observation({ observed_at: undefined })])),
      true,
    ],
  ];

  const registry = {
    required_capability_routes: [...ROUTES],
    artifacts: [JSON.parse(JSON.stringify(target))],
    current_status: { qualified_targets: 1, rollback_available_for_a_future_deployment: true },
  };
  const r = (mutate) => {
    const copy = JSON.parse(JSON.stringify(registry));
    mutate(copy);
    return copy;
  };

  const registryCases = [
    ["valid registry", registry, false],
    ["origin/main as artifact id", r((x) => { x.artifacts[0].artifact_id = "origin/main"; }), true],
    ["main as artifact id", r((x) => { x.artifacts[0].artifact_id = "main"; }), true],
    ["HEAD as artifact id", r((x) => { x.artifacts[0].artifact_id = "HEAD"; }), true],
    ["semver tag as artifact id", r((x) => { x.artifacts[0].artifact_id = "v1.2.3"; }), true],
    ["release branch as artifact id", r((x) => { x.artifacts[0].artifact_id = "release/foo"; }), true],
    ["feature branch as artifact id", r((x) => { x.artifacts[0].artifact_id = "feature/x"; }), true],
    ["bare word as artifact id", r((x) => { x.artifacts[0].artifact_id = "production"; }), true],
    ["truncated deployment id", r((x) => { x.artifacts[0].artifact_id = "dpl_abc"; }), true],
    ["unregistered provider", r((x) => { x.artifacts[0].provider = "someprovider"; }), true],
    ["missing provider", r((x) => { delete x.artifacts[0].provider; }), true],
    ["qualified=true contradicting a failed derivation", r((x) => { x.artifacts[0].verification = "unverified"; }), true],
    ["qualified=false contradicting a passing derivation", r((x) => { x.artifacts[0].qualified = false; x.current_status.qualified_targets = 0; x.current_status.rollback_available_for_a_future_deployment = false; }), true],
    ["count mismatch", r((x) => { x.current_status.qualified_targets = 5; }), true],
    ["availability claimed with nothing qualifying", r((x) => {
      x.artifacts[0].verification = "unverified";
      x.artifacts[0].qualified = false;
      x.current_status.qualified_targets = 0;
    }), true],
    ["rehearsal claimed without evidence", r((x) => { x.current_status.rollback_rehearsed = true; }), true],
    ["duplicate artifact id", r((x) => { x.artifacts.push({ ...x.artifacts[0] }); x.current_status.qualified_targets = 2; }), true],
  ];

  const unqualifiedRegistry = r((x) => {
    x.artifacts[0].verification = "unverified";
    x.artifacts[0].qualified = false;
    x.current_status.qualified_targets = 0;
    x.current_status.rollback_available_for_a_future_deployment = false;
  });

  const evidenceCases = [
    ["names the derived-qualified artifact", { rollback: { release_candidate_artifact_id: ID } }, registry, false],
    ["describes the target in prose", { rollback: { release_candidate: "current canonical main, resolved at rollback time" } }, registry, true],
    ["keeps the superseded prose field alongside the id", { rollback: { release_candidate_artifact_id: ID, release_candidate: "origin/main" } }, registry, true],
    ["names an artifact not in the registry", { rollback: { release_candidate_artifact_id: "dpl_notInTheRegistryAtAll000" } }, registry, true],
    ["names an artifact whose derivation fails", { rollback: { release_candidate_artifact_id: ID } }, unqualifiedRegistry, true],
    ["has no rollback block", {}, registry, true],
    ["declares unavailable with a reason, and nothing qualifies", { rollback: { release_candidate_artifact_id: null, rollback_unavailable_reason: "no artifact carries current capability and source-binding evidence" } }, unqualifiedRegistry, false],
    ["declares unavailable with no reason given", { rollback: { release_candidate_artifact_id: null } }, unqualifiedRegistry, true],
    ["declares unavailable while an artifact does qualify", { rollback: { release_candidate_artifact_id: null, rollback_unavailable_reason: "claimed" } }, registry, true],
  ];

  let failures = 0;
  const check = (label, rejected, shouldReject, detail) => {
    if (rejected !== shouldReject) {
      console.error(
        `SELF-TEST FAIL: '${label}' expected ${shouldReject ? "rejection" : "acceptance"}` +
          `, got ${rejected ? "rejection" : "acceptance"}` +
          (rejected && detail ? `: ${detail}` : ""),
      );
      failures += 1;
    }
  };

  for (const [label, artifact, ctxUsed, shouldReject] of qualificationCases) {
    const errors = targetQualificationErrors(artifact, artifact?.artifact_id, ctxUsed);
    check(label, errors.length > 0, shouldReject, errors[0]);
  }
  for (const [label, reg, shouldReject] of registryCases) {
    const errors = validateRegistry(reg, context);
    check(label, errors.length > 0, shouldReject, errors[0]);
  }
  for (const [label, evidence, reg, shouldReject] of evidenceCases) {
    const errors = validateEvidenceAgainstRegistry(evidence, reg, context);
    check(label, errors.length > 0, shouldReject, errors[0]);
  }

  if (failures > 0) exit(1);
  const total = qualificationCases.length + registryCases.length + evidenceCases.length;
  console.log(`Rollback target self-test passed (${total} cases).`);
}

function main() {
  if (argv.includes("--self-test")) selfTest();

  if (!existsSync(REGISTRY_PATH)) {
    console.error(`Missing ${REGISTRY_PATH}`);
    exit(1);
  }
  const registry = JSON.parse(readFileSync(REGISTRY_PATH, "utf8"));
  const context = loadEvidenceContextFromDisk(registry.required_capability_routes ?? []);
  const errors = validateRegistry(registry, context);

  if (existsSync(EVIDENCE_PATH)) {
    errors.push(
      ...validateEvidenceAgainstRegistry(
        JSON.parse(readFileSync(EVIDENCE_PATH, "utf8")),
        registry,
        context,
      ),
    );
  }

  if (errors.length > 0) {
    console.error("Rollback target gate FAILED:");
    for (const message of errors) console.error(`  - ${message}`);
    exit(1);
  }

  const qualified = registry.artifacts.filter(
    (a) => targetQualificationErrors(a, a.artifact_id, context).length === 0,
  );
  console.log(
    `Rollback target gate passed: ${registry.artifacts.length} artifacts, ` +
      `${qualified.length} qualified by derivation` +
      (qualified.length === 0 ? " — ROLLBACK UNAVAILABLE, forward recovery is the safe path" : "") +
      (registry.current_status?.rollback_rehearsed ? "" : " (rehearsal outstanding)") +
      ".",
  );
}

main();
