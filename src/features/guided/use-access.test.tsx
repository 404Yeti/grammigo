import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { setStorageScope } from "@/lib/scope/storage-scope";
import { useGuidedAccess } from "./use-access";
afterEach(() => { cleanup(); setStorageScope(""); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
it("drops a previous owner's affordance immediately when account scope changes, and ignores late results", async () => {
  vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("NEXT_PUBLIC_GUIDED_PREVIEW", "true");
  let resolve!: (value: unknown) => void;
  const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ allowed: false }) }).mockResolvedValueOnce({ ok: true, json: async () => ({ allowed: true }) }).mockImplementationOnce(() => new Promise(r => { resolve = r; }));
  vi.stubGlobal("fetch", fetcher);
  act(() => setStorageScope("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"));
  const { result } = renderHook(() => useGuidedAccess());
  await waitFor(() => expect(result.current).toBe(true));
  act(() => setStorageScope("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"));
  expect(result.current).toBe(false);
  act(() => setStorageScope(""));
  await act(async () => resolve({ ok: true, json: async () => ({ allowed: true }) }));
  expect(result.current).toBe(false);
});
