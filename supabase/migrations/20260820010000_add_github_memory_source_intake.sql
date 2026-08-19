-- Direct GitHub -> Pandora Memory source snapshot intake.
--
-- Security properties:
-- - GitHub authenticates with short-lived Actions OIDC, never a stored Supabase key.
-- - Only the exact allowlisted repository/main/workflow identity may submit.
-- - Source snapshots are append-only and content-addressed.
-- - Snapshot intake feeds the existing human-review candidate layer; it does not
--   create canonical Memory records or bypass the promotion gate.

CREATE TABLE IF NOT EXISTS public.pandora_github_source_principals (
  principal_key text PRIMARY KEY,
  oidc_issuer text NOT NULL,
  oidc_audience text NOT NULL,
  oidc_subject text NOT NULL,
  repository text NOT NULL,
  repository_id bigint NOT NULL,
  repository_owner text NOT NULL,
  repository_owner_id bigint NOT NULL,
  allowed_ref text NOT NULL,
  workflow_ref text NOT NULL,
  memory_namespace public.pandora_namespace NOT NULL DEFAULT 'au'::public.pandora_namespace,
  memory_user_id uuid NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pandora_github_source_principals_issuer_check
    CHECK (oidc_issuer = 'https://token.actions.githubusercontent.com'),
  CONSTRAINT pandora_github_source_principals_audience_check
    CHECK (oidc_audience = 'pandora-memory-github-v1'),
  CONSTRAINT pandora_github_source_principals_repository_check
    CHECK (repository ~ '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$'),
  CONSTRAINT pandora_github_source_principals_ref_check
    CHECK (allowed_ref ~ '^refs/heads/[A-Za-z0-9._/-]+$')
);

ALTER TABLE public.pandora_github_source_principals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pandora_github_source_principals FROM PUBLIC, anon, authenticated, authenticator;
GRANT SELECT ON public.pandora_github_source_principals TO service_role;

CREATE UNIQUE INDEX IF NOT EXISTS pandora_github_source_principals_identity_uq
  ON public.pandora_github_source_principals (
    oidc_issuer,
    oidc_audience,
    oidc_subject
  );

CREATE TABLE IF NOT EXISTS public.pandora_github_source_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  principal_key text NOT NULL
    REFERENCES public.pandora_github_source_principals(principal_key),
  repository text NOT NULL,
  repository_id bigint NOT NULL,
  ref text NOT NULL,
  workflow_ref text NOT NULL,
  source_sha text NOT NULL,
  source_tree_sha text NOT NULL,
  parent_shas text[] NOT NULL DEFAULT '{}'::text[],
  snapshot_sha256 text NOT NULL,
  first_workflow_run_id bigint,
  first_workflow_run_attempt integer,
  first_event_name text,
  provider_checked_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pandora_github_source_snapshots_source_sha_check
    CHECK (source_sha ~ '^[0-9a-f]{40}$'),
  CONSTRAINT pandora_github_source_snapshots_tree_sha_check
    CHECK (source_tree_sha ~ '^[0-9a-f]{40}$'),
  CONSTRAINT pandora_github_source_snapshots_digest_check
    CHECK (snapshot_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT pandora_github_source_snapshots_parent_count_check
    CHECK (cardinality(parent_shas) <= 8),
  CONSTRAINT pandora_github_source_snapshots_parent_sha_check
    CHECK (
      cardinality(parent_shas) = 0
      OR array_to_string(parent_shas, ',', '<null>')
        ~ '^[0-9a-f]{40}(,[0-9a-f]{40})*$'
    )
);

ALTER TABLE public.pandora_github_source_snapshots ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pandora_github_source_snapshots FROM PUBLIC, anon, authenticated, authenticator;
GRANT SELECT, INSERT ON public.pandora_github_source_snapshots TO service_role;

CREATE UNIQUE INDEX IF NOT EXISTS pandora_github_source_snapshots_commit_uq
  ON public.pandora_github_source_snapshots(repository_id, source_sha);
CREATE UNIQUE INDEX IF NOT EXISTS pandora_github_source_snapshots_digest_uq
  ON public.pandora_github_source_snapshots(snapshot_sha256);

CREATE OR REPLACE FUNCTION private.reject_github_source_snapshot_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'github_source_snapshots_are_append_only'
    USING ERRCODE = '55000';
END;
$$;

REVOKE ALL ON FUNCTION private.reject_github_source_snapshot_mutation()
FROM PUBLIC, anon, authenticated, authenticator;

DROP TRIGGER IF EXISTS pandora_github_source_snapshots_append_only
ON public.pandora_github_source_snapshots;

CREATE TRIGGER pandora_github_source_snapshots_append_only
BEFORE UPDATE OR DELETE ON public.pandora_github_source_snapshots
FOR EACH ROW EXECUTE FUNCTION private.reject_github_source_snapshot_mutation();

INSERT INTO public.pandora_github_source_principals (
  principal_key,
  oidc_issuer,
  oidc_audience,
  oidc_subject,
  repository,
  repository_id,
  repository_owner,
  repository_owner_id,
  allowed_ref,
  workflow_ref,
  memory_namespace,
  memory_user_id,
  is_active
)
SELECT
  'github-pandora-memory-main',
  'https://token.actions.githubusercontent.com',
  'pandora-memory-github-v1',
  'repo:banataosystems/pandoras-box-memory:ref:refs/heads/main',
  'banataosystems/pandoras-box-memory',
  1327294429,
  'banataosystems',
  314296438,
  'refs/heads/main',
  'banataosystems/pandoras-box-memory/.github/workflows/github-memory-source-sync.yml@refs/heads/main',
  'au'::public.pandora_namespace,
  memory_user_id,
  true
FROM public.pandora_service_principals
WHERE principal_key = 'projectos-mcpmaster-production'
  AND is_active = true
ON CONFLICT (principal_key) DO NOTHING;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.pandora_github_source_principals
    WHERE principal_key = 'github-pandora-memory-main'
      AND oidc_issuer = 'https://token.actions.githubusercontent.com'
      AND oidc_audience = 'pandora-memory-github-v1'
      AND oidc_subject = 'repo:banataosystems/pandoras-box-memory:ref:refs/heads/main'
      AND repository = 'banataosystems/pandoras-box-memory'
      AND repository_id = 1327294429
      AND repository_owner = 'banataosystems'
      AND repository_owner_id = 314296438
      AND allowed_ref = 'refs/heads/main'
      AND workflow_ref = 'banataosystems/pandoras-box-memory/.github/workflows/github-memory-source-sync.yml@refs/heads/main'
      AND memory_namespace = 'au'::public.pandora_namespace
      AND memory_user_id IS NOT NULL
      AND is_active = true
  ) THEN
    RAISE EXCEPTION 'github_memory_source_principal_unavailable_or_conflicting';
  END IF;
END;
$$;

COMMENT ON TABLE public.pandora_github_source_snapshots IS
  'Append-only, provider-verified GitHub commit snapshots for Pandora Memory recovery and review-gated evidence intake. No canonical promotion occurs here.';
