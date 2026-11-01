-- Phase 5: cloud-saved progress needs the learner's explicit consent, enforced by the DATABASE, not only by the route.
-- Server only (service role). Nothing is granted to anon or authenticated.

-- Records that this learner agreed to keep their progress in their account. Idempotent: a second call changes nothing.
-- The version is the privacy-notice version they saw. Only the cloud-storage consent can be recorded here.
create function public.record_consent(p_user uuid, p_version text) returns void
language plpgsql set search_path = public, pg_temp as $$
begin
  if char_length(p_version) not between 1 and 32 then raise exception 'invalid version'; end if;
  -- the learner must exist and be active: an uninvited identity cannot opt in to anything
  if not exists (select 1 from public.profiles where id = p_user and status = 'active') then raise exception 'not an active learner'; end if;
  perform pg_advisory_xact_lock(hashtextextended('consent:' || p_user::text, 0)); -- two concurrent calls cannot both insert
  if not exists (select 1 from public.consents where user_id = p_user and kind = 'cloud_storage') then
    insert into public.consents (user_id, kind, version) values (p_user, 'cloud_storage', p_version);
  end if;
end $$;

-- Same function as before, with ONE added rule at the top: no document is stored for a learner who has not consented.
-- (Defence in depth: the route checks too, but no caller, however privileged, can store progress without the recorded consent.)
create or replace function public.put_document(p_user uuid, p_key text, p_expected bigint, p_schema int, p_body jsonb)
returns table (ok boolean, revision bigint, error text)
language plpgsql set search_path = public, pg_temp as $$
declare cur bigint; nxt bigint;
begin
  if not exists (select 1 from public.consents c where c.user_id = p_user and c.kind = 'cloud_storage') then
    return query select false, 0::bigint, 'consent_required'::text; return;
  end if;
  if not public.valid_document(p_key, p_schema, p_body) then return query select false, 0::bigint, 'invalid'::text; return; end if;
  select d.revision into cur from public.learner_documents d where d.user_id = p_user and d.doc_key = p_key for update;
  if cur is null then
    if p_expected <> 0 then return query select false, 0::bigint, 'conflict'::text; return; end if;
    insert into public.learner_documents (user_id, doc_key, schema_version, body, revision) values (p_user, p_key, p_schema, p_body, 1);
    insert into public.learner_document_versions (user_id, doc_key, revision, schema_version, body) values (p_user, p_key, 1, p_schema, p_body);
    return query select true, 1::bigint, null::text; return;
  end if;
  if cur <> p_expected then return query select false, cur, 'conflict'::text; return; end if;
  nxt := cur + 1;
  update public.learner_documents d set body = p_body, schema_version = p_schema, revision = nxt, updated_at = now()
   where d.user_id = p_user and d.doc_key = p_key;
  insert into public.learner_document_versions (user_id, doc_key, revision, schema_version, body) values (p_user, p_key, nxt, p_schema, p_body);
  delete from public.learner_document_versions v where v.user_id = p_user and v.doc_key = p_key and v.revision <= nxt - 10;
  return query select true, nxt, null::text;
end $$;

revoke all on function public.record_consent(uuid, text) from public, anon, authenticated;
grant execute on function public.record_consent(uuid, text) to service_role;
