const EVIDENCE_PROOF_STAGES = new Set([
  "documented",
  "implemented",
  "tested",
  "deployed",
  "production_verified",
]);
const EVIDENCE_SOURCE = "projectos-post-task";
const EVIDENCE_CANDIDATE_TYPE = "projectos_outcome";
const EVIDENCE_INTAKE_KIND = "projectos_evidence_candidate_v1";
const EVIDENCE_IDEMPOTENCY_PATTERN = /^[A-Za-z0-9._:-]{16,160}$/;
const EVIDENCE_PROJECT_KEY_PATTERN = /^[a-z0-9][a-z0-9._-]{1,95}$/;
const EVIDENCE_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EVIDENCE_SHA40_PATTERN = /^[a-f0-9]{40}$/i;
const EVIDENCE_SHA256_PATTERN = /^[a-f0-9]{64}$/i;

const boundedEvidenceText = (
  value: unknown,
  max: number,
): string | null => {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (!normalized || normalized.length > max) return null;
  return normalized;
};

const evidenceIsoTimestamp = (value: unknown): string | null => {
  const normalized = boundedEvidenceText(value, 64);
  if (!normalized) return null;
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? normalized : null;
};

const evidenceSensitiveReason = (value: unknown): string | null => {
  const serialized = JSON.stringify(value);
  const checks: Array<[RegExp, string]> = [
    [/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i, "direct_identifier_email"],
    [/\b(?:ghp|github_pat|glpat|sk|sbp|xox[baprs])_[A-Za-z0-9_-]{12,}\b/i, "credential_signature"],
    [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/, "jwt_signature"],
    [/\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|service[_-]?role|private[_-]?key)\s*[:=]\s*["']?[A-Za-z0-9_./+=-]{12,}/i, "secret_assignment"],
  ];
  for (const [pattern, reason] of checks) {
    if (pattern.test(serialized)) return reason;
  }
  return null;
};

const evidenceSha256 = async (value: string): Promise<string> => {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
};

const parseEvidenceRefs = (value: unknown): JsonRecord[] | null => {
  if (!Array.isArray(value) || value.length < 1 || value.length > 20) return null;
  const parsed: JsonRecord[] = [];
  for (const item of value) {
    if (!isRecord(item)) return null;
    const allowed = new Set([
      "type",
      "ref",
      "sha256",
      "artifact_class",
      "observed_at",
    ]);
    if (Object.keys(item).some((key) => !allowed.has(key))) return null;
    const type = boundedEvidenceText(item.type, 64);
    const ref = boundedEvidenceText(item.ref, 512);
    if (!type || !ref) return null;
    const output: JsonRecord = { type, ref };
    if (item.sha256 !== undefined) {
      const digest = boundedEvidenceText(item.sha256, 64);
      if (!digest || !EVIDENCE_SHA256_PATTERN.test(digest)) return null;
      output.sha256 = digest.toLowerCase();
    }
    if (item.artifact_class !== undefined) {
      const artifactClass = boundedEvidenceText(item.artifact_class, 64);
      if (!artifactClass) return null;
      output.artifact_class = artifactClass;
    }
    if (item.observed_at !== undefined) {
      const observedAt = evidenceIsoTimestamp(item.observed_at);
      if (!observedAt) return null;
      output.observed_at = observedAt;
    }
    parsed.push(output);
  }
  return parsed;
};

const parseEvidenceProvenance = (value: unknown): JsonRecord | null => {
  if (!isRecord(value)) return null;
  const allowed = new Set([
    "source_type",
    "source_locator",
    "source_sha",
    "parent_sha",
    "observed_at",
  ]);
  if (Object.keys(value).some((key) => !allowed.has(key))) return null;
  const sourceType = boundedEvidenceText(value.source_type, 64);
  const sourceLocator = boundedEvidenceText(value.source_locator, 512);
  const observedAt = evidenceIsoTimestamp(value.observed_at);
  if (!sourceType || !sourceLocator || !observedAt) return null;

  const output: JsonRecord = {
    source_type: sourceType,
    source_locator: sourceLocator,
    observed_at: observedAt,
  };
  if (value.source_sha !== undefined) {
    const sourceSha = boundedEvidenceText(value.source_sha, 40);
    if (!sourceSha || !EVIDENCE_SHA40_PATTERN.test(sourceSha)) return null;
    output.source_sha = sourceSha.toLowerCase();
  }
  if (value.parent_sha !== undefined) {
    const parentSha = boundedEvidenceText(value.parent_sha, 40);
    if (!parentSha || !EVIDENCE_SHA40_PATTERN.test(parentSha)) return null;
    output.parent_sha = parentSha.toLowerCase();
  }
  return output;
};

const submitEvidenceCandidate = async (
  body: JsonRecord,
  principal: Principal,
  admin: AdminClient,
): Promise<Response> => {
  if (!principal.scopes.includes("memory:write")) {
    return respond({ ok: false, error: "scope_not_allowed" }, 403);
  }

  const allowedKeys = new Set([
    "action",
    "namespace",
    "project_id",
    "project_key",
    "title",
    "summary",
    "proof_stage",
    "claim",
    "evidence_refs",
    "provenance",
    "idempotency_key",
  ]);
  if (Object.keys(body).some((key) => !allowedKeys.has(key))) {
    return respond({ ok: false, error: "unexpected_field" }, 400);
  }

  const namespace = boundedEvidenceText(body.namespace, 64);
  if (!namespace || !principal.allowed_namespaces.includes(namespace)) {
    return respond({ ok: false, error: "namespace_not_allowed" }, 403);
  }

  const projectId = body.project_id === null || body.project_id === undefined
    ? null
    : boundedEvidenceText(body.project_id, 64);
  const projectKey = body.project_key === null || body.project_key === undefined
    ? null
    : boundedEvidenceText(body.project_key, 96);
  if (
    (!projectId && !projectKey) ||
    (projectId && !EVIDENCE_UUID_PATTERN.test(projectId)) ||
    (projectKey && !EVIDENCE_PROJECT_KEY_PATTERN.test(projectKey))
  ) {
    return respond({ ok: false, error: "project_identity_invalid" }, 400);
  }

  const title = boundedEvidenceText(body.title, 200);
  const summary = boundedEvidenceText(body.summary, 1800);
  const proofStage = boundedEvidenceText(body.proof_stage, 64);
  const claim = boundedEvidenceText(body.claim, 1000);
  const idempotencyKey = boundedEvidenceText(body.idempotency_key, 160);
  const evidenceRefs = parseEvidenceRefs(body.evidence_refs);
  const provenance = parseEvidenceProvenance(body.provenance);
  if (
    !title ||
    !summary ||
    !proofStage ||
    !EVIDENCE_PROOF_STAGES.has(proofStage) ||
    !claim ||
    !idempotencyKey ||
    !EVIDENCE_IDEMPOTENCY_PATTERN.test(idempotencyKey) ||
    !evidenceRefs ||
    !provenance
  ) {
    return respond({ ok: false, error: "evidence_candidate_invalid" }, 400);
  }

  const sanitized = {
    namespace,
    project_id: projectId,
    project_key: projectKey,
    title,
    summary,
    proof_stage: proofStage,
    claim,
    evidence_refs: evidenceRefs,
    provenance,
    idempotency_key: idempotencyKey,
  };
  const sensitiveReason = evidenceSensitiveReason(sanitized);
  if (sensitiveReason) {
    return respond({
      ok: false,
      error: "sensitive_candidate_rejected",
      reason: sensitiveReason,
    }, 400);
  }

  const projectReference = projectKey ?? `project-id:${projectId}`;
  const sourceRef = `projectos-evidence:${idempotencyKey}`;
  const fingerprint = await evidenceSha256(
    `${sourceRef}\n${namespace}\n${projectReference}\n${proofStage}\n${summary}\n${claim}`,
  );
  const now = new Date().toISOString();

  let candidateId: string | null = null;
  let candidateCreated = false;
  const { data: existingCandidate, error: existingCandidateError } = await admin
    .from("memory_capture_candidates")
    .select("id")
    .eq("user_id", principal.memory_user_id)
    .eq("namespace", namespace)
    .eq("source", EVIDENCE_SOURCE)
    .eq("source_ref", sourceRef)
    .maybeSingle();

  if (existingCandidateError) {
    console.error("projectos_evidence_candidate_lookup_failed", existingCandidateError.message);
    return respond({ ok: false, error: "candidate_lookup_failed" }, 500);
  }

  candidateId = existingCandidate?.id ?? null;
  if (!candidateId) {
    const candidate = {
      user_id: principal.memory_user_id,
      namespace,
      source: EVIDENCE_SOURCE,
      source_ref: sourceRef,
      raw_excerpt: null,
      redacted_excerpt: summary,
      memory_type: "business_fact",
      title,
      summary,
      importance: 8,
      sensitivity: "low",
      confidence: 0.95,
      should_capture: true,
      requires_review: true,
      status: "pending",
      reason:
        "ProjectOS evidence intake is review-gated. This candidate cannot become canonical without an authenticated human decision.",
      people: [],
      projects: [projectReference],
      risks: [],
      tags: ["projectos", "evidence_candidate", proofStage],
      metadata: {
        schema_version: 1,
        intake_kind: EVIDENCE_INTAKE_KIND,
        project_id: projectId,
        project_key: projectKey,
        proof_stage: proofStage,
        claim,
        evidence_refs: evidenceRefs,
        provenance,
        idempotency_key: idempotencyKey,
        privacy_policy: "metadata_only_v1",
        imported_raw_arguments: false,
        imported_raw_results: false,
        imported_raw_errors: false,
        imported_personal_identifiers: false,
        imported_secrets: false,
      },
      usefulness_score: 0.9,
      confidence_score: 0.95,
      freshness_score: 1,
      retrieval_weight: 0.9,
      stale_status: "active",
      scoring_version: "projectos-evidence-v1",
      scored_at: now,
    };

    const { data: insertedCandidate, error: candidateInsertError } = await admin
      .from("memory_capture_candidates")
      .insert(candidate)
      .select("id")
      .maybeSingle();

    if (candidateInsertError && errorCode(candidateInsertError) !== "23505") {
      console.error("projectos_evidence_candidate_insert_failed", candidateInsertError.message);
      return respond({ ok: false, error: "candidate_insert_failed" }, 500);
    }

    if (insertedCandidate?.id) {
      candidateId = insertedCandidate.id;
      candidateCreated = true;
    } else {
      const { data: racedCandidate, error: racedCandidateError } = await admin
        .from("memory_capture_candidates")
        .select("id")
        .eq("user_id", principal.memory_user_id)
        .eq("namespace", namespace)
        .eq("source", EVIDENCE_SOURCE)
        .eq("source_ref", sourceRef)
        .maybeSingle();
      if (racedCandidateError || !racedCandidate?.id) {
        return respond({ ok: false, error: "candidate_recovery_failed" }, 500);
      }
      candidateId = racedCandidate.id;
    }
  }

  let reviewItemId: string | null = null;
  let reviewCreated = false;
  const { data: existingReview, error: existingReviewError } = await admin
    .from("memory_review_queue_items")
    .select("id")
    .eq("user_id", principal.memory_user_id)
    .eq("namespace", namespace)
    .eq("candidate_type", EVIDENCE_CANDIDATE_TYPE)
    .eq("source_ref", sourceRef)
    .maybeSingle();

  if (existingReviewError) {
    console.error("projectos_evidence_review_lookup_failed", existingReviewError.message);
    return respond({ ok: false, error: "review_lookup_failed" }, 500);
  }
  reviewItemId = existingReview?.id ?? null;

  if (!reviewItemId) {
    const { data: insertedReview, error: reviewInsertError } = await admin
      .from("memory_review_queue_items")
      .insert({
        user_id: principal.memory_user_id,
        namespace,
        status: "pending_review",
        candidate_type: EVIDENCE_CANDIDATE_TYPE,
        normalized_text: summary,
        evidence_snapshot: {
          hasEvidence: true,
          intakeKind: EVIDENCE_INTAKE_KIND,
          sourceRef,
          proofStage,
          claim,
          evidenceRefs,
          provenance,
          candidateId,
        },
        sensitivity_snapshot: {
          classification: "low",
          containsSecrets: false,
          containsPersonalData: false,
          containsRawArguments: false,
          containsRawResults: false,
          containsRawErrors: false,
        },
        namespace_snapshot: {
          sourceNamespace: namespace,
          targetNamespace: namespace,
          namespaceMatch: true,
        },
        source_metadata: {
          source: EVIDENCE_SOURCE,
          sourceKind: "projectos_evidence",
          sourceRef,
          projectId,
          projectKey,
          proofStage,
        },
        audit_metadata: {
          schemaVersion: 1,
          candidateId,
          appendOnly: true,
          reviewRequired: true,
          idempotencyKey,
          fingerprint,
        },
        append_only: true,
        proposed_operation: "append",
        requires_review: true,
        source_ref: sourceRef,
        request_hash: fingerprint,
        fingerprint,
        persistence_execution_metadata: {},
      })
      .select("id")
      .maybeSingle();

    if (reviewInsertError && errorCode(reviewInsertError) !== "23505") {
      console.error("projectos_evidence_review_insert_failed", reviewInsertError.message);
      return respond({ ok: false, error: "review_insert_failed" }, 500);
    }

    if (insertedReview?.id) {
      reviewItemId = insertedReview.id;
      reviewCreated = true;
    } else {
      const { data: racedReview, error: racedReviewError } = await admin
        .from("memory_review_queue_items")
        .select("id")
        .eq("user_id", principal.memory_user_id)
        .eq("namespace", namespace)
        .eq("candidate_type", EVIDENCE_CANDIDATE_TYPE)
        .eq("source_ref", sourceRef)
        .maybeSingle();
      if (racedReviewError || !racedReview?.id) {
        return respond({ ok: false, error: "review_recovery_failed" }, 500);
      }
      reviewItemId = racedReview.id;
    }
  }

  return respond({
    ok: true,
    candidate_id: candidateId,
    review_item_id: reviewItemId,
    status: "pending_review",
    idempotency_key: idempotencyKey,
    namespace,
    project_id: projectId,
    project_key: projectKey,
    proof_stage: proofStage,
    deduplicated: !(candidateCreated || reviewCreated),
    created_at: candidateCreated || reviewCreated ? now : null,
    canonical_memory_written: false,
    privacy_policy: "metadata_only_v1",
  }, candidateCreated || reviewCreated ? 202 : 200);
};
