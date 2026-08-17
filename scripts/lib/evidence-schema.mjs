// Machine-readable contract for Pandora Memory evidence artifacts.
//
// Historical recovery evidence is immutable: this module never rewrites an
// existing artifact. Instead, every artifact is described by an entry in
// docs/evidence/EVIDENCE_INDEX.json, which records what the artifact observed,
// when, against which provider resource, and — critically — whether it is still
// current or has been superseded.
//
// The failure mode this exists to prevent is a human or agent reading a
// months-old provider snapshot and treating it as present-day truth.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import {
  DEPLOYMENT_STATUSES,
  ENVIRONMENTS,
  isProofStage,
  PROVIDERS,
  REVIEW_STATUSES,
} from "./proof.mjs";

export const EVIDENCE_INDEX_PATH = "docs/evidence/EVIDENCE_INDEX.json";

const SHA1_RE = /^[0-9a-f]{40}$/;
const SHA256_RE = /^[0-9a-f]{64}$/;
const RFC3339_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

/** Required fields on every evidence-index entry. */
export const REQUIRED_FIELDS = [
  "evidence_id",
  "path",
  "observed_at",
  "source_commit",
  "source_tree",
  "environment",
  "provider",
  "provider_resource_id",
  "proof_stage",
  "current",
  "supersedes",
  "superseded_by",
  "evidence_sha256",
  "review_status",
  "deployment_status",
  "production_verified",
  "rollback_ref",
];

export function sha256Hex(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

export function fileSha256(path) {
  return sha256Hex(readFileSync(path));
}

function fail(errors, id, message) {
  errors.push(`${id}: ${message}`);
}

/**
 * Validate one evidence-index entry.
 *
 * Returns an array of human-readable error strings; empty means valid.
 */
export function validateEntry(entry, { knownIds } = {}) {
  const errors = [];
  const id = entry?.evidence_id ?? "<missing evidence_id>";

  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    return ["<entry>: not a JSON object"];
  }

  for (const field of REQUIRED_FIELDS) {
    if (!(field in entry)) fail(errors, id, `missing required field '${field}'`);
  }

  if (typeof entry.evidence_id !== "string" || !entry.evidence_id.trim()) {
    fail(errors, id, "evidence_id must be a non-empty string");
  }
  if (typeof entry.path !== "string" || !entry.path.trim()) {
    fail(errors, id, "path must be a non-empty string");
  }
  if (typeof entry.observed_at !== "string" || !RFC3339_RE.test(entry.observed_at)) {
    fail(errors, id, "observed_at must be an RFC3339 timestamp with explicit timezone");
  }
  if (typeof entry.source_commit !== "string" || !SHA1_RE.test(entry.source_commit)) {
    fail(errors, id, "source_commit must be a 40-hex git commit SHA");
  }
  if (typeof entry.source_tree !== "string" || !SHA1_RE.test(entry.source_tree)) {
    fail(errors, id, "source_tree must be a 40-hex git tree SHA");
  }
  if (!ENVIRONMENTS.includes(entry.environment)) {
    fail(errors, id, `environment must be one of ${ENVIRONMENTS.join(", ")}`);
  }
  if (!PROVIDERS.includes(entry.provider)) {
    fail(errors, id, `provider must be one of ${PROVIDERS.join(", ")}`);
  }
  if (entry.provider === "none") {
    if (entry.provider_resource_id !== null) {
      fail(errors, id, "provider_resource_id must be null when provider is 'none'");
    }
  } else if (
    typeof entry.provider_resource_id !== "string" ||
    !entry.provider_resource_id.trim()
  ) {
    fail(errors, id, "provider_resource_id must be a non-empty string");
  }
  if (!isProofStage(entry.proof_stage)) {
    fail(errors, id, `proof_stage '${entry.proof_stage}' is not a known proof stage`);
  }
  if (typeof entry.current !== "boolean") {
    fail(errors, id, "current must be a boolean");
  }
  if (!Array.isArray(entry.supersedes)) {
    fail(errors, id, "supersedes must be an array");
  }
  if (entry.superseded_by !== null && typeof entry.superseded_by !== "string") {
    fail(errors, id, "superseded_by must be null or an evidence_id string");
  }
  if (typeof entry.evidence_sha256 !== "string" || !SHA256_RE.test(entry.evidence_sha256)) {
    fail(errors, id, "evidence_sha256 must be a 64-hex SHA-256 digest");
  }
  if (!REVIEW_STATUSES.includes(entry.review_status)) {
    fail(errors, id, `review_status must be one of ${REVIEW_STATUSES.join(", ")}`);
  }
  if (!DEPLOYMENT_STATUSES.includes(entry.deployment_status)) {
    fail(errors, id, `deployment_status must be one of ${DEPLOYMENT_STATUSES.join(", ")}`);
  }
  if (typeof entry.production_verified !== "boolean") {
    fail(errors, id, "production_verified must be a boolean");
  }
  if (entry.rollback_ref !== null && typeof entry.rollback_ref !== "string") {
    fail(errors, id, "rollback_ref must be null or a string");
  }

  // Consistency rules. These are the assertions that stop an artifact from
  // quietly overstating how far it has actually travelled.
  if (entry.production_verified === true && entry.proof_stage !== "production_verified") {
    fail(errors, id, "production_verified=true requires proof_stage 'production_verified'");
  }
  if (
    entry.production_verified === true &&
    entry.deployment_status !== "production_deployed"
  ) {
    fail(errors, id, "production_verified=true requires deployment_status 'production_deployed'");
  }
  if (entry.deployment_status === "source_only" && entry.proof_stage === "deployed") {
    fail(errors, id, "deployment_status 'source_only' contradicts proof_stage 'deployed'");
  }
  if (entry.current === true && entry.superseded_by !== null) {
    fail(errors, id, "an entry cannot be current and superseded at the same time");
  }
  if (entry.current === false && entry.superseded_by === null) {
    fail(errors, id, "a non-current entry must name the evidence_id that superseded it");
  }

  if (knownIds) {
    if (entry.superseded_by !== null && !knownIds.has(entry.superseded_by)) {
      fail(errors, id, `superseded_by references unknown evidence_id '${entry.superseded_by}'`);
    }
    for (const ref of Array.isArray(entry.supersedes) ? entry.supersedes : []) {
      if (!knownIds.has(ref)) {
        fail(errors, id, `supersedes references unknown evidence_id '${ref}'`);
      }
    }
  }

  return errors;
}

/**
 * Validate a whole evidence index, including cross-entry invariants.
 */
export function validateIndex(index) {
  const errors = [];
  if (!index || typeof index !== "object" || !Array.isArray(index.entries)) {
    return ["evidence index must be an object with an 'entries' array"];
  }

  const knownIds = new Set(index.entries.map((entry) => entry?.evidence_id));
  const seen = new Set();

  for (const entry of index.entries) {
    errors.push(...validateEntry(entry, { knownIds }));
    if (seen.has(entry?.evidence_id)) {
      errors.push(`${entry.evidence_id}: duplicate evidence_id`);
    }
    seen.add(entry?.evidence_id);
  }

  // A supersedes B must be mirrored by B.superseded_by === A.
  const byId = new Map(index.entries.map((entry) => [entry?.evidence_id, entry]));
  for (const entry of index.entries) {
    for (const ref of Array.isArray(entry?.supersedes) ? entry.supersedes : []) {
      const target = byId.get(ref);
      if (target && target.superseded_by !== entry.evidence_id) {
        errors.push(
          `${entry.evidence_id}: supersedes '${ref}' but '${ref}'.superseded_by is ` +
            `'${target.superseded_by}' (link must be symmetric)`,
        );
      }
    }
  }

  return errors;
}
