#!/usr/bin/env node
// Merge append-only evidence-index fragments into a temporary canonical view,
// run the original immutable evidence gate, then restore the exact base bytes.
//
// This keeps docs/evidence/EVIDENCE_INDEX.json and the original validator
// byte-for-byte recoverable while allowing concurrent governed lanes to add
// classifications without rewriting historical entries.

import { spawnSync } from "node:child_process";
import {
  existsSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { argv, exit } from "node:process";

const INDEX_PATH = "docs/evidence/EVIDENCE_INDEX.json";
const FRAGMENT_DIRECTORY = "docs/evidence";
const FRAGMENT_PATTERN = /^EVIDENCE_INDEX_APPEND_[A-Z0-9_-]+\.json$/i;
const DELEGATE_PATH = "scripts/check_evidence_metadata_base.mjs";

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`${path} is not valid JSON: ${error.message}`);
  }
}

function fragmentPaths() {
  if (!existsSync(FRAGMENT_DIRECTORY)) return [];
  return readdirSync(FRAGMENT_DIRECTORY, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isFile() && FRAGMENT_PATTERN.test(entry.name),
    )
    .map((entry) => join(FRAGMENT_DIRECTORY, entry.name))
    .sort();
}

function mergedIndex() {
  const base = readJson(INDEX_PATH);
  if (!base || typeof base !== "object" || !Array.isArray(base.entries)) {
    throw new Error(`${INDEX_PATH} must be an object with an entries array`);
  }

  const entries = [...base.entries];
  for (const path of fragmentPaths()) {
    const fragment = readJson(path);
    if (
      !fragment ||
      typeof fragment !== "object" ||
      Array.isArray(fragment)
    ) {
      throw new Error(`${path} must be a JSON object`);
    }
    if (
      typeof fragment.fragment_id !== "string" ||
      !fragment.fragment_id.trim()
    ) {
      throw new Error(`${path} must declare a non-empty fragment_id`);
    }
    if (fragment.schema_version !== base.schema_version) {
      throw new Error(
        `${path} schema_version '${fragment.schema_version}' does not match ` +
          `${INDEX_PATH} '${base.schema_version}'`,
      );
    }
    if (!Array.isArray(fragment.entries) || fragment.entries.length === 0) {
      throw new Error(`${path} must contain a non-empty entries array`);
    }
    entries.push(...fragment.entries);
  }

  return { ...base, entries };
}

function main() {
  if (!existsSync(INDEX_PATH)) {
    console.error(`Missing ${INDEX_PATH}`);
    exit(1);
  }
  if (!existsSync(DELEGATE_PATH)) {
    console.error(`Missing ${DELEGATE_PATH}`);
    exit(1);
  }

  const original = readFileSync(INDEX_PATH);
  let status = 1;

  try {
    const merged = `${JSON.stringify(mergedIndex(), null, 2)}\n`;
    writeFileSync(INDEX_PATH, merged, "utf8");

    const result = spawnSync(
      process.execPath,
      [DELEGATE_PATH, ...argv.slice(2)],
      {
        stdio: "inherit",
        env: process.env,
      },
    );
    if (result.error) throw result.error;
    status = Number.isInteger(result.status) ? result.status : 1;
  } catch (error) {
    console.error(`Evidence-index fragment gate failed: ${error.message}`);
    status = 1;
  } finally {
    writeFileSync(INDEX_PATH, original);
  }

  exit(status);
}

main();
