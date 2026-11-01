// Read-only production readiness checks. Every function here only READS: HTTP GETs of public endpoints with the public anon key, SELECT
// statements in a read-only transaction, and inspection of an environment object. None of them prints a secret: results contain check names,
// pass/fail and fixed words, and the report is passed through `redactor` as a last line of defence.

export const EXPECTED_TABLES = ["app_admins", "audit_events", "consents", "deletion_ledger", "invitation_reservations", "invitations", "learner_document_versions", "learner_documents", "profiles", "rate_limits"];
const LEARNER_SELECT = ["consents", "learner_documents", "profiles"];
const PROFILE_UPDATABLE = ["display_name", "first_language", "time_zone", "preferences"];
const LEARNER_FUNCTIONS = ["is_active_learner", "is_admin"];
const PRIVS = ["select", "insert", "update", "delete", "truncate", "references", "trigger"];
const CANONICAL_HOSTS = ["grammigo.si"];

const item = (id, ok, detail, level = ok ? "pass" : "fail") => ({ id, ok, level, detail });
/** An informational line that is neither a pass nor a failure (something the check cannot see read-only). */
const note = (id, detail) => ({ id, ok: true, level: "note", detail });

// ---------------------------------------------------------------- secrets never reach the output
const SECRET_NAME = /KEY|SECRET|PEPPER|TOKEN|PASSWORD|DB_URL/i;
export function redactor(env) {
  const values = Object.entries(env ?? {}).filter(([k, v]) => SECRET_NAME.test(k) && typeof v === "string" && v.length >= 8).map(([, v]) => v);
  return (text) => {
    let out = String(text);
    for (const v of values) out = out.split(v).join("***");
    return out.replace(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/g, "***").replace(/postgres(ql)?:\/\/[^\s"']+/gi, "postgres://***");
  };
}

// ---------------------------------------------------------------- environment (names and shape only)
export function checkEnvironment(env, { expectedRef } = {}) {
  const r = [];
  const has = (k) => typeof env[k] === "string" && env[k] !== "";
  const accounts = env.NEXT_PUBLIC_ACCOUNTS;
  r.push(note("NEXT_PUBLIC_ACCOUNTS", accounts === "on" ? "accounts ON" : accounts === undefined || accounts === "" ? "unset: accounts OFF (the safe default)" : "set to a value other than exactly 'on': accounts OFF"));
  const needed = ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "INVITE_CODE_PEPPER", "AUTH_FLOW_SECRET", "AUTH_SITE_URL", "CRON_SECRET"];
  for (const k of needed) r.push(item(`${k} present`, has(k), has(k) ? "set" : "MISSING"));
  for (const k of ["INVITE_CODE_PEPPER", "AUTH_FLOW_SECRET", "CRON_SECRET"]) if (has(k)) r.push(item(`${k} strength`, env[k].length >= 32, env[k].length >= 32 ? "long enough" : "TOO SHORT (need at least 32 characters)"));
  if (has("SUPABASE_ANON_KEY") && has("SUPABASE_SERVICE_ROLE_KEY")) r.push(item("anon key differs from service-role key", env.SUPABASE_ANON_KEY !== env.SUPABASE_SERVICE_ROLE_KEY, env.SUPABASE_ANON_KEY !== env.SUPABASE_SERVICE_ROLE_KEY ? "different" : "IDENTICAL"));
  if (has("INVITE_CODE_PEPPER") && has("AUTH_FLOW_SECRET")) r.push(item("pepper differs from flow secret", env.INVITE_CODE_PEPPER !== env.AUTH_FLOW_SECRET, env.INVITE_CODE_PEPPER !== env.AUTH_FLOW_SECRET ? "different" : "IDENTICAL"));
  if (has("SUPABASE_URL")) {
    let host = "";
    try { host = new URL(env.SUPABASE_URL).hostname; } catch { /* reported below */ }
    const okHost = host.endsWith(".supabase.co") && new URL(env.SUPABASE_URL).protocol === "https:";
    r.push(item("SUPABASE_URL is an https supabase.co project", okHost, okHost ? "yes" : "NO"));
    if (expectedRef) r.push(item("SUPABASE_URL is the expected project", host === `${expectedRef}.supabase.co`, host === `${expectedRef}.supabase.co` ? "yes" : "NO: points at a different project"));
  }
  if (has("AUTH_SITE_URL")) {
    let u = null;
    try { u = new URL(env.AUTH_SITE_URL); } catch { /* reported below */ }
    r.push(item("AUTH_SITE_URL is https on the canonical domain", !!u && u.protocol === "https:" && CANONICAL_HOSTS.includes(u.hostname) && (u.pathname === "/" || u.pathname === ""), u && u.protocol === "https:" && CANONICAL_HOSTS.includes(u.hostname) ? "yes" : `NO (expected https://${CANONICAL_HOSTS.join(" or ")})`));
  }
  const leaked = Object.keys(env).filter((k) => k.startsWith("NEXT_PUBLIC_") && SECRET_NAME.test(k));
  r.push(item("no NEXT_PUBLIC_ variable has a secret-looking name", leaked.length === 0, leaked.length === 0 ? "none" : `FOUND: ${leaked.join(", ")}`));
  if (has("AUTH_REAUTH_WINDOW_SECONDS")) r.push(item("AUTH_REAUTH_WINDOW_SECONDS only shortens", Number(env.AUTH_REAUTH_WINDOW_SECONDS) <= 600, "set; must be at most 600 (the code clamps it anyway)"));
  if (has("AUTH_REQUEST_TIMEOUT_MS")) r.push(item("AUTH_REQUEST_TIMEOUT_MS is a number", /^\d+$/.test(env.AUTH_REQUEST_TIMEOUT_MS), "set; the code keeps it between 1000 and 15000"));
  r.push(note("scope", "this checks the values given to it; whether Production, Preview and Development are separated in Vercel cannot be seen from here (see the operator checklist)"));
  return r;
}

// ---------------------------------------------------------------- where a request may go
/**
 * The address a check may talk to. The URL (and the key sent with it) can come from an environment file the operator loaded, so it is checked
 * before anything is sent: only a hosted Supabase project (https://<20 letters or digits>.supabase.co) or a local stack (http on localhost).
 * Anything else throws, so a tampered file cannot make this tool send the anon key to some other host. Returns the bare origin.
 */
export function supabaseOrigin(raw) {
  let u;
  try { u = new URL(String(raw)); } catch { throw new Error("SUPABASE_URL is not a valid address"); }
  const hosted = u.protocol === "https:" && /^[a-z0-9]{20}\.supabase\.co$/.test(u.hostname) && !u.port;
  const local = u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1");
  if ((!hosted && !local) || u.username || u.password) throw new Error("SUPABASE_URL must be a Supabase project address (https://<ref>.supabase.co) or a local stack; nothing was sent");
  return u.origin;
}

// ---------------------------------------------------------------- authentication settings (public endpoint, anon key)
export async function checkAuthSettings({ fetchImpl = fetch, url, anonKey, expectGoogle = true }) {
  const res = await fetchImpl(`${supabaseOrigin(url)}/auth/v1/settings`, { headers: { apikey: anonKey }, signal: AbortSignal.timeout(15_000) });
  if (res.status !== 200) return [item("auth settings readable", false, `HTTP ${res.status}`)];
  const s = await res.json();
  const ext = s.external ?? {};
  const r = [item("auth settings readable", true, "HTTP 200")];
  r.push(item(`Google provider is ${expectGoogle ? "enabled" : "not enabled yet"}`, ext.google === expectGoogle, ext.google === expectGoogle ? "as expected" : `is ${ext.google}`));
  const others = Object.entries(ext).filter(([k, v]) => k !== "google" && v === true).map(([k]) => k);
  r.push(item("no other sign-in provider is enabled (including email and phone)", others.length === 0, others.length === 0 ? "none" : `ENABLED: ${others.join(", ")}`));
  r.push(item("sign-ups are allowed (OAuth needs them; the app refuses uninvited people itself)", s.disable_signup !== true, s.disable_signup === true ? "sign-ups are disabled: Google sign-in would fail" : "allowed"));
  if ("anonymous_users" in ext) r.push(item("anonymous sign-ins are off", ext.anonymous_users === false, String(ext.anonymous_users)));
  else r.push(note("anonymous sign-ins", "not reported by the public settings endpoint: check in the dashboard"));
  for (const k of ["saml_enabled", "sms_provider"]) if (s[k]) r.push(item(`${k} is off`, false, "ENABLED"));
  r.push(note("not visible read-only", "Site URL, the redirect allow-list, JWT expiry and refresh-token rotation are not in the public settings: confirm them in the dashboard"));
  return r;
}

// ---------------------------------------------------------------- the Data API as an anonymous caller
export async function checkRestSurface({ fetchImpl = fetch, url, anonKey }) {
  const base = supabaseOrigin(url);
  const get = (path) => fetchImpl(`${base}${path}`, { headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` }, signal: AbortSignal.timeout(15_000) });
  const r = [];
  for (const t of EXPECTED_TABLES) {
    const res = await get(`/rest/v1/${t}?select=*&limit=1`);
    let ok = [401, 403, 404].includes(res.status);
    let detail = `HTTP ${res.status}`;
    if (res.status === 200) {
      const body = await res.json().catch(() => null);
      ok = Array.isArray(body) && body.length === 0;
      detail = ok ? "HTTP 200 with no rows (RLS hides them)" : "HTTP 200 WITH ROWS";
    } else if (res.status === 404) detail = "HTTP 404 (table does not exist yet, or is not exposed)";
    r.push(item(`anon cannot read ${t}`, ok, detail));
  }
  const spec = await get("/rest/v1/");
  if (spec.status === 200) {
    const doc = await spec.json().catch(() => ({}));
    const paths = Object.keys(doc.paths ?? {}).filter((p) => p !== "/");
    r.push(item("the API exposes nothing to an anonymous caller (no tables, no functions)", paths.length === 0, paths.length === 0 ? "nothing listed" : `LISTED: ${paths.join(", ")}`));
  } else r.push(note("API description", `not available to anon (HTTP ${spec.status}); the table probes above still apply`));
  return r;
}

// ---------------------------------------------------------------- database (SELECT only, read-only transaction)
/** Every statement the database check runs. A test asserts each one is a plain SELECT. */
export const DB_QUERIES = Object.freeze({
  migrations: "select version::text as version, name from supabase_migrations.schema_migrations order by 1",
  tables: "select c.relname as name, c.relrowsecurity as rls from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r','p') order by 1",
  tablePrivileges: `select c.relname as name, r.role as role, p.priv as priv from pg_class c join pg_namespace n on n.oid = c.relnamespace cross join (values ('anon'),('authenticated')) r(role) cross join (values ${PRIVS.map((p) => `('${p}')`).join(",")}) p(priv) where n.nspname = 'public' and c.relkind in ('r','p') and has_table_privilege(r.role, c.oid, p.priv)`,
  profileColumns: "select a.attname as name, has_column_privilege('authenticated', 'public.profiles'::regclass, a.attname, 'update') as can_update from pg_attribute a where a.attrelid = to_regclass('public.profiles') and a.attnum > 0 and not a.attisdropped",
  functions: "select p.proname as name, has_function_privilege('anon', p.oid, 'execute') as anon, has_function_privilege('authenticated', p.oid, 'execute') as authenticated from pg_proc p where p.pronamespace = 'public'::regnamespace order by 1",
  authUsers: "select count(*)::int as n from auth.users",
  extensions: "select extname as name from pg_extension order by 1",
});

export async function checkDatabase(query, { expectedMigrations, expectedMigrationNames, platformFunctionsAllowed = /** @type {string[]} */ ([]) }) {
  const r = [];
  const mig = (await query(DB_QUERIES.migrations).catch(() => ({ rows: null }))).rows;
  if (!mig) r.push(item("migration history readable", false, "supabase_migrations.schema_migrations not found"));
  else {
    // Compared by NAME when names are given: a migration applied through the connector or the dashboard gets its own timestamp as its version, but keeps its name.
    const byName = Array.isArray(expectedMigrationNames);
    const have = mig.map((m) => String(byName ? m.name : m.version));
    const want = byName ? expectedMigrationNames : expectedMigrations;
    const missing = want.filter((v) => !have.includes(v));
    const extra = have.filter((v) => !want.includes(v));
    if (byName && have.length !== want.length) extra.push("(count differs)");
    r.push(item("applied migrations are exactly the repository's", missing.length === 0 && extra.length === 0, missing.length || extra.length ? `missing: ${missing.join(",") || "none"}; unexpected: ${extra.join(",") || "none"}` : `${have.length} of ${have.length}, in order`));
  }
  const tables = (await query(DB_QUERIES.tables)).rows;
  const names = tables.map((t) => t.name);
  r.push(item("the public tables are exactly the expected ones", EXPECTED_TABLES.every((t) => names.includes(t)) && names.every((t) => EXPECTED_TABLES.includes(t)), `found: ${names.join(", ") || "none"}`));
  const noRls = tables.filter((t) => !t.rls).map((t) => t.name);
  r.push(item("row-level security is on for every public table", tables.length > 0 && noRls.length === 0, noRls.length ? `OFF for: ${noRls.join(", ")}` : "on"));
  const grants = (await query(DB_QUERIES.tablePrivileges)).rows;
  const anon = grants.filter((g) => g.role === "anon").map((g) => `${g.name}:${g.priv}`);
  r.push(item("anon has no privilege on any public table", anon.length === 0, anon.length ? `FOUND: ${anon.join(", ")}` : "none"));
  const auth = grants.filter((g) => g.role === "authenticated").map((g) => `${g.name}:${g.priv}`).sort();
  const wantAuth = LEARNER_SELECT.map((t) => `${t}:select`).sort();
  r.push(item("signed-in learners hold table-level SELECT on their own three tables and nothing else", JSON.stringify(auth) === JSON.stringify(wantAuth), `granted: ${auth.join(", ") || "none"}`));
  const cols = (await query(DB_QUERIES.profileColumns)).rows;
  const upd = cols.filter((c) => c.can_update).map((c) => c.name).sort();
  r.push(item("learners can update only four profile columns", JSON.stringify(upd) === JSON.stringify([...PROFILE_UPDATABLE].sort()), `updatable: ${upd.join(", ") || "none"}`));
  const fns = (await query(DB_QUERIES.functions)).rows;
  const anonFns = fns.filter((f) => f.anon).map((f) => f.name);
  r.push(item("anon can execute no public function", anonFns.length === 0, anonFns.length ? `CAN EXECUTE: ${anonFns.join(", ")}` : "none"));
  const authFns = fns.filter((f) => f.authenticated && !LEARNER_FUNCTIONS.includes(f.name)).map((f) => f.name);
  const unexpected = authFns.filter((n) => !platformFunctionsAllowed.includes(n));
  r.push(item("signed-in learners can execute only is_active_learner and is_admin", unexpected.length === 0, unexpected.length ? `ALSO: ${unexpected.join(", ")}` : authFns.length ? `only the allowed platform helper(s): ${authFns.join(", ")}` : "only those two"));
  const users = (await query(DB_QUERIES.authUsers)).rows[0].n;
  r.push(note("auth.users", `${users} row(s)`));
  r.push(note("extensions", (await query(DB_QUERIES.extensions)).rows.map((e) => e.name).join(", ")));
  return r;
}

// ---------------------------------------------------------------- report
export function summarize(sections) {
  const all = sections.flatMap((s) => s.items);
  return { failed: all.filter((i) => i.level === "fail").length, passed: all.filter((i) => i.level === "pass").length, notes: all.filter((i) => i.level === "note").length };
}
export function renderReport(sections, redact = (t) => t) {
  const lines = [];
  for (const s of sections) {
    lines.push(`== ${s.name}`);
    for (const i of s.items) lines.push(`  ${i.level === "pass" ? "PASS" : i.level === "fail" ? "FAIL" : "note"}  ${i.id}: ${i.detail}`);
  }
  const t = summarize(sections);
  lines.push(`\n${t.failed === 0 ? "READY on these checks" : "NOT READY"}: ${t.passed} passed, ${t.failed} failed, ${t.notes} notes`);
  return redact(lines.join("\n"));
}
