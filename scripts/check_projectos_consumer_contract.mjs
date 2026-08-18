#!/usr/bin/env node
// Cross-repository contract compatibility: the published Pandora contract vs
// what the Pandoras-box consumer actually enforces.
//
// The contract in public/.well-known/ is only meaningful if the consumer agrees
// with it. The consumer's agreement is not prose — it is a Postgres execution
// gate that refuses to let a plan run unless the Memory context envelope
// matches. This compares the two directly, so a contract change that would
// break the consumer fails here instead of at execution time.
//
// Point PANDORA_CONSUMER_PATH at a checkout of banataosystems/pandoras-box.
// Without it the check reports SKIPPED with the reason — a compatibility proof
// that did not run must never read as one that passed.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { env, exit } from "node:process";

const CONTRACT_PATH = "public/.well-known/pandora-projectos-memory-contract-v1.json";
const CONSUMER = env.PANDORA_CONSUMER_PATH;

if (!CONSUMER) {
  console.log(
    "SKIPPED: PANDORA_CONSUMER_PATH is not set, so the Pandoras-box consumer " +
      "gate could not be compared against this contract.",
  );
  exit(0);
}

const errors = [];
const fail = (message) => errors.push(message);

const contract = JSON.parse(readFileSync(CONTRACT_PATH, "utf8"));

// The consumer's authority is its migration: the gate the database enforces.
const migrationsDir = join(CONSUMER, "supabase", "migrations");
if (!existsSync(migrationsDir)) {
  console.error(`No supabase/migrations under PANDORA_CONSUMER_PATH (${CONSUMER})`);
  exit(1);
}
const gateFile = readdirSync(migrationsDir)
  .filter((name) => /full_capacity_context_gate\.sql$/.test(name))
  .sort()
  .pop();
if (!gateFile) {
  console.error("Consumer has no *_full_capacity_context_gate.sql — cannot compare.");
  exit(1);
}
const gate = readFileSync(join(migrationsDir, gateFile), "utf8");

// ---- Required context sections -------------------------------------------
const expected = gate.match(
  /v_expected_sections constant jsonb :=\s*'(\[[\s\S]*?\])'::jsonb/,
);
if (!expected) {
  fail("could not read v_expected_sections from the consumer gate");
} else {
  const consumerSections = JSON.parse(expected[1]);
  const contractSections = contract.context_sections.map((s) => s.field);
  const missingInContract = consumerSections.filter((s) => !contractSections.includes(s));
  const missingInConsumer = contractSections.filter((s) => !consumerSections.includes(s));

  if (missingInContract.length > 0) {
    fail(
      `the consumer gate requires section(s) the contract does not publish: ` +
        `${missingInContract.join(", ")} — a plan would be refused at execution time`,
    );
  }
  if (missingInConsumer.length > 0) {
    fail(
      `the contract publishes section(s) the consumer gate does not require: ` +
        `${missingInConsumer.join(", ")} — the contract overstates what is enforced`,
    );
  }
  console.log(
    `context sections: ${contractSections.length} published, ` +
      `${consumerSections.length} enforced, exact set match ` +
      `${missingInContract.length === 0 && missingInConsumer.length === 0}`,
  );
}

// ---- Contract identity the consumer pins ---------------------------------
const pins = [
  ["contract_id", /capabilityContract,id\}' is distinct from '([^']+)'/, contract.contract_id],
  ["contract_version", /capabilityContract,version\}' is distinct from '([^']+)'/, contract.contract_version],
  ["schema_version", /capabilityContract,schemaVersion\}' is distinct from '([^']+)'/, contract.schema_version],
];
for (const [label, pattern, published] of pins) {
  const match = gate.match(pattern);
  if (!match) {
    fail(`the consumer gate does not pin ${label}`);
    continue;
  }
  if (match[1] !== published) {
    fail(`${label}: consumer pins '${match[1]}', contract publishes '${published}'`);
  } else {
    console.log(`${label}: consumer and contract agree on '${published}'`);
  }
}

// ---- The public canon abstraction ----------------------------------------
const search = contract.capabilities.find((c) => c.id === "memory.full_context_search");
const published = search?.request_defaults?.canon_statuses ?? [];
const enforcesApprovedAlias = /requestedCanonStatuses.*?'\["approved"\]'::jsonb/s.test(gate);
if (!enforcesApprovedAlias) {
  fail("the consumer gate does not enforce the public 'approved' canon alias");
} else if (published.length !== 1 || published[0] !== "approved") {
  fail(
    `the contract's canon_statuses default is ${JSON.stringify(published)}, but the ` +
      `consumer enforces exactly ["approved"] — internal labels must not be published`,
  );
} else {
  console.log('canon abstraction: both sides require exactly ["approved"]');
}

// ---- Missing sections must fail closed, never degrade silently ------------
if (!/jsonb_array_length\(v_missing_sections\) <> 0/.test(gate)) {
  fail("the consumer gate does not reject a context envelope with missing sections");
} else {
  console.log("missing required section: consumer raises and refuses the plan (fail closed)");
}

// ---- Required capabilities must be published as required -----------------
for (const id of ["memory.health", "memory.full_context_search"]) {
  const capability = contract.capabilities.find((c) => c.id === id);
  if (capability?.required !== true) {
    fail(`contract must publish ${id} as required:true`);
  }
}

// ---- Evidence submission stays review-gated ------------------------------
const submission = contract.capabilities.find(
  (c) => c.id === "memory.evidence_candidate_submission",
);
if (submission && submission.automatic_promotion !== false) {
  fail("evidence candidate submission must never allow automatic promotion");
}

if (errors.length > 0) {
  console.error("\nConsumer contract compatibility FAILED:");
  for (const message of errors) console.error(`  - ${message}`);
  exit(1);
}

console.log(
  `\nConsumer contract compatibility passed against ${gateFile}. ` +
    `The published contract and the consumer's execution gate agree.`,
);
