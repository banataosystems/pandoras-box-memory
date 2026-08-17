#!/usr/bin/env node
// Materialize authentic historical migration SQL into recovery-only evidence.
//
// Why this is a separate operator tool rather than part of `npm run verify`:
//
//   * It needs provider read access, and `verify` must stay credential-free.
//   * Materializing provider SQL into the repository is a privacy decision, not
//     a mechanical one. At least one live migration (20260808220117) embeds an
//     owner principal UUID in an audit INSERT, which is exactly why canonical
//     source carries a sanitized form of it. Bulk-copying all 68 migrations into
//     git would re-import direct identifiers that were deliberately removed.
//
// So this tool refuses to write anything that fails a privacy scan, and every
// file it does write is hash-verified against the committed ledger first.
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
// Without --write it reports what would happen and changes nothing.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { argv, exit } from "node:process";

const LEDGER_PATH = "docs/migrations/LIVE_MIGRATION_LEDGER_2026-08-17.json";
const OUTPUT_DIR = "supabase/recovery/live-migrations";

const sha256 = (text) => createHash("sha256").update(text, "utf8").digest("hex");

/**
 * Patterns that must never enter committed recovery evidence.
 *
 * These are conservative: a false positive costs one manual sanitization, a
 * false negative commits a direct identifier or a credential to git forever.
 */
const PRIVACY_PATTERNS = [
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/, "email address"],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./, "JWT literal"],
  [/\bsb_secret_[A-Za-z0-9_-]{10,}/, "Supabase secret key"],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}/, "GitHub token"],
  [/-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/, "private key block"],
  [
    // A literal UUID inside an INSERT ... VALUES is runtime/audit data about a
    // specific principal, not schema. Schema DDL does not need one.
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

function main() {
  const inputPath = arg("--input");
  const write = argv.includes("--write");

  if (!inputPath) {
    console.error("Required: --input <provider-export.json>. See header for the query.");
    exit(2);
  }
  if (!existsSync(LEDGER_PATH)) {
    console.error(`Missing ${LEDGER_PATH}; cannot verify recovered content.`);
    exit(1);
  }

  const ledger = JSON.parse(readFileSync(LEDGER_PATH, "utf8"));
  const byVersion = new Map(ledger.migrations.map((entry) => [entry.version, entry]));
  const exported = JSON.parse(readFileSync(inputPath, "utf8"));

  const written = [];
  const blocked = [];
  const unverified = [];
  const unknown = [];

  for (const row of exported) {
    const live = byVersion.get(row.version);
    if (!live) {
      unknown.push(row.version);
      continue;
    }

    const sql = row.sql ?? "";

    // Hash-verify before anything else. Content that does not match the
    // committed ledger is not the artifact this repository claims to recover.
    if (sha256(sql) !== live.statements_sha256) {
      unverified.push(`${live.version} ${live.name}`);
      continue;
    }

    const findings = scanPrivacy(sql);
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

    const outputPath = `${OUTPUT_DIR}/${live.version}_${live.name}.sql`;
    if (write) {
      mkdirSync(OUTPUT_DIR, { recursive: true });
      writeFileSync(outputPath, `${header}${sql}\n`);
    }
    written.push(outputPath);
  }

  const report = (label, items) => {
    if (items.length === 0) return;
    console.log(`\n${label} (${items.length}):`);
    for (const item of items) console.log(`  - ${item}`);
  };

  console.log(
    `${write ? "Wrote" : "Would write"} ${written.length} recovery files ` +
      `of ${exported.length} exported rows.`,
  );
  report("BLOCKED by privacy scan — sanitize manually before committing", blocked);
  report("HASH MISMATCH against the committed ledger — not recovered", unverified);
  report("Not present in the committed ledger — refresh the ledger first", unknown);

  if (!write) {
    console.log("\nDry run. Re-run with --write to materialize.");
  }

  // Blocked and unverified rows are reportable outcomes, not tool failures: the
  // operator must decide. Unknown versions mean the ledger is stale.
  exit(unknown.length > 0 ? 1 : 0);
}

main();
