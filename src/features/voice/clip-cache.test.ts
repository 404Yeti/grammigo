import "@/tests/mocks";
import { afterEach, expect, it, vi } from "vitest";
import { webcrypto } from "node:crypto";
import { debriefClipCache } from "./clip-cache";
import { setStorageScope } from "@/lib/scope/storage-scope";
afterEach(() => { vi.unstubAllGlobals(); setStorageScope(""); });
it("persists clips across cache handles, isolates learners and bounds storage", async () => {
  vi.stubGlobal("crypto", webcrypto);
  const stores = new Map<string, Map<string, Response>>();
  vi.stubGlobal("caches", { open: async (name: string) => {
    const data = stores.get(name) ?? new Map<string, Response>(); stores.set(name, data);
    return { match: async (key: string) => data.get(key)?.clone(), put: async (key: string, r: Response) => { data.set(key, r); }, keys: async () => [...data.keys()], delete: async (key: string) => data.delete(key) };
  } });
  const first = await debriefClipCache("saved outcomes");
  await first!.write(new Blob(["clip"]));
  expect(await (await (await debriefClipCache("saved outcomes"))!.read())!.text()).toBe("clip");
  for (let i = 0; i < 26; i++) await (await debriefClipCache(String(i)))!.write(new Blob(["clip"]));
  expect([...stores.values()][0].size).toBe(24);
  setStorageScope("11111111-1111-4111-8111-111111111111");
  expect(await (await debriefClipCache("25"))!.read()).toBeUndefined();
});
it("degrades harmlessly when browser cache storage fails", async () => {
  vi.stubGlobal("crypto", webcrypto);
  vi.stubGlobal("caches", { open: async () => { throw new Error("storage disabled"); } });
  expect(await debriefClipCache("outcomes")).toBeNull();
});
