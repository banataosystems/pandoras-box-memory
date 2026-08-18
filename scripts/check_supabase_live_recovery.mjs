#!/usr/bin/env node
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {argv,exit} from 'node:process';
const I='supabase/recovery/provider-observations/2026-08-19_supabase_live_inventory.json';
const M='supabase/recovery/ROLLBACK_FORWARD_RECOVERY_MATRIX_2026-08-19.json';
const H='supabase/recovery/provider-observations/2026-08-19_supabase_readback_status.json';
const L='docs/migrations/LIVE_MIGRATION_LEDGER_2026-08-17.json';
const sha=v=>createHash('sha256').update(v,'utf8').digest('hex');
const raw=p=>readFileSync(p,'utf8');
const read=p=>JSON.parse(raw(p));
const RAW_SHA={inventory:'8b8f0670a9dbd6a0a1ced7a9649d515820721b953b8f034689b1be0efdd877a8',matrix:'6f9cd2f8378b56159bdf1e88838eb5b16507005eae92ae4e19de9e7894889dcd',historical:'1434965451ecf6fe1d74563a35aadff1210c25e6d11430b7ad3b956bd6d27bb4'};
const clone=v=>JSON.parse(JSON.stringify(v));
const rehash=d=>(d.evidence_payload_sha256=sha(JSON.stringify(d.evidence_payload)),d);
const eq=(v,a)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===a.length&&a.every(k=>Object.hasOwn(v,k));
const root=['schema_version','evidence_id','evidence_payload','evidence_payload_sha256'];
const safety=['production_database_mutated','production_edge_function_deployed','production_release_performed','billable_supabase_branch_created','migration_replayed','production_data_altered','rls_or_privileges_weakened','historical_evidence_overwritten','secret_values_recorded'];
const invPayload=['captured_at','repository','source_context','memory_authority','project_identity','branch_inventory','migration_ledger','database_catalog','lifecycle_infrastructure','edge_functions','reconstruction_assessment','known_unverified','safety'];
const histPayload=['captured_at','repository','source_context','memory_authority','supabase_readback','lane_boundaries','safety'];
const histRead=['provider','project_ref','environment','status','current_provider_state_refreshed','current_live_migration_count','current_edge_function_inventory_verified','current_schema_security_inventory_verified','last_verified_ledger','attempts','conclusion','next_read_gate'];
const matrixPayload=['captured_at','repository','source_context','inventory_evidence_path','inventory_payload_sha256','rows','summary','safety'];
const hex=(v,n)=>typeof v==='string'&&new RegExp(`^[0-9a-f]{${n}}$`).test(v);
function validate(inv,matrix,hist,ledger,rawDocs){
 const e=[]; const add=(c,m)=>{if(!c)e.push(m)};
 add(sha(rawDocs.inventory)===RAW_SHA.inventory,'inventory: whole-file hash mismatch');
 add(sha(rawDocs.matrix)===RAW_SHA.matrix,'matrix: whole-file hash mismatch');
 add(sha(rawDocs.historical)===RAW_SHA.historical,'historical: whole-file hash mismatch');
 for(const [d,n,p] of [[inv,'inventory',invPayload],[hist,'historical',histPayload],[matrix,'matrix',matrixPayload]]){
  add(eq(d,root),`${n}: closed root schema`); add(d.schema_version==='1.0.0',`${n}: schema version`);
  add(eq(d.evidence_payload,p),`${n}: closed payload schema`);
  add(hex(d.evidence_payload_sha256,64),`${n}: payload hash shape`);
  add(sha(JSON.stringify(d.evidence_payload))===d.evidence_payload_sha256,`${n}: payload hash mismatch`);
 }
 add(eq(hist.evidence_payload.supabase_readback,histRead),'historical: closed nested readback schema');
 add(hist.evidence_payload.supabase_readback.current_provider_state_refreshed===false,'historical: blocked read marked fresh');
 add(hist.evidence_payload.supabase_readback.current_live_migration_count===null,'historical: blocked read claims live count');
 add(inv.evidence_id==='supabase-live-inventory-2026-08-19','inventory: evidence id');
 const p=inv.evidence_payload, mig=p.migration_ledger, db=p.database_catalog;
 add(p.repository==='banataosystems/pandoras-box-memory','inventory: repository');
 add(p.project_identity.project_ref==='ivmvufhcsezyhczzondn','inventory: project ref');
 add(p.project_identity.region==='ap-southeast-1','inventory: region');
 add(p.project_identity.health==='ACTIVE_HEALTHY','inventory: health');
 add(mig.status==='production_verified','inventory: migration status');
 add(mig.migration_count===68&&mig.statement_count===542&&mig.sql_bytes===246216,'inventory: migration totals');
 add(mig.with_rollback_metadata===0&&mig.with_idempotency_key===0,'inventory: migration recovery metadata');
 add(mig.identity_sha256==='6de5c933eb043a77fdf88c4d162904775b240b2661de9727daf90350ec222177','inventory: identity hash');
 add(mig.ledger_fingerprint_sha256==='cdde58065682ec0182c2fd04e5f753cb3ee2593abaa05701992f872dded1fdf3','inventory: ledger fingerprint');
 add(Object.values(mig.classifications).reduce((a,b)=>a+b,0)===68,'inventory: classification total');
 add(mig.classifications.A_exact_source_match===14&&mig.classifications.C_identity_recovered_source_missing===53&&mig.classifications.D_sanitized_recovery_artifact===1,'inventory: truthful source classes');
 add(ledger.provider_resource_id==='ivmvufhcsezyhczzondn','ledger: project ref');
 add(ledger.totals.migrations===68&&ledger.totals.statements===542&&ledger.totals.sql_bytes===246216&&ledger.totals.with_rollback_metadata===0,'ledger: totals');
 if(Array.isArray(ledger.migrations)&&ledger.migrations.length===68){
  const ids=ledger.migrations.map(x=>`${x.version}\t${x.name}`).join('\n');
  const fp=ledger.migrations.map(x=>`${x.version}\t${x.name}\t${x.statement_count}\t${x.statements_bytes}\t${x.statements_sha256}\t${x.rollback_metadata}\tfalse`).join('\n');
  add(sha(ids)===mig.identity_sha256,'ledger: identity digest'); add(sha(fp)===mig.ledger_fingerprint_sha256,'ledger: fingerprint digest');
 }
 const r=db.rls_and_policies;
 add(r.tables===89&&r.policies===117&&r.rls_enabled_tables===83&&r.rls_forced_tables===31&&r.rls_disabled_tables===6,'inventory: RLS totals');
 add(r.public_tables_without_rls===0&&r.rls_disabled_private_tables.length===6,'inventory: RLS boundary');
 const sd=db.security_definer_effective_execute;
 add(sd.security_definer===11&&sd.public_execute===0&&sd.anon_execute===0&&sd.authenticated_execute===0&&sd.authenticator_execute===0,'inventory: SECURITY DEFINER boundary');
 add(db.routines.security_definer_without_explicit_search_path===0,'inventory: privileged search_path');
 add(db.automatic_execution.application_triggers===14&&db.automatic_execution.cron_jobs.length===1&&db.automatic_execution.cron_jobs[0].raw_command_persisted===false,'inventory: automatic execution');
 add(p.edge_functions.source_parity_status==='separate_lane_pr_34_pending_exact_head_independent_review','inventory: Edge lane boundary');
 add(p.edge_functions.functions.length===3&&p.edge_functions.functions.every(x=>x.status==='ACTIVE'&&hex(x.provider_sha256,64)),'inventory: Edge versions/hashes');
 add(p.reconstruction_assessment.overall==='partially_reconstructable'&&p.reconstruction_assessment.known_good_full_system_recovery_point===null,'inventory: reconstruction truth');
 add(eq(p.safety,safety)&&safety.every(k=>p.safety[k]===false),'inventory: safety');
 add(matrix.evidence_id==='rollback-forward-recovery-matrix-2026-08-19','matrix: evidence id');
 add(matrix.evidence_payload.inventory_payload_sha256===inv.evidence_payload_sha256,'matrix: detached inventory');
 add(Array.isArray(matrix.evidence_payload.rows)&&matrix.evidence_payload.rows.length===10,'matrix: row count');
 add(matrix.evidence_payload.rows.every(x=>x.rollback_qualified===false&&typeof x.forward_recovery==='string'&&x.forward_recovery.length>0),'matrix: false rollback claim');
 add(matrix.evidence_payload.summary.rollback_qualified_count===0&&matrix.evidence_payload.summary.forward_recovery_required_count===10,'matrix: summary');
 add(eq(matrix.evidence_payload.safety,safety)&&safety.every(k=>matrix.evidence_payload.safety[k]===false),'matrix: safety');
 const serialized=JSON.stringify([inv,matrix,hist]);
 add(!/-----BEGIN [A-Z ]*PRIVATE KEY-----|\bghp_[A-Za-z0-9]{20,}\b|\bgithub_pat_[A-Za-z0-9_]{20,}\b|\bsk_live_[A-Za-z0-9]{12,}\b|\bAKIA[0-9A-Z]{16}\b|\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./.test(serialized),'evidence: secret-like literal');
 return e;
}
function selfTest(i,m,h,l,baseRaw){
 const cases=[['valid',clone(i),clone(m),clone(h),baseRaw,false]];
 let x=clone(h);x.production_verified=true;cases.push(['unknown historical root',clone(i),clone(m),x,{...baseRaw,historical:JSON.stringify(x)},true]);
 x=clone(h);x.evidence_payload.supabase_readback.production_verified=true;rehash(x);cases.push(['unknown historical nested',clone(i),clone(m),x,{...baseRaw,historical:JSON.stringify(x)},true]);
 x=clone(i);x.production_verified=true;cases.push(['unknown inventory root',x,clone(m),clone(h),{...baseRaw,inventory:JSON.stringify(x)},true]);
 x=clone(i);x.evidence_payload.database_catalog.rls_and_policies.production_verified=true;rehash(x);cases.push(['unknown deep inventory claim',x,clone(m),clone(h),{...baseRaw,inventory:JSON.stringify(x)},true]);
 x=clone(i);x.evidence_payload.migration_ledger.migration_count=69;rehash(x);cases.push(['migration drift',x,clone(m),clone(h),{...baseRaw,inventory:JSON.stringify(x)},true]);
 x=clone(i);x.evidence_payload.database_catalog.security_definer_effective_execute.anon_execute=1;rehash(x);cases.push(['low role privileged execute',x,clone(m),clone(h),{...baseRaw,inventory:JSON.stringify(x)},true]);
 let y=clone(m);y.evidence_payload.rows[0].rollback_qualified=true;rehash(y);cases.push(['false rollback',clone(i),y,clone(h),{...baseRaw,matrix:JSON.stringify(y)},true]);
 x=clone(i);x.evidence_payload.safety.production_database_mutated=true;rehash(x);cases.push(['hidden production mutation',x,clone(m),clone(h),{...baseRaw,inventory:JSON.stringify(x)},true]);
 x=clone(i);x.evidence_payload.edge_functions.source_parity_status='approved';rehash(x);cases.push(['Edge lane overclaim',x,clone(m),clone(h),{...baseRaw,inventory:JSON.stringify(x)},true]);
 y=clone(m);y.evidence_payload.inventory_payload_sha256='0'.repeat(64);rehash(y);cases.push(['detached matrix',clone(i),y,clone(h),{...baseRaw,matrix:JSON.stringify(y)},true]);
 let bad=0;for(const [n,a,b,c,r,reject] of cases){const got=validate(a,b,c,l,r).length>0;if(got!==reject){console.error(`SELF-TEST FAIL: ${n}`);bad++;}}
 if(bad)exit(1);console.log(`Supabase live recovery self-test passed (${cases.length} cases).`);
}
const rawDocs={inventory:raw(I),matrix:raw(M),historical:raw(H)};
const inv=JSON.parse(rawDocs.inventory),matrix=JSON.parse(rawDocs.matrix),hist=JSON.parse(rawDocs.historical),ledger=read(L);
if(argv.includes('--self-test'))selfTest(inv,matrix,hist,ledger,rawDocs);
const errors=validate(inv,matrix,hist,ledger,rawDocs);
if(errors.length){console.error('Supabase live recovery gate FAILED:');for(const x of errors)console.error(`  - ${x}`);exit(1);}
console.log('Supabase live recovery gate passed: 68 migrations; 14 exact, 1 sanitized, 53 source-missing; production inventory hashed; rollback unqualified; no production mutation.');
