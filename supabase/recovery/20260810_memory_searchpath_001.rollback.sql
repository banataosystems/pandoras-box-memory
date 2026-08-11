-- MEMORY-SEARCHPATH-001 rollback
ALTER FUNCTION public.set_updated_at() RESET search_path;
ALTER FUNCTION public.set_pandora_shadow_context_pack_updated_at() RESET search_path;
ALTER FUNCTION public.set_pandora_promotion_requests_updated_at() RESET search_path;
ALTER FUNCTION public.set_pandora_promotion_executions_updated_at() RESET search_path;
