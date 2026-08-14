"use strict";

const fs = require("node:fs");

const bridge = fs.readFileSync("supabase/functions/pandora-projectos-bridge/index.ts", "utf8");
const lines = bridge.split(/\r?\n/);
const interesting = [];
for (let index = 0; index < lines.length; index += 1) {
  const trimmed = lines[index].trim();
  if (
    /Deno|serve|query_only|canonical_writes|body\.action|searchMemory|authorize\(/.test(trimmed)
  ) {
    interesting.push({ line: index + 1, signature: trimmed.slice(0, 240) });
  }
}

const result = {
  bridge_bytes: Buffer.byteLength(bridge, "utf8"),
  has_deno_serve: bridge.includes("Deno.serve"),
  has_serve_call: bridge.includes("serve("),
  has_query_only_true: bridge.includes("query_only: true"),
  has_canonical_writes_false: bridge.includes("canonical_writes: false"),
  has_search_action: bridge.includes('body.action === "search"'),
  has_search_memory_call: bridge.includes("searchMemory("),
  first_deno_serve_index: bridge.indexOf("Deno.serve"),
  first_serve_call_index: bridge.indexOf("serve("),
  first_search_action_index: bridge.indexOf('body.action === "search"'),
  interesting: interesting.slice(0, 80),
};

fs.writeFileSync(
  "scripts/memory-evidence-anchor-diagnostic.json",
  JSON.stringify(result, null, 2) + "\n",
);
