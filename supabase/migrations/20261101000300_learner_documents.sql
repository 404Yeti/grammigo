-- Cloud-saved progress: the SAME versioned JSON documents the app already keeps on the device.
--   lessons_v2 = "grammigo:v2"        guided_v1 = "grammigo:guided:v1"
-- Mastery, profile and recommendations are DERIVED on read and never stored here.
-- Learners can READ their own documents; they have NO write path. The server validates with zod, then calls put_document().
-- The database re-checks the basic shape (defence in depth) so no caller, however privileged, can store a malformed document.

create function public.valid_document(p_key text, p_schema int, p_body jsonb) returns boolean
language sql immutable set search_path = public, pg_temp as $$
  select coalesce(case
    when p_body is null or jsonb_typeof(p_body) <> 'object' or octet_length(p_body::text) >= 1000000 then false
    when p_key = 'lessons_v2' then p_schema = 2 and p_body->>'version' = '2'
         and jsonb_typeof(p_body->'sessions') = 'array' and jsonb_array_length(p_body->'sessions') <= 2000
         and jsonb_typeof(p_body->'onboarding') = 'object'
    when p_key = 'guided_v1'  then p_schema = 1 and p_body->>'version' = '1'
         and jsonb_typeof(p_body->'sessions') = 'array' and jsonb_array_length(p_body->'sessions') <= 100
    else false end, false);   -- a missing key makes the comparisons NULL: that must mean INVALID, never "passes"
$$;

create table public.learner_documents (
  user_id        uuid   not null references auth.users (id) on delete cascade,
  doc_key        text   not null check (doc_key in ('lessons_v2', 'guided_v1')),
  schema_version int    not null check (schema_version >= 1),
  body           jsonb  not null,
  revision       bigint not null default 1 check (revision >= 1),
  updated_at     timestamptz not null default now(),
  primary key (user_id, doc_key),
  constraint learner_documents_valid check (public.valid_document(doc_key, schema_version, body))
);
alter table public.learner_documents enable row level security;
create policy learner_documents_select_own on public.learner_documents for select to authenticated
  using (user_id = (select auth.uid()) and public.is_active_learner());
-- NO insert/update/delete policy and no grant: a browser holding a valid JWT cannot write documents directly.
grant select on public.learner_documents to authenticated;

-- The newest 10 revisions per document are kept so a bad merge can be recovered. Owner/server only.
create table public.learner_document_versions (
  user_id    uuid   not null references auth.users (id) on delete cascade,
  doc_key    text   not null,
  revision   bigint not null,
  schema_version int not null,
  body       jsonb  not null,
  created_at timestamptz not null default now(),
  primary key (user_id, doc_key, revision),
  constraint learner_document_versions_valid check (public.valid_document(doc_key, schema_version, body))
);
alter table public.learner_document_versions enable row level security;

-- Compare-and-swap write. p_expected = 0 means "create". Returns (ok, revision, error): error is 'conflict' (re-pull and
-- re-merge), 'invalid' (not a valid document) or null.
create function public.put_document(p_user uuid, p_key text, p_expected bigint, p_schema int, p_body jsonb)
returns table (ok boolean, revision bigint, error text)
language plpgsql set search_path = public, pg_temp as $$
declare cur bigint; nxt bigint;
begin
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

-- Recovery: write an earlier revision's body as a NEW revision (history is never rewritten), still compare-and-swap.
create function public.restore_document_revision(p_user uuid, p_key text, p_revision bigint, p_expected bigint, p_actor uuid)
returns table (ok boolean, revision bigint, error text)
language plpgsql set search_path = public, pg_temp as $$
declare b jsonb; s int; r record;
begin
  select v.body, v.schema_version into b, s from public.learner_document_versions v where v.user_id = p_user and v.doc_key = p_key and v.revision = p_revision;
  if b is null then return query select false, 0::bigint, 'not_found'::text; return; end if;
  select * into r from public.put_document(p_user, p_key, p_expected, s, b);
  if r.ok then insert into public.audit_events (actor, kind, meta) values (p_actor, 'document_restored', jsonb_build_object('doc', p_key, 'from', p_revision, 'to', r.revision)); end if;
  return query select r.ok, r.revision, r.error;
end $$;

revoke all on function public.valid_document(text, int, jsonb), public.put_document(uuid, text, bigint, int, jsonb),
                       public.restore_document_revision(uuid, text, bigint, bigint, uuid) from public, anon, authenticated;
grant execute on function public.valid_document(text, int, jsonb), public.put_document(uuid, text, bigint, int, jsonb),
                          public.restore_document_revision(uuid, text, bigint, bigint, uuid) to service_role;
grant all on public.learner_documents, public.learner_document_versions to service_role;
