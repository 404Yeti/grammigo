import type { Session } from "@/types/session";

const DAY_MS = 86_400_000;
const ordinal = (date: string) => Date.parse(`${date}T00:00:00Z`) / DAY_MS;

/** Shared completion rule for the calendar and Progress. Never infer a missing completion date. */
export function hasCompletedActivity(session: Session, now: number): boolean {
  const at = session.completedAt;
  return session.status === "completed" && at !== null && Number.isFinite(at) && at <= now && Number.isFinite(new Date(at).getTime());
}

/** All instants, including historical ones, are projected into the viewer's CURRENT timezone. */
export function learningActivity(sessions: readonly Session[], now: number, timeZone: string) {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone, calendar: "gregory", numberingSystem: "latn", year: "numeric", month: "2-digit", day: "2-digit",
  });
  const dateKey = (at: number) => {
    const parts = formatter.formatToParts(at);
    const part = (name: string) => parts.find(p => p.type === name)!.value;
    return `${part("year").padStart(4, "0")}-${part("month")}-${part("day")}`;
  };
  const today = dateKey(now);
  const activeDates = new Set<string>();
  for (const session of sessions) {
    const at = session.completedAt;
    if (!hasCompletedActivity(session, now) || at === null) continue;
    activeDates.add(dateKey(at));
  }
  const dates = [...activeDates].sort();
  let longestStreak = 0;
  let run = 0;
  let previous = -Infinity;
  // These are date-only ordinals, NOT elapsed-time intervals between local midnights.
  for (const date of dates) {
    const day = ordinal(date);
    run = day === previous + 1 ? run + 1 : 1;
    longestStreak = Math.max(longestStreak, run);
    previous = day;
  }
  const days = new Set(dates.map(ordinal));
  let end = ordinal(today);
  if (!days.has(end)) end--;
  let currentStreak = 0;
  while (days.has(end--)) currentStreak++;
  return { today, activeDates, totalActiveDays: dates.length, currentStreak, longestStreak, firstMonth: dates[0]?.slice(0, 7) ?? today.slice(0, 7) };
}

export function shiftMonth(month: string, delta: number): string {
  const date = new Date(`${month}-01T12:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + delta);
  return date.toISOString().slice(0, 7);
}

/** Monday-first calendar, padded with non-date cells, using UTC only to lay out date labels. */
export function monthWeeks(month: string): (string | null)[][] {
  const first = new Date(`${month}-01T12:00:00Z`);
  const last = new Date(first);
  last.setUTCMonth(last.getUTCMonth() + 1, 0);
  const offset = (first.getUTCDay() + 6) % 7;
  const length = Math.ceil((offset + last.getUTCDate()) / 7) * 7;
  const cells = Array.from({ length }, (_, i) => {
    const day = i - offset + 1;
    return day < 1 || day > last.getUTCDate() ? null : `${month}-${String(day).padStart(2, "0")}`;
  });
  return Array.from({ length: length / 7 }, (_, i) => cells.slice(i * 7, i * 7 + 7));
}
