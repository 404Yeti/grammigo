-- Email + password sign-in, invitation-only. SERVER ONLY (service role); nothing here is granted to anon or authenticated.
--
-- Invitation redemption must not depend on a cookie (a confirmation email is often opened on another device), so an email registration RESERVES a seat
-- bound to a keyed hash of the address, with the 18+ confirmation recorded on the reservation. The seat is redeemed, by the same redeem_invitation as
-- Google sign-in, the first time that address signs in with its password AFTER the mailbox has been confirmed. Nothing grants access except the profile
-- row that redemption creates (is_active_learner), so an account made directly through the Auth API has no access.

alter table public.invitation_reservations
  add column email_hash bytea check (email_hash is null or octet_length(email_hash) = 32),
  add column adult_confirmed_at timestamptz;
create index invitation_reservations_email_open on public.invitation_reservations (email_hash) where status = 'reserved' and email_hash is not null;

-- Reserve a seat for ONE email address. An address holds at most one open reservation: an older one is given back first.
create function public.reserve_invitation_for_email(p_code_hash bytea, p_email_hash bytea, p_adult_at timestamptz, p_hold interval default interval '24 hours')
returns table (grant_id uuid, error text)
language plpgsql set search_path = public, pg_temp as $$
declare r record; old uuid;
begin
  if p_email_hash is null or octet_length(p_email_hash) <> 32 or p_adult_at is null then raise exception 'invalid arguments'; end if;
  select * into r from public.reserve_invitation(p_code_hash, p_hold);
  if r.grant_id is null then return query select null::uuid, r.error; return; end if;
  for old in select x.grant_id from public.invitation_reservations x where x.email_hash = p_email_hash and x.status = 'reserved' and x.grant_id <> r.grant_id loop
    perform public.release_reservation(old);
  end loop;
  update public.invitation_reservations x set email_hash = p_email_hash, adult_confirmed_at = p_adult_at where x.grant_id = r.grant_id;
  return query select r.grant_id, null::text;
end $$;

-- First password sign-in of a confirmed address that has no profile yet: use the open reservation made for exactly that address, if any.
create function public.redeem_reservation_for_email(p_user uuid, p_email_hash bytea, p_display_name text, p_notice_version text)
returns text
language plpgsql set search_path = public, pg_temp as $$
declare g uuid; a timestamptz;
begin
  select x.grant_id, x.adult_confirmed_at into g, a from public.invitation_reservations x
   where x.email_hash = p_email_hash and x.status = 'reserved' and x.expires_at > now() and x.adult_confirmed_at is not null
   order by x.created_at desc limit 1;
  if g is null then return 'invalid'; end if;
  return public.redeem_invitation(g, p_user, p_display_name, a, p_notice_version);
end $$;

-- What does the Auth system know about this address? One row at most. Used to refuse an address that already belongs to someone (so two sign-in methods
-- are never silently joined), to clear a profile-less squatter, and to decide whether a reset email may be sent.
create function public.email_identity_state(p_email text)
returns table (user_id uuid, providers text[], confirmed boolean, has_profile boolean)
language sql stable security definer set search_path = public, auth, pg_temp as $$
  select u.id,
         coalesce(array(select i.provider from auth.identities i where i.user_id = u.id order by 1), '{}'::text[]),
         u.email_confirmed_at is not null,
         exists (select 1 from public.profiles p where p.id = u.id)
    from auth.users u where lower(u.email) = lower(p_email) limit 1;
$$;

revoke all on function public.reserve_invitation_for_email(bytea, bytea, timestamptz, interval), public.redeem_reservation_for_email(uuid, bytea, text, text),
  public.email_identity_state(text) from public, anon, authenticated;
grant execute on function public.reserve_invitation_for_email(bytea, bytea, timestamptz, interval), public.redeem_reservation_for_email(uuid, bytea, text, text),
  public.email_identity_state(text) to service_role;
