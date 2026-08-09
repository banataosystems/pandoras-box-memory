import { NextRequest } from "next/server";

function supabaseUrl() {
  const value = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!value) throw new Error("supabase_public_config_missing");
  return value.replace(/\/$/, "");
}

function protectedResourceUrl(request: NextRequest) {
  return `${request.nextUrl.origin}/.well-known/oauth-protected-resource/api/mcp`;
}

function unauthorized(request: NextRequest) {
  return new Response(JSON.stringify({ error: "unauthorized", reason: "missing_bearer" }), {
    status: 401,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "www-authenticate": `Bearer realm="pandora-memory", resource_metadata="${protectedResourceUrl(request)}"`,
    },
  });
}

async function proxy(request: NextRequest) {
  const authorization = request.headers.get("authorization");
  if (!authorization) return unauthorized(request);

  const upstream = `${supabaseUrl()}/functions/v1/pandora-machine-gateway`;
  const headers = new Headers();
  headers.set("authorization", authorization);
  headers.set("content-type", request.headers.get("content-type") || "application/json");
  const protocolVersion = request.headers.get("mcp-protocol-version");
  if (protocolVersion) headers.set("mcp-protocol-version", protocolVersion);

  const response = await fetch(upstream, {
    method: request.method,
    headers,
    body: request.method === "GET" || request.method === "HEAD" ? undefined : await request.text(),
    cache: "no-store",
  });

  const responseHeaders = new Headers();
  for (const name of ["content-type", "www-authenticate", "mcp-session-id"]) {
    const value = response.headers.get(name);
    if (value) responseHeaders.set(name, value);
  }
  responseHeaders.set("cache-control", "no-store");

  return new Response(await response.arrayBuffer(), {
    status: response.status,
    headers: responseHeaders,
  });
}

export async function GET(request: NextRequest) {
  return proxy(request);
}

export async function POST(request: NextRequest) {
  return proxy(request);
}
