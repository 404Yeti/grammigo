#!/usr/bin/env bash
# Applies ONLY migrations 3 to 9 to the Grammigo production database, one file per transaction, each with its own state guard.
#
#   ./apply-production-migrations.sh check     read-only: verifies the checkout, the connection and the database state, writes nothing
#   ./apply-production-migrations.sh apply     asks you to type the project reference, then applies 3..9 in order, stopping at the first problem
#   ./apply-production-migrations.sh check9    read-only: the state expected AFTER migrations 1-8 (for finishing migration 9 only)
#   ./apply-production-migrations.sh check10   read-only: the state expected AFTER migration 9 (before migration 10); needs GM_EXPECT_COMMIT
#   ./apply-production-migrations.sh apply10   applies ONLY migration 10 (email_password); same one-transaction, re-read-before-every-attempt safety
#   ./apply-production-migrations.sh apply9    applies ONLY migration 9 (guard + file + history row in one transaction); safe to run again after a dropped
#                                              connection: it re-reads the state before every attempt and never applies twice
#
# Never uses the Supabase CLI, `db push` or `migration repair`; never touches migrations 1 and 2; never prints or stores the password.
# For each migration ONE transaction (psql --single-transaction) runs: [1] the guard, [2] the migration file, [3] its history row.
# If the guard or the file fails, nothing is kept (including the history row). The guard sits INSIDE the same transaction as the write.
set -euo pipefail
umask 077

REF="ugifdvaaaioiqmwfiksw"
EXPECT_COMMIT="${GM_EXPECT_COMMIT:-025173d10e983ddd610bb447e31c6fa75ec59725}"   # modes 3-9: the commit with nine migration files; modes 10: you pass the commit I give you
# Already applied by the connector under ITS version numbers (left exactly as they are):
EXISTING=("20261101102513 core_schema" "20261101102527 invitations")
# To apply, in order:
PENDING=(
  "20261101000300 learner_documents"
  "20261101000400 deletion_and_cleanup"
  "20261101000500 auth_support"
  "20261102000100 owner_tools"
  "20261103000100 sync_consent"
  "20261104000100 lifecycle"
  "20261105000100 revoke_platform_helper"
)
ALL_FILES_9="20261101000100_core_schema.sql 20261101000200_invitations.sql 20261101000300_learner_documents.sql 20261101000400_deletion_and_cleanup.sql 20261101000500_auth_support.sql 20261102000100_owner_tools.sql 20261103000100_sync_consent.sql 20261104000100_lifecycle.sql 20261105000100_revoke_platform_helper.sql"
ALL_FILES_10="$ALL_FILES_9 20261106000100_email_password.sql"
ALL_FILES="$ALL_FILES_9"
BASE_TABLES="app_admins,audit_events,consents,deletion_ledger,invitation_reservations,invitations,profiles"
TEN_TABLES="app_admins,audit_events,consents,deletion_ledger,invitation_reservations,invitations,learner_document_versions,learner_documents,profiles,rate_limits"

die() { printf '\nSTOP: %s\nNothing further was run.\n' "$1" >&2; exit 1; }
MODE="${1:-}"
[[ "$MODE" == "check" || "$MODE" == "apply" || "$MODE" == "check9" || "$MODE" == "apply9" || "$MODE" == "check10" || "$MODE" == "apply10" ]] || die "usage: $0 check|apply|check9|apply9|check10|apply10"

# ---------------------------------------------------------------- 1. the checkout
cd "$(dirname "${BASH_SOURCE[0]}")"
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || die "not inside a git checkout"
if [[ "$MODE" == "check10" || "$MODE" == "apply10" ]]; then
  [[ "${GM_EXPECT_COMMIT:-}" =~ ^[0-9a-f]{40}$ ]] || die "set GM_EXPECT_COMMIT to the full 40-character commit I gave you for migration 10"
  ALL_FILES="$ALL_FILES_10"
fi
[[ "$(git rev-parse HEAD)" == "$EXPECT_COMMIT" ]] || die "HEAD is $(git rev-parse --short HEAD), expected ${EXPECT_COMMIT:0:7}"
[[ -z "$(git status --porcelain --untracked-files=no)" ]] || die "tracked files are modified"
[[ "$(ls supabase/migrations | tr '\n' ' ')" == "$ALL_FILES " ]] || die "supabase/migrations must contain exactly the approved files ($ALL_FILES)"
! grep -qEi '^\s*(begin|commit|rollback)\s*;' supabase/migrations/*.sql || die "a migration contains its own transaction statement"
command -v psql >/dev/null || die "psql is not installed (sudo apt install postgresql-client)"
echo "checkout OK: ${EXPECT_COMMIT:0:7}, clean, $(ls supabase/migrations | wc -l) migration files, no embedded transactions; $(psql --version)"

# ---------------------------------------------------------------- 2. the connection (this process only)
[[ -n "${PGHOST:-}" ]] || die "PGHOST is not set (copy it from Dashboard > Connect > Session pooler)"
[[ "$PGHOST" == *.pooler.supabase.com || "$PGHOST" == "db.${REF}.supabase.co" ]] || die "PGHOST must be the Supabase pooler host or db.${REF}.supabase.co"
if [[ "$PGHOST" == *.pooler.supabase.com ]]; then
  [[ "${PGUSER:-}" == "postgres.${REF}" ]] || die "PGUSER must be exactly postgres.${REF}"
else
  [[ "${PGUSER:-}" == "postgres" ]] || die "PGUSER must be postgres for the direct host"
fi
export PGPORT="${PGPORT:-5432}" PGDATABASE=postgres PGSSLMODE=require PGCONNECT_TIMEOUT=15 PSQLRC=/dev/null
unset PGSERVICE PGSERVICEFILE PGOPTIONS PGPASSFILE
[[ "$PGPORT" == "5432" ]] || die "use port 5432 (session mode), not the transaction pooler"
if [[ -z "${PGPASSWORD:-}" ]]; then
  read -rs -p "Database password (hidden; not stored): " PGPASSWORD; echo
  export PGPASSWORD
fi
trap 'unset PGPASSWORD' EXIT
PSQL=(psql -X -q -v ON_ERROR_STOP=1 -At)

# ---------------------------------------------------------------- 3. the guard (plain SQL text, generated from the lists above)
sorted_history() { # $@ = "version name" entries -> "v1 n1,v2 n2" sorted by version
  printf '%s\n' "$@" | LC_ALL=C sort | paste -sd, -
}
guard_sql() { # $1 = expected history string, $2 = "base" to also require the exact base table list
  local tables_check=""
  if [[ "$2" == "ten10" ]]; then
    tables_check="select coalesce(string_agg(tablename, ',' order by tablename), '') into t from pg_tables where schemaname = 'public';
      if t <> '${TEN_TABLES}' then raise exception 'GUARD: public tables are [%], expected [${TEN_TABLES}]', t; end if;
      if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'invitation_reservations' and column_name in ('email_hash', 'adult_confirmed_at')) then raise exception 'GUARD: migration 10 columns already exist'; end if;
      if exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname in ('reserve_invitation_for_email', 'redeem_reservation_for_email', 'email_identity_state')) then raise exception 'GUARD: migration 10 functions already exist'; end if;"
  elif [[ "$2" == "ten" ]]; then
    tables_check="select coalesce(string_agg(tablename, ',' order by tablename), '') into t from pg_tables where schemaname = 'public';
      if t <> '${TEN_TABLES}' then raise exception 'GUARD: public tables are [%], expected [${TEN_TABLES}]', t; end if;"
  elif [[ "$2" == "base" ]]; then
    tables_check="select coalesce(string_agg(tablename, ',' order by tablename), '') into t from pg_tables where schemaname = 'public';
      if t <> '${BASE_TABLES}' then raise exception 'GUARD: public tables are [%], expected [${BASE_TABLES}]', t; end if;"
  else
    tables_check="select count(*) into n from pg_tables where schemaname = 'public' and tablename in ('$(echo "$BASE_TABLES" | sed "s/,/','/g")');
      if n <> 7 then raise exception 'GUARD: the seven base tables are not all present'; end if;"
  fi
  cat <<SQL
select pg_advisory_xact_lock(hashtext('grammigo-production-migrations'));
do \$guard\$
declare h text; t text; n bigint;
begin
  if current_database() <> 'postgres' then raise exception 'GUARD: wrong database %', current_database(); end if;
  select coalesce(string_agg(version || ' ' || name, ',' order by version), '') into h from supabase_migrations.schema_migrations;
  if h <> '$1' then raise exception 'GUARD: migration history is [%], expected [$1]', h; end if;
  select count(*) into n from auth.users;
  if n <> 0 then raise exception 'GUARD: auth.users has % rows, expected 0', n; end if;
  ${tables_check}
end
\$guard\$;
SQL
}

# ---------------------------------------------------------------- 3b. one migration only (9: finishing; 10: email + password)
if [[ "$MODE" == "check9" || "$MODE" == "apply9" || "$MODE" == "check10" || "$MODE" == "apply10" ]]; then
  if [[ "$MODE" == *10 ]]; then
    ONE="20261106000100 email_password"; STAGE="ten10"; NUM=10
    before=("${EXISTING[@]}" "${PENDING[@]}")
  else
    ONE="${PENDING[6]}"; STAGE="ten"; NUM=9
    before=("${EXISTING[@]}" "${PENDING[@]:0:6}")
  fi
  V1="${ONE%% *}"; N1="${ONE#* }"; after=("${before[@]}" "$ONE")
  exp_before="$(sorted_history "${before[@]}")"; exp_after="$(sorted_history "${after[@]}")"
  state() { "${PSQL[@]}" -c "select coalesce(string_agg(version || ' ' || name, ',' order by version), '') from supabase_migrations.schema_migrations"; }
  look() {
    "${PSQL[@]}" -c "select 'user=' || current_user || ' database=' || current_database()" \
      -c "select 'history: ' || coalesce(string_agg(version || ' ' || name, ', ' order by version), '(empty)') from supabase_migrations.schema_migrations" \
      -c "select 'auth.users: ' || count(*) from auth.users" \
      -c "select 'public tables: ' || count(*) from pg_tables where schemaname = 'public'" \
      -c "select 'rls_auto_enable executable by anon/authenticated/public: ' || coalesce(has_function_privilege('anon', to_regprocedure('public.rls_auto_enable()'), 'execute')::text, '(function absent)') || '/' || coalesce(has_function_privilege('authenticated', to_regprocedure('public.rls_auto_enable()'), 'execute')::text, '-') || '/' || coalesce(has_function_privilege('public', to_regprocedure('public.rls_auto_enable()'), 'execute')::text, '-')"
    if [[ "$NUM" == 10 ]]; then
      "${PSQL[@]}" -c "select 'migration 10 columns present: ' || count(*) || ' of 2' from information_schema.columns where table_schema = 'public' and table_name = 'invitation_reservations' and column_name in ('email_hash', 'adult_confirmed_at')" \
        -c "select 'migration 10 functions: ' || coalesce(string_agg(p.proname || ' anon=' || has_function_privilege('anon', p.oid, 'execute') || ' auth=' || has_function_privilege('authenticated', p.oid, 'execute') || ' service=' || has_function_privilege('service_role', p.oid, 'execute'), '; ' order by p.proname), '(none)') from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('reserve_invitation_for_email', 'redeem_reservation_for_email', 'email_identity_state')"
    fi
  }
  echo "--- connecting (read-only look) ..."
  look || die "could not read the database"
  cur="$(state)" || die "could not read the migration history"
  if [[ "$cur" == "$exp_after" ]]; then echo "Migration $NUM is ALREADY recorded. Nothing to do."; exit 0; fi
  [[ "$cur" == "$exp_before" ]] || die "the history is [$cur]; expected exactly [$exp_before]"
  "${PSQL[@]}" -c "begin read only" -c "$(guard_sql "$exp_before" "$STAGE")" -c "rollback" >/dev/null || die "the state guard for migration $NUM does not hold"
  echo "state guard for migration $NUM holds: expected history exactly, 0 users, exactly the ten expected tables$([[ "$NUM" == 10 ]] && echo ", and none of migration 10's objects yet")."
  [[ "$MODE" == check* ]] && { echo "CHECK finished. Nothing was written."; exit 0; }
  echo; echo "About to apply ONLY: $V1 $N1   sha256 $(sha256sum "supabase/migrations/${V1}_${N1}.sql" | cut -c1-16)…"
  read -r -p "Type the project reference to continue (${REF}): " typed
  [[ "$typed" == "$REF" ]] || die "reference not typed correctly"
  for attempt in 1 2 3; do
    # Re-read the state first on EVERY attempt: if an earlier attempt committed but the connection dropped before we heard, we stop here, not apply twice.
    if ! cur="$(state 2>/dev/null)"; then echo "attempt $attempt: could not reach the database; waiting before trying again"; sleep 5; continue; fi
    if [[ "$cur" == "$exp_after" ]]; then echo "Migration $NUM is recorded. Done."; break; fi
    [[ "$cur" == "$exp_before" ]] || die "the history is [$cur]; expected exactly [$exp_before]; nothing was applied by this attempt"
    echo "--- attempt $attempt: migration $V1 $N1"
    if "${PSQL[@]}" --single-transaction \
         -c "set local lock_timeout = '10s'; set local statement_timeout = '60s'; $(guard_sql "$exp_before" "$STAGE")" \
         -f "supabase/migrations/${V1}_${N1}.sql" \
         -c "insert into supabase_migrations.schema_migrations (version, name) values ('${V1}', '${N1}')"; then
      echo "    applied and recorded."
    else
      echo "    attempt $attempt did not complete (a connection drop before COMMIT rolls everything back). Re-reading the state before any retry."; sleep 5
    fi
  done
  cur="$(state)" || die "could not read the history to confirm; run  $0 check${NUM}  to see the state"
  [[ "$cur" == "$exp_after" ]] || die "migration $NUM is NOT recorded after 3 attempts; nothing partial was kept. Run  $0 check${NUM}  and send me the output"
  echo; echo "--- final state (read-only)"; look
  echo "DONE. Tell Claude: migration $NUM is in. Accounts stay disabled."
  exit 0
fi

# ---------------------------------------------------------------- 4. read-only look at the current state
hist_now="$(sorted_history "${EXISTING[@]}")"
echo "--- connecting (read-only look) ..."
"${PSQL[@]}" -c "select 'user=' || current_user || ' database=' || current_database()" \
  -c "select 'history: ' || coalesce(string_agg(version || ' ' || name, ', ' order by version), '(empty)') from supabase_migrations.schema_migrations" \
  -c "select 'auth.users: ' || count(*) from auth.users" \
  -c "select 'public tables: ' || coalesce(string_agg(tablename, ',' order by tablename), '(none)') from pg_tables where schemaname = 'public'" || die "could not read the database"
# the guard itself, run read-only (this is the same text that guards migration 3)
"${PSQL[@]}" -c "begin read only" -c "$(guard_sql "$hist_now" base)" -c "rollback" >/dev/null || die "the state guard for migration 3 does not hold: the database is not in the expected state"
echo "state guard for migration 3 holds: history = migrations 1 and 2 only, 0 users, exactly the seven base tables."
[[ "$MODE" == "check" ]] && { echo "CHECK finished. Nothing was written."; exit 0; }

# ---------------------------------------------------------------- 5. apply
echo
echo "About to apply, each in its own transaction, in this order:"
for m in "${PENDING[@]}"; do echo "  ${m%% *}  ${m#* }   sha256 $(sha256sum "supabase/migrations/${m%% *}_${m#* }.sql" | cut -c1-16)…"; done
read -r -p "Type the project reference to continue (${REF}): " typed
[[ "$typed" == "$REF" ]] || die "reference not typed correctly"

applied=("${EXISTING[@]}")
first=1
for m in "${PENDING[@]}"; do
  v="${m%% *}"; n="${m#* }"
  expected="$(sorted_history "${applied[@]}")"
  stage="other"; [[ $first == 1 ]] && stage="base"
  echo "--- migration $v $n"
  "${PSQL[@]}" --single-transaction \
    -c "$(guard_sql "$expected" "$stage")" \
    -f "supabase/migrations/${v}_${n}.sql" \
    -c "insert into supabase_migrations.schema_migrations (version, name) values ('${v}', '${n}')" \
    || die "migration $v $n failed or its guard did not hold; the transaction was rolled back and nothing from it was kept"
  applied+=("$m"); first=0
  echo "    applied and recorded."
done

echo
echo "--- final state (read-only)"
"${PSQL[@]}" -c "select 'history: ' || string_agg(version || ' ' || name, ', ' order by version) from supabase_migrations.schema_migrations" \
  -c "select 'public tables: ' || count(*) from pg_tables where schemaname = 'public'" \
  -c "select 'auth.users: ' || count(*) from auth.users"
echo "DONE. Tell Claude: the migrations are in. Accounts stay disabled."
