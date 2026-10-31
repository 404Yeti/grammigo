import { describe, expect, it } from "vitest";
import { evaluatorItem } from "./score";
import { evaluate } from "./evaluate";

/**
 * Regression tests for evaluator 1.1.0: two narrowly scoped rules for "for"/"since" followed by a CLAUSE.
 *  P1  "for I was a child"      → starting point, so "for" is wrong      (since_for_confusion)
 *  P2  "I study … since I was twelve" with no present perfect anywhere   (since_without_perfect)
 * The most important half of this file is the second describe: valid sentences with subordinate clauses must NOT be flagged.
 */
const unfinished = evaluatorItem("ppps-transfer-unfinished");
const main = evaluatorItem("ppps-main");
const experience = evaluatorItem("ppps-experience");
const verdict = (text: string, item = unfinished) => {
  const e = evaluate(item, { text, source: "typed" });
  return `${e.verdict}${e.category ? `/${e.category}` : ""}`;
};

describe("1.1.0: the original failures are now caught", () => {
  it.each([
    ["I have learned English for I was a child.", "incorrect/since_for_confusion"],
    ["I study English since I was twelve.", "incorrect/since_without_perfect"],
    ["I speak English since I was a child.", "incorrect/since_without_perfect"],
    ["I played the piano since I was seven.", "incorrect/since_without_perfect"],
    ["I have been learning English for we moved here.", "incorrect/since_for_confusion"],
    ["I live in this city since I started university.", "incorrect/since_without_perfect"],
    ["I am learning English since I came to London.", "incorrect/since_without_perfect"],
  ])("%s → %s", (text, expected) => expect(verdict(text)).toBe(expected));

  it("works for spoken-style transcripts too (judged identically)", () => {
    const e = evaluate(unfinished, { text: "um i study english since i was twelve", source: "spoken" });
    expect(e).toMatchObject({ verdict: "incorrect", category: "since_without_perfect" });
  });
});

describe("1.1.0: valid subordinate-clause answers are NOT flagged", () => {
  it.each([
    "I have lived here since I was twelve.",
    "I've been learning English since I was twelve.",
    "I have studied English since I started school.",
    "Since I was twelve, I have played the piano.",
    "Since I was a child, I've loved languages.",
    "I haven't spoken French since I was twelve.",
    "It's been years since I started learning English.",
    "It has been three years since I moved here.",
    "I've known him since we were kids.",
    "I have been learning English for as long as I can remember.",
    "Since I was twelve.",
    "since i was a child",
    "Maybe since I was twelve.",
    "I don't remember exactly, since I was a child I think.",
    "I don't know, maybe since I was twelve.",
    "I started learning English when I was twelve and I still study it.",
    "I began studying English because I was curious, and I have studied it ever since.",
    "I waited for him to arrive.",
    "I did it for me and I was glad.",
    "I learned English for my job, and I was happy to start.",
    "I have been learning English for two years because I was told to.",
  ])("%s → not incorrect", (text) => expect(verdict(text)).not.toMatch(/^incorrect/));

  it("the new rules only apply where the item teaches the category (main and experience items cannot get a since/for verdict)", () => {
    for (const item of [main, experience]) {
      for (const t of ["I study English since I was twelve.", "I have learned English for I was a child."]) {
        expect(evaluate(item, { text: t, source: "typed" }).verdict, `${item.id}: ${t}`).not.toBe("incorrect");
      }
    }
  });

  it("the older behaviour is unchanged for the cases the rules were already right about", () => {
    expect(verdict("I learn English since 2020.")).toBe("incorrect/since_without_perfect");
    expect(verdict("I have been learning English since three years.")).toBe("incorrect/since_for_confusion");
    expect(verdict("I have been learning English for three years.")).toBe("correct");
    expect(verdict("I have been learning English since 2020.")).toBe("correct");
  });
});
