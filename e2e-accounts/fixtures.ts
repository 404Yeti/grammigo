import { test as base, expect } from "@playwright/test";
import { uniqueIp } from "./helpers";

/**
 * - Every browser context gets its own client address, so rate-limit budgets are never shared between tests.
 * - `request` is the context's own request object, so it shares cookies with the page (the default `request` fixture does not).
 */
export const test = base.extend({
  context: async ({ context }, provide) => {
    await context.setExtraHTTPHeaders({ "x-real-ip": uniqueIp() });
    await provide(context);
  },
  request: async ({ context }, provide) => {
    await provide(context.request);
  },
});
export { expect };
