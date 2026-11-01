-- Phase 6: account lifecycle (export, deletion, restore safety). SERVER ONLY (service role). Nothing here is granted to anon or authenticated.

-- ---------------------------------------------------------------- deletion refuses the owner
-- Deleting an owner (app_admins) through the self-service path would silently remove the only person who can manage invitations. The owner is
-- removed deliberately, by hand, with the admin CLI. Everything else about delete_learner is as before: the ledger entry, the audit row and the
-- delete are ONE transaction, so there is never a deletion without its ledger entry.
create or replace function public.delete_learner(p_user uuid, p_user_hash bytea)
returns void language plpgsql security definer set search_path = public, auth, pg_temp as $$
begin
  if exists (select 1 from public.app_admins a where a.user_id = p_user) then
    raise exception 'owner accounts are not deleted through this path' using errcode = 'P0001';
  end if;
  insert into public.deletion_ledger (user_hash) values (p_user_hash) on conflict do nothing;
  insert into public.audit_events (kind, meta) values ('account_deleted', '{}'::jsonb);   -- no actor, no personal data
  delete from auth.users where id = p_user;
end $$;

-- ---------------------------------------------------------------- export is audited (the fact, never the content)
create function public.audit_export(p_user uuid) returns void
language plpgsql set search_path = public, pg_temp as $$
begin
  insert into public.audit_events (actor, kind) values (p_user, 'export_requested');
end $$;

-- ---------------------------------------------------------------- restore safety: replaying the deletion ledger
-- After a backup is restored, people who asked to be deleted AFTER the backup was taken are back. The ledger holds a keyed hash of each deleted id.
-- The operator script lists the ids that exist, hashes them with the same key, and removes every match with redelete_learner. These three
-- functions are the whole database side of that; the hashing stays outside the database, because the key must never be stored next to the data.
create function public.all_user_ids() returns setof uuid
language sql stable security definer set search_path = public, auth, pg_temp as $$
  select id from auth.users;
$$;

create function public.ledger_hashes() returns setof bytea
language sql stable set search_path = public, pg_temp as $$
  select user_hash from public.deletion_ledger;
$$;

create function public.redelete_learner(p_user uuid) returns boolean
language plpgsql security definer set search_path = public, auth, pg_temp as $$
declare n int;
begin
  if exists (select 1 from public.app_admins a where a.user_id = p_user) then return false; end if;
  delete from auth.users where id = p_user;
  get diagnostics n = row_count;
  if n > 0 then insert into public.audit_events (kind, meta) values ('account_deleted', '{"replayed": true}'::jsonb); end if;
  return n > 0;
end $$;

revoke all on function public.audit_export(uuid), public.all_user_ids(), public.ledger_hashes(), public.redelete_learner(uuid) from public, anon, authenticated;
grant execute on function public.audit_export(uuid), public.all_user_ids(), public.ledger_hashes(), public.redelete_learner(uuid) to service_role;
