// Behavioral contract for the ProjectOS learning idempotency/recovery path.
//
// The audit finding this suite exists to close:
//
//   pandora-projectos-learning could reuse an existing persisted candidate on a
//   retry while rebuilding the review item and session digest from the NEW
//   request. That produced candidate A stored alongside review metadata
//   describing request B — a review queue entry that does not describe the
//   thing a human is being asked to review.
//
// These tests run the real production function. The persistence logic is sliced
// out of supabase/functions/pandora-projectos-learning/index.ts, transpiled, and
// executed against a fake Supabase client, so the assertions are bound to the
// deployed source rather than to a reimplementation of it.

import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const SOURCE_PATH = "supabase/functions/pandora-projectos-learning/index.ts";
const source = fs.readFileSync(SOURCE_PATH, "utf8");

const start = source.indexOf("const INTEGRATION_KEY");
const end = source.indexOf("\nDeno.serve(", start);
assert.ok(start >= 0 && end > start, "learning persistence helper not found");

const harness = `${source.slice(start, end)}
(globalThis).__persistLearningEvent = persistLearningEvent;
(globalThis).__storedLearningSnapshot = storedLearningSnapshot;
(globalThis).__PRIVACY_POLICY = PRIVACY_POLICY;
`;

const transpiled = ts.transpileModule(harness, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.None,
  },
  reportDiagnostics: true,
});
const diagnostics = (transpiled.diagnostics || []).filter(
  (entry) => entry.category === ts.DiagnosticCategory.Error,
);
assert.equal(
  diagnostics.length,
  0,
  `harness transpile failed: ${diagnostics.map((d) => d.messageText).join("; ")}`,
);

const context = vm.createContext({
  Response,
  TextEncoder,
  Date,
  JSON,
  Set,
  Number,
  Math,
  Array,
  String,
  Object,
  console,
  crypto: globalThis.crypto,
});
vm.runInContext(transpiled.outputText, context);

const persistLearningEvent = context.__persistLearningEvent;
const storedLearningSnapshot = context.__storedLearningSnapshot;
const PRIVACY_POLICY = context.__PRIVACY_POLICY;
assert.equal(typeof persistLearningEvent, "function");

const MEMORY_USER = "11111111-1111-4111-8111-111111111111";
const EVENT_ID = "22222222-2222-4222-8222-222222222222";
const REQUEST_ID = "33333333-3333-4333-8333-333333333333";
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

function snapshot(overrides = {}) {
  const base = {
    sourceRef: `projectos-plan:${EVENT_ID}`,
    title: "ProjectOS completed: memory_search",
    summary: "ProjectOS completed the read operation memory_search for pandora.",
    fingerprint: HASH_A,
    requestHash: "c".repeat(64),
    sourceEventId: EVENT_ID,
    sourceRequestId: REQUEST_ID,
    contextHash: "d".repeat(64),
    resultFingerprint: "e".repeat(64),
    errorFingerprint: null,
    completedAt: "2026-08-17T10:00:00Z",
    projectKey: "pandora-memory",
    tool: "memory_search",
    risk: "read",
    outcomeStatus: "completed",
    durationMs: 1200,
    contextStatus: "available",
  };
  return { ...base, ...overrides };
}

/**
 * A submission whose *content* differs from the baseline, as a real changed
 * retry would: different summary and title, and therefore a different
 * fingerprint, but the same source event and so the same idempotency key.
 */
function changedSnapshot() {
  return snapshot({
    fingerprint: HASH_B,
    summary: "ProjectOS failed the destructive operation delete_repo for other.",
    title: "ProjectOS failed: delete_repo",
    tool: "delete_repo",
    risk: "destructive",
    outcomeStatus: "failed",
    errorFingerprint: "f".repeat(64),
    resultFingerprint: null,
    durationMs: 99,
  });
}

// --- fake Supabase client -------------------------------------------------
//
// Faults are injected per table so a test can force the exact partial-failure
// interleavings the audit called out, rather than hoping to observe them.

function createAdmin(store, faults = {}) {
  let idCounter = 0;
  const nextId = () => `id-${(idCounter += 1)}`;

  const rowsOf = (table) => (store[table] ??= []);

  const matches = (row, filters) =>
    filters.every(([column, value]) => row[column] === value);

  function selectBuilder(table, filters = []) {
    return {
      eq(column, value) {
        return selectBuilder(table, [...filters, [column, value]]);
      },
      limit() {
        return selectBuilder(table, filters);
      },
      async maybeSingle() {
        if (faults[`fail${table}Lookup`]) {
          return { data: null, error: { code: "XX000", message: "lookup failed" } };
        }
        const found = rowsOf(table).find((row) => matches(row, filters));
        return { data: found ? { ...found } : null, error: null };
      },
    };
  }

  return {
    from(table) {
      return {
        select() {
          return selectBuilder(table);
        },
        insert(row) {
          const perform = () => {
            if (faults[`fail${table}Insert`]) {
              return { data: null, error: { code: "XX000", message: "insert failed" } };
            }
            if (faults[`conflict${table}Insert`]) {
              // Unique-violation race: another writer won.
              return { data: null, error: { code: "23505", message: "duplicate" } };
            }
            const stored = { ...row, id: nextId() };
            rowsOf(table).push(stored);
            return { data: { id: stored.id }, error: null };
          };

          const result = perform();
          return {
            select() {
              return { async maybeSingle() { return result; } };
            },
            // Audit writes are awaited directly, without .select().
            then(resolve) {
              resolve({ error: result.error });
            },
          };
        },
      };
    },
  };
}

const CANDIDATES = "memory_capture_candidates";
const REVIEWS = "memory_review_queue_items";
const DIGESTS = "memory_session_digests";
const AUDITS = "audit_logs";

const body = async (response) => JSON.parse(await response.text());

let passed = 0;
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

// --------------------------------------------------------------------------

test("normal first write creates candidate, review, digest, and audit", async () => {
  const store = {};
  const response = await persistLearningEvent(createAdmin(store), MEMORY_USER, snapshot());

  assert.equal(response.status, 202);
  const payload = await body(response);
  assert.equal(payload.ok, true);
  assert.equal(payload.status, "accepted_for_review");
  assert.equal(payload.review_required, true);
  assert.equal(payload.canonical_memory_written, false);
  assert.equal(payload.privacy_policy, PRIVACY_POLICY);

  assert.equal(store[CANDIDATES].length, 1);
  assert.equal(store[REVIEWS].length, 1);
  assert.equal(store[DIGESTS].length, 1);
  assert.equal(store[AUDITS].length, 1);
});

test("identical replay is idempotent and creates nothing new", async () => {
  const store = {};
  const admin = createAdmin(store);
  await persistLearningEvent(admin, MEMORY_USER, snapshot());
  const response = await persistLearningEvent(admin, MEMORY_USER, snapshot());

  assert.equal(response.status, 200);
  const payload = await body(response);
  assert.equal(payload.status, "idempotent_replay");
  assert.equal(store[CANDIDATES].length, 1);
  assert.equal(store[REVIEWS].length, 1);
  assert.equal(store[DIGESTS].length, 1);
  assert.equal(store[AUDITS].length, 1, "audit must not be duplicated on replay");
});

test("changed-content replay fails closed with a conflict", async () => {
  const store = {};
  const admin = createAdmin(store);
  await persistLearningEvent(admin, MEMORY_USER, snapshot());
  const response = await persistLearningEvent(admin, MEMORY_USER, changedSnapshot());

  assert.equal(response.status, 409);
  const payload = await body(response);
  assert.equal(payload.ok, false);
  assert.equal(payload.error, "idempotency_conflict");
  assert.equal(payload.canonical_memory_written, false);
});

test("changed-content replay never overwrites the persisted candidate", async () => {
  const store = {};
  const admin = createAdmin(store);
  await persistLearningEvent(admin, MEMORY_USER, snapshot());
  const before = JSON.stringify(store[CANDIDATES]);

  await persistLearningEvent(admin, MEMORY_USER, changedSnapshot());

  assert.equal(store[CANDIDATES].length, 1);
  assert.equal(JSON.stringify(store[CANDIDATES]), before, "candidate was mutated");
});

test("candidate success with review failure leaves a recoverable candidate", async () => {
  const store = {};
  const response = await persistLearningEvent(
    createAdmin(store, { [`fail${REVIEWS}Insert`]: true }),
    MEMORY_USER,
    snapshot(),
  );

  assert.equal(response.status, 500);
  assert.equal((await body(response)).error, "review_insert_failed");
  assert.equal(store[CANDIDATES].length, 1, "candidate must persist for recovery");
  assert.equal((store[REVIEWS] ?? []).length, 0);
});

test("identical retry heals review and digest after a second-write failure", async () => {
  const store = {};
  await persistLearningEvent(
    createAdmin(store, { [`fail${REVIEWS}Insert`]: true }),
    MEMORY_USER,
    snapshot(),
  );
  assert.equal((store[REVIEWS] ?? []).length, 0);

  const response = await persistLearningEvent(createAdmin(store), MEMORY_USER, snapshot());

  assert.equal(response.status, 202);
  assert.equal(store[CANDIDATES].length, 1, "must not create a second candidate");
  assert.equal(store[REVIEWS].length, 1, "review must be healed");
  assert.equal(store[DIGESTS].length, 1, "digest must be healed");
});

test("changed-content retry heals review from PERSISTED state, then conflicts", async () => {
  // This is the exact defect. A changed retry must still rescue the orphaned
  // candidate, but the healed review item must describe what is stored — not
  // the retry that healed it.
  const store = {};
  await persistLearningEvent(
    createAdmin(store, { [`fail${REVIEWS}Insert`]: true }),
    MEMORY_USER,
    snapshot(),
  );

  const response = await persistLearningEvent(
    createAdmin(store),
    MEMORY_USER,
    changedSnapshot(),
  );

  assert.equal(response.status, 409, "changed content must still conflict");
  assert.equal(store[REVIEWS].length, 1, "orphaned candidate must be rescued");

  const review = store[REVIEWS][0];
  const original = snapshot();
  const changed = changedSnapshot();

  assert.equal(review.normalized_text, original.summary);
  assert.notEqual(review.normalized_text, changed.summary);
  assert.equal(review.fingerprint, original.fingerprint);
  assert.equal(review.source_metadata.tool, original.tool);
  assert.notEqual(review.source_metadata.tool, changed.tool);
  assert.equal(review.source_metadata.risk, original.risk);
  assert.equal(review.evidence_snapshot.resultFingerprint, original.resultFingerprint);
  assert.equal(review.evidence_snapshot.errorFingerprint, original.errorFingerprint);
});

test("digest healed by a changed retry also describes persisted state", async () => {
  const store = {};
  await persistLearningEvent(
    createAdmin(store, { [`fail${DIGESTS}Insert`]: true }),
    MEMORY_USER,
    snapshot(),
  );
  assert.equal((store[DIGESTS] ?? []).length, 0);

  await persistLearningEvent(createAdmin(store), MEMORY_USER, changedSnapshot());

  const digest = store[DIGESTS][0];
  const original = snapshot();
  assert.equal(digest.summary, original.summary);
  assert.equal(digest.title, original.title);
  assert.equal(digest.durable_updates[0].tool, original.tool);
  assert.equal(digest.durable_updates[0].outcomeStatus, original.outcomeStatus);
});

test("stored snapshot always matches the review item it produced", async () => {
  const store = {};
  await persistLearningEvent(createAdmin(store), MEMORY_USER, snapshot());

  const candidate = store[CANDIDATES][0];
  const rebuilt = storedLearningSnapshot(candidate, candidate.source_ref);
  assert.ok(rebuilt, "persisted candidate must be readable");

  const review = store[REVIEWS][0];
  assert.equal(review.normalized_text, rebuilt.summary);
  assert.equal(review.fingerprint, rebuilt.fingerprint);
  assert.equal(review.request_hash, rebuilt.requestHash);
  assert.equal(review.evidence_snapshot.sourceEventId, rebuilt.sourceEventId);
  assert.equal(review.evidence_snapshot.contextHash, rebuilt.contextHash);
});

test("concurrent losers adopt the winner's stored row", async () => {
  const store = {};
  // Winner writes first.
  await persistLearningEvent(createAdmin(store), MEMORY_USER, snapshot());
  const winner = store[CANDIDATES][0].id;

  // Loser's insert hits the unique violation and must adopt, not duplicate.
  const loser = createAdmin(store, { [`conflict${CANDIDATES}Insert`]: true });
  const response = await persistLearningEvent(loser, MEMORY_USER, snapshot());

  assert.equal(response.status, 200);
  assert.equal((await body(response)).candidate_id, winner);
  assert.equal(store[CANDIDATES].length, 1);
});

test("a concurrent loser carrying changed content still conflicts", async () => {
  const store = {};
  await persistLearningEvent(createAdmin(store), MEMORY_USER, snapshot());

  const response = await persistLearningEvent(
    createAdmin(store, { [`conflict${CANDIDATES}Insert`]: true }),
    MEMORY_USER,
    changedSnapshot(),
  );

  assert.equal(response.status, 409);
  assert.equal(store[CANDIDATES].length, 1);
});

test("an unreadable persisted candidate fails closed", async () => {
  const store = {};
  await persistLearningEvent(createAdmin(store), MEMORY_USER, snapshot());
  // Corrupt the stored metadata the way a partial or foreign write would.
  delete store[CANDIDATES][0].metadata.fingerprint;

  const response = await persistLearningEvent(createAdmin(store), MEMORY_USER, snapshot());

  assert.equal(response.status, 500);
  assert.equal((await body(response)).error, "candidate_reconcile_failed");
});

test("a failed candidate lookup fails closed rather than re-creating", async () => {
  const store = {};
  const response = await persistLearningEvent(
    createAdmin(store, { [`fail${CANDIDATES}Lookup`]: true }),
    MEMORY_USER,
    snapshot(),
  );

  assert.equal(response.status, 500);
  assert.equal((await body(response)).error, "candidate_lookup_failed");
  assert.equal((store[CANDIDATES] ?? []).length, 0);
});

// --- audit durability (governed-action contract) ---------------------------

test("audit persistence failure fails the operation closed", async () => {
  const store = {};
  const response = await persistLearningEvent(
    createAdmin(store, { [`fail${AUDITS}Insert`]: true }),
    MEMORY_USER,
    snapshot(),
  );

  assert.equal(response.status, 500);
  assert.equal((await body(response)).error, "audit_persistence_failed");
  assert.equal((store[AUDITS] ?? []).length, 0, "no audit row must be claimed");
});

test("retry after an audit failure heals audit and then succeeds", async () => {
  const store = {};
  await persistLearningEvent(
    createAdmin(store, { [`fail${AUDITS}Insert`]: true }),
    MEMORY_USER,
    snapshot(),
  );
  assert.equal((store[AUDITS] ?? []).length, 0);

  const response = await persistLearningEvent(createAdmin(store), MEMORY_USER, snapshot());

  assert.equal(response.status, 200);
  assert.equal((await body(response)).ok, true);
  assert.equal(store[AUDITS].length, 1, "audit must be healed by the retry");
  assert.equal(store[CANDIDATES].length, 1, "healing must not duplicate the candidate");
});

test("a failed audit lookup fails closed", async () => {
  const store = {};
  const response = await persistLearningEvent(
    createAdmin(store, { [`fail${AUDITS}Lookup`]: true }),
    MEMORY_USER,
    snapshot(),
  );

  assert.equal(response.status, 500);
  assert.equal((await body(response)).error, "audit_lookup_failed");
});

test("changed retry after an audit failure heals audit, then conflicts", async () => {
  // The exact sequence independent review identified:
  //   1. first request persists candidate/review/digest, audit write fails -> 500
  //   2. caller retries with CHANGED content
  //   3. if the conflict were decided before audit healing, the retry would
  //      return 409 without ever writing the audit row, leaving persisted state
  //      permanently without mandatory audit evidence.
  const store = {};
  await persistLearningEvent(
    createAdmin(store, { [`fail${AUDITS}Insert`]: true }),
    MEMORY_USER,
    snapshot(),
  );
  assert.equal(store[CANDIDATES].length, 1);
  assert.equal((store[AUDITS] ?? []).length, 0, "precondition: no audit yet");

  const response = await persistLearningEvent(
    createAdmin(store),
    MEMORY_USER,
    changedSnapshot(),
  );

  assert.equal(response.status, 409, "changed content must still conflict");
  assert.equal(
    store[AUDITS].length,
    1,
    "audit must be healed even though the submission is rejected",
  );
  // The audit row describes what is persisted, not the rejected submission.
  assert.equal(store[AUDITS][0].after_snapshot.outcomeStatus, snapshot().outcomeStatus);
  assert.equal(store[AUDITS][0].metadata.project_key, snapshot().projectKey);
});

test("no persisted candidate can survive without audit evidence", async () => {
  // Drive several changed-content retries after an audit failure and assert the
  // invariant directly: a persisted candidate always ends with an audit row.
  const store = {};
  await persistLearningEvent(
    createAdmin(store, { [`fail${AUDITS}Insert`]: true }),
    MEMORY_USER,
    snapshot(),
  );
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await persistLearningEvent(createAdmin(store), MEMORY_USER, changedSnapshot());
  }

  assert.equal(store[CANDIDATES].length, 1);
  assert.equal(store[AUDITS].length, 1, "healed exactly once, not duplicated");
});

test("audit failure on a changed retry still fails closed", async () => {
  const store = {};
  await persistLearningEvent(
    createAdmin(store, { [`fail${AUDITS}Insert`]: true }),
    MEMORY_USER,
    snapshot(),
  );

  // Audit still failing: the changed retry must surface the audit failure
  // rather than masking it behind a 409.
  const response = await persistLearningEvent(
    createAdmin(store, { [`fail${AUDITS}Insert`]: true }),
    MEMORY_USER,
    changedSnapshot(),
  );

  assert.equal(response.status, 500);
  assert.equal((await body(response)).error, "audit_persistence_failed");
  assert.equal((store[AUDITS] ?? []).length, 0);
});

// --- privacy and promotion negatives ---------------------------------------

test("no path writes canonical memory or promotes a candidate", async () => {
  const store = {};
  await persistLearningEvent(createAdmin(store), MEMORY_USER, snapshot());

  assert.equal(store.memory_items, undefined, "canonical memory must never be written");

  const candidate = store[CANDIDATES][0];
  assert.equal(candidate.status, "pending");
  assert.equal(candidate.requires_review, true);
  assert.equal(store[REVIEWS][0].status, "pending_review");
  assert.equal(store[REVIEWS][0].append_only, true);

  const serialized = JSON.stringify(store);
  assert.ok(!serialized.includes("hard_canon"), "must not reference hard_canon");
  assert.ok(!serialized.includes("soft_canon"), "must not reference soft_canon");
});

test("persisted candidate carries no raw payload and one privacy policy label", async () => {
  const store = {};
  await persistLearningEvent(createAdmin(store), MEMORY_USER, snapshot());

  const candidate = store[CANDIDATES][0];
  assert.equal(candidate.raw_excerpt, null);
  assert.equal(candidate.metadata.imported_raw_arguments, false);
  assert.equal(candidate.metadata.imported_raw_results, false);
  assert.equal(candidate.metadata.imported_raw_errors, false);
  assert.equal(candidate.metadata.imported_personal_identifiers, false);
  assert.equal(candidate.metadata.imported_secrets, false);

  // One canonical identifier everywhere it is reported.
  assert.equal(candidate.metadata.privacy_policy, PRIVACY_POLICY);
  assert.equal(store[AUDITS][0].metadata.privacy_policy, PRIVACY_POLICY);
});

// --------------------------------------------------------------------------

const failures = [];
for (const [name, fn] of tests) {
  try {
    await fn();
    passed += 1;
    console.log(`  ok  ${name}`);
  } catch (error) {
    failures.push(`${name}: ${error.message}`);
    console.error(`  FAIL ${name}: ${error.message}`);
  }
}

console.log(`\nProjectOS learning behavior: ${passed}/${tests.length} passed.`);
if (failures.length > 0) process.exit(1);
