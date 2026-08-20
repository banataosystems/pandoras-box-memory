// Byte-accurate request/response bounds for the Next.js boundary.
//
// This mirrors supabase/functions/_shared/request-limits.ts. The two are
// deliberately separate files rather than one shared module: the Edge Functions
// deploy to Deno from supabase/functions and the web app builds from the
// repository root, and tsconfig excludes supabase/functions from the Next.js
// program. Importing across that line would either break the Edge deployment
// bundle or drag Deno-targeted source into the web build.
//
// Behavior is kept aligned by lib/http/bounded_test.mjs and
// supabase/functions/pandora-machine-gateway/request-limits_test.ts asserting
// the same cases against each implementation.

export type BoundedRead =
  | { ok: true; text: string; bytes: number }
  | { ok: false; reason: "declared_too_large" | "actual_too_large" | "read_failed" };

/**
 * Fast rejection on a declared `Content-Length` that already exceeds the limit.
 *
 * A missing or malformed header returns false: it is not evidence that the body
 * is small, so the caller must still meter the real bytes.
 */
export function declaredLengthExceeds(
  header: string | null,
  maxBytes: number,
): boolean {
  if (header === null) return false;
  const trimmed = header.trim();
  if (!/^\d+$/.test(trimmed)) return false;
  const declared = Number(trimmed);
  return Number.isFinite(declared) && declared > maxBytes;
}

type StreamSource = {
  headers: { get(name: string): string | null };
  body: ReadableStream<Uint8Array> | null;
  text(): Promise<string>;
};

/**
 * Read a body while counting actual bytes, cancelling past the limit.
 *
 * Never calls `.text()`/`.arrayBuffer()` on a streamable source, so an
 * oversized payload is rejected without being fully buffered first.
 */
export async function readBounded(
  source: StreamSource,
  maxBytes: number,
  { checkDeclared = true }: { checkDeclared?: boolean } = {},
): Promise<BoundedRead> {
  if (
    checkDeclared &&
    declaredLengthExceeds(source.headers.get("content-length"), maxBytes)
  ) {
    return { ok: false, reason: "declared_too_large" };
  }

  const stream = source.body;
  if (!stream) {
    try {
      const text = await source.text();
      const bytes = new TextEncoder().encode(text).byteLength;
      if (bytes > maxBytes) return { ok: false, reason: "actual_too_large" };
      return { ok: true, text, bytes };
    } catch {
      return { ok: false, reason: "read_failed" };
    }
  }

  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel("too_large").catch(() => {});
        return { ok: false, reason: "actual_too_large" };
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false, reason: "read_failed" };
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // Already released by cancel().
    }
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, text: new TextDecoder().decode(merged), bytes: total };
}

/**
 * Parse an externally supplied integer, rejecting anything that is not a finite
 * in-range integer. Out-of-range values are rejected, not clamped.
 */
export function boundedInteger(
  value: unknown,
  options: { min: number; max: number; fallback: number },
): number | null {
  const { min, max, fallback } = options;
  if (value === undefined || value === null) return fallback;

  let parsed: number;
  if (typeof value === "number") {
    parsed = value;
  } else if (typeof value === "string") {
    const trimmed = value.trim();
    if (!/^-?\d+$/.test(trimmed)) return null;
    parsed = Number(trimmed);
  } else {
    return null;
  }

  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) return null;
  if (parsed < min || parsed > max) return null;
  return parsed;
}

/** Keys present on `body` that are not in the allowlist. */
export function unknownFields(
  body: Record<string, unknown>,
  allowed: ReadonlySet<string>,
): string[] {
  return Object.keys(body).filter((key) => !allowed.has(key));
}
