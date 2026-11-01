import "@/tests/mocks";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { AppShell } from "@/components/layout/AppShell";
import { setStorageScope } from "@/lib/scope/storage-scope";
import { AccountEntry } from "./AccountEntry";

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
afterEach(() => vi.unstubAllEnvs());
const on = () => vi.stubEnv("NEXT_PUBLIC_ACCOUNTS", "on");

describe("account entry in the app header", () => {
  it("accounts OFF (the default): renders nothing at all, in the entry and in the shared page shell", () => {
    const { container } = render(<AccountEntry />);
    expect(container).toBeEmptyDOMElement();
    render(<AppShell><p>page</p></AppShell>);
    expect(screen.queryByRole("link", { name: /sign in|account/i })).not.toBeInTheDocument();
    expect(screen.queryByTestId("account-entry")).not.toBeInTheDocument();
  });

  it("a guest gets a plain, labelled 'Sign in' link; nothing else about the app changes", () => {
    on();
    render(<AppShell><p>page</p></AppShell>);
    const link = screen.getByRole("link", { name: "Sign in" });
    expect(link).toHaveAttribute("href", "/signin");
    expect(screen.getByRole("navigation", { name: "Account" })).toContainElement(link);
    expect(screen.getByText("page")).toBeInTheDocument();
    // the usual navigation is still there and still works without an account
    expect(screen.getAllByRole("link", { name: /Practice/ })[0]).toHaveAttribute("href", "/library");
  });

  it("someone signed in on this device gets 'Account', pointing at their account", () => {
    on();
    setStorageScope(A);
    render(<AccountEntry />);
    const link = screen.getByRole("link", { name: "Account" });
    expect(link).toHaveAttribute("href", "/account");
    expect(screen.queryByRole("link", { name: "Sign in" })).not.toBeInTheDocument();
  });

  it("follows the browser when it switches learner, with no reload", () => {
    on();
    render(<AccountEntry />);
    expect(screen.getByRole("link", { name: "Sign in" })).toBeInTheDocument();
    act(() => setStorageScope(A));
    expect(screen.getByRole("link", { name: "Account" })).toBeInTheDocument();
    act(() => setStorageScope(""));
    expect(screen.getByRole("link", { name: "Sign in" })).toBeInTheDocument();
  });

  it("makes no network request and writes nothing, so it can never get in the way of learning", () => {
    on();
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const before = JSON.stringify({ ...window.localStorage });
    render(<AccountEntry />);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(JSON.stringify({ ...window.localStorage })).toBe(before);
    vi.unstubAllGlobals();
  });

  it("is reachable by keyboard and large enough to tap", () => {
    on();
    render(<AccountEntry />);
    const link = screen.getByRole("link", { name: "Sign in" });
    link.focus();
    expect(link).toHaveFocus();
    expect(link.className).toMatch(/min-h-11/);
  });
});
