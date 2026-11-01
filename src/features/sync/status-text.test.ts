import { describe, expect, it } from "vitest";
import type { SyncPhase, SyncStatus } from "./engine";
import { describeStatus } from "./status-text";

const st = (phase: SyncPhase, over: Partial<SyncStatus> = {}): SyncStatus => ({ phase, unsaved: false, lastSyncedAt: 1, nextAttemptAt: null, paused: false, ...over });
const ago = () => "2 min ago";

describe("what the learner is told about saving", () => {
  it("'Saved to your account' appears ONLY when a save has finished and nothing has changed since", () => {
    expect(describeStatus(st("idle"), ago)).toMatchObject({ label: "Saved to your account", tone: "success", detail: "Last saved 2 min ago." });
    const everythingElse: SyncStatus[] = [
      st("idle", { unsaved: true }),
      st("idle", { lastSyncedAt: null }),
      st("syncing"),
      st("offline"),
      st("retrying"),
      st("needs_signin"),
      st("needs_consent"),
      st("too_large"),
      st("blocked"),
      st("off"),
      st("idle", { paused: true }),
    ];
    for (const s of everythingElse) expect(describeStatus(s, ago).label, JSON.stringify(s)).not.toBe("Saved to your account");
    expect(describeStatus(null, ago).label).not.toBe("Saved to your account");
  });

  it("is honest in every other state: safe on this device, and what is happening to the online copy", () => {
    expect(describeStatus(null, ago)).toMatchObject({ label: "Progress on this device" });
    expect(describeStatus(st("needs_consent"), ago).detail).toMatch(/not saved online/);
    expect(describeStatus(st("offline"), ago).detail).toMatch(/saved on this device and will go to your account/);
    expect(describeStatus(st("retrying"), ago).detail).toMatch(/Nothing is lost/);
    expect(describeStatus(st("needs_signin"), ago).detail).toMatch(/Sign in again/);
    expect(describeStatus(st("blocked"), ago).detail).toMatch(/Nothing was changed/);
    expect(describeStatus(st("syncing"), ago).detail).toMatch(/keep learning/);
  });

  it("never uses level, score or mastery wording", () => {
    const all = (["idle", "syncing", "offline", "retrying", "needs_signin", "needs_consent", "too_large", "blocked", "off"] as SyncPhase[]).flatMap((p) => {
      const v = describeStatus(st(p), ago);
      return [v.label, v.detail];
    });
    expect(all.filter((t) => /\b(mastery|level|score|grade|proficien\w*)\b/i.test(t))).toEqual([]);
  });
});
