import { afterAll, describe, expect, it } from "vitest";
import { closePool, createAuthUser, createInvitation, hash, newId, q, redeem, reserve } from "../helpers";

afterAll(closePool);

/** Counts must always agree with the reservation rows, whatever happened. */
async function expectConsistent(inv: string) {
  const { rows } = await q(
    `select i.reserved_count, i.redeemed_count, i.max_uses,
            (select count(*) from public.invitation_reservations r where r.invitation_id = i.id and r.status in ('reserved','redeemed'))::int as live,
            (select count(*) from public.invitation_reservations r where r.invitation_id = i.id and r.status = 'redeemed')::int as done,
            (select count(*) from public.profiles p where p.joined_via_invitation = i.id)::int as profiles
       from public.invitations i where i.id = $1`, [inv]);
  const r = rows[0];
  expect(r.reserved_count, "reserved_count").toBe(r.live);
  expect(r.redeemed_count, "redeemed_count").toBe(r.done);
  expect(r.profiles, "profiles created").toBe(r.done);
  expect(r.reserved_count).toBeLessThanOrEqual(r.max_uses);
}

describe("reserving", () => {
  it("a wrong code, a revoked invitation and an expired invitation each say so, and never create a reservation", async () => {
    expect(await reserve(hash())).toEqual({ grant_id: null, error: "invalid" });
    const revoked = await createInvitation({ revoked: true });
    expect(await reserve(revoked.codeHash)).toEqual({ grant_id: null, error: "revoked" });
    const expired = await createInvitation({ expiresInMs: -1000 });
    expect(await reserve(expired.codeHash)).toEqual({ grant_id: null, error: "expired" });
    for (const i of [revoked, expired]) expect((await q("select count(*)::int c from public.invitation_reservations where invitation_id = $1", [i.id])).rows[0].c).toBe(0);
  });

  it("a successful reservation holds a seat, and a full invitation says so", async () => {
    const inv = await createInvitation({ max: 2 });
    const [a, b, c] = [await reserve(inv.codeHash), await reserve(inv.codeHash), await reserve(inv.codeHash)];
    expect([a.error, b.error, c.error]).toEqual([null, null, "full"]);
    expect(a.grant_id).not.toBe(b.grant_id);
    await expectConsistent(inv.id);
  });

  it("CONCURRENT: 25 parallel reservations of a 1-use invitation give exactly ONE seat", async () => {
    const inv = await createInvitation({ max: 1 });
    const results = await Promise.all(Array.from({ length: 25 }, () => reserve(inv.codeHash)));
    expect(results.filter((r) => r.grant_id).length).toBe(1);
    expect(results.filter((r) => r.error === "full").length).toBe(24);
    await expectConsistent(inv.id);
  });

  it("CONCURRENT: 60 parallel reservations of a 5-use invitation give exactly FIVE seats", async () => {
    const inv = await createInvitation({ max: 5 });
    const results = await Promise.all(Array.from({ length: 60 }, () => reserve(inv.codeHash)));
    expect(results.filter((r) => r.grant_id).length).toBe(5);
    await expectConsistent(inv.id);
  });
});

describe("redeeming", () => {
  it("creates the profile and both consents in the same step, and counts it", async () => {
    const inv = await createInvitation({ max: 1 });
    const g = (await reserve(inv.codeHash)).grant_id as string;
    const user = await createAuthUser("redeemer");
    expect(await redeem(g, user)).toBe("ok");
    expect((await q("select status, active from (select p.status, true as active from public.profiles p where p.id = $1) s", [user])).rows[0].status).toBe("active");
    expect((await q("select kind from public.consents where user_id = $1 order by kind", [user])).rows.map((r) => r.kind)).toEqual(["adult_confirmation", "privacy_notice"]);
    await expectConsistent(inv.id);
  });

  it("is idempotent for the same user and refuses everyone else with the same grant", async () => {
    const inv = await createInvitation({ max: 3 });
    const g = (await reserve(inv.codeHash)).grant_id as string;
    const [u1, u2] = [await createAuthUser("one"), await createAuthUser("two")];
    expect(await redeem(g, u1)).toBe("ok");
    expect(await redeem(g, u1)).toBe("ok");
    expect(await redeem(g, u2)).toBe("invalid");
    await expectConsistent(inv.id);
  });

  it("an unknown grant is invalid; a user who already has an account cannot redeem a second invitation", async () => {
    expect(await redeem(newId(), await createAuthUser("nobody"))).toBe("invalid");
    const inv = await createInvitation({ max: 2 });
    const user = await createAuthUser("twice");
    expect(await redeem((await reserve(inv.codeHash)).grant_id as string, user)).toBe("ok");
    expect(await redeem((await reserve(inv.codeHash)).grant_id as string, user)).toBe("already_registered");
    await expectConsistent(inv.id);
  });

  it("CONCURRENT: the same grant redeemed by 10 different users at once succeeds for exactly one", async () => {
    const inv = await createInvitation({ max: 1 });
    const g = (await reserve(inv.codeHash)).grant_id as string;
    const users = await Promise.all(Array.from({ length: 10 }, (_, i) => createAuthUser(`race${i}`)));
    const results = await Promise.all(users.map((u) => redeem(g, u)));
    expect(results.filter((r) => r === "ok").length).toBe(1);
    expect(results.filter((r) => r === "invalid").length).toBe(9);
    await expectConsistent(inv.id);
  });
});

describe("expiry and abandoned verification", () => {
  it("a reservation past its hold cannot be redeemed", async () => {
    const inv = await createInvitation({ max: 1 });
    const g = (await reserve(inv.codeHash, "30 minutes")).grant_id as string;
    await q("update public.invitation_reservations set expires_at = now() - interval '1 second' where grant_id = $1", [g]);
    expect(await redeem(g, await createAuthUser("late"))).toBe("expired");
    expect((await q("select count(*)::int c from public.profiles where joined_via_invitation = $1", [inv.id])).rows[0].c).toBe(0);
  });

  it("an abandoned reservation gives its seat back on the next reserve, and the late sign-in is refused", async () => {
    const inv = await createInvitation({ max: 1 });
    const first = (await reserve(inv.codeHash)).grant_id as string;
    expect((await reserve(inv.codeHash)).error).toBe("full");                                  // seat is held
    await q("update public.invitation_reservations set expires_at = now() - interval '1 second' where grant_id = $1", [first]);
    const second = await reserve(inv.codeHash);                                                // abandoned seat released lazily
    expect(second.error).toBeNull();
    expect((await q("select status from public.invitation_reservations where grant_id = $1", [first])).rows[0].status).toBe("released");
    expect(await redeem(first, await createAuthUser("abandoned"))).toBe("invalid");
    expect(await redeem(second.grant_id as string, await createAuthUser("successor"))).toBe("ok");
    await expectConsistent(inv.id);
  });

  it("an invitation that expires while a reservation is pending cannot be newly reserved, but the pending grant stays valid for its hold", async () => {
    const inv = await createInvitation({ max: 2 });
    const g = (await reserve(inv.codeHash)).grant_id as string;
    await q("update public.invitations set expires_at = now() - interval '1 second' where id = $1", [inv.id]);
    expect((await reserve(inv.codeHash)).error).toBe("expired");
    expect(await redeem(g, await createAuthUser("inflight"))).toBe("ok");
    await expectConsistent(inv.id);
  });
});

describe("revocation", () => {
  it("revoking cancels pending reservations, frees their seats, and blocks new ones; people who already joined keep their account", async () => {
    const inv = await createInvitation({ max: 3 });
    const joined = await createAuthUser("joined");
    expect(await redeem((await reserve(inv.codeHash)).grant_id as string, joined)).toBe("ok");
    const pending = (await reserve(inv.codeHash)).grant_id as string;
    await q("select public.revoke_invitation($1, null)", [inv.id]);
    expect((await q("select status from public.invitation_reservations where grant_id = $1", [pending])).rows[0].status).toBe("revoked");
    expect(await redeem(pending, await createAuthUser("midway"))).toBe("invalid");
    expect((await reserve(inv.codeHash)).error).toBe("revoked");
    expect((await q("select status from public.profiles where id = $1", [joined])).rows[0].status).toBe("active");
    await expectConsistent(inv.id);
  });

  it("revoking twice, or revoking something that does not exist, is harmless", async () => {
    const inv = await createInvitation();
    await q("select public.revoke_invitation($1, null)", [inv.id]);
    await q("select public.revoke_invitation($1, null)", [inv.id]);
    await q("select public.revoke_invitation($1, null)", [newId()]);
  });

  it("RACE: revoke and redeem started at the same moment always leave a consistent result (30 rounds)", async () => {
    for (let i = 0; i < 30; i++) {
      const inv = await createInvitation({ max: 1 });
      const g = (await reserve(inv.codeHash)).grant_id as string;
      const user = await createAuthUser(`race${i}`);
      const [r] = await Promise.all([redeem(g, user), q("select public.revoke_invitation($1, null)", [inv.id])]);
      expect(["ok", "invalid", "revoked"], `round ${i}: ${r}`).toContain(r);
      const profile = (await q("select count(*)::int c from public.profiles where id = $1", [user])).rows[0].c;
      expect(profile, `round ${i}`).toBe(r === "ok" ? 1 : 0);
      if (r === "ok") expect((await q("select status from public.profiles where id = $1", [user])).rows[0].status).toBe("active"); // revoke does not undo an account
      await expectConsistent(inv.id);
    }
  });
});

describe("audit", () => {
  it("reserve, redeem and revoke each leave an event with no personal data", async () => {
    const inv = await createInvitation();
    const user = await createAuthUser("audited");
    await redeem((await reserve(inv.codeHash)).grant_id as string, user);
    await q("select public.revoke_invitation($1, null)", [inv.id]);
    const { rows } = await q("select kind, meta from public.audit_events where meta->>'invitation' = $1 order by id", [inv.id]);
    expect(rows.map((r) => r.kind)).toEqual(["invite_reserved", "invite_redeemed", "invite_revoked"]);
    expect(JSON.stringify(rows)).not.toMatch(/@|test\.invalid|display|name/i);
  });
});
