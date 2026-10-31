import { q, resetRateLimits } from "./helpers";

/** Counters persist between runs; every run starts with a clean budget. */
export default async function globalSetup() {
  await resetRateLimits();
  await q("select 1");
}
