-- Grammigo v0.4 core schema. Local Supabase only until production provisioning is separately approved.
-- Region at provisioning: ap-southeast-1 (Singapore). Every table has row-level security enabled.
--
-- PRIVILEGE MODEL (read this first)
--   * Supabase grants ALL on new public objects to anon/authenticated/service_role by default. We REVOKE that for
--     anon and authenticated, and grant back only what is listed below. Any new object starts with no client access.
--   * Learners (role `authenticated`) can only: read their own profile/consents/documents, and update four profile columns.
--   * Everything else (invitations, reservations, versions, audit, ledger, admins, all writes to documents) is
--     reachable only by the server using the service role.

alter default privileges in schema public revoke all on tables    from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon, authenticated;
-- PostgreSQL grants EXECUTE to PUBLIC on every new function by default, and that default cannot be removed per schema, only globally
-- for the role that creates the objects (the migration role). Without this, any new function is callable by anon.
alter default privileges revoke execute on functions from public;

-- ---------------------------------------------------------------- owner / admin
create table public.app_admins (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.app_admins enable row level security;

-- ---------------------------------------------------------------- invitations
-- The plaintext code is shown to the owner once. Only an HMAC (server-side pepper) is stored.
create table public.invitations (
  id             uuid primary key default gen_random_uuid(),
  label          text not null check (char_length(label) between 1 and 60),
  code_hash      bytea not null unique check (octet_length(code_hash) = 32),
  code_hint      text not null check (char_length(code_hint) = 4),
  created_by     uuid references auth.users (id) on delete set null,
  max_uses       int  not null check (max_uses between 1 and 100),
  reserved_count int  not null default 0,
  redeemed_count int  not null default 0,
  expires_at     timestamptz not null,
  revoked_at     timestamptz,
  created_at     timestamptz not null default now(),
  constraint invitation_counts_consistent check (redeemed_count >= 0 and redeemed_count <= reserved_count and reserved_count <= max_uses)
);
alter table public.invitations enable row level security;

-- A reservation ("grant") is created when the server validates a code, BEFORE Google sign-in, so it is not keyed by email.
create table public.invitation_reservations (
  grant_id      uuid primary key default gen_random_uuid(),
  invitation_id uuid not null references public.invitations (id) on delete cascade,
  status        text not null check (status in ('reserved', 'redeemed', 'released', 'revoked')),
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null,
  user_id       uuid references auth.users (id) on delete set null,
  redeemed_at   timestamptz
);
alter table public.invitation_reservations enable row level security;
create index invitation_reservations_status_expiry on public.invitation_reservations (status, expires_at);
create index invitation_reservations_invitation on public.invitation_reservations (invitation_id);
create unique index invitation_reservations_one_redeemed_per_user on public.invitation_reservations (user_id) where status = 'redeemed';

-- ---------------------------------------------------------------- profile
create table public.profiles (
  id                    uuid primary key references auth.users (id) on delete cascade,
  display_name          text not null check (char_length(display_name) between 1 and 40),
  first_language        text check (char_length(first_language) <= 40),
  time_zone             text check (char_length(time_zone) <= 64),
  preferences           jsonb not null default '{}'::jsonb check (jsonb_typeof(preferences) = 'object' and octet_length(preferences::text) < 4000),
  status                text not null default 'active' check (status in ('active', 'suspended')),
  adult_confirmed_at    timestamptz not null,
  joined_via_invitation uuid references public.invitations (id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
alter table public.profiles enable row level security;

create function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
create trigger profiles_touch before update on public.profiles for each row execute function public.touch_updated_at();

-- THE learner gate. A Google sign-in alone creates an auth.users row (an "intermediate identity") with NO profile row, so
-- this is false for it and every learner policy denies it. Nothing private is reachable until an invitation is redeemed.
create function public.is_active_learner() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.status = 'active');
$$;

create function public.is_admin() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.app_admins a where a.user_id = (select auth.uid()));
$$;

create policy profiles_select_own on public.profiles for select to authenticated
  using (id = (select auth.uid()) and status = 'active');
create policy profiles_update_own on public.profiles for update to authenticated
  using (id = (select auth.uid()) and status = 'active') with check (id = (select auth.uid()) and status = 'active');

-- ---------------------------------------------------------------- consent record
create table public.consents (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  kind        text not null check (kind in ('adult_confirmation', 'cloud_storage', 'privacy_notice')),
  version     text not null check (char_length(version) <= 32),
  accepted_at timestamptz not null default now()
);
alter table public.consents enable row level security;
create index consents_user on public.consents (user_id);
create policy consents_select_own on public.consents for select to authenticated
  using (user_id = (select auth.uid()) and public.is_active_learner());

-- ---------------------------------------------------------------- audit (no personal data, no learner content)
create table public.audit_events (
  id    bigint generated always as identity primary key,
  at    timestamptz not null default now(),
  actor uuid references auth.users (id) on delete set null,
  kind  text not null check (kind in ('invite_created', 'invite_revoked', 'invite_reserved', 'invite_redeemed', 'export_requested',
                                      'account_deleted', 'sync_conflict', 'import_completed', 'identity_cleaned', 'document_restored')),
  meta  jsonb not null default '{}'::jsonb check (octet_length(meta::text) < 2000)
);
alter table public.audit_events enable row level security;
create function public.audit_events_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' then
    -- the ONLY permitted change: the actor link being cleared when that account is deleted (ON DELETE SET NULL)
    if (new.id, new.at, new.kind, new.meta) is distinct from (old.id, old.at, old.kind, old.meta) or new.actor is not null
      then raise exception 'audit_events are append-only'; end if;
    return new;
  end if;
  if tg_op = 'DELETE' and old.at > now() - interval '90 days' then raise exception 'audit_events are kept for 90 days'; end if;
  return old;
end $$;
create trigger audit_events_guard_trg before update or delete on public.audit_events for each row execute function public.audit_events_guard();

-- ---------------------------------------------------------------- deletion ledger (restore safety)
-- A hashed user id, no personal data. If a backup is ever restored, every id here is deleted again. Immutable; pruned after 35 days.
create table public.deletion_ledger (
  user_hash  bytea primary key check (octet_length(user_hash) = 32),
  deleted_at timestamptz not null default now()
);
alter table public.deletion_ledger enable row level security;
create function public.deletion_ledger_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' then raise exception 'deletion_ledger rows are immutable'; end if;
  if tg_op = 'DELETE' and old.deleted_at > now() - interval '35 days' then raise exception 'deletion_ledger rows are kept for 35 days'; end if;
  return old;
end $$;
create trigger deletion_ledger_guard_trg before update or delete on public.deletion_ledger for each row execute function public.deletion_ledger_guard();

-- ---------------------------------------------------------------- explicit privileges
revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from anon, authenticated, public;

-- learners
grant select on public.profiles, public.consents to authenticated;
grant update (display_name, first_language, time_zone, preferences) on public.profiles to authenticated;
grant execute on function public.is_active_learner(), public.is_admin() to authenticated;

-- server (service role)
grant all on all tables in schema public to service_role;
