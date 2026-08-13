#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const manifestPath = resolve(root, "docs/capabilities/PANDORA_CANONICAL_SOURCE_MANIFEST_DB409325.json");
const registryPath = resolve(root, "docs/capabilities/PANDORA_CAPABILITY_REGISTRY_V1.json");
const roadmapPath = resolve(root, "docs/roadmap/PANDORA_COMPOUNDING_INTELLIGENCE_MASTER_ROADMAP_V2.md");

const parse = (path) => JSON.parse(readFileSync(path, "utf8"));
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const fail = (message) => { throw new Error(message); };
const assert = (condition, message) => { if (!condition) fail(message); };

const allowedClassifications = new Set([
  "active-current",
  "current-better-than-original",
  "original-better-than-current",
  "missing-from-current",
  "candidate-for-recovery",
  "duplicate",
  "obsolete-superseded",
  "historical-only",
  "blocked-pending-proof"
]);
const allowedProofStages = new Set(["documented", "implemented", "tested", "deployed", "production-verified"]);
const expectedFamilies = new Set([
  "adaptive-memory",
  "autopilot-distillation",
  "compaction-scoring",
  "candidate-review",
  "persistence-readback-retrieval",
  "operator-admin-consoles",
  "operating-brain",
  "project-context-engine",
  "shadow-context-packs",
  "preflight",
  "promotion-execution-rollback",
  "operator-actions",
  "mcp-oauth",
  "environment-governance",
  "tests",
  "docs",
  "skills"
]);

function validate(manifest, registry, roadmapBytes) {
  assert(manifest.schema_version === "1.0.0", "manifest schema version changed");
  assert(manifest.repository === "banataosystems/pandoras-box-memory", "manifest repository changed");
  assert(manifest.commit_sha === "db409325c15778a1a701dad3f931e4c0fd19447c", "baseline commit changed");
  assert(manifest.tree_sha === "fecb745e193c78420c19c4bbb0ee0830510a08c4", "baseline tree changed");
  assert(Array.isArray(manifest.files), "manifest files missing");
  assert(manifest.files.length === 62 && manifest.file_count === 62, "baseline must contain exactly 62 files");
  assert(manifest.files.reduce((sum, file) => sum + file.size, 0) === 237809, "baseline bytes changed");
  assert(manifest.total_bytes === 237809, "manifest total_bytes changed");

  const paths = manifest.files.map((file) => file.path);
  assert(new Set(paths).size === paths.length, "duplicate baseline path");
  assert(JSON.stringify(paths) === JSON.stringify([...paths].sort((a,b) => Buffer.from(a).compare(Buffer.from(b)))), "baseline paths are not bytewise sorted");
  for (const file of manifest.files) {
    assert(typeof file.path === "string" && file.path.length > 0, "baseline path missing");
    assert(/^[0-9a-f]{40}$/.test(file.sha), "invalid Git blob SHA for " + file.path);
    assert(Number.isInteger(file.size) && file.size >= 0, "invalid byte size for " + file.path);
    assert(Object.keys(file).join(",") === "path,sha,size", "baseline file key order changed for " + file.path);
  }

  const compactFiles = JSON.stringify(manifest.files);
  const expectedFilesHash = "342036ffa57c8148efe7144136afa91892011f8c235023d7a89510aaa6026311";
  assert(sha256(compactFiles) === expectedFilesHash, "baseline files-array checksum mismatch");
  assert(manifest.files_array_sha256 === expectedFilesHash, "recorded files-array checksum mismatch");

  assert(registry.schema_version === "1.0.0", "registry schema version changed");
  assert(registry.authority.authoritative_issue_number === 22, "issue #22 must remain authoritative");
  assert(registry.authority.duplicate_issue_number === 23 && registry.authority.duplicate_issue_state === "closed", "issue #23 duplicate state changed");
  assert(sha256(roadmapBytes) === "a688fe5f8596e6f022071693bacb4bbc0d1a3c0b15480aa25b57fe2fea5287c3", "roadmap source digest mismatch");
  assert(registry.completion_claim.status === "withheld-blocked-pending-proof", "completion claim must remain withheld");
  assert(!JSON.stringify(registry).includes("completion_percentage"), "completion percentage is forbidden while archive proof is blocked");

  assert(Array.isArray(registry.records), "registry records missing");
  const ids = registry.records.map((record) => record.id);
  assert(new Set(ids).size === ids.length, "duplicate registry record id");
  for (const record of registry.records) {
    assert(typeof record.id === "string" && record.id.length > 0, "record id missing");
    assert(typeof record.plane === "string" && record.plane.length > 0, "record plane missing: " + record.id);
    assert(typeof record.record_type === "string" && record.record_type.length > 0, "record_type missing: " + record.id);
    assert(typeof record.name === "string" && record.name.length > 0, "record name missing: " + record.id);
    assert(typeof record.capability_family === "string" && record.capability_family.length > 0, "capability family missing: " + record.id);
    assert(allowedClassifications.has(record.classification), "invalid classification: " + record.id);
    assert(allowedProofStages.has(record.proof_stage), "invalid proof stage: " + record.id);
    assert(Array.isArray(record.evidence) && record.evidence.length > 0, "evidence missing: " + record.id);
    assert(typeof record.owner_target === "string" && record.owner_target.length > 0, "owner_target missing: " + record.id);
    assert(typeof record.next_action === "string" && record.next_action.length > 0, "next_action missing: " + record.id);
  }

  const fileRecords = registry.records.filter((record) => record.plane === "canonical" && record.record_type === "source-file");
  assert(fileRecords.length === 62, "registry must account for exactly 62 canonical baseline files");
  const byPath = new Map(fileRecords.map((record) => [record.source.path, record]));
  assert(byPath.size === 62, "duplicate canonical file record path");
  for (const file of manifest.files) {
    const record = byPath.get(file.path);
    assert(record, "canonical baseline omission: " + file.path);
    assert(record.source.blob_sha === file.sha, "blob mismatch: " + file.path);
    assert(record.source.byte_size === file.size, "size mismatch: " + file.path);
    assert(record.source.commit_sha === manifest.commit_sha, "commit mismatch: " + file.path);
    assert(record.source.tree_sha === manifest.tree_sha, "tree mismatch: " + file.path);
  }

  const archive = registry.records.find((record) => record.id === "original-recovery-capsule");
  assert(archive, "original archive aggregate missing");
  assert(archive.classification === "blocked-pending-proof", "original archive must remain blocked");
  assert(archive.source.recorded_regular_file_count === 782, "recorded archive count changed");
  assert(archive.source.recorded_byte_size === 1085918, "recorded archive size changed");
  assert(archive.source.recorded_zip_sha256 === "b0cfc83e04798887d9e889f45a1b9c8cf0e42cc51ce7f46fb3923b3a22434f2b", "recorded ZIP hash changed");
  assert(archive.source.recorded_capsule_sha256 === "458e7fa22541f103d6ed22198418d38928bba9c43006136c70534f0afdefbb13", "recorded capsule hash changed");
  assert(archive.source.archive_bytes_available === false, "archive bytes cannot be claimed available");
  assert(archive.source.deterministic_per_file_manifest_available === false, "per-file manifest cannot be claimed available");
  assert(archive.source.alias_drift_resolved === false, "archive alias drift cannot be claimed resolved");

  const familyRecords = registry.records.filter((record) => record.plane === "original" && record.record_type === "capability-family-aggregate");
  assert(familyRecords.length === 17, "exactly 17 original family aggregates required");
  assert(new Set(familyRecords.map((record) => record.capability_family)).size === 17, "duplicate original family");
  for (const family of expectedFamilies) {
    assert(familyRecords.some((record) => record.capability_family === family), "original family missing: " + family);
  }
  assert(familyRecords.every((record) => record.classification === "blocked-pending-proof"), "original family mapping must remain blocked");

  const suite = registry.records.find((record) => record.id === "original-test-suite-aggregate");
  assert(suite?.source?.recorded_count === 113, "recorded 113-test aggregate missing");
  assert(suite.source.test_manifest_available === false, "test manifest cannot be claimed available");
  assert(/unverified/.test(suite.source.count_unit), "113-test caveat missing");

  const ledger = registry.records.find((record) => record.id === "live-supabase-migration-ledger-20260814");
  assert(ledger?.source?.observed_count === 68, "live migration ledger must record 68");
  assert(ledger.source.latest_identity === "20260813114649_remove_temporary_flutterflow_http_probe_20260813", "latest live migration identity changed");
  assert(manifest.files.filter((file) => /^supabase\/migrations\/.*\.sql$/.test(file.path)).length === 15, "canonical migration file count changed");

  const blockerIds = new Set(registry.blockers.map((blocker) => blocker.id));
  for (const id of ["archive-per-file-evidence-unavailable", "gateway-namespace-row-filter-unproven", "live-migration-68-source-gap", "vercel-return-path-reliability", "independent-review-missing"]) {
    assert(blockerIds.has(id), "required blocker missing: " + id);
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function expectFailure(name, mutate, manifest, registry, roadmapBytes) {
  const nextManifest = clone(manifest);
  const nextRegistry = clone(registry);
  mutate(nextManifest, nextRegistry);
  let rejected = false;
  try {
    validate(nextManifest, nextRegistry, roadmapBytes);
  } catch {
    rejected = true;
  }
  assert(rejected, "self-test mutation was not rejected: " + name);
}

const manifest = parse(manifestPath);
const registry = parse(registryPath);
const roadmapBytes = readFileSync(roadmapPath);
validate(manifest, registry, roadmapBytes);

if (process.argv.includes("--self-test")) {
  expectFailure("baseline omission", (m) => { m.files.pop(); }, manifest, registry, roadmapBytes);
  expectFailure("duplicate path", (m) => { m.files[1].path = m.files[0].path; }, manifest, registry, roadmapBytes);
  expectFailure("false archive availability", (_m, r) => {
    r.records.find((record) => record.id === "original-recovery-capsule").source.archive_bytes_available = true;
  }, manifest, registry, roadmapBytes);
  expectFailure("live-ledger regression", (_m, r) => {
    r.records.find((record) => record.id === "live-supabase-migration-ledger-20260814").source.observed_count = 67;
  }, manifest, registry, roadmapBytes);
  process.stdout.write("Capability registry valid; 4 rejection self-tests passed.\n");
} else {
  process.stdout.write("Capability registry valid.\n");
}

