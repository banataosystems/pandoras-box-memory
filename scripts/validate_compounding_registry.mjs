import { readFile } from "node:fs/promises";
import {
  REGISTRY_PATH,
  ROADMAP,
  readBaselineTree,
  validateRegistry,
} from "./compounding-registry-lib.mjs";

const [registryText, roadmapText] = await Promise.all([
  readFile(REGISTRY_PATH, "utf8"),
  readFile(ROADMAP.path, "utf8"),
]);
const registry = JSON.parse(registryText);
const treeEntries = readBaselineTree();
const errors = validateRegistry(registry, treeEntries, roadmapText);

if (errors.length > 0) {
  console.error("Pandora compounding capability registry validation failed:");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`Roadmap issue #${ROADMAP.issue} source hash: PASS`);
console.log(`Canonical baseline coverage: PASS (${treeEntries.length}/${treeEntries.length})`);
console.log("Original archive completeness: FAIL-CLOSED (0/782, artifact unavailable)");
console.log("Proof-state separation and provenance: PASS");
console.log("No merge or production release is authorized by this registry.");
