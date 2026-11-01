/** The local stack's mailbox (Mailpit): where the Auth server's emails go in tests. Nothing is ever sent outside the machine. */
const MAILPIT = process.env.MAILPIT_URL ?? "http://127.0.0.1:54324";

type Summary = { ID: string; Created: string; Subject: string; To: { Address: string }[] };

export async function waitForMail(to: string, o: { contains?: RegExp; after?: number; timeoutMs?: number } = {}): Promise<{ id: string; subject: string; text: string }> {
  const deadline = Date.now() + (o.timeoutMs ?? 30_000);
  for (;;) {
    const res = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${to}`)}&limit=20`).catch(() => null);
    if (res?.ok) {
      const list = ((await res.json()) as { messages?: Summary[] }).messages ?? [];
      for (const m of list.filter((x) => !o.after || Date.parse(x.Created) >= o.after)) {
        const full = (await (await fetch(`${MAILPIT}/api/v1/message/${m.ID}`)).json()) as { Text?: string; HTML?: string; Subject?: string };
        const text = `${full.Text ?? ""}\n${full.HTML ?? ""}`;
        if (!o.contains || o.contains.test(text)) return { id: m.ID, subject: m.Subject, text };
      }
    }
    if (Date.now() > deadline) throw new Error(`no email to ${to} arrived in time (is the local stack's mail service running?)`);
    await new Promise((r) => setTimeout(r, 400));
  }
}

/** The first Auth-server link in an email (confirmation or recovery), HTML-decoded. */
export function authLink(text: string): string {
  const m = /https?:\/\/[^\s"'<>)]+\/auth\/v1\/verify[^\s"'<>)]*/.exec(text);
  if (!m) throw new Error("no sign-in link found in the email");
  return m[0].replace(/&amp;/g, "&");
}

/** The password-reset link in an email: it points at OUR /auth/reset page and carries the one-time token. */
export function resetLink(text: string): string {
  const m = /https?:\/\/[^\s"'<>)]+\/auth\/reset\?token_hash=[^\s"'<>)]*/.exec(text);
  if (!m) throw new Error("no reset link found in the email");
  return m[0].replace(/&amp;/g, "&");
}

/** Opens the link the way a browser would, without following the redirect: returns where the Auth server sends the person next. */
export async function openAuthLink(link: string): Promise<string> {
  const res = await fetch(link, { redirect: "manual" });
  const where = res.headers.get("location");
  if (!where) throw new Error(`the link did not redirect (HTTP ${res.status})`);
  return where;
}
