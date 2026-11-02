import { afterEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "./route";
const mocks = vi.hoisted(() => ({ gate: vi.fn(), viewer: vi.fn() }));
vi.mock("next/server", async original => ({ ...await original<typeof import("next/server")>(), connection: async () => {} }));
vi.mock("@/lib/auth/http", () => ({ authGate: mocks.gate, runtimeFor: () => ({ rt: { session: {} }, cookies: {} }), privateJson: (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Cache-Control": "private, no-store" } }), withCookies: (response: Response) => response }));
vi.mock("@/lib/auth/viewer", () => ({ getViewer: mocks.viewer }));
afterEach(() => { vi.unstubAllEnvs(); vi.resetAllMocks(); });
const request = () => new NextRequest("https://example.test/api/guided/access");
it("production public flag fails closed for disabled accounts, guests, students, suspended users and outages", async () => {
  vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("VERCEL_ENV", "production");
  vi.stubEnv("NEXT_PUBLIC_GUIDED_PREVIEW", "true"); vi.stubEnv("GUIDED_PUBLIC_PREVIEW", "true");
  mocks.gate.mockResolvedValue({ ok: false });
  expect(await (await GET(request())).json()).toEqual({ allowed: false });
  mocks.gate.mockResolvedValue({ ok: true, config: {} });
  for (const viewer of [{ kind: "anonymous" }, { kind: "no_profile" }, { kind: "unavailable" }, { kind: "learner", isAdmin: false }]) {
    mocks.viewer.mockResolvedValue(viewer);
    expect(await (await GET(request())).json()).toEqual({ allowed: false });
  }
  mocks.viewer.mockRejectedValue(new Error("service unavailable"));
  expect(await (await GET(request())).json()).toEqual({ allowed: false });
});
it("only a fresh verified active owner gets a private production preview response", async () => {
  vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("VERCEL_ENV", "production"); vi.stubEnv("NEXT_PUBLIC_GUIDED_PREVIEW", "true");
  mocks.gate.mockResolvedValue({ ok: true, config: {} }); mocks.viewer.mockResolvedValue({ kind: "learner", isAdmin: true });
  const result = await GET(request());
  expect(await result.json()).toEqual({ allowed: true });
  expect(result.headers.get("cache-control")).toContain("no-store");
  expect(mocks.viewer).toHaveBeenCalledOnce();
});
