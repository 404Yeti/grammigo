import "@/tests/mocks";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { RECOVERY_TOKEN } from "@/lib/auth/recovery-token";
import { CLIENT_RECOVERY_TOKEN, ResetForm } from "./ResetForm";

const TOKEN = ["pkce", "0123456789abcdef".repeat(4)].join("_");
afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
});

describe("the reset page", () => {
  it("accepts exactly the token shape the server accepts", () => {
    expect(CLIENT_RECOVERY_TOKEN.source).toBe(RECOVERY_TOKEN.source);
    expect(CLIENT_RECOVERY_TOKEN.flags).toBe(RECOVERY_TOKEN.flags);
  });
  it("reads the one-time token from the URL fragment, removes it from the address bar at once, and posts it in a form body", async () => {
    window.history.replaceState(null, "", `/auth/reset#token_hash=${TOKEN}`);
    render(<ResetForm />);
    const form = await screen.findByTestId("reset-form");
    expect(form.getAttribute("method")).toBe("post");
    expect(form.getAttribute("action")).toBe("/api/auth/recover");
    expect((form.querySelector('input[name="token_hash"]') as HTMLInputElement).value).toBe(TOKEN);
    expect(window.location.hash).toBe(""); // gone from the address bar and the history entry
    expect(window.location.href).not.toContain(TOKEN);
  });
  it.each(["", "#token_hash=", "#token_hash=short", "#token_hash=has spaces and <script>", "#other=1"])("an incomplete or malformed link (%j) shows a plain notice and no form", async (hash) => {
    window.history.replaceState(null, "", `/auth/reset${hash}`);
    render(<ResetForm />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/isn’t complete/);
    expect(screen.queryByTestId("reset-form")).toBeNull();
  });
});
