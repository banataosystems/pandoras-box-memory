#!/usr/bin/env node
// Run the Deno-based Edge Function test suites.
//
// The gateway and bridge run on Deno in production, so their regressions must
// run on Deno too — reimplementing them under Node would test a different
// runtime than the one that actually serves traffic.
//
// If Deno is absent this exits non-zero with install instructions. It must not
// silently pass: a missing runtime is an unproven gate, not a green one.

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { exit } from "node:process";

const GATEWAY = "supabase/functions/pandora-machine-gateway";

const SUITES = [
  {
    label: "machine gateway",
    config: `${GATEWAY}/deno.json`,
    permissions: [`--allow-read=${GATEWAY}/index.ts`],
    tests: [
      `${GATEWAY}/memory-search-policy_test.ts`,
      `${GATEWAY}/memory-search-postgrest_test.ts`,
      `${GATEWAY}/request-limits_test.ts`,
      `${GATEWAY}/audit-durability_test.ts`,
    ],
  },
];

function denoVersion() {
  const probe = spawnSync("deno", ["--version"], { encoding: "utf8" });
  if (probe.error || probe.status !== 0) return null;
  return probe.stdout.split("\n")[0].trim();
}

function main() {
  const version = denoVersion();
  if (!version) {
    console.error(
      "Deno is required to run the Edge Function test suites.\n" +
        "  Install:  curl -fsSL https://deno.land/install.sh | sh\n" +
        "  CI pins:  denoland/setup-deno with deno-version v2.4.3\n" +
        "\nThis gate fails closed rather than reporting an unproven pass.",
    );
    exit(1);
  }
  console.log(`Using ${version}`);

  let failed = 0;
  for (const suite of SUITES) {
    const tests = suite.tests.filter((path) => existsSync(path));
    const absent = suite.tests.filter((path) => !existsSync(path));
    for (const path of absent) {
      console.log(`  (not on this branch, skipping: ${path})`);
    }
    if (tests.length === 0) {
      console.log(`No ${suite.label} test files present; nothing to run.`);
      continue;
    }

    console.log(`\n--- ${suite.label}: deno test`);
    const test = spawnSync(
      "deno",
      ["test", "--config", suite.config, ...suite.permissions, ...tests],
      { stdio: "inherit" },
    );
    if (test.status !== 0) failed += 1;

    console.log(`\n--- ${suite.label}: deno check`);
    const check = spawnSync(
      "deno",
      ["check", "--config", suite.config, `${GATEWAY}/index.ts`],
      { stdio: "inherit" },
    );
    if (check.status !== 0) failed += 1;
  }

  exit(failed > 0 ? 1 : 0);
}

main();
