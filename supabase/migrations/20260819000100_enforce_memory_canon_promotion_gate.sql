-- Forward-only hardening for Pandora Memory canonical promotion.
--
-- Authenticated candidate intake may create draft records only. Canonical
-- promotion remains a separately governed service-role operation with durable
-- review evidence. This migration does not rewrite or reclassify existing data.

DROP POLICY IF EXISTS memory_items_insert_own ON public.memory_items;

CREATE POLICY memory_items_insert_own
ON public.memory_items
FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() = user_id
  AND canon_status = 'draft'::public.canon_status
  AND approved_by IS NULL
  AND approved_at IS NULL
  AND effective_at IS NULL
  AND superseded_by IS NULL
  AND superseded_at IS NULL
  AND revoked_at IS NULL
  AND revocation_reason IS NULL
  AND is_active IS TRUE
);

CREATE OR REPLACE FUNCTION public.save_validated_memory_candidate_transaction(
  p_namespace public.pandora_namespace,
  p_memory_type public.memory_type,
  p_title text,
  p_body text,
  p_strength public.memory_strength,
  p_confidence numeric,
  p_canon_status public.canon_status,
  p_source_summary text DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb,
  p_sources jsonb DEFAULT '[]'::jsonb,
  p_scope text DEFAULT 'memory_candidate',
  p_operation text DEFAULT 'saveMemoryCandidate',
  p_idempotency_key text DEFAULT NULL,
  p_key_source text DEFAULT 'payload',
  p_fingerprint text DEFAULT NULL,
  p_request_hash text DEFAULT NULL,
  p_response_hash text DEFAULT NULL,
  p_expires_at timestamptz DEFAULT NULL
)
RETURNS TABLE (
  memory_item_id uuid,
  source_ids uuid[],
  idempotency_record_id uuid,
  was_claimed boolean,
  existing_status text
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_record_id uuid;
  v_existing_status text;
  v_memory_item_id uuid;
  v_source_ids uuid[] := '{}'::uuid[];
  v_source jsonb;
  v_source_id uuid;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'auth_required';
  END IF;

  IF p_canon_status IS DISTINCT FROM 'draft'::public.canon_status THEN
    RAISE EXCEPTION 'candidate_canon_status_must_be_draft'
      USING ERRCODE = '22023';
  END IF;

  IF p_idempotency_key IS NULL OR length(p_idempotency_key) = 0 THEN
    RAISE EXCEPTION 'idempotency_key_required';
  END IF;

  IF p_fingerprint IS NULL OR length(p_fingerprint) = 0 THEN
    RAISE EXCEPTION 'idempotency_fingerprint_required';
  END IF;

  IF p_confidence < 0 OR p_confidence > 1 THEN
    RAISE EXCEPTION 'confidence_out_of_range';
  END IF;

  IF jsonb_typeof(coalesce(p_sources, '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'sources_must_be_array';
  END IF;

  INSERT INTO public.idempotency_records (
    user_id,
    namespace,
    scope,
    operation,
    idempotency_key,
    key_source,
    fingerprint,
    request_hash,
    status,
    metadata,
    expires_at
  )
  VALUES (
    v_user_id,
    p_namespace,
    p_scope,
    p_operation,
    p_idempotency_key,
    p_key_source,
    p_fingerprint,
    p_request_hash,
    'started',
    jsonb_build_object('transaction_rpc', 'memory_candidate') || coalesce(p_metadata, '{}'::jsonb),
    p_expires_at
  )
  ON CONFLICT (user_id, namespace, fingerprint) DO NOTHING
  RETURNING id INTO v_record_id;

  IF v_record_id IS NULL THEN
    SELECT id, status
      INTO v_record_id, v_existing_status
    FROM public.idempotency_records
    WHERE user_id = v_user_id
      AND namespace = p_namespace
      AND fingerprint = p_fingerprint
    LIMIT 1;

    RETURN QUERY
      SELECT NULL::uuid, '{}'::uuid[], v_record_id, FALSE, v_existing_status;
    RETURN;
  END IF;

  INSERT INTO public.memory_items (
    user_id,
    namespace,
    memory_type,
    title,
    body,
    strength,
    confidence,
    canon_status,
    source_summary,
    metadata,
    is_active
  )
  VALUES (
    v_user_id,
    p_namespace,
    p_memory_type,
    p_title,
    p_body,
    p_strength,
    p_confidence,
    'draft'::public.canon_status,
    p_source_summary,
    coalesce(p_metadata, '{}'::jsonb),
    TRUE
  )
  RETURNING id INTO v_memory_item_id;

  FOR v_source IN
    SELECT value
    FROM jsonb_array_elements(coalesce(p_sources, '[]'::jsonb))
  LOOP
    INSERT INTO public.memory_sources (
      user_id,
      namespace,
      memory_item_id,
      source_type,
      source_ref,
      excerpt,
      confidence,
      metadata
    )
    VALUES (
      v_user_id,
      p_namespace,
      v_memory_item_id,
      (v_source ->> 'source_type')::public.evidence_source_type,
      v_source ->> 'source_ref',
      v_source ->> 'excerpt',
      coalesce((v_source ->> 'confidence')::numeric, p_confidence),
      coalesce(v_source -> 'metadata', '{}'::jsonb)
    )
    RETURNING id INTO v_source_id;

    v_source_ids := array_append(v_source_ids, v_source_id);
  END LOOP;

  UPDATE public.idempotency_records
  SET
    status = 'completed',
    response_hash = p_response_hash,
    metadata = coalesce(metadata, '{}'::jsonb)
      || jsonb_build_object('memory_item_id', v_memory_item_id),
    updated_at = now()
  WHERE id = v_record_id
    AND user_id = v_user_id
    AND namespace = p_namespace
    AND fingerprint = p_fingerprint;

  RETURN QUERY
    SELECT v_memory_item_id, v_source_ids, v_record_id, TRUE, 'completed'::text;
END;
$$;

REVOKE ALL ON FUNCTION public.save_validated_memory_candidate_transaction(
  public.pandora_namespace,
  public.memory_type,
  text,
  text,
  public.memory_strength,
  numeric,
  public.canon_status,
  text,
  jsonb,
  jsonb,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  timestamptz
) FROM PUBLIC, anon, authenticator;

GRANT EXECUTE ON FUNCTION public.save_validated_memory_candidate_transaction(
  public.pandora_namespace,
  public.memory_type,
  text,
  text,
  public.memory_strength,
  numeric,
  public.canon_status,
  text,
  jsonb,
  jsonb,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  timestamptz
) TO authenticated, service_role;

COMMENT ON FUNCTION public.save_validated_memory_candidate_transaction(
  public.pandora_namespace,
  public.memory_type,
  text,
  text,
  public.memory_strength,
  numeric,
  public.canon_status,
  text,
  jsonb,
  jsonb,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  timestamptz
) IS 'Authenticated candidate intake is draft-only. Canonical promotion requires the separately governed service-role review path.';
