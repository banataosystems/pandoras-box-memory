import fs from 'node:fs';

const path = 'supabase/functions/pandora-projectos-bridge/index.ts';
const source = fs.readFileSync(path, 'utf8');
const required = [
  'const freshestApprovedQuery = supabase',
  '.eq("user_id", principal.memory_user_id)',
  '.eq("namespace", namespace)',
  '.eq("is_active", true)',
  '.in("canon_status", [...APPROVED_CANON_STATUSES])',
  '.order("updated_at", { ascending: false })',
  '.limit(1);',
  'freshestApprovedResult,',
  'namespace_freshest_approved_at: namespaceFreshestApprovedAt',
  'freshness_scope: "namespace_approved_records"',
];
for (const needle of required) {
  if (!source.includes(needle)) {
    throw new Error(`freshness anchor contract missing: ${needle}`);
  }
}
const queryStart = source.indexOf('const freshestApprovedQuery = supabase');
const queryEnd = source.indexOf('const [', queryStart);
if (queryStart < 0 || queryEnd <= queryStart) throw new Error('freshness anchor query boundary missing');
const query = source.slice(queryStart, queryEnd);
if (/\bterms\b|canonStatuses|requestedCanonStatuses/.test(query)) {
  throw new Error('namespace freshness anchor must not depend on relevance terms or requested canon statuses');
}
if (!query.includes('[...APPROVED_CANON_STATUSES]')) {
  throw new Error('namespace freshness anchor must be approved-canon only');
}
if (source.includes('freshness_scope: "project_approved_records"')) {
  throw new Error('source must not claim project-scoped freshness without a project identity contract');
}
console.log('Memory namespace freshness anchor contract: PASS');
