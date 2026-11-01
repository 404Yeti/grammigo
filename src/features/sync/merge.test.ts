import { describe, expect, it } from "vitest";
import { createRun } from "@/features/diagnostic/engine";
import { createSession } from "@/features/practice/session";
import { emptyState } from "@/lib/storage/schema";
import { lesson } from "@/tests/helpers";
import type { Session, StoredState } from "@/types/session";
import { canonical, hashDocument } from "./canonical";
import { adoptLessons, containsAll, mergeLessons, normalizeLessons } from "./merge";

/** A small seeded generator, so a failure can be reproduced exactly from its seed. */
function rng(seed: number) {
  let t = seed >>> 0;
  const next = () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
  return { next, int: (n: number) => Math.floor(next() * n), pick: <T>(a: readonly T[]) => a[Math.floor(next() * a.length)], chance: (p: number) => next() < p };
}

const POOL = Array.from({ length: 6 }, (_, i) => `s${i}`);

function randomSession(r: ReturnType<typeof rng>, id: string): Session {
  const started = 1_000 + POOL.indexOf(id) * 100; // the same session starts at the same time on every device
  const s = createSession(lesson, id, started);
  const status = r.pick(["in_progress", "completed", "abandoned"] as const);
  const updatedAt = started + r.int(50);
  return { ...s, status, updatedAt, lastActiveAt: updatedAt, completedAt: status === "completed" ? updatedAt : null, currentIndex: status === "completed" ? 7 : r.int(7), phase: status === "completed" ? "feedback" : "answering" };
}

function randomState(r: ReturnType<typeof rng>): StoredState {
  const s = emptyState();
  const ids = POOL.filter(() => r.chance(0.55));
  const sessions = ids.map((id) => randomSession(r, id));
  const open = sessions.filter((x) => x.status === "in_progress");
  const active = open.length ? r.pick(open).id : null;
  const status = r.pick(["not_started", "skipped", "in_progress", "completed"] as const);
  const at = r.int(500);
  const runs = ["r0", "r1", "r2"].filter(() => r.chance(0.5)).map((id, i) => ({ ...createRun(id, [], 2_000 + i * 10), finishedAt: r.chance(0.6) ? 2_100 + r.int(20) : null }));
  return {
    ...s,
    sessions,
    activeSessionId: active,
    onboarding: { ...s.onboarding, status, startedAt: status === "not_started" ? null : at, completedAt: status === "completed" ? at + 1 : null },
    goals: r.chance(0.5) ? { text: r.pick(["a", "b", "c"]), source: "typed", goals: [], skillIds: [], extractedBy: "local", updatedAt: r.int(100) } : null,
    diagnosticRuns: runs,
    lastRecommendation: r.chance(0.5) ? { skillId: r.pick(["a1-articles", "a2-past-simple"]), kind: "new", at: r.int(100) } : null,
    writingFeedback: r.chance(0.4) ? { [`${r.pick(POOL)}:q1`]: { status: "ready", at: r.int(50), explanation: r.pick(["x", "y"]) } } : {},
  };
}

const same = (a: StoredState, b: StoredState) => canonical(a) === canonical(b);
const SEEDS = Array.from({ length: 400 }, (_, i) => i + 1);

describe("merging lesson progress (randomised, 400 seeded cases each)", () => {
  it("is commutative: which device merges first does not matter", () => {
    for (const seed of SEEDS) {
      const r = rng(seed);
      const a = randomState(r);
      const b = randomState(r);
      expect(same(mergeLessons(a, b), mergeLessons(b, a)), `seed ${seed}`).toBe(true);
    }
  });

  it("is idempotent: merging again with anything already merged changes nothing (so a retried or repeated save is harmless)", () => {
    for (const seed of SEEDS) {
      const r = rng(seed);
      const a = randomState(r);
      const b = randomState(r);
      const m = mergeLessons(a, b);
      expect(same(mergeLessons(m, m), m), `seed ${seed} self`).toBe(true);
      expect(same(mergeLessons(m, a), m), `seed ${seed} with a`).toBe(true);
      expect(same(mergeLessons(m, b), m), `seed ${seed} with b`).toBe(true);
      expect(same(mergeLessons(a, a), mergeLessons(mergeLessons(a, a), a)), `seed ${seed} a`).toBe(true);
    }
  });

  it("is associative: three devices reach the same result in any grouping", () => {
    for (const seed of SEEDS) {
      const r = rng(seed);
      const a = randomState(r);
      const b = randomState(r);
      const c = randomState(r);
      expect(same(mergeLessons(mergeLessons(a, b), c), mergeLessons(a, mergeLessons(b, c))), `seed ${seed}`).toBe(true);
    }
  });

  it("loses nothing: every session and quick-check run from either copy is in the result", () => {
    for (const seed of SEEDS) {
      const r = rng(seed);
      const a = randomState(r);
      const b = randomState(r);
      const m = mergeLessons(a, b);
      expect(containsAll(m, a) && containsAll(m, b), `seed ${seed}`).toBe(true);
      const writing = new Set(Object.keys(m.writingFeedback));
      for (const k of [...Object.keys(a.writingFeedback), ...Object.keys(b.writingFeedback)]) expect(writing.has(k), `seed ${seed} ${k}`).toBe(true);
    }
  });

  it("finished work is never replaced by unfinished work", () => {
    for (const seed of SEEDS) {
      const r = rng(seed);
      const a = randomState(r);
      const b = randomState(r);
      for (const m of [mergeLessons(a, b), adoptLessons(a, b)]) for (const src of [a, b]) for (const s of src.sessions.filter((x) => x.status === "completed")) expect(m.sessions.find((x) => x.id === s.id)?.status, `seed ${seed} ${s.id}`).toBe("completed");
    }
  });

  it("ADOPTING a merge (the union, tidied) leaves at most one session in progress, and it is the active one", () => {
    for (const seed of SEEDS) {
      const r = rng(seed);
      const m = adoptLessons(randomState(r), randomState(r));
      const open = m.sessions.filter((s) => s.status === "in_progress");
      expect(open.length, `seed ${seed}`).toBeLessThanOrEqual(1);
      expect(m.activeSessionId, `seed ${seed}`).toBe(open[0]?.id ?? null);
    }
  });

  it("adopting is stable, and syncing again changes nothing (so an interrupted or repeated sync converges)", () => {
    for (const seed of SEEDS) {
      const r = rng(seed);
      const a = randomState(r);
      const b = randomState(r);
      const adopted = adoptLessons(a, b);
      expect(same(adoptLessons(adopted, b), adopted), `seed ${seed} again with b`).toBe(true);
      expect(same(adoptLessons(adopted, a), adopted), `seed ${seed} again with a`).toBe(true);
      expect(same(adoptLessons(adopted, adopted), adopted), `seed ${seed} with itself`).toBe(true);
      expect(same(normalizeLessons(adopted, adopted.activeSessionId), adopted), `seed ${seed} normalising twice`).toBe(true);
    }
  });

  it("adopting never takes away the lesson this device is in the middle of, and every device ends with the SAME evidence whichever unfinished lesson it keeps open", () => {
    let both = 0;
    // everything mastery is derived from, and everything else that is saved, EXCEPT which unfinished lesson is currently open
    const evidence = (s: StoredState) =>
      canonical({ done: s.sessions.filter((x) => x.status === "completed"), answers: s.sessions.map((x) => [x.id, x.records]), runs: s.diagnosticRuns, onboarding: s.onboarding, goals: s.goals, rec: s.lastRecommendation, fb: s.writingFeedback });
    for (const seed of SEEDS) {
      const r = rng(seed);
      const a = randomState(r);
      const b = randomState(r);
      const union = mergeLessons(a, b);
      const adoptedByA = adoptLessons(a, b);
      const adoptedByB = adoptLessons(b, a);
      for (const [mine, adopted] of [[a, adoptedByA], [b, adoptedByB]] as const) {
        const own = mine.sessions.find((s) => s.id === mine.activeSessionId && s.status === "in_progress");
        // still in progress in the union? (the other device may hold a newer copy that finished or closed it)
        if (own && union.sessions.find((s) => s.id === own.id)?.status === "in_progress") expect(adopted.activeSessionId, `seed ${seed}`).toBe(own.id);
        expect(adopted.sessions.filter((s) => s.status === "in_progress").length).toBeLessThanOrEqual(1);
      }
      if (adoptedByA.activeSessionId !== adoptedByB.activeSessionId) both++;
      expect(evidence(adoptedByA), `seed ${seed}: same evidence on both devices`).toBe(evidence(adoptedByB));
      expect(adoptedByA.sessions.map((s) => s.id)).toEqual(adoptedByB.sessions.map((s) => s.id)); // and the very same set of sessions
    }
    expect(both).toBeGreaterThan(5); // the case where the two devices keep different lessons open really was exercised
  });

  it("a quick-check run that finished on one device is not replaced by an unfinished copy of it", () => {
    const a = { ...emptyState(), diagnosticRuns: [{ ...createRun("r", [], 1), finishedAt: 50 }] };
    const b = { ...emptyState(), diagnosticRuns: [createRun("r", [], 1)] };
    expect(mergeLessons(a, b).diagnosticRuns[0].finishedAt).toBe(50);
    expect(mergeLessons(b, a).diagnosticRuns[0].finishedAt).toBe(50);
  });

  it("the more recent onboarding decision wins, including a retake", () => {
    const base = emptyState();
    const done = { ...base, onboarding: { ...base.onboarding, status: "completed" as const, startedAt: 10, completedAt: 20 } };
    const retake = { ...base, onboarding: { ...base.onboarding, status: "in_progress" as const, startedAt: 90, completedAt: null } };
    expect(mergeLessons(done, retake).onboarding.status).toBe("in_progress");
    expect(mergeLessons(retake, done).onboarding.status).toBe("in_progress");
    expect(mergeLessons(done, base).onboarding.status).toBe("completed");
  });

  it("merging with an empty copy returns the other copy unchanged (a new device does not erase anything)", () => {
    for (const seed of SEEDS.slice(0, 100)) {
      const a = mergeLessons(randomState(rng(seed)), emptyState());
      expect(same(mergeLessons(a, emptyState()), a), `seed ${seed}`).toBe(true);
      expect(same(mergeLessons(emptyState(), a), a), `seed ${seed}`).toBe(true);
    }
  });

  it("two devices that each finished a DIFFERENT lesson end up with both", () => {
    const phone = { ...emptyState(), sessions: [{ ...createSession(lesson, "phone", 100), status: "completed" as const, completedAt: 200, updatedAt: 200 }] };
    const laptop = { ...emptyState(), sessions: [{ ...createSession(lesson, "laptop", 150), status: "completed" as const, completedAt: 300, updatedAt: 300 }] };
    const m = mergeLessons(phone, laptop);
    expect(m.sessions.map((s) => s.id).sort()).toEqual(["laptop", "phone"]);
    expect(m.sessions.every((s) => s.status === "completed")).toBe(true);
  });
});

describe("change detection", () => {
  it("the hash ignores key order and notices any real change", () => {
    expect(hashDocument({ a: 1, b: { c: 2, d: 3 } })).toBe(hashDocument({ b: { d: 3, c: 2 }, a: 1 }));
    expect(hashDocument({ a: 1 })).not.toBe(hashDocument({ a: 2 }));
    expect(hashDocument({ a: [1, 2] })).not.toBe(hashDocument({ a: [2, 1] }));
  });
});
