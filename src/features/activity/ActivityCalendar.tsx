"use client";

import { useId, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { cn } from "@/lib/utils/cn";
import type { Session } from "@/types/session";
import { learningActivity, monthWeeks, shiftMonth } from "./calendar";
import { useLocalClock } from "./use-local-clock";

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const labelDate = (date: string, options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("en-GB", { ...options, timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));

/** Read-only view of the parent's already-isolated lesson history; never writes progress. */
export function ActivityCalendar({ sessions }: { sessions: readonly Session[] }) {
  const id = useId();
  const { now, timeZone } = useLocalClock();
  const activity = learningActivity(sessions, now, timeZone);
  const currentMonth = activity.today.slice(0, 7);
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);
  const month = selectedMonth && selectedMonth >= activity.firstMonth && selectedMonth <= currentMonth ? selectedMonth : currentMonth;
  const label = labelDate(`${month}-01`, { month: "long", year: "numeric" });
  const count = [...activity.activeDates].filter(date => date.startsWith(month)).length;
  const navigationClass = "grid size-11 shrink-0 place-items-center rounded-full border border-line bg-surface hover:bg-subtle focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:opacity-40";
  return (
    <Card aria-labelledby={`${id}-title`} data-testid="activity-calendar">
      <h2 id={`${id}-title`} className="text-xl font-bold leading-7">Learning activity</h2>
      <p className="mt-1 text-sm font-medium leading-5 text-ink-2">Your completed lessons, day by day.</p>
      <dl className="mt-4 grid grid-cols-3 gap-2 text-center">
        {[
          ["Total active days", activity.totalActiveDays, "active-days"],
          ["Current streak", activity.currentStreak, "current-streak"],
          ["Longest streak", activity.longestStreak, "longest-streak"],
        ].map(([title, value, testId]) => (
          <div key={title} className="rounded-xl bg-subtle px-1 py-2">
            <dt className="min-h-8 text-xs font-medium leading-4 text-ink-2">{title}</dt>
            <dd className="mt-1 text-xl font-bold" data-testid={testId}><span>{value}</span>{" "}<span className="text-xs font-medium">{value === 1 ? "day" : "days"}</span></dd>
          </div>
        ))}
      </dl>
      <div className="mt-4 flex items-center justify-between gap-2" role="group" aria-label="Calendar navigation">
        <button type="button" className={navigationClass} aria-label="Previous month" disabled={month <= activity.firstMonth} onClick={() => setSelectedMonth(shiftMonth(month, -1))}><ChevronLeft size={18} aria-hidden /></button>
        <p className="text-center text-base font-bold" aria-live="polite" aria-atomic="true" data-testid="calendar-month">{label}</p>
        <button type="button" className={navigationClass} aria-label="Next month" disabled={month >= currentMonth} onClick={() => setSelectedMonth(shiftMonth(month, 1))}><ChevronRight size={18} aria-hidden /></button>
      </div>
      <table className="mt-2 w-full table-fixed border-separate border-spacing-1 text-center text-sm">
        <caption className="sr-only">{label}: {count} {count === 1 ? "active day" : "active days"}. Highlighted dates have a completed lesson.</caption>
        <thead><tr>{WEEKDAYS.map(day => <th key={day} scope="col" className="py-1 text-xs font-medium text-ink-2"><abbr title={day} className="no-underline">{day.slice(0, 3)}</abbr></th>)}</tr></thead>
        <tbody>{monthWeeks(month).map((week, i) => <tr key={i}>{week.map((date, j) => {
          const active = date !== null && activity.activeDates.has(date);
          const today = date === activity.today;
          return <td key={j} data-date={date ?? undefined} data-active={String(active)} className="p-0">
            {date && <div className={cn("mx-auto flex min-h-8 max-w-9 flex-col items-center justify-center rounded-lg py-1", active ? "bg-brand-soft font-bold text-brand-text" : date > activity.today ? "text-muted" : "text-ink", today && "ring-1 ring-brand")}>
              <time dateTime={date} aria-current={today ? "date" : undefined} aria-label={labelDate(date, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}>{Number(date.slice(-2))}</time>
              {active && <><span aria-hidden className="size-1 rounded-full bg-brand" /><span className="sr-only">Lesson completed</span></>}
            </div>}
          </td>;
        })}</tr>)}</tbody>
      </table>
      <div className="mt-2 flex items-center justify-between gap-2 text-xs font-medium text-ink-2">
        <span className="flex items-center gap-2"><span aria-hidden className="size-2 rounded-full bg-brand" />Lesson completed</span>
        <button type="button" disabled={month === currentMonth} onClick={() => setSelectedMonth(null)} className="min-h-11 px-2 font-bold text-brand-text underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-brand disabled:text-muted disabled:no-underline">This month</button>
      </div>
      {count === 0 && <p className="mt-1 text-sm leading-5 text-ink-2">{activity.totalActiveDays === 0 ? "Finish a lesson and Migo will mark your first active day." : "No lessons completed this month."}</p>}
      <p className="mt-3 text-xs leading-4 text-muted">A streak through yesterday stays current until today ends. Dates, including past lessons, use your current timezone: {timeZone.replaceAll("_", " ")}.</p>
    </Card>
  );
}
