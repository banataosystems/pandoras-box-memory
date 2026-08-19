import type { JWTPayload } from "jose";

export const GITHUB_OIDC_ISSUER = "https://token.actions.githubusercontent.com";
export const GITHUB_OIDC_AUDIENCE = "pandora-memory-github-v1";
export const MAX_PARENT_SHAS = 8;

const SHA40 = /^[0-9a-f]{40}$/;
const DECIMAL = /^\d+$/;

export type GithubSourcePrincipal = {
  principal_key: string;
  oidc_issuer: string;
  oidc_audience: string;
  oidc_subject: string;
  repository: string;
  repository_id: string | number;
  repository_owner: string;
  repository_owner_id: string | number;
  allowed_ref: string;
  workflow_ref: string;
  memory_namespace: string;
  is_active: boolean;
};

export type GithubSourceIdentity = {
  principalKey: string;
  namespace: string;
  repository: string;
  repositoryId: string;
  repositoryOwner: string;
  repositoryOwnerId: string;
  ref: string;
  workflowRef: string;
  sourceSha: string;
  eventName: "push" | "workflow_dispatch";
  workflowRunId: string | null;
  workflowRunAttempt: number | null;
};

export type GithubProviderCommit = {
  sourceSha: string;
  sourceTreeSha: string;
  parentShas: string[];
};

const claimText = (value: unknown): string | null => {
  if (typeof value === "string" && value.length > 0) return value;
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return String(value);
  }
  return null;
};

export const exactAudience = (payload: JWTPayload): string | null => {
  if (Array.isArray(payload.aud)) {
    return payload.aud.length === 1 && typeof payload.aud[0] === "string"
      ? payload.aud[0]
      : null;
  }
  return typeof payload.aud === "string" ? payload.aud : null;
};

export function unverifiedLookup(payload: JWTPayload) {
  const issuer = typeof payload.iss === "string" ? payload.iss : null;
  const audience = exactAudience(payload);
  const subject = typeof payload.sub === "string" ? payload.sub : null;
  if (!issuer || !audience || !subject) return null;
  return { issuer, audience, subject };
}

export function validateVerifiedGithubClaims(
  payload: JWTPayload,
  principal: GithubSourcePrincipal,
): GithubSourceIdentity | null {
  if (!principal.is_active) return null;
  if (payload.iss !== principal.oidc_issuer) return null;
  if (exactAudience(payload) !== principal.oidc_audience) return null;
  if (payload.sub !== principal.oidc_subject) return null;

  const repository = claimText(payload.repository);
  const repositoryId = claimText(payload.repository_id);
  const repositoryOwner = claimText(payload.repository_owner);
  const repositoryOwnerId = claimText(payload.repository_owner_id);
  const ref = claimText(payload.ref);
  const workflowRef = claimText(payload.workflow_ref);
  const sourceSha = claimText(payload.sha)?.toLowerCase() ?? null;
  const workflowSha = claimText(payload.workflow_sha)?.toLowerCase() ?? null;
  const eventName = claimText(payload.event_name);
  const workflowRunId = claimText(payload.run_id);
  const workflowRunAttemptRaw = claimText(payload.run_attempt);

  if (repository !== principal.repository) return null;
  if (repositoryId !== String(principal.repository_id)) return null;
  if (repositoryOwner !== principal.repository_owner) return null;
  if (repositoryOwnerId !== String(principal.repository_owner_id)) return null;
  if (ref !== principal.allowed_ref) return null;
  if (workflowRef !== principal.workflow_ref) return null;
  if (!sourceSha || !SHA40.test(sourceSha)) return null;
  if (!workflowSha || workflowSha !== sourceSha || !SHA40.test(workflowSha)) return null;
  if (eventName !== "push" && eventName !== "workflow_dispatch") return null;
  if (workflowRunId !== null && !DECIMAL.test(workflowRunId)) return null;

  let workflowRunAttempt: number | null = null;
  if (workflowRunAttemptRaw !== null) {
    if (!DECIMAL.test(workflowRunAttemptRaw)) return null;
    const parsed = Number(workflowRunAttemptRaw);
    if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 1000) return null;
    workflowRunAttempt = parsed;
  }

  return {
    principalKey: principal.principal_key,
    namespace: principal.memory_namespace,
    repository,
    repositoryId,
    repositoryOwner,
    repositoryOwnerId,
    ref,
    workflowRef,
    sourceSha,
    eventName,
    workflowRunId,
    workflowRunAttempt,
  };
}

export function validateProviderCommit(
  expectedSha: string,
  value: unknown,
): GithubProviderCommit | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const sourceSha = claimText(record.sha)?.toLowerCase() ?? null;
  const tree = record.tree;
  const parents = record.parents;
  if (!sourceSha || sourceSha !== expectedSha || !SHA40.test(sourceSha)) return null;
  if (!tree || typeof tree !== "object" || Array.isArray(tree)) return null;
  const sourceTreeSha = claimText((tree as Record<string, unknown>).sha)?.toLowerCase() ?? null;
  if (!sourceTreeSha || !SHA40.test(sourceTreeSha)) return null;
  if (!Array.isArray(parents) || parents.length > MAX_PARENT_SHAS) return null;

  const parentShas: string[] = [];
  for (const parent of parents) {
    if (!parent || typeof parent !== "object" || Array.isArray(parent)) return null;
    const sha = claimText((parent as Record<string, unknown>).sha)?.toLowerCase() ?? null;
    if (!sha || !SHA40.test(sha)) return null;
    parentShas.push(sha);
  }
  if (new Set(parentShas).size !== parentShas.length) return null;
  return { sourceSha, sourceTreeSha, parentShas };
}

export function canonicalSnapshotPayload(
  identity: GithubSourceIdentity,
  commit: GithubProviderCommit,
) {
  return {
    schema_version: 1,
    principal_key: identity.principalKey,
    repository: identity.repository,
    repository_id: identity.repositoryId,
    ref: identity.ref,
    workflow_ref: identity.workflowRef,
    source_sha: commit.sourceSha,
    source_tree_sha: commit.sourceTreeSha,
    parent_shas: [...commit.parentShas],
  };
}
