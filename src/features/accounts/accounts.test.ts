// @vitest-environment node
import { describe, expect, it } from "vitest";
import { listTopics } from "@/curriculum";
import { codeFromHash, expiryText, inviteLink, statusOf, usedPercent, type InvitationRow } from "./invitation-status";
import { DEFAULT_PREFERENCES, errorCodes, MAX_PRACTISING, parsePreferences, PROFILE_ERRORS, profileUpdateSchema, toRow } from "./profile";

const topics = listTopics();
const schema = profileUpdateSchema(topics);
const ok = { displayName: "Ana", firstLanguage: null, practising: [] as string[], dailyMinutes: 10 };

describe("profile update schema", () => {
  it("accepts a normal update and normalises the name", () => {
    const r = schema.parse({ ...ok, displayName: "  Ana   María  ", firstLanguage: "  Spanish ", practising: [topics[0]], dailyMinutes: 15 });
    expect(r).toEqual({ displayName: "Ana María", firstLanguage: "Spanish", practising: [topics[0]], dailyMinutes: 15 });
  });

  it.each([
    ["empty name", { displayName: "   " }, "displayName", "name_required"],
    ["too long", { displayName: "x".repeat(41) }, "displayName", "name_too_long"],
    ["control character", { displayName: "A\u0000na" }, "displayName", "name_invalid"],
    ["bidi override (name spoofing)", { displayName: "Ana‮evil" }, "displayName", "name_invalid"],
    ["zero-width character", { displayName: "A​na" }, "displayName", "name_invalid"],
    ["long language", { firstLanguage: "x".repeat(41) }, "firstLanguage", "language_too_long"],
    ["unknown topic", { practising: ["Not a real topic"] }, "practising", "unknown_goal"],
    ["duplicate topic", { practising: [topics[0], topics[0]] }, "practising", "duplicate_goal"],
  ])("rejects %s with a field code and no echo of the input", (_n, patch, field, code) => {
    const r = schema.safeParse({ ...ok, ...patch });
    expect(r.success).toBe(false);
    if (r.success) return;
    const codes = errorCodes(r.error);
    expect(codes[field]).toBe(code);
    expect(JSON.stringify(codes)).not.toContain("evil");
    expect(Object.hasOwn(PROFILE_ERRORS, codes[field])).toBe(true);
  });

  it("caps the number of topics", () => {
    const many = Array.from({ length: MAX_PRACTISING + 4 }, (_, i) => `Topic ${i}`);
    const r = profileUpdateSchema(many).safeParse({ ...ok, practising: many.slice(0, MAX_PRACTISING + 1) });
    expect(r.success).toBe(false);
    if (!r.success) expect(errorCodes(r.error).practising).toBe("too_many_goals");
    expect(profileUpdateSchema(many).safeParse({ ...ok, practising: many.slice(0, MAX_PRACTISING) }).success).toBe(true);
  });

  it.each([3, 20, "10", null, undefined])("rejects daily minutes %j", (m) => expect(schema.safeParse({ ...ok, dailyMinutes: m }).success).toBe(false));

  it("treats an empty first language as not set", () => expect(schema.parse({ ...ok, firstLanguage: "  " }).firstLanguage).toBeNull());

  it.each([
    ["id", { id: "00000000-0000-4000-8000-000000000000" }],
    ["status", { status: "suspended" }],
    ["adult confirmation", { adult_confirmed_at: "2000-01-01T00:00:00Z" }],
    ["joined_via_invitation", { joined_via_invitation: "x" }],
    ["role", { role: "admin" }],
    ["admin", { isAdmin: true }],
    ["user id", { userId: "x" }],
  ])("refuses a request that tries to set %s (privileged or identity fields are not accepted at all)", (_n, extra) => {
    expect(schema.safeParse({ ...ok, ...extra }).success).toBe(false);
  });

  it("the stored row contains only the three updatable columns", () => {
    expect(Object.keys(toRow(schema.parse(ok))).sort()).toEqual(["display_name", "first_language", "preferences"]);
  });
});

describe("stored preferences are read defensively", () => {
  it("falls back to defaults for anything unexpected", () => {
    for (const raw of [null, undefined, "x", 5, [], {}, { practising: "no", dailyMinutes: 99 }]) expect(parsePreferences(raw, topics)).toEqual(DEFAULT_PREFERENCES);
  });
  it("drops unknown or repeated topics and caps the list", () => {
    const p = parsePreferences({ practising: [topics[0], topics[0], "nonsense", ...topics], dailyMinutes: 5 }, topics);
    expect(p.dailyMinutes).toBe(5);
    expect(p.practising[0]).toBe(topics[0]);
    expect(p.practising).not.toContain("nonsense");
    expect(new Set(p.practising).size).toBe(p.practising.length);
    expect(p.practising.length).toBeLessThanOrEqual(MAX_PRACTISING);
  });
});

const NOW = Date.UTC(2026, 10, 1, 12);
const row = (o: Partial<InvitationRow> = {}): InvitationRow => ({ id: "i", label: "L", code_hint: "ABCD", max_uses: 10, reserved_count: 0, redeemed_count: 0, expires_at: new Date(NOW + 12 * 86_400_000).toISOString(), revoked_at: null, created_at: new Date(NOW).toISOString(), ...o });

describe("invitation status", () => {
  it("revoked beats expired beats full beats active", () => {
    const past = new Date(NOW - 1000).toISOString();
    expect(statusOf(row(), NOW)).toBe("active");
    expect(statusOf(row({ reserved_count: 10, redeemed_count: 10 }), NOW)).toBe("full");
    expect(statusOf(row({ reserved_count: 10, redeemed_count: 10, expires_at: past }), NOW)).toBe("expired");
    expect(statusOf(row({ expires_at: past, revoked_at: past }), NOW)).toBe("revoked");
  });
  it("a fully RESERVED invitation (people mid sign-in) already counts as full", () => expect(statusOf(row({ reserved_count: 10, redeemed_count: 3 }), NOW)).toBe("full"));
  it("describes usage and time in plain words", () => {
    expect(usedPercent(row({ redeemed_count: 4 }))).toBe(40);
    expect(usedPercent(row({ redeemed_count: 99, max_uses: 10 }))).toBe(100);
    expect(expiryText(row(), NOW)).toBe("expires in 12 days");
    expect(expiryText(row({ expires_at: new Date(NOW + 86_400_000).toISOString() }), NOW)).toBe("expires in 1 day");
    expect(expiryText(row({ expires_at: new Date(NOW - 2 * 86_400_000).toISOString() }), NOW)).toBe("ended 2 days ago");
    expect(expiryText(row({ revoked_at: "x" }), NOW)).toBe("revoked");
  });
});

describe("invitation link", () => {
  it("puts the code in the URL FRAGMENT (never sent to a server), without dashes", () => {
    const link = inviteLink("https://grammigo.example", "ABCD-EFGH-JKM");
    expect(link).toBe("https://grammigo.example/join#c=ABCDEFGHJKM");
    expect(new URL(link).search).toBe("");
    expect(new URL(link).pathname).toBe("/join");
  });
  it("reads a code back only from a well-formed fragment", () => {
    expect(codeFromHash("#c=abcdefghjkm")).toBe("ABCDEFGHJKM");
    for (const bad of ["", "#", "#c=", "#c=short", "#c=ABCDEFGH<script>", "#code=ABCDEFGHJKM", "c=ABCDEFGHJKM", "#c=" + "A".repeat(40)]) expect(codeFromHash(bad)).toBeNull();
  });
});
