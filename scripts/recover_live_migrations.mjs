#!/usr/bin/env node
// Materialize authentic historical migration SQL into recovery-only evidence.
//
// Provider reads are credentialed and privacy-sensitive, so this operator tool
// stays outside the credential-free verify command. It is deliberately strict:
//
//   * every provider row must match the committed live-ledger hash;
//   * the export must cover every ledger identity exactly once;
//   * privacy findings, hash mismatches, unknown/missing/duplicate rows, and
//     conflicting existing files make the recovery incomplete;
//   * `--write` is all-or-nothing by default;
//   * `--write --allow-partial` may materialize only verified safe rows, but
//     still exits non-zero so automation cannot call partial recovery success;
//   * existing recovery evidence is never overwritten with different bytes.
//
// Usage:
//   1. Export from the provider (read-only, applies nothing):
//
//        select json_agg(json_build_object(
//          'version', version,
//          'sql', array_to_string(statements, E';\n')
//        ))
//        from supabase_migrations.schema_migrations;
//
//   2. Save that JSON array to a file, then:
//
//        node scripts/recover_live_migrations.mjs --input export.json
//        node scripts/recover_live_migrations.mjs --input export.json --write
//
// Explicit partial materialization, when needed for manual recovery work:
//
//        node scripts/recover_live_migrations.mjs \
//          --input export.json --write --allow-partial

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { argv, exit } from "node:process";

const LEDGER_PATH = "docs/migrations/LIVE_MIGRATION_LEDGER_2026-08-17.json";
const OUTPUT_DIR = "supabase/recovery/live-migrations";
const PARTIAL_EXIT = 3;

const sha256 = (text) => createHash("sha256").update(text, "utf8").digest("hex");

const PRIVACY_PATTERNS = [
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/, "email address"],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./, "JWT literal"],
  [/\bsb_secret_[A-Za-z0-9_-]{10,}/, "Supabase secret key"],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}/, "GitHub token"],
  [/-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/, "private key block"],
  [
    /insert\s+into[\s\S]{0,4000}?values[\s\S]{0,4000}?'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'/i,
    "principal UUID in an INSERT ... VALUES",
  ],
];

function scanPrivacy(sql) {
  return PRIVACY_PATTERNS.filter(([pattern]) => pattern.test(sql)).map(
    ([, label]) => label,
  );
}

function arg(flag) {
  const index = argv.indexOf(flag);
  return index !== -1 && argv[index + 1] ? argv[index + 1] : null;
}

function decide({ write, allowPartial, ready, incomplete }) {
  if (incomplete === 0) {
    return {
      status: write ? "complete_written" : "complete_dry_run",
      shouldWrite: write,
      exitCode: 0,
    };
  }
  if (write && allowPartial && ready > 0) {
    return {
      status: "partial_written_incomplete",
      shouldWrite: true,
      exitCode: PARTIAL_EXIT,
    };
  }
  return {
    status: write ? "incomplete_not_written" : "incomplete_dry_run",
    shouldWrite: false,
    exitCode: 1,
  };
}

function selfTest() {
  const cases = [
    ["complete dry run", { write: false, allowPartial: false, ready: 68, incomplete: 0 }, "complete_dry_run", false, 0],
    ["complete write", { write: true, allowPartial: false, ready: 68, incomplete: 0 }, "complete_written", true, 0],
    ["privacy-blocked dry run", { write: false, allowPartial: false, ready: 67, incomplete: 1 }, "incomplete_dry_run", false, 1],
    ["hash mismatch write", { write: true, allowPartial: false, ready: 67, incomplete: 1 }, "incomplete_not_written", false, 1],
    ["missing export row", { write: true, allowPartial: false, ready: 67, incomplete: 1 }, "incomplete_not_written", false, 1],
    ["explicit partial write", { write: true, allowPartial: true, ready: 67, incomplete: 1 }, "partial_written_incomplete", true, PARTIAL_EXIT],
    ["partial requested but nothing safe", { write: true, allowPartial: true, ready: 0, incomplete: 68 }, "incomplete_not_written", false, 1],
  ];

  let failures = 0;
  for (const [label, input, status, shouldWrite, exitCode] of cases) {
    const actual = decide(input);
    if (
      actual.status !== status ||
      actual.shouldWrite !== shouldWrite ||
      actual.exitCode !== exitCode
    ) {
      console.error(`SELF-TEST FAIL: ${label}`);
      failures += 1;
    }
  }
  if (failures > 0) exit(1);
  console.log(`Migration recovery materializer self-test passed (${cases.length} cases).`);
}

function main() {
  if (argv.includes("--self-test")) {
    selfTest();
    return;
  }

  const inputPath = arg("--input");
  const write = argv.includes("--write");
  const allowPartial = argv.includes("--allow-partial");

  if (allowPartial && !write) {
    console.error("--allow-partial is valid only with --write.");
    exit(2);
  }
  if (!inputPath) {
    console.error("Required: --input <provider-export.json>. See header for the query.");
    exit(2);
  }
  if (!existsSync(LEDGER_PATH)) {
    console.error(`Missing ${LEDGER_PATH}; cannot verify recovered content.`);
    exit(1);
  }

  let ledger;
  let exported;
  try {
    ledger = JSON.parse(readFileSync(LEDGER_PATH, "utf8"));
    exported = JSON.parse(readFileSync(inputPath, "utf8"));
  } catch (error) {
    console.error(`Invalid JSON input: ${error.message}`);
    exit(2);
  }
  if (!Array.isArray(ledger?.migrations) || !Array.isArray(exported)) {
    console.error("Ledger migrations and provider export must both be JSON arrays.");
    exit(2);
  }

  const byVersion = new Map(ledger.migrations.map((entry) => [entry.version, entry]));
  const seen = new Set();
  const candidates = [];
  const blocked = [];
  const unverified = [];
  const unknown = [];
  const duplicates = [];
  const invalid = [];

  for (const [index, row] of exported.entries()) {
    if (!row || typeof row.version !== "string" || typeof row.sql !== "string") {
      invalid.push(`row ${index}: expected string version and sql`);
      continue;
    }
    if (seen.has(row.version)) {
      duplicates.push(row.version);
      continue;
    }
    seen.add(row.version);

    const live = byVersion.get(row.version);
    if (!live) {
      unknown.push(row.version);
      continue;
    }

    if (sha256(row.sql) !== live.statements_sha256) {
      unverified.push(`${live.version} ${live.name}`);
      continue;
    }

    const findings = scanPrivacy(row.sql);
    if (findings.length > 0) {
      blocked.push(`${live.version} ${live.name} — ${findings.join(", ")}`);
      continue;
    }

    const authenticity = live.whole_file_text_retained
      ? "authentic original migration file text as retained by the provider"
      : "authentic statement text as retained by the provider; inter-statement " +
        "file framing (comments, blank lines) is NOT original and was reconstructed " +
        "by joining statements with ';'";

    const header = [
      "-- RECOVERY EVIDENCE — NOT AN ACTIVE MIGRATION.",
      "--",
      `-- version:        ${live.version}`,
      `-- name:           ${live.name}`,
      `-- provider:       supabase/${ledger.provider_resource_id}`,
      `-- observed_at:    ${ledger.observed_at}`,
      `-- sha256:         ${live.statements_sha256}`,
      `-- statements:     ${live.statement_count}`,
      `-- authenticity:   ${authenticity}`,
      "--",
      "-- This file exists so a future operator can understand and reproduce the",
      "-- live database with documented provenance. It is deliberately outside",
      "-- supabase/migrations so it can never be replayed as a pending migration.",
      "",
    ].join("\n");

    candidates.push({
      outputPath: `${OUTPUT_DIR}/${live.version}_${live.name}.sql`,
      content: `${header}${row.sql}\n`,
    });
  }

  const missing = ledger.migrations
    .filter((entry) => !seen.has(entry.version))
    .map((entry) => `${entry.version} ${entry.name}`);
  const conflicts = candidates
    .filter(
      ({ outputPath, content }) =>
        existsSync(outputPath) && readFileSync(outputPath, "utf8") !== content,
    )
    .map(({ outputPath }) => outputPath);

  const incomplete =
    blocked.length +
    unverified.length +
    unknown.length +
    duplicates.length +
    invalid.length +
    missing.length +
    conflicts.length;
  const decision = decide({
    write,
    allowPartial,
    ready: candidates.length - conflicts.length,
    incomplete,
  });

  const report = (label, items) => {
    if (items.length === 0) return;
    console.log(`\n${label} (${items.length}):`);
    for (const item of items) console.log(`  - ${item}`);
  };

  report("BLOCKED by privacy scan — sanitize manually before committing", blocked);
  report("HASH MISMATCH against the committed ledger — not recovered", unverified);
  report("Not present in the committed ledger — refresh the ledger first", unknown);
  report("Duplicate provider-export versions", duplicates);
  report("Invalid provider-export rows", invalid);
  report("Ledger identities missing from the provider export", missing);
  report("Existing recovery files have different bytes — never overwritten", conflicts);

  const writable = candidates.filter(({ outputPath }) => !conflicts.includes(outputPath));
  let newFiles = 0;
  let alreadyPresent = 0;
  if (decision.shouldWrite) {
    mkdirSync(OUTPUT_DIR, { recursive: true });
    for (const { outputPath, content } of writable) {
      if (existsSync(outputPath)) {
        alreadyPresent += 1;
        continue;
      }
      writeFileSync(outputPath, content, { flag: "wx" });
      newFiles += 1;
    }
  }

  if (!write) {
    console.log("\nDry run; no files were written.");
  } else if (!decision.shouldWrite) {
    console.log("\nIncomplete recovery; no files were written. Use --allow-partial only for explicit manual recovery work.");
  } else if (decision.exitCode === PARTIAL_EXIT) {
    console.log("\nPARTIAL recovery materialized by explicit request; exit status remains non-zero.");
  }

  const result = {
    status: decision.status,
    exit_code: decision.exitCode,
    ledger_rows: ledger.migrations.length,
    exported_rows: exported.length,
    verified_safe_rows: candidates.length,
    new_files_written: newFiles,
    identical_files_already_present: alreadyPresent,
    privacy_blocked: blocked.length,
    hash_mismatches: unverified.length,
    unknown_versions: unknown.length,
    duplicate_versions: duplicates.length,
    invalid_rows: invalid.length,
    missing_versions: missing.length,
    conflicting_existing_files: conflicts.length,
    complete: incomplete === 0,
  };
  console.log(`\nRECOVERY_RESULT ${JSON.stringify(result)}`);
  exit(decision.exitCode);
}

main();
