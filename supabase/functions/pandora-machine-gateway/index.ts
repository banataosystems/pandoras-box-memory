import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ENVIRONMENT = Deno.env.get("PANDORA_GATEWAY_ENVIRONMENT") || "production";
const MAX_BODY_BYTES = 64 * 1024;
const MAX_QUERY = 2000;
const MAX_LIMIT = 20;

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

type RpcRequest = { jsonrpc?: string; id?: string | number | null; method?: string; params?: any };

type Identity = { userId: string; clientId: string; principalId: string; principalKey: string };

function json(body: unknown, status = 200, headers: Record<string,string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });
}

function rpc(id: RpcRequest["id"], result: unknown) {
  return json({ jsonrpc: "2.0", id: id ?? null, result });
}

function rpcError(id: RpcRequest["id"], code: number, message: string, data?: unknown, status = 200) {
  return json({ jsonrpc: "2.0", id: id ?? null, error: { code, message, ...(data === undefined ? {} : { data }) } }, status);
}

function decodePayload(token: string): Record<string, any> | null {
  try {
    const p = token.split(".")[1];
    if (!p) return null;
    const normalized = p.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(p.length / 4) * 4, "=");
    return JSON.parse(atob(normalized));
  } catch { return null; }
}

async function authenticate(req: Request, service: string, action: string, resource: string | null): Promise<Identity | Response> {
  const auth = req.headers.get("authorization") || "";
  if (!auth.startsWith("Bearer ")) {
    return json({ error: "unauthorized", reason: "missing_bearer" }, 401, {
      "www-authenticate": `Bearer realm="pandora-machine-gateway"`,
    });
  }

  const token = auth.slice(7).trim();
  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userError } = await userClient.auth.getUser(token);
  if (userError || !userData.user) {
    return json({ error: "unauthorized", reason: "invalid_token" }, 401);
  }

  const claims = decodePayload(token);
  const clientId = typeof claims?.client_id === "string" ? claims.client_id : "";
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
    await audit(null, null, "oauth", service, action, resource, "deny", decision?.reason_code || "authorization_error");
    return json({ error: "forbidden", reason: decision?.reason_code || "missing_grant" }, 403);
  }

  return {
    userId: userData.user.id,
    clientId,
    principalId: decision.principal_id,
    principalKey: decision.principal_key,
  };
}

async function audit(identity: Identity | null, requestId: string | null, authMode: string, service: string | null, action: string | null, resource: string | null, decision: "allow"|"deny"|"error", reason: string, latencyMs?: number) {
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

function toolList() {
  return [
    {
      name: "memory_health",
      description: "Return bounded Pandora Memory service health information.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
    },
    {
      name: "memory_search",
      description: "Search approved canonical Pandora Memory belonging to the authenticated user.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", minLength: 1, maxLength: MAX_QUERY },
          limit: { type: "integer", minimum: 1, maximum: MAX_LIMIT, default: 10 },
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
    const identity = await authenticate(req, "pandora_memory", "health", null);
    if (identity instanceof Response) return identity;
    const [{ count }, cron] = await Promise.all([
      admin.from("memory_items").select("id", { count: "exact", head: true }).eq("user_id", identity.userId).eq("is_active", true),
      admin.rpc("gateway_authorize_oauth", { p_user_id: identity.userId, p_client_id: identity.clientId, p_service_key: "pandora_memory", p_action_key: "health", p_environment: ENVIRONMENT, p_resource_key: null }),
    ]);
    await audit(identity, requestId, "oauth", "pandora_memory", "health", null, "allow", "authorized", Date.now() - started);
    return rpc(body.id, { content: [{ type: "text", text: JSON.stringify({ ok: true, service: "pandora_memory", active_memory_items: count ?? 0, internal_processing_independent_of_mcp: true }) }] });
  }

  if (name === "memory_search") {
    const q = typeof args.query === "string" ? args.query.trim().slice(0, MAX_QUERY) : "";
    const limit = Math.max(1, Math.min(MAX_LIMIT, Number(args.limit || 10)));
    if (!q) return rpcError(body.id, -32602, "query_required");
    const identity = await authenticate(req, "pandora_memory", "search", "namespace:real_life");
    if (identity instanceof Response) return identity;

    const safe = q.replace(/[%_]/g, "").replace(/[(),]/g, " ").trim();
    const { data, error } = await admin
      .from("memory_items")
      .select("id,title,body,namespace,canon_status,confidence,source_summary,updated_at,project_id,record_type")
      .eq("user_id", identity.userId)
      .eq("is_active", true)
      .in("canon_status", ["hard_canon", "soft_canon"])
      .or(`title.ilike.%${safe}%,body.ilike.%${safe}%`)
      .order("updated_at", { ascending: false })
      .limit(limit);

    if (error) {
      await audit(identity, requestId, "oauth", "pandora_memory", "search", "namespace:real_life", "error", "downstream_query_error", Date.now() - started);
      return rpcError(body.id, -32603, "memory_search_failed");
    }
    await audit(identity, requestId, "oauth", "pandora_memory", "search", "namespace:real_life", "allow", "authorized", Date.now() - started);
    return rpc(body.id, { content: [{ type: "text", text: JSON.stringify({ items: data || [], count: data?.length || 0 }) }] });
  }

  return rpcError(body.id, -32602, "unknown_tool");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204 });

  if (req.method === "GET") {
    return json({
      service: "pandora-machine-gateway",
      protocol: "mcp-streamable-http-jsonrpc",
      authentication: "supabase-oauth-2.1",
      oauth_authorization_server: `${SUPABASE_URL}/auth/v1`,
      tools: ["memory_health", "memory_search"],
    });
  }

  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const len = Number(req.headers.get("content-length") || "0");
  if (len > MAX_BODY_BYTES) return json({ error: "payload_too_large" }, 413);

  let body: RpcRequest;
  try { body = await req.json(); } catch { return rpcError(null, -32700, "parse_error", undefined, 400); }

  if (body.method === "initialize") {
    return rpc(body.id, {
      protocolVersion: "2025-03-26",
      capabilities: { tools: {} },
      serverInfo: { name: "pandora-machine-gateway", version: "0.1.0" },
    });
  }
  if (body.method === "notifications/initialized") return new Response(null, { status: 202 });
  if (body.method === "ping") return rpc(body.id, {});
  if (body.method === "tools/list") {
    const identity = await authenticate(req, "pandora_memory", "health", null);
    if (identity instanceof Response) return identity;
    return rpc(body.id, { tools: toolList() });
  }
  if (body.method === "tools/call") return await callTool(req, body);

  return rpcError(body.id, -32601, "method_not_found");
});
