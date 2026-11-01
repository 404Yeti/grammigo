// @vitest-environment node
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Architecture tests. They read the source and fail when a promise made in the design is broken, so a later change cannot quietly
 * move the service role into the browser, add an ungated account route, or couple the learning code to accounts.
 */
const SRC = path.resolve(__dirname, "../..");
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(n) ? [p] : [];
  });
const files = walk(SRC);
const rel = (f: string) => path.relative(SRC, f).replaceAll("\\", "/");
const read = (f: string) => readFileSync(f, "utf8");
const isTest = (f: string) => /\.test\.tsx?$/.test(f) || rel(f).endsWith("auth/testkit.ts");
const imports = (src: string) => [...src.matchAll(/(?:import|export)[^'"]*?from\s*["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)|import\s*["']([^"']+)["']/g)].map((m) => m[1] ?? m[2] ?? m[3]);

describe("the service role and secrets stay on the server", () => {
  it("no 'use client' file imports server account code or a Supabase package", () => {
    const offenders: string[] = [];
    for (const f of files) {
      const src = read(f);
      if (!/^\s*["']use client["']/.test(src)) continue;
      for (const i of imports(src)) if (/^@supabase\//.test(i) || /^@\/lib\/auth\/(?!safe-redirect|constants)/.test(i) || /^server-only$/.test(i)) offenders.push(`${rel(f)} -> ${i}`);
    }
    expect(offenders).toEqual([]);
  });

  it("the secret environment variables are read only by the config module", () => {
    // an actual read of the variable (process.env.X / env.X / env["X"]), not a mention in a comment
    const names = "SUPABASE_SERVICE_ROLE_KEY|INVITE_CODE_PEPPER|AUTH_FLOW_SECRET|CRON_SECRET|SUPABASE_ANON_KEY";
    const secrets = new RegExp(`env\\.(${names})\\b|env\\[\\s*["'](${names})["']`);
    const offenders = files.filter((f) => !isTest(f) && secrets.test(read(f)) && rel(f) !== "lib/auth/config.ts").map(rel);
    expect(offenders).toEqual([]);
  });

  it("the only NEXT_PUBLIC variable the account system uses is the on/off switch", () => {
    const offenders: string[] = [];
    for (const f of files) {
      if (isTest(f)) continue;
      for (const m of read(f).matchAll(/NEXT_PUBLIC_[A-Z0-9_]+/g)) if (/SUPABASE|KEY|SECRET|PEPPER|TOKEN|SERVICE/.test(m[0])) offenders.push(`${rel(f)}: ${m[0]}`);
    }
    expect(offenders).toEqual([]);
  });

  it("the service-role client is created in exactly the places that need it", () => {
    const users = files.filter((f) => !isTest(f) && /createServiceClient\(/.test(read(f)) && rel(f) !== "lib/auth/supabase.ts").map(rel).sort();
    expect(users).toEqual(["app/api/auth/cleanup/route.ts", "lib/auth/runtime.ts"]);
  });

  it("modules that build clients are marked server-only", () => {
    for (const f of ["lib/auth/supabase.ts", "lib/auth/http.ts"]) expect(read(path.join(SRC, f))).toMatch(/import\s+["']server-only["']/);
  });
});

describe("every account route is gated and answers per request", () => {
  const routes = files.filter((f) => /app\/api\/(auth|account|admin)\/.*route\.ts$/.test(f.replaceAll("\\", "/")));
  it("finds the routes", () => expect(routes.length).toBeGreaterThanOrEqual(8));
  it.each(routes.map((f) => [rel(f), f]))("%s starts with the gate", (_name, f) => {
    const src = read(f);
    expect(src).toContain("await authGate()");
    // the gate is the first thing each handler does: nothing before it reads the request or touches a client
    for (const h of src.matchAll(/export async function (GET|POST)\([^)]*\)\s*\{\s*([^\n]*)/g)) expect(h[2], `${h[1]} first statement`).toMatch(/authGate|deps\(|gate/);
  });
  it("no route handler exports a runtime/dynamic setting that could make it static", () => {
    for (const f of routes) expect(read(f)).not.toMatch(/export const (dynamic|revalidate)\s*=\s*["']?force-static/);
  });
});

describe("the learning code does not know accounts exist", () => {
  const LEARNING = /^(features\/(learning|practice|guided|diagnostic|mastery|onboarding|lessons|ai)|lib\/storage|curriculum|data|types|components)\//;
  it("none of it imports the account modules", () => {
    const offenders: string[] = [];
    for (const f of files) {
      if (!LEARNING.test(rel(f)) || isTest(f)) continue;
      for (const i of imports(read(f))) if (/@\/lib\/auth|@\/features\/accounts|@supabase\//.test(i)) offenders.push(`${rel(f)} -> ${i}`);
    }
    expect(offenders).toEqual([]);
  });
  it("the proxy matches only account paths, never lessons, practice, library or onboarding", () => {
    const src = read(path.join(SRC, "proxy.ts"));
    const matcher = /matcher:\s*\[([^\]]*)\]/.exec(src)?.[1] ?? "";
    const paths = [...matcher.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    expect(paths.length).toBeGreaterThan(0);
    for (const p of paths) expect(p).toMatch(/^\/(account|api\/account|api\/admin)(\/|$)/);
  });
});
