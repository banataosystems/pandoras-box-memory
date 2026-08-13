import { createClient } from "npm:@supabase/supabase-js@2.110.9";
import {
  buildMemorySearchQuery,
  MEMORY_SEARCH_NAMESPACE,
} from "./memory-search-policy.ts";

function assertEquals(actual: unknown, expected: unknown, message: string) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${expected}, received ${actual}`);
  }
}

Deno.test("PostgREST query assembly encodes every memory_search boundary", () => {
  const client = createClient(
    "https://example.supabase.co",
    "public-anon-key",
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const query = client
    .from("memory_items")
    .select("id,title,body,namespace,canon_status");

  const built = buildMemorySearchQuery(
    query,
    "owner-a",
    "orchard",
    20,
  );
  const url = new URL(
    (built as unknown as { url: URL }).url,
  );

  assertEquals(
    url.searchParams.get("user_id"),
    "eq.owner-a",
    "PostgREST user predicate",
  );
  assertEquals(
    url.searchParams.get("namespace"),
    `eq.${MEMORY_SEARCH_NAMESPACE}`,
    "PostgREST namespace predicate",
  );
  assertEquals(
    url.searchParams.get("is_active"),
    "eq.true",
    "PostgREST active predicate",
  );
  assertEquals(
    url.searchParams.get("canon_status"),
    "in.(hard_canon,soft_canon)",
    "PostgREST canon-state predicate",
  );
  assertEquals(
    url.searchParams.get("or"),
    "(title.ilike.%orchard%,body.ilike.%orchard%)",
    "PostgREST text predicate",
  );
  assertEquals(
    url.searchParams.get("order"),
    "updated_at.desc",
    "PostgREST ordering",
  );
  assertEquals(
    url.searchParams.get("limit"),
    "20",
    "PostgREST result limit",
  );
});
