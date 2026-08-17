// Byte-accurate request/response bounds and numeric validation.
//
// The defects this module closes:
//
//   1. Boundaries trusted the declared `Content-Length` header and nothing else.
//      A request with no `Content-Length`, or a chunked request, or a request
//      whose header understates the real body, was parsed without any actual
//      byte limit. `Number(req.headers.get("content-length") || "0")` yields 0
//      for a missing header, which passes every size check.
//
//   2. `Number(args.limit || 10)` produces NaN for non-numeric input, and
//      `Math.max(1, Math.min(20, NaN))` is NaN — which then propagated into the
//      downstream query as `limit=NaN`.
//
// Everything here is pure and runtime-agnostic so it can be tested directly
// against the same code the Edge Function runs.

/** A Request- or Response-shaped source that can be metered while reading. */
export type StreamSource = {
  headers: { get(name: string): string | null };
  body: ReadableStream<Uint8Array> | null;
  text(): Promise<string>;
};

/** Outcome of reading a bounded body. */
export type BoundedBody =
  | { ok: true; text: string; bytes: number }
  | { ok: false; reason: "declared_too_large" | "actual_too_large" | "read_failed" };

/**
 * Reject early on a declared length that already exceeds the limit.
 *
 * This is a fast path only. A missing, malformed, or understated header must
 * never be treated as evidence that the body is small, so anything other than a
 * finite over-limit number returns `false` and the caller still enforces the
 * real limit while reading.
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

/**
 * Read a request body while counting actual bytes, aborting past the limit.
 *
 * Reads through the stream rather than calling `.text()` so an oversized body is
 * rejected without ever being fully buffered. Works identically for
 * `Content-Length`, chunked, and absent-length requests, because it never
 * consults the header for the decision.
 */
export async function readBoundedBody(
  request: StreamSource,
  maxBytes: number,
): Promise<BoundedBody> {
  if (declaredLengthExceeds(request.headers.get("content-length"), maxBytes)) {
    return { ok: false, reason: "declared_too_large" };
  }

  const stream = request.body;
  if (!stream) {
    // No stream to meter: fall back to buffering, then enforce the real limit.
    try {
      const text = await request.text();
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
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel("payload_too_large").catch(() => {});
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
      // Lock already released by cancel(); nothing to do.
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

/** Outcome of reading a bounded upstream response. */
export type BoundedResponse =
  | { ok: true; text: string; bytes: number }
  | { ok: false; reason: "declared_too_large" | "actual_too_large" | "read_failed" };

/**
 * Buffer an upstream response under a hard byte ceiling.
 *
 * A proxy that calls `response.arrayBuffer()` inherits whatever size the
 * upstream chooses to send. This meters the stream instead and cancels past the
 * limit, so a misbehaving or compromised upstream cannot exhaust the proxy.
 */
export async function readBoundedResponse(
  response: StreamSource,
  maxBytes: number,
): Promise<BoundedResponse> {
  if (declaredLengthExceeds(response.headers.get("content-length"), maxBytes)) {
    return { ok: false, reason: "declared_too_large" };
  }
  return await readBoundedBody(
    {
      headers: { get: () => null },
      body: response.body,
      text: () => response.text(),
    },
    maxBytes,
  );
}

/**
 * Parse an externally supplied integer, rejecting anything that is not a
 * finite in-range integer.
 *
 * Deliberately strict rather than coercive:
 *   - `undefined`/`null` yield the caller's default (an absent optional field).
 *   - `"abc"`, `NaN`, `Infinity`, `1.5`, `"1e3"`, `true`, `[]`, `{}` are rejected.
 *   - Out-of-range values are rejected, never clamped. Clamping silently
 *     services a request the caller did not make.
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
    // Plain decimal integers only: no hex, exponent, whitespace-only, or "".
    if (!/^-?\d+$/.test(trimmed)) return null;
    parsed = Number(trimmed);
  } else {
    return null;
  }

  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) return null;
  if (parsed < min || parsed > max) return null;
  return parsed;
}

/**
 * Validate an externally supplied string against a maximum length.
 *
 * Returns the trimmed value, or null when absent, non-string, empty after
 * trimming, or over the limit. Over-length input is rejected, not truncated —
 * truncation silently changes the meaning of a query.
 */
export function boundedString(
  value: unknown,
  maxLength: number,
): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength) return null;
  return trimmed;
}

/**
 * Reject request objects carrying fields outside the allowlist.
 *
 * Returns the offending key names. An empty array means the object is clean.
 */
export function unknownFields(
  body: Record<string, unknown>,
  allowed: ReadonlySet<string>,
): string[] {
  return Object.keys(body).filter((key) => !allowed.has(key));
}
