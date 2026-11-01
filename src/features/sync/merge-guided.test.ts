import { beforeEach, describe, expect, it } from "vitest";
import { startGuidedSession } from "@/features/guided/store/actions";
import { emptyGuidedState } from "@/features/guided/store/schema";
import { getGuidedSnapshot, guidedLocalStorage, resetGuidedStoreCache, setGuidedPersistence, updateGuided } from "@/features/guided/store/store";
import type { GuidedState } from "@/types/guided";
import { canonical } from "./canonical";
import { adoptGuided, guidedContainsAll, mergeGuided, normalizeGuided } from "./merge-guided";

function rng(seed: number) {
  let t = seed >>> 0;
  const next = () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
  return { next, int: (n: number) => Math.floor(next() * n), chance: (p: number) => next() < p };
}
const POOL = ["g0", "g1", "g2", "g3", "g4"];

/** A guided document built through the REAL store, so every session has the real saved shape. */
function randomGuided(seed: number): GuidedState {
  const r = rng(seed);
  resetGuidedStoreCache();
  window.localStorage.clear();
  for (const id of POOL.filter(() => r.chance(0.55))) startGuidedSession({ now: 1_000 + POOL.indexOf(id) * 100, id });
  updateGuided((s) => {
    const sessions = s.sessions.map((x) => {
      const status = (["in_progress", "completed", "abandoned"] as const)[r.int(3)];
      const updatedAt = x.startedAt + r.int(50);
      return { ...x, status, updatedAt, completedAt: status === "completed" ? updatedAt : null, stage: status === "in_progress" ? x.stage : ("done" as const) };
    });
    return { ...s, sessions, activeSessionId: sessions.find((x) => x.status === "in_progress")?.id ?? null };
  });
  const copy = JSON.parse(JSON.stringify(getGuidedSnapshot())) as GuidedState;
  resetGuidedStoreCache();
  window.localStorage.clear();
  return copy;
}

const same = (a: GuidedState, b: GuidedState) => canonical(a) === canonical(b);
const SEEDS = Array.from({ length: 150 }, (_, i) => i + 1);

beforeEach(() => {
  setGuidedPersistence(guidedLocalStorage);
  resetGuidedStoreCache();
});

describe("merging Guided Correction activity (randomised, seeded)", () => {
  it("is commutative, idempotent and associative", () => {
    for (const seed of SEEDS) {
      const a = randomGuided(seed);
      const b = randomGuided(seed + 1000);
      const c = randomGuided(seed + 2000);
      expect(same(mergeGuided(a, b), mergeGuided(b, a)), `seed ${seed} commutes`).toBe(true);
      expect(same(mergeGuided(mergeGuided(a, b), b), mergeGuided(a, b)), `seed ${seed} idempotent`).toBe(true);
      expect(same(mergeGuided(mergeGuided(a, b), c), mergeGuided(a, mergeGuided(b, c))), `seed ${seed} associates`).toBe(true);
    }
  });

  it("loses nothing, and finished sessions are never replaced by unfinished ones", () => {
    for (const seed of SEEDS) {
      const a = randomGuided(seed);
      const b = randomGuided(seed + 1000);
      const m = mergeGuided(a, b);
      expect(guidedContainsAll(m, a) && guidedContainsAll(m, b), `seed ${seed}`).toBe(true);
      for (const src of [a, b]) for (const s of src.sessions.filter((x) => x.status === "completed")) expect(m.sessions.find((x) => x.id === s.id)?.status).toBe("completed");
    }
  });

  it("adopting is stable and order-independent, with at most one session in progress", () => {
    for (const seed of SEEDS) {
      const a = randomGuided(seed);
      const b = randomGuided(seed + 1000);
      const adopted = adoptGuided(a, b);
      expect(same(adoptGuided(b, a), adopted), `seed ${seed} commutes`).toBe(true);
      expect(same(adoptGuided(adopted, a), adopted) && same(adoptGuided(adopted, b), adopted), `seed ${seed} stable`).toBe(true);
      expect(same(normalizeGuided(adopted), adopted), `seed ${seed} normalise twice`).toBe(true);
      expect(adopted.sessions.filter((s) => s.status === "in_progress").length).toBeLessThanOrEqual(1);
    }
  });

  it("merging with an empty history changes nothing", () => {
    const a = adoptGuided(randomGuided(7), emptyGuidedState());
    expect(same(adoptGuided(a, emptyGuidedState()), a)).toBe(true);
    expect(same(adoptGuided(emptyGuidedState(), a), a)).toBe(true);
  });
});
