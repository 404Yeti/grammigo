// @vitest-environment node
import { describe, expect, it } from "vitest";
import { activitySession } from "@/tests/activity-fixtures";
import { emptyState, parseStoredState } from "@/lib/storage/schema";
import { mergeLessons } from "@/features/sync/merge";
import { learningActivity, monthWeeks, shiftMonth } from "./calendar";

const at = Date.parse;
const sessions = (...dates: string[]) => dates.map((date, i) => activitySession(String(i), at(date)));
const stats = (dates: string[], now: string, zone = "UTC") => learningActivity(sessions(...dates), at(now), zone);

describe("real completed activity", () => {
  it("deduplicates local days and ignores unfinished, abandoned, missing, invalid and future completions", () => {
    const now = at("2026-11-03T12:00:00Z");
    const records = [
      ...sessions("2026-11-02T10:00Z", "2026-11-02T23:00Z", "2026-11-03T10:00Z", "2026-11-03T13:00Z", "2026-12-01T00:00Z"),
      activitySession("unfinished", at("2026-11-01T12:00Z"), "in_progress"),
      activitySession("abandoned", at("2026-10-31T12:00Z"), "abandoned"),
      activitySession("no-date", null), activitySession("bad-date", NaN), activitySession("infinite", Infinity),
    ];
    expect(learningActivity(records, now, "UTC")).toMatchObject({ totalActiveDays: 2, currentStreak: 2, longestStreak: 2, firstMonth: "2026-11" });
    expect([...learningActivity(records, now, "UTC").activeDates]).toEqual(["2026-11-02", "2026-11-03"]);
  });
  it("has an honest empty state", () => {
    expect(learningActivity([], at("2026-11-03T12:00Z"), "UTC")).toMatchObject({ today: "2026-11-03", firstMonth: "2026-11", totalActiveDays: 0, currentStreak: 0, longestStreak: 0 });
  });
  it("counts a streak ending today or yesterday, and expires it after a missed calendar day", () => {
    const dates = ["2026-11-01T12:00Z", "2026-11-02T12:00Z"];
    expect(stats(dates, "2026-11-02T23:59Z").currentStreak).toBe(2);
    expect(stats(dates, "2026-11-03T23:59Z").currentStreak).toBe(2);
    expect(stats(dates, "2026-11-04T00:00Z").currentStreak).toBe(0);
  });
  it("finds the longest historical run despite gaps, repeated lessons and unordered records", () => {
    const result = stats(["2024-01-06T12:00Z", "2024-01-02T12:00Z", "2024-01-03T12:00Z", "2024-01-01T12:00Z", "2024-01-05T12:00Z", "2024-01-02T14:00Z"], "2026-11-03T12:00Z");
    expect(result).toMatchObject({ totalActiveDays: 5, currentStreak: 0, longestStreak: 3, firstMonth: "2024-01" });
  });
});

describe("local dates, timezone changes and daylight saving", () => {
  it("splits a UTC date at the learner's actual local midnight", () => {
    const r = stats(["2024-03-10T07:59Z", "2024-03-10T08:01Z"], "2024-03-10T20:00Z", "America/Los_Angeles");
    expect([...r.activeDates]).toEqual(["2024-03-09", "2024-03-10"]);
    expect(r.currentStreak).toBe(2);
  });
  it.each([
    ["America/Los_Angeles", ["2024-03-09T20:00Z", "2024-03-10T19:00Z", "2024-03-11T19:00Z"], "2024-03-11T23:00Z"],
    ["America/Los_Angeles", ["2024-11-02T19:00Z", "2024-11-03T20:00Z", "2024-11-04T20:00Z"], "2024-11-04T23:00Z"],
    ["Europe/Ljubljana", ["2024-03-30T11:00Z", "2024-03-31T10:00Z", "2024-04-01T10:00Z"], "2024-04-01T20:00Z"],
    ["Europe/Ljubljana", ["2024-10-26T10:00Z", "2024-10-27T11:00Z", "2024-10-28T11:00Z"], "2024-10-28T20:00Z"],
  ])("keeps consecutive dates across 23/25-hour days in %s", (zone, dates, now) => {
    expect(stats(dates, now, zone)).toMatchObject({ totalActiveDays: 3, currentStreak: 3, longestStreak: 3 });
  });
  it("counts repeated fall-back hours once", () => {
    expect(stats(["2024-11-03T08:30Z", "2024-11-03T09:30Z"], "2024-11-03T23:00Z", "America/Los_Angeles").totalActiveDays).toBe(1);
  });
  it("reprojects all history consistently on a timezone change without rewriting timestamps", () => {
    const records = sessions("2026-11-03T00:30Z", "2026-11-03T23:30Z");
    const original = JSON.stringify(records); const now = at("2026-11-04T12:00Z");
    expect(learningActivity(records, now, "UTC").totalActiveDays).toBe(1);
    expect(learningActivity(records, now, "America/Los_Angeles")).toMatchObject({ totalActiveDays: 2, currentStreak: 2 });
    expect([...learningActivity(records, now, "Pacific/Kiritimati").activeDates]).toEqual(["2026-11-03", "2026-11-04"]);
    expect(learningActivity(records, now, "UTC").totalActiveDays).toBe(1);
    expect(JSON.stringify(records)).toBe(original);
  });
  it("continues across month, leap-day and year boundaries", () => {
    expect(stats(["2024-02-28T12:00Z", "2024-02-29T12:00Z", "2024-03-01T12:00Z"], "2024-03-01T20:00Z").currentStreak).toBe(3);
    expect(stats(["2025-12-31T12:00Z", "2026-01-01T12:00Z"], "2026-01-01T20:00Z").currentStreak).toBe(2);
  });
});

it("preserves migrated v1 completion history through validated storage and account merge", () => {
  const records = sessions("2023-12-31T23:30Z", "2024-01-01T12:00Z");
  const migrated = parseStoredState(JSON.stringify({ version: 1, sessions: records, activeSessionId: null }))!;
  const merged = mergeLessons(emptyState(), migrated);
  expect(merged.sessions).toEqual(records);
  expect(learningActivity(merged.sessions, at("2026-11-03T12:00Z"), "UTC")).toMatchObject({ firstMonth: "2023-12", totalActiveDays: 2, longestStreak: 2 });
});

it("lays out Gregorian leap months and rolls month navigation over year boundaries", () => {
  for (const [month, days] of [["2024-02", 29], ["2023-02", 28], ["2000-02", 29], ["2100-02", 28]] as const) {
    const weeks = monthWeeks(month);
    expect(weeks.flat().filter(Boolean)).toHaveLength(days);
    expect(weeks.every(week => week.length === 7)).toBe(true);
  }
  expect(monthWeeks("2026-11")[0]).toEqual([null, null, null, null, null, null, "2026-11-01"]);
  expect(shiftMonth("2025-12", 1)).toBe("2026-01");
  expect(shiftMonth("2026-01", -1)).toBe("2025-12");
});
