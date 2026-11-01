import "@/tests/mocks";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { dispatchGuided, startGuidedSession } from "@/features/guided/store/actions";
import { getGuidedSnapshot, guidedLocalStorage, resetGuidedStoreCache, setGuidedPersistence } from "@/features/guided/store/store";
import { buildLocalCopy } from "@/features/sync/local-export";
import { setStorageScope } from "@/lib/scope/storage-scope";
import { getSnapshot } from "@/lib/storage/store";
import { playQuestions, resetApp } from "@/tests/helpers";
import { applyTransfer, NotGuestError, previewTransfer } from "./apply";
import { DEFAULT_SOURCE_ORIGIN, DEFAULT_TARGET_ORIGIN, safeOrigin, transferEnabled, transferOrigins } from "./config";
import { MAX_TRANSFER_BYTES, parseDeviceCopyText, parseIncoming, transferMessageFor } from "./protocol";
import { ReceivePanel } from "./ReceivePanel";
import { SendPanel } from "./SendPanel";

const SOURCE = "http://localhost:3105";
const TARGET = "http://localhost:3100";
const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

/** progress that exists "on the old address": built with the real stores, then lifted out as plain data. */
function oldAddressProgress() {
  resetApp();
  setGuidedPersistence(guidedLocalStorage);
  resetGuidedStoreCache();
  playQuestions(8);
  startGuidedSession({ now: 1_800_000_000_000, id: "gg" });
  dispatchGuided("gg", { type: "EDIT", draft: "I have watched a film yesterday evening." }, { now: 1_800_000_000_001, aiAvailable: true });
  const copy = buildLocalCopy();
  return { lessons: JSON.parse(JSON.stringify(copy.lessons)), guided: JSON.parse(JSON.stringify(copy.guided)) };
}
const raw = () => JSON.stringify({ ...window.localStorage });

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_TRANSFER_SOURCE_ORIGIN", SOURCE);
  vi.stubEnv("NEXT_PUBLIC_TRANSFER_TARGET_ORIGIN", TARGET);
  vi.stubEnv("NEXT_PUBLIC_GUEST_TRANSFER", "on");
  window.localStorage.clear();
  setStorageScope("");
  Object.defineProperty(window, "opener", { configurable: true, value: null });
  Object.defineProperty(window, "location", { configurable: true, value: { ...window.location, origin: TARGET } });
});

describe("configuration", () => {
  it("is off unless the switch is exactly 'on'", () => {
    for (const v of [undefined, "", "ON", "true", "1"]) { vi.stubEnv("NEXT_PUBLIC_GUEST_TRANSFER", v as string); expect(transferEnabled(), String(v)).toBe(false); }
    vi.stubEnv("NEXT_PUBLIC_GUEST_TRANSFER", "on");
    expect(transferEnabled()).toBe(true);
  });
  it("accepts only https (or http on localhost) origins with no path or credentials, otherwise falls back to the defaults", () => {
    expect(transferOrigins()).toEqual({ source: SOURCE, target: TARGET });
    expect(safeOrigin("https://grammigo.si/path?x=1", "d")).toBe("https://grammigo.si");
    for (const bad of ["http://grammigo.si", "javascript:alert(1)", "https://u:p@grammigo.si", "not a url", "", undefined, "ftp://x.y"]) expect(safeOrigin(bad as string, "d"), String(bad)).toBe("d");
    vi.stubEnv("NEXT_PUBLIC_TRANSFER_TARGET_ORIGIN", "http://evil.example");
    expect(transferOrigins().target).toBe(DEFAULT_TARGET_ORIGIN);
    vi.stubEnv("NEXT_PUBLIC_TRANSFER_SOURCE_ORIGIN", "");
    expect(transferOrigins().source).toBe(DEFAULT_SOURCE_ORIGIN);
  });
});

describe("what is accepted", () => {
  it("a genuine message and a genuine device-copy file", () => {
    const p = oldAddressProgress();
    const m = parseIncoming(transferMessageFor(p.lessons, p.guided));
    expect(m.ok && m.value.lessons.sessions).toHaveLength(1);
    expect(m.ok && m.value.guided.sessions).toHaveLength(1);
    const f = parseDeviceCopyText(JSON.stringify(buildLocalCopy()));
    expect(f.ok && f.value.lessons.sessions).toHaveLength(1);
  });
  it("nothing else: wrong shape, extra keys, wrong version, garbage content, nothing to bring, oversize, or a newer app's data", () => {
    const p = oldAddressProgress();
    const good = transferMessageFor(p.lessons, p.guided);
    for (const bad of [null, undefined, "x", 5, [], {}, { ...good, v: 2 }, { ...good, app: "other" }, { ...good, type: "ack" }, { ...good, extra: 1 }, { ...good, lessons: "no" }, { ...good, lessons: { version: 2, sessions: "x" } }, { ...good, lessons: null }])
      expect(parseIncoming(bad as never).ok, JSON.stringify(bad)?.slice(0, 60)).toBe(false);
    expect(parseIncoming({ ...good, guided: { version: 99, sessions: [] } })).toEqual({ ok: false, reason: "newer_app" });
    expect(parseIncoming({ ...good, guided: { version: 1, sessions: "x" } }).ok).toBe(false);
    expect(parseIncoming({ ...good, pad: "x".repeat(MAX_TRANSFER_BYTES) } as never)).toEqual({ ok: false, reason: "too_large" });
    expect(parseDeviceCopyText("x".repeat(MAX_TRANSFER_BYTES + 1))).toEqual({ ok: false, reason: "too_large" });
    for (const bad of ["not json", "{}", JSON.stringify({ format: "other", version: 1 }), JSON.stringify({ format: "grammigo-device-copy", version: 2, lessons: p.lessons })]) expect(parseDeviceCopyText(bad).ok, bad.slice(0, 40)).toBe(false);
    expect(parseIncoming({ app: "grammigo", type: "transfer", v: 1, lessons: p.lessons, guided: null }).ok).toBe(true); // a guest with no Guided activity
  });
  it("circular or unserialisable data is refused, not thrown", () => {
    const a: Record<string, unknown> = {};
    a.self = a;
    expect(parseIncoming(a)).toEqual({ ok: false, reason: "unreadable" });
  });
});

describe("applying (only to the guest's own folder, as a lossless union)", () => {
  it("previews without writing, then adds; adding twice changes nothing more; what was already here is kept", () => {
    const p = oldAddressProgress();
    const incoming = (parseIncoming(transferMessageFor(p.lessons, p.guided)) as { ok: true; value: Parameters<typeof applyTransfer>[0] }).value;
    window.localStorage.clear();
    resetApp();
    setGuidedPersistence(guidedLocalStorage);
    resetGuidedStoreCache();
    playQuestions(3); // the new address already has its own guest lesson in progress
    const own = getSnapshot().sessions.map((s) => s.id);
    const before = raw();
    const prev = previewTransfer(incoming);
    expect(raw()).toBe(before);
    expect(prev).toMatchObject({ newLessonsCompleted: 1, newGuidedSessions: 1, alreadyThere: 0, nothingNew: false });
    applyTransfer(incoming);
    expect(getSnapshot().sessions).toHaveLength(2);
    expect(getSnapshot().sessions.map((s) => s.id)).toEqual(expect.arrayContaining(own));
    expect(getGuidedSnapshot().sessions).toHaveLength(1);
    const once = raw();
    applyTransfer(incoming);
    expect(raw()).toBe(once);
    expect(previewTransfer(incoming)).toMatchObject({ nothingNew: true, alreadyThere: 2 });
  });
  it("refuses, and writes nothing, while a signed-in account's folder is active", () => {
    const p = oldAddressProgress();
    const incoming = (parseIncoming(transferMessageFor(p.lessons, p.guided)) as { ok: true; value: Parameters<typeof applyTransfer>[0] }).value;
    window.localStorage.clear();
    setStorageScope(A);
    resetApp();
    const before = raw();
    expect(() => applyTransfer(incoming)).toThrow(NotGuestError);
    expect(raw()).toBe(before);
  });
});

/** A stand-in for the window the receiver opens. */
function fakePopup() {
  return { postMessage: vi.fn(), closed: false } as unknown as Window & { postMessage: ReturnType<typeof vi.fn> };
}
const deliver = (data: unknown, origin: string, source: unknown) => act(() => void window.dispatchEvent(new MessageEvent("message", { data, origin, source: source as MessageEventSource })));

describe("the receiving page (new address)", () => {
  async function ready() {
    const p = oldAddressProgress();
    window.localStorage.clear();
    resetApp();
    setGuidedPersistence(guidedLocalStorage);
    resetGuidedStoreCache();
    const popup = fakePopup();
    const open = vi.spyOn(window, "open").mockReturnValue(popup);
    const user = userEvent.setup();
    render(<ReceivePanel />);
    return { p, popup, open, user, msg: transferMessageFor(p.lessons, p.guided) };
  }

  it("does nothing until the learner presses the button: no window opened, no listener acting, nothing written", async () => {
    const { open, msg, popup } = await ready();
    const before = raw();
    await deliver(msg, SOURCE, popup);
    expect(open).not.toHaveBeenCalled();
    expect(screen.queryByTestId("transfer-preview")).toBeNull();
    expect(raw()).toBe(before);
  });

  it("opens the OLD address's send page (and only that), and then waits", async () => {
    const { user, open } = await ready();
    await user.click(screen.getByTestId("transfer-begin"));
    expect(open).toHaveBeenCalledWith(`${SOURCE}/transfer/send`, "grammigo-transfer", expect.any(String));
    expect(String(open.mock.calls[0][2])).not.toMatch(/noopener|noreferrer/); // the old page needs its opener to answer
    expect(screen.getByTestId("transfer-waiting")).toBeInTheDocument();
  });

  it("ignores a message from the wrong origin, or from the right origin but another window, and shows no preview", async () => {
    const { user, msg, popup } = await ready();
    await user.click(screen.getByTestId("transfer-begin"));
    await deliver(msg, "https://evil.example", popup);
    await deliver(msg, TARGET, popup); // our own origin posting to itself
    await deliver(msg, SOURCE, fakePopup()); // right origin, but not the window we opened
    await deliver(msg, SOURCE, null);
    expect(screen.queryByTestId("transfer-preview")).toBeNull();
    expect(screen.getByTestId("transfer-waiting")).toBeInTheDocument();
  });

  it("shows a plain message for a bad payload from the right window, and keeps waiting", async () => {
    const { user, popup } = await ready();
    await user.click(screen.getByTestId("transfer-begin"));
    await deliver({ app: "grammigo", type: "transfer", v: 1, lessons: "garbage", guided: null }, SOURCE, popup);
    expect(screen.getByTestId("transfer-problem")).toHaveTextContent(/couldn’t read|isn’t progress/);
    expect(screen.queryByTestId("transfer-preview")).toBeNull();
  });

  it("a good message shows a PREVIEW and writes nothing; confirming writes to the guest folder, acknowledges to exactly the old origin, and later messages are ignored", async () => {
    const { user, msg, popup } = await ready();
    await user.click(screen.getByTestId("transfer-begin"));
    const before = raw();
    await deliver(msg, SOURCE, popup);
    expect(screen.getByTestId("transfer-preview-text")).toHaveTextContent("New to this device: 1 lesson finished, 1 Guided Correction session.");
    expect(raw()).toBe(before);
    expect(popup.postMessage).not.toHaveBeenCalled();
    await user.click(screen.getByTestId("transfer-confirm"));
    await waitFor(() => expect(screen.getByTestId("transfer-done")).toBeInTheDocument());
    expect(getSnapshot().sessions).toHaveLength(1);
    expect(getGuidedSnapshot().sessions).toHaveLength(1);
    expect(popup.postMessage).toHaveBeenCalledTimes(1);
    expect(popup.postMessage).toHaveBeenCalledWith({ app: "grammigo", type: "ack", v: 1 }, SOURCE); // never "*"
    const after = raw();
    await deliver(msg, SOURCE, popup);
    expect(raw()).toBe(after);
  });

  it("'Not now' leaves everything exactly as it was", async () => {
    const { user, msg, popup } = await ready();
    await user.click(screen.getByTestId("transfer-begin"));
    const before = raw();
    await deliver(msg, SOURCE, popup);
    await user.click(screen.getByTestId("transfer-cancel"));
    expect(raw()).toBe(before);
    expect(screen.getByTestId("transfer-begin")).toBeInTheDocument();
  });

  it("explains a blocked pop-up and offers the file instead", async () => {
    const { user, open } = await ready();
    open.mockReturnValue(null);
    await user.click(screen.getByTestId("transfer-begin"));
    expect(screen.getByTestId("transfer-problem")).toHaveTextContent(/blocked/);
    expect(screen.getByTestId("transfer-file")).toBeInTheDocument();
  });

  it("the file fallback shows the same preview and the same confirm step", async () => {
    const { user } = await ready();
    playQuestions(8); // the "old address" copy: made after render so the panel's own state is unaffected
    const text = JSON.stringify(buildLocalCopy());
    window.localStorage.clear();
    resetApp();
    const before = raw();
    await user.upload(screen.getByTestId("transfer-file"), new File([text], "copy.json", { type: "application/json" }));
    await waitFor(() => expect(screen.getByTestId("transfer-preview")).toBeInTheDocument());
    expect(raw()).toBe(before);
    await user.click(screen.getByTestId("transfer-confirm"));
    expect(getSnapshot().sessions).toHaveLength(1);
    expect(screen.getByTestId("transfer-done")).toBeInTheDocument();
  });

  it("a wrong file gets a plain message and changes nothing", async () => {
    const { user } = await ready();
    const before = raw();
    await user.upload(screen.getByTestId("transfer-file"), new File(["{\"hello\":1}"], "x.json", { type: "application/json" }));
    await waitFor(() => expect(screen.getByTestId("transfer-problem")).toBeInTheDocument());
    expect(raw()).toBe(before);
  });

  it("a signed-in learner is asked to sign out first; nothing can be added to their account's folder", async () => {
    setStorageScope(A);
    render(<ReceivePanel />);
    expect(screen.getByTestId("transfer-signed-in")).toBeInTheDocument();
    expect(screen.queryByTestId("transfer-begin")).toBeNull();
  });

  it("on the wrong address it just points to the right one", async () => {
    Object.defineProperty(window, "location", { configurable: true, value: { ...window.location, origin: SOURCE } });
    render(<ReceivePanel />);
    expect(await screen.findByTestId("transfer-wrong-place")).toBeInTheDocument();
    expect(screen.queryByTestId("transfer-begin")).toBeNull();
  });
});

describe("the sending page (old address)", () => {
  beforeEach(() => Object.defineProperty(window, "location", { configurable: true, value: { ...window.location, origin: SOURCE } }));

  it("reads the guest progress, changes nothing, and sends only on the button, to exactly the new origin, to its opener", async () => {
    oldAddressProgress();
    const opener = { postMessage: vi.fn() };
    Object.defineProperty(window, "opener", { configurable: true, value: opener });
    const before = raw();
    const user = userEvent.setup();
    render(<SendPanel />);
    expect(await screen.findByTestId("transfer-send-summary")).toHaveTextContent("1 lesson finished, 1 Guided Correction session");
    expect(opener.postMessage).not.toHaveBeenCalled();
    await user.click(screen.getByTestId("transfer-send-button"));
    expect(opener.postMessage).toHaveBeenCalledTimes(1);
    const [data, targetOrigin] = opener.postMessage.mock.calls[0];
    expect(targetOrigin).toBe(TARGET);
    expect(data).toMatchObject({ app: "grammigo", type: "transfer", v: 1 });
    expect(parseIncoming(data).ok).toBe(true);
    expect(raw()).toBe(before); // the guest copy is untouched
  });

  it("reports 'arrived' only for an acknowledgement from the new origin, from its opener", async () => {
    oldAddressProgress();
    const opener = { postMessage: vi.fn() };
    Object.defineProperty(window, "opener", { configurable: true, value: opener });
    const user = userEvent.setup();
    render(<SendPanel />);
    await user.click(await screen.findByTestId("transfer-send-button"));
    const ack = { app: "grammigo", type: "ack", v: 1 };
    await deliver(ack, "https://evil.example", opener);
    await deliver(ack, TARGET, { other: true });
    expect(screen.queryByTestId("transfer-arrived")).toBeNull();
    await deliver({ ...ack, v: 2 }, TARGET, opener);
    expect(screen.queryByTestId("transfer-arrived")).toBeNull();
    await deliver(ack, TARGET, opener);
    expect(screen.getByTestId("transfer-arrived")).toBeInTheDocument();
  });

  it("cannot send without an opener (opened directly), without progress, or from the wrong address, and says what to do", async () => {
    oldAddressProgress();
    render(<SendPanel />);
    expect(await screen.findByTestId("transfer-send-button")).toBeDisabled();
    expect(screen.getByTestId("transfer-no-opener")).toBeInTheDocument();
  });

  it("with no guest progress there is nothing to send", async () => {
    resetApp();
    Object.defineProperty(window, "opener", { configurable: true, value: { postMessage: vi.fn() } });
    render(<SendPanel />);
    expect(await screen.findByTestId("transfer-send-summary")).toHaveTextContent("no guest progress");
    expect(screen.getByTestId("transfer-send-button")).toBeDisabled();
  });

  it("on the new address it does not offer to send to itself", async () => {
    Object.defineProperty(window, "location", { configurable: true, value: { ...window.location, origin: TARGET } });
    render(<SendPanel />);
    expect(await screen.findByTestId("transfer-wrong-place")).toBeInTheDocument();
    expect(screen.queryByTestId("transfer-send-button")).toBeNull();
  });
});
