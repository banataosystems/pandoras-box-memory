import {
  boundedInteger,
  boundedString,
  declaredLengthExceeds,
  readBoundedBody,
  readBoundedResponse,
  unknownFields,
} from "../_shared/request-limits.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEquals(actual: unknown, expected: unknown, message = "") {
  assert(
    actual === expected,
    `${message || "values differ"}: expected ${JSON.stringify(expected)}, got ${
      JSON.stringify(actual)
    }`,
  );
}

function assertArrayEquals(
  actual: unknown[],
  expected: unknown[],
  message = "",
) {
  assertEquals(JSON.stringify(actual), JSON.stringify(expected), message);
}

const LIMIT = 100;

function source(
  text: string,
  options: { contentLength?: string; chunkSize?: number; stream?: boolean } =
    {},
) {
  const { contentLength, chunkSize = 8, stream = true } = options;
  const bytes = new TextEncoder().encode(text);
  const headers = new Map<string, string>();
  if (contentLength !== undefined) headers.set("content-length", contentLength);

  return {
    headers: { get: (name: string) => headers.get(name) ?? null },
    body: stream
      ? new ReadableStream<Uint8Array>({
        start(controller) {
          for (let index = 0; index < bytes.length; index += chunkSize) {
            controller.enqueue(bytes.slice(index, index + chunkSize));
          }
          controller.close();
        },
      })
      : null,
    text: () => Promise.resolve(text),
  };
}

Deno.test("valid body under the limit is read exactly", async () => {
  const result = await readBoundedBody(source("hello world"), LIMIT);
  assertEquals(result.ok, true);
  if (result.ok) {
    assertEquals(result.text, "hello world");
    assertEquals(result.bytes, 11);
  }
});

Deno.test("a body with no content-length is still metered", async () => {
  const result = await readBoundedBody(source("x".repeat(LIMIT + 1)), LIMIT);
  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.reason, "actual_too_large");
});

Deno.test("exactly at the limit is accepted", async () => {
  const result = await readBoundedBody(source("y".repeat(LIMIT)), LIMIT);
  assertEquals(result.ok, true);
  if (result.ok) assertEquals(result.bytes, LIMIT);
});

Deno.test("one byte over the limit is rejected", async () => {
  const result = await readBoundedBody(source("y".repeat(LIMIT + 1)), LIMIT);
  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.reason, "actual_too_large");
});

Deno.test("an oversized declared length is rejected before reading", async () => {
  const result = await readBoundedBody(
    source("small", { contentLength: "999999" }),
    LIMIT,
  );
  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.reason, "declared_too_large");
});

Deno.test("an understated content-length does not defeat the real limit", async () => {
  const result = await readBoundedBody(
    source("z".repeat(LIMIT + 50), { contentLength: "5" }),
    LIMIT,
  );
  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.reason, "actual_too_large");
});

Deno.test("chunked / unknown-length transfer is bounded", async () => {
  const result = await readBoundedBody(
    source("q".repeat(LIMIT + 20), { chunkSize: 1 }),
    LIMIT,
  );
  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.reason, "actual_too_large");
});

Deno.test("a non-streaming source still enforces the limit", async () => {
  const over = await readBoundedBody(
    source("w".repeat(LIMIT + 1), { stream: false }),
    LIMIT,
  );
  assertEquals(over.ok, false);

  const under = await readBoundedBody(source("ok", { stream: false }), LIMIT);
  assertEquals(under.ok, true);
});

Deno.test("multibyte characters are counted in bytes", async () => {
  const text = "€".repeat(40); // 40 x 3 bytes = 120 > LIMIT
  const result = await readBoundedBody(source(text), LIMIT);
  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.reason, "actual_too_large");
});

Deno.test("a failing stream reports read_failed", async () => {
  const result = await readBoundedBody({
    headers: { get: () => null },
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("partial"));
        controller.error(new Error("connection reset"));
      },
    }),
    text: () => Promise.resolve(""),
  }, LIMIT);
  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.reason, "read_failed");
});

Deno.test("an oversized upstream response is bounded", async () => {
  const result = await readBoundedResponse(
    source("u".repeat(LIMIT + 1)),
    LIMIT,
  );
  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.reason, "actual_too_large");
});

Deno.test("an upstream response declaring an oversized length is rejected", async () => {
  const result = await readBoundedResponse(
    source("small", { contentLength: "999999" }),
    LIMIT,
  );
  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.reason, "declared_too_large");
});

Deno.test("declaredLengthExceeds ignores missing and malformed headers", () => {
  assertEquals(declaredLengthExceeds(null, LIMIT), false);
  assertEquals(declaredLengthExceeds("", LIMIT), false);
  assertEquals(declaredLengthExceeds("abc", LIMIT), false);
  assertEquals(declaredLengthExceeds("-5", LIMIT), false);
  assertEquals(declaredLengthExceeds("1e9", LIMIT), false);
  assertEquals(declaredLengthExceeds(String(LIMIT), LIMIT), false);
  assertEquals(declaredLengthExceeds(String(LIMIT + 1), LIMIT), true);
});

Deno.test("boundedInteger rejects every NaN-producing input", () => {
  const options = { min: 1, max: 20, fallback: 10 };
  const rejected: unknown[] = ["abc", "", " ", "NaN", {}, [], true, false];
  for (const value of rejected) {
    assertEquals(boundedInteger(value, options), null);
  }
  assertEquals(boundedInteger(Number.NaN, options), null);
  assertEquals(boundedInteger(Infinity, options), null);
  assertEquals(boundedInteger(-Infinity, options), null);
});

Deno.test("boundedInteger rejects non-integers and out-of-range values", () => {
  const options = { min: 1, max: 20, fallback: 10 };
  assertEquals(boundedInteger(1.5, options), null);
  assertEquals(boundedInteger("1.5", options), null);
  assertEquals(boundedInteger("1e3", options), null);
  assertEquals(boundedInteger(0, options), null);
  assertEquals(boundedInteger(21, options), null);
});

Deno.test("boundedInteger accepts valid input and defaults only when absent", () => {
  const options = { min: 1, max: 20, fallback: 10 };
  assertEquals(boundedInteger(1, options), 1);
  assertEquals(boundedInteger(20, options), 20);
  assertEquals(boundedInteger("7", options), 7);
  assertEquals(boundedInteger(undefined, options), 10);
  assertEquals(boundedInteger(null, options), 10);
});

Deno.test("boundedString trims, rejects empty, and rejects over-length", () => {
  assertEquals(boundedString("  hello  ", 10), "hello");
  assertEquals(boundedString("", 10), null);
  assertEquals(boundedString("   ", 10), null);
  assertEquals(boundedString("x".repeat(11), 10), null);
  assertEquals(boundedString(42, 10), null);
  assertEquals(boundedString(null, 10), null);
});

Deno.test("unknownFields reports exactly the disallowed keys", () => {
  const allowed = new Set(["query", "limit"]);
  assertArrayEquals(unknownFields({ query: "a" }, allowed), []);
  assertArrayEquals(unknownFields({ query: "a", nope: 1 }, allowed), ["nope"]);
});
