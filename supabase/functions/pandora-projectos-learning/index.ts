import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.110.9";

const INTEGRATION_KEY = "projectos-learning-bridge";
const PRODUCT_KEY = "projectos";
const NAMESPACE = "real_life";
const SOURCE = "projectos-post-task";
// Single canonical privacy-policy identifier. Stored metadata, the audit row,
// and the API response must all report the same value.
const PRIVACY_POLICY = "metadata_only_v1";
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

const LEARNING_FINGERPRINT_VERSION = "projectos-learning-v2";

/**
 * Everything downstream review state is rebuilt from.
 *
 * The defect this type exists to close: the review item and session digest used
 * to be constructed from the *incoming* request even when the candidate already
 * existed from an earlier call. A retry carrying different content would then
 * persist candidate A alongside review metadata describing request B — a review
 * item that does not describe the thing under review.
 *
 * Recovery must therefore be driven by what is actually stored, never by the
 * retry that triggered it.
 */
type LearningSnapshot = {
  sourceRef: string;
  title: string;
  summary: string;
  fingerprint: string;
  requestHash: string;
  sourceEventId: string;
  sourceRequestId: string;
  contextHash: string;
  resultFingerprint: string | null;
  errorFingerprint: string | null;
  completedAt: string;
  projectKey: string;
  tool: string;
  risk: string;
  outcomeStatus: string;
  durationMs: number;
  contextStatus: string;
};

/**
 * Rebuild a snapshot from the persisted candidate row.
 *
 * Returns null if the stored row cannot be read faithfully. Callers must fail
 * closed on null: guessing at missing fields would reintroduce exactly the
 * "review metadata describing a different request" defect, only harder to see.
 */
const storedLearningSnapshot = (
  row: JsonRecord,
  sourceRef: string,
): LearningSnapshot | null => {
  const metadata = record(row.metadata);
  const title = requiredText(row.title, 240);
  const summary = requiredText(row.summary, 1800);
  const fingerprint = hash(metadata.fingerprint);
  const requestHash = hash(metadata.request_hash);
  const sourceEventId = uuid(metadata.source_event_id);
  const sourceRequestId = uuid(metadata.source_request_id);
  const contextHash = hash(metadata.context_hash);
  const completedAt = isoTimestamp(metadata.completed_at);
  const projectKey = safeToken(metadata.project_key, 160);
  const tool = safeToken(metadata.tool, 180);
  const risk = requiredText(metadata.risk, 32);
  const outcomeStatus = requiredText(metadata.outcome_status, 32);
  const durationMs = integer(metadata.duration_ms, 0, 86_400_000);
  const contextStatus = requiredText(metadata.context_status, 32);

  if (
    !title || !summary || !fingerprint || !requestHash || !sourceEventId ||
    !sourceRequestId || !contextHash || !completedAt || !projectKey || !tool ||
    !risk || !RISKS.has(risk) || !outcomeStatus ||
    !OUTCOME_STATUSES.has(outcomeStatus) || durationMs === null ||
    !contextStatus || !CONTEXT_STATUSES.has(contextStatus)
  ) {
    return null;
  }

  return {
    sourceRef,
    title,
    summary,
    fingerprint,
    requestHash,
    sourceEventId,
    sourceRequestId,
    contextHash,
    // Optional fingerprints: absent is a legitimate stored value, so these are
    // read without forcing failure.
    resultFingerprint: hash(metadata.result_fingerprint),
    errorFingerprint: hash(metadata.error_fingerprint),
    completedAt,
    projectKey,
    tool,
    risk,
    outcomeStatus,
    durationMs,
    contextStatus,
  };
};

/**
 * Persist an audit row and report whether durable evidence actually exists.
 *
 * The previous implementation discarded the returned Supabase error, so an
 * audit write that failed was indistinguishable from one that succeeded. This
 * returns the outcome instead of deciding policy — the caller decides whether
 * the operation may proceed without durable audit evidence.
 */
const writeAudit = async (
  admin: {
    from: (table: string) => {
      insert: (row: JsonRecord) => Promise<{ error: unknown }>;
    };
  },
  row: JsonRecord,
): Promise<boolean> => {
  const { error } = await admin.from("audit_logs").insert(row);
  if (error) {
    // Log the failure classification only. The audit row body can contain
    // operational metadata, and echoing it into logs on failure would widen the
    // very surface the metadata-only privacy policy exists to keep narrow.
    console.error("projectos_learning_audit_failed");
    return false;
  }
  return true;
};

/**
 * Reconcile candidate, review item, session digest, and audit row for one
 * learning event.
 *
 * Ordering is deliberate and load-bearing:
 *
 *   1. Adopt or create the candidate, and read back what is actually stored.
 *   2. Reconcile the review item and digest *from the stored snapshot*, so a
 *      candidate orphaned by an earlier partial failure becomes visible to human
 *      review even when this retry carries different content.
 *   3. Only then decide the changed-content conflict. Deciding it earlier would
 *      leave an orphaned candidate permanently invisible to review.
 */
const persistLearningEvent = async (
  admin: any,
  memoryUserId: string,
  incoming: LearningSnapshot,
): Promise<Response> => {
  const sourceRef = incoming.sourceRef;

  const candidateMetadata = (snapshot: LearningSnapshot): JsonRecord => ({
    schema_version: 1,
    source_event_id: snapshot.sourceEventId,
    source_request_id: snapshot.sourceRequestId,
    project_key: snapshot.projectKey,
    tool: snapshot.tool,
    risk: snapshot.risk,
    outcome_status: snapshot.outcomeStatus,
    duration_ms: snapshot.durationMs,
    completed_at: snapshot.completedAt,
    context_status: snapshot.contextStatus,
    context_hash: snapshot.contextHash,
    result_fingerprint: snapshot.resultFingerprint,
    error_fingerprint: snapshot.errorFingerprint,
    fingerprint: snapshot.fingerprint,
    request_hash: snapshot.requestHash,
    privacy_policy: PRIVACY_POLICY,
    imported_raw_arguments: false,
    imported_raw_results: false,
    imported_raw_errors: false,
    imported_personal_identifiers: false,
    imported_secrets: false,
  });

  const readCandidate = async () =>
    await admin
      .from("memory_capture_candidates")
      .select("id,title,summary,metadata")
      .eq("user_id", memoryUserId)
      .eq("namespace", NAMESPACE)
      .eq("source", SOURCE)
      .eq("source_ref", sourceRef)
      .maybeSingle();

  let candidateId: string | null = null;
  let candidateCreated = false;
  // The snapshot that is actually persisted — the stored row on a replay, never
  // the incoming submission.
  let persisted: LearningSnapshot | null = null;

  const existing = await readCandidate();
  if (existing.error) {
    console.error("projectos_candidate_lookup_failed");
    return json(500, { ok: false, error: "candidate_lookup_failed" });
  }

  if (existing.data?.id) {
    persisted = storedLearningSnapshot(existing.data, sourceRef);
    if (!persisted) {
      console.error("projectos_candidate_unreadable");
      return json(500, { ok: false, error: "candidate_reconcile_failed" });
    }
    candidateId = existing.data.id;
  }

  if (!candidateId) {
    const inserted = await admin
      .from("memory_capture_candidates")
      .insert({
        user_id: memoryUserId,
        namespace: NAMESPACE,
        source: SOURCE,
        source_ref: sourceRef,
        raw_excerpt: null,
        redacted_excerpt: incoming.summary,
        memory_type: incoming.outcomeStatus === "failed"
          ? "risk_signal"
          : "business_fact",
        title: incoming.title,
        summary: incoming.summary,
        importance: incoming.outcomeStatus === "failed" ? 8 : 6,
        sensitivity: "low",
        confidence: 0.92,
        should_capture: true,
        requires_review: true,
        status: "pending",
        reason:
          "Post-task operational learning is review-gated. This candidate cannot become canonical without an authenticated human decision.",
        people: [],
        projects: [incoming.projectKey],
        risks: incoming.outcomeStatus === "failed"
          ? ["A ProjectOS operation failed; investigate using authoritative provider evidence."]
          : [],
        tags: [
          "projectos",
          "post_task_learning",
          incoming.outcomeStatus,
          incoming.risk,
        ],
        metadata: candidateMetadata(incoming),
        usefulness_score: incoming.outcomeStatus === "failed" ? 0.9 : 0.72,
        confidence_score: 0.92,
        freshness_score: 1,
        retrieval_weight: incoming.outcomeStatus === "failed" ? 0.9 : 0.72,
        stale_status: "active",
        scoring_version: "projectos-learning-v1",
        scored_at: new Date().toISOString(),
      })
      .select("id")
      .maybeSingle();

    if (inserted.error && inserted.error.code !== "23505") {
      console.error("projectos_candidate_insert_failed");
      return json(500, { ok: false, error: "candidate_insert_failed" });
    }

    if (inserted.data?.id) {
      candidateId = inserted.data.id;
      candidateCreated = true;
      persisted = incoming;
    } else {
      // Lost the unique race. Adopt the winner's stored row rather than this
      // request's content, then reconcile from it exactly as on a replay.
      const raced = await readCandidate();
      if (raced.error || !raced.data?.id) {
        return json(500, { ok: false, error: "candidate_recovery_failed" });
      }
      persisted = storedLearningSnapshot(raced.data, sourceRef);
      if (!persisted) {
        console.error("projectos_candidate_unreadable");
        return json(500, { ok: false, error: "candidate_reconcile_failed" });
      }
      candidateId = raced.data.id;
    }
  }

  if (!candidateId || !persisted) {
    return json(500, { ok: false, error: "candidate_recovery_failed" });
  }

  // ---- Review queue, reconciled from persisted truth -----------------------
  const existingReview = await admin
    .from("memory_review_queue_items")
    .select("id")
    .eq("user_id", memoryUserId)
    .eq("namespace", NAMESPACE)
    .eq("candidate_type", "projectos_outcome")
    .eq("source_ref", sourceRef)
    .maybeSingle();

  if (existingReview.error) {
    return json(500, { ok: false, error: "review_lookup_failed" });
  }

  let reviewItemId: string | null = existingReview.data?.id ?? null;
  let reviewItemCreated = false;

  if (!reviewItemId) {
    const insertedReview = await admin
      .from("memory_review_queue_items")
      .insert({
        user_id: memoryUserId,
        namespace: NAMESPACE,
        status: "pending_review",
        candidate_type: "projectos_outcome",
        normalized_text: persisted.summary,
        evidence_snapshot: {
          hasEvidence: true,
          sourceRef,
          sourceEventId: persisted.sourceEventId,
          sourceRequestId: persisted.sourceRequestId,
          contextHash: persisted.contextHash,
          resultFingerprint: persisted.resultFingerprint,
          errorFingerprint: persisted.errorFingerprint,
          completedAt: persisted.completedAt,
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
          projectKey: persisted.projectKey,
          tool: persisted.tool,
          risk: persisted.risk,
          outcomeStatus: persisted.outcomeStatus,
        },
        audit_metadata: {
          schemaVersion: 1,
          requestHash: persisted.requestHash,
          candidateId,
          appendOnly: true,
          reviewRequired: true,
        },
        append_only: true,
        proposed_operation: "append",
        requires_review: true,
        source_ref: sourceRef,
        request_hash: persisted.requestHash,
        fingerprint: persisted.fingerprint,
        persistence_execution_metadata: {},
      })
      .select("id")
      .maybeSingle();

    if (insertedReview.error && insertedReview.error.code !== "23505") {
      console.error("projectos_review_insert_failed");
      return json(500, { ok: false, error: "review_insert_failed" });
    }

    if (insertedReview.data?.id) {
      reviewItemId = insertedReview.data.id;
      reviewItemCreated = true;
    } else {
      const racedReview = await admin
        .from("memory_review_queue_items")
        .select("id")
        .eq("user_id", memoryUserId)
        .eq("namespace", NAMESPACE)
        .eq("candidate_type", "projectos_outcome")
        .eq("source_ref", sourceRef)
        .maybeSingle();
      if (racedReview.error || !racedReview.data?.id) {
        return json(500, { ok: false, error: "review_recovery_failed" });
      }
      reviewItemId = racedReview.data.id;
    }
  }

  // ---- Session digest, reconciled from persisted truth ---------------------
  const existingDigest = await admin
    .from("memory_session_digests")
    .select("id")
    .eq("user_id", memoryUserId)
    .eq("namespace", NAMESPACE)
    .eq("source", SOURCE)
    .eq("source_ref", sourceRef)
    .maybeSingle();

  if (existingDigest.error) {
    return json(500, { ok: false, error: "digest_lookup_failed" });
  }

  let digestId: string | null = existingDigest.data?.id ?? null;
  let digestCreated = false;

  if (!digestId) {
    const insertedDigest = await admin
      .from("memory_session_digests")
      .insert({
        user_id: memoryUserId,
        namespace: NAMESPACE,
        source: SOURCE,
        source_ref: sourceRef,
        title: persisted.title,
        summary: persisted.summary,
        durable_updates: [{
          type: "projectos_operation_outcome",
          projectKey: persisted.projectKey,
          tool: persisted.tool,
          risk: persisted.risk,
          outcomeStatus: persisted.outcomeStatus,
          durationMs: persisted.durationMs,
          completedAt: persisted.completedAt,
          contextStatus: persisted.contextStatus,
          reviewRequired: true,
        }],
        decisions: [],
        open_loops: persisted.outcomeStatus === "failed"
          ? [{
            type: "investigation_required",
            title: `Investigate failed ProjectOS operation ${persisted.tool}`,
            sourceRef,
          }]
          : [],
        risks: persisted.outcomeStatus === "failed"
          ? [{ type: "operation_failure", tool: persisted.tool, sourceRef }]
          : [],
        people: [],
        projects: [persisted.projectKey],
        style_updates: [],
        candidate_ids: [candidateId],
        captured_event_ids: [],
        profile_ids: [],
      })
      .select("id")
      .maybeSingle();

    if (insertedDigest.error && insertedDigest.error.code !== "23505") {
      console.error("projectos_digest_insert_failed");
      return json(500, { ok: false, error: "digest_insert_failed" });
    }

    if (insertedDigest.data?.id) {
      digestId = insertedDigest.data.id;
      digestCreated = true;
    } else {
      const racedDigest = await admin
        .from("memory_session_digests")
        .select("id")
        .eq("user_id", memoryUserId)
        .eq("namespace", NAMESPACE)
        .eq("source", SOURCE)
        .eq("source_ref", sourceRef)
        .maybeSingle();
      if (racedDigest.error || !racedDigest.data?.id) {
        return json(500, { ok: false, error: "digest_recovery_failed" });
      }
      digestId = racedDigest.data.id;
    }
  }

  // ---- Audit: required, fail closed, and reconciled BEFORE the conflict ----
  //
  // This operation is in the audit-required class. Failing here is safe because
  // every write above is idempotent: the caller retries and heals rather than
  // duplicating. Returning success without durable audit evidence would be a
  // lie about the security contract, so it is not an option.
  //
  // Ordering matters, and an earlier revision got it wrong. The audit row is
  // evidence about the PERSISTED candidate, not about the request that happens
  // to be in flight — exactly like the review item and the digest. If the
  // conflict were decided first, this sequence would leave persisted state with
  // no audit evidence, permanently:
  //
  //   1. first request persists candidate/review/digest, then its audit write
  //      fails, so it returns 500;
  //   2. the caller retries with changed content;
  //   3. the retry reconciles review and digest, then returns 409 — never
  //      reaching the audit write;
  //   4. every subsequent changed retry does the same.
  //
  // So the audit is healed on every submission, including one that is about to
  // be rejected. The conflict decision comes after.
  const existingAudit = await admin
    .from("audit_logs")
    .select("id")
    .eq("user_id", memoryUserId)
    .eq("namespace", NAMESPACE)
    .eq("action", "projectos_post_task_learning_accepted")
    .eq("record_id", candidateId)
    .limit(1)
    .maybeSingle();

  if (existingAudit.error) {
    console.error("projectos_learning_audit_lookup_failed");
    return json(500, { ok: false, error: "audit_lookup_failed" });
  }

  if (!existingAudit.data?.id) {
    const durable = await writeAudit(admin, {
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
        outcomeStatus: persisted.outcomeStatus,
        reviewRequired: true,
      },
      metadata: {
        integration_key: INTEGRATION_KEY,
        product_key: PRODUCT_KEY,
        project_key: persisted.projectKey,
        privacy_policy: PRIVACY_POLICY,
        append_only: true,
      },
    });

    if (!durable) {
      return json(500, { ok: false, error: "audit_persistence_failed" });
    }
  }

  // ---- Changed-content conflict, decided last ------------------------------
  // The persisted candidate is now queued for review, has a digest, and has
  // durable audit evidence, so rejecting this differing submission can neither
  // orphan it nor strand it without an audit trail.
  if (persisted.fingerprint !== incoming.fingerprint) {
    return json(409, {
      ok: false,
      error: "idempotency_conflict",
      source_ref: sourceRef,
      review_required: true,
      canonical_memory_written: false,
    });
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
    privacy_policy: PRIVACY_POLICY,
  });
};

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
    payload.privacy_policy !== PRIVACY_POLICY
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
  const incoming: LearningSnapshot = {
    sourceRef,
    title: `ProjectOS ${outcomeStatus}: ${tool}`.slice(0, 240),
    summary: [
      `ProjectOS ${outcomeStatus} the ${risk} operation ${tool}`,
      `for ${projectKey}`,
      `after ${contextStatus} Pandora Memory hydration`,
      `in ${durationMs} ms at ${completedAt}.`,
      "Only privacy-safe operational metadata and cryptographic fingerprints were retained.",
    ].join(" ").slice(0, 1800),
    // Deterministic over canonical validated content, not raw request bytes:
    // two byte-different encodings of the same event must not look like a
    // changed-content conflict, and reordered JSON keys must not either.
    fingerprint: await sha256(`${LEARNING_FINGERPRINT_VERSION}\n${basis}`),
    requestHash: await sha256(rawBody),
    sourceEventId,
    sourceRequestId,
    contextHash,
    resultFingerprint,
    errorFingerprint,
    completedAt,
    projectKey,
    tool,
    risk,
    outcomeStatus,
    durationMs,
    contextStatus,
  };

  return await persistLearningEvent(admin, memoryUserId, incoming);
});
