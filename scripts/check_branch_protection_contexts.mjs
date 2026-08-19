#!/usr/bin/env node
// Guard against a required status check that can never report.
//
// The defect this exists to prevent, found in independent review of the first
// governance draft:
//
//   `.github/branch-protection/main.json` listed required contexts that come
//   from PATH-FILTERED workflows. GitHub blocks a pull request until every
//   required context reports. A path-filtered workflow does not run — and
//   therefore never reports — on a pull request that does not touch its paths.
//   The result is a valid PR permanently blocked, waiting for a check that will
//   never arrive. That is an outage of the merge path disguised as governance.
//
// So the rule is: a context may be REQUIRED only if its workflow runs
// unconditionally on `pull_request`. Path-filtered workflows remain valuable as
// targeted signal; they just must not gate the merge.
//
// This parses the workflow files rather than trusting a hand-maintained list,
// and fails closed if it cannot parse one.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { argv, exit } from "node:process";

const WORKFLOW_DIR = ".github/workflows";
const RULESET_PATH = ".github/branch-protection/main.json";

/**
 * Extract, for one workflow file, the check-run names it produces and whether
 * its `pull_request` trigger is path-filtered.
 *
 * GitHub names a check run after the job's `name:` when present, and after the
 * job id otherwise — so both must be resolved to compare against the ruleset.
 */
export function parseWorkflow(text) {
  const lines = text.split("\n");

  let inOn = false;
  let inPullRequest = false;
  let pullRequestPresent = false;
  let pathFiltered = false;

  let inJobs = false;
  const jobs = [];
  let currentJob = null;

  for (const raw of lines) {
    if (!raw.trim() || raw.trimStart().startsWith("#")) continue;
    const indent = raw.length - raw.trimStart().length;
    const line = raw.trim();

    // --- top-level keys -----------------------------------------------------
    if (indent === 0) {
      inOn = /^on:/.test(line);
      inJobs = /^jobs:/.test(line);
      inPullRequest = false;
      if (currentJob) {
        jobs.push(currentJob);
        currentJob = null;
      }
      continue;
    }

    // --- on: block ----------------------------------------------------------
    if (inOn) {
      if (indent === 2) {
        inPullRequest = /^pull_request:/.test(line);
        if (inPullRequest) pullRequestPresent = true;
        continue;
      }
      if (inPullRequest && indent >= 4 && /^paths(-ignore)?:/.test(line)) {
        pathFiltered = true;
      }
      continue;
    }

    // --- jobs: block --------------------------------------------------------
    if (inJobs) {
      if (indent === 2 && /^[A-Za-z0-9_-]+:\s*$/.test(line)) {
        if (currentJob) jobs.push(currentJob);
        currentJob = { id: line.replace(/:\s*$/, ""), name: null };
        continue;
      }
      if (currentJob && indent === 4 && /^name:/.test(line)) {
        currentJob.name = line
          .replace(/^name:\s*/, "")
          .replace(/^["']|["']$/g, "");
      }
    }
  }
  if (currentJob) jobs.push(currentJob);

  return {
    pullRequestPresent,
    pathFiltered,
    // The name GitHub will show for each check run.
    checkNames: jobs.map((job) => job.name ?? job.id),
  };
}

function loadWorkflows(dir) {
  const workflows = new Map();
  for (const file of readdirSync(dir).filter((n) => /\.ya?ml$/.test(n))) {
    workflows.set(file, parseWorkflow(readFileSync(`${dir}/${file}`, "utf8")));
  }
  return workflows;
}

/** Validate the ruleset's required contexts against the parsed workflows. */
export function validate(ruleset, workflows) {
  const errors = [];
  const contexts = ruleset?.required_status_checks?.contexts;

  if (!Array.isArray(contexts)) {
    return ["ruleset has no required_status_checks.contexts array"];
  }

  // name -> { file, pathFiltered, runsOnPullRequest }
  const byName = new Map();
  for (const [file, workflow] of workflows) {
    for (const name of workflow.checkNames) {
      // A duplicate check name across workflows is itself ambiguous: GitHub
      // cannot tell which one satisfied the requirement.
      if (byName.has(name)) {
        errors.push(
          `check name '${name}' is produced by both ${byName.get(name).file} ` +
            `and ${file}; a required context must be unambiguous`,
        );
      }
      byName.set(name, {
        file,
        pathFiltered: workflow.pathFiltered,
        runsOnPullRequest: workflow.pullRequestPresent,
      });
    }
  }

  const seen = new Set();
  for (const context of contexts) {
    if (seen.has(context)) errors.push(`duplicate required context '${context}'`);
    seen.add(context);

    const source = byName.get(context);
    if (!source) {
      errors.push(
        `required context '${context}' is produced by no workflow job — it can ` +
          `never report, so it would block every pull request forever`,
      );
      continue;
    }
    if (!source.runsOnPullRequest) {
      errors.push(
        `required context '${context}' (${source.file}) has no pull_request ` +
          `trigger, so it never reports on a pull request`,
      );
    }
    if (source.pathFiltered) {
      errors.push(
        `required context '${context}' (${source.file}) is path-filtered on ` +
          `pull_request. It will not report on a PR that touches none of its ` +
          `paths, permanently blocking merge. Either remove the paths filter ` +
          `or stop requiring this context.`,
      );
    }
  }

  return errors;
}

function selfTest() {
  const filtered = parseWorkflow(`
name: Filtered
on:
  pull_request:
    paths:
      - "app/**"
jobs:
  build:
    name: Build it
    runs-on: ubuntu-latest
`);
  const unconditional = parseWorkflow(`
name: Always
on:
  pull_request:
  push:
    branches: [main]
jobs:
  verify:
    name: Verify exact candidate source
    runs-on: ubuntu-latest
`);
  const unnamed = parseWorkflow(`
name: Unnamed
on:
  pull_request:
jobs:
  no-literal-secrets:
    runs-on: ubuntu-latest
`);

  const cases = [];
  const check = (label, condition) => cases.push([label, condition]);

  check("path filter detected", filtered.pathFiltered === true);
  check("unconditional not flagged", unconditional.pathFiltered === false);
  check("job name used as check name", filtered.checkNames[0] === "Build it");
  check(
    "job id used when unnamed",
    unnamed.checkNames[0] === "no-literal-secrets",
  );
  check("pull_request presence detected", unconditional.pullRequestPresent === true);

  const workflows = new Map([
    ["filtered.yml", filtered],
    ["always.yml", unconditional],
  ]);

  check(
    "path-filtered required context is rejected",
    validate({ required_status_checks: { contexts: ["Build it"] } }, workflows)
      .some((m) => m.includes("path-filtered")),
  );
  check(
    "unconditional required context is accepted",
    validate(
      { required_status_checks: { contexts: ["Verify exact candidate source"] } },
      workflows,
    ).length === 0,
  );
  check(
    "unknown required context is rejected",
    validate({ required_status_checks: { contexts: ["ghost"] } }, workflows)
      .some((m) => m.includes("never report")),
  );
  check(
    "duplicate required context is rejected",
    validate(
      {
        required_status_checks: {
          contexts: [
            "Verify exact candidate source",
            "Verify exact candidate source",
          ],
        },
      },
      workflows,
    ).some((m) => m.includes("duplicate")),
  );

  const failures = cases.filter(([, ok]) => !ok);
  for (const [label] of failures) console.error(`SELF-TEST FAIL: ${label}`);
  if (failures.length > 0) exit(1);
  console.log(`Branch-protection context self-test passed (${cases.length} cases).`);
}

function main() {
  if (argv.includes("--self-test")) selfTest();

  if (!existsSync(RULESET_PATH)) {
    console.error(`Missing ${RULESET_PATH}`);
    exit(1);
  }
  const ruleset = JSON.parse(readFileSync(RULESET_PATH, "utf8"));
  const workflows = loadWorkflows(WORKFLOW_DIR);
  const errors = validate(ruleset, workflows);

  if (errors.length > 0) {
    console.error("Branch-protection context gate FAILED:");
    for (const message of errors) console.error(`  - ${message}`);
    exit(1);
  }

  const contexts = ruleset.required_status_checks.contexts;
  console.log(
    `Branch-protection context gate passed: ${contexts.length} required ` +
      `contexts, all produced by workflows that run unconditionally on pull_request.`,
  );
}

main();
