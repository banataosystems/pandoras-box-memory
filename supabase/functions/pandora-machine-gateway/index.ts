import { createClient } from "npm:@supabase/supabase-js@2.110.9";
import {
  createRemoteJWKSet,
  type JWTPayload,
  jwtVerify,
} from "npm:jose@5.10.0";
import {
  applyMemoryHealthScope,
  buildMemorySearchQuery,
  MEMORY_SEARCH_RESOURCE,
  sanitizeMemorySearchQuery,
} from "./memory-search-policy.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ENVIRONMENT = Deno.env.get("PANDORA_GATEWAY_ENVIRONMENT") || "production";
const MAX_BODY_BYTES = 64 * 1024;
const MAX_QUERY = 2000;
const MAX_LIMIT = 20;
const MCP_PROTOCOL_VERSION = "2025-06-18";
const GATEWAY_RESOURCE = `${SUPABASE_URL}/functions/v1/pandora-machine-gateway`;
const RESOURCE_METADATA_URL = `${GATEWAY_RESOURCE}/oauth-protected-resource`;
const AUTHORIZATION_SERVER = `${SUPABASE_URL}/auth/v1`;

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const GLOBAL_VERCEL_JWKS = createRemoteJWKSet(
  new URL("https://oidc.vercel.com/.well-known/jwks"),
);
const issuerJwks = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

type RpcRequest = {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: any;
};

type Identity = {
  userId: string;
  clientId?: string;
  principalId: string;
  principalKey: string;
  authMode: "oauth" | "workload_oidc";
};

type GatewayPrincipal = {
  id: string;
  principal_key: string;
  user_id: string;
  oidc_issuer: string;
  oidc_audience: string;
  oidc_subject: string;
};

function json(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      ...headers,
    },
  });
}

function rpc(id: RpcRequest["id"], result: unknown) {
  return json({ jsonrpc: "2.0", id: id ?? null, result });
}

function rpcError(
  id: RpcRequest["id"],
  code: number,
  message: string,
  data?: unknown,
  status = 200,
) {
  return json({
    jsonrpc: "2.0",
    id: id ?? null,
    error: {
      code,
      message,
      ...(data === undefined ? {} : { data }),
    },
  }, status);
}

function oauthChallenge(reason: string) {
  return json(
    { error: "unauthorized", reason },
    401,
    {
      "www-authenticate":
        `Bearer realm="pandora-machine-gateway", resource_metadata="${RESOURCE_METADATA_URL}"`,
    },
  );
}

function protectedResourceMetadata() {
  return json({
    resource: GATEWAY_RESOURCE,
    authorization_servers: [AUTHORIZATION_SERVER],
    bearer_methods_supported: ["header"],
  });
}

function decodePayload(token: string): Record<string, any> | null {
  try {
    const p = token.split(".")[1];
    if (!p) return null;
    const normalized = p
      .replace(/-/g, "+")
      .replace(/_/g, "/")
      .padEnd(Math.ceil(p.length / 4) * 4, "=");
    return JSON.parse(atob(normalized));
  } catch {
    return null;
  }
}

function exactAudience(
  payload: JWTPayload | Record<string, any>,
): string | null {
  if (Array.isArray(payload.aud)) {
    return typeof payload.aud[0] === "string" ? payload.aud[0] : null;
  }
  return typeof payload.aud === "string" ? payload.aud : null;
}

function jwksForVercelIssuer(issuer: string) {
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
    throw new Error("invalid_vercel_issuer");
  }

  const normalized = url.toString().replace(/\/$/, "");
  let jwks = issuerJwks.get(normalized);
  if (!jwks) {
    jwks = createRemoteJWKSet(
      new URL(`${normalized}/.well-known/jwks`),
    );
    issuerJwks.set(normalized, jwks);
  }
  return jwks;
}

function mayRetryWithGlobalJwks(error: unknown) {
  const code = typeof error === "object" && error && "code" in error
    ? String((error as { code?: unknown }).code || "")
    : "";
  return code === "ERR_JWS_SIGNATURE_VERIFICATION_FAILED" ||
    code === "ERR_JWKS_NO_MATCHING_KEY" ||
    code.startsWith("ERR_JWKS");
}

async function verifyVercelOidc(
  token: string,
  principal: GatewayPrincipal,
) {
  const options = {
    issuer: principal.oidc_issuer,
    audience: principal.oidc_audience,
    subject: principal.oidc_subject,
    clockTolerance: 30,
  };

  try {
    return await jwtVerify(
      token,
      jwksForVercelIssuer(principal.oidc_issuer),
      options,
    );
  } catch (error) {
    if (!mayRetryWithGlobalJwks(error)) throw error;
    return await jwtVerify(token, GLOBAL_VERCEL_JWKS, options);
  }
}

async function audit(
  identity: Identity | null,
  requestId: string | null,
  authMode: string,
  service: string | null,
  action: string | null,
  resource: string | null,
  decision: "allow" | "deny" | "error",
  reason: string,
  latencyMs?: number,
) {
  await admin.from("gateway_audit_events").insert({
    request_id: requestId || crypto.randomUUID(),
    principal_id: identity?.principalId || null,
    principal_key: identity?.principalKey || null,
    auth_mode: authMode,
    service_key: service,
    action_key: action,
    environment: ENVIRONMENT,
    resource_key: resource,
    decision,
    reason_code: reason,
    latency_ms: latencyMs ?? null,
    metadata: {},
  });
}

async function authenticateOauth(
  req: Request,
  service: string,
  action: string,
  resource: string | null,
): Promise<Identity | Response> {
  const authorization = req.headers.get("authorization") || "";
  if (!authorization.startsWith("Bearer ")) {
    return oauthChallenge("missing_bearer");
  }

  const token = authorization.slice(7).trim();
  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: userData, error: userError } = await userClient.auth.getUser(
    token,
  );
  if (userError || !userData.user) {
    return oauthChallenge("invalid_token");
  }

  const claims = decodePayload(token);
  const clientId = typeof claims?.client_id === "string"
    ? claims.client_id
    : "";
  if (!clientId) {
    return json({ error: "forbidden", reason: "oauth_client_required" }, 403);
  }

  const { data, error } = await admin.rpc("gateway_authorize_oauth", {
    p_user_id: userData.user.id,
    p_client_id: clientId,
    p_service_key: service,
    p_action_key: action,
    p_environment: ENVIRONMENT,
    p_resource_key: resource,
  });

  const decision = Array.isArray(data) ? data[0] : null;
  if (error || !decision?.allowed) {
    await audit(
      null,
      null,
      "oauth",
      service,
      action,
      resource,
      "deny",
      decision?.reason_code || "authorization_error",
    );
    return json(
      { error: "forbidden", reason: decision?.reason_code || "missing_grant" },
      403,
    );
  }

  return {
    userId: userData.user.id,
    clientId,
    principalId: decision.principal_id,
    principalKey: decision.principal_key,
    authMode: "oauth",
  };
}

async function authenticateWorkload(
  req: Request,
  service: string,
  action: string,
  resource: string | null,
): Promise<Identity | Response | null> {
  const token = (
    req.headers.get("x-pandora-workload-oidc") ||
    req.headers.get("x-pandora-vercel-oidc") ||
    ""
  ).trim();

  if (!token) return null;

  const unverified = decodePayload(token);
  const issuer = typeof unverified?.iss === "string" ? unverified.iss : "";
  const audience = unverified ? exactAudience(unverified) : null;
  const subject = typeof unverified?.sub === "string" ? unverified.sub : "";

  if (!issuer || !audience || !subject) {
    await audit(
      null,
      null,
      "workload_oidc",
      service,
      action,
      resource,
      "deny",
      "malformed_identity",
    );
    return json({ error: "unauthorized", reason: "malformed_identity" }, 401);
  }

  let principalQuery;
  try {
    // Validate issuer shape before using unverified claims for record lookup.
    jwksForVercelIssuer(issuer);
    principalQuery = await admin
      .from("gateway_principals")
      .select(
        "id,principal_key,user_id,oidc_issuer,oidc_audience,oidc_subject",
      )
      .eq("principal_type", "workload_oidc")
      .eq("oidc_issuer", issuer)
      .eq("oidc_audience", audience)
      .eq("oidc_subject", subject)
      .eq("is_active", true)
      .maybeSingle();
  } catch {
    await audit(
      null,
      null,
      "workload_oidc",
      service,
      action,
      resource,
      "deny",
      "identity_issuer_invalid",
    );
    return json(
      { error: "unauthorized", reason: "identity_issuer_invalid" },
      401,
    );
  }

  const principal = principalQuery.data as GatewayPrincipal | null;
  if (principalQuery.error || !principal) {
    await audit(
      null,
      null,
      "workload_oidc",
      service,
      action,
      resource,
      "deny",
      "unknown_principal",
    );
    return json({ error: "forbidden", reason: "unknown_principal" }, 403);
  }

  try {
    const { payload } = await verifyVercelOidc(token, principal);
    if (
      payload.iss !== principal.oidc_issuer ||
      exactAudience(payload) !== principal.oidc_audience ||
      payload.sub !== principal.oidc_subject
    ) {
      await audit(
        null,
        null,
        "workload_oidc",
        service,
        action,
        resource,
        "deny",
        "identity_not_allowed",
      );
      return json(
        { error: "forbidden", reason: "identity_not_allowed" },
        403,
      );
    }
  } catch {
    await audit(
      null,
      null,
      "workload_oidc",
      service,
      action,
      resource,
      "deny",
      "identity_verification_failed",
    );
    return json(
      { error: "unauthorized", reason: "identity_verification_failed" },
      401,
    );
  }

  const { data, error } = await admin.rpc("gateway_authorize_oidc", {
    p_issuer: principal.oidc_issuer,
    p_audience: principal.oidc_audience,
    p_subject: principal.oidc_subject,
    p_service_key: service,
    p_action_key: action,
    p_environment: ENVIRONMENT,
    p_resource_key: resource,
  });

  const decision = Array.isArray(data) ? data[0] : null;
  if (error || !decision?.allowed) {
    const identity: Identity = {
      userId: principal.user_id,
      principalId: principal.id,
      principalKey: principal.principal_key,
      authMode: "workload_oidc",
    };
    await audit(
      identity,
      null,
      "workload_oidc",
      service,
      action,
      resource,
      "deny",
      decision?.reason_code || "authorization_error",
    );
    return json(
      { error: "forbidden", reason: decision?.reason_code || "missing_grant" },
      403,
    );
  }

  return {
    userId: decision.user_id,
    principalId: decision.principal_id,
    principalKey: decision.principal_key,
    authMode: "workload_oidc",
  };
}

async function authenticate(
  req: Request,
  service: string,
  action: string,
  resource: string | null,
): Promise<Identity | Response> {
  const workload = await authenticateWorkload(
    req,
    service,
    action,
    resource,
  );
  if (workload) return workload;
  return await authenticateOauth(req, service, action, resource);
}

function toolList() {
  return [
    {
      name: "memory_health",
      description: "Return bounded Pandora Memory service health information.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
    {
      name: "memory_search",
      description:
        "Search approved canonical Pandora Memory belonging to the authenticated principal.",
      inputSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            minLength: 1,
            maxLength: MAX_QUERY,
          },
          limit: {
            type: "integer",
            minimum: 1,
            maximum: MAX_LIMIT,
            default: 10,
          },
        },
        required: ["query"],
        additionalProperties: false,
      },
    },
  ];
}

async function callTool(req: Request, body: RpcRequest) {
  const name = String(body.params?.name || "");
  const args = body.params?.arguments || {};
  const requestId = crypto.randomUUID();
  const started = Date.now();

  if (name === "memory_health") {
    const identity = await authenticate(
      req,
      "pandora_memory",
      "health",
      null,
    );
    if (identity instanceof Response) return identity;

    const { count, error } = await applyMemoryHealthScope(
      admin
        .from("memory_items")
        .select("id", { count: "exact", head: true }),
      identity.userId,
    );

    if (error) {
      await audit(
        identity,
        requestId,
        identity.authMode,
        "pandora_memory",
        "health",
        null,
        "error",
        "downstream_query_error",
        Date.now() - started,
      );
      return rpcError(body.id, -32603, "memory_health_failed");
    }

    await audit(
      identity,
      requestId,
      identity.authMode,
      "pandora_memory",
      "health",
      null,
      "allow",
      "authorized",
      Date.now() - started,
    );

    return rpc(body.id, {
      content: [{
        type: "text",
        text: JSON.stringify({
          ok: true,
          service: "pandora_memory",
          active_memory_items: count ?? 0,
          internal_processing_independent_of_mcp: true,
          auth_mode: identity.authMode,
        }),
      }],
    });
  }

  if (name === "memory_search") {
    const query = typeof args.query === "string"
      ? args.query.trim().slice(0, MAX_QUERY)
      : "";
    const limit = Math.max(
      1,
      Math.min(MAX_LIMIT, Number(args.limit || 10)),
    );

    if (!query) return rpcError(body.id, -32602, "query_required");

    const safe = sanitizeMemorySearchQuery(query);
    if (!safe) return rpcError(body.id, -32602, "query_required");

    const identity = await authenticate(
      req,
      "pandora_memory",
      "search",
      MEMORY_SEARCH_RESOURCE,
    );
    if (identity instanceof Response) return identity;

    const { data, error } = await buildMemorySearchQuery(
      admin
        .from("memory_items")
        .select(
          "id,title,body,namespace,canon_status,confidence,source_summary,updated_at,project_id,record_type",
        ),
      identity.userId,
      safe,
      limit,
    );

    if (error) {
      await audit(
        identity,
        requestId,
        identity.authMode,
        "pandora_memory",
        "search",
        MEMORY_SEARCH_RESOURCE,
        "error",
        "downstream_query_error",
        Date.now() - started,
      );
      return rpcError(body.id, -32603, "memory_search_failed");
    }

    await audit(
      identity,
      requestId,
      identity.authMode,
      "pandora_memory",
      "search",
      MEMORY_SEARCH_RESOURCE,
      "allow",
      "authorized",
      Date.now() - started,
    );

    return rpc(body.id, {
      content: [{
        type: "text",
        text: JSON.stringify({
          items: data || [],
          count: data?.length || 0,
        }),
      }],
    });
  }

  return rpcError(body.id, -32602, "unknown_tool");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204 });
  }

  const url = new URL(req.url);
  if (
    req.method === "GET" &&
    url.pathname.endsWith("/oauth-protected-resource")
  ) {
    return protectedResourceMetadata();
  }

  if (req.method === "GET") {
    return json({
      service: "pandora-machine-gateway",
      protocol: "mcp-streamable-http-jsonrpc",
      protocol_version: MCP_PROTOCOL_VERSION,
      authentication: ["supabase-oauth-2.1", "vercel-workload-oidc"],
      oauth_authorization_server: AUTHORIZATION_SERVER,
      oauth_resource_metadata: RESOURCE_METADATA_URL,
      workload_header: "x-pandora-workload-oidc",
      tools: ["memory_health", "memory_search"],
    });
  }

  if (req.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405);
  }

  const length = Number(req.headers.get("content-length") || "0");
  if (length > MAX_BODY_BYTES) {
    return json({ error: "payload_too_large" }, 413);
  }

  let body: RpcRequest;
  try {
    body = await req.json();
  } catch {
    return rpcError(null, -32700, "parse_error", undefined, 400);
  }

  if (body.method === "tools/call") {
    return await callTool(req, body);
  }

  // All other MCP protocol messages require the bounded health permission.
  // This intentionally makes the first unauthenticated initialize request
  // return RFC 9728 discovery metadata instead of exposing an unprotected MCP handshake.
  const identity = await authenticate(
    req,
    "pandora_memory",
    "health",
    null,
  );
  if (identity instanceof Response) return identity;

  if (body.method === "initialize") {
    return rpc(body.id, {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: { tools: {} },
      serverInfo: {
        name: "pandora-machine-gateway",
        version: "0.3.0",
      },
    });
  }

  if (body.method === "notifications/initialized") {
    return new Response(null, { status: 202 });
  }

  if (body.method === "ping") {
    return rpc(body.id, {});
  }

  if (body.method === "tools/list") {
    return rpc(body.id, { tools: toolList() });
  }

  return rpcError(body.id, -32601, "method_not_found");
});
