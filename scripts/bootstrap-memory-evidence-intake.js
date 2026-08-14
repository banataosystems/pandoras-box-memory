"use strict";

const fs = require("node:fs");

const bridgePath = "supabase/functions/pandora-projectos-bridge/index.ts";
let bridge = fs.readFileSync(bridgePath, "utf8");
const helper = fs.readFileSync("scripts/memory-evidence-helper.fragment.ts", "utf8").trimEnd() + "\n\n";

if (bridge.includes("const submitEvidenceCandidate = async")) {
  throw new Error("evidence candidate helper already present");
}

const servePattern = /Deno\.serve\(\s*async\s*\(\s*request(?:\s*:\s*Request)?\s*\)\s*=>\s*\{/;
const serveMatch = servePattern.exec(bridge);
if (!serveMatch || serveMatch.index === undefined) {
  throw new Error("Deno serve anchor missing");
}
bridge = bridge.slice(0, serveMatch.index) + helper + bridge.slice(serveMatch.index);

const searchDispatchPattern = /  if \(body\.action === "search"\) \{\s*\n\s*return searchMemory\(body, authorization\.principal, supabase\);\s*\n\s*\}/;
const searchMatch = searchDispatchPattern.exec(bridge);
if (!searchMatch || searchMatch.index === undefined) {
  throw new Error("search dispatch anchor missing");
}
const evidenceDispatch =
  '  if (body.action === "submit_evidence_candidate") {\n' +
  '    return submitEvidenceCandidate(body, authorization.principal, supabase);\n' +
  '  }\n';
bridge = bridge.slice(0, searchMatch.index) + evidenceDispatch + bridge.slice(searchMatch.index);

fs.writeFileSync(bridgePath, bridge);
