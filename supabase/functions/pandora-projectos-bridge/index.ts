import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "npm:jose@5.10.0";

const PRINCIPAL_KEY = "projectos-mcpmaster-production";
const MAX_BODY_BYTES = 64 * 1024;
const MAX_QUERY_LENGTH = 4_000;
const MAX_ITEMS = 50;
const MAX_SEARCH_TERMS = 12;
const MIN_TERM_LENGTH = 3;
const MAX_TERM_LENGTH = 64;
const DEFAULT_CANON_STATUSES = ["hard_canon", "soft_canon"];
const RETRIEVABLE_CANON_STATUSES = new Set(["hard_canon", "soft_canon", "draft"]);
const APPROVED_CANON_STATUSES = new Set(["hard_canon", "soft_canon"]);
const STOP_TERMS = new Set([
  "and", "are", "for", "from", "has", "have", "its", "not", "our", "that",
  "the", "their", "them", "there", "these", "this", "was", "were", "what",
  "when", "which", "with", "you", "your",
]);
const GLOBAL_JWKS = createRemoteJWKSet(
  new URL("https://oidc.vercel.com/.well-known/jwks"),
);
const issuerJwks = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

type JsonRecord = Record<string, unknown>;
type AdminClient = ReturnType<typeof createClient<any>>;
type Principal = {
  issuer: string;
  audience: string;
  subject: string;
  owner_id: string;
  project_id: string;
  project_name: string;
  environment: string;
  memory_user_id: string;
  allowed_namespaces: string[];
  scopes: string[];
  is_active: boolean;
};
type AuthorizationResult =
  | { ok: true; principal: Principal }
  | { ok: false; error: Response };

const headers = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
};

const respond = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers });

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

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

const workloadToken = (request: Request): string | null => {
  const internal = request.headers.get("x-pandora-vercel-oidc")?.trim();
  if (internal) return internal;
  const authorization = request.headers.get("authorization") ?? "";
  const [scheme, token] = authorization.split(" ");
  return scheme?.toLowerCase() === "bearer" && token ? token : null;
};

const exactAudience = (payload: JWTPayload): string | undefined =>
  Array.isArray(payload.aud) ? payload.aud[0] : payload.aud;

const jwksForIssuer = (issuer: string) => {
  const url = new URL(issuer);
  if (
    url.protocol !== "https:" ||
    url.hostname !== "oidc.vercel.com" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !/^\/[A-Za-z0-9_-]+$/.test(url.pathname)
  ) {
    throw new Error("principal_issuer_invalid");
  }
  const normalized = url.toString().replace(/\/$/, "");
  let jwks = issuerJwks.get(normalized);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`${normalized}/.well-known/jwks`));
    issuerJwks.set(normalized, jwks);
  }
  return jwks;
};

const mayRetryGlobal = (error: unknown): boolean => {
  const code = errorCode(error);
  return code === "ERR_JWS_SIGNATURE_VERIFICATION_FAILED" ||
    code === "ERR_JWKS_NO_MATCHING_KEY" ||
    code.startsWith("ERR_JWKS");
};

const verificationFailure = (error: unknown): Response => {
  const code = errorCode(error);
  if (code.startsWith("ERR_JWKS")) {
    return respond({ ok: false, error: "identity_key_unavailable" }, 502);
  }
  if (code === "ERR_JWT_CLAIM_VALIDATION_FAILED") {
    return respond({ ok: false, error: "identity_claim_invalid" }, 403);
  }
  if (code === "ERR_JWT_EXPIRED") {
    return respond({ ok: false, error: "identity_expired" }, 401);
  }
  if (code === "ERR_JWS_SIGNATURE_VERIFICATION_FAILED") {
    return respond({ ok: false, error: "identity_signature_invalid" }, 498);
  }
  if (code === "ERR_JOSE_NOT_SUPPORTED") {
    return respond({ ok: false, error: "identity_algorithm_unsupported" }, 501);
  }
  return respond({ ok: false, error: "invalid_identity" }, 499);
};

const verifyVercelToken = async (token: string, principal: Principal) => {
  const options = {
    issuer: principal.issuer,
    audience: principal.audience,
    subject: principal.subject,
    clockTolerance: 30,
  };
  try {
    return await jwtVerify(token, jwksForIssuer(principal.issuer), options);
  } catch (error) {
    if (!mayRetryGlobal(error)) throw error;
    return await jwtVerify(token, GLOBAL_JWKS, options);
  }
};

const authorize = async (
  request: Request,
  supabase: AdminClient,
): Promise<AuthorizationResult> => {
  const token = workloadToken(request);
  if (!token) {
    return { ok: false, error: respond({ ok: false, error: "unauthorized" }, 401) };
  }

  const { data, error } = await supabase
    .from("pandora_service_principals")
    .select(
      "issuer,audience,subject,owner_id,project_id,project_name,environment,memory_user_id,allowed_namespaces,scopes,is_active",
    )
    .eq("principal_key", PRINCIPAL_KEY)
    .eq("is_active", true)
    .maybeSingle();

  if (error || !data) {
    return {
      ok: false,
      error: respond({ ok: false, error: "principal_unavailable" }, 503),
    };
  }
  const principal = data as Principal;

  try {
    const { payload } = await verifyVercelToken(token, principal);
    const matches =
      payload.owner_id === principal.owner_id &&
      payload.project_id === principal.project_id &&
      payload.project === principal.project_name &&
      payload.environment === principal.environment &&
      payload.iss === principal.issuer &&
      exactAudience(payload) === principal.audience &&
      payload.sub === principal.subject;
    if (!matches) {
      return {
        ok: false,
        error: respond({ ok: false, error: "identity_not_allowed" }, 403),
      };
    }
  } catch (error) {
    return { ok: false, error: verificationFailure(error) };
  }
  return { ok: true, principal };
};

const safeSearchTerm = (query: string): string =>
  query
    .slice(0, 240)
    .replace(/[\\%_,().:'"`]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const safeSearchTerms = (query: string): string[] => {
  const terms = new Set<string>();
  for (const candidate of safeSearchTerm(query).split(" ")) {
    if (candidate.length < MIN_TERM_LENGTH) continue;
    if (STOP_TERMS.has(candidate.toLowerCase())) continue;
    terms.add(candidate.slice(0, MAX_TERM_LENGTH));
    if (terms.size >= MAX_SEARCH_TERMS) break;
  }
  return [...terms];
};

const orFilter = (terms: string[], columns: string[]): string =>
  terms
    .flatMap((term) => columns.map((column) => `${column}.ilike.%${term}%`))
    .join(",");

const requestedCanonStatuses = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [...DEFAULT_CANON_STATUSES];
  const allowed = value.filter(
    (entry): entry is string =>
      typeof entry === "string" && RETRIEVABLE_CANON_STATUSES.has(entry),
  );
  return allowed.length ? [...new Set(allowed)] : [...DEFAULT_CANON_STATUSES];
};

const warningsFor = (input: {
  approvedCount: number;
  returnedCount: number;
  profileCount: number;
  eventCount: number;
  terms: string[];
  contextPack: unknown;
}): string[] => {
  const warnings: string[] = [];
  if (input.approvedCount === 0) {
    warnings.push(
      "No approved Memory records were returned for the ProjectOS service principal.",
    );
  }
  if (
    input.returnedCount === 0 &&
    input.profileCount === 0 &&
    input.eventCount === 0 &&
    input.terms.length > 0
  ) {
    warnings.push(
      "Retrieval matched no records for the supplied query terms; absence is not proof that Memory is empty.",
    );
  }
  if (input.terms.length === 0) {
    warnings.push(
      "Query contained no usable search terms; results are recency-ordered only.",
    );
  }
  if (!input.contextPack) {
    warnings.push(
      "No active context pack was available; canonical records and open loops were still returned.",
    );
  }
  return warnings;
};

const searchMemory = async (
  body: JsonRecord,
  principal: Principal,
  supabase: AdminClient,
): Promise<Response> => {
  const namespace = body.namespace;
  const query = typeof body.query === "string" ? body.query.trim() : "";
  const currentTask = typeof body.current_task === "string"
    ? body.current_task.slice(0, 2_000)
    : null;
  const requestedMax =
    typeof body.max_items === "number" && Number.isInteger(body.max_items)
      ? body.max_items
      : 12;
  const maxItems = Math.min(Math.max(requestedMax, 1), MAX_ITEMS);

  if (namespace !== "real_life" && namespace !== "au") {
    return respond({ ok: false, error: "namespace_required" }, 400);
  }
  if (!principal.allowed_namespaces.includes(namespace)) {
    return respond({ ok: false, error: "namespace_not_allowed" }, 403);
  }
  if (!principal.scopes.includes("memory:read")) {
    return respond({ ok: false, error: "scope_not_allowed" }, 403);
  }
  if (!query || query.length > MAX_QUERY_LENGTH) {
    return respond({ ok: false, error: "invalid_query" }, 400);
  }

  const terms = safeSearchTerms(query);
  const canonStatuses = requestedCanonStatuses(body.canon_statuses);

  let profileQuery = supabase
    .from("memory_profiles")
    .select(
      "id,namespace,profile_type,subject_key,title,summary,facts,preferences,patterns,risks,open_loops,decisions,evidence_refs,confidence,status,version,created_at,updated_at,supersedes_profile_id,superseded_at",
    )
    .eq("user_id", principal.memory_user_id)
    .eq("namespace", namespace)
    .order("updated_at", { ascending: false })
    .limit(maxItems);
  if (terms.length) {
    profileQuery = profileQuery.or(
      orFilter(terms, ["title", "summary", "subject_key"]),
    );
  }

  let itemQuery = supabase
    .from("memory_items")
    .select(
      "id,title,body,confidence,source_summary,created_at,updated_at,canon_status,memory_type,strength,metadata",
    )
    .eq("user_id", principal.memory_user_id)
    .eq("namespace", namespace)
    .eq("is_active", true)
    .in("canon_status", canonStatuses)
    .order("updated_at", { ascending: false })
    .limit(maxItems);
  if (terms.length) {
    itemQuery = itemQuery.or(orFilter(terms, ["title", "body"]));
  }

  const [
    profilesResult,
    loopsResult,
    eventsResult,
    itemsResult,
    packsResult,
  ] = await Promise.all([
    profileQuery,
    supabase
      .from("memory_open_loops")
      .select(
        "id,namespace,loop_type,subject_key,title,description,severity,status,evidence_refs,next_action,created_at,updated_at,resolved_at",
      )
      .eq("user_id", principal.memory_user_id)
      .eq("namespace", namespace)
      .in("status", ["open", "acknowledged", "deferred"])
      .order("severity", { ascending: false })
      .limit(maxItems),
    supabase
      .from("memory_events")
      .select(
        "id,source,source_ref,extracted_summary,importance,sensitivity,status,created_at,updated_at,confidence_score,retrieval_weight,retrieval_count,positive_feedback_count,negative_feedback_count,superseded_by_memory_id",
      )
      .eq("user_id", principal.memory_user_id)
      .eq("namespace", namespace)
      .order("created_at", { ascending: false })
      .limit(maxItems),
    itemQuery,
    supabase
      .from("memory_context_packs")
      .select(
        "id,namespace,pack_type,title,summary,key_points,active_projects,people_map,decisions,risks,open_loops,generated_from_event_ids,status,created_at,updated_at",
      )
      .eq("user_id", principal.memory_user_id)
      .eq("namespace", namespace)
      .eq("status", "active")
      .order("updated_at", { ascending: false })
      .limit(20),
  ]);

  const firstError = [
    profilesResult,
    loopsResult,
    eventsResult,
    itemsResult,
    packsResult,
  ].find((result) => result.error)?.error;
  if (firstError) {
    console.error("projectos_memory_search_failed", {
      code: firstError.code,
      message: firstError.message,
    });
    return respond({ ok: false, error: "memory_query_failed" }, 503);
  }

  const profiles = (profilesResult.data ?? []) as JsonRecord[];
  const openLoops = (loopsResult.data ?? []) as JsonRecord[];
  const recentEvents = (eventsResult.data ?? []) as JsonRecord[];
  const items = (itemsResult.data ?? []) as JsonRecord[];
  const packs = (packsResult.data ?? []) as JsonRecord[];
  const dailyContextPack =
    packs.find((pack: JsonRecord) => pack.pack_type === "daily") ?? null;
  const latestContextPack =
    packs.find((pack: JsonRecord) => pack.pack_type === "master") ??
    dailyContextPack ??
    packs[0] ??
    null;
  const hydratedContextPack = latestContextPack && isRecord(latestContextPack)
    ? { ...latestContextPack, daily_context_pack: dailyContextPack }
    : latestContextPack;

  const semanticMatches = items.map((item: JsonRecord) => ({
    id: item.id,
    source: "memory_item",
    source_ref: item.source_summary,
    summary: `${item.title}: ${item.body}`,
    confidence: item.confidence,
    created_at: item.created_at,
    updated_at: item.updated_at,
  }));

  const canonicalRecords = items.map((item: JsonRecord) => ({
    id: item.id,
    namespace,
    title: item.title,
    body: item.body,
    canon_status: item.canon_status,
    approved: APPROVED_CANON_STATUSES.has(String(item.canon_status)),
    memory_type: item.memory_type,
    strength: item.strength,
    confidence: item.confidence,
    source_summary: item.source_summary,
    provenance: isRecord(item.metadata) ? item.metadata : null,
    created_at: item.created_at,
    updated_at: item.updated_at,
  }));
  const approvedCount = canonicalRecords.filter((item) => item.approved).length;

  const adaptiveProfile = profiles.filter((profile: JsonRecord) =>
    ["adaptive", "user", "preference"].some((value) =>
      String(profile.profile_type).toLowerCase().includes(value)
    )
  );
  const styleProfile = profiles.filter((profile: JsonRecord) =>
    String(profile.profile_type).toLowerCase().includes("style")
  );
  const projectContext = profiles.filter((profile: JsonRecord) =>
    ["project", "business", "decision"].some((value) =>
      String(profile.profile_type).toLowerCase().includes(value)
    )
  );
  const peopleContext = profiles.filter((profile: JsonRecord) =>
    ["person", "people", "relationship"].some((value) =>
      String(profile.profile_type).toLowerCase().includes(value)
    )
  );
  const riskWarnings = [
    ...profiles.filter(
      (profile: JsonRecord) =>
        Array.isArray(profile.risks) && profile.risks.length > 0,
    ),
    ...openLoops.filter(
      (loop: JsonRecord) => Number(loop.severity ?? 0) >= 7,
    ),
  ];

  const queryHash = await sha256(`${namespace}:${query}`);
  const { error: logError } = await supabase
    .from("memory_retrieval_logs")
    .insert({
      user_id: principal.memory_user_id,
      namespace,
      query_hash: queryHash,
      metadata: {
        principal: PRINCIPAL_KEY,
        source: "projectos",
        returned_profiles: profiles.length,
        returned_open_loops: openLoops.length,
        returned_events: recentEvents.length,
        returned_items: semanticMatches.length,
        returned_approved_items: approvedCount,
        returned_context_pack: Boolean(latestContextPack),
        context_pack_type: latestContextPack?.pack_type ?? null,
        returned_daily_context_pack: Boolean(dailyContextPack),
        search_terms: terms.length,
        canon_statuses: canonStatuses,
      },
    });
  if (logError) {
    console.error("projectos_memory_retrieval_log_failed", {
      code: logError.code,
      message: logError.message,
    });
  }

  return respond({
    ok: true,
    namespace,
    current_task: currentTask,
    adaptive_profile: adaptiveProfile,
    style_profile: styleProfile,
    project_context: projectContext,
    people_context: peopleContext,
    risk_warnings: riskWarnings,
    open_loops: openLoops,
    latest_context_pack: hydratedContextPack,
    daily_context_pack: dailyContextPack,
    recent_events: recentEvents,
    semantic_matches: semanticMatches,
    canonical_records: canonicalRecords,
    approved_record_count: approvedCount,
    requested_canon_statuses: canonStatuses,
    retrieval_mode: "keyword_recency_context_pack",
    retrieval_reasoning_summary:
      "ProjectOS received namespace-isolated, service-principal-owned approved Memory records, current open loops, and the preferred active master or daily context pack using bounded per-term matching and recency ordering.",
    warnings: warningsFor({
      approvedCount,
      returnedCount: canonicalRecords.length,
      profileCount: profiles.length,
      eventCount: recentEvents.length,
      terms,
      contextPack: hydratedContextPack,
    }),
  });
};

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
const EVIDENCE_ISO_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

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
  if (!normalized || !EVIDENCE_ISO_TIMESTAMP_PATTERN.test(normalized)) return null;
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? normalized : null;
};

const EVIDENCE_PRIVACY_SCAN_VERSION = "evidence_privacy_v2";
const EVIDENCE_PRIVACY_TEXT_LIMIT = 20_000;
const EVIDENCE_SECRET_FIELD_PATTERN = /^(?:password|passwd|passphrase|pwd|pin|secret|client_secret|secret_key|secret_access_key|aws_secret_access_key|aws_access_key_id|access_key_id|api_key|access_token|refresh_token|service_role|private_key|accountkey|sharedaccesssignature)$/i;
const EVIDENCE_DIRECT_IDENTIFIER_FIELD_PATTERN = /^(?:phone|phone_number|mobile|mobile_number|telephone|address|street_address|home_address|mailing_address|full_name|first_name|last_name|given_name|family_name|ssn|social_security_number|passport|passport_number|tax_id|bank_account|iban|card_number)$/i;

const normalizeEvidencePrivacyKey = (value: string): string =>
  value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

const decodeEvidencePrivacyText = (value: string): string => {
  let text = value
    .normalize("NFKC")
    .replace(/[\u200B-\u200F\u2060\uFEFF]/g, "");
  const decodeHex = (match: string, raw: string): string => {
    const code = Number.parseInt(raw, 16);
    return Number.isFinite(code) && code <= 0x10ffff
      ? String.fromCodePoint(code)
      : match;
  };
  text = text
    .replace(/\\u\{?([0-9a-f]{4,6})\}?/gi, decodeHex)
    .replace(/\\x([0-9a-f]{2})/gi, decodeHex)
    .replace(/&#x([0-9a-f]{2,6});?/gi, decodeHex)
    .replace(/&#(\d{2,7});?/g, (match: string, raw: string) => {
      const code = Number.parseInt(raw, 10);
      return Number.isFinite(code) && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : match;
    })
    .replace(/&commat;/gi, "@")
    .replace(/&colon;/gi, ":");
  for (let depth = 0; depth < 2; depth += 1) {
    try {
      const decoded = decodeURIComponent(text);
      if (decoded === text) break;
      text = decoded;
    } catch {
      break;
    }
  }
  return text.slice(0, EVIDENCE_PRIVACY_TEXT_LIMIT);
};

const evidencePrivacyTextReason = (value: string): string | null => {
  const text = decodeEvidencePrivacyText(value);
  const checks: Array<[RegExp, string]> = [
    [/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i, "direct_identifier_email"],
    [/(?:\+\d{1,3}[\s().-]*)?(?:\(?\d{2,4}\)?[\s.-]+)\d{3,4}[\s.-]+\d{3,4}\b/, "direct_identifier_phone"],
    [/\b(?:\+?63|0)9\d{9}\b/, "direct_identifier_phone"],
    [/\b(?:full[ _-]?name|first[ _-]?name|last[ _-]?name|given[ _-]?name|family[ _-]?name|name)\s*[:=]\s*["']?[A-Z][A-Z .'-]{2,80}/i, "direct_identifier_name"],
    [/\b(?:address|street[ _-]?address|home[ _-]?address|mailing[ _-]?address)\s*[:=]\s*[^,;\n]{5,160}/i, "direct_identifier_address"],
    [/\b\d{1,5}\s+[A-Z0-9.'-]+(?:\s+[A-Z0-9.'-]+){0,5}\s+(?:street|st|road|rd|avenue|ave|boulevard|blvd|drive|dr|lane|ln|court|ct|highway|hwy|barangay|brgy)\b/i, "direct_identifier_address"],
    [/\b\d{3}-\d{2}-\d{4}\b/, "direct_identifier_government"],
    [/\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/, "direct_identifier_financial"],
    [/-----BEGIN (?:[A-Z0-9 -]+ )?PRIVATE KEY-----/i, "private_key_material"],
    [/\b(?:AKIA|ASIA|AIDA|AROA|AIPA|ANPA|ANVA)[A-Z0-9]{16}\b/, "cloud_credential_signature"],
    [/\bAIza[0-9A-Za-z_-]{35}\b/, "cloud_credential_signature"],
    [/\b(?:ghp|github_pat|glpat|sk|sbp|xox[baprs])_[A-Za-z0-9_-]{12,}\b/i, "credential_signature"],
    [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/, "jwt_signature"],
    [/\b(?:password|passwd|passphrase|pwd|client[_ -]?secret|secret[_ -]?(?:key|access[_ -]?key)|aws[_ -]?(?:secret[_ -]?access[_ -]?key|access[_ -]?key[_ -]?id)|api[_ -]?key|access[_ -]?token|refresh[_ -]?token|service[_ -]?role|private[_ -]?key|accountkey|sharedaccesssignature)\s*[:=]\s*["']?(?!(?:true|false|null|none|redacted|masked)\b)[^\s"',;}{]{4,}/i, "secret_assignment"],
    [/https?:\/\/[^/\s:@]+:[^/\s@]{4,}@/i, "credential_in_url"],
  ];
  for (const [pattern, reason] of checks) {
    if (pattern.test(text)) return reason;
  }
  return null;
};

const evidenceSensitiveReason = (value: unknown): string | null => {
  const visit = (entry: unknown, key: string | null = null): string | null => {
    if (key !== null) {
      const normalizedKey = normalizeEvidencePrivacyKey(key);
      if (EVIDENCE_SECRET_FIELD_PATTERN.test(normalizedKey)) {
        return "secret_field";
      }
      if (EVIDENCE_DIRECT_IDENTIFIER_FIELD_PATTERN.test(normalizedKey)) {
        return "direct_identifier_field";
      }
    }
    if (typeof entry === "string") {
      return evidencePrivacyTextReason(entry);
    }
    if (Array.isArray(entry)) {
      for (const item of entry) {
        const reason = visit(item);
        if (reason) return reason;
      }
      return null;
    }
    if (isRecord(entry)) {
      for (const [childKey, childValue] of Object.entries(entry)) {
        const reason = visit(childValue, childKey);
        if (reason) return reason;
      }
    }
    return null;
  };
  return visit(value);
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

// Exactly what is (or is about to be) persisted for one evidence candidate.
// Review-queue reconciliation is always driven from this, never from a fresh
// submission, so a healed orphan mirrors the row that actually exists.
type EvidenceSnapshot = {
  namespace: string;
  sourceRef: string;
  summary: string;
  proofStage: string;
  claim: string;
  evidenceRefs: unknown;
  provenance: unknown;
  canonicalProjectId: string;
  canonicalProjectKey: string;
  idempotencyKey: string;
  fingerprint: string;
};

// Rebuild the snapshot of an already-persisted candidate from its own stored
// columns. Returns null if the row cannot be read faithfully, so reconciliation
// fails closed rather than writing a review item that misstates the candidate.
const storedEvidenceSnapshot = (
  candidate: JsonRecord,
  namespace: string,
  sourceRef: string,
): EvidenceSnapshot | null => {
  const metadata = isRecord(candidate.metadata) ? candidate.metadata : null;
  if (!metadata) return null;
  const summary = typeof candidate.summary === "string" ? candidate.summary : null;
  const proofStage = typeof metadata.proof_stage === "string" ? metadata.proof_stage : null;
  const claim = typeof metadata.claim === "string" ? metadata.claim : null;
  const projectId = typeof metadata.project_id === "string" ? metadata.project_id : null;
  const projectKey = typeof metadata.project_key === "string" ? metadata.project_key : null;
  const idempotencyKey = typeof metadata.idempotency_key === "string"
    ? metadata.idempotency_key
    : null;
  const fingerprint = typeof metadata.fingerprint === "string" ? metadata.fingerprint : null;
  if (
    !summary || !proofStage || !claim || !projectId || !projectKey ||
    !idempotencyKey || !fingerprint || metadata.evidence_refs === undefined ||
    metadata.provenance === undefined
  ) {
    return null;
  }
  return {
    namespace,
    sourceRef,
    summary,
    proofStage,
    claim,
    evidenceRefs: metadata.evidence_refs,
    provenance: metadata.provenance,
    canonicalProjectId: projectId,
    canonicalProjectKey: projectKey,
    idempotencyKey,
    fingerprint,
  };
};

type EnsureReviewResult =
  | { ok: true; id: string; created: boolean }
  | { ok: false; response: Response };

// Guarantee that the persisted candidate has a pending_review queue item.
// Called on every submission before any conflict decision, so a candidate left
// without a queue item by a partial failure is healed on the next request with
// the same key — including one whose content has changed.
const ensureEvidenceReviewItem = async (
  admin: AdminClient,
  principal: Principal,
  snapshot: EvidenceSnapshot,
  candidateId: string,
): Promise<EnsureReviewResult> => {
  const { data: existingReview, error: existingReviewError } = await admin
    .from("memory_review_queue_items")
    .select("id")
    .eq("user_id", principal.memory_user_id)
    .eq("namespace", snapshot.namespace)
    .eq("candidate_type", EVIDENCE_CANDIDATE_TYPE)
    .eq("source_ref", snapshot.sourceRef)
    .maybeSingle();

  if (existingReviewError) {
    console.error("projectos_evidence_review_lookup_failed", existingReviewError.message);
    return { ok: false, response: respond({ ok: false, error: "review_lookup_failed" }, 500) };
  }
  if (existingReview?.id) {
    return { ok: true, id: existingReview.id, created: false };
  }

  const { data: insertedReview, error: reviewInsertError } = await admin
    .from("memory_review_queue_items")
    .insert({
      user_id: principal.memory_user_id,
      namespace: snapshot.namespace,
      status: "pending_review",
      candidate_type: EVIDENCE_CANDIDATE_TYPE,
      normalized_text: snapshot.summary,
      evidence_snapshot: {
        hasEvidence: true,
        intakeKind: EVIDENCE_INTAKE_KIND,
        sourceRef: snapshot.sourceRef,
        proofStage: snapshot.proofStage,
        claim: snapshot.claim,
        evidenceRefs: snapshot.evidenceRefs,
        provenance: snapshot.provenance,
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
        sourceNamespace: snapshot.namespace,
        targetNamespace: snapshot.namespace,
        namespaceMatch: true,
      },
      source_metadata: {
        source: EVIDENCE_SOURCE,
        sourceKind: "projectos_evidence",
        sourceRef: snapshot.sourceRef,
        projectId: snapshot.canonicalProjectId,
        projectKey: snapshot.canonicalProjectKey,
        proofStage: snapshot.proofStage,
      },
      audit_metadata: {
        schemaVersion: 1,
        candidateId,
        appendOnly: true,
        reviewRequired: true,
        idempotencyKey: snapshot.idempotencyKey,
        fingerprint: snapshot.fingerprint,
      },
      append_only: true,
      proposed_operation: "append",
      requires_review: true,
      source_ref: snapshot.sourceRef,
      request_hash: snapshot.fingerprint,
      fingerprint: snapshot.fingerprint,
      persistence_execution_metadata: {},
    })
    .select("id")
    .maybeSingle();

  if (reviewInsertError && errorCode(reviewInsertError) !== "23505") {
    console.error("projectos_evidence_review_insert_failed", reviewInsertError.message);
    return { ok: false, response: respond({ ok: false, error: "review_insert_failed" }, 500) };
  }
  if (insertedReview?.id) {
    return { ok: true, id: insertedReview.id, created: true };
  }

  // Lost the unique race: another concurrent submission created the queue item.
  const { data: racedReview, error: racedReviewError } = await admin
    .from("memory_review_queue_items")
    .select("id")
    .eq("user_id", principal.memory_user_id)
    .eq("namespace", snapshot.namespace)
    .eq("candidate_type", EVIDENCE_CANDIDATE_TYPE)
    .eq("source_ref", snapshot.sourceRef)
    .maybeSingle();
  if (racedReviewError || !racedReview?.id) {
    return { ok: false, response: respond({ ok: false, error: "review_recovery_failed" }, 500) };
  }
  return { ok: true, id: racedReview.id, created: false };
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

  let projectQuery = admin
    .from("pandora_projects")
    .select("id,project_key,memory_namespace,lifecycle_status")
    .eq("memory_namespace", namespace)
    .eq("lifecycle_status", "active");
  if (projectId) projectQuery = projectQuery.eq("id", projectId);
  if (projectKey) projectQuery = projectQuery.eq("project_key", projectKey);

  const { data: boundProject, error: boundProjectError } = await projectQuery.maybeSingle();
  if (boundProjectError) {
    console.error("projectos_evidence_project_lookup_failed", boundProjectError.message);
    return respond({ ok: false, error: "project_lookup_failed" }, 500);
  }
  if (
    !boundProject ||
    typeof boundProject.id !== "string" ||
    !EVIDENCE_UUID_PATTERN.test(boundProject.id) ||
    typeof boundProject.project_key !== "string" ||
    !EVIDENCE_PROJECT_KEY_PATTERN.test(boundProject.project_key)
  ) {
    return respond({ ok: false, error: "project_not_allowed" }, 403);
  }

  const canonicalProjectId = boundProject.id;
  const canonicalProjectKey = boundProject.project_key;
  const { data: projectGrant, error: projectGrantError } = await admin
    .from("pandora_project_grants")
    .select("project_id")
    .eq("principal_key", PRINCIPAL_KEY)
    .eq("project_id", canonicalProjectId)
    .eq("environment", principal.environment)
    .eq("is_active", true)
    .eq("can_propose", true)
    .is("revoked_at", null)
    .maybeSingle();
  if (projectGrantError) {
    console.error("projectos_evidence_project_grant_lookup_failed", projectGrantError.message);
    return respond({ ok: false, error: "project_grant_lookup_failed" }, 500);
  }
  if (!projectGrant?.project_id) {
    return respond({ ok: false, error: "project_not_allowed" }, 403);
  }

  const projectReference = canonicalProjectKey;
  const sourceRef = `projectos-evidence:${canonicalProjectId}:${idempotencyKey}`;
  const fingerprint = await evidenceSha256(JSON.stringify({
    namespace,
    project_id: canonicalProjectId,
    project_key: canonicalProjectKey,
    title,
    summary,
    proof_stage: proofStage,
    claim,
    evidence_refs: evidenceRefs,
    provenance,
    idempotency_key: idempotencyKey,
  }));
  const now = new Date().toISOString();

  const incomingSnapshot: EvidenceSnapshot = {
    namespace,
    sourceRef,
    summary,
    proofStage,
    claim,
    evidenceRefs,
    provenance,
    canonicalProjectId,
    canonicalProjectKey,
    idempotencyKey,
    fingerprint,
  };

  let candidateId: string | null = null;
  let candidateCreated = false;
  // The snapshot that is actually persisted. On a replay this is the stored
  // row, not the incoming submission, so reconciliation cannot rewrite history.
  let persistedSnapshot: EvidenceSnapshot | null = null;
  const { data: existingCandidate, error: existingCandidateError } = await admin
    .from("memory_capture_candidates")
    .select("id,summary,metadata")
    .eq("user_id", principal.memory_user_id)
    .eq("namespace", namespace)
    .eq("source", EVIDENCE_SOURCE)
    .eq("source_ref", sourceRef)
    .maybeSingle();

  if (existingCandidateError) {
    console.error("projectos_evidence_candidate_lookup_failed", existingCandidateError.message);
    return respond({ ok: false, error: "candidate_lookup_failed" }, 500);
  }

  if (existingCandidate?.id) {
    // Deliberately do NOT decide the conflict yet. The queue item is reconciled
    // first (below) so a candidate orphaned by an earlier partial failure
    // becomes visible to human review even when this retry carries new content.
    persistedSnapshot = storedEvidenceSnapshot(existingCandidate, namespace, sourceRef);
    if (!persistedSnapshot) {
      console.error("projectos_evidence_candidate_unreadable", sourceRef);
      return respond({ ok: false, error: "candidate_reconcile_failed" }, 500);
    }
    candidateId = existingCandidate.id;
  }

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
        project_id: canonicalProjectId,
        project_key: canonicalProjectKey,
        proof_stage: proofStage,
        claim,
        evidence_refs: evidenceRefs,
        provenance,
        idempotency_key: idempotencyKey,
        fingerprint,
        privacy_policy: "metadata_only_v2_fail_closed",
        privacy_scan_version: EVIDENCE_PRIVACY_SCAN_VERSION,
        privacy_scan_passed: true,
        privacy_scan_scope: "canonicalized_candidate_payload",
        imported_raw_arguments: false,
        imported_raw_results: false,
        imported_raw_errors: false,
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
      persistedSnapshot = incomingSnapshot;
    } else {
      // Lost the unique race: adopt the winner's stored row and, as above,
      // reconcile its queue item before judging the conflict.
      const { data: racedCandidate, error: racedCandidateError } = await admin
        .from("memory_capture_candidates")
        .select("id,summary,metadata")
        .eq("user_id", principal.memory_user_id)
        .eq("namespace", namespace)
        .eq("source", EVIDENCE_SOURCE)
        .eq("source_ref", sourceRef)
        .maybeSingle();
      if (racedCandidateError || !racedCandidate?.id) {
        return respond({ ok: false, error: "candidate_recovery_failed" }, 500);
      }
      persistedSnapshot = storedEvidenceSnapshot(racedCandidate, namespace, sourceRef);
      if (!persistedSnapshot) {
        console.error("projectos_evidence_candidate_unreadable", sourceRef);
        return respond({ ok: false, error: "candidate_reconcile_failed" }, 500);
      }
      candidateId = racedCandidate.id;
    }
  }

  if (!candidateId || !persistedSnapshot) {
    return respond({ ok: false, error: "candidate_recovery_failed" }, 500);
  }

  // Reconcile the review queue against whatever is actually persisted. This runs
  // on every submission, so an orphaned candidate can never remain permanently
  // invisible to human review.
  const review = await ensureEvidenceReviewItem(
    admin,
    principal,
    persistedSnapshot,
    candidateId,
  );
  if (!review.ok) return review.response;
  const reviewItemId = review.id;
  const reviewCreated = review.created;

  // Only now is it safe to report a conflict: the persisted candidate is
  // queued for review, and this differing submission is rejected rather than
  // silently overwriting or dropping content.
  if (persistedSnapshot.fingerprint !== fingerprint) {
    return respond({ ok: false, error: "idempotency_conflict" }, 409);
  }
  return respond({
    ok: true,
    candidate_id: candidateId,
    review_item_id: reviewItemId,
    status: "pending_review",
    idempotency_key: idempotencyKey,
    namespace,
    project_id: canonicalProjectId,
    project_key: canonicalProjectKey,
    proof_stage: proofStage,
    deduplicated: !(candidateCreated || reviewCreated),
    created_at: candidateCreated || reviewCreated ? now : null,
    canonical_memory_written: false,
    privacy_policy: "metadata_only_v1",
  }, candidateCreated || reviewCreated ? 202 : 200);
};

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") {
    return respond({ ok: false, error: "method_not_allowed" }, 405);
  }
  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return respond({ ok: false, error: "payload_too_large" }, 413);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    return respond({ ok: false, error: "bridge_runtime_unavailable" }, 503);
  }

  const supabase: AdminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const authorization = await authorize(request, supabase);
  if (!authorization.ok) return authorization.error;

  const body = await request.json().catch(() => null) as JsonRecord | null;
  if (!body) return respond({ ok: false, error: "invalid_json" }, 400);

  if (body.action === "health") {
    if (!authorization.principal.scopes.includes("memory:health")) {
      return respond({ ok: false, error: "scope_not_allowed" }, 403);
    }
    return respond({
      ok: true,
      project: "pandora-memory-engine",
      status: "projectos-connected",
      context_pack_hydration: "active",
      daily_context_pack: "scheduled_15m",
      post_task_learning: "review_gated",
    });
  }
  if (body.action === "submit_evidence_candidate") {
    return submitEvidenceCandidate(body, authorization.principal, supabase);
  }
  if (body.action === "search") {
    return searchMemory(body, authorization.principal, supabase);
  }
  return respond({ ok: false, error: "unsupported_action" }, 400);
});