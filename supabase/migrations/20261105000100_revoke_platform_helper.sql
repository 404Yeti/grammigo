-- The hosted production project (checked read-only on 2026-11-01) was created with Supabase's automatic-RLS option, which installs a platform helper,
-- public.rls_auto_enable() (an event-trigger function). The security advisor flags it because anon and authenticated could execute it through
-- the REST endpoint. Nothing in Grammigo needs a client to run it, so clients lose execute. An event trigger fires without the executing role
-- having execute rights, so automatic RLS on new tables keeps working.
-- It does nothing where the function does not exist (the local stack and CI), so the same migration is safe everywhere. SERVER ONLY.
do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
  end if;
end $$;
