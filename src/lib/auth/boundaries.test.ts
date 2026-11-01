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
/** Code only: a comment may mention a word the code must not use. */
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
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
    expect(src).toMatch(/await authGate\(\)|await syncDeps\(req\)|await lifecycleDeps\(req\)/); // syncDeps and lifecycleDeps start with the same gate
    // the gate is the first thing each handler does: nothing before it reads the request or touches a client
    for (const h of src.matchAll(/export async function (GET|POST)\([^)]*\)\s*\{\s*([^\n]*)/g)) expect(h[2], `${h[1]} first statement`).toMatch(/authGate|[dD]eps\(|gate/);
  });
  it("no route handler exports a runtime/dynamic setting that could make it static", () => {
    for (const f of routes) expect(read(f)).not.toMatch(/export const (dynamic|revalidate)\s*=\s*["']?force-static/);
  });
});

describe("the learning code does not know accounts exist", () => {
  const LEARNING = /^(features\/(learning|practice|guided|diagnostic|mastery|onboarding|lessons|ai)|lib\/storage|curriculum|data|types|components)\//;
  // The ONE exception: the shared page shell shows a plain "Sign in" / "Account" link. That link makes no network call and touches no
  // lesson, mastery or storage code; it only reads which learner's folder the browser points at.
  const ALLOWED: Record<string, string[]> = { "components/layout/AppShell.tsx": ["@/features/accounts/AccountEntry"] };
  it("none of it imports the account modules, except the one header link", () => {
    const offenders: string[] = [];
    for (const f of files) {
      if (!LEARNING.test(rel(f)) || isTest(f)) continue;
      for (const i of imports(read(f))) if (/@\/lib\/auth|@\/features\/accounts|@supabase\//.test(i) && !(ALLOWED[rel(f)] ?? []).includes(i)) offenders.push(`${rel(f)} -> ${i}`);
    }
    expect(offenders).toEqual([]);
  });
  it("the header link itself is plain: no server code, no network, no storage writes", () => {
    const src = read(path.join(SRC, "features/accounts/AccountEntry.tsx"));
    expect(src).not.toMatch(/fetch\(|XMLHttpRequest|@\/lib\/auth|@supabase|localStorage|sessionStorage|document\.cookie/);
  });
  it("the storage-scope module is a pure key switch: it imports nothing", () => {
    expect(imports(read(path.join(SRC, "lib/scope/storage-scope.ts")))).toEqual([]);
  });
  it("lesson, mastery and storage code never make a network call or know about Supabase", () => {
    const offenders = files.filter((f) => !isTest(f) && /^(features\/(learning|practice|diagnostic|mastery|lessons|guided\/(cycle|store|evaluator))|lib\/storage|curriculum|data)\//.test(rel(f)) && /\bfetch\(|supabase|XMLHttpRequest|sendBeacon/i.test(stripComments(read(f)))).map(rel);
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

describe("Phase 4: learner data never goes through privileged credentials", () => {
  const learnerFiles = () => files.filter((f) => !isTest(f) && /^(lib\/auth\/(profile-api|page|viewer)\.ts|app\/api\/account\/|app\/account\/(?!invitations)|features\/accounts\/(Dashboard|ProfileForm)\.tsx)/.test(rel(f)));
  it("finds the learner-facing files", () => expect(learnerFiles().length).toBeGreaterThanOrEqual(7));
  it("none of them can reach the service role (no service client, no service key, no `.service`)", () => {
    const offenders = learnerFiles().filter((f) => /createServiceClient|rt\.service|\.service\b|SERVICE_ROLE|serviceKey/.test(read(f))).map(rel);
    expect(offenders).toEqual([]);
  });
  it("the profile API takes the learner's id from the verified session, never from the request", () => {
    const src = read(path.join(SRC, "lib/auth/profile-api.ts"));
    expect(src).toMatch(/\.eq\("id", d\.viewer\.id\)/);
    expect(src).not.toMatch(/searchParams|params\.id|raw\.id|body\.id/);
  });
  it("every private page starts by requiring a learner", () => {
    const pages = files.filter((f) => /app\/account\/.*page\.tsx$/.test(f.replaceAll("\\", "/")));
    expect(pages.length).toBeGreaterThanOrEqual(4);
    for (const f of pages) expect(read(f), rel(f)).toMatch(/requireLearner\(|accountsEnabled\(\)/);
    for (const f of pages.filter((p) => !/\/account\/page\.tsx$/.test(p.replaceAll("\\", "/")) || true)) expect(read(f), rel(f)).toMatch(/requireLearner\(/);
  });
});

describe("Phase 4: owner-only invitation management", () => {
  it("the owner pages demand an owner (a plain 404 for everyone else)", () => {
    expect(read(path.join(SRC, "app/account/invitations/page.tsx"))).toMatch(/requireLearner\(\{ admin: true \}\)/);
  });
  it("every owner operation passes the owner gate first", () => {
    const src = read(path.join(SRC, "lib/auth/admin.ts"));
    for (const fn of ["createInvitation", "listInvitations", "revokeInvitation", "expireInvitation"]) {
      const body = new RegExp(`export async function ${fn}\\([^)]*\\)[^{]*\\{\\s*const refused = await gate\\(`).test(src);
      expect(body, fn).toBe(true);
    }
  });
  it("the invitation list query selects explicit columns, never the code hash", () => {
    const src = read(path.join(SRC, "lib/auth/admin.ts"));
    const select = /\.select\("([^"]+)"\)/.exec(src)?.[1] ?? "";
    expect(select).toContain("code_hint");
    expect(select).not.toMatch(/code_hash|\*/);
  });
  it("the screen that shows a secret never writes it to storage, cookies, the URL or the console", () => {
    const src = read(path.join(SRC, "features/accounts/InvitationManager.tsx"));
    expect(src).not.toMatch(/localStorage|sessionStorage|indexedDB|document\.cookie|console\.|history\.(push|replace)State|router\.(push|replace)|location\.(href|hash|search)\s*=/);
  });
  it("no server code in the account system writes to the console directly (only the content-free logger)", () => {
    const offenders = files.filter((f) => !isTest(f) && /^lib\/auth\//.test(rel(f)) && /console\./.test(read(f)) && rel(f) !== "lib/auth/runtime.ts").map(rel);
    expect(offenders).toEqual([]);
  });
});

describe("Phase 5: saving progress", () => {
  it("the sync handlers use the service role for exactly two things: the compare-and-swap write and recording consent", () => {
    const src = read(path.join(SRC, "lib/auth/sync-api.ts"));
    const uses = [...src.matchAll(/d\.service\.(\w+)\(\s*"([a-z_]+)"/g)].map((m) => `${m[1]}:${m[2]}`).sort();
    expect(uses).toEqual(["rpc:put_document", "rpc:record_consent"]);
    expect(src.match(/d\.service/g)?.length).toBe(2); // and nothing else touches it
  });

  it("every sync read and write names the learner from the verified viewer, never from the request", () => {
    const src = read(path.join(SRC, "lib/auth/sync-api.ts"));
    expect(src).not.toMatch(/searchParams|params\.(id|user)|raw\.(id|user)|\.userId|body\.user/);
    expect(src).toMatch(/p_user: d\.viewer\.id/);
  });

  it("the browser-side sync code never sees server code, secrets or the service role", () => {
    const syncFiles = files.filter((f) => /^features\/sync\//.test(rel(f)) && !isTest(f));
    expect(syncFiles.length).toBeGreaterThan(8);
    const offenders = syncFiles.filter((f) => imports(read(f)).some((i) => /^@\/lib\/auth\/|^@supabase\/|^server-only$/.test(i))).map(rel);
    expect(offenders).toEqual([]);
  });

  it("nothing in the lesson, mastery or storage code starts a sync or imports the sync module (sync depends on them, never the reverse)", () => {
    const offenders: string[] = [];
    for (const f of files) {
      if (isTest(f) || !/^(features\/(learning|practice|diagnostic|mastery|lessons|onboarding|ai|guided)|lib\/storage|curriculum|data|components\/(exercises|feedback|lesson|mascot|progress|ui))\//.test(rel(f))) continue;
      for (const i of imports(read(f))) if (/@\/features\/sync|@\/features\/accounts/.test(i)) offenders.push(`${rel(f)} -> ${i}`);
    }
    expect(offenders).toEqual([]);
  });

  it("mastery, the profile and recommendations are never saved: the saved documents hold sessions, runs and goals only", () => {
    const merge = read(path.join(SRC, "features/sync/merge.ts"));
    expect(merge).not.toMatch(/computeAllMastery|buildProfile|recommendLessons|deriveLearning/);
    const adapters = read(path.join(SRC, "features/sync/doc-adapters.ts")) + read(path.join(SRC, "features/sync/guided-doc.ts"));
    expect(adapters).not.toMatch(/computeAllMastery|buildProfile|recommendLessons|deriveLearning|countOutcomes/);
  });

  it("the Guided Correction sync code never touches the outcome weights or anything that scores them", () => {
    for (const f of ["features/sync/guided-doc.ts", "features/sync/merge-guided.ts", "features/sync/guest-import.ts"]) {
      expect(read(path.join(SRC, f)), f).not.toMatch(/GUIDED_OUTCOME_VALUES|outcomeValue|summarizeOutcomes|meanProvisionalValue/);
    }
  });
});

describe("Phase 6: export, deletion and sign-in confirmation", () => {
  const lifecycle = () => read(path.join(SRC, "lib/auth/lifecycle.ts"));
  it("the lifecycle handlers use the service role for exactly two things: recording an export, and the one deletion function", () => {
    const uses = [...lifecycle().matchAll(/d\.service\.(\w+)\(\s*"([a-z_]+)"/g)].map((m) => `${m[1]}:${m[2]}`).sort();
    expect(uses).toEqual(["rpc:audit_export", "rpc:delete_learner"]);
    expect(lifecycle().match(/d\.service/g)?.length).toBe(2); // nothing else touches it
  });
  it("the only other privileged calls are the three restore-replay functions, and they are not reachable from any route", () => {
    const src = lifecycle();
    const replay = [...src.matchAll(/(?<![.\w])service\.rpc\(\s*"([a-z_]+)"/g)].map((m) => m[1]).sort();
    expect(replay).toEqual(["all_user_ids", "ledger_hashes", "redelete_learner"]);
    const routes = files.filter((f) => /^app\//.test(rel(f)) && !isTest(f)).filter((f) => /replayDeletionLedger|serviceReplayDb/.test(read(f)));
    expect(routes.map(rel)).toEqual([]);
  });
  it("export reads only through the learner's own session and names the learner from the verified viewer, never the request", () => {
    const src = lifecycle();
    const build = /export async function buildExport[\s\S]*?\n}\n/.exec(src)?.[0] ?? "";
    expect(build).toMatch(/d\.client\.from\("profiles"\)/);
    expect(build).not.toMatch(/d\.service|searchParams|params\./);
    expect(src).toMatch(/buildExport\(d, d\.viewer\.id\)/);
    expect(src).toMatch(/p_user: d\.viewer\.id/);
    expect(src).not.toMatch(/searchParams|params\.(id|user)|raw\.(id|user)|body\.(id|user)/);
  });
  it("deleting requires, in this order: a learner, a same-origin request, a rate limit, the typed words, and a recent sign-in, before the database call", () => {
    const body = /export async function handleDelete[\s\S]*?\n}\n/.exec(lifecycle())?.[0] ?? "";
    const order = ["refuse(d.viewer)", "isTrustedOrigin", "isAdmin", "limited(d, LIMITS.delete", "normaliseConfirmation", "isRecentSignIn", "delete_learner"].map((m) => body.indexOf(m));
    expect(order.every((i) => i >= 0), JSON.stringify(order)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
  it("recent sign-in comes from the session's authentication time (amr), never from the token's issue time, which moves on every refresh", () => {
    const src = stripComments(lifecycle());
    expect(src).toMatch(/getClaims\(\)/);
    expect(src).not.toMatch(/\.iat\b|claims\.iat|\biat:/);
  });
  it("the lifecycle and re-sign-in modules never log a name, email, id, code or address (logs carry fixed outcome words only)", () => {
    for (const f of ["lib/auth/lifecycle.ts", "lib/auth/lifecycle-http.ts"]) {
      for (const m of stripComments(read(path.join(SRC, f))).matchAll(/\blog\(\s*"[a-z_]+"\s*,\s*(\{[^}]*\})/g)) expect(m[1], f).toMatch(/^\{\s*outcome:\s*"[a-z_]+"\s*\}$/);
    }
  });
  it("the deletion screens and forms never put the confirmation or anything personal in the URL, storage or console", () => {
    for (const f of ["features/accounts/DeleteAccountForm.tsx", "features/accounts/ExportButton.tsx"]) {
      const src = read(path.join(SRC, f));
      expect(src, f).not.toMatch(/console\.|document\.cookie|history\.(push|replace)State|router\.(push|replace)|location\.(search|hash)/);
    }
  });
  it("no lesson, mastery, storage or sync code imports the lifecycle modules", () => {
    const offenders: string[] = [];
    for (const f of files) {
      if (isTest(f) || !/^(features\/(learning|practice|diagnostic|mastery|lessons|onboarding|ai|guided|sync)|lib\/storage|curriculum|data)\//.test(rel(f))) continue;
      for (const i of imports(read(f))) if (/lifecycle|DeleteAccountForm|ExportButton/.test(i)) offenders.push(`${rel(f)} -> ${i}`);
    }
    expect(offenders).toEqual([]);
  });
});

describe("Phase 6: the notice, the review pack and the acceptance checklist stay honest", () => {
  const ROOT = path.resolve(SRC, "..");
  const doc = (f: string) => readFileSync(path.join(ROOT, f), "utf8");
  const notice = () => read(path.join(SRC, "features/accounts/PrivacyAccounts.tsx"));

  it("the plain-text copy for counsel names the same version as the code, and the notice is still marked as a draft", () => {
    const version = /PRIVACY_NOTICE_VERSION\s*=\s*"([^"]+)"/.exec(read(path.join(SRC, "lib/auth/constants.ts")))?.[1] ?? "";
    expect(version).toMatch(/^draft-/);
    expect(doc("docs/legal/privacy-notice-draft.md")).toContain(version);
    expect(notice()).toContain("PRIVACY_NOTICE_VERSION");
    expect(notice()).toMatch(/not yet been reviewed by a lawyer/);
  });

  it("the retention periods in the notice match what the database actually does", () => {
    const sql = readdirSync(path.join(ROOT, "supabase/migrations")).map((f) => readFileSync(path.join(ROOT, "supabase/migrations", f), "utf8")).join("\n");
    expect(sql).toMatch(/deletion_ledger rows are kept for 35 days/);
    expect(sql).toMatch(/audit_events are kept for 90 days/);
    expect(sql).toMatch(/window_start < now\(\) - interval '2 days'/);
    for (const text of [notice(), doc("docs/legal/privacy-notice-draft.md")]) {
      expect(text).toMatch(/35 days/);
      expect(text).toMatch(/90 days/);
      expect(text).toMatch(/two days/);
    }
  });

  it("every cookie the account system sets is disclosed in the notice", () => {
    const cfg = read(path.join(SRC, "lib/auth/config.ts"));
    for (const name of [...cfg.matchAll(/`\$\{prefix\}(gm-[a-z]+)`/g)].map((m) => m[1])) expect(notice(), name).toContain(name);
  });

  it("the notice does not claim AI receives the account's identity, and the AI routes do not know accounts exist", () => {
    expect(notice()).toMatch(/does <b>not<\/b> send your name, email or account to OpenAI/);
    const offenders = files.filter((f) => /^app\/api\/ai\//.test(rel(f)) && !isTest(f) && /lib\/auth|features\/accounts|supabase/i.test(stripComments(read(f)))).map(rel);
    expect(offenders).toEqual([]);
  });

  it("the checklist does not claim physical-device acceptance, and the review pack and security review state their limits", () => {
    expect(doc("docs/dev/real-device-acceptance.md")).toMatch(/Physical-device acceptance has NOT been done/);
    expect(doc("docs/legal/legal-review-pack.md")).toMatch(/Not legal advice\. Not reviewed by a lawyer/);
    expect(doc("docs/dev/security-review.md")).toMatch(/not an independent audit/);
    expect(doc("docs/dev/deletion-and-restore.md")).toMatch(/NOT rehearsed/);
  });

  it("deletion and export are not offered while accounts are off (the page, both routes, and the screens all sit behind the gate)", () => {
    for (const f of ["app/account/data/page.tsx", "app/account/delete/page.tsx", "app/auth/deleted/page.tsx"]) expect(read(path.join(SRC, f)), f).toMatch(/accountsEnabled\(\)\) notFound\(\)/);
    for (const f of ["app/api/account/export/route.ts", "app/api/account/delete/route.ts", "app/api/auth/reauth/route.ts"]) expect(read(path.join(SRC, f)), f).toMatch(/lifecycleDeps\(req\)|authGate\(\)/);
  });
});
