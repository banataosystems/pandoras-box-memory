import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const bridge = fs.readFileSync(
  "supabase/functions/pandora-projectos-bridge/index.ts",
  "utf8",
);
const helperStart = bridge.indexOf("const EVIDENCE_PROOF_STAGES");
const helperEnd = bridge.indexOf("\nDeno.serve(", helperStart);
assert.ok(helperStart >= 0 && helperEnd > helperStart, "evidence helper not found");

const helper = bridge.slice(helperStart, helperEnd);
const harness = `
const PRINCIPAL_KEY = "projectos-mcpmaster-production";
type JsonRecord = Record<string, unknown>;
type AdminClient = any;
type Principal = {
  environment: string;
  memory_user_id: string;
  allowed_namespaces: string[];
  scopes: string[];
};
const headers = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
};
const respond = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers });
const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const errorCode = (error: unknown): string =>
  typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code ?? "")
    : "";
${helper}
(globalThis as any).__submitEvidenceCandidate = submitEvidenceCandidate;
`;

const transpiled = ts.transpileModule(harness, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.None,
  },
  reportDiagnostics: true,
});
const errors = (transpiled.diagnostics || []).filter(
  (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
);
assert.equal(errors.length, 0, `behavior harness transpile failed: ${errors.map((e) => e.messageText).join("; ")}`);

const context = vm.createContext({
  Response,
  TextEncoder,
  Date,
  JSON,
  Set,
  console,
  crypto: globalThis.crypto,
});
vm.runInContext(transpiled.outputText, context);
const submitEvidenceCandidate = context.__submitEvidenceCandidate;
assert.equal(typeof submitEvidenceCandidate, "function");

const PROJECT_A_ID = "7c686cbd-d968-49d5-86cc-918f5e777bd2";
const PROJECT_B_ID = "43f619bb-ecc2-4a9a-bd56-424325eb81ac";
const SHA40 = "0b6d32b9135e2050c4f819a8d7ac3c78e6bc1117";
const SHA256 = "4a10f26ebe4e760c984b89ecc741ba77ba0213dcad6205f3d1851a887f624545";

const principal = {
  environment: "production",
  memory_user_id: "11111111-1111-4111-8111-111111111111",
  allowed_namespaces: ["real_life"],
  scopes: ["memory:write"],
};

function validBody(projectKey = "mcpmaster-pandoras-box", overrides = {}) {
  return {
    action: "submit_evidence_candidate",
    namespace: "real_life",
    project_id: null,
    project_key: projectKey,
    title: "Pandora evidence",
    summary: "Bounded review-gated evidence candidate.",
    proof_stage: "tested",
    claim: "Source has been tested but is not deployed or production verified.",
    evidence_refs: [
      { type: "github_source", ref: `banataosystems/Pandoras-box@${SHA40}` },
      { type: "sha256", ref: SHA256, sha256: SHA256 },
    ],
    provenance: {
      source_type: "github_exact_head",
      source_locator: `banataosystems/Pandoras-box@${SHA40}`,
      source_sha: SHA40,
      observed_at: "2026-08-14T13:47:36Z",
    },
    idempotency_key: `projectos-evidence:${SHA40}`,
    ...overrides,
  };
}

function projectRows() {
  return [
    {
      id: PROJECT_A_ID,
      project_key: "mcpmaster-pandoras-box",
      memory_namespace: "real_life",
      lifecycle_status: "active",
    },
    {
      id: PROJECT_B_ID,
      project_key: "memory",
      memory_namespace: "real_life",
      lifecycle_status: "active",
    },
  ];
}

class FakeQuery {
  constructor(db, table) {
    this.db = db;
    this.table = table;
    this.filters = [];
    this.inserted = undefined;
  }
  select() { return this; }
  eq(column, value) { this.filters.push([column, value]); return this; }
  is(column, value) { this.filters.push([column, value]); return this; }
  insert(value) { this.inserted = value; return this; }
  async maybeSingle() {
    await Promise.resolve();
    if (this.inserted !== undefined) {
      return this.db.insert(this.table, this.inserted);
    }
    const row = this.db.rows[this.table].find((candidate) =>
      this.filters.every(([column, value]) => candidate[column] === value)
    );
    return { data: row ? structuredClone(row) : null, error: null };
  }
}

class FakeAdmin {
  constructor({ grants = true } = {}) {
    this.calls = [];
    this.counter = 0;
    this.rows = {
      pandora_projects: projectRows(),
      pandora_project_grants: grants
        ? projectRows().map((project) => ({
            principal_key: "projectos-mcpmaster-production",
            project_id: project.id,
            environment: "production",
            is_active: true,
            can_propose: true,
            revoked_at: null,
          }))
        : [],
      memory_capture_candidates: [],
      memory_review_queue_items: [],
    };
  }
  from(table) {
    assert.ok(Object.hasOwn(this.rows, table), `unexpected table access: ${table}`);
    this.calls.push(table);
    return new FakeQuery(this, table);
  }
  insert(table, input) {
    const row = structuredClone(input);
    const duplicate = table === "memory_capture_candidates"
      ? this.rows[table].find((candidate) =>
          candidate.user_id === row.user_id &&
          candidate.namespace === row.namespace &&
          candidate.source === row.source &&
          candidate.source_ref === row.source_ref)
      : table === "memory_review_queue_items"
        ? this.rows[table].find((candidate) =>
            candidate.user_id === row.user_id &&
            candidate.namespace === row.namespace &&
            candidate.candidate_type === row.candidate_type &&
            candidate.source_ref === row.source_ref)
        : null;
    if (duplicate) {
      return {
        data: null,
        error: { code: "23505", message: "duplicate key" },
      };
    }
    row.id = row.id || `00000000-0000-4000-8000-${String(++this.counter).padStart(12, "0")}`;
    this.rows[table].push(row);
    return { data: structuredClone(row), error: null };
  }
}

async function json(response) {
  return { status: response.status, body: await response.json() };
}

{
  const db = new FakeAdmin();
  const response = await json(await submitEvidenceCandidate(
    validBody("mcpmaster-pandoras-box", {
      provenance: {
        ...validBody().provenance,
        observed_at: "2020",
      },
    }),
    principal,
    db,
  ));
  assert.equal(response.status, 400);
  assert.equal(response.body.error, "evidence_candidate_invalid");
  assert.equal(db.calls.length, 0, "invalid observed_at must fail before DB I/O");
}

{
  const db = new FakeAdmin({ grants: false });
  const response = await json(await submitEvidenceCandidate(validBody(), principal, db));
  assert.equal(response.status, 403);
  assert.equal(response.body.error, "project_not_allowed");
  assert.deepEqual(db.rows.memory_capture_candidates, []);
  assert.deepEqual(db.rows.memory_review_queue_items, []);
}

{
  const db = new FakeAdmin();
  const response = await json(await submitEvidenceCandidate(
    validBody("memory", { project_id: PROJECT_A_ID }),
    principal,
    db,
  ));
  assert.equal(response.status, 403, "project id/key mismatch must fail closed");
  assert.equal(response.body.error, "project_not_allowed");
}

{
  const db = new FakeAdmin();
  const first = await json(await submitEvidenceCandidate(validBody(), principal, db));
  const second = await json(await submitEvidenceCandidate(validBody("memory"), principal, db));
  assert.equal(first.status, 202);
  assert.equal(second.status, 202);
  assert.equal(db.rows.memory_capture_candidates.length, 2);
  assert.notEqual(
    db.rows.memory_capture_candidates[0].source_ref,
    db.rows.memory_capture_candidates[1].source_ref,
    "same idempotency key in different projects must use different source refs",
  );

  const replay = await json(await submitEvidenceCandidate(validBody(), principal, db));
  assert.equal(replay.status, 200);
  assert.equal(replay.body.deduplicated, true);
  assert.equal(db.rows.memory_capture_candidates.length, 2);

  const conflict = await json(await submitEvidenceCandidate(
    validBody("mcpmaster-pandoras-box", { claim: "Different content under the same idempotency key." }),
    principal,
    db,
  ));
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.error, "idempotency_conflict");
  assert.equal(db.calls.includes("memory_items"), false, "intake must not touch canonical memory");
}

{
  const db = new FakeAdmin();
  const [left, right] = await Promise.all([
    submitEvidenceCandidate(validBody(), principal, db).then(json),
    submitEvidenceCandidate(validBody(), principal, db).then(json),
  ]);
  assert.deepEqual(
    [left.status, right.status].sort((a, b) => a - b),
    [200, 202],
    "concurrent identical submissions must converge on one candidate/review pair",
  );
  assert.equal(db.rows.memory_capture_candidates.length, 1);
  assert.equal(db.rows.memory_review_queue_items.length, 1);
}

console.log("Governed Memory evidence intake behavioral tests: PASS");
