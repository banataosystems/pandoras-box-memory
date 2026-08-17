#!/usr/bin/env node
// `npm run verify` — the single reproducible source-quality gate for Pandora Memory.
//
// This is the command an independent reviewer runs. It requires no production
// credentials, mutates no provider state, and reaches no network service other
// than the npm registry during `npm ci` (which the caller runs separately).
//
// Each stage is named, ordered cheapest-first, and reported individually so a
// reviewer can see exactly which contract failed rather than a single opaque
// non-zero exit.
//
// Usage:
//   node scripts/verify.mjs              run every stage
//   node scripts/verify.mjs --list       print stage names
//   node scripts/verify.mjs --only NAME  run one stage (repeatable)
//   node scripts/verify.mjs --skip NAME  skip one stage (repeatable, recorded)

import { spawnSync } from "node:child_process";
import { argv, env, exit, stdout } from "node:process";

/**
 * Build placeholders. These are deliberately non-secret, non-production values:
 * the Next.js production build needs the public Supabase config to be present,
 * and binding it to an obvious placeholder keeps `verify` credential-free.
 */
const BUILD_ENV = {
  NEXT_PUBLIC_SUPABASE_URL: "https://ivmvufhcsezyhczzondn.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_verify_placeholder",
};

const STAGES = [
  {
    name: "evidence",
    description: "Evidence metadata schema, immutability, and coverage",
    command: ["node", ["scripts/check_evidence_metadata.mjs", "--self-test"]],
  },
  {
    name: "registry",
    description: "Capability registry contract and rejection self-tests",
    command: ["node", ["scripts/validate_capability_registry.mjs", "--self-test"]],
  },
  {
    name: "migrations",
    description: "Live migration ledger parity, duplicates, and hash drift",
    command: ["node", ["scripts/check_migration_parity.mjs", "--self-test"]],
    optional: true,
  },
  {
    name: "rollback",
    description: "Rollback targets are immutable, verified, capability-complete",
    command: ["node", ["scripts/check_rollback_targets.mjs", "--self-test"]],
    optional: true,
  },
  {
    name: "protection",
    description: "Required branch-protection contexts can actually report",
    command: ["node", ["scripts/check_branch_protection_contexts.mjs", "--self-test"]],
  },
  {
    name: "security",
    description: "Literal-secret and privacy-exclusion scan of runtime source",
    command: ["bash", ["scripts/check_no_literal_secrets.sh"]],
  },
  {
    name: "unit",
    description: "Node unit tests for validation and boundary helpers",
    command: ["bash", ["-c", "node --test scripts/test/*_test.mjs"]],
  },
  {
    name: "memory",
    description: "Governed Memory evidence intake source contract",
    command: ["node", ["scripts/check_memory_evidence_intake.mjs"]],
  },
  {
    name: "behavior",
    description: "Memory evidence intake behavioral contract",
    command: ["node", ["scripts/test_memory_evidence_intake_behavior.mjs"]],
  },
  {
    name: "gateway",
    description: "Machine gateway namespace isolation and boundary tests (Deno)",
    command: ["node", ["scripts/run_gateway_tests.mjs"]],
  },
  {
    name: "typecheck",
    description: "TypeScript typecheck of the web boundary",
    command: ["npm", ["run", "--silent", "typecheck"]],
  },
  {
    name: "build",
    description: "Production Next.js build",
    command: ["npm", ["run", "--silent", "build"]],
    env: BUILD_ENV,
  },
];

function parseList(flag) {
  const values = [];
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === flag && argv[index + 1]) values.push(argv[index + 1]);
  }
  return values;
}

function run(stage) {
  const [command, args] = stage.command;
  const started = Date.now();
  const result = spawnSync(command, args, {
    stdio: "inherit",
    env: { ...env, ...(stage.env ?? {}) },
  });
  return {
    ok: result.status === 0,
    status: result.status,
    missing: result.error?.code === "ENOENT",
    durationMs: Date.now() - started,
  };
}

function main() {
  if (argv.includes("--list")) {
    for (const stage of STAGES) {
      stdout.write(`${stage.name.padEnd(12)} ${stage.description}\n`);
    }
    return;
  }

  const only = parseList("--only");
  const skip = new Set(parseList("--skip"));
  const selected = STAGES.filter(
    (stage) => (only.length === 0 || only.includes(stage.name)) && !skip.has(stage.name),
  );

  if (selected.length === 0) {
    console.error("No stages selected.");
    exit(2);
  }

  const results = [];
  for (const stage of selected) {
    stdout.write(`\n=== verify:${stage.name} — ${stage.description}\n`);
    const outcome = run(stage);

    // An optional stage is one whose checker has not landed on this branch yet.
    // It is reported as SKIPPED, never as passed, so a reviewer can see the gap.
    if (!outcome.ok && stage.optional && outcome.status === 1 && !outcome.missing) {
      // Distinguish "checker absent" from "checker failed": absent means the
      // file does not exist on this branch.
      const exists = spawnSync("test", ["-f", stage.command[1][0]]).status === 0;
      if (!exists) {
        results.push({ stage, state: "SKIPPED", note: "checker not present on this branch" });
        continue;
      }
    }

    results.push({
      stage,
      state: outcome.ok ? "PASS" : "FAIL",
      note: outcome.missing ? `command '${stage.command[0]}' not found` : "",
      durationMs: outcome.durationMs,
    });
  }

  stdout.write("\n================ verify summary ================\n");
  for (const { stage, state, note, durationMs } of results) {
    const timing = durationMs === undefined ? "" : ` ${(durationMs / 1000).toFixed(1)}s`;
    stdout.write(
      `${state.padEnd(8)} ${stage.name.padEnd(12)}${timing}${note ? `  (${note})` : ""}\n`,
    );
  }

  const failed = results.filter((entry) => entry.state === "FAIL");
  const skipped = results.filter((entry) => entry.state === "SKIPPED");
  stdout.write(
    `\n${results.length - failed.length - skipped.length} passed, ` +
      `${failed.length} failed, ${skipped.length} skipped\n`,
  );

  if (skip.size > 0) {
    stdout.write(
      `\nNOTE: stages explicitly skipped by the caller: ${[...skip].join(", ")}. ` +
        `A verify run with skipped stages is not a complete gate.\n`,
    );
  }

  exit(failed.length > 0 ? 1 : 0);
}

main();
