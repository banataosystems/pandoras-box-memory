import {
  applyMemoryHealthScope,
  buildMemorySearchQuery,
  MEMORY_SEARCH_CANON_STATUSES,
  MEMORY_SEARCH_NAMESPACE,
  MEMORY_SEARCH_RESOURCE,
  type MemorySearchQueryChain,
  sanitizeMemorySearchQuery,
} from "./memory-search-policy.ts";

type MemoryRow = {
  id: string;
  user_id: string;
  namespace: "real_life" | "au";
  is_active: boolean;
  canon_status: "hard_canon" | "soft_canon" | "draft";
};

type Operation =
  | { method: "eq"; column: string; value: unknown }
  | { method: "in"; column: string; values: readonly unknown[] }
  | { method: "or"; filters: string }
  | {
    method: "order";
    column: string;
    options: { ascending: boolean };
  }
  | { method: "limit"; value: number };

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEquals(actual: unknown, expected: unknown, message: string) {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  assert(
    actualJson === expectedJson,
    `${message}: expected ${expectedJson}, received ${actualJson}`,
  );
}

class InMemoryQueryChain implements MemorySearchQueryChain {
  operations: Operation[] = [];

  constructor(public rows: MemoryRow[]) {}

  eq(column: string, value: unknown) {
    this.operations.push({ method: "eq", column, value });
    this.rows = this.rows.filter((row) =>
      row[column as keyof MemoryRow] === value
    );
    return this;
  }

  in(column: string, values: readonly unknown[]) {
    this.operations.push({ method: "in", column, values });
    this.rows = this.rows.filter((row) =>
      values.includes(row[column as keyof MemoryRow])
    );
    return this;
  }

  or(filters: string) {
    this.operations.push({ method: "or", filters });
    return this;
  }

  order(column: string, options: { ascending: boolean }) {
    this.operations.push({ method: "order", column, options });
    return this;
  }

  limit(value: number) {
    this.operations.push({ method: "limit", value });
    this.rows = this.rows.slice(0, value);
    return this;
  }
}

function fixtureRows(): MemoryRow[] {
  return [
    {
      id: "allowed-hard",
      user_id: "owner-a",
      namespace: "real_life",
      is_active: true,
      canon_status: "hard_canon",
    },
    {
      id: "blocked-same-owner-au",
      user_id: "owner-a",
      namespace: "au",
      is_active: true,
      canon_status: "hard_canon",
    },
    {
      id: "blocked-other-owner",
      user_id: "owner-b",
      namespace: "real_life",
      is_active: true,
      canon_status: "soft_canon",
    },
    {
      id: "blocked-inactive",
      user_id: "owner-a",
      namespace: "real_life",
      is_active: false,
      canon_status: "soft_canon",
    },
    {
      id: "blocked-search-draft",
      user_id: "owner-a",
      namespace: "real_life",
      is_active: true,
      canon_status: "draft",
    },
    {
      id: "allowed-soft",
      user_id: "owner-a",
      namespace: "real_life",
      is_active: true,
      canon_status: "soft_canon",
    },
  ];
}

Deno.test("memory_health count excludes same-owner AU metadata", () => {
  const query = new InMemoryQueryChain(fixtureRows());
  const scoped = applyMemoryHealthScope(query, "owner-a");

  assert(scoped === query, "health scope must preserve the query builder");
  assertEquals(
    query.rows.map((row) => row.id),
    ["allowed-hard", "blocked-search-draft", "allowed-soft"],
    "health may count only active real_life rows owned by the principal",
  );
  assertEquals(
    query.operations,
    [
      { method: "eq", column: "user_id", value: "owner-a" },
      { method: "eq", column: "namespace", value: "real_life" },
      { method: "eq", column: "is_active", value: true },
    ],
    "health metadata scope must include user, namespace, and active filters",
  );
});

Deno.test("production memory_search query excludes same-owner AU rows", () => {
  const query = new InMemoryQueryChain(fixtureRows());
  const built = buildMemorySearchQuery(query, "owner-a", "orchard", 20);

  assert(built === query, "query builder identity must be preserved");
  assertEquals(
    query.rows.map((row) => row.id),
    ["allowed-hard", "allowed-soft"],
    "only active canonical real_life rows owned by the principal may remain",
  );
  assertEquals(
    query.operations,
    [
      { method: "eq", column: "user_id", value: "owner-a" },
      { method: "eq", column: "namespace", value: "real_life" },
      { method: "eq", column: "is_active", value: true },
      {
        method: "in",
        column: "canon_status",
        values: ["hard_canon", "soft_canon"],
      },
      {
        method: "or",
        filters: "title.ilike.%orchard%,body.ilike.%orchard%",
      },
      {
        method: "order",
        column: "updated_at",
        options: { ascending: false },
      },
      { method: "limit", value: 20 },
    ],
    "production query builder must enforce every boundary before result shaping",
  );
});

Deno.test("memory_search grant resource and row namespace remain identical", () => {
  assertEquals(
    MEMORY_SEARCH_RESOURCE,
    "namespace:real_life",
    "grant resource must remain exact",
  );
  assertEquals(
    MEMORY_SEARCH_NAMESPACE,
    "real_life",
    "row namespace must remain exact",
  );
  assertEquals(
    MEMORY_SEARCH_CANON_STATUSES,
    ["hard_canon", "soft_canon"],
    "only approved canon states may be returned",
  );
});

Deno.test("memory_search rejects wildcard-only input after sanitization", () => {
  for (const wildcardOnly of ["*", "***", " %%_(), ", " *%_*,() "]) {
    assertEquals(
      sanitizeMemorySearchQuery(wildcardOnly),
      "",
      "removed wildcard and punctuation input must not become a broad match",
    );
  }
  assertEquals(
    sanitizeMemorySearchQuery(" orchard_*% "),
    "orchard",
    "ordinary query text must survive sanitization",
  );
});

Deno.test({
  name: "machine gateway handlers invoke the tested production query builders",
  async fn() {
    const source = await Deno.readTextFile(
      new URL("./index.ts", import.meta.url),
    );
    const callToolStart = source.indexOf("async function callTool(");
    const callToolEnd = source.indexOf("\n}\n\nDeno.serve(", callToolStart);
    const callToolSource = source.slice(callToolStart, callToolEnd);
    const healthBranchStart = callToolSource.indexOf(
      'if (name === "memory_health")',
    );
    const searchBranchStart = callToolSource.indexOf(
      'if (name === "memory_search")',
    );
    const searchBranchEnd = callToolSource.indexOf(
      'return rpcError(body.id, -32602, "unknown_tool");',
      searchBranchStart,
    );
    assert(
      callToolStart >= 0 && callToolEnd > callToolStart &&
        healthBranchStart >= 0 &&
        searchBranchStart > healthBranchStart &&
        searchBranchEnd > searchBranchStart &&
        searchBranchEnd < callToolSource.length,
      "health and search handler branches must remain bounded inside callTool",
    );
    const healthBranch = callToolSource.slice(
      healthBranchStart,
      searchBranchStart,
    );
    const searchBranch = callToolSource.slice(
      searchBranchStart,
      searchBranchEnd,
    );
    assert(
      /await applyMemoryHealthScope\(\s*admin\s*\.from\("memory_items"\)\s*\.select\("id", \{ count: "exact", head: true \}\),\s*identity\.userId,\s*\)/m
        .test(healthBranch),
      "memory_health branch must invoke the tested metadata-scope builder",
    );
    assert(
      /await buildMemorySearchQuery\(\s*admin\s*\.from\("memory_items"\)\s*\.select\([\s\S]*?\),\s*identity\.userId,\s*safe,\s*limit,\s*\)/m
        .test(searchBranch),
      "memory_search branch must invoke the tested production query builder",
    );
    assert(
      /const safe = sanitizeMemorySearchQuery\(query\);\s*if \(!safe\) return rpcError\(body\.id, -32602, "query_required"\);/m
        .test(searchBranch),
      "sanitized-empty queries must fail before downstream access",
    );
    assertEquals(
      searchBranch.match(/MEMORY_SEARCH_RESOURCE/g)?.length,
      3,
      "authorization and both audit outcomes must use the shared resource",
    );
  },
});
