"use client";

import { useCallback, useEffect, useState } from "react";
import { Copy, Plus } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { GrammarTag, type TagStyle } from "@/components/ui/GrammarTag";
import { TextField } from "@/components/ui/TextField";
import { canExpire, canManage, expiryText, inviteLink, statusOf, usedPercent, type InvitationRow, type InvitationStatus } from "./invitation-status";

const CHIP: Record<InvitationStatus, { text: string; style: TagStyle }> = {
  active: { text: "Active", style: "success" },
  full: { text: "Full", style: "warning" },
  expired: { text: "Expired", style: "neutral" },
  revoked: { text: "Revoked", style: "neutral" },
};
const EXPIRES = [7, 14, 30] as const;
const SEATS = [1, 5, 10, 25] as const;

type Created = { id: string; code: string; label: string; maxUses: number; expiresAt: string };
type View = { name: "list" } | { name: "create" } | { name: "created" } | { name: "confirm"; action: "revoke" | "expire"; row: InvitationRow };

/**
 * Owner-only invitation management. The server decides who the owner is on every call; this screen is only a convenience.
 *
 * The FULL code exists in exactly one place: the `created` state below, from the moment the server returns it until "Done". It is never
 * written to storage, the URL, the console or the list. The list shows only the last four characters, because the server stores only a hash.
 */
export function InvitationManager() {
  const [rows, setRows] = useState<InvitationRow[] | null>(null);
  const [now, setNow] = useState(0); // when the list was loaded: statuses and "expires in" are computed against this, not the clock during render
  const [view, setView] = useState<View>({ name: "list" });
  const [created, setCreated] = useState<Created | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [label, setLabel] = useState("");
  const [days, setDays] = useState<number>(14);
  const [seats, setSeats] = useState<number>(10);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/invitations", { cache: "no-store" });
      if (!res.ok) throw new Error("load");
      setRows(((await res.json()) as { invitations: InvitationRow[] }).invitations);
      setNow(Date.now());
    } catch {
      setError("We couldn’t load the invitations. Please try again.");
    }
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial load of server data
    void load();
  }, [load]);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/invitations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ label, maxUses: seats, expiresInDays: days }) });
      if (!res.ok) throw new Error(String(res.status));
      setCreated((await res.json()) as Created); // the only place the full code ever lives
      setView({ name: "created" });
    } catch (e) {
      setError(e instanceof Error && e.message === "429" ? "Too many requests. Please wait a minute." : "We couldn’t create that invitation. Please check it and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function act(action: "revoke" | "expire", id: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/invitations/${id}/${action}`, { method: "POST" });
      if (!res.ok) throw new Error("act");
      setView({ name: "list" });
      await load();
    } catch {
      setError(`We couldn’t ${action} that invitation. Please try again.`);
    } finally {
      setBusy(false);
    }
  }

  async function copy(kind: "link" | "code") {
    if (!created) return;
    const text = kind === "link" ? inviteLink(window.location.origin, created.code) : created.code;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(kind);
    } catch {
      setCopied("failed");
    }
  }

  function done() {
    setCreated(null); // the secret is dropped from memory here
    setCopied(null);
    setLabel("");
    setView({ name: "list" });
    void load();
  }

  const errorBox = error && <p role="alert" className="rounded-2xl bg-error-soft p-3 text-sm font-semibold text-error">{error}</p>;

  if (view.name === "created" && created) {
    return (
      <div className="flex flex-col gap-4" data-testid="invitation-created">
        <div className="rounded-[20px] border border-brand bg-brand-soft p-5 text-center">
          <p className="text-xs font-bold tracking-[0.6px] text-brand-text">INVITATION CODE</p>
          <p className="mt-1 text-2xl font-extrabold tracking-wider" data-testid="invitation-code">{created.code}</p>
          <p className="mt-1 text-sm font-medium text-ink-2">{created.label} · {created.maxUses} {created.maxUses === 1 ? "person" : "people"}</p>
        </div>
        <Button onClick={() => void copy("link")}><Copy size={16} aria-hidden /> Copy link</Button>
        <Button variant="secondary" onClick={() => void copy("code")}>Copy code</Button>
        {copied && <p role="status" className="text-center text-sm font-semibold" data-testid="copied">{copied === "failed" ? "Couldn’t copy automatically. Select the code above and copy it." : copied === "link" ? "Link copied." : "Code copied."}</p>}
        <div className="rounded-[20px] bg-info-soft p-4 text-sm font-medium leading-5">
          <p className="font-bold">Copy it now</p>
          For security we keep only a scrambled version, so this code can’t be shown again. You can always revoke it and make another.
        </div>
        <Button variant="ghost" onClick={done}>Done</Button>
      </div>
    );
  }

  if (view.name === "create") {
    return (
      <form className="flex flex-col gap-5" onSubmit={(e) => { e.preventDefault(); void create(); }} data-testid="invitation-create">
        <TextField label="Who is this for?" value={label} onChange={setLabel} maxLength={60} helper="Only you see this label." />
        <fieldset className="rounded-[20px] border border-line bg-surface p-4">
          <legend className="px-1 text-sm font-bold">Expires after</legend>
          {EXPIRES.map((d) => (
            <label key={d} className="flex min-h-11 items-center gap-3 text-base font-medium">
              <input type="radio" name="days" checked={days === d} onChange={() => setDays(d)} className="size-5 accent-[var(--color-brand)]" /> {d} days
            </label>
          ))}
        </fieldset>
        <fieldset className="rounded-[20px] border border-line bg-surface p-4">
          <legend className="px-1 text-sm font-bold">How many people can use it</legend>
          {SEATS.map((n) => (
            <label key={n} className="flex min-h-11 items-center gap-3 text-base font-medium">
              <input type="radio" name="seats" checked={seats === n} onChange={() => setSeats(n)} className="size-5 accent-[var(--color-brand)]" /> {n} {n === 1 ? "person" : "people"}
            </label>
          ))}
        </fieldset>
        {errorBox}
        <Button type="submit" disabled={busy || label.trim() === ""}>{busy ? "Creating…" : "Create invitation"}</Button>
        <Button type="button" variant="ghost" onClick={() => { setError(null); setView({ name: "list" }); }}>Cancel</Button>
        <p className="text-xs font-medium text-muted">Three choices, sensible defaults. Every invitee must still confirm they are 18 or older.</p>
      </form>
    );
  }

  if (view.name === "confirm") {
    const { action, row } = view;
    return (
      <div className="flex flex-col gap-4" data-testid="invitation-confirm">
        <h2 className="text-2xl font-bold leading-8">{action === "revoke" ? `Revoke “${row.label}”?` : `Expire “${row.label}” now?`}</h2>
        <p className="text-base font-medium leading-6 text-ink-2">
          {action === "revoke"
            ? "Nobody new will be able to join with this invitation, and anyone partway through signing in is stopped. People who already joined keep their accounts and progress."
            : "Nobody new will be able to start with this invitation. Anyone already partway through signing in can finish. People who already joined keep their accounts."}
        </p>
        <Card tone="subtle"><p className="text-base font-semibold">Code ending {row.code_hint}</p><p className="text-sm font-medium text-ink-2">{row.redeemed_count} of {row.max_uses} people used it</p></Card>
        {errorBox}
        <Button variant="secondary" className="border-error text-error" disabled={busy} onClick={() => void act(action, row.id)}>{action === "revoke" ? "Revoke invitation" : "Expire now"}</Button>
        <Button onClick={() => { setError(null); setView({ name: "list" }); }}>Keep it active</Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-base font-medium leading-6 text-ink-2">Share a link or code. Each one expires, has a limit, and can be revoked.</p>
      <Button onClick={() => { setError(null); setView({ name: "create" }); }}><Plus size={18} aria-hidden /> Create an invitation</Button>
      {errorBox}
      {rows === null && !error && <p className="text-sm font-medium text-ink-2" aria-busy="true">Loading…</p>}
      {rows?.length === 0 && <p className="text-sm font-medium text-ink-2" data-testid="invitations-empty">No invitations yet.</p>}
      {rows?.map((row) => {
        const status = statusOf(row, now);
        const pct = usedPercent(row);
        return (
          <Card key={row.id} data-testid="invitation-row">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-base font-bold">{row.label}</h2>
              <GrammarTag style={CHIP[status].style}>{CHIP[status].text}</GrammarTag>
            </div>
            <p className="mt-2 text-sm font-semibold text-ink-2" data-testid="invitation-hint">Code ending {row.code_hint}</p>
            <div role="progressbar" aria-label={`${row.label} usage`} aria-valuemin={0} aria-valuemax={row.max_uses} aria-valuenow={row.redeemed_count} className="mt-2 h-2.5 overflow-hidden rounded-full bg-line">
              <div className="h-full rounded-full bg-success" style={{ width: `${pct}%` }} />
            </div>
            <p className="mt-1 text-xs font-medium text-ink-2">{pct}% used · {row.redeemed_count} of {row.max_uses} used · {expiryText(row, now)}{row.reserved_count > row.redeemed_count && status !== "revoked" ? ` · ${row.reserved_count - row.redeemed_count} signing in` : ""}</p>
            {canManage(status) && (
              <div className="mt-3 flex flex-wrap gap-3">
                {canExpire(status) && <Button variant="secondary" fullWidth={false} onClick={() => { setError(null); setView({ name: "confirm", action: "expire", row }); }}>Expire now</Button>}
                <Button variant="ghost" fullWidth={false} onClick={() => { setError(null); setView({ name: "confirm", action: "revoke", row }); }}>Revoke</Button>
              </div>
            )}
          </Card>
        );
      })}
      <p className="text-xs font-medium leading-4 text-muted">Visible only to the owner account. Only the last four characters of a code are kept for display; the full code can be copied only right after you create it.</p>
    </div>
  );
}
