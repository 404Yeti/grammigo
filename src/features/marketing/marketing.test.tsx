import "@/tests/mocks";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { router } from "@/tests/helpers";
import { MarketingHome, faq } from "./MarketingHome";
import { hasUsedGrammigoHere, ReturningRedirect } from "./ReturningRedirect";

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  window.localStorage.clear();
  router.replace.mockClear?.();
});

describe("the public front page", () => {
  it("has every section of the design, in order, each with a heading and a way to reach it from the menu", () => {
    vi.stubEnv("NEXT_PUBLIC_ACCOUNTS", "on");
    render(<MarketingHome />);
    expect(screen.getByRole("heading", { level: 1, name: "Better grammar. Your way." })).toBeInTheDocument();
    for (const [id, title] of [["how-it-works", "How it works"], ["features", "Built around how you learn"], ["about", "About Grammigo"], ["faq", "Questions, answered"]] as const) {
      const section = document.getElementById(id);
      expect(section, id).not.toBeNull();
      expect(within(section as HTMLElement).getByRole("heading", { level: 2, name: title })).toBeInTheDocument();
      expect(document.querySelector(`a[href="/#${id}"]`), `menu link to #${id}`).not.toBeNull();
    }
    expect(screen.getAllByRole("link", { name: /Get started/ })[0]).toHaveAttribute("href", "/learn");
    expect(screen.getByRole("link", { name: "Privacy" })).toHaveAttribute("href", "/privacy");
    expect(screen.getByRole("link", { name: "Terms" })).toHaveAttribute("href", "/terms");
  });

  it("makes NO claim about speaking, voice, a number of exercise types, a number of grammar areas, prices or user counts (until those are real)", () => {
    vi.stubEnv("NEXT_PUBLIC_ACCOUNTS", "on");
    const { container } = render(<MarketingHome />);
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/speak|spoken|speech|voice|push-to-talk|microphone|listen|pronunciation/i);
    expect(text).not.toMatch(/\b(eight|8|ten|twelve|fourteen|14)\s+(exercise|grammar|question)/i);
    expect(text).not.toMatch(/\bfree\b|testimonial|\d[\d,]*\s+(learners|students|users)|★|rating|\$\d|€\d|£\d/i);
    expect(text).toMatch(/Pricing hasn’t been announced yet/);
  });

  it("with accounts ON offers Sign in and tells the truth about invitations; with accounts OFF shows no sign-in link and no mention of accounts being available", () => {
    vi.stubEnv("NEXT_PUBLIC_ACCOUNTS", "on");
    const on = render(<MarketingHome />);
    expect(screen.getAllByRole("link", { name: "Sign in" }).length).toBeGreaterThan(0);
    expect(on.container.textContent).toMatch(/by invitation/);
    cleanup();
    vi.stubEnv("NEXT_PUBLIC_ACCOUNTS", "");
    const off = render(<MarketingHome />);
    expect(screen.queryAllByRole("link", { name: /sign in|account/i })).toHaveLength(0);
    expect(off.container.textContent).not.toMatch(/by invitation/);
    expect(faq(false).map((f) => f.a).join(" ")).not.toMatch(/export or delete|invitation/);
  });

  it("the phone menu is a plain disclosure with its links (no script needed), and every FAQ answer is a disclosure too", () => {
    render(<MarketingHome />);
    const menu = screen.getByTestId("site-menu");
    expect(menu.tagName).toBe("DETAILS");
    expect(within(menu).getByRole("link", { name: "FAQ" })).toHaveAttribute("href", "/#faq");
    expect(document.querySelectorAll("#faq details")).toHaveLength(faq(false).length);
  });
});

describe("someone who has used Grammigo on this device", () => {
  const fake = (keys: string[]) => ({ length: keys.length, key: (i: number) => keys[i] ?? null });

  it("is recognised by saved practice or an account session, and a corrupt-data marker alone does not count", () => {
    expect(hasUsedGrammigoHere(fake(["grammigo:v2"]), "")).toBe(true);
    expect(hasUsedGrammigoHere(fake(["grammigo:v2:u:abc"]), "")).toBe(true);
    expect(hasUsedGrammigoHere(fake([]), "a=1; __Host-gm-scope=abc")).toBe(true);
    expect(hasUsedGrammigoHere(fake([]), "gm-scope=abc")).toBe(true);
    expect(hasUsedGrammigoHere(fake(["grammigo:v2:corrupt"]), "")).toBe(false);
    expect(hasUsedGrammigoHere(fake(["other", "theme"]), "x=1")).toBe(false);
  });

  it("is sent to /learn from the bare address (old bookmarks keep working); a first-time visitor is not", () => {
    render(<ReturningRedirect />);
    expect(router.replace).not.toHaveBeenCalled();
    cleanup();
    window.localStorage.setItem("grammigo:v2", "{}");
    render(<ReturningRedirect />);
    expect(router.replace).toHaveBeenCalledWith("/learn");
  });
});
