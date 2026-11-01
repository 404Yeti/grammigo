// @vitest-environment node
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as lib from "../../../scripts/backup/lib.mjs";
import { insideGitTree, onWindowsDrive } from "../../../scripts/backup/backup.mjs";

const PASS = "correct horse battery staple 42";
const sample = () => {
  const tables: Record<string, unknown[]> = {};
  const sha256: Record<string, string> = {};
  for (const [s, t] of lib.TABLES) {
    const rows = s === "auth" && t === "users" ? [{ id: "u1", email: "ana.secret@example.test" }] : [];
    tables[`${s}.${t}`] = rows;
    sha256[`${s}.${t}`] = createHash("sha256").update(JSON.stringify(rows)).digest("hex");
  }
  return { format: "grammigo-backup", version: 1, createdAt: "2026-11-02T00:00:00Z", migrations: [], counts: {}, sha256, tables };
};

describe("the backup file", () => {
  it("opens with the passphrase and gives back exactly what was sealed", () => {
    const d = sample();
    expect(lib.open(lib.seal(d, PASS), PASS)).toEqual(d);
  });
  it("is ENCRYPTED: no email address or field name can be found in the file", () => {
    const text = lib.seal(sample(), PASS).toString("latin1");
    for (const needle of ["ana.secret", "example.test", "grammigo-backup", "auth.users", "email"]) expect(text, needle).not.toContain(needle);
  });
  it("refuses a wrong passphrase, a changed byte, a truncated file and a file that is not a backup", () => {
    const file = lib.seal(sample(), PASS);
    expect(() => lib.open(file, "another passphrase entirely")).toThrow(/wrong passphrase|damaged/);
    const flipped = Buffer.from(file);
    flipped[flipped.length - 5] ^= 0xff;
    expect(() => lib.open(flipped, PASS)).toThrow(/damaged/);
    expect(() => lib.open(file.subarray(0, 40), PASS)).toThrow();
    expect(() => lib.open(Buffer.from("hello world, definitely not a backup file at all, no way"), PASS)).toThrow(/not a Grammigo backup/);
  });
  it("two backups of the same data differ (fresh salt and nonce each time)", () => {
    expect(lib.seal(sample(), PASS).equals(lib.seal(sample(), PASS))).toBe(false);
  });
  it("needs a real passphrase", () => {
    expect(() => lib.seal(sample(), "short")).toThrow(/16 characters/);
    expect(() => lib.seal(sample(), undefined as never)).toThrow();
  });
  it("is checked row by row: an edited table is refused even with the right passphrase", () => {
    const d = sample();
    expect(lib.verifyBackup(d)).toBe(true);
    (d.tables["auth.users"] as { email: string }[])[0].email = "someone.else@example.test";
    expect(() => lib.verifyBackup(d)).toThrow(/checksum/);
    const missing = sample();
    delete missing.tables["public.profiles"];
    expect(() => lib.verifyBackup(missing)).toThrow(/no public.profiles/);
    expect(() => lib.verifyBackup({ format: "other" })).toThrow(/not a Grammigo backup/);
  });
});

describe("where a backup may be written", () => {
  it("never inside a git working tree", () => {
    expect(insideGitTree(path.resolve(__dirname, "../../.."))).toBe(true);
    expect(insideGitTree(path.resolve(__dirname))).toBe(true);
    const outside = mkdtempSync(path.join(tmpdir(), "gm-backup-"));
    try { expect(insideGitTree(outside)).toBe(false); } finally { rmSync(outside, { recursive: true }); }
  });
  it("not on a Windows drive, where file permissions are not enforced", () => {
    expect(onWindowsDrive("/mnt/c/Users/me/backups/x.gmbackup")).toBe(true);
    expect(onWindowsDrive("/mnt/d")).toBe(true);
    for (const ok of ["/home/me/grammigo-backups/x.gmbackup", "/tmp/x", "/mnt", "/mnt/wsl/x", "/mount/c/x"]) expect(onWindowsDrive(ok), ok).toBe(false);
  });
  it("*.gmbackup files are ignored by git, so an accidental `git add .` cannot pick one up", () => {
    expect(readFileSync(path.resolve(__dirname, "../../../.gitignore"), "utf8")).toMatch(/^\*\.gmbackup$/m);
  });
  it("the tools never print a row, a passphrase or a connection string", () => {
    for (const f of ["backup.mjs", "restore.mjs"]) {
      const src = readFileSync(path.resolve(__dirname, "../../../scripts/backup", f), "utf8");
      for (const m of src.matchAll(/console\.(log|error)\(([^;]*)\);/g)) expect(m[2], m[0]).not.toMatch(/\burl\b|\bpass\b|process\.env|\.rows\b|\bdata\.tables\b/);
    }
  });
});

describe("restore refuses what it should (fake database)", () => {
  const fake = (counts: Record<string, number>) => {
    const log: string[] = [];
    return { log, query: async (sql: string) => { log.push(sql.trim().split(/\s+/)[0].toLowerCase()); const m = /from "(\w+)"\."(\w+)"/.exec(sql); return { rows: [{ n: counts[`${m?.[1]}.${m?.[2]}`] ?? 0, c: "x", ident: "NO", name: "x" }] }; } };
  };
  it("a target that already has rows: nothing is written and the transaction is rolled back", async () => {
    const f = fake({ "public.profiles": 3 });
    await expect(lib.restoreAll(f, sample())).rejects.toThrow(/refusing to restore: public.profiles already has 3/);
    expect(f.log).not.toContain("insert");
    expect(f.log).toContain("rollback");
    expect(f.log).not.toContain("commit");
  });
  it("a damaged backup is refused before the database is touched at all", async () => {
    const f = fake({});
    const d = sample();
    d.sha256["auth.users"] = "0".repeat(64);
    await expect(lib.restoreAll(f, d)).rejects.toThrow(/checksum/);
    expect(f.log).toEqual([]);
  });
});
