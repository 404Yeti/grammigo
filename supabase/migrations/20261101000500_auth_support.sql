-- Phase 3 support: rate limiting, explicit release of reservations, safe purge of profile-less identities, and audited invitation creation.
-- Everything here is SERVER ONLY (service role). Nothing is granted to anon or authenticated.

-- ---------------------------------------------------------------- rate limiting (durable, shared by every serverless instance)
-- The key is an HMAC of (namespace, client address): no raw address is ever stored. Fixed window, one atomic upsert per hit, so
-- concurrent requests cannot both slip under the limit.
create table public.rate_limits (
  key          bytea primary key check (octet_length(key) = 32),
  window_start timestamptz not null default now(),
  hits         int not null default 0
);
alter table public.rate_limits enable row level security;
revoke all on public.rate_limits from anon, authenticated;
grant all on public.rate_limits to service_role;

create function public.rate_limit_hit(p_key bytea, p_limit int, p_window interval)
returns table (allowed boolean, retry_after int)
language plpgsql set search_path = public, pg_temp as $$
declare h int; ws timestamptz;
begin
  if p_limit < 1 or p_window <= interval '0' then raise exception 'invalid rate limit'; end if;
  insert into public.rate_limits as r (key, window_start, hits) values (p_key, now(), 1)
  on conflict (key) do update set
    window_start = case when r.window_start <= now() - p_window then now() else r.window_start end,
    hits         = case when r.window_start <= now() - p_window then 1 else r.hits + 1 end
  returning r.hits, r.window_start into h, ws;
  return query select h <= p_limit, greatest(1, ceil(extract(epoch from (ws + p_window - now())))::int);
end $$;

-- Windows are at most a day, so anything older than two days is dead weight.
create function public.prune_rate_limits() returns int
language plpgsql set search_path = public, pg_temp as $$
declare n int;
begin
  delete from public.rate_limits where window_start < now() - interval '2 days';
  get diagnostics n = row_count;
  return n;
end $$;

-- ---------------------------------------------------------------- reservations
-- Same lock order as reserve / redeem / revoke: the invitation row first, then its reservations.
create function public.release_reservation(p_grant uuid) returns void
language plpgsql set search_path = public, pg_temp as $$
declare inv_id uuid; n int;
begin
  select invitation_id into inv_id from public.invitation_reservations where grant_id = p_grant;
  if inv_id is null then return; end if;
  perform 1 from public.invitations where id = inv_id for update;
  update public.invitation_reservations set status = 'released' where grant_id = p_grant and status = 'reserved';
  get diagnostics n = row_count;
  if n > 0 then update public.invitations set reserved_count = reserved_count - n where id = inv_id; end if;
end $$;

-- Gives back every seat whose hold ran out without a sign-in. Safe to run at any time and as often as wanted (idempotent).
create function public.release_expired_reservations() returns int
language plpgsql set search_path = public, pg_temp as $$
declare inv_id uuid; n int; total int := 0;
begin
  for inv_id in select distinct invitation_id from public.invitation_reservations where status = 'reserved' and expires_at <= now() loop
    perform 1 from public.invitations where id = inv_id for update;
    update public.invitation_reservations set status = 'released'
     where invitation_id = inv_id and status = 'reserved' and expires_at <= now();
    get diagnostics n = row_count;
    if n > 0 then
      update public.invitations set reserved_count = reserved_count - n where id = inv_id;
      total := total + n;
    end if;
  end loop;
  return total;
end $$;

-- ---------------------------------------------------------------- identities that never got a profile
-- Deletes ONE auth user only if it has no profile and is not an admin, in one statement, so a learner who gained a profile a moment
-- ago can never be deleted by a slow or repeated cleanup. SECURITY DEFINER because it removes a row in the auth schema.
create function public.purge_orphan_identity(p_user uuid) returns boolean
language plpgsql security definer set search_path = public, auth, pg_temp as $$
declare n int;
begin
  delete from auth.users u where u.id = p_user
     and not exists (select 1 from public.profiles p where p.id = u.id)
     and not exists (select 1 from public.app_admins a where a.user_id = u.id);
  get diagnostics n = row_count;
  if n > 0 then insert into public.audit_events (kind, meta) values ('identity_cleaned', jsonb_build_object('count', 1)); end if;
  return n > 0;
end $$;

-- The nightly sweep. The age floor gives a person who is mid sign-in time to finish; counts only are audited.
create function public.purge_orphan_identities(p_older interval default interval '1 hour') returns int
language plpgsql security definer set search_path = public, auth, pg_temp as $$
declare n int;
begin
  if p_older < interval '5 minutes' then raise exception 'p_older is too small'; end if;
  delete from auth.users u where u.created_at < now() - p_older
     and not exists (select 1 from public.profiles p where p.id = u.id)
     and not exists (select 1 from public.app_admins a where a.user_id = u.id);
  get diagnostics n = row_count;
  if n > 0 then insert into public.audit_events (kind, meta) values ('identity_cleaned', jsonb_build_object('count', n)); end if;
  return n;
end $$;

-- ---------------------------------------------------------------- invitation creation (audited, bounded)
create function public.create_invitation(p_label text, p_code_hash bytea, p_hint text, p_max_uses int, p_expires_at timestamptz, p_actor uuid)
returns uuid language plpgsql set search_path = public, pg_temp as $$
declare new_id uuid;
begin
  if p_expires_at <= now() or p_expires_at > now() + interval '90 days' then raise exception 'expiry must be within 90 days'; end if;
  insert into public.invitations (label, code_hash, code_hint, created_by, max_uses, expires_at)
    values (p_label, p_code_hash, p_hint, p_actor, p_max_uses, p_expires_at) returning id into new_id;
  insert into public.audit_events (actor, kind, meta) values (p_actor, 'invite_created', jsonb_build_object('invitation', new_id));
  return new_id;
end $$;

revoke all on function public.rate_limit_hit(bytea, int, interval), public.prune_rate_limits(), public.release_reservation(uuid),
  public.release_expired_reservations(), public.purge_orphan_identity(uuid), public.purge_orphan_identities(interval),
  public.create_invitation(text, bytea, text, int, timestamptz, uuid) from public, anon, authenticated;
grant execute on function public.rate_limit_hit(bytea, int, interval), public.prune_rate_limits(), public.release_reservation(uuid),
  public.release_expired_reservations(), public.purge_orphan_identity(uuid), public.purge_orphan_identities(interval),
  public.create_invitation(text, bytea, text, int, timestamptz, uuid) to service_role;
