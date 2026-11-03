import "@/tests/mocks";
import { afterEach, expect, it, vi } from "vitest";
import { setStorageScope } from "@/lib/scope/storage-scope";
import { debriefClipCache } from "./clip-cache";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); sessionStorage.clear(); });
it("retains the latest bounded clip across handles when IndexedDB is unavailable", async () => {
  vi.stubGlobal("indexedDB", undefined);
  const first = await debriefClipCache("outcomes");
  await first.write(new Blob(["clip"], { type: "audio/mpeg" }));
  const response = await (await debriefClipCache("outcomes")).read();
  expect(await response!.text()).toBe("clip");
  await first.write(new Blob(["x".repeat(768_001)], { type: "audio/mpeg" }));
  expect(await (await first.read())!.text()).toBe("clip");
  await (await debriefClipCache("new lesson")).write(new Blob(["new"], { type: "audio/mpeg" }));
  expect(await first.read()).toBeUndefined();
  setStorageScope("11111111-1111-4111-8111-111111111111");
  expect(await (await debriefClipCache("new lesson")).read()).toBeUndefined();
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

it("preserves lesson progress and returns harmlessly when both audio stores deny writes", async () => {
  localStorage.setItem("grammigo:v2", "saved lesson progress");
  vi.stubGlobal("indexedDB", { open: () => { throw new Error("disabled"); } });
  vi.stubGlobal("sessionStorage", { getItem: () => null, setItem: () => { throw new Error("quota"); } });
  const cache = await debriefClipCache("outcomes");
  await expect(cache.write(new Blob(["clip"], { type: "audio/mpeg" }))).resolves.toBeUndefined();
  expect(await cache.read()).toBeUndefined();
  expect(localStorage.getItem("grammigo:v2")).toBe("saved lesson progress");
});
