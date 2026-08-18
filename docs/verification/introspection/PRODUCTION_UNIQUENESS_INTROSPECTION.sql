-- Read-only introspection that closes the PR #32 production-schema gate.
--
-- Run BOTH queries against the Memory project (ivmvufhcsezyhczzondn) through an
-- authenticated read-only path, then paste both result sets into an artifact
-- shaped like docs/verification/fixtures/EXAMPLE_INTROSPECTION_BUNDLE.json and validate
-- it with:
--
--     node scripts/check_production_idempotency_constraints.mjs <bundle.json>
--
-- Nothing here writes, locks, or mutates. Both statements read pg_catalog only.
--
-- Query 1 deliberately does NOT filter on indisunique: non-unique indexes are
-- returned too, with is_unique stated explicitly, so the checker rejects them
-- rather than inferring uniqueness from their absence.

-- Query 1: every index on the three tables, with uniqueness stated explicitly.
select
  t.relname                              as table_name,
  i.relname                              as index_name,
  con.conname                            as constraint_name,
  con.contype                            as constraint_type,
  idx.indisunique                        as is_unique,
  array_agg(a.attname order by k.ord)    as unique_columns,
  pg_get_expr(idx.indpred, idx.indrelid) as partial_predicate,
  idx.indnullsnotdistinct                as nulls_not_distinct
from pg_class t
join pg_namespace n on n.oid = t.relnamespace
join pg_index idx on idx.indrelid = t.oid
join pg_class i on i.oid = idx.indexrelid
left join pg_constraint con on con.conindid = i.oid and con.contype in ('u','p')
cross join lateral unnest(idx.indkey) with ordinality as k(attnum, ord)
join pg_attribute a on a.attrelid = t.oid and a.attnum = k.attnum
where n.nspname = 'public'
  and t.relname in (
    'memory_capture_candidates',
    'memory_review_queue_items',
    'memory_session_digests'
  )
group by t.relname, i.relname, con.conname, con.contype,
         idx.indisunique, idx.indpred, idx.indrelid, idx.indnullsnotdistinct
order by t.relname, i.relname;

-- Query 2: nullability of every idempotency-key column.
--
-- This is not optional. Under PostgreSQL's default NULLS DISTINCT semantics a
-- unique index does not deduplicate rows whose key contains NULL, so a nullable
-- key column means the constraint is not equivalent to full idempotency
-- protection. The checker refuses to conclude without this.
select
  c.table_name,
  c.column_name,
  (c.is_nullable = 'YES') as is_nullable
from information_schema.columns c
where c.table_schema = 'public'
  and c.table_name in (
    'memory_capture_candidates',
    'memory_review_queue_items',
    'memory_session_digests'
  )
  and c.column_name in (
    'user_id', 'namespace', 'source', 'source_ref', 'candidate_type'
  )
order by c.table_name, c.column_name;
