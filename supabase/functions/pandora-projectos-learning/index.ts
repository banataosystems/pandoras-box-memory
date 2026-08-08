import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.110.9";

const INTEGRATION_KEY = "projectos-learning-bridge";
const PRODUCT_KEY = "projectos";
const NAMESPACE = "real_life";
const SOURCE = "projectos-post-task";
const MAX_BODY_BYTES = 32 * 1024;
const MAX_CLOCK_SKEW_MS = 5 * 60_000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH_PATTERN = /^[0-9a-f]{64}$/i;
const SAFE_TOKEN_PATTERN = /^[A-Za-z0-9._:/-]{1,180}$/;
const OUTCOME_STATUSES = new Set(["completed", "failed"]);
const RISKS = new Set(["read", "write", "destructive"]);
const CONTEXT_STATUSES = new Set(["available", "empty"]);

type JsonRecord = Record<string, unknown>;

const json = (status: number, body: JsonRecord) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });

const record = (value: unknown): JsonRecord =>
  value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {};

const requiredText = (value: unknown, max = 180): string | null => {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (!normalized || normalized.length > max) return null;
  return normalized;
};

const optionalText = (value: unknown, max = 180): string | null => {
  if (value === null || value === undefined || value === "") return null;
  return requiredText(value, max);
};

const safeToken = (value: unknown, max = 180): string | null => {
  const normalized = requiredText(value, max);
  return normalized && SAFE_TOKEN_PATTERN.test(normalized) ? normalized : null;
};

const uuid = (value: unknown): string | null => {
  const normalized = requiredText(value, 64);
  return normalized && UUID_PATTERN.test(normalized) ? normalized.toLowerCase() : null;
};

const optionalUuid = (value: unknown): string | null => {
  if (value === null || value === undefined || value === "") return null;
  return uuid(value);
};

const hash = (value: unknown): string | null => {
  const normalized = optionalText(value, 64);
  return normalized && HASH_PATTERN.test(normalized)
    ? normalized.toLowerCase()
    : null;
};

const integer = (value: unknown, min: number, max: number): number | null => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) return null;
  return parsed;
};

const isoTimestamp = (value: unknown): string | null => {
  const normalized = requiredText(value, 64);
  if (!normalized) return null;
  const parsed = Date.parse(normalized);
  if (!Number.isFinite(parsed)) return null;
  return normalized;
};

const constantTimeEqual = (left: string, right: string): boolean => {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return mismatch === 0;
};

const hmacHex = async (secret: string, value: string): Promise<string> => {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
  return Array.from(new Uint8Array(signature))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
};

const sha256 = async (value: string): Promise<string> => {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
};

const signatureBasis = (input: {
  sourceEventId: string;
  sourceRequestId: string;
  organizationId: string;
  intakeId: string | null;
  projectId: string | null;
  projectKey: string;
  tool: string;
  risk: string;
  outcomeStatus: string;
  durationMs: number;
  completedAt: string;
  contextStatus: string;
  contextHash: string;
  resultFingerprint: string | null;
  errorFingerprint: string | null;
}): string =>
  [
    "projectos-learning-v1",
    input.sourceEventId,
    input.sourceRequestId,
    input.organizationId,
    input.intakeId ?? "",
    input.projectId ?? "",
    input.projectKey,
    input.tool,
    input.risk,
    input.outcomeStatus,
    String(input.durationMs),
    input.completedAt,
    input.contextStatus,
    input.contextHash,
    input.resultFingerprint ?? "",
    input.errorFingerprint ?? "",
  ].join("\n");

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") {
    return json(405, { ok: false, error: "method_not_allowed" });
  }

  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return json(413, { ok: false, error: "payload_too_large" });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    return json(503, { ok: false, error: "service_not_configured" });
  }

  const rawBody = await request.text();
  if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) {
    return json(413, { ok: false, error: "payload_too_large" });
  }

  let payload: JsonRecord;
  try {
    payload = record(JSON.parse(rawBody));
  } catch {
    return json(400, { ok: false, error: "invalid_json" });
  }

  if (
    integer(payload.schema_version, 1, 1) !== 1 ||
    payload.product_key !== PRODUCT_KEY ||
    payload.privacy_policy !== "metadata_only_v1"
  ) {
    return json(400, { ok: false, error: "unsupported_schema" });
  }

  const sourceEventId = uuid(payload.source_event_id);
  const sourceRequestId = uuid(payload.source_request_id);
  const organizationId = uuid(payload.organization_id);
  const intakeId = optionalUuid(payload.intake_id);
  const projectId = optionalUuid(payload.project_id);
  const projectKey = safeToken(payload.project_key, 160);
  const tool = safeToken(payload.tool, 180);
  const risk = requiredText(payload.risk, 32);
  const outcomeStatus = requiredText(payload.outcome_status, 32);
  const durationMs = integer(payload.duration_ms, 0, 86_400_000);
  const completedAt = isoTimestamp(payload.completed_at);
  const contextStatus = requiredText(payload.context_status, 32);
  const contextHash = hash(payload.context_hash);
  const resultFingerprint = hash(payload.result_fingerprint);
  const errorFingerprint = hash(payload.error_fingerprint);

  if (
    !sourceEventId ||
    !sourceRequestId ||
    !organizationId ||
    !projectKey ||
    !tool ||
    !risk ||
    !RISKS.has(risk) ||
    !outcomeStatus ||
    !OUTCOME_STATUSES.has(outcomeStatus) ||
    durationMs === null ||
    !completedAt ||
    !contextStatus ||
    !CONTEXT_STATUSES.has(contextStatus) ||
    !contextHash
  ) {
    return json(400, { ok: false, error: "invalid_learning_event" });
  }

  if (risk !== "read" && contextStatus !== "available") {
    return json(400, { ok: false, error: "invalid_context_gate_state" });
  }
  if (outcomeStatus === "failed" && !errorFingerprint) {
    return json(400, { ok: false, error: "failed_event_requires_error_fingerprint" });
  }

  const timestamp = request.headers.get("x-pandora-timestamp") || "";
  const suppliedSignature = request.headers.get("x-pandora-signature") || "";
  const timestampMs = Number(timestamp);
  if (
    !Number.isFinite(timestampMs) ||
    Math.abs(Date.now() - timestampMs) > MAX_CLOCK_SKEW_MS
  ) {
    return json(401, { ok: false, error: "stale_or_invalid_timestamp" });
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: credential, error: credentialError } = await admin.rpc(
    "pandora_integration_credential",
    { p_integration_key: INTEGRATION_KEY },
  );
  const credentialRecord = record(credential);
  const secret = requiredText(credentialRecord.secret_value, 512);
  const memoryUserId = uuid(credentialRecord.memory_user_id);
  const allowedProducts = Array.isArray(credentialRecord.allowed_product_keys)
    ? credentialRecord.allowed_product_keys.filter(
      (value): value is string => typeof value === "string",
    )
    : [];

  if (
    credentialError ||
    !secret ||
    !memoryUserId ||
    credentialRecord.is_active !== true ||
    !allowedProducts.includes(PRODUCT_KEY)
  ) {
    return json(503, { ok: false, error: "bridge_not_configured" });
  }

  const basis = signatureBasis({
    sourceEventId,
    sourceRequestId,
    organizationId,
    intakeId,
    projectId,
    projectKey,
    tool,
    risk,
    outcomeStatus,
    durationMs,
    completedAt,
    contextStatus,
    contextHash,
    resultFingerprint,
    errorFingerprint,
  });
  const expectedSignature = await hmacHex(secret, `${timestamp}.${basis}`);
  if (!constantTimeEqual(expectedSignature, suppliedSignature)) {
    return json(401, { ok: false, error: "invalid_signature" });
  }

  const sourceRef = `projectos-plan:${sourceEventId}`;
  const title = `ProjectOS ${outcomeStatus}: ${tool}`.slice(0, 240);
  const summary = [
    `ProjectOS ${outcomeStatus} the ${risk} operation ${tool}`,
    `for ${projectKey}`,
    `after ${contextStatus} Pandora Memory hydration`,
    `in ${durationMs} ms at ${completedAt}.`,
    "Only privacy-safe operational metadata and cryptographic fingerprints were retained.",
  ].join(" ").slice(0, 1800);
  const requestHash = await sha256(rawBody);
  const fingerprint = await sha256(`${sourceRef}\n${summary}`);

  let candidateId: string | null = null;
  let candidateCreated = false;

  const { data: existingCandidate, error: existingCandidateError } = await admin
    .from("memory_capture_candidates")
    .select("id")
    .eq("user_id", memoryUserId)
    .eq("namespace", NAMESPACE)
    .eq("source", SOURCE)
    .eq("source_ref", sourceRef)
    .maybeSingle();

  if (existingCandidateError) {
    console.error("projectos_candidate_lookup_failed", existingCandidateError.message);
    return json(500, { ok: false, error: "candidate_lookup_failed" });
  }

  candidateId = existingCandidate?.id ?? null;
  if (!candidateId) {
    const candidate = {
      user_id: memoryUserId,
      namespace: NAMESPACE,
      source: SOURCE,
      source_ref: sourceRef,
      raw_excerpt: null,
      redacted_excerpt: summary,
      memory_type: outcomeStatus === "failed" ? "risk_signal" : "business_fact",
      title,
      summary,
      importance: outcomeStatus === "failed" ? 8 : 6,
      sensitivity: "low",
      confidence: 0.92,
      should_capture: true,
      requires_review: true,
      status: "pending",
      reason:
        "Post-task operational learning is review-gated. This candidate cannot become canonical without an authenticated human decision.",
      people: [],
      projects: [projectKey],
      risks: outcomeStatus === "failed"
        ? ["A ProjectOS operation failed; investigate using authoritative provider evidence."]
        : [],
      tags: ["projectos", "post_task_learning", outcomeStatus, risk],
      metadata: {
        schema_version: 1,
        source_event_id: sourceEventId,
        source_request_id: sourceRequestId,
        organization_id: organizationId,
        intake_id: intakeId,
        project_id: projectId,
        project_key: projectKey,
        tool,
        risk,
        outcome_status: outcomeStatus,
        duration_ms: durationMs,
        completed_at: completedAt,
        context_status: contextStatus,
        context_hash: contextHash,
        result_fingerprint: resultFingerprint,
        error_fingerprint: errorFingerprint,
        privacy_policy: "metadata_only_v1",
        imported_raw_arguments: false,
        imported_raw_results: false,
        imported_raw_errors: false,
        imported_personal_identifiers: false,
        imported_secrets: false,
      },
      usefulness_score: outcomeStatus === "failed" ? 0.9 : 0.72,
      confidence_score: 0.92,
      freshness_score: 1,
      retrieval_weight: outcomeStatus === "failed" ? 0.9 : 0.72,
      stale_status: "active",
      scoring_version: "projectos-learning-v1",
      scored_at: new Date().toISOString(),
    };

    const { data: insertedCandidate, error: candidateInsertError } = await admin
      .from("memory_capture_candidates")
      .insert(candidate)
      .select("id")
      .maybeSingle();

    if (candidateInsertError && candidateInsertError.code !== "23505") {
      console.error("projectos_candidate_insert_failed", candidateInsertError.message);
      return json(500, { ok: false, error: "candidate_insert_failed" });
    }

    if (insertedCandidate?.id) {
      candidateId = insertedCandidate.id;
      candidateCreated = true;
    } else {
      const { data: racedCandidate, error: racedCandidateError } = await admin
        .from("memory_capture_candidates")
        .select("id")
        .eq("user_id", memoryUserId)
        .eq("namespace", NAMESPACE)
        .eq("source", SOURCE)
        .eq("source_ref", sourceRef)
        .maybeSingle();
      if (racedCandidateError || !racedCandidate?.id) {
        return json(500, { ok: false, error: "candidate_recovery_failed" });
      }
      candidateId = racedCandidate.id;
    }
  }

  let reviewItemId: string | null = null;
  let reviewItemCreated = false;
  const { data: existingReview, error: existingReviewError } = await admin
    .from("memory_review_queue_items")
    .select("id")
    .eq("user_id", memoryUserId)
    .eq("namespace", NAMESPACE)
    .eq("candidate_type", "projectos_outcome")
    .eq("source_ref", sourceRef)
    .maybeSingle();

  if (existingReviewError) {
    return json(500, { ok: false, error: "review_lookup_failed" });
  }
  reviewItemId = existingReview?.id ?? null;

  if (!reviewItemId) {
    const { data: insertedReview, error: reviewInsertError } = await admin
      .from("memory_review_queue_items")
      .insert({
        user_id: memoryUserId,
        namespace: NAMESPACE,
        status: "pending_review",
        candidate_type: "projectos_outcome",
        normalized_text: summary,
        evidence_snapshot: {
          hasEvidence: true,
          sourceRef,
          sourceEventId,
          sourceRequestId,
          contextHash,
          resultFingerprint,
          errorFingerprint,
          completedAt,
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
          sourceNamespace: NAMESPACE,
          targetNamespace: NAMESPACE,
          namespaceMatch: true,
        },
        source_metadata: {
          source: SOURCE,
          sourceRef,
          projectKey,
          tool,
          risk,
          outcomeStatus,
        },
        audit_metadata: {
          schemaVersion: 1,
          requestHash,
          candidateId,
          appendOnly: true,
          reviewRequired: true,
        },
        append_only: true,
        proposed_operation: "append",
        requires_review: true,
        source_ref: sourceRef,
        request_hash: requestHash,
        fingerprint,
        persistence_execution_metadata: {},
      })
      .select("id")
      .maybeSingle();

    if (reviewInsertError && reviewInsertError.code !== "23505") {
      console.error("projectos_review_insert_failed", reviewInsertError.message);
      return json(500, { ok: false, error: "review_insert_failed" });
    }

    if (insertedReview?.id) {
      reviewItemId = insertedReview.id;
      reviewItemCreated = true;
    } else {
      const { data: racedReview, error: racedReviewError } = await admin
        .from("memory_review_queue_items")
        .select("id")
        .eq("user_id", memoryUserId)
        .eq("namespace", NAMESPACE)
        .eq("candidate_type", "projectos_outcome")
        .eq("source_ref", sourceRef)
        .maybeSingle();
      if (racedReviewError || !racedReview?.id) {
        return json(500, { ok: false, error: "review_recovery_failed" });
      }
      reviewItemId = racedReview.id;
    }
  }

  let digestId: string | null = null;
  let digestCreated = false;
  const { data: existingDigest, error: existingDigestError } = await admin
    .from("memory_session_digests")
    .select("id")
    .eq("user_id", memoryUserId)
    .eq("namespace", NAMESPACE)
    .eq("source", SOURCE)
    .eq("source_ref", sourceRef)
    .maybeSingle();

  if (existingDigestError) {
    return json(500, { ok: false, error: "digest_lookup_failed" });
  }
  digestId = existingDigest?.id ?? null;

  if (!digestId) {
    const { data: insertedDigest, error: digestInsertError } = await admin
      .from("memory_session_digests")
      .insert({
        user_id: memoryUserId,
        namespace: NAMESPACE,
        source: SOURCE,
        source_ref: sourceRef,
        title,
        summary,
        durable_updates: [{
          type: "projectos_operation_outcome",
          projectKey,
          tool,
          risk,
          outcomeStatus,
          durationMs,
          completedAt,
          contextStatus,
          reviewRequired: true,
        }],
        decisions: [],
        open_loops: outcomeStatus === "failed"
          ? [{
            type: "investigation_required",
            title: `Investigate failed ProjectOS operation ${tool}`,
            sourceRef,
          }]
          : [],
        risks: outcomeStatus === "failed"
          ? [{
            type: "operation_failure",
            tool,
            sourceRef,
          }]
          : [],
        people: [],
        projects: [projectKey],
        style_updates: [],
        candidate_ids: candidateId ? [candidateId] : [],
        captured_event_ids: [],
        profile_ids: [],
      })
      .select("id")
      .maybeSingle();

    if (digestInsertError && digestInsertError.code !== "23505") {
      console.error("projectos_digest_insert_failed", digestInsertError.message);
      return json(500, { ok: false, error: "digest_insert_failed" });
    }

    if (insertedDigest?.id) {
      digestId = insertedDigest.id;
      digestCreated = true;
    } else {
      const { data: racedDigest, error: racedDigestError } = await admin
        .from("memory_session_digests")
        .select("id")
        .eq("user_id", memoryUserId)
        .eq("namespace", NAMESPACE)
        .eq("source", SOURCE)
        .eq("source_ref", sourceRef)
        .maybeSingle();
      if (racedDigestError || !racedDigest?.id) {
        return json(500, { ok: false, error: "digest_recovery_failed" });
      }
      digestId = racedDigest.id;
    }
  }

  const { data: existingAudit, error: auditLookupError } = await admin
    .from("audit_logs")
    .select("id")
    .eq("user_id", memoryUserId)
    .eq("namespace", NAMESPACE)
    .eq("action", "projectos_post_task_learning_accepted")
    .eq("record_id", candidateId)
    .limit(1)
    .maybeSingle();

  if (!auditLookupError && !existingAudit?.id) {
    const { error: auditInsertError } = await admin.from("audit_logs").insert({
      user_id: memoryUserId,
      namespace: NAMESPACE,
      action: "projectos_post_task_learning_accepted",
      table_name: "memory_capture_candidates",
      record_id: candidateId,
      before_snapshot: null,
      after_snapshot: {
        candidateId,
        reviewItemId,
        digestId,
        sourceRef,
        outcomeStatus,
        reviewRequired: true,
      },
      metadata: {
        integration_key: INTEGRATION_KEY,
        product_key: PRODUCT_KEY,
        project_key: projectKey,
        privacy_policy: "metadata_only_v1",
        append_only: true,
      },
    });
    if (auditInsertError) {
      console.error("projectos_learning_audit_failed", auditInsertError.message);
    }
  }

  const created = candidateCreated || reviewItemCreated || digestCreated;
  return json(created ? 202 : 200, {
    ok: true,
    status: created ? "accepted_for_review" : "idempotent_replay",
    source_ref: sourceRef,
    candidate_id: candidateId,
    review_item_id: reviewItemId,
    digest_id: digestId,
    review_required: true,
    canonical_memory_written: false,
    privacy_policy: "metadata_only_v1",
  });
});