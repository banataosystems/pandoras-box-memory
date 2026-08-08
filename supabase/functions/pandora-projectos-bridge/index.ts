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
  if (body.action === "search") {
    return searchMemory(body, authorization.principal, supabase);
  }
  return respond({ ok: false, error: "unsupported_action" }, 400);
});