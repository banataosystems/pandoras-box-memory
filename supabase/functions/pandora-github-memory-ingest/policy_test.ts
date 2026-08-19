import type { JWTPayload } from "jose";

import {
  canonicalSnapshotPayload,
  exactAudience,
  GITHUB_OIDC_AUDIENCE,
  GITHUB_OIDC_ISSUER,
  MAX_PARENT_SHAS,
  type GithubSourcePrincipal,
  unverifiedLookup,
  validateProviderCommit,
  validateVerifiedGithubClaims,
} from "./policy.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEquals(actual: unknown, expected: unknown, message: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${message}: expected ${e}, got ${a}`);
}

const principal: GithubSourcePrincipal = {
  principal_key: "github-pandora-memory-main",
  oidc_issuer: GITHUB_OIDC_ISSUER,
  oidc_audience: GITHUB_OIDC_AUDIENCE,
  oidc_subject: "repo:banataosystems/pandoras-box-memory:ref:refs/heads/main",
  repository: "banataosystems/pandoras-box-memory",
  repository_id: 1327294429,
  repository_owner: "banataosystems",
  repository_owner_id: 314296438,
  allowed_ref: "refs/heads/main",
  workflow_ref:
    "banataosystems/pandoras-box-memory/.github/workflows/github-memory-source-sync.yml@refs/heads/main",
  memory_namespace: "au",
  is_active: true,
};

const sourceSha = "1".repeat(40);
const treeSha = "2".repeat(40);
const parentSha = "3".repeat(40);

function claims(overrides: Record<string, unknown> = {}): JWTPayload {
  return {
    iss: GITHUB_OIDC_ISSUER,
    aud: GITHUB_OIDC_AUDIENCE,
    sub: principal.oidc_subject,
    repository: principal.repository,
    repository_id: String(principal.repository_id),
    repository_owner: principal.repository_owner,
    repository_owner_id: String(principal.repository_owner_id),
    ref: principal.allowed_ref,
    job_workflow_ref: principal.workflow_ref,
    sha: sourceSha,
    event_name: "push",
    run_id: "123456789",
    run_attempt: "1",
    ...overrides,
  };
}

Deno.test("accepts the exact allowlisted signed GitHub identity", () => {
  const identity = validateVerifiedGithubClaims(claims(), principal);
  assert(identity, "expected exact identity to be accepted");
  assertEquals(identity.repository, principal.repository, "repository must bind exactly");
  assertEquals(identity.sourceSha, sourceSha, "source SHA must bind exactly");
  assertEquals(identity.namespace, "au", "namespace must come from the principal");
});

for (const [name, override] of [
  ["issuer", { iss: "https://example.invalid" }],
  ["audience", { aud: "wrong-audience" }],
  ["subject", { sub: "repo:banataosystems/pandoras-box-memory:pull_request" }],
  ["repository", { repository: "banataosystems/Pandoras-box" }],
  ["repository id", { repository_id: "1" }],
  ["owner", { repository_owner: "someone-else" }],
  ["owner id", { repository_owner_id: "1" }],
  ["ref", { ref: "refs/heads/feature" }],
  ["workflow ref", { job_workflow_ref: "other/workflow.yml@refs/heads/main" }],
  ["source sha", { sha: "deadbeef" }],
  ["event", { event_name: "pull_request" }],
] as Array<[string, Record<string, unknown>]>) {
  Deno.test(`rejects wrong ${name}`, () => {
    assert(
      validateVerifiedGithubClaims(claims(override), principal) === null,
      `wrong ${name} must fail closed`,
    );
  });
}

Deno.test("rejects an inactive principal", () => {
  assert(
    validateVerifiedGithubClaims(claims(), { ...principal, is_active: false }) === null,
    "inactive principal must fail closed",
  );
});

Deno.test("requires one exact OIDC audience", () => {
  assertEquals(exactAudience({ aud: [GITHUB_OIDC_AUDIENCE] }), GITHUB_OIDC_AUDIENCE, "single audience");
  assert(exactAudience({ aud: [GITHUB_OIDC_AUDIENCE, "extra"] }) === null, "multiple audiences must fail");
  assert(unverifiedLookup({ iss: GITHUB_OIDC_ISSUER, aud: [], sub: principal.oidc_subject }) === null, "empty audience must fail");
});

Deno.test("accepts exact public Git commit identity", () => {
  const commit = validateProviderCommit(sourceSha, {
    sha: sourceSha,
    tree: { sha: treeSha },
    parents: [{ sha: parentSha }],
  });
  assert(commit, "valid provider commit must be accepted");
  assertEquals(commit.sourceTreeSha, treeSha, "tree must bind exactly");
  assertEquals(commit.parentShas, [parentSha], "parents must bind exactly");
});

Deno.test("rejects provider commit substitution", () => {
  assert(
    validateProviderCommit(sourceSha, {
      sha: "4".repeat(40),
      tree: { sha: treeSha },
      parents: [{ sha: parentSha }],
    }) === null,
    "wrong commit SHA must fail",
  );
});

Deno.test("rejects malformed tree and parents", () => {
  assert(
    validateProviderCommit(sourceSha, {
      sha: sourceSha,
      tree: { sha: "bad" },
      parents: [{ sha: parentSha }],
    }) === null,
    "bad tree must fail",
  );
  assert(
    validateProviderCommit(sourceSha, {
      sha: sourceSha,
      tree: { sha: treeSha },
      parents: [{ sha: "bad" }],
    }) === null,
    "bad parent must fail",
  );
  assert(
    validateProviderCommit(sourceSha, {
      sha: sourceSha,
      tree: { sha: treeSha },
      parents: Array.from({ length: MAX_PARENT_SHAS + 1 }, (_, index) => ({
        sha: index.toString(16).padStart(40, "0"),
      })),
    }) === null,
    "too many parents must fail",
  );
  assert(
    validateProviderCommit(sourceSha, {
      sha: sourceSha,
      tree: { sha: treeSha },
      parents: [{ sha: parentSha }, { sha: parentSha }],
    }) === null,
    "duplicate parents must fail",
  );
});

Deno.test("snapshot digest input is replay-stable and excludes run metadata", () => {
  const identity = validateVerifiedGithubClaims(claims(), principal);
  const replayIdentity = validateVerifiedGithubClaims(
    claims({ run_id: "999999999", run_attempt: "7", event_name: "workflow_dispatch" }),
    principal,
  );
  const commit = validateProviderCommit(sourceSha, {
    sha: sourceSha,
    tree: { sha: treeSha },
    parents: [{ sha: parentSha }],
  });
  assert(identity && replayIdentity && commit, "fixtures must be valid");
  assertEquals(
    canonicalSnapshotPayload(identity, commit),
    canonicalSnapshotPayload(replayIdentity, commit),
    "workflow replay metadata must not change the immutable snapshot",
  );
  const payload = canonicalSnapshotPayload(identity, commit) as Record<string, unknown>;
  assert(!("workflow_run_id" in payload), "run id must not be content-addressed");
  assert(!("observed_at" in payload), "observation time must not be content-addressed");
});
