import { readFile } from "node:fs/promises";
import {
  ROADMAP,
  fetchPinnedRoadmap,
  normalizeRoadmap,
  sha256,
} from "./compounding-registry-lib.mjs";

const [liveRoadmap, versionedSource] = await Promise.all([
  fetchPinnedRoadmap(),
  readFile(ROADMAP.path, "utf8").then(normalizeRoadmap),
]);

if (versionedSource !== liveRoadmap) {
  throw new Error(
    "Versioned roadmap source differs from live issue #22 despite matching identity checks",
  );
}

console.log(`Live roadmap issue #${ROADMAP.issue}: PASS`);
console.log(`Title/state/body identity: PASS (${sha256(liveRoadmap)})`);
console.log("Versioned roadmap byte parity: PASS");
