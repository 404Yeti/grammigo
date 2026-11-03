"use client";

import { useEffect, useState } from "react";

const readClock = () => ({ now: Date.now(), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC" });

/** Update at midnight, on returning to the page, and within a minute of a device timezone change. */
export function useLocalClock() {
  const [clock, setClock] = useState(readClock);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const delay = () => {
      const now = Date.now();
      const midnight = new Date(now);
      midnight.setHours(24, 0, 0, 0);
      return Math.max(1, Math.min(60_000, midnight.getTime() - now));
    };
    const refresh = () => {
      clearTimeout(timer);
      setClock(readClock());
      timer = setTimeout(refresh, delay());
    };
    const visible = () => { if (document.visibilityState === "visible") refresh(); };
    timer = setTimeout(refresh, delay());
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", visible);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", visible);
    };
  }, []);
  return clock;
}
