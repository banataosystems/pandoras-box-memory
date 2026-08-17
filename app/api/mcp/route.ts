import { NextRequest } from "next/server";

import { declaredLengthExceeds, readBounded } from "@/lib/http/bounded";

export const dynamic = "force-dynamic";

// This route is publicly reachable. Before these limits it read the whole
// request with `request.text()` and the whole upstream reply with
// `response.arrayBuffer()`, neither of which had any ceiling, and it applied no
// timeout. A caller only had to present *some* Authorization header to make the
// proxy buffer an arbitrary amount of memory.
const MAX_REQUEST_BYTES = 64 * 1024;
const MAX_UPSTREAM_BYTES = 512 * 1024;
const UPSTREAM_TIMEOUT_MS = 10_000;

function supabaseUrl() {
  const value = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!value) throw new Error("supabase_public_config_missing");
  return value.replace(/\/$/, "");
}

function protectedResourceUrl(request: NextRequest) {
  return `${request.nextUrl.origin}/.well-known/oauth-protected-resource/api/mcp`;
}

/** Deterministic, bounded error body. Never echoes upstream content. */
function error(status: number, reason: string, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify({ error: "proxy_error", reason }), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...headers,
    },
  });
}

function unauthorized(request: NextRequest) {
  return new Response(
    JSON.stringify({ error: "unauthorized", reason: "missing_bearer" }),
    {
      status: 401,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
        "www-authenticate":
          `Bearer realm="pandora-memory", resource_metadata="${protectedResourceUrl(request)}"`,
      },
    },
  );
}

async function proxy(request: NextRequest) {
  const authorization = request.headers.get("authorization");
  // Authentication material is required before the proxy will read or forward
  // any body, so an unauthenticated caller cannot make this route buffer.
  if (!authorization) return unauthorized(request);

  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  let payload = "";

  if (hasBody) {
    if (declaredLengthExceeds(request.headers.get("content-length"), MAX_REQUEST_BYTES)) {
      return error(413, "request_too_large");
    }
    const bounded = await readBounded(request, MAX_REQUEST_BYTES);
    if (!bounded.ok) {
      return bounded.reason === "read_failed"
        ? error(400, "request_read_failed")
        : error(413, "request_too_large");
    }
    payload = bounded.text;
  }

  const headers = new Headers();
  headers.set("authorization", authorization);
  headers.set("content-type", request.headers.get("content-type") || "application/json");
  const protocolVersion = request.headers.get("mcp-protocol-version");
  if (protocolVersion) headers.set("mcp-protocol-version", protocolVersion);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

  try {
    const response = await fetch(
      `${supabaseUrl()}/functions/v1/pandora-machine-gateway`,
      {
        method: request.method,
        headers,
        body: hasBody ? payload : undefined,
        cache: "no-store",
        redirect: "error",
        signal: controller.signal,
      },
    );

    const bounded = await readBounded(response, MAX_UPSTREAM_BYTES);
    if (!bounded.ok) {
      // Do not reflect an oversized or unreadable upstream body. The caller gets
      // a bounded, constant-size error instead of whatever the upstream sent.
      return error(502, "upstream_response_too_large");
    }

    const responseHeaders = new Headers();
    for (const name of ["content-type", "www-authenticate", "mcp-session-id"]) {
      const value = response.headers.get(name);
      if (value) responseHeaders.set(name, value);
    }
    responseHeaders.set("cache-control", "no-store");

    return new Response(bounded.text, {
      status: response.status,
      headers: responseHeaders,
    });
  } catch (caught) {
    const timedOut = caught instanceof Error && caught.name === "AbortError";
    return error(504, timedOut ? "upstream_timeout" : "upstream_unavailable");
  } finally {
    clearTimeout(timeout);
  }
}

export async function GET(request: NextRequest) {
  return proxy(request);
}

export async function POST(request: NextRequest) {
  return proxy(request);
}
