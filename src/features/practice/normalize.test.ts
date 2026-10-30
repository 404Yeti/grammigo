import { describe, expect, it } from "vitest";
import { answersMatch, normalizeAnswer } from "./normalize";

describe("normalizeAnswer", () => {
  it("ignores case, extra whitespace and punctuation by default", () => {
    expect(normalizeAnswer("  I  SAW that film, yesterday! ")).toBe("i saw that film yesterday");
  });

  it("unifies curly quotes and expands unambiguous contractions", () => {
    expect(normalizeAnswer("I’ve learned English")).toBe("i have learned english");
    expect(normalizeAnswer("I’m still learning")).toBe("i am still learning");
    expect(normalizeAnswer("He hasn't left")).toBe("he has not left");
  });

  it("does not guess at ambiguous 's", () => {
    expect(normalizeAnswer("He's left")).toBe("he s left");
  });

  it("can keep case and punctuation when they are the skill being tested", () => {
    expect(normalizeAnswer("Hello, World.", { caseSensitive: true, keepPunctuation: true })).toBe("Hello, World.");
    expect(answersMatch("hello", ["Hello"], { caseSensitive: true })).toBe(false);
    expect(answersMatch("Hello", ["Hello"], { caseSensitive: true })).toBe(true);
  });

  it("never matches an empty answer", () => {
    expect(answersMatch("   ", [""])).toBe(false);
  });
});
