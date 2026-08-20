#!/usr/bin/env node
// Validate an authenticated read-only introspection readback against the three
// UNIQUE constraints the ProjectOS learning idempotency contract depends on.
//
// scripts/test_learning_idempotency_postgres.mjs proves those constraints are
// REQUIRED — it races concurrent backends and shows the duplicate that appears
// without them. It cannot prove PRODUCTION HAS THEM, because the defining
// migrations are classified `missing` and introspection was unavailable.
//
// This closes that loop from the other end: given a readback captured with
// docs/verification/introspection/PRODUCTION_UNIQUENESS_INTROSPECTION.sql, it
// decides whether production actually enforces them.
//
// TWO INDEPENDENT VERDICTS, AND BOTH MUST HOLD
//
//   1. CONSTRAINTS  — do the captured rows satisfy the requirement?
//   2. PROVENANCE   — is this an authenticated read-only capture from the
//                     Memory project, with enough metadata to say which
//                     project and schema produced it?
//
// They are separate because a fixture can satisfy (1) trivially. A fixture must
// never be able to close the gate, so (2) is enforced independently and the
// process exits non-zero unless BOTH hold. Everything here is offline: no
// network, no provider call, no database connection.

import { existsSync, readFileSync } from "node:fs";
import { argv, exit } from "node:process";

/** The exact idempotency keys, read off pandora-projectos-learning/index.ts. */
export const REQUIRED_KEYS = Object.freeze({
  memory_capture_candidates: ["user_id", "namespace", "source", "source_ref"],
  memory_review_queue_items: ["user_id", "namespace", "candidate_type", "source_ref"],
  memory_session_digests: ["user_id", "namespace", "source", "source_ref"],
});

/** Only the Memory project can close this gate. */
export const EXPECTED_PROJECT_REF = "ivmvufhcsezyhczzondn";
export const EXPECTED_SCHEMA = "public";

/**
 * Capture methods that count as authoritative. A fixture declares
 * `synthetic_fixture`, which is deliberately absent here — that is the
 * mechanism preventing a green self-test from closing the gate.
 */
export const AUTHORITATIVE_CAPTURE_METHODS = Object.freeze([
  "authenticated_read_only_sql",
  "authenticated_psql_read_only",
  "supabase_management_api_read_only",
]);

const isPlainObject = (value) =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Column order never changes which tuples collide, so compare as sets. */
function sameColumnSet(actual, expected) {
  if (!Array.isArray(actual)) return false;
  const left = new Set(actual);
  if (left.size !== actual.length) return false; // a repeated column is malformed
  if (left.size !== expected.length) return false;
  return expected.every((column) => left.has(column));
}

/** An index is unconditional when it carries no partial predicate. */
function isUnconditional(row) {
  const predicate = row.partial_predicate;
  return predicate === null || predicate === undefined || predicate === "";
}

function describeRow(row) {
  const columns = Array.isArray(row.unique_columns) ? row.unique_columns.join(", ") : "?";
  const parts = [`${row.index_name ?? "<unnamed>"} (${columns})`];
  if (row.is_unique !== true) parts.push("not unique");
  if (!isUnconditional(row)) parts.push(`partial: ${row.partial_predicate}`);
  return parts.join(" — ");
}

/**
 * Verdict 1: do the captured rows prove the required uniqueness?
 *
 * Exported and provenance-free so the self-test can exercise the constraint
 * logic directly on fixtures without any of them looking authoritative.
 */
export function validateConstraints(bundle) {
  const errors = [];
  const notes = [];

  if (!isPlainObject(bundle)) return { errors: ["bundle is not a JSON object"], notes };
  if (!Array.isArray(bundle.rows)) {
    return { errors: ["bundle.rows must be an array of index rows"], notes };
  }

  for (const [table, required] of Object.entries(REQUIRED_KEYS)) {
    const rows = bundle.rows.filter((row) => isPlainObject(row) && row.table_name === table);

    // A table absent from the capture is not a pass. It is an unknown.
    if (rows.length === 0) {
      errors.push(
        `${table}: no index rows were captured. An absent table cannot be read as ` +
          `satisfying anything — recapture including this table.`,
      );
      continue;
    }

    for (const row of rows) {
      if (typeof row.index_name !== "string" || row.index_name.trim() === "") {
        errors.push(`${table}: an index row has no index_name`);
      }
      if (typeof row.is_unique !== "boolean") {
        errors.push(
          `${table}: index '${row.index_name}' does not state is_unique as a boolean. ` +
            `Uniqueness is never inferred from omission.`,
        );
      }
      if (!Array.isArray(row.unique_columns)) {
        errors.push(`${table}: index '${row.index_name}' has no unique_columns array`);
      }
      if (
        row.partial_predicate !== null &&
        row.partial_predicate !== undefined &&
        typeof row.partial_predicate !== "string"
      ) {
        errors.push(`${table}: index '${row.index_name}' has a malformed partial_predicate`);
      }
    }

    const qualifying = rows.filter(
      (row) =>
        row.is_unique === true &&
        isUnconditional(row) &&
        sameColumnSet(row.unique_columns, required),
    );

    if (qualifying.length === 0) {
      // Explain precisely why, using the closest candidates.
      const uniqueRows = rows.filter((row) => row.is_unique === true);
      const partialMatch = uniqueRows.filter(
        (row) => !isUnconditional(row) && sameColumnSet(row.unique_columns, required),
      );
      const supersets = uniqueRows.filter(
        (row) =>
          Array.isArray(row.unique_columns) &&
          required.every((column) => row.unique_columns.includes(column)) &&
          row.unique_columns.length > required.length,
      );
      const subsets = uniqueRows.filter(
        (row) =>
          Array.isArray(row.unique_columns) &&
          row.unique_columns.every((column) => required.includes(column)) &&
          row.unique_columns.length < required.length,
      );

      let reason;
      if (partialMatch.length > 0) {
        reason =
          `the only exact-set unique index is PARTIAL (${partialMatch[0].partial_predicate}), ` +
          `so it does not enforce uniqueness across all rows`;
      } else if (supersets.length > 0) {
        reason =
          `a unique index exists over a SUPERSET (${supersets[0].unique_columns.join(", ")}), ` +
          `which permits duplicates of the required key`;
      } else if (subsets.length > 0) {
        reason =
          `a unique index exists over a SUBSET (${subsets[0].unique_columns.join(", ")}), ` +
          `which is a different constraint than the one relied upon`;
      } else if (uniqueRows.length === 0) {
        reason = "no unique index exists on this table at all";
      } else {
        reason =
          `no unique index covers exactly {${required.join(", ")}}; captured: ` +
          rows.map(describeRow).join(" | ");
      }
      errors.push(
        `${table}: requires an unconditional UNIQUE over exactly ` +
          `{${required.join(", ")}} — ${reason}`,
      );
      continue;
    }

    // Several exact-set unconditional unique indexes still enforce the same
    // thing, so that is not ambiguity. Contradictory rows sharing one index
    // name are, and cannot be resolved from the capture.
    const byName = new Map();
    for (const row of qualifying) {
      const existing = byName.get(row.index_name);
      if (!existing) {
        byName.set(row.index_name, row);
        continue;
      }
      const conflicting =
        existing.is_unique !== row.is_unique ||
        existing.partial_predicate !== row.partial_predicate ||
        existing.nulls_not_distinct !== row.nulls_not_distinct ||
        !sameColumnSet(existing.unique_columns, row.unique_columns);
      if (conflicting) {
        errors.push(
          `${table}: index '${row.index_name}' appears more than once with ` +
            `conflicting attributes, so the capture is ambiguous and cannot be trusted`,
        );
      }
    }
    if (qualifying.length > 1) {
      notes.push(
        `${table}: ${qualifying.length} unconditional exact-set unique indexes ` +
          `(${qualifying.map((row) => row.index_name).join(", ")}); the verdict is ` +
          `unchanged because any one of them enforces the key`,
      );
    }

    // ---- NULL semantics -------------------------------------------------
    // Under default NULLS DISTINCT, a unique index does not deduplicate rows
    // whose key contains NULL. So a nullable key column means the constraint is
    // not equivalent to full idempotency protection, and the checker must say
    // so rather than pass quietly.
    const nullability = bundle.column_nullability?.[table];
    if (!isPlainObject(nullability)) {
      errors.push(
        `${table}: column_nullability was not captured, so NULL semantics cannot ` +
          `be evaluated. Refusing to conclude.`,
      );
      continue;
    }

    const unknown = required.filter((column) => typeof nullability[column] !== "boolean");
    if (unknown.length > 0) {
      errors.push(
        `${table}: nullability is unknown for ${unknown.join(", ")}. Refusing to conclude.`,
      );
      continue;
    }

    const nullableKeyColumns = required.filter((column) => nullability[column] === true);
    for (const row of qualifying) {
      if (typeof row.nulls_not_distinct !== "boolean") {
        errors.push(
          `${table}: index '${row.index_name}' does not state nulls_not_distinct`,
        );
      }
    }
    if (nullableKeyColumns.length > 0) {
      const anyNullsNotDistinct = qualifying.some((row) => row.nulls_not_distinct === true);
      if (!anyNullsNotDistinct) {
        errors.push(
          `${table}: key column(s) ${nullableKeyColumns.join(", ")} are NULLABLE and the ` +
            `qualifying index uses default NULLS DISTINCT semantics. PostgreSQL then ` +
            `treats NULL keys as never equal, so duplicate rows remain possible and this ` +
            `is NOT equivalent to full idempotency protection.`,
        );
      } else {
        notes.push(
          `${table}: key column(s) ${nullableKeyColumns.join(", ")} are nullable, but a ` +
            `qualifying index declares NULLS NOT DISTINCT, so NULL keys still collide`,
        );
      }
    }

    notes.push(
      `${table}: satisfied by ${qualifying
        .map((row) => `${row.index_name}${row.constraint_name ? " (constraint)" : " (bare unique index)"}`)
        .join(", ")}; nulls_not_distinct=${qualifying
        .map((row) => row.nulls_not_distinct)
        .join(",")}`,
    );
  }

  return { errors, notes };
}

/**
 * Verdict 2: is this an authoritative capture, or something someone typed?
 *
 * Kept entirely separate from the constraint logic. A bundle can satisfy every
 * constraint and still be refused here, which is the point.
 */
export function validateProvenance(bundle) {
  const errors = [];
  const provenance = isPlainObject(bundle) ? bundle.provenance : undefined;

  if (!isPlainObject(provenance)) {
    return { errors: ["bundle.provenance is missing — the capture's origin is unknown"] };
  }
  if (provenance.project_ref !== EXPECTED_PROJECT_REF) {
    errors.push(
      `provenance.project_ref is '${provenance.project_ref}', but only ` +
        `'${EXPECTED_PROJECT_REF}' can close this gate`,
    );
  }
  if (provenance.database_schema !== EXPECTED_SCHEMA) {
    errors.push(
      `provenance.database_schema is '${provenance.database_schema}', expected '${EXPECTED_SCHEMA}'`,
    );
  }
  if (!AUTHORITATIVE_CAPTURE_METHODS.includes(provenance.capture_method)) {
    errors.push(
      `provenance.capture_method '${provenance.capture_method}' is not an authoritative ` +
        `read-only capture (expected one of: ${AUTHORITATIVE_CAPTURE_METHODS.join(", ")})`,
    );
  }
  if (provenance.authenticated !== true) {
    errors.push("provenance.authenticated must be true");
  }
  if (provenance.read_only !== true) {
    errors.push("provenance.read_only must be true");
  }
  if (typeof provenance.captured_at !== "string" || provenance.captured_at.trim() === "") {
    errors.push("provenance.captured_at must record when the capture was taken");
  }
  if (typeof provenance.captured_by !== "string" || provenance.captured_by.trim() === "") {
    errors.push("provenance.captured_by must record who or what ran the query");
  }
  if (!/^[0-9a-f]{64}$/u.test(provenance.query_sha256 ?? "")) {
    errors.push(
      "provenance.query_sha256 must be the SHA-256 of the exact query text that was run",
    );
  }

  return { errors };
}

// ---------------------------------------------------------------------------
// Fixtures. Every one declares capture_method 'synthetic_fixture', so none can
// ever be mistaken for a production readback.
// ---------------------------------------------------------------------------

const FIXTURE_PROVENANCE = Object.freeze({
  provider: "postgresql",
  project_ref: "synthetic",
  database_schema: "public",
  capture_method: "synthetic_fixture",
  authenticated: false,
  read_only: true,
  captured_at: "2026-08-18T00:00:00Z",
  captured_by: "self-test",
});

const nullability = (table, overrides = {}) => ({
  [table]: Object.fromEntries(
    REQUIRED_KEYS[table].map((column) => [column, overrides[column] ?? false]),
  ),
});

function row(table, columns, overrides = {}) {
  return {
    table_name: table,
    index_name: `${table}_idem`,
    constraint_name: `${table}_idem`,
    constraint_type: "u",
    is_unique: true,
    unique_columns: columns,
    partial_predicate: null,
    nulls_not_distinct: false,
    ...overrides,
  };
}

/** A bundle satisfying every table, used as the baseline to mutate. */
function goodBundle() {
  const rows = [];
  let columnNullability = {};
  for (const [table, key] of Object.entries(REQUIRED_KEYS)) {
    rows.push(row(table, [...key]));
    columnNullability = { ...columnNullability, ...nullability(table) };
  }
  return { provenance: { ...FIXTURE_PROVENANCE }, rows, column_nullability: columnNullability };
}

function mutate(change) {
  const bundle = structuredClone(goodBundle());
  change(bundle);
  return bundle;
}

function selfTest() {
  let failures = 0;
  const check = (label, bundle, shouldReject, pattern) => {
    const { errors } = validateConstraints(bundle);
    const rejected = errors.length > 0;
    if (rejected !== shouldReject) {
      console.error(
        `SELF-TEST FAIL: '${label}' expected ${shouldReject ? "rejection" : "acceptance"}, got ` +
          `${rejected ? `rejection (${errors[0]})` : "acceptance"}`,
      );
      failures += 1;
      return;
    }
    if (rejected && pattern && !errors.some((error) => pattern.test(error))) {
      console.error(`SELF-TEST FAIL: '${label}' rejected for the wrong reason: ${errors[0]}`);
      failures += 1;
      return;
    }
    console.log(`  ok  ${label}`);
  };

  console.log("constraint verdict:");
  check("all three keys present and unconditional", goodBundle(), false);

  check(
    "wrong columns",
    mutate((b) => {
      b.rows[0].unique_columns = ["user_id", "namespace", "source", "tenant_id"];
    }),
    true,
    /unconditional UNIQUE over exactly/,
  );

  check(
    "extra column in the same unique key",
    mutate((b) => {
      b.rows[0].unique_columns = [...REQUIRED_KEYS.memory_capture_candidates, "created_at"];
    }),
    true,
    /SUPERSET/,
  );

  check(
    "missing column from the unique key",
    mutate((b) => {
      b.rows[0].unique_columns = ["user_id", "namespace", "source"];
    }),
    true,
    /SUBSET/,
  );

  check(
    "index present but not unique",
    mutate((b) => {
      b.rows[0].is_unique = false;
    }),
    true,
    /no unique index exists on this table at all/,
  );

  check(
    "partial unique index",
    mutate((b) => {
      b.rows[0].partial_predicate = "(archived = false)";
    }),
    true,
    /PARTIAL/,
  );

  // The exact shape observed in the local PostgreSQL 16 rehearsal: digests
  // expressed as a bare partial unique index rather than a constraint.
  check(
    "memory_session_digests as a PARTIAL bare unique index (local rehearsal shape)",
    mutate((b) => {
      const digest = b.rows.find((r) => r.table_name === "memory_session_digests");
      digest.index_name = "memory_session_digests_idem_idx";
      digest.constraint_name = null;
      digest.constraint_type = null;
      digest.partial_predicate = "(archived = false)";
    }),
    true,
    /PARTIAL/,
  );

  check(
    "bare UNIQUE INDEX with no constraint is acceptable",
    mutate((b) => {
      const digest = b.rows.find((r) => r.table_name === "memory_session_digests");
      digest.index_name = "memory_session_digests_idem_idx";
      digest.constraint_name = null;
      digest.constraint_type = null;
    }),
    false,
  );

  check(
    "column order does not matter",
    mutate((b) => {
      b.rows[0].unique_columns = ["source_ref", "source", "namespace", "user_id"];
    }),
    false,
  );

  check(
    "missing table in the capture",
    mutate((b) => {
      b.rows = b.rows.filter((r) => r.table_name !== "memory_review_queue_items");
    }),
    true,
    /no index rows were captured/,
  );

  check(
    "is_unique omitted entirely",
    mutate((b) => {
      delete b.rows[0].is_unique;
    }),
    true,
    /never inferred from omission/,
  );

  check(
    "column nullability not captured",
    mutate((b) => {
      delete b.column_nullability.memory_capture_candidates;
    }),
    true,
    /Refusing to conclude/,
  );

  check(
    "nullable key column under default NULLS DISTINCT",
    mutate((b) => {
      b.column_nullability.memory_capture_candidates.source_ref = true;
    }),
    true,
    /NOT equivalent to full idempotency protection/,
  );

  check(
    "nullable key column rescued by NULLS NOT DISTINCT",
    mutate((b) => {
      b.column_nullability.memory_capture_candidates.source_ref = true;
      b.rows[0].nulls_not_distinct = true;
    }),
    false,
  );

  check(
    "same index name repeated with conflicting attributes",
    mutate((b) => {
      const duplicate = structuredClone(b.rows[0]);
      duplicate.nulls_not_distinct = true;
      b.rows.push(duplicate);
    }),
    true,
    /appears more than once with conflicting attributes/,
  );

  check(
    "two distinct exact-set unconditional unique indexes are not ambiguous",
    mutate((b) => {
      const duplicate = structuredClone(b.rows[0]);
      duplicate.index_name = `${duplicate.index_name}_mirror`;
      duplicate.constraint_name = null;
      duplicate.constraint_type = null;
      b.rows.push(duplicate);
    }),
    false,
  );

  console.log("\nprovenance verdict:");
  const provenanceCheck = (label, bundle, shouldReject) => {
    const rejected = validateProvenance(bundle).errors.length > 0;
    if (rejected !== shouldReject) {
      console.error(
        `SELF-TEST FAIL: '${label}' expected ${shouldReject ? "rejection" : "acceptance"}`,
      );
      failures += 1;
      return;
    }
    console.log(`  ok  ${label}`);
  };

  // THE LOAD-BEARING TEST: a fixture that satisfies every constraint must still
  // be refused, because it is not an authenticated capture from the Memory
  // project. This is what stops a green self-test from closing PR #32.
  const perfectFixture = goodBundle();
  if (validateConstraints(perfectFixture).errors.length !== 0) {
    console.error("SELF-TEST FAIL: baseline fixture should satisfy the constraints");
    failures += 1;
  }
  provenanceCheck("a constraint-satisfying FIXTURE is not authoritative", perfectFixture, true);

  const authoritative = {
    ...goodBundle(),
    provenance: {
      provider: "supabase",
      project_ref: EXPECTED_PROJECT_REF,
      database_schema: "public",
      capture_method: "authenticated_read_only_sql",
      authenticated: true,
      read_only: true,
      captured_at: "2026-08-18T00:00:00Z",
      captured_by: "owner via Supabase SQL editor",
      query_sha256: "a".repeat(64),
    },
  };
  provenanceCheck("an authenticated capture from the Memory project", authoritative, false);
  provenanceCheck(
    "the right shape but the wrong project",
    { ...authoritative, provenance: { ...authoritative.provenance, project_ref: "someotherproject" } },
    true,
  );
  provenanceCheck(
    "authenticated=false",
    { ...authoritative, provenance: { ...authoritative.provenance, authenticated: false } },
    true,
  );
  provenanceCheck(
    "no query_sha256",
    { ...authoritative, provenance: { ...authoritative.provenance, query_sha256: undefined } },
    true,
  );
  provenanceCheck("no provenance block at all", { rows: [] }, true);

  if (failures > 0) {
    console.error(`\nSelf-test FAILED: ${failures} case(s).`);
    exit(1);
  }
  console.log(
    "\nProduction idempotency constraint checker self-test passed. " +
      "NOTE: fixtures can never close the PR #32 gate — only an authenticated " +
      `read-only capture from project ${EXPECTED_PROJECT_REF} can.`,
  );
}

function main() {
  if (argv.includes("--self-test")) {
    selfTest();
    return;
  }

  const path = argv[2];
  if (!path) {
    console.error(
      "Usage: node scripts/check_production_idempotency_constraints.mjs <bundle.json>\n" +
        "       node scripts/check_production_idempotency_constraints.mjs --self-test\n\n" +
        "Capture the bundle with " +
        "docs/verification/introspection/PRODUCTION_UNIQUENESS_INTROSPECTION.sql.",
    );
    exit(1);
  }
  if (!existsSync(path)) {
    console.error(`No such introspection bundle: ${path}`);
    exit(1);
  }

  let bundle;
  try {
    bundle = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    console.error(`${path} is not valid JSON: ${error.message}`);
    exit(1);
  }

  const constraints = validateConstraints(bundle);
  const provenance = validateProvenance(bundle);

  for (const note of constraints.notes) console.log(`  note: ${note}`);

  if (constraints.errors.length > 0) {
    console.error("\nRequired uniqueness NOT proven:");
    for (const message of constraints.errors) console.error(`  - ${message}`);
  }
  if (provenance.errors.length > 0) {
    console.error("\nCapture is NOT authoritative:");
    for (const message of provenance.errors) console.error(`  - ${message}`);
  }

  if (constraints.errors.length > 0 || provenance.errors.length > 0) {
    console.error(
      "\nPR #32 production-schema gate REMAINS OPEN. Both the constraint verdict " +
        "and the provenance verdict must hold, and a fixture never satisfies the latter.",
    );
    exit(1);
  }

  console.log(
    `\nAll three idempotency keys are enforced by unconditional UNIQUE indexes in ` +
      `project ${EXPECTED_PROJECT_REF}, captured ${bundle.provenance.captured_at} by ` +
      `${bundle.provenance.captured_by}.`,
  );
  console.log(
    "This closes the production-schema portion of the PR #32 gate. Independent " +
      "review of the exact head is still required, and this proves nothing about " +
      "deployment or production verification.",
  );
}

main();
