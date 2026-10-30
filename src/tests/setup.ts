import { afterEach } from "vitest";

// Pure-logic tests never touch the DOM; only wire up DOM helpers when a window exists.
if (typeof window !== "undefined") {
  await import("@testing-library/jest-dom/vitest");
  const { cleanup } = await import("@testing-library/react");
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
  });
}
