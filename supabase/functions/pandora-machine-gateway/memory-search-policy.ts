export const MEMORY_SEARCH_NAMESPACE = "real_life" as const;
export const MEMORY_SEARCH_RESOURCE =
  `namespace:${MEMORY_SEARCH_NAMESPACE}` as const;
export const MEMORY_SEARCH_CANON_STATUSES = [
  "hard_canon",
  "soft_canon",
] as const;

export type MemoryScopeFilterChain = {
  eq(column: string, value: unknown): MemoryScopeFilterChain;
};

export type MemorySearchFilterChain = MemoryScopeFilterChain & {
  in(column: string, values: readonly unknown[]): MemorySearchFilterChain;
};

export type MemorySearchQueryChain = MemorySearchFilterChain & {
  or(filters: string): MemorySearchQueryChain;
  order(
    column: string,
    options: { ascending: boolean },
  ): MemorySearchQueryChain;
  limit(value: number): MemorySearchQueryChain;
};

export function sanitizeMemorySearchQuery(query: string): string {
  return query
    .replace(/[%_*]/g, "")
    .replace(/[(),]/g, " ")
    .trim();
}

/**
 * Constrain health metadata to the machine gateway's real_life boundary.
 *
 * The gateway uses a service-role client, so even aggregate counts must not
 * disclose the existence of same-owner rows in another namespace.
 */
export function applyMemoryHealthScope<T>(
  query: T,
  userId: string,
): T {
  const filterable = query as unknown as MemoryScopeFilterChain;
  return filterable
    .eq("user_id", userId)
    .eq("namespace", MEMORY_SEARCH_NAMESPACE)
    .eq("is_active", true) as unknown as T;
}

/**
 * Apply every row-level boundary represented by the memory_search grant.
 */
export function applyMemorySearchScope<T>(
  query: T,
  userId: string,
): T {
  const filterable = applyMemoryHealthScope(
    query,
    userId,
  ) as unknown as MemorySearchFilterChain;
  return filterable
    .in("canon_status", MEMORY_SEARCH_CANON_STATUSES) as unknown as T;
}

/**
 * Build the exact production memory_search query after input sanitization.
 *
 * Both the Edge Function handler and the same-owner cross-namespace regression
 * invoke this function, binding the test to the production query assembly.
 */
export function buildMemorySearchQuery<T>(
  query: T,
  userId: string,
  safeQuery: string,
  limit: number,
): T {
  const searchable = applyMemorySearchScope(
    query,
    userId,
  ) as unknown as MemorySearchQueryChain;
  return searchable
    .or(`title.ilike.%${safeQuery}%,body.ilike.%${safeQuery}%`)
    .order("updated_at", { ascending: false })
    .limit(limit) as unknown as T;
}
