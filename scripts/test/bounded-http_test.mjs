// Boundary tests for the web-side bounded reader.
//
// The Deno mirror (supabase/functions/pandora-machine-gateway/request-limits_test.ts)
// asserts the same cases against the Edge implementation, so the two stay
// aligned even though they are separate files for deployment reasons.

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  boundedInteger,
  declaredLengthExceeds,
  readBounded,
  unknownFields,
} from "../../lib/http/bounded.ts";

const LIMIT = 100;

/** A Request-like source whose body arrives in chunks of the given size. */
function source(text, { contentLength, chunkSize = 8, stream = true } = {}) {
  const bytes = new TextEncoder().encode(text);
  const headers = new Map();
  if (contentLength !== undefined) headers.set("content-length", contentLength);

  return {
    headers: { get: (name) => headers.get(name) ?? null },
    body: stream
      ? new ReadableStream({
        start(controller) {
          for (let index = 0; index < bytes.length; index += chunkSize) {
            controller.enqueue(bytes.slice(index, index + chunkSize));
          }
          controller.close();
        },
      })
      : null,
    text: async () => text,
  };
}

test("valid body under the limit is read exactly", async () => {
  const result = await readBounded(source("hello world"), LIMIT);
  assert.equal(result.ok, true);
  assert.equal(result.text, "hello world");
  assert.equal(result.bytes, 11);
});

test("a body with no content-length is still metered", async () => {
  const oversized = "x".repeat(LIMIT + 1);
  const result = await readBounded(source(oversized), LIMIT);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "actual_too_large");
});

test("exactly at the limit is accepted", async () => {
  const result = await readBounded(source("y".repeat(LIMIT)), LIMIT);
  assert.equal(result.ok, true);
  assert.equal(result.bytes, LIMIT);
});

test("one byte over the limit is rejected", async () => {
  const result = await readBounded(source("y".repeat(LIMIT + 1)), LIMIT);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "actual_too_large");
});

test("an oversized declared length is rejected before reading", async () => {
  const result = await readBounded(source("small", { contentLength: "999999" }), LIMIT);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "declared_too_large");
});

test("an understated content-length does not defeat the real limit", async () => {
  // The header claims 5 bytes; the body is far larger. This is the case that a
  // header-only check misses entirely.
  const result = await readBounded(
    source("z".repeat(LIMIT + 50), { contentLength: "5" }),
    LIMIT,
  );
  assert.equal(result.ok, false);
  assert.equal(result.reason, "actual_too_large");
});

test("chunked / unknown-length transfer is bounded", async () => {
  const result = await readBounded(
    source("q".repeat(LIMIT + 20), { chunkSize: 1 }),
    LIMIT,
  );
  assert.equal(result.ok, false);
  assert.equal(result.reason, "actual_too_large");
});

test("a non-streaming source still enforces the limit", async () => {
  const over = await readBounded(source("w".repeat(LIMIT + 1), { stream: false }), LIMIT);
  assert.equal(over.ok, false);
  assert.equal(over.reason, "actual_too_large");

  const under = await readBounded(source("ok", { stream: false }), LIMIT);
  assert.equal(under.ok, true);
  assert.equal(under.text, "ok");
});

test("multibyte characters are counted in bytes, not code units", async () => {
  // 40 x 3-byte characters = 120 bytes, over a 100-byte limit, though the
  // JavaScript string length is only 40.
  const text = "€".repeat(40);
  assert.ok(text.length < LIMIT);
  const result = await readBounded(source(text), LIMIT);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "actual_too_large");
});

test("a failing stream reports read_failed rather than a partial body", async () => {
  const result = await readBounded({
    headers: { get: () => null },
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("partial"));
        controller.error(new Error("connection reset"));
      },
    }),
    text: async () => "",
  }, LIMIT);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "read_failed");
});

test("declaredLengthExceeds ignores missing and malformed headers", () => {
  assert.equal(declaredLengthExceeds(null, LIMIT), false);
  assert.equal(declaredLengthExceeds("", LIMIT), false);
  assert.equal(declaredLengthExceeds("abc", LIMIT), false);
  assert.equal(declaredLengthExceeds("-5", LIMIT), false);
  assert.equal(declaredLengthExceeds("1e9", LIMIT), false);
  assert.equal(declaredLengthExceeds(String(LIMIT), LIMIT), false);
  assert.equal(declaredLengthExceeds(String(LIMIT + 1), LIMIT), true);
});

// --- numeric validation ----------------------------------------------------

test("boundedInteger rejects every NaN-producing input", () => {
  const options = { min: 1, max: 20, fallback: 10 };
  // This is the exact defect: Number("abc") is NaN, and
  // Math.max(1, Math.min(20, NaN)) is NaN, which reached the query as limit=NaN.
  for (const value of ["abc", "", " ", "NaN", {}, [], true, false, () => {}]) {
    assert.equal(boundedInteger(value, options), null, `accepted ${String(value)}`);
  }
  assert.equal(boundedInteger(Number.NaN, options), null);
  assert.equal(boundedInteger(Infinity, options), null);
  assert.equal(boundedInteger(-Infinity, options), null);
});

test("boundedInteger rejects non-integers and out-of-range values", () => {
  const options = { min: 1, max: 20, fallback: 10 };
  assert.equal(boundedInteger(1.5, options), null);
  assert.equal(boundedInteger("1.5", options), null);
  assert.equal(boundedInteger("1e3", options), null);
  assert.equal(boundedInteger(0, options), null, "below min must reject, not clamp");
  assert.equal(boundedInteger(21, options), null, "above max must reject, not clamp");
  assert.equal(boundedInteger(-1, options), null);
});

test("boundedInteger accepts valid input and defaults only when absent", () => {
  const options = { min: 1, max: 20, fallback: 10 };
  assert.equal(boundedInteger(1, options), 1);
  assert.equal(boundedInteger(20, options), 20);
  assert.equal(boundedInteger("7", options), 7);
  assert.equal(boundedInteger(" 7 ", options), 7);
  assert.equal(boundedInteger(undefined, options), 10);
  assert.equal(boundedInteger(null, options), 10);
  // 0 is a real supplied value, not an absent one, so it must not fall back.
  assert.equal(boundedInteger(0, { min: 0, max: 20, fallback: 10 }), 0);
});

test("unknownFields reports exactly the disallowed keys", () => {
  const allowed = new Set(["query", "max_items"]);
  assert.deepEqual(unknownFields({ query: "a" }, allowed), []);
  assert.deepEqual(
    unknownFields({ query: "a", maxItems: 5, __proto__x: 1 }, allowed).sort(),
    ["__proto__x", "maxItems"],
  );
});
