import { describe, expect, it, vi } from "vitest";
import { getStorageScope, isValidScope, onScopeChange, scopedKey, setStorageScope } from "./storage-scope";

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

describe("storage scope", () => {
  it("is the guest by default, and the guest's keys are exactly the original keys", () => {
    expect(getStorageScope()).toBe("");
    expect(scopedKey("grammigo:v2")).toBe("grammigo:v2");
    expect(scopedKey("grammigo:guided:v1")).toBe("grammigo:guided:v1");
  });

  it("gives every account its own keys, none equal to the guest's or to each other's", () => {
    const keys = new Set([scopedKey("grammigo:v2", ""), scopedKey("grammigo:v2", A), scopedKey("grammigo:v2", B)]);
    expect(keys.size).toBe(3);
    expect(scopedKey("grammigo:v2", A)).toBe(`grammigo:v2:u:${A}`);
  });

  it("refuses anything that is not an account id, so a key can never be built from arbitrary text", () => {
    for (const bad of ["x", "../etc", "grammigo:v2", `${A};`, A.toUpperCase(), ` ${A}`, `${A}:u:${B}`, "a".repeat(200)]) {
      expect(isValidScope(bad), bad).toBe(false);
      expect(() => setStorageScope(bad)).toThrow();
    }
    expect(getStorageScope()).toBe("");
  });

  it("tells listeners once per real change, and never for a no-op", () => {
    const fn = vi.fn();
    const off = onScopeChange(fn);
    setStorageScope(A);
    setStorageScope(A);
    expect(fn).toHaveBeenCalledTimes(1);
    setStorageScope("");
    expect(fn).toHaveBeenCalledTimes(2);
    off();
    setStorageScope(B);
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
