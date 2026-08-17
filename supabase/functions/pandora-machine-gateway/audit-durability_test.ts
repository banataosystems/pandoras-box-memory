import { mustFailClosed } from "../_shared/audit-policy.ts";

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

function assertStringIncludes(haystack: string, needle: string, message = "") {
  assert(haystack.includes(needle), message || `expected source to include ${needle}`);
}

const GATEWAY = new URL("./index.ts", import.meta.url);

Deno.test("an allow decision fails closed when audit is not durable", () => {
  assertEquals(
    mustFailClosed("audit_required_fail_closed", "allow", false),
    true,
  );
});

Deno.test("an allow decision proceeds when audit is durable", () => {
  assertEquals(
    mustFailClosed("audit_required_fail_closed", "allow", true),
    false,
  );
});

Deno.test("a denial is never blocked by an audit failure", () => {
  // An audit outage must not be able to weaken authorization, and there is
  // nothing to withhold on a denial.
  assertEquals(mustFailClosed("audit_required_fail_closed", "deny", false), false);
  assertEquals(mustFailClosed("audit_required_fail_closed", "error", false), false);
});

Deno.test("non-governed classes never fail closed", () => {
  assertEquals(mustFailClosed("informational", "allow", false), false);
  assertEquals(mustFailClosed("completion_first_outbox", "allow", false), false);
});

// Source-level assertions binding the deployed gateway to the contract. These
// catch a regression that reintroduces the discarded-error pattern even if no
// behavioral test happens to cover that call site.
Deno.test("gateway audit reads the Supabase error instead of discarding it", async () => {
  const source = await Deno.readTextFile(GATEWAY);
  assertStringIncludes(
    source,
    'const { error } = await admin.from("gateway_audit_events").insert(',
    "the audit insert must destructure and inspect the returned error",
  );
});

Deno.test("gateway allow paths fail closed on audit persistence failure", async () => {
  const source = await Deno.readTextFile(GATEWAY);
  assertStringIncludes(source, "audit_persistence_failed");
  // Both tool paths must be covered, not just one.
  const occurrences = source.split("audit_persistence_failed").length - 1;
  assertEquals(occurrences >= 2, true, "both memory_health and memory_search must fail closed");
});

Deno.test("gateway audit failure logging does not echo error content", async () => {
  const source = await Deno.readTextFile(GATEWAY);
  assertEquals(
    source.includes("gateway_audit_persist_failed"),
    true,
    "audit failures must log a classification string",
  );
  assertEquals(
    /console\.error\([^)]*error\.message/.test(source),
    false,
    "audit/error handlers must not log Supabase error message text",
  );
});
