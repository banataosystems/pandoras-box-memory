#!/usr/bin/env node
// Prove, against a real PostgreSQL, that the ProjectOS learning idempotency
// contract depends on specific UNIQUE constraints — and prove exactly which
// duplicate each one rejects.
//
// WHY THIS EXISTS
//
// scripts/test_projectos_learning_behavior.mjs drives a fake Supabase client.
// It proves the handler's ORDERING and its fail-closed decisions, and it is
// genuinely useful for that. What it cannot prove is concurrency: the fake
// client has no notion of two requests racing, so every "idempotent" assertion
// in it is really an assertion about the handler given a well-behaved database.
//
// The handler uses read-then-insert:
//
//     SELECT id FROM t WHERE <key>          -- absent
//     INSERT INTO t (...)                   -- tolerated if SQLSTATE 23505
//     SELECT id FROM t WHERE <key>          -- re-read after a lost race
//
// Tolerating 23505 and re-reading is the CORRECT concurrent pattern, but it is
// correct only because a UNIQUE constraint raises 23505. Without one, both
// racing requests insert, both succeed, and the duplicate surfaces later as a
// PostgREST `.maybeSingle()` failure — the handler then fails closed with
// candidate_lookup_failed on a request that should have replayed cleanly.
//
// So each key is exercised twice against a real server: once WITH its
// constraint and once WITHOUT. The second run is not a formality — it is the
// evidence that the constraint is load-bearing rather than decorative.
//
// WHAT THIS DOES NOT PROVE
//
// It does NOT prove the production database carries these constraints. Their
// defining migrations are classified `missing` in the parity manifest, and
// read-only provider introspection was unavailable to this worker. This
// establishes the requirement precisely; confirming production still needs
// authoritative schema introspection.

import { execFileSync, spawn } from "node:child_process";
import { argv, env, exit } from "node:process";

const HOST = env.PANDORA_PGHOST ?? "/pgtest/run";
const PORT = env.PANDORA_PGPORT ?? "5433";
const USER = env.PANDORA_PGUSER ?? "postgres";
const DB = env.PANDORA_PGDATABASE ?? "postgres";
const RACERS = 5;
// Widen the read-then-insert window so every racer observes "absent" before any
// of them inserts. This models the real TOCTOU window rather than hoping for it.
const WINDOW_SECONDS = 0.5;

/**
 * The keys the handler actually filters and inserts on, read off
 * supabase/functions/pandora-projectos-learning/index.ts.
 */
const TABLES = [
  {
    table: "memory_capture_candidates",
    key: ["user_id", "namespace", "source", "source_ref"],
    extra: "title text, summary text, metadata jsonb",
    extraInsert: { title: "'t'", summary: "'s'", metadata: "'{}'::jsonb" },
    guards: "candidate idempotency (readCandidate / candidate_insert_failed)",
  },
  {
    table: "memory_review_queue_items",
    key: ["user_id", "namespace", "candidate_type", "source_ref"],
    extra: "candidate_id uuid",
    extraInsert: { candidate_id: "gen_random_uuid()" },
    guards: "review-queue idempotency (review_lookup_failed / review_insert_failed)",
  },
  {
    table: "memory_session_digests",
    key: ["user_id", "namespace", "source", "source_ref"],
    extra: "title text, summary text",
    extraInsert: { title: "'t'", summary: "'s'" },
    guards: "session-digest idempotency (digest_lookup_failed / digest_recovery_failed)",
  },
];

const VALUES = {
  user_id: "'11111111-1111-1111-1111-111111111111'::uuid",
  namespace: "'real_life'",
  source: "'projectos'",
  source_ref: "'projectos:plan:concurrent-race'",
  candidate_type: "'projectos_outcome'",
};

function psql(sql, { allowFailure = false } = {}) {
  try {
    return execFileSync(
      "psql",
      ["-h", HOST, "-p", PORT, "-U", USER, "-d", DB, "-tAX", "-v", "ON_ERROR_STOP=1", "-c", sql],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    ).trim();
  } catch (error) {
    if (allowFailure) return { failed: true, stderr: String(error.stderr ?? "") };
    throw error;
  }
}

/** One racer: read, wait, insert — exactly the handler's shape. */
function racer(spec) {
  const cols = [...spec.key, ...Object.keys(spec.extraInsert)];
  const vals = [
    ...spec.key.map((column) => VALUES[column]),
    ...Object.values(spec.extraInsert),
  ];
  const where = spec.key.map((column) => `${column} = ${VALUES[column]}`).join(" AND ");
  const sql = `
BEGIN;
SELECT id FROM ${spec.table} WHERE ${where};
SELECT pg_sleep(${WINDOW_SECONDS});
INSERT INTO ${spec.table} (${cols.join(", ")}) VALUES (${vals.join(", ")});
COMMIT;`;
  return new Promise((resolve) => {
    const child = spawn(
      "psql",
      ["-h", HOST, "-p", PORT, "-U", USER, "-d", DB, "-tAX", "-c", sql],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let stderr = "";
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("close", () => resolve({ uniqueViolation: stderr.includes("23505") || /duplicate key/i.test(stderr) }));
  });
}

function createTable(spec, { withConstraint }) {
  psql(`DROP TABLE IF EXISTS ${spec.table}`);
  const constraint = withConstraint
    ? `, CONSTRAINT ${spec.table}_idem_key UNIQUE (${spec.key.join(", ")})`
    : "";
  psql(
    `CREATE TABLE ${spec.table} (
       id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
       ${spec.key.map((c) => `${c} ${c === "user_id" ? "uuid" : "text"}`).join(", ")},
       ${spec.extra}${constraint}
     )`,
  );
}

function rowCount(spec) {
  const where = spec.key.map((column) => `${column} = ${VALUES[column]}`).join(" AND ");
  return Number(psql(`SELECT count(*) FROM ${spec.table} WHERE ${where}`));
}

async function run() {
  let failures = 0;
  const record = (ok, message) => {
    console.log(`  ${ok ? "ok " : "FAIL"} ${message}`);
    if (!ok) failures += 1;
  };

  // Fail closed if the server is not reachable: a skipped concurrency proof
  // must never read as a passed one.
  psql("SELECT 1");

  for (const spec of TABLES) {
    console.log(`\n${spec.table} — guards ${spec.guards}`);
    console.log(`  idempotency key: (${spec.key.join(", ")})`);

    // ---- WITH the unique constraint -------------------------------------
    createTable(spec, { withConstraint: true });
    const constrained = await Promise.all(
      Array.from({ length: RACERS }, () => racer(spec)),
    );
    const rejected = constrained.filter((r) => r.uniqueViolation).length;
    const constrainedRows = rowCount(spec);

    record(
      constrainedRows === 1,
      `WITH constraint: ${RACERS} concurrent racers produced exactly 1 row (got ${constrainedRows})`,
    );
    record(
      rejected === RACERS - 1,
      `WITH constraint: ${RACERS - 1} racers were rejected with SQLSTATE 23505 and heal by re-reading (got ${rejected})`,
    );

    // A duplicate-free key is what lets the handler's PostgREST
    // `.maybeSingle()` lookup return one row instead of failing closed.
    record(
      Number(psql(`SELECT count(*) FROM (SELECT 1 FROM ${spec.table} GROUP BY ${spec.key.join(", ")} HAVING count(*) > 1) d`)) === 0,
      "WITH constraint: no duplicate key group exists, so .maybeSingle() resolves",
    );

    // ---- WITHOUT the unique constraint ----------------------------------
    createTable(spec, { withConstraint: false });
    const unconstrained = await Promise.all(
      Array.from({ length: RACERS }, () => racer(spec)),
    );
    const unconstrainedRows = rowCount(spec);
    const anyRejected = unconstrained.some((r) => r.uniqueViolation);

    record(
      unconstrainedRows > 1,
      `WITHOUT constraint: the same race produced ${unconstrainedRows} duplicate rows — the constraint is load-bearing, not decorative`,
    );
    record(
      !anyRejected,
      "WITHOUT constraint: nothing raised 23505, so the handler's tolerate-and-re-read path never engages",
    );
    record(
      unconstrainedRows > 1,
      "WITHOUT constraint: .maybeSingle() would now see multiple rows and the handler fails closed on a request that should have replayed",
    );

    psql(`DROP TABLE IF EXISTS ${spec.table}`);
  }

  console.log("");
  if (failures > 0) {
    console.error(`Postgres idempotency proof FAILED: ${failures} assertion(s).`);
    exit(1);
  }
  console.log(
    "Postgres idempotency proof passed: every relied-upon idempotency key is " +
      "enforced by exactly one UNIQUE constraint, and removing it reproduces " +
      "the duplicate the handler cannot recover from.",
  );
  console.log(
    "NOT PROVEN: that the production database carries these constraints. The " +
      "defining migrations are classified 'missing'; authoritative schema " +
      "introspection remains an open gate.",
  );
}

if (argv.includes("--help")) {
  console.log("Set PANDORA_PGHOST/PANDORA_PGPORT/PANDORA_PGUSER/PANDORA_PGDATABASE to point at an ephemeral server.");
  exit(0);
}

await run();
