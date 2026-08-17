// Regression tests for authentication-material gating at public web ingress.
//
// Full token verification remains at the Edge boundaries. These tests prove the
// web layer rejects malformed material before body reads and that no governed
// evidence route can regress to unbounded request.text() buffering.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  MAX_AUTH_TOKEN_LENGTH,
  bearerToken,
  normalizedBearerAuthorization,
  projectOSWorkloadToken,
} from "../../lib/http/auth-material.ts";

function headers(values = {}) {
  const normalized = new Map(
    Object.entries(values).map(([key, value]) => [key.toLowerCase(), value]),
  );
  return { get: (name) => normalized.get(name.toLowerCase()) ?? null };
}

function source(relativePath) {
  return readFileSync(new URL(`../../${relativePath}`, import.meta.url), "utf8");
}

function assertBefore(text, earlier, later, label) {
  const earlierIndex = text.indexOf(earlier);
  const laterIndex = text.indexOf(later);
  assert.notEqual(earlierIndex, -1, `${label}: missing ${earlier}`);
  assert.notEqual(laterIndex, -1, `${label}: missing ${later}`);
  assert.ok(earlierIndex < laterIndex, `${label}: ${earlier} must precede ${later}`);
}

test("bearer material accepts valid RFC 6750 syntax and normalizes the scheme", () => {
  const value = headers({ authorization: "bEaReR   eyJ.a-b_c.Z9==" });
  assert.equal(bearerToken(value), "eyJ.a-b_c.Z9==");
  assert.equal(normalizedBearerAuthorization(value), "Bearer eyJ.a-b_c.Z9==");
});

test("bearer material rejects Basic, arbitrary, ambiguous, and whitespace-bearing values", () => {
  for (const value of [
    null,
    "",
    "Basic abc",
    "Token abc",
    "Bearer",
    "Bearer abc def",
    "Bearer abc,def",
    "Bearer \"abc\"",
    "random",
  ]) {
    assert.equal(
      bearerToken(headers(value === null ? {} : { authorization: value })),
      null,
      `accepted ${String(value)}`,
    );
  }
});

test("oversized authentication material is rejected before forwarding", () => {
  const token = "a".repeat(MAX_AUTH_TOKEN_LENGTH + 1);
  assert.equal(bearerToken(headers({ authorization: `Bearer ${token}` })), null);
  assert.equal(projectOSWorkloadToken(headers({ "x-pandora-vercel-oidc": token })), null);
});

test("the dedicated ProjectOS workload header takes precedence and is bounded", () => {
  const value = headers({
    "x-pandora-vercel-oidc": "dedicated.header.token",
    authorization: "Bearer fallback.token.value",
  });
  assert.equal(projectOSWorkloadToken(value), "dedicated.header.token");
  assert.equal(
    projectOSWorkloadToken(headers({
      "x-pandora-vercel-oidc": "bad token",
      authorization: "Bearer fallback.token.value",
    })),
    null,
    "malformed dedicated material must fail closed rather than fall back",
  );
});

test("ProjectOS routes gate authentication material before consuming bodies", () => {
  const search = source("app/api/projectos/memory/search/route.ts");
  const evidence = source("app/api/projectos/memory/evidence-candidates/route.ts");

  assertBefore(
    search,
    "projectOSWorkloadToken(request.headers)",
    "readBounded(request, MAX_BODY_BYTES)",
    "search route",
  );
  assertBefore(
    evidence,
    "projectOSWorkloadToken(request.headers)",
    "readBounded(request, MAX_BODY_BYTES)",
    "evidence route",
  );
  assert.equal(evidence.includes("await request.text("), false, "evidence route must not buffer unbounded text");
});

test("the public MCP proxy rejects malformed bearer material before body reads", () => {
  const mcp = source("app/api/mcp/route.ts");
  assertBefore(
    mcp,
    "normalizedBearerAuthorization(request.headers)",
    "readBounded(request, MAX_REQUEST_BYTES)",
    "MCP route",
  );
  assert.equal(mcp.includes("if (!authorization) return unauthorized(request)"), true);
});
