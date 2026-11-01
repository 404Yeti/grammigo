// @vitest-environment node
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as checks from "../../../scripts/readiness/checks.mjs";
import * as cli from "../../../scripts/check-production-readiness.mjs";
import * as region from "../../../scripts/vercel-region.mjs";

const ROOT = path.resolve(__dirname, "../../..");
const SERVICE = "svc-secret-value-0123456789-abcdefghijklmnop";
const ANON = "anon-public-key-value-0123456789-abcdefghijk";
const goodEnv = {
  NEXT_PUBLIC_ACCOUNTS: "on", SUPABASE_URL: "https://ugifdvaaaioiqmwfiksw.supabase.co", SUPABASE_ANON_KEY: ANON, SUPABASE_SERVICE_ROLE_KEY: SERVICE,
  INVITE_CODE_PEPPER: "p".repeat(40), AUTH_FLOW_SECRET: "f".repeat(40), AUTH_SITE_URL: "https://grammigo.si", CRON_SECRET: "c".repeat(40),
};
const fails = <T extends { level: string }>(r: T[]) => r.filter((i) => i.level === "fail");

describe("environment check", () => {
  it("passes a correct production environment and prints no value", () => {
    const r = checks.checkEnvironment(goodEnv, { expectedRef: "ugifdvaaaioiqmwfiksw" });
    expect(fails(r)).toEqual([]);
    const text = checks.renderReport([{ name: "env", items: r }], checks.redactor(goodEnv));
    for (const v of [SERVICE, ANON, goodEnv.INVITE_CODE_PEPPER, goodEnv.AUTH_FLOW_SECRET, goodEnv.CRON_SECRET]) expect(text).not.toContain(v);
    expect(text).toContain("READY");
  });
  it("catches each mistake by name", () => {
    const bad = (over: Record<string, string | undefined>) => fails(checks.checkEnvironment({ ...goodEnv, ...over }, { expectedRef: "ugifdvaaaioiqmwfiksw" })).map((i: { id: string }) => i.id);
    expect(bad({ SUPABASE_SERVICE_ROLE_KEY: undefined })).toContain("SUPABASE_SERVICE_ROLE_KEY present");
    expect(bad({ SUPABASE_SERVICE_ROLE_KEY: ANON })).toContain("anon key differs from service-role key");
    expect(bad({ INVITE_CODE_PEPPER: "short" })).toContain("INVITE_CODE_PEPPER strength");
    expect(bad({ AUTH_FLOW_SECRET: goodEnv.INVITE_CODE_PEPPER })).toContain("pepper differs from flow secret");
    expect(bad({ AUTH_SITE_URL: "http://grammigo.si" })).toContain("AUTH_SITE_URL is https on the canonical domain");
    expect(bad({ AUTH_SITE_URL: "https://grammigo.vercel.app" })).toContain("AUTH_SITE_URL is https on the canonical domain");
    expect(bad({ SUPABASE_URL: "https://zzzzzzzzzzzzzzzzzzzz.supabase.co" })).toContain("SUPABASE_URL is the expected project");
    expect(bad({ SUPABASE_URL: "http://localhost:54321" })).toContain("SUPABASE_URL is an https supabase.co project");
    expect(bad({ NEXT_PUBLIC_SUPABASE_SERVICE_KEY: "x" })).toContain("no NEXT_PUBLIC_ variable has a secret-looking name");
  });
  it("reports accounts OFF when the switch is anything but exactly 'on'", () => {
    for (const v of [undefined, "", "ON", "true", "1"]) expect(checks.checkEnvironment({ ...goodEnv, NEXT_PUBLIC_ACCOUNTS: v }, {}).find((i: { id: string }) => i.id === "NEXT_PUBLIC_ACCOUNTS")?.detail).toMatch(/OFF/);
  });
  it("parses an env file (comments, export, quotes) without keeping anything else", () => {
    expect(cli.parseEnvFile('# c\nexport A="1"\nB=\'2\'\nC=3\n\nnot a line\n')).toEqual({ A: "1", B: "2", C: "3" });
  });
});

describe("redaction", () => {
  it("removes secret values, JWT-shaped strings and connection strings from any text", () => {
    const env = { ...goodEnv, SUPABASE_DB_URL: "postgresql://postgres:hunter2hunter2@db.example.supabase.co:5432/postgres" };
    const r = checks.redactor(env);
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZSJ9.c2lnbmF0dXJl";
    const out = r(`oops ${SERVICE} and ${jwt} and ${env.SUPABASE_DB_URL} and ${goodEnv.INVITE_CODE_PEPPER}`);
    for (const v of [SERVICE, jwt, "hunter2", goodEnv.INVITE_CODE_PEPPER]) expect(out).not.toContain(v);
  });
  it("an error that mentions a secret still prints none of it", async () => {
    const r = checks.redactor(goodEnv);
    expect(r(new Error(`request to ${goodEnv.SUPABASE_URL} with ${SERVICE} failed`).message)).not.toContain(SERVICE);
  });
});

const settings = (ext: Record<string, boolean>, extra: Record<string, unknown> = {}) => async () => new Response(JSON.stringify({ external: { email: false, phone: false, google: true, ...ext }, disable_signup: false, ...extra }), { status: 200 });
describe("authentication settings check", () => {
  const run = (f: typeof fetch, expectGoogle = true) => checks.checkAuthSettings({ fetchImpl: f, url: "https://x.supabase.co", anonKey: ANON, expectGoogle });
  it("passes Google-only", async () => expect(fails(await run(settings({}) as never))).toEqual([]));
  it("fails when email, phone or any other provider is on", async () => {
    for (const on of ["email", "phone", "github", "apple"]) expect(fails(await run(settings({ [on]: true }) as never)).length, on).toBeGreaterThan(0);
  });
  it("fails when Google is not enabled (or is enabled too early)", async () => {
    expect(fails(await run(settings({ google: false }) as never)).length).toBe(1);
    expect(fails(await run(settings({}) as never, false)).length).toBe(1);
    expect(fails(await run(settings({ google: false }) as never, false))).toEqual([]);
  });
  it("fails when sign-ups are disabled (Google sign-in could not create anyone) and when settings are unreadable", async () => {
    expect(fails(await run(settings({}, { disable_signup: true }) as never)).length).toBe(1);
    expect(fails(await run((async () => new Response("no", { status: 401 })) as never)).length).toBe(1);
  });
  it("sends only the public anon key, to the settings path, with GET", async () => {
    const seen: { url: string; init?: RequestInit }[] = [];
    await run((async (u: string, init: RequestInit) => (seen.push({ url: u, init }), new Response(JSON.stringify({ external: { google: true } }), { status: 200 }))) as never);
    expect(seen).toHaveLength(1);
    expect(seen[0].url).toBe("https://x.supabase.co/auth/v1/settings");
    expect((seen[0].init?.method ?? "GET").toUpperCase()).toBe("GET");
    expect(JSON.stringify(seen[0].init?.headers)).toContain(ANON);
  });
});

describe("Data API check", () => {
  const f = (table: (name: string) => Response, spec: Response) => (async (u: string) => (u.includes("/rest/v1/?") || u.endsWith("/rest/v1/") ? spec : table(u.split("/rest/v1/")[1].split("?")[0]))) as never;
  const run = (fx: typeof fetch) => checks.checkRestSurface({ fetchImpl: fx, url: "https://x.supabase.co", anonKey: ANON });
  it("passes when every table is hidden and nothing is exposed", async () => {
    expect(fails(await run(f(() => new Response("[]", { status: 200 }), new Response(JSON.stringify({ paths: { "/": {} } }), { status: 200 }))))).toEqual([]);
    expect(fails(await run(f(() => new Response("{}", { status: 404 }), new Response("{}", { status: 401 }))))).toEqual([]);
  });
  it("fails when a table returns rows to anon, or the API lists a function", async () => {
    expect(fails(await run(f((t) => new Response(t === "profiles" ? '[{"id":1}]' : "[]", { status: 200 }), new Response("{}", { status: 401 }))))).toHaveLength(1);
    expect(fails(await run(f(() => new Response("[]", { status: 200 }), new Response(JSON.stringify({ paths: { "/": {}, "/rpc/rls_auto_enable": {} } }), { status: 200 }))))[0].detail).toContain("rls_auto_enable");
  });
});

describe("database check (fake query function)", () => {
  const MIGS = cli.expectedMigrations();
  const world = (over: Record<string, unknown[]> = {}) => {
    const base: Record<string, unknown[]> = {
      migrations: MIGS.map((version: string) => ({ version })),
      tables: checks.EXPECTED_TABLES.map((name: string) => ({ name, rls: true })),
      tablePrivileges: ["consents", "learner_documents", "profiles"].map((name) => ({ name, role: "authenticated", priv: "select" })),
      profileColumns: [{ name: "id", can_update: false }, ...["display_name", "first_language", "time_zone", "preferences"].map((name) => ({ name, can_update: true }))],
      functions: [{ name: "is_active_learner", anon: false, authenticated: true }, { name: "is_admin", anon: false, authenticated: true }, { name: "put_document", anon: false, authenticated: false }],
      authUsers: [{ n: 0 }], extensions: [{ name: "plpgsql" }],
    };
    const merged = { ...base, ...over };
    return async (sql: string) => ({ rows: merged[Object.entries(checks.DB_QUERIES).find(([, q]) => q === sql)![0]] });
  };
  const run = (w: ReturnType<typeof world>, platformFunctionsAllowed: string[] = [] as string[]) => checks.checkDatabase(w, { expectedMigrations: MIGS as string[], platformFunctionsAllowed: platformFunctionsAllowed as string[] });
  it("passes the intended state", async () => expect(fails(await run(world()))).toEqual([]));
  it("each deviation fails by name", async () => {
    const id = async (over: Record<string, unknown[]>, allowed?: string[]) => fails(await run(world(over), allowed)).map((i: { id: string }) => i.id);
    expect(await id({ migrations: [] })).toContain("applied migrations are exactly the repository's");
    expect(await id({ tables: checks.EXPECTED_TABLES.slice(1).map((name: string) => ({ name, rls: true })) })).toContain("the public tables are exactly the expected ones");
    expect(await id({ tables: checks.EXPECTED_TABLES.map((name: string, i: number) => ({ name, rls: i !== 0 })) })).toContain("row-level security is on for every public table");
    expect(await id({ tablePrivileges: [{ name: "profiles", role: "anon", priv: "select" }] })).toContain("anon has no privilege on any public table");
    expect(await id({ tablePrivileges: [{ name: "invitations", role: "authenticated", priv: "select" }] })).toContain("signed-in learners hold table-level SELECT on their own three tables and nothing else");
    expect(await id({ profileColumns: [{ name: "status", can_update: true }] })).toContain("learners can update only four profile columns");
    expect(await id({ functions: [{ name: "rls_auto_enable", anon: true, authenticated: true }] })).toEqual(expect.arrayContaining(["anon can execute no public function", "signed-in learners can execute only is_active_learner and is_admin"]));
  });
  it("a known platform helper can be allowed explicitly for signed-in users, but never for anon", async () => {
    const w = world({ functions: [{ name: "is_admin", anon: false, authenticated: true }, { name: "rls_auto_enable", anon: false, authenticated: true }] });
    expect(fails(await run(w, ["rls_auto_enable"]))).toEqual([]);
    expect(fails(await run(w, []))).toHaveLength(1);
  });
  it("every statement it can run is a plain SELECT (no write can be issued by this check)", () => {
    for (const [name, sql] of Object.entries(checks.DB_QUERIES as Record<string, string>)) expect(sql, name).toMatch(/^\s*select\b/i);
    for (const [name, sql] of Object.entries(checks.DB_QUERIES as Record<string, string>)) expect(sql, name).not.toMatch(/\b(insert|update|delete|truncate|drop|alter|create|grant|revoke)\s/i);
  });
  it("the runner opens a READ ONLY transaction and the server is told to refuse writes", () => {
    const src = readFileSync(path.join(ROOT, "scripts/check-production-readiness.mjs"), "utf8");
    expect(src).toContain("default_transaction_read_only=on");
    expect(src).toContain("begin read only");
    expect(src).not.toMatch(/\b(INSERT|UPDATE|DELETE|DROP|ALTER|GRANT|REVOKE|TRUNCATE)\b/);
  });
});

describe("expected migrations", () => {
  it("are read from the repository (nine files, oldest first) and include the platform-helper revoke", () => {
    const m = cli.expectedMigrations();
    expect(m).toEqual([...m].sort());
    expect(m.length).toBe(readdirSync(path.join(ROOT, "supabase/migrations")).filter((f) => f.endsWith(".sql")).length);
    expect(m).toContain("20261105000100");
  });
  it("the revoke migration only touches the platform helper, and only if it exists", () => {
    const sql = readFileSync(path.join(ROOT, "supabase/migrations/20261105000100_revoke_platform_helper.sql"), "utf8");
    expect(sql).toMatch(/to_regprocedure\('public\.rls_auto_enable\(\)'\) is not null/);
    expect(sql.match(/revoke execute on function [^;]+;/g)).toEqual(["revoke execute on function public.rls_auto_enable() from public, anon, authenticated;"]);
    expect(sql).not.toMatch(/\b(drop|delete|truncate|alter table)\b/i);
  });
});

describe("Vercel function-region preparation", () => {
  it("maps a VERIFIED Supabase region and never guesses", () => {
    expect(region.vercelConfigFor("ap-southeast-1")).toEqual({ regions: ["sin1"] });
    expect(region.vercelConfigFor("eu-central-1", { cron: true })).toEqual({ regions: ["fra1"], crons: [{ path: "/api/auth/cleanup", schedule: "17 3 * * *" }] });
    for (const bad of [undefined, "", "sin1", "ap-southeast-9", "AP-SOUTHEAST-1", "__proto__", "constructor"]) expect(() => region.vercelConfigFor(bad), String(bad)).toThrow(/does not guess/);
  });
  it("no vercel.json is committed yet, so no function region is assumed anywhere (and if one appears it must match a verified mapping)", () => {
    const file = path.join(ROOT, "vercel.json");
    if (!existsSync(file)) return;
    const cfg = JSON.parse(readFileSync(file, "utf8"));
    expect(Object.values(region.REGION_MAP)).toEqual(expect.arrayContaining(cfg.regions ?? []));
    expect((cfg.regions ?? []).length).toBe(1);
  });
});
