\set ON_ERROR_STOP on

insert into public.audit_logs (
  user_id,
  namespace,
  action,
  table_name,
  record_id,
  before_snapshot,
  after_snapshot,
  metadata
) values (
  '11111111-1111-4111-8111-111111111111',
  'real_life',
  'projectos_evidence_successor_activation_authorized',
  'release_authorizations',
  gen_random_uuid(),
  null,
  jsonb_build_object('verdict', 'PASS'),
  jsonb_build_object(
    'authorization_id', 'memory-evidence-atomic-successor-exact-artifact-authorization',
    'authorized_head', repeat('a', 40),
    'authorized_tree', repeat('b', 40),
    'independent_review_id', 'test-independent-review-exact-head-pass',
    'independent_review_verdict', 'PASS',
    'issue_56_predecessor_only', true,
    'issue_56_authorizes_successor', false,
    'atomic_migration', '20260821160000_submit_projectos_evidence_candidate_atomic',
    'atomic_migration_sha256', 'ed97a4254879c1acea18a08aefa3dce0612339bdf1b55dc64df015aa3479af81',
    'bridge_index_sha256', '383c1cac600f0381aba21fe492bc5d04777a91e361ba5bd2ac0e088449103d83',
    'import_map_sha256', '5089831e8691c1b4183e7d5f5c0703ca861d4bb46d5fc7f8dbee0c0f76d3a88b',
    'test_fixture_only', true
  )
);
