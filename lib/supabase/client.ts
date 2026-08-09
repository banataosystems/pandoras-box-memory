import { createBrowserClient } from "@supabase/ssr";

export function publicSupabaseConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  return { url, key };
}

export function hasSupabaseBrowserConfig() {
  const { url, key } = publicSupabaseConfig();
  return Boolean(url && key);
}

export function createSupabaseBrowserClient() {
  const { url, key } = publicSupabaseConfig();
  if (!url || !key) throw new Error("supabase_public_config_missing");
  return createBrowserClient(url, key);
}
