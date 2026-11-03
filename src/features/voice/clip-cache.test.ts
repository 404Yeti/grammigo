import "@/tests/mocks";
import { afterEach, expect, it, vi } from "vitest";
import { setStorageScope } from "@/lib/scope/storage-scope";
import { debriefClipCache } from "./clip-cache";

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
it("returns no cache when IndexedDB is unavailable", async () => {
  vi.stubGlobal("indexedDB", undefined);
  expect(await debriefClipCache("outcomes")).toBeNull();
});
it("storage denial never prevents readable completion or audio fallback", async () => {
  vi.stubGlobal("indexedDB", { open: () => { throw new Error("storage disabled"); } });
  const cache = await debriefClipCache("outcomes");
  expect(await cache!.read()).toBeUndefined();
  await expect(cache!.write(new Blob(["clip"]))).resolves.toBeUndefined();
});
it("bounds stalled storage operations so audio preparation can recover", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("indexedDB", { open: () => ({}) });
  const cache = await debriefClipCache("outcomes");
  const read = cache!.read();
  await vi.advanceTimersByTimeAsync(2000);
  expect(await read).toBeUndefined();
});

it("captures each learner namespace before asynchronous playback work", async () => {
  const open = vi.fn(() => { throw new Error("disabled"); });
  vi.stubGlobal("indexedDB", { open });
  const guest = await debriefClipCache("outcomes");
  setStorageScope("11111111-1111-4111-8111-111111111111");
  const learner = await debriefClipCache("outcomes");
  await guest!.read();
  await learner!.read();
  expect(open.mock.calls).toEqual([
    ["grammigo-debrief-v1-guest", 1],
    ["grammigo-debrief-v1-11111111-1111-4111-8111-111111111111", 1],
  ]);
});
