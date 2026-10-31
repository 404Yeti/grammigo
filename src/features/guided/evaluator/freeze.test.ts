import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The evaluator rules are FROZEN for validation. If this test fails, a rule file changed.
 * That is allowed only deliberately: bump the version, write a NEW unseen set, rerun it once
 * without tuning, get the owner's approval, then regenerate FROZEN.json. Never edit the rules
 * and the hash together to make a failing sentence pass.
 */
const dir = join(process.cwd(), "src/features/guided/evaluator");
const frozen = JSON.parse(readFileSync(join(dir, "FROZEN.json"), "utf8")) as { version: string; sha256: string; files: string[] };

function hashOfRules(): string {
  const h = createHash("sha256");
  for (const f of frozen.files) {
    h.update(`${f}\n`);
    h.update(readFileSync(join(dir, f), "utf8").replace(/\r\n/g, "\n"));
    h.update("\n--\n");
  }
  return h.digest("hex");
}

describe("the evaluator is frozen", () => {
  it("lists every rule file", () => {
    expect(frozen.files).toEqual(["types.ts", "lexicon.ts", "normalize.ts", "analyze.ts", "evaluate.ts", "index.ts"]);
  });

  it("matches its recorded hash (version 1.0.0): any rule change must be deliberate and re-validated", () => {
    expect(frozen.version).toBe("1.0.0");
    expect(hashOfRules(), "Evaluator rules changed since they were frozen. See the comment at the top of this file.").toBe(frozen.sha256);
  });
});
