#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const P = {
  manifest: "docs/provider-observations/memory-supabase-20260819/LIVE_CATALOG_MANIFEST.json",
  boundaries: "docs/provider-observations/memory-supabase-20260819/SECURITY_BOUNDARIES.json",
  timeline: "docs/provider-observations/memory-supabase-20260819/scheduled-jobs/OBSERVATION_TIMELINE.json",
  report: "docs/recovery/PANDORA_SUPABASE_CATAOG_SUPPLEMENT_2026-08-19.md",
  capability: "docs/capabilities/evidence/MEMORY_SUPABASE_LIVE_CATALOG_2026-08-19.json",
  verifier: "scripts/check_memory_supabase_catalog.mjs",
  workflow: ".github/workflows/memory-supabase-catalog-evidence.yml",
};
const sha256 = x => createHash("sha256").update(x).digest("hex");
const bytes = p => readFileSync(p);
const json = p => JSON.parse(readFileSync(p, "utf8"));
const d = json(P.manifest);
const b = json(P.boundaries);
const t = json(P.timeline);
const c = json(P.capability);
const errors = [];
const bad = (ok,msg) => { if (!ok) errors.push(msg); };
const hex64 = x => /^[0-9a-f]{64}$/.test(x ?? "");

for (const key of ["manifest","boundaries","report","verifier","workflow"]) {
  const expected = c.source?.[`${key}_sha256`];
  bad(hex64(expected), `${key}: missing content address`);
  bad(expected === sha256(bytes(P[key])), `${key}: content-address mismatch`);
}
bad(d.capture_method?.catalog_boundaries_sha256 === sha256(bytes(P.boundaries)), "manifest boundary pin mismatch");
bad(d.provider?.project_ref === "ivmvufhcsezyhczzondn", "wrong project");
bad(d.provider?.region === "ap-southeast-2" && d.provider?.status === "ACTIVE_HEALTHY", "project identity drift");
bad(d.authority?.canonical_context?.degraded === true, "canonical freshness degradation erased");

const m=d.migrations ?? {};
bad(m.live_count===68 && m.stored_statement_count===542 && m.stored_statement_bytes===246216, "migration inventory drift");
bad(m.provider_tsv_bytes===9278 && m.provider_tsv_sha256==="1ee828f6844dfedf800b3c5a7a2b8e35c785214e548213defaf01013dd5bda65", "migration fingerprint drift");
bad(Object.values(m.source_classification ?? {}).reduce((a,x)=>a+x,0)===68, "migration classification total mismatch");
bad(m.source_classification?.A_exact_source_match===14 && m.source_classification?.C_identity_recovered_source_missing===53 && m.source_classification?.D_sanitized_recovery_artifact===1, "migration provenance overstated");
bad(m.rollback_metadata_count===0 && m.rollback_qualified===false && m.forward_recovery_required===true, "unsafe migration recovery claim");

const r=d.relations ?? {};
bad(r.relation_count===89 && r.rls_enabled_count===83 && r.rls_forced_count===31 && r.rls_disabled_count===6, "relation inventory drift");
bad(hex64(r.provider_manifest_sha256) && b.private_relations?.length===8, "relation evidence incomplete");

const p=d.rls_policies ?? {};
bad(p.policy_count===117 && p.table_count===62, "policy total drift");
bad(p.commands?.SELECT===44 && p.commands?.INSERT===44 && p.commands?.UPDATE===11 && p.commands?.DELETE===0 && p.commands?.ALL===18, "policy command drift");
bad(hex64(p.provider_manifest_sha256), "policy fingerprint missing");

const f=d.functions ?? {};
bad(f.function_count===25 && f.security_definer_count===11 && f.security_definer_without_fixed_search_path===0, "function security drift");
bad(f.public_execute_count===10 && f.anon_execute_count===10 && f.authenticated_execute_count===10, "function ACL drift");
bad(b.security_definer_functions?.length===11 && b.security_definer_functions.every(x=>hex64(x.sha256)&&x.search_path), "definer evidence incomplete");

const a=d.automatic_execution ?? {};
bad(a.application_trigger_count===14 && a.enabled_application_trigger_count===14 && b.application_triggers?.length===14, "trigger drift");
bad(b.scheduled_jobs?.length===1 && b.scheduled_jobs[0]?.command_persisted===false, "historical cron capture incomplete");
bad(b.provider_event_triggers?.length===6 && a.application_event_trigger_count===0, "event-trigger evidence incomplete");

const acl=d.acl ?? {};
bad(acl.privilege_entry_count===1797 && acl.grouped_grant_count===280, "ACL inventory drift");
bad(acl.grouped_by_grantee?.PUBLIC===11 && acl.grouped_by_grantee?.anon===79 && acl.grouped_by_grantee?.authenticated===79 && acl.grouped_by_grantee?.service_role===110 && acl.grouped_by_grantee?.postgres===1, "ACL role totals drift");
bad(b.private_relation_non_owner_grants?.length===3 && acl.general_private_client_schema_access===false, "private ACL evidence incomplete");

const adv=d.security_advisors ?? {};
bad(adv.total===27 && adv.rls_enabled_no_policy_info===21 && adv.mutable_search_path_warnings===4 && adv.extension_in_public_warnings===1 && adv.leaked_password_protection_disabled===true, "advisor drift");

const edge=d.edge_functions ?? {};
bad(edge.functions?.length===3 && edge.live_bundle_source_fetched===false && edge.production_deploy_performed===false, "Edge parity overstated");
bad(edge.functions?.every(x=>hex64(x.provider_hash)&&x.status==="ACTIVE"), "bad Edge metadata");

bad(d.reconstruction?.rollback_qualified===false && d.reconstruction?.forward_recovery_required===true, "unsafe rollback qualification");
bad(Object.values(d.safety ?? {}).every(x=>x===false), "unsafe action recorded");
bad(Object.values(b.privacy ?? {}).every(x=>x===false), "privacy exclusion failed");

bad(t.status==="RED" && t.stable_pass_verified===false, "current RED status erased");
bad(t.reconciliation?.production_verified_complete_catalog===false, "historical capture promoted to current complete catalog");
bad(t.reconciliation?.historical_three_job_observation_explained===false, "unresolved cron contradiction erased");
bad(c.lifecycle?.production_verified_read_only===false, "capability still claims current production verification");
bad(c.provider_proof?.current_catalog_production_verified===false, "provider proof still claims current complete catalog");
bad(c.verification?.current_parity_status==="RED" && c.verification?.stable_pass_verified===false, "capability parity gate is not RED");

const raw=JSON.stringify({d,b,t,c});
bad(!/(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,}|sb_secret_[A-Za-z0-9_-]{20,}|-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----)/.test(raw), "literal secret pattern");
bad(!/"(password|access_token|refresh_token|service_role_key|jwt_secret|hmac_secret|private_key)"\s*:/.test(raw), "forbidden secret key");

if (errors.length) {
  for (const e of errors) console.error(`ERROR: ${e}`);
  process.exit(1);
}
console.log("Pandora Memory Supabase historical catalog capture verified; current live parity remains RED.");
console.log(`migrations=${m.live_count} relations=${r.relation_count} policies=${p.policy_count} functions=${f.function_count} triggers=${a.application_trigger_count} grants=${acl.grouped_grant_count} status=${t.status}`);
