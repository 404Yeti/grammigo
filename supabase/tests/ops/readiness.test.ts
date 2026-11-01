import { afterAll, describe, expect, it } from "vitest";
import { checkDatabase, checkRestSurface } from "../../../scripts/readiness/checks.mjs";
import { expectedMigrationNames, expectedMigrations } from "../../../scripts/check-production-readiness.mjs";
import { closePool, pool, q } from "../helpers";

/**
 * The production readiness checks, run for real against the LOCAL stack (never production). The local database is built from the same
 * migrations, so it must pass; and a deliberately wrong grant must be caught, proving the check can fail.
 */
afterAll(closePool);

const query = async (sql: string) => {
  const c = await pool.connect();
  try {
    await c.query("begin read only");
    return await c.query(sql);
  } finally {
    await c.query("rollback").catch(() => undefined);
    c.release();
  }
};
const failures = (r: { level: string; id: string; detail: string }[]) => r.filter((i) => i.level === "fail");

describe("production readiness checks against the local database", () => {
  it("pass: migrations, tables, RLS, grants, columns and functions are exactly as intended", async () => {
    const r = await checkDatabase(query, { expectedMigrations: expectedMigrations(), expectedMigrationNames: expectedMigrationNames(), platformFunctionsAllowed: [] });
    expect(failures(r), JSON.stringify(failures(r))).toEqual([]);
    expect(r.filter((i: { level: string }) => i.level === "pass").length).toBeGreaterThanOrEqual(8);
  });

  it("the check can actually fail: a function that anon may execute is reported", async () => {
    await q("create function public.zz_readiness_probe() returns int language sql as 'select 1'");
    try {
      await q("grant execute on function public.zz_readiness_probe() to anon");
      const r = await checkDatabase(query, { expectedMigrations: expectedMigrations(), expectedMigrationNames: expectedMigrationNames(), platformFunctionsAllowed: [] });
      expect(failures(r).map((i: { id: string }) => i.id)).toContain("anon can execute no public function");
    } finally {
      await q("drop function if exists public.zz_readiness_probe()");
    }
    const after = await checkDatabase(query, { expectedMigrations: expectedMigrations(), expectedMigrationNames: expectedMigrationNames(), platformFunctionsAllowed: [] });
    expect(failures(after)).toEqual([]);
  });

  it("the read-only transaction refuses a write (so the check could not change anything even if it tried)", async () => {
    await expect(query("create table public.zz_nope (a int)")).rejects.toThrow(/read-only/i);
  });

  it("the anonymous Data API check passes against the local API", async () => {
    const r = await checkRestSurface({ url: process.env.SUPABASE_API_URL, anonKey: process.env.SUPABASE_ANON_KEY });
    expect(failures(r), JSON.stringify(failures(r))).toEqual([]);
  });
});
