import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import {
  createRemoteJWKSet,
  decodeJwt,
  jwtVerify,
  type JWTPayload,
} from "jose";

import {
  canonicalSnapshotPayload,
  exactAudience,
  GITHUB_OIDC_AUDIENCE,
  GITHUB_OIDC_ISSUER,
  type GithubSourceIdentity,
  type GithubSourcePrincipal,
  unverifiedLookup,
  validateProviderCommit,
  validateVerifiedGithubClaims,
} from "./policy.ts";

const MAX_BODY_BYTES = 512;
const MAX_TOKEN_BYTES = 12_000;
const MAX_GITHUB_RESPONSE_BYTES = 64 * 1024;
const SOURCE = "github_source_snapshot";
const CANDIDATE_TYPE = "github_source_snapshot_v1";
const INTAKE_KIND = "github_source_snapshot_oidc_v1";
const GITHUB_JWKS = createRemoteJWKSet(
  new URL("https://token.actions.githubusercontent.com/.well-known/jwks"),
);

type AdminClient = ReturnType<typeof createClient<any>>;
type JsonRecord = Record<string, unknown>;
type RuntimePrincipal = GithubSourcePrincipal & { memory_user_id: string };

const headers = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
};

const respond = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers });

const byteLength = (value: string) => new TextEncoder().encode(value).byteLength;

const errorCode = (error: unknown): string =>
  typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code ?? "")
    : "";

const sha256 = async (value: string): Promise<string> => {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
};

const bearerToken = (request: Request): string | null => {
  const authorization = request.headers.get("authorization") ?? "";
  const [scheme, token] = authorization.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) return null;
  if (byteLength(token) > MAX_TOKEN_BYTES) return null;
  return token;
};

const readBody = async (request: Request): Promise<JsonRecord | null> => {
  const declared = Number(request.headers.get("content-length") || 0);
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return null;
  const raw = await request.text();
  if (byteLength(raw) > MAX_BODY_BYTES) return null;
  if (!raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as JsonRecord;
  } catch {
    return null;
  }
};

const authenticate = async (
  request: Request,
  admin: AdminClient,
): Promise<{ ok: true; principal: RuntimePrincipal; identity: GithubSourceIdentity } | { ok: false; response: Response }> => {
  const token = bearerToken(request);
  if (!token) {
    return { ok: false, response: respond({ ok: false, error: "unauthorized" }, 401) };
  }

  let unverified: JWTPayload;
  try {
    unverified = decodeJwt(token);
  } catch {
    return { ok: false, response: respond({ ok: false, error: "invalid_identity" }, 401) };
  }
  const lookup = unverifiedLookup(unverified);
  if (
    !lookup ||
    lookup.issuer !== GITHUB_OIDC_ISSUER ||
    lookup.audience !== GITHUB_OIDC_AUDIENCE
  ) {
    return { ok: false, response: respond({ ok: false, error: "identity_not_allowed" }, 403) };
  }

  const { data, error } = await admin
    .from("pandora_github_source_principals")
    .select(
      "principal_key,oidc_issuer,oidc_audience,oidc_subject,repository,repository_id,repository_owner,repository_owner_id,allowed_ref,workflow_ref,memory_namespace,memory_user_id,is_active",
    )
    .eq("oidc_issuer", lookup.issuer)
    .eq("oidc_audience", lookup.audience)
    .eq("oidc_subject", lookup.subject)
    .eq("is_active", true)
    .maybeSingle();
  if (error || !data) {
    return { ok: false, response: respond({ ok: false, error: "principal_unavailable" }, 403) };
  }

  const principal = data as RuntimePrincipal;
  if (!principal.memory_user_id) {
    return { ok: false, response: respond({ ok: false, error: "principal_unavailable" }, 503) };
  }

  let verified: JWTPayload;
  try {
    const result = await jwtVerify(token, GITHUB_JWKS, {
      issuer: principal.oidc_issuer,
      audience: principal.oidc_audience,
      subject: principal.oidc_subject,
      clockTolerance: 30,
    });
    verified = result.payload;
  } catch (error) {
    const code = errorCode(error);
    const unavailable = code.startsWith("ERR_JWKS");
    return {
      ok: false,
      response: respond(
        { ok: false, error: unavailable ? "identity_key_unavailable" : "identity_verification_failed" },
        unavailable ? 502 : 401,
      ),
    };
  }

  const identity = validateVerifiedGithubClaims(verified, principal);
  if (!identity) {
    return { ok: false, response: respond({ ok: false, error: "identity_not_allowed" }, 403) };
  }
  return { ok: true, principal, identity };
};

const readBoundedText = async (response: Response): Promise<string | null> => {
  const declared = Number(response.headers.get("content-length") || 0);
  if (Number.isFinite(declared) && declared > MAX_GITHUB_RESPONSE_BYTES) return null;
  const text = await response.text();
  return byteLength(text) <= MAX_GITHUB_RESPONSE_BYTES ? text : null;
};

const fetchProviderCommit = async (identity: GithubSourceIdentity) => {
  const [owner, repo] = identity.repository.split("/");
  if (!owner || !repo) return null;
  const url =
    `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/commits/${identity.sourceSha}`;
  const response = await fetch(url, {
    method: "GET",
    redirect: "error",
    cache: "no-store",
    headers: {
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "user-agent": "Pandora-Memory-GitHub-Source-Sync/1.0",
    },
  }).catch(() => null);
  if (!response || !response.ok) return null;
  const text = await readBoundedText(response);
  if (!text) return null;
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return null;
  }
  return validateProviderCommit(identity.sourceSha, body);
};

const createOrReadSnapshot = async (
  admin: AdminClient,
  principal: RuntimePrincipal,
  identity: GithubSourceIdentity,
  providerCommit: NonNullable<Awaited<ReturnType<typeof fetchProviderCommit>>>,
  snapshotSha256: string,
): Promise<{ ok: true; id: string; created: boolean } | { ok: false; response: Response }> => {
  const { data: existing, error: existingError } = await admin
    .from("pandora_github_source_snapshots")
    .select("id,snapshot_sha256")
    .eq("repository_id", identity.repositoryId)
    .eq("source_sha", providerCommit.sourceSha)
    .maybeSingle();
  if (existingError) {
    return { ok: false, response: respond({ ok: false, error: "snapshot_lookup_failed" }, 500) };
  }
  if (existing?.id) {
    if (existing.snapshot_sha256 !== snapshotSha256) {
      return { ok: false, response: respond({ ok: false, error: "snapshot_conflict" }, 409) };
    }
    return { ok: true, id: existing.id, created: false };
  }

  const providerCheckedAt = new Date().toISOString();
  const { data: inserted, error: insertError } = await admin
    .from("pandora_github_source_snapshots")
    .insert({
      principal_key: principal.principal_key,
      repository: identity.repository,
      repository_id: identity.repositoryId,
      ref: identity.ref,
      workflow_ref: identity.workflowRef,
      source_sha: providerCommit.sourceSha,
      source_tree_sha: providerCommit.sourceTreeSha,
      parent_shas: providerCommit.parentShas,
      snapshot_sha256: snapshotSha256,
      first_workflow_run_id: identity.workflowRunId,
      first_workflow_run_attempt: identity.workflowRunAttempt,
      first_event_name: identity.eventName,
      provider_checked_at: providerCheckedAt,
    })
    .select("id")
    .maybeSingle();
  if (!insertError && inserted?.id) {
    return { ok: true, id: inserted.id, created: true };
  }
  if (errorCode(insertError) !== "23505") {
    return { ok: false, response: respond({ ok: false, error: "snapshot_insert_failed" }, 500) };
  }

  const { data: raced, error: racedError } = await admin
    .from("pandora_github_source_snapshots")
    .select("id,snapshot_sha256")
    .eq("repository_id", identity.repositoryId)
    .eq("source_sha", providerCommit.sourceSha)
    .maybeSingle();
  if (racedError || !raced?.id || raced.snapshot_sha256 !== snapshotSha256) {
    return { ok: false, response: respond({ ok: false, error: "snapshot_recovery_failed" }, 409) };
  }
  return { ok: true, id: raced.id, created: false };
};

const ensureMemoryCandidate = async (
  admin: AdminClient,
  principal: RuntimePrincipal,
  identity: GithubSourceIdentity,
  snapshotId: string,
  snapshotSha256: string,
  providerCommit: NonNullable<Awaited<ReturnType<typeof fetchProviderCommit>>>,
): Promise<{ ok: true; candidateId: string; created: boolean; sourceRef: string; summary: string } | { ok: false; response: Response }> => {
  const sourceRef = `github-source:${identity.repositoryId}:${providerCommit.sourceSha}`;
  const summary =
    `Verified GitHub main source snapshot ${identity.repository}@${providerCommit.sourceSha.slice(0, 12)}.`;
  const { data: existing, error: existingError } = await admin
    .from("memory_capture_candidates")
    .select("id,metadata")
    .eq("user_id", principal.memory_user_id)
    .eq("namespace", identity.namespace)
    .eq("source", SOURCE)
    .eq("source_ref", sourceRef)
    .maybeSingle();
  if (existingError) {
    return { ok: false, response: respond({ ok: false, error: "candidate_lookup_failed" }, 500) };
  }
  if (existing?.id) {
    const metadata = existing.metadata as JsonRecord | null;
    if (
      !metadata ||
      metadata.snapshot_sha256 !== snapshotSha256 ||
      metadata.source_sha !== providerCommit.sourceSha
    ) {
      return { ok: false, response: respond({ ok: false, error: "candidate_conflict" }, 409) };
    }
    return { ok: true, candidateId: existing.id, created: false, sourceRef, summary };
  }

  const now = new Date().toISOString();
  const { data: inserted, error: insertError } = await admin
    .from("memory_capture_candidates")
    .insert({
      user_id: principal.memory_user_id,
      namespace: identity.namespace,
      source: SOURCE,
      source_ref: sourceRef,
      raw_excerpt: null,
      redacted_excerpt: summary,
      memory_type: "business_fact",
      title: `GitHub source snapshot: ${identity.repository}`,
      summary,
      importance: 8,
      sensitivity: "low",
      confidence: 0.99,
      should_capture: true,
      requires_review: true,
      status: "pending",
      reason:
        "GitHub source intake is review-gated. This source snapshot cannot become canonical Memory without an authenticated human decision.",
      people: [],
      projects: [identity.repository],
      risks: [],
      tags: ["github", "source_snapshot", "review_gated", "implemented"],
      metadata: {
        schema_version: 1,
        intake_kind: INTAKE_KIND,
        principal_key: principal.principal_key,
        repository: identity.repository,
        repository_id: identity.repositoryId,
        ref: identity.ref,
        workflow_ref: identity.workflowRef,
        source_sha: providerCommit.sourceSha,
        source_tree_sha: providerCommit.sourceTreeSha,
        parent_shas: providerCommit.parentShas,
        snapshot_id: snapshotId,
        snapshot_sha256: snapshotSha256,
        proof_stage: "implemented",
        provider_verified: true,
        provider_verification_scope: "public_git_commit_identity",
        imported_commit_message: false,
        imported_raw_arguments: false,
        imported_raw_results: false,
        imported_raw_errors: false,
      },
      usefulness_score: 0.9,
      confidence_score: 0.99,
      freshness_score: 1,
      retrieval_weight: 0.9,
      stale_status: "active",
      scoring_version: "github-source-snapshot-v1",
      scored_at: now,
    })
    .select("id")
    .maybeSingle();
  if (!insertError && inserted?.id) {
    return { ok: true, candidateId: inserted.id, created: true, sourceRef, summary };
  }
  if (errorCode(insertError) !== "23505") {
    return { ok: false, response: respond({ ok: false, error: "candidate_insert_failed" }, 500) };
  }

  const { data: raced, error: racedError } = await admin
    .from("memory_capture_candidates")
    .select("id,metadata")
    .eq("user_id", principal.memory_user_id)
    .eq("namespace", identity.namespace)
    .eq("source", SOURCE)
    .eq("source_ref", sourceRef)
    .maybeSingle();
  const metadata = raced?.metadata as JsonRecord | null;
  if (
    racedError ||
    !raced?.id ||
    !metadata ||
    metadata.snapshot_sha256 !== snapshotSha256
  ) {
    return { ok: false, response: respond({ ok: false, error: "candidate_recovery_failed" }, 409) };
  }
  return { ok: true, candidateId: raced.id, created: false, sourceRef, summary };
};

const ensureReviewItem = async (
  admin: AdminClient,
  principal: RuntimePrincipal,
  identity: GithubSourceIdentity,
  candidateId: string,
  sourceRef: string,
  summary: string,
  snapshotId: string,
  snapshotSha256: string,
  providerCommit: NonNullable<Awaited<ReturnType<typeof fetchProviderCommit>>>,
): Promise<{ ok: true; reviewId: string; created: boolean } | { ok: false; response: Response }> => {
  const { data: existing, error: existingError } = await admin
    .from("memory_review_queue_items")
    .select("id,evidence_snapshot")
    .eq("user_id", principal.memory_user_id)
    .eq("namespace", identity.namespace)
    .eq("candidate_type", CANDIDATE_TYPE)
    .eq("source_ref", sourceRef)
    .maybeSingle();
  if (existingError) {
    return { ok: false, response: respond({ ok: false, error: "review_lookup_failed" }, 500) };
  }
  if (existing?.id) {
    const evidence = existing.evidence_snapshot as JsonRecord | null;
    if (
      !evidence ||
      evidence.candidateId !== candidateId ||
      evidence.snapshotSha256 !== snapshotSha256
    ) {
      return { ok: false, response: respond({ ok: false, error: "review_conflict" }, 409) };
    }
    return { ok: true, reviewId: existing.id, created: false };
  }

  const { data: inserted, error: insertError } = await admin
    .from("memory_review_queue_items")
    .insert({
      user_id: principal.memory_user_id,
      namespace: identity.namespace,
      status: "pending_review",
      candidate_type: CANDIDATE_TYPE,
      normalized_text: summary,
      evidence_snapshot: {
        hasEvidence: true,
        intakeKind: INTAKE_KIND,
        sourceRef,
        candidateId,
        snapshotId,
        snapshotSha256,
        repository: identity.repository,
        sourceSha: providerCommit.sourceSha,
        sourceTreeSha: providerCommit.sourceTreeSha,
        parentShas: providerCommit.parentShas,
        proofStage: "implemented",
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
        sourceNamespace: identity.namespace,
        targetNamespace: identity.namespace,
        namespaceMatch: true,
      },
      source_metadata: {
        source: SOURCE,
        sourceKind: "github_source_snapshot",
        sourceRef,
        repository: identity.repository,
        sourceSha: providerCommit.sourceSha,
        principalKey: principal.principal_key,
      },
      audit_metadata: {
        schemaVersion: 1,
        candidateId,
        snapshotId,
        snapshotSha256,
        appendOnly: true,
        reviewRequired: true,
      },
      append_only: true,
      proposed_operation: "append",
      requires_review: true,
      source_ref: sourceRef,
      request_hash: snapshotSha256,
      fingerprint: snapshotSha256,
      persistence_execution_metadata: {},
    })
    .select("id")
    .maybeSingle();
  if (!insertError && inserted?.id) {
    return { ok: true, reviewId: inserted.id, created: true };
  }
  if (errorCode(insertError) !== "23505") {
    return { ok: false, response: respond({ ok: false, error: "review_insert_failed" }, 500) };
  }

  const { data: raced, error: racedError } = await admin
    .from("memory_review_queue_items")
    .select("id,evidence_snapshot")
    .eq("user_id", principal.memory_user_id)
    .eq("namespace", identity.namespace)
    .eq("candidate_type", CANDIDATE_TYPE)
    .eq("source_ref", sourceRef)
    .maybeSingle();
  const evidence = raced?.evidence_snapshot as JsonRecord | null;
  if (
    racedError ||
    !raced?.id ||
    !evidence ||
    evidence.candidateId !== candidateId ||
    evidence.snapshotSha256 !== snapshotSha256
  ) {
    return { ok: false, response: respond({ ok: false, error: "review_recovery_failed" }, 409) };
  }
  return { ok: true, reviewId: raced.id, created: false };
};

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") {
    return respond({ ok: false, error: "method_not_allowed" }, 405);
  }

  const body = await readBody(request);
  if (!body || Object.keys(body).length !== 0) {
    return respond({ ok: false, error: "invalid_payload" }, 400);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    return respond({ ok: false, error: "runtime_unavailable" }, 503);
  }
  const admin: AdminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const authorization = await authenticate(request, admin);
  if (!authorization.ok) return authorization.response;

  const providerCommit = await fetchProviderCommit(authorization.identity);
  if (!providerCommit) {
    return respond({ ok: false, error: "github_commit_unavailable" }, 502);
  }
  const canonical = canonicalSnapshotPayload(authorization.identity, providerCommit);
  const snapshotSha256 = await sha256(JSON.stringify(canonical));

  const snapshot = await createOrReadSnapshot(
    admin,
    authorization.principal,
    authorization.identity,
    providerCommit,
    snapshotSha256,
  );
  if (!snapshot.ok) return snapshot.response;

  const candidate = await ensureMemoryCandidate(
    admin,
    authorization.principal,
    authorization.identity,
    snapshot.id,
    snapshotSha256,
    providerCommit,
  );
  if (!candidate.ok) return candidate.response;

  const review = await ensureReviewItem(
    admin,
    authorization.principal,
    authorization.identity,
    candidate.candidateId,
    candidate.sourceRef,
    candidate.summary,
    snapshot.id,
    snapshotSha256,
    providerCommit,
  );
  if (!review.ok) return review.response;

  const created = snapshot.created || candidate.created || review.created;
  return respond({
    ok: true,
    status: "pending_review",
    repository: authorization.identity.repository,
    source_sha: providerCommit.sourceSha,
    source_tree_sha: providerCommit.sourceTreeSha,
    parent_shas: providerCommit.parentShas,
    snapshot_id: snapshot.id,
    snapshot_sha256: snapshotSha256,
    candidate_id: candidate.candidateId,
    review_item_id: review.reviewId,
    canonical_memory_written: false,
    deduplicated: !created,
  }, created ? 202 : 200);
});
