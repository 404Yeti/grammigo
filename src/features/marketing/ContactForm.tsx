"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";

/** Opens a draft in the learner's email app. No message is sent or retained by Grammigo. */
export function ContactForm({ email }: { email: string | null }) {
  const [message, setMessage] = useState("");
  const [prepared, setPrepared] = useState(false);
  function prepare(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!email) return;
    const fields = new FormData(event.currentTarget);
    const body = `From: ${String(fields.get("name"))} <${String(fields.get("email"))}>\n\n${message}`;
    window.location.href = `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent("Grammigo feedback")}&body=${encodeURIComponent(body)}`;
    setPrepared(true);
  }
  const field = "w-full rounded-[14px] border-[1.5px] border-line-strong bg-surface px-4 py-3.5 text-base font-medium placeholder:text-muted";
  return (
    <form onSubmit={prepare} className="flex flex-col gap-5 rounded-[24px] border border-line bg-surface p-5 lg:p-7">
      <label className="flex flex-col gap-2 text-sm font-semibold">Your name
        <input className={field} name="name" autoComplete="name" placeholder="Name" required maxLength={100} />
      </label>
      <label className="flex flex-col gap-2 text-sm font-semibold">Email
        <input className={field} name="email" type="email" autoComplete="email" placeholder="you@example.com" required maxLength={254} />
      </label>
      <label className="flex flex-col gap-2 text-sm font-semibold">Message
        <textarea className={`${field} min-h-[120px] resize-y`} name="message" placeholder="How can we help?" required maxLength={500} value={message} onChange={(event) => setMessage(event.target.value)} aria-describedby="message-help" />
      </label>
      <p id="message-help" className="text-xs font-medium text-muted">{message.length} / 500 · Please leave out passwords and private account details.</p>
      <p className="text-sm leading-5 text-ink-2">{email ? "Prepare a draft in your email app, then review and send it there. This form does not save your message." : "Our contact mailbox is being confirmed. Invited learners can contact the person who invited them for help."}</p>
      <Button type="submit" disabled={!email}>Prepare email</Button>
      {prepared && <p role="status" className="text-sm text-ink-2">Your email app was requested. Your message has not been sent by Grammigo.</p>}
    </form>
  );
}
