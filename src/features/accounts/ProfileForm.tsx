"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/TextField";
import { cn } from "@/lib/utils/cn";
import { DAILY_MINUTES, LANGUAGE_MAX, MAX_PRACTISING, NAME_MAX, PROFILE_ERRORS, type DailyMinutes } from "./profile";

type Values = { displayName: string; firstLanguage: string; practising: string[]; dailyMinutes: DailyMinutes };

/**
 * Edit display name, first language, topics being practised and daily time. The server validates again with the same schema and applies the
 * change as THIS learner (their own session, row-level security): nothing in this form names whose profile it is.
 * Unsaved changes are never lost silently: leaving the page with edits asks first.
 */
export function ProfileForm({ topics, initial }: { topics: string[]; initial: Values }) {
  const router = useRouter();
  const [v, setV] = useState<Values>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const saved = useRef(false);
  const dirty = JSON.stringify(v) !== JSON.stringify(initial);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      if (!saved.current) e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const toggle = (t: string) =>
    setV((cur) => ({ ...cur, practising: cur.practising.includes(t) ? cur.practising.filter((x) => x !== t) : cur.practising.length >= MAX_PRACTISING ? cur.practising : [...cur.practising, t] }));

  async function save() {
    setSaving(true);
    setErrors({});
    setFormError(null);
    try {
      const res = await fetch("/api/account/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName: v.displayName, firstLanguage: v.firstLanguage.trim() === "" ? null : v.firstLanguage, practising: v.practising, dailyMinutes: v.dailyMinutes }),
      });
      if (res.ok) {
        saved.current = true;
        router.push("/account/profile?saved=1");
        return;
      }
      const body = (await res.json().catch(() => ({}))) as { fields?: Record<string, string> };
      if (res.status === 400 && body.fields) setErrors(body.fields);
      else if (res.status === 401) setFormError("Your session ended. Please sign in again; nothing you typed was lost on this page.");
      else if (res.status === 429) setFormError("Too many saves. Please wait a minute and try again.");
      else setFormError("We couldn’t save that. Please try again.");
    } catch {
      setFormError("We couldn’t reach Grammigo. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  const msg = (field: string) => (errors[field] ? (PROFILE_ERRORS[errors[field]] ?? PROFILE_ERRORS.invalid) : null);

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
      noValidate
    >
      <TextField label="Display name" value={v.displayName} onChange={(displayName) => setV({ ...v, displayName })} maxLength={NAME_MAX} helper="Shown only to you." error={msg("displayName")} />
      <TextField label="First language (optional)" value={v.firstLanguage} onChange={(firstLanguage) => setV({ ...v, firstLanguage })} maxLength={LANGUAGE_MAX} placeholder="Choose a language" error={msg("firstLanguage")} />

      <fieldset>
        <legend className="text-sm font-bold">Practising</legend>
        <p className="mt-1 text-xs font-medium text-muted">Pick up to {MAX_PRACTISING}. Saved to your account; your lessons start using these when your progress syncs, in a later update.</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {topics.map((t) => {
            const on = v.practising.includes(t);
            return (
              <button
                key={t}
                type="button"
                aria-pressed={on}
                onClick={() => toggle(t)}
                className={cn("inline-flex min-h-11 items-center gap-1.5 rounded-full border px-4 text-sm font-bold", on ? "border-brand bg-brand-soft text-ink" : "border-line-strong bg-surface text-ink hover:bg-subtle")}
              >
                {on && <Check size={15} className="text-brand-text" aria-hidden />} {t}
              </button>
            );
          })}
        </div>
        {msg("practising") && <p role="alert" className="mt-2 text-sm font-semibold text-error">{msg("practising")}</p>}
      </fieldset>

      <fieldset className="rounded-[20px] border border-line bg-surface p-4">
        <legend className="px-1 text-sm font-bold">Time each day</legend>
        {DAILY_MINUTES.map((m) => (
          <label key={m} className="flex min-h-11 items-center gap-3 text-base font-medium">
            <input type="radio" name="dailyMinutes" value={m} checked={v.dailyMinutes === m} onChange={() => setV({ ...v, dailyMinutes: m })} className="size-5 accent-[var(--color-brand)]" />
            {m === 15 ? "15 minutes or more" : `About ${m} minutes`}
          </label>
        ))}
      </fieldset>

      {formError && <p role="alert" className="rounded-2xl bg-error-soft p-3 text-sm font-semibold text-error" data-testid="profile-form-error">{formError}</p>}
      <Button type="submit" disabled={saving || !dirty}>{saving ? "Saving…" : "Save changes"}</Button>
      <Button type="button" variant="ghost" onClick={() => router.push("/account/profile")}>Cancel</Button>
      <p className="text-xs font-medium text-muted">Changes save when you tap Save. If you leave with unsaved changes, we ask first.</p>
    </form>
  );
}
