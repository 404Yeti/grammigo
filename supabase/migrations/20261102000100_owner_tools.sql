-- Phase 4: owner invitation management needs one more audited action, "expire now".
-- Server only (service role). Nothing is granted to anon or authenticated.

-- The audit log restricts its kinds. Replace the check with the same list plus 'invite_expired' (no data is changed).
alter table public.audit_events drop constraint audit_events_kind_check;
alter table public.audit_events add constraint audit_events_kind_check
  check (kind in ('invite_created', 'invite_revoked', 'invite_reserved', 'invite_redeemed', 'invite_expired', 'export_requested',
                  'account_deleted', 'sync_conflict', 'import_completed', 'identity_cleaned', 'document_restored'));

-- Ends an invitation's validity NOW: nobody new can start a sign-in with it. People who already hold a reservation (mid sign-in) can finish,
-- and accounts that already joined are untouched. (Revoking is the hard stop: it also cancels pending reservations.)
-- Same lock order as the other invitation functions: the invitation row first. Idempotent; a revoked or already-expired invitation is unchanged.
create function public.expire_invitation(p_id uuid, p_actor uuid) returns void
language plpgsql set search_path = public, pg_temp as $$
declare changed int;
begin
  perform 1 from public.invitations where id = p_id for update;
  if not found then return; end if;
  update public.invitations set expires_at = now() where id = p_id and revoked_at is null and expires_at > now();
  get diagnostics changed = row_count;
  if changed > 0 then
    insert into public.audit_events (actor, kind, meta) values (p_actor, 'invite_expired', jsonb_build_object('invitation', p_id));
  end if;
end $$;

revoke all on function public.expire_invitation(uuid, uuid) from public, anon, authenticated;
grant execute on function public.expire_invitation(uuid, uuid) to service_role;
