// Shared proof-stage vocabulary for Pandora Memory evidence artifacts.
//
// Every Pandora remediation artifact must be classifiable along one axis:
//
//   documented -> implemented -> source_tested -> merged -> deployed
//                                                        -> production_verified
//
// Nothing may claim a later stage than its evidence actually proves. The
// ordering below is the single source of truth used by the evidence-metadata
// validator, the migration parity manifest, and the Edge Function parity report.

export const PROOF_STAGES = [
  "documented",
  "implemented",
  "source_tested",
  "merged",
  "deployed",
  "production_verified",
];

export const PROOF_STAGE_INDEX = new Map(
  PROOF_STAGES.map((stage, index) => [stage, index]),
);

export const REVIEW_STATUSES = [
  "not_submitted",
  "awaiting_independent_review",
  "changes_requested",
  "independently_reviewed",
];

export const DEPLOYMENT_STATUSES = [
  "source_only",
  "preview_deployed",
  "production_deployed",
];

export const ENVIRONMENTS = ["source", "preview", "production"];

export const PROVIDERS = ["github", "supabase", "vercel", "none"];

/**
 * Source availability for a recovered historical artifact.
 *
 * `authentic` means the exact original bytes are present and hash-verified.
 * `reconstructed` means the SQL was rebuilt from provider state and is
 * explicitly NOT the original artifact.
 * `missing` means no source exists and none was invented.
 */
export const SOURCE_AVAILABILITY = ["authentic", "reconstructed", "missing"];

export function isProofStage(value) {
  return PROOF_STAGE_INDEX.has(value);
}

/** Return true when `stage` is at or beyond `minimum` in the proof ordering. */
export function proofStageAtLeast(stage, minimum) {
  if (!isProofStage(stage) || !isProofStage(minimum)) return false;
  return PROOF_STAGE_INDEX.get(stage) >= PROOF_STAGE_INDEX.get(minimum);
}
