// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const SRC = join(process.cwd(), "src");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : /\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}

const files = walk(SRC).filter((f) => !/\.test\.(ts|tsx)$/.test(f));
const text = (f: string) => readFileSync(f, "utf8");

describe("API key hygiene", () => {
  it("OPENAI_API_KEY is only read in the server-side config module", () => {
    const readers = files.filter((f) => /OPENAI_API_KEY/.test(text(f)));
    expect(readers.map((f) => f.replace(SRC, ""))).toEqual(["/lib/ai/config.ts"]);
  });

  it("no NEXT_PUBLIC variable carries AI secrets", () => {
    for (const f of files) expect(text(f), f).not.toMatch(/NEXT_PUBLIC_[A-Z_]*(OPENAI|AI_|UPSTASH|KEY|SECRET|TOKEN)/);
  });

  it("client components never import server-only AI code", () => {
    const client = files.filter((f) => /^\s*["']use client["']/m.test(text(f)));
    expect(client.length).toBeGreaterThan(0);
    for (const f of client) {
      expect(text(f), f).not.toMatch(/from ["']openai["']|@\/lib\/ai\/|@\/features\/ai\/(service|handlers|deps)/);
    }
  });

  it("no file hard-codes something shaped like an API key", () => {
    for (const f of files) expect(text(f), f).not.toMatch(/sk-[A-Za-z0-9_-]{20,}/);
  });

  it("the openai SDK is imported only by server modules", () => {
    const importers = files.filter((f) => /from ["']openai["']/.test(text(f))).map((f) => f.replace(SRC, ""));
    expect(importers.sort()).toEqual(["/features/ai/deps.ts", "/features/ai/service.ts"]);
  });
});
