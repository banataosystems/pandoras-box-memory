#!/usr/bin/env node
// Migration parity, duplicate, and drift gate.
//
// The situation this exists to govern: production has 68 applied migrations,
// canonical source has 15. Rather than pretend the gap does not exist or invent
// SQL to close it, this gate holds a manifest that states, for every live
// migration, exactly what source we do and do not have — and fails if any of
// those claims stops being true.
//
// It enforces four things:
//
//   1. Parity      — the manifest covers exactly the live ledger, no more, no less.
//   2. Uniqueness  — no duplicate migration versions in source or manifest.
//   3. Anti-drift  — a committed migration cannot change content, or a manifest
//                    entry change name/hash, without the manifest being updated
//                    deliberately. Silent mutation becomes a CI failure.
//   4. Honesty     — a manifest entry cannot claim `authentic` source that does
//                    not hash to the provider's recorded content.
//
// It never contacts the provider. The live ledger is a committed, immutable
// observation; refreshing it is a deliberate, reviewable act.

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { argv, exit } from "node:process";

const LEDGER_PATH = "docs/migrations/LIVE_MIGRATION_LEDGER_2026-08-17.json";
const MANIFEST_PATH = "docs/migrations/MIGRATION_PARITY_MANIFEST.json";
const SOURCE_DIR = "supabase/migrations";
const RECOVERY_DIR = "supabase/recovery/live-migrations";

const VERSION_RE = /^\d{14}$/;
const SHA256_RE = /^[0-9a-f]{64}$/;

/**
 * How the committed source relates to what production actually ran.
 *
 * authentic   — hashes to the provider's recorded statement content.
 * sanitized   — deliberately and visibly differs, for a documented reason
 *               (e.g. an owner-specific audit row carrying a principal UUID that
 *               must not enter public source). Schema effects preserved.
 * reconstructed — rebuilt from provider state; NOT the original artifact.
 * missing     — no source in this repository. Not invented.
 */
const SOURCE_AVAILABILITY = new Set([
  "authentic",
  "sanitized",
  "reconstructed",
  "missing",
]);

const sha256 = (text) => createHash("sha256").update(text, "utf8").digest("hex");

/**
 * Provider `statements` are stored without a consistent trailing newline, so a
 * committed file and the provider content may differ by trailing whitespace
 * alone. That is not a semantic difference. Everything else is.
 */
function matchesProvider(fileText, providerSha) {
  return sha256(fileText) === providerSha ||
    sha256(fileText.replace(/\s+$/, "")) === providerSha;
}

function loadJson(path) {
  if (!existsSync(path)) {
    console.error(`Missing required file: ${path}`);
    exit(1);
  }
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    console.error(`${path} is not valid JSON: ${error.message}`);
    exit(1);
  }
}

function sourceFilesByVersion(dir) {
  const byVersion = new Map();
  const duplicates = [];
  if (!existsSync(dir)) return { byVersion, duplicates };
  for (const file of readdirSync(dir).filter((name) => name.endsWith(".sql"))) {
    const version = file.slice(0, 14);
    if (!VERSION_RE.test(version)) continue;
    if (byVersion.has(version)) duplicates.push(version);
    else byVersion.set(version, file);
  }
  return { byVersion, duplicates };
}

/** Core validation, extracted so the self-test can drive it with fixtures. */
export function validate({ ledger, manifest, sourceByVersion, readSource }) {
  const errors = [];

  const ledgerVersions = new Set();
  for (const entry of ledger.migrations ?? []) {
    if (!VERSION_RE.test(entry.version ?? "")) {
      errors.push(`ledger: '${entry.version}' is not a 14-digit migration version`);
    }
    if (ledgerVersions.has(entry.version)) {
      errors.push(`ledger: duplicate version '${entry.version}'`);
    }
    ledgerVersions.add(entry.version);
    if (!SHA256_RE.test(entry.statements_sha256 ?? "")) {
      errors.push(`ledger: '${entry.version}' has no valid statements_sha256`);
    }
  }

  const manifestVersions = new Set();
  const ledgerByVersion = new Map(
    (ledger.migrations ?? []).map((entry) => [entry.version, entry]),
  );

  for (const entry of manifest.migrations ?? []) {
    const version = entry.version;

    if (manifestVersions.has(version)) {
      errors.push(`manifest: duplicate version '${version}'`);
    }
    manifestVersions.add(version);

    const live = ledgerByVersion.get(version);
    if (!live) {
      errors.push(
        `manifest: '${version}' is not in the live ledger — source claims a ` +
          `migration production has never applied`,
      );
      continue;
    }

    // Name drift: the manifest must not quietly rename a live migration.
    if (entry.name !== live.name) {
      errors.push(
        `manifest: '${version}' name '${entry.name}' does not match live name ` +
          `'${live.name}'`,
      );
    }

    // Provider hash drift.
    if (entry.provider_statements_sha256 !== live.statements_sha256) {
      errors.push(
        `manifest: '${version}' provider_statements_sha256 does not match the ` +
          `live ledger — the ledger or the manifest was mutated independently`,
      );
    }

    if (!SOURCE_AVAILABILITY.has(entry.source_availability)) {
      errors.push(
        `manifest: '${version}' has unknown source_availability ` +
          `'${entry.source_availability}'`,
      );
    }

    // ------------------------------------------------------------------
    // ACTIVE-SOURCE BINDING.
    //
    // `sourceByVersion` holds the migrations that physically exist in
    // SOURCE_DIR and would actually run. Discovering them is not enough — the
    // manifest entry must be bound to THAT file. Without this binding a version
    // can sit in supabase/migrations while its manifest entry declares
    // source_availability="missing" (source_path and source_sha256 null), or
    // points at some other existing file: recovery evidence, docs, or a
    // different version. The anti-drift hash check below would then validate
    // the decoy while the migration that really runs is never hashed at all,
    // which defeats the guarantee this gate claims to make. So it fails closed.
    // ------------------------------------------------------------------
    const activeFile = sourceByVersion.get(version);
    if (activeFile !== undefined) {
      const activePath = `${SOURCE_DIR}/${activeFile}`;

      if (entry.source_availability === "missing") {
        errors.push(
          `manifest: '${version}' is classified 'missing' but an active migration ` +
            `exists at '${activePath}' — a migration that would run cannot be ` +
            `declared absent`,
        );
        continue;
      }

      if (entry.source_path !== activePath) {
        errors.push(
          `manifest: '${version}' names source_path '${entry.source_path}' but the ` +
            `active migration is '${activePath}' — proof must bind to the file that ` +
            `actually runs, not to recovery evidence, docs, or another version`,
        );
        continue;
      }

      const activeText = readSource(activePath);
      if (activeText === null) {
        errors.push(
          `manifest: '${version}' active migration '${activePath}' could not be read`,
        );
        continue;
      }

      const activeSha = sha256(activeText);
      if (entry.source_sha256 !== activeSha) {
        errors.push(
          `manifest: '${version}' records source_sha256 ${entry.source_sha256} but ` +
            `the active migration '${activePath}' hashes to ${activeSha}`,
        );
        continue;
      }
    }

    const sourcePath = entry.source_path;

    if (entry.source_availability === "missing") {
      if (sourcePath !== null) {
        errors.push(`manifest: '${version}' is 'missing' but names a source_path`);
      }
      if (entry.source_sha256 !== null) {
        errors.push(`manifest: '${version}' is 'missing' but records a source_sha256`);
      }
      continue;
    }

    if (typeof sourcePath !== "string" || !sourcePath) {
      errors.push(`manifest: '${version}' claims source but names no source_path`);
      continue;
    }

    const text = readSource(sourcePath);
    if (text === null) {
      errors.push(`manifest: '${version}' source_path '${sourcePath}' does not exist`);
      continue;
    }

    // Anti-drift: the committed file must still hash to what the manifest says.
    const actual = sha256(text);
    if (entry.source_sha256 !== actual) {
      errors.push(
        `manifest: '${version}' source '${sourcePath}' changed — manifest records ` +
          `${entry.source_sha256}, file hashes to ${actual}`,
      );
    }

    // Honesty: 'authentic' is a factual claim about equality with production.
    const equal = matchesProvider(text, live.statements_sha256);
    if (entry.source_availability === "authentic" && !equal) {
      errors.push(
        `manifest: '${version}' claims 'authentic' source but it does not hash ` +
          `to the provider statement content`,
      );
    }
    if (entry.source_availability === "sanitized" && equal) {
      errors.push(
        `manifest: '${version}' claims 'sanitized' but is byte-identical to ` +
          `production — classify it as 'authentic'`,
      );
    }
    if (entry.source_availability === "sanitized" && !entry.divergence_reason) {
      errors.push(
        `manifest: '${version}' is 'sanitized' but records no divergence_reason`,
      );
    }
  }

  // Every live migration must be accounted for.
  for (const version of ledgerVersions) {
    if (!manifestVersions.has(version)) {
      errors.push(
        `manifest: live migration '${version}' is unaccounted for — every applied ` +
          `migration must be classified, including as 'missing'`,
      );
    }
  }

  // An active migration with no manifest entry has no binding at all.
  for (const version of sourceByVersion.keys()) {
    if (!manifestVersions.has(version)) {
      errors.push(
        `source: '${version}' exists in ${SOURCE_DIR} but has no manifest entry — ` +
          `an active migration cannot be left unclassified`,
      );
    }
  }

  // Source tree must not contain a migration production has never seen.
  for (const version of sourceByVersion.keys()) {
    if (!ledgerVersions.has(version)) {
      errors.push(
        `source: '${version}' exists in ${SOURCE_DIR} but is not in the live ` +
          `ledger — it has never been applied to production`,
      );
    }
  }

  return errors;
}

function selfTest() {
  const providerSha = sha256("select 1");
  const ledger = {
    migrations: [
      { version: "20260101000000", name: "alpha", statements_sha256: providerSha },
    ],
  };
  const base = {
    version: "20260101000000",
    name: "alpha",
    provider_statements_sha256: providerSha,
    source_availability: "authentic",
    source_path: "supabase/migrations/20260101000000_alpha.sql",
    source_sha256: sha256("select 1"),
    divergence_reason: null,
  };
  const reader = (path) =>
    path === "supabase/migrations/20260101000000_alpha.sql" ? "select 1" : null;
  const empty = new Map();

  const cases = [
    ["valid baseline", { migrations: [{ ...base }] }, false],
    [
      "renamed live migration",
      { migrations: [{ ...base, name: "renamed" }] },
      true,
    ],
    [
      "provider hash drift",
      { migrations: [{ ...base, provider_statements_sha256: "b".repeat(64) }] },
      true,
    ],
    [
      "source content drift",
      { migrations: [{ ...base, source_sha256: "c".repeat(64) }] },
      true,
    ],
    [
      "authentic claim that does not match production",
      {
        migrations: [{
          ...base,
          source_path: "supabase/migrations/other.sql",
          source_sha256: sha256("select 2"),
        }],
      },
      true,
    ],
    [
      "duplicate manifest version",
      { migrations: [{ ...base }, { ...base }] },
      true,
    ],
    [
      "unaccounted live migration",
      { migrations: [] },
      true,
    ],
    [
      "missing entry that still names a source path",
      { migrations: [{ ...base, source_availability: "missing" }] },
      true,
    ],
    [
      "sanitized without a reason",
      {
        migrations: [{
          ...base,
          source_availability: "sanitized",
          source_path: "supabase/migrations/sanitized.sql",
          source_sha256: sha256("select 2"),
        }],
      },
      true,
    ],
    [
      "sanitized that is actually identical",
      {
        migrations: [{
          ...base,
          source_availability: "sanitized",
          divergence_reason: "documented",
        }],
      },
      true,
    ],
    [
      "unknown availability",
      { migrations: [{ ...base, source_availability: "probably_fine" }] },
      true,
    ],
  ];

  let failures = 0;
  for (const [label, manifest, shouldReject] of cases) {
    const errors = validate({
      ledger,
      manifest,
      sourceByVersion: empty,
      readSource: (path) =>
        path === "supabase/migrations/other.sql"
          ? "select 2"
          : path === "supabase/migrations/sanitized.sql"
          ? "select 2"
          : reader(path),
    });
    const rejected = errors.length > 0;
    if (rejected !== shouldReject) {
      console.error(
        `SELF-TEST FAIL: '${label}' expected ` +
          `${shouldReject ? "rejection" : "acceptance"}, got ` +
          `${rejected ? `rejection (${errors[0]})` : "acceptance"}`,
      );
      failures += 1;
    }
  }

  // ------------------------------------------------------------------
  // ACTIVE-SOURCE BINDING regressions.
  //
  // Each case puts a real migration in SOURCE_DIR (a non-empty sourceByVersion)
  // and asserts the manifest entry must bind to THAT exact file. Before the
  // binding existed, cases A, B and C all passed: the gate never compared the
  // manifest against the migration that would actually run.
  // ------------------------------------------------------------------
  const ACTIVE = "supabase/migrations/20260101000000_alpha.sql";
  const RECOVERED = "supabase/recovery/live-migrations/20260101000000_alpha.sql";
  const DECOY = "supabase/migrations/20260202000000_beta.sql";
  const active = new Map([["20260101000000", "20260101000000_alpha.sql"]]);

  // Every path that exists in this fixture world.
  const activeReader = (path) => {
    if (path === ACTIVE) return "select 1";
    if (path === RECOVERED) return "select 1";
    if (path === DECOY) return "select 1";
    return null;
  };

  const bindingCases = [
    [
      "A: active migration exists but manifest declares it missing",
      {
        migrations: [{
          ...base,
          source_availability: "missing",
          source_path: null,
          source_sha256: null,
        }],
      },
      true,
    ],
    [
      "B: manifest source_path redirects to a different existing file",
      { migrations: [{ ...base, source_path: DECOY }] },
      true,
    ],
    [
      "C: manifest points at recovery evidence for an active version",
      { migrations: [{ ...base, source_path: RECOVERED }] },
      true,
    ],
    [
      "D: active migration hash differs from the manifest hash",
      { migrations: [{ ...base, source_sha256: sha256("select 999") }] },
      true,
    ],
    [
      "E: valid active authentic migration",
      { migrations: [{ ...base }] },
      false,
    ],
    [
      "F: valid active sanitized migration with a documented divergence",
      {
        migrations: [{
          ...base,
          source_availability: "sanitized",
          source_sha256: sha256("select 1 -- owner uuid redacted"),
          divergence_reason: "owner principal UUID redacted from public source",
        }],
      },
      false,
    ],
    [
      "G: active migration with no manifest entry at all",
      { migrations: [] },
      true,
    ],
  ];

  for (const [label, manifest, shouldReject] of bindingCases) {
    // Case F deliberately diverges from production, so its file content must
    // differ from the provider statement content too.
    const sanitized = label.startsWith("F");
    const errors = validate({
      ledger,
      manifest,
      sourceByVersion: active,
      readSource: (path) =>
        sanitized && path === ACTIVE
          ? "select 1 -- owner uuid redacted"
          : activeReader(path),
    });
    const rejected = errors.length > 0;
    if (rejected !== shouldReject) {
      console.error(
        `SELF-TEST FAIL: '${label}' expected ` +
          `${shouldReject ? "rejection" : "acceptance"}, got ` +
          `${rejected ? `rejection (${errors[0]})` : "acceptance"}`,
      );
      failures += 1;
    }
  }

  // A source migration production never applied must be caught.
  const phantom = validate({
    ledger,
    manifest: { migrations: [{ ...base }] },
    sourceByVersion: new Map([["20991231235959", "20991231235959_phantom.sql"]]),
    readSource: reader,
  });
  if (!phantom.some((message) => message.includes("never been applied"))) {
    console.error("SELF-TEST FAIL: phantom source migration was not rejected");
    failures += 1;
  }

  if (failures > 0) exit(1);
  console.log(
    `Migration parity self-test passed (${cases.length + bindingCases.length + 1} cases, ` +
      `${bindingCases.length} of them active-source binding regressions).`,
  );
}

function main() {
  if (argv.includes("--self-test")) selfTest();

  const ledger = loadJson(LEDGER_PATH);
  const manifest = loadJson(MANIFEST_PATH);
  const { byVersion, duplicates } = sourceFilesByVersion(SOURCE_DIR);
  const recovery = sourceFilesByVersion(RECOVERY_DIR);

  const errors = validate({
    ledger,
    manifest,
    sourceByVersion: byVersion,
    readSource: (path) => (existsSync(path) ? readFileSync(path, "utf8") : null),
  });

  for (const version of duplicates) {
    errors.push(`source: duplicate migration version '${version}' in ${SOURCE_DIR}`);
  }
  for (const version of recovery.duplicates) {
    errors.push(`recovery: duplicate migration version '${version}' in ${RECOVERY_DIR}`);
  }

  // Recovery evidence must never be mistaken for an applied migration.
  for (const version of recovery.byVersion.keys()) {
    if (byVersion.has(version)) {
      errors.push(
        `recovery: '${version}' exists in both ${SOURCE_DIR} and ${RECOVERY_DIR} — ` +
          `recovery evidence must stay separate from active migrations`,
      );
    }
  }

  if (errors.length > 0) {
    console.error("Migration parity gate FAILED:");
    for (const message of errors) console.error(`  - ${message}`);
    exit(1);
  }

  const counts = {};
  for (const entry of manifest.migrations) {
    counts[entry.source_availability] = (counts[entry.source_availability] ?? 0) + 1;
  }
  const summary = Object.entries(counts)
    .sort()
    .map(([key, value]) => `${key}=${value}`)
    .join(", ");
  console.log(
    `Migration parity gate passed: ${ledger.migrations.length} live migrations, ` +
      `${manifest.migrations.length} classified (${summary}).`,
  );
}

main();
