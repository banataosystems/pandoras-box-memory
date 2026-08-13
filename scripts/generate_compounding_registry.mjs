import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  REGISTRY_PATH,
  ROADMAP,
  buildRegistry,
  fetchPinnedRoadmap,
  readBaselineTree,
  validateRegistry,
} from "./compounding-registry-lib.mjs";

if (!process.argv.includes("--write")) {
  throw new Error("Generation is write-explicit: pass --write");
}

const roadmapBody = await fetchPinnedRoadmap();

const treeEntries = readBaselineTree();
const registry = buildRegistry(treeEntries);
const errors = validateRegistry(registry, treeEntries, roadmapBody);
if (errors.length > 0) {
  throw new Error(`Generated registry failed validation:\n- ${errors.join("\n- ")}`);
}

await mkdir(dirname(ROADMAP.path), { recursive: true });
await mkdir(dirname(REGISTRY_PATH), { recursive: true });
await writeFile(ROADMAP.path, `${roadmapBody}\n`, "utf8");
await writeFile(REGISTRY_PATH, `${JSON.stringify(registry, null, 2)}\n`, "utf8");

console.log(`Wrote ${ROADMAP.path}`);
console.log(`Wrote ${REGISTRY_PATH} with ${treeEntries.length}/${treeEntries.length} canonical baseline files`);
console.log("Original archive coverage remains blocked at 0/782; no project completion percentage was created.");
