import { defineConfig, devices } from "@playwright/test";

/** A fake microphone for the voice tests. Chromium-only flags: other engines would refuse to start with them. */
const FAKE_MIC = ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"];
const PORT = Number(process.env.E2E_PORT ?? 3100);

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  reporter: [["list"]],
  use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure" },
  webServer: {
    command: `npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 600_000,
  },
  projects: [
    { name: "mobile", use: { ...devices["Pixel 7"], browserName: "chromium", launchOptions: { args: FAKE_MIC } } },
    { name: "desktop", use: { viewport: { width: 1440, height: 900 }, browserName: "chromium", launchOptions: { args: FAKE_MIC } } },
    // The anonymous learning paths tagged @cross also run in Firefox and WebKit. Mobile Safari is WebKit with an iPhone's viewport, touch
    // and user agent: an EMULATION, not a real iPhone (see docs/dev/real-device-acceptance.md).
    { name: "firefox", use: { ...devices["Desktop Firefox"] }, grep: /@cross/ },
    { name: "webkit", use: { ...devices["Desktop Safari"] }, grep: /@cross/ },
    { name: "mobile-safari", use: { ...devices["iPhone 14"] }, grep: /@cross/ },
  ],
});
