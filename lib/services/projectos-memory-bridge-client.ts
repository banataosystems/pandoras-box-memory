import { NextResponse, type NextRequest } from "next/server";

const MAX_RESPONSE_BYTES = 500_000;
const TIMEOUT_MS = 8_000;

// Security boundary: ProjectOS traffic must always reach the canonical
// Pandoras-Box Memory Supabase project. Do not make this endpoint environment-
// overridable; a stale or foreign NEXT_PUBLIC_SUPABASE_URL must not redirect
// production service-principal authentication to another project.
const BRIDGE_URL =
  "https://ivmvufhcsezyhczzondn.supabase.co/functions/v1/pandora-projectos-bridge";

function workloadToken(request: NextRequest) {
  const dedicated = request.headers.get("x-pandora-vercel-oidc")?.trim();
  if (dedicated) return dedicated;
  const authorization = request.headers.get("authorization") ?? "";
  const [scheme, token] = authorization.split(" ");
  return scheme?.toLowerCase() === "bearer" && token ? token : null;
}

async function readBounded(response: Response) {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
    throw new Error("response_too_large");
  }

  const reader = response.body?.getReader();
  if (!reader) {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BYTES) {
      throw new Error("response_too_large");
    }
    return text;
  }

  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) {
        await reader.cancel("response_too_large");
        throw new Error("response_too_large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

export async function proxyProjectOSMemoryRequest(
  request: NextRequest,
  payload: Record<string, unknown>,
) {
  const token = workloadToken(request);
  if (!token) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(BRIDGE_URL, {
      method: "POST",
      cache: "no-store",
      redirect: "error",
      headers: {
        // Supabase reserves Authorization for its gateway. Carry the bounded
        // Vercel workload token in a dedicated internal header so the custom-
        // auth Edge boundary receives it byte-for-byte.
        "x-pandora-vercel-oidc": token,
        accept: "application/json",
        "content-type": "application/json",
        "user-agent": "Pandora-Memory-ProjectOS-Proxy/1.2",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const text = await readBounded(response);
    return new NextResponse(
      text || JSON.stringify({ ok: false, error: "empty_bridge_response" }),
      {
        status: response.status,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store",
        },
      },
    );
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "AbortError";
    return NextResponse.json(
      { ok: false, error: timedOut ? "bridge_timeout" : "bridge_unavailable" },
      { status: 503 },
    );
  } finally {
    clearTimeout(timeout);
  }
}
