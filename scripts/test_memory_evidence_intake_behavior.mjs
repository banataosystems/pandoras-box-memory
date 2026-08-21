import assert from "node:assert/strict";
import crypto from "node:crypto";
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
  atob,
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
  }
  select() { return this; }
  eq(column, value) { this.filters.push([column, value]); return this; }
  is(column, value) { this.filters.push([column, value]); return this; }
  async maybeSingle() {
    await Promise.resolve();
    const row = this.db.rows[this.table].find((candidate) =>
      this.filters.every(([column, value]) => candidate[column] === value)
    );
    return { data: row ? structuredClone(row) : null, error: null };
  }
}

function atomicFingerprint(args) {
  return crypto.createHash("sha256").update(JSON.stringify({
    namespace: args.p_namespace,
    project_id: args.p_project_id,
    project_key: args.p_project_key,
    title: args.p_title,
    summary: args.p_summary,
    proof_stage: args.p_proof_stage,
    claim: args.p_claim,
    evidence_refs: args.p_evidence_refs,
    provenance: args.p_provenance,
    idempotency_key: args.p_idempotency_key,
  })).digest("hex");
}

class FakeAdmin {
  constructor({ grants = true, failReviewTransactions = 0, failAuditTransactions = 0 } = {}) {
    this.calls = [];
    this.counter = 0;
    this.failReviewTransactions = failReviewTransactions;
    this.failAuditTransactions = failAuditTransactions;
    this.atomicTail = Promise.resolve();
    this.rows = {
      pandora_projects: projectRows(),
      pandora_project_grants: grants
        ? [projectRows()[0]].map((project) => ({
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
      audit_logs: [],
    };
  }
  from(table) {
    assert.ok(Object.hasOwn(this.rows, table), `unexpected table access: ${table}`);
    this.calls.push(table);
    return new FakeQuery(this, table);
  }
  nextId() {
    return `00000000-0000-4000-8000-${String(++this.counter).padStart(12, "0")}`;
  }
  async rpc(name, args) {
    this.calls.push(`rpc:${name}`);
    assert.equal(name, "submit_projectos_evidence_candidate_atomic");

    let release;
    const previous = this.atomicTail;
    this.atomicTail = new Promise((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      const sourceRef =
        `projectos-evidence:${args.p_project_id}:${args.p_idempotency_key}`;
      const fingerprint = atomicFingerprint(args);
      const existing = this.rows.memory_capture_candidates.find((candidate) =>
        candidate.user_id === args.p_user_id &&
        candidate.namespace === args.p_namespace &&
        candidate.source === "projectos-post-task" &&
        candidate.source_ref === sourceRef
      );
      if (existing) {
        const review = this.rows.memory_review_queue_items.find((item) =>
          item.source_ref === sourceRef &&
          item.evidence_snapshot.candidateId === existing.id
        );
        const audit = this.rows.audit_logs.find((item) =>
          item.record_id === existing.id && item.metadata.review_item_id === review?.id
        );
        if (!review || !audit) {
          return { data: null, error: { code: "55000", message: "atomic state incomplete" } };
        }
        if (existing.metadata.fingerprint !== fingerprint) {
          return {
            data: {
              outcome: "idempotency_conflict",
              candidate_id: existing.id,
              review_item_id: review.id,
              audit_id: audit.id,
              fingerprint: existing.metadata.fingerprint,
              canonical_memory_written: false,
            },
            error: null,
          };
        }
        return {
          data: {
            outcome: "deduplicated",
            candidate_id: existing.id,
            review_item_id: review.id,
            audit_id: audit.id,
            created_at: existing.created_at,
            fingerprint,
            namespace: args.p_namespace,
            project_id: args.p_project_id,
            project_key: args.p_project_key,
            proof_stage: args.p_proof_stage,
            canonical_memory_written: false,
          },
          error: null,
        };
      }

      // All three rows are staged against a private snapshot. A simulated
      // review or audit failure returns before the snapshot is committed.
      const working = structuredClone({
        candidates: this.rows.memory_capture_candidates,
        reviews: this.rows.memory_review_queue_items,
        audits: this.rows.audit_logs,
      });
      const createdAt = new Date().toISOString();
      const candidate = {
        id: this.nextId(),
        user_id: args.p_user_id,
        namespace: args.p_namespace,
        source: "projectos-post-task",
        source_ref: sourceRef,
        raw_excerpt: null,
        summary: args.p_summary,
        status: "pending",
        requires_review: true,
        created_at: createdAt,
        metadata: {
          project_id: args.p_project_id,
          project_key: args.p_project_key,
          proof_stage: args.p_proof_stage,
          claim: args.p_claim,
          evidence_refs: args.p_evidence_refs,
          provenance: args.p_provenance,
          idempotency_key: args.p_idempotency_key,
          fingerprint,
          atomic_rpc: name,
        },
      };
      working.candidates.push(candidate);

      if (this.failReviewTransactions > 0) {
        this.failReviewTransactions -= 1;
        return { data: null, error: { code: "P0001", message: "review failure" } };
      }
      const review = {
        id: this.nextId(),
        user_id: args.p_user_id,
        namespace: args.p_namespace,
        source_ref: sourceRef,
        candidate_type: "projectos_outcome",
        status: "pending_review",
        requires_review: true,
        append_only: true,
        fingerprint,
        normalized_text: args.p_summary,
        evidence_snapshot: {
          candidateId: candidate.id,
          claim: args.p_claim,
          evidenceRefs: args.p_evidence_refs,
          provenance: args.p_provenance,
        },
        audit_metadata: {
          candidateId: candidate.id,
          idempotencyKey: args.p_idempotency_key,
          fingerprint,
          atomicTransaction: true,
          immutableAuditRequired: true,
        },
      };
      working.reviews.push(review);

      if (this.failAuditTransactions > 0) {
        this.failAuditTransactions -= 1;
        return { data: null, error: { code: "P0001", message: "audit failure" } };
      }
      const audit = {
        id: this.nextId(),
        user_id: args.p_user_id,
        namespace: args.p_namespace,
        action: "projectos_evidence_candidate_atomic_created",
        table_name: "memory_capture_candidates",
        record_id: candidate.id,
        metadata: {
          candidate_id: candidate.id,
          review_item_id: review.id,
          idempotency_key: args.p_idempotency_key,
          fingerprint,
          atomic_transaction: true,
          append_only: true,
        },
      };
      working.audits.push(audit);

      this.rows.memory_capture_candidates = working.candidates;
      this.rows.memory_review_queue_items = working.reviews;
      this.rows.audit_logs = working.audits;
      return {
        data: {
          outcome: "created",
          candidate_id: candidate.id,
          review_item_id: review.id,
          audit_id: audit.id,
          created_at: createdAt,
          fingerprint,
          namespace: args.p_namespace,
          project_id: args.p_project_id,
          project_key: args.p_project_key,
          proof_stage: args.p_proof_stage,
          canonical_memory_written: false,
        },
        error: null,
      };
    } finally {
      release();
    }
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

// Privacy boundary: high-confidence identifiers, credentials, nested values,
// and encoded variants must fail before any database I/O.
{
  const attacks = [
    [validBody(undefined, { summary: "contact +63 917 123 4567" }), "direct_identifier_phone"],
    [validBody(undefined, { summary: "Phone: 4155552671" }), "direct_identifier_phone"],
    [validBody(undefined, { summary: "Phone number: +14155552671" }), "direct_identifier_phone"],
    [validBody(undefined, { summary: "Telephone: 4155552671" }), "direct_identifier_phone"],
    [validBody(undefined, { summary: "name: Jane Doe" }), "direct_identifier_name"],
    [validBody(undefined, { summary: "Jane Doe" }), "direct_identifier_name"],
    [validBody(undefined, { summary: "JANE DOE" }), "direct_identifier_name"],
    [validBody(undefined, { summary: "José García" }), "direct_identifier_name"],
    [validBody(undefined, { summary: "Jane Doe completed validation." }), "direct_identifier_name"],
    [validBody(undefined, { summary: "Reviewed Jane Doe output." }), "direct_identifier_name"],
    [validBody(undefined, { summary: "Met Jane Doe yesterday." }), "direct_identifier_name"],
    [validBody(undefined, { summary: "Evidence owner is Jane Doe." }), "direct_identifier_name"],
    [validBody(undefined, { summary: "MARY ANN SMITH completed validation." }), "direct_identifier_name"],
    [validBody(undefined, { summary: "José García completed validation." }), "direct_identifier_name"],
    [validBody(undefined, { summary: "Jane Q. Doe completed validation." }), "direct_identifier_name"],
    [validBody(undefined, { summary: "J. Doe completed validation." }), "direct_identifier_name"],
    [validBody(undefined, { summary: "Candidate J Doe supplied evidence." }), "direct_identifier_name"],
    [validBody(undefined, { summary: "Jane O'Connor completed validation." }), "direct_identifier_name"],
    [validBody(undefined, { summary: "José de la Cruz completed validation." }), "direct_identifier_name"],
    [validBody(undefined, { summary: "Juan dela Cruz completed validation." }), "direct_identifier_name"],
    [validBody(undefined, { summary: "Candidate Jane Doe supplied evidence." }), "direct_identifier_name"],
    [validBody(undefined, { summary: "Candidate JANE DOE supplied evidence." }), "direct_identifier_name"],
    [validBody(undefined, { summary: "Contact JUAN DELA CRUZ for proof." }), "direct_identifier_name"],
    [validBody(undefined, { summary: "Candidate Atomic Jane Doe supplied evidence." }), "direct_identifier_name"],
    [validBody(undefined, { summary: "Atomic Jane Doe" }), "direct_identifier_name"],
    [validBody(undefined, { summary: "Contact Memory Jane Doe for proof." }), "direct_identifier_name"],
    [validBody(undefined, { summary: "Born 1990-01-31" }), "direct_identifier_birth_date"],
    [validBody(undefined, { summary: "Candidate DOB is 1990-01-31." }), "direct_identifier_birth_date"],
    [validBody(undefined, { summary: "DOB: 31/01/1990" }), "direct_identifier_birth_date"],
    [validBody(undefined, { summary: "DOB is 01-31-1990" }), "direct_identifier_birth_date"],
    [validBody(undefined, { summary: "Born January 31, 1990" }), "direct_identifier_birth_date"],
    [validBody(undefined, { summary: "Birth date: 1990-01-31" }), "direct_identifier_birth_date"],
    [validBody(undefined, { summary: "Birthdate: 1990-01-31" }), "direct_identifier_birth_date"],
    [validBody(undefined, { summary: "Birthday: January 31, 1990" }), "direct_identifier_birth_date"],
    [validBody(undefined, { summary: "Born on 1990-01-31" }), "direct_identifier_birth_date"],
    [validBody(undefined, { summary: "office 123 Rizal Street, Makati" }), "direct_identifier_address"],
    [validBody(undefined, { summary: "Passport number: P1234567" }), "direct_identifier_government"],
    [validBody(undefined, { summary: "Card number: 4111111111111111" }), "direct_identifier_financial"],
    [validBody(undefined, { summary: "Bank account: 123456789012" }), "direct_identifier_financial"],
    [validBody(undefined, { claim: "password=hunter2-super-secret" }), "secret_assignment"],
    [validBody(undefined, { claim: "password: redacted" }), "secret_assignment"],
    [validBody(undefined, { claim: "password=masked" }), "secret_assignment"],
    [validBody(undefined, { claim: "password: none" }), "secret_assignment"],
    [validBody(undefined, { claim: "password: true" }), "secret_assignment"],
    [validBody(undefined, { claim: "pin=1234" }), "secret_assignment"],
    [validBody(undefined, { claim: "cGFzc3dvcmQ9aHVudGVyMi1zdXBlci1zZWNyZXQ=" }), "base64_secret_assignment"],
    [validBody(undefined, { claim: "SmFuZSBEb2U=" }), "base64_direct_identifier_name"],
    [validBody(undefined, { claim: "Sm9obiBTbWl0aA==" }), "base64_direct_identifier_name"],
    [validBody(undefined, { claim: "data:text/plain;base64,cGFzc3dvcmQ9aHVudGVyMi1zdXBlci1zZWNyZXQ=" }), "base64_secret_assignment"],
    [validBody(undefined, { claim: "Encoded credential: cGFzc3dvcmQ9aHVudGVyMi1zdXBlci1zZWNyZXQ=" }), "base64_secret_assignment"],
    [validBody(undefined, { claim: "'cGFzc3dvcmQ9aHVudGVyMi1zdXBlci1zZWNyZXQ='" }), "base64_secret_assignment"],
    [validBody(undefined, { claim: "base64:cGFzc3dvcmQ9aHVudGVyMi1zdXBlci1zZWNyZXQ=" }), "base64_secret_assignment"],
    [validBody(undefined, { claim: "c G F z c 3 d v c m Q 9 a H V u d G V y M i 1 z d X B l c i 1 z Z W N y Z X Q =" }), "base64_secret_assignment"],
    [validBody(undefined, { claim: "cG Fz c3 dv cm Q9 aH Vu dG Vy Mi 1z dX Bl ci 1z ZW Ny ZX Q=" }), "base64_secret_assignment"],
    [validBody(undefined, { claim: "cGF zc3 dvc mQ9 aHV udG VyM i1z dXB lci 1zZ WNy ZXQ =" }), "base64_secret_assignment"],
    [validBody(undefined, { claim: "cGFz,c3dv,cmQ9,aHVu,dGVy,Mg==" }), "base64_secret_assignment"],
    [validBody(undefined, { claim: "glpat-abcdefghijklmnopqrst" }), "credential_signature"],
    [validBody(undefined, { claim: "xoxb-" + "123456789012-123456789012-abcdefghijklmnopqrstuvwx" }), "credential_signature"],
    [validBody(undefined, { claim: "sk-" + "proj-abcdefghijklmnopqrstuvwxyz1234567890" }), "credential_signature"],
    [validBody(undefined, { claim: "Authorization: Bearer abcdefghijklmnopqrstuvwxyz123456" }), "credential_signature"],
    [validBody(undefined, { claim: "Authorization: Basic abcdefghijklmnopqrstuvwxyz123456" }), "credential_signature"],
    [validBody(undefined, { claim: "AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY" }), "secret_assignment"],
    [validBody(undefined, { claim: "AKIA" + "IOSFODNN7EXAMPLE" }), "cloud_credential_signature"],
    [validBody(undefined, { claim: "-----BEGIN " + "PRIVATE KEY-----" }), "private_key_material"],
    [validBody(undefined, { provenance: { ...validBody().provenance, source_locator: "owner%40example.com" } }), "percent_encoded_text"],
    [validBody(undefined, { provenance: { ...validBody().provenance, source_locator: "owner＠example.com" } }), "direct_identifier_email"],
    [validBody(undefined, { evidence_refs: [{ type: "github_source", ref: "phone%3A%20%2B63%20917%20123%204567" }] }), "percent_encoded_text"],
    [validBody(undefined, { evidence_refs: [{ type: "github_source", ref: "https://example.test/a%20b" }] }), "percent_encoded_text"],
  ];
  for (const [body, reason] of attacks) {
    const db = new FakeAdmin();
    const response = await json(await submitEvidenceCandidate(body, principal, db));
    assert.equal(
      response.status,
      400,
      `${reason} attack reached DB: ${JSON.stringify(body)}`,
    );
    assert.equal(response.body.error, "sensitive_candidate_rejected");
    assert.equal(
      response.body.reason,
      reason,
      `privacy reason drift for ${JSON.stringify(body)}`,
    );
    assert.equal(db.calls.length, 0, `${reason} must fail before DB I/O`);
  }
}

// Capitalized project and artifact names are not person identifiers. Keep a
// small operational corpus so the fail-closed name boundary does not make the
// ProjectOS evidence path unusable for its intended technical metadata.
for (const body of [
  validBody(undefined, { title: "Atomic Migration" }),
  validBody(undefined, { claim: "Systems Mastery" }),
  validBody(undefined, { summary: "Candidate Atomic Migration passed." }),
]) {
  const db = new FakeAdmin();
  const response = await json(await submitEvidenceCandidate(body, principal, db));
  assert.equal(response.status, 202, `safe artifact name rejected: ${JSON.stringify(body)}`);
  assert.ok(
    db.calls.includes("rpc:submit_projectos_evidence_candidate_atomic"),
    "safe artifact name must reach the atomic RPC",
  );
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
  const outsideEnvelope = await json(await submitEvidenceCandidate(
    validBody("memory"),
    principal,
    db,
  ));
  assert.equal(outsideEnvelope.status, 403);
  assert.equal(outsideEnvelope.body.error, "project_not_allowed");
  assert.equal(db.rows.memory_capture_candidates.length, 0);
  assert.equal(db.rows.memory_review_queue_items.length, 0);
  assert.equal(db.rows.audit_logs.length, 0);
}

{
  const db = new FakeAdmin();
  const first = await json(await submitEvidenceCandidate(validBody(), principal, db));
  assert.equal(first.status, 202);
  assert.equal(first.body.deduplicated, false);
  assert.equal(first.body.atomic_transaction, true);
  assert.match(first.body.audit_id, /^[0-9a-f-]{36}$/);
  assert.equal(db.rows.memory_capture_candidates.length, 1);
  assert.equal(db.rows.memory_review_queue_items.length, 1);
  assert.equal(db.rows.audit_logs.length, 1);

  const replay = await json(await submitEvidenceCandidate(validBody(), principal, db));
  assert.equal(replay.status, 200);
  assert.equal(replay.body.deduplicated, true);
  assert.equal(replay.body.candidate_id, first.body.candidate_id);
  assert.equal(replay.body.review_item_id, first.body.review_item_id);
  assert.equal(replay.body.audit_id, first.body.audit_id);
  assert.equal(db.rows.memory_capture_candidates.length, 1);
  assert.equal(db.rows.memory_review_queue_items.length, 1);
  assert.equal(db.rows.audit_logs.length, 1);

  const conflict = await json(await submitEvidenceCandidate(
    validBody("mcpmaster-pandoras-box", { claim: "Different content under the same idempotency key." }),
    principal,
    db,
  ));
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.error, "idempotency_conflict");
  assert.equal(db.rows.memory_capture_candidates.length, 1);
  assert.equal(db.rows.memory_review_queue_items.length, 1);
  assert.equal(db.rows.audit_logs.length, 1);
  const [candidate] = db.rows.memory_capture_candidates;
  const [review] = db.rows.memory_review_queue_items;
  const [audit] = db.rows.audit_logs;
  assert.equal(candidate.status, "pending");
  assert.equal(review.status, "pending_review");
  assert.equal(review.evidence_snapshot.candidateId, candidate.id);
  assert.equal(audit.record_id, candidate.id);
  assert.equal(audit.metadata.review_item_id, review.id);
  assert.equal(audit.metadata.fingerprint, candidate.metadata.fingerprint);
  assert.equal(audit.metadata.atomic_transaction, true);
  assert.equal(candidate.raw_excerpt, null);
  assert.equal(db.calls.includes("memory_items"), false, "intake must not touch canonical memory");
  assert.equal(db.calls.includes("memory_capture_candidates"), false, "bridge must not write candidate directly");
  assert.equal(db.calls.includes("memory_review_queue_items"), false, "bridge must not write review directly");
  assert.ok(
    db.calls.includes("rpc:submit_projectos_evidence_candidate_atomic"),
    "bridge must use the atomic RPC",
  );
}

{
  const db = new FakeAdmin();
  const responses = await Promise.all(
    Array.from({ length: 8 }, () =>
      submitEvidenceCandidate(validBody(), principal, db).then(json)
    ),
  );
  assert.equal(responses.filter((response) => response.status === 202).length, 1);
  assert.equal(responses.filter((response) => response.status === 200).length, 7);
  assert.equal(new Set(responses.map((response) => response.body.candidate_id)).size, 1);
  assert.equal(new Set(responses.map((response) => response.body.review_item_id)).size, 1);
  assert.equal(new Set(responses.map((response) => response.body.audit_id)).size, 1);
  assert.equal(db.rows.memory_capture_candidates.length, 1);
  assert.equal(db.rows.memory_review_queue_items.length, 1);
  assert.equal(db.rows.audit_logs.length, 1);
}

// Failure injection after the candidate insert but before the review insert.
// The private transaction snapshot is discarded, leaving no orphan.
{
  const db = new FakeAdmin({ failReviewTransactions: 1 });
  const failed = await json(await submitEvidenceCandidate(validBody(), principal, db));
  assert.equal(failed.status, 500);
  assert.equal(failed.body.error, "candidate_transaction_failed");
  assert.equal(db.rows.memory_capture_candidates.length, 0);
  assert.equal(db.rows.memory_review_queue_items.length, 0);
  assert.equal(db.rows.audit_logs.length, 0);

  const retry = await json(await submitEvidenceCandidate(validBody(), principal, db));
  assert.equal(retry.status, 202);
  assert.equal(db.rows.memory_capture_candidates.length, 1);
  assert.equal(db.rows.memory_review_queue_items.length, 1);
  assert.equal(db.rows.audit_logs.length, 1);
}

// Failure injection after candidate + review staging but before audit insert.
// Candidate and review both roll back with the audit failure.
{
  const db = new FakeAdmin({ failAuditTransactions: 1 });
  const failed = await json(await submitEvidenceCandidate(validBody(), principal, db));
  assert.equal(failed.status, 500);
  assert.equal(failed.body.error, "candidate_transaction_failed");
  assert.equal(db.rows.memory_capture_candidates.length, 0);
  assert.equal(db.rows.memory_review_queue_items.length, 0);
  assert.equal(db.rows.audit_logs.length, 0);

  const retry = await json(await submitEvidenceCandidate(validBody(), principal, db));
  assert.equal(retry.status, 202);
  assert.equal(db.rows.memory_capture_candidates.length, 1);
  assert.equal(db.rows.memory_review_queue_items.length, 1);
  assert.equal(db.rows.audit_logs.length, 1);
}

console.log("Governed Memory evidence intake behavioral tests: PASS");
