import type { CookieOptions } from "@supabase/ssr";

/**
 * A per-request cookie jar. It starts with the cookies the browser sent, records everything the handler sets or deletes, and is
 * applied to the response explicitly, so a handler never depends on framework magic to emit a cookie (and a test can inspect it).
 */
export class CookieSession {
  private readonly incoming = new Map<string, string>();
  readonly outgoing = new Map<string, { value: string; options: CookieOptions }>();

  constructor(initial: { name: string; value: string }[]) {
    for (const c of initial) this.incoming.set(c.name, c.value);
  }

  getAll(): { name: string; value: string }[] {
    const merged = new Map(this.incoming);
    for (const [name, { value, options }] of this.outgoing) {
      if (value === "" || options.maxAge === 0) merged.delete(name);
      else merged.set(name, value);
    }
    return [...merged].map(([name, value]) => ({ name, value }));
  }

  get(name: string): string | undefined {
    return this.getAll().find((c) => c.name === name)?.value;
  }

  set(name: string, value: string, options: CookieOptions): void {
    this.outgoing.set(name, { value, options });
  }

  delete(name: string, options: CookieOptions): void {
    this.outgoing.set(name, { value: "", options: { ...options, maxAge: 0 } });
  }

  /** Deletes every cookie whose name starts with `prefix` (the session cookie and its chunks, and the PKCE verifier). */
  deleteWithPrefix(prefix: string, options: CookieOptions): void {
    for (const c of this.getAll()) if (c.name.startsWith(prefix)) this.delete(c.name, options);
  }
}
