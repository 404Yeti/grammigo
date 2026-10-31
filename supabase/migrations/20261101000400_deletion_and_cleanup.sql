-- Account deletion with a ledger, and cleanup of intermediate identities. Server only (service role).

-- Deleting the auth user cascades to profile, consents, documents and versions. Reservation and audit rows keep their counts but
-- lose the user link (ON DELETE SET NULL), so nothing identifies the person afterwards. The hashed id goes into the ledger in
-- the SAME transaction, so a later backup restore can be re-deleted. SECURITY DEFINER because it removes a row in the auth schema.
create function public.delete_learner(p_user uuid, p_user_hash bytea)
returns void language plpgsql security definer set search_path = public, auth, pg_temp as $$
begin
  insert into public.deletion_ledger (user_hash) values (p_user_hash) on conflict do nothing;
  insert into public.audit_events (kind, meta) values ('account_deleted', '{}'::jsonb);   -- no actor, no personal data
  delete from auth.users where id = p_user;
end $$;

-- Google sign-in creates an auth.users row for ANY Google account that completes OAuth. Those with no profile have no privileges;
-- this lists the stale ones so the server can delete them with the admin API (nightly, and after a refused callback).
create function public.orphan_identities(p_older interval default interval '1 hour')
returns table (user_id uuid) language sql stable security definer set search_path = public, auth, pg_temp as $$
  select u.id from auth.users u
   where u.created_at < now() - p_older
     and not exists (select 1 from public.profiles p where p.id = u.id)
     and not exists (select 1 from public.app_admins a where a.user_id = u.id);
$$;

revoke all on function public.delete_learner(uuid, bytea), public.orphan_identities(interval) from public, anon, authenticated;
grant execute on function public.delete_learner(uuid, bytea), public.orphan_identities(interval) to service_role;
