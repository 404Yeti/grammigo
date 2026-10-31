-- Transactional invitation reserve / redeem / revoke. Each locks the invitation row (FOR UPDATE), so concurrent use, expiry,
-- abandoned verification and revocation are serialised. Server only (service role). The plaintext code never reaches the
-- database: callers pass the HMAC.

create function public.reserve_invitation(p_code_hash bytea, p_hold interval default interval '30 minutes')
returns table (grant_id uuid, error text)
language plpgsql set search_path = public, pg_temp as $$
declare inv public.invitations%rowtype; g uuid;
begin
  select * into inv from public.invitations i where i.code_hash = p_code_hash for update;
  if not found then return query select null::uuid, 'invalid'::text; return; end if;           -- a wrong code
  -- give back the seats of reservations that were never redeemed within their hold
  with gone as (update public.invitation_reservations r set status = 'released'
                 where r.invitation_id = inv.id and r.status = 'reserved' and r.expires_at <= now() returning 1)
  update public.invitations i set reserved_count = i.reserved_count - (select count(*) from gone)::int where i.id = inv.id;
  select * into inv from public.invitations i where i.id = inv.id;
  if inv.revoked_at is not null          then return query select null::uuid, 'revoked'::text; return; end if;
  if inv.expires_at <= now()             then return query select null::uuid, 'expired'::text; return; end if;
  if inv.reserved_count >= inv.max_uses  then return query select null::uuid, 'full'::text;    return; end if;
  insert into public.invitation_reservations (invitation_id, status, expires_at)
    values (inv.id, 'reserved', now() + p_hold) returning invitation_reservations.grant_id into g;
  update public.invitations i set reserved_count = i.reserved_count + 1 where i.id = inv.id;
  insert into public.audit_events (kind, meta) values ('invite_reserved', jsonb_build_object('invitation', inv.id));
  return query select g, null::text;
end $$;

-- Creates the profile and consent records in the SAME transaction as the redemption: all of it happens or none of it.
create function public.redeem_invitation(p_grant uuid, p_user uuid, p_display_name text, p_adult_confirmed_at timestamptz, p_notice_version text)
returns text
language plpgsql set search_path = public, pg_temp as $$
declare r public.invitation_reservations%rowtype; inv public.invitations%rowtype; inv_id uuid;
begin
  select invitation_id into inv_id from public.invitation_reservations where grant_id = p_grant;
  if inv_id is null then return 'invalid'; end if;
  select * into inv from public.invitations where id = inv_id for update;                      -- same lock order as reserve/revoke
  select * into r from public.invitation_reservations where grant_id = p_grant for update;
  if r.status = 'redeemed' and r.user_id = p_user then return 'ok'; end if;                    -- idempotent retry of the same sign-in
  if r.status <> 'reserved'        then return 'invalid';  end if;                             -- released, revoked, or used by someone else
  if r.expires_at <= now()         then return 'expired';  end if;
  if inv.revoked_at is not null    then return 'revoked';  end if;                             -- revoked while the learner was mid sign-in
  if exists (select 1 from public.profiles where id = p_user) then return 'already_registered'; end if;
  update public.invitation_reservations set status = 'redeemed', user_id = p_user, redeemed_at = now() where grant_id = p_grant;
  update public.invitations set redeemed_count = redeemed_count + 1 where id = inv.id;
  insert into public.profiles (id, display_name, adult_confirmed_at, joined_via_invitation) values (p_user, p_display_name, p_adult_confirmed_at, inv.id);
  insert into public.consents (user_id, kind, version) values (p_user, 'adult_confirmation', p_notice_version), (p_user, 'privacy_notice', p_notice_version);
  insert into public.audit_events (actor, kind, meta) values (p_user, 'invite_redeemed', jsonb_build_object('invitation', inv.id));
  return 'ok';
end $$;

-- Revoking stops every pending reservation as well; accounts that already redeemed keep working.
create function public.revoke_invitation(p_id uuid, p_actor uuid)
returns void language plpgsql set search_path = public, pg_temp as $$
begin
  perform 1 from public.invitations where id = p_id for update;
  if not found then return; end if;
  update public.invitations set revoked_at = coalesce(revoked_at, now()) where id = p_id;
  with gone as (update public.invitation_reservations set status = 'revoked' where invitation_id = p_id and status = 'reserved' returning 1)
  update public.invitations i set reserved_count = i.reserved_count - (select count(*) from gone)::int where i.id = p_id;
  insert into public.audit_events (actor, kind, meta) values (p_actor, 'invite_revoked', jsonb_build_object('invitation', p_id));
end $$;

revoke all on function public.reserve_invitation(bytea, interval), public.redeem_invitation(uuid, uuid, text, timestamptz, text),
                       public.revoke_invitation(uuid, uuid) from public, anon, authenticated;
grant execute on function public.reserve_invitation(bytea, interval), public.redeem_invitation(uuid, uuid, text, timestamptz, text),
                          public.revoke_invitation(uuid, uuid) to service_role;
