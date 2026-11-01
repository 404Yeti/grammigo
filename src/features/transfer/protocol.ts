import { parseGuidedState } from "@/features/guided/store/schema";
import { parseStoredState } from "@/lib/storage/schema";
import type { GuidedState } from "@/types/guided";
import type { StoredState } from "@/types/session";
import { z } from "zod";

/**
 * What crosses between the two addresses. It is DATA only (the learner's saved progress), validated before anything reads it as such.
 *  - from the old address to the new one:  { app, type: "transfer", v: 1, lessons, guided }
 *  - back again, once the learner has said yes: { app, type: "ack", v: 1 }
 * The same validation serves the file fallback. Nothing here is trusted: a message is checked for its sender elsewhere, and for its content here.
 */
export const MAX_TRANSFER_BYTES = 2_000_000; // two documents of up to 900 KB each, plus a margin
export const TRANSFER_APP = "grammigo";

const transferMessage = z.strictObject({ app: z.literal(TRANSFER_APP), type: z.literal("transfer"), v: z.literal(1), lessons: z.unknown(), guided: z.unknown() });
const ackMessage = z.strictObject({ app: z.literal(TRANSFER_APP), type: z.literal("ack"), v: z.literal(1) });

export type Incoming = { lessons: StoredState; guided: GuidedState };
export type Rejected = { ok: false; reason: "too_large" | "shape" | "unreadable" | "newer_app" };

const emptyGuided = (): GuidedState => ({ version: 1, sessions: [], activeSessionId: null }) as GuidedState;

function sizeOf(value: unknown): number | null {
  try {
    return JSON.stringify(value).length;
  } catch {
    return null;
  }
}

function content(lessonsRaw: unknown, guidedRaw: unknown): { ok: true; value: Incoming } | Rejected {
  if (lessonsRaw === null || lessonsRaw === undefined) return { ok: false, reason: "shape" }; // nothing to bring
  const lessons = parseStoredState(JSON.stringify(lessonsRaw));
  if (!lessons) return { ok: false, reason: "unreadable" };
  if (guidedRaw === null || guidedRaw === undefined) return { ok: true, value: { lessons, guided: emptyGuided() } };
  const g = parseGuidedState(JSON.stringify(guidedRaw));
  if (g.kind === "future") return { ok: false, reason: "newer_app" };
  if (g.kind !== "ok") return { ok: false, reason: g.kind === "empty" ? "shape" : "unreadable" };
  return { ok: true, value: { lessons, guided: g.state } };
}

/** A message from the other address. Returns the validated progress, or why it was refused. */
export function parseIncoming(data: unknown): { ok: true; value: Incoming } | Rejected {
  const size = sizeOf(data);
  if (size === null) return { ok: false, reason: "unreadable" };
  if (size > MAX_TRANSFER_BYTES) return { ok: false, reason: "too_large" };
  const m = transferMessage.safeParse(data);
  if (!m.success) return { ok: false, reason: "shape" };
  return content(m.data.lessons, m.data.guided);
}

/** The text of a file the learner chose: a "device copy" downloaded from the old address (or from Settings on a signed-out device). */
export function parseDeviceCopyText(text: string): { ok: true; value: Incoming } | Rejected {
  if (text.length > MAX_TRANSFER_BYTES) return { ok: false, reason: "too_large" };
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, reason: "unreadable" };
  }
  if (!data || typeof data !== "object" || (data as { format?: unknown }).format !== "grammigo-device-copy" || (data as { version?: unknown }).version !== 1) return { ok: false, reason: "shape" };
  const d = data as { lessons?: unknown; guided?: unknown };
  return content(d.lessons, d.guided);
}

export const transferMessageFor = (lessons: unknown, guided: unknown) => ({ app: TRANSFER_APP, type: "transfer", v: 1, lessons, guided }) as const;
export const ackMessage_ = () => ({ app: TRANSFER_APP, type: "ack", v: 1 }) as const;
export const isAck = (data: unknown): boolean => ackMessage.safeParse(data).success;

export const REJECTION_TEXT: Record<Rejected["reason"], string> = {
  too_large: "That is bigger than Grammigo progress can be, so it was not used.",
  shape: "That isn’t progress from Grammigo, so it was not used.",
  unreadable: "We couldn’t read that progress, so nothing was added.",
  newer_app: "That progress is from a newer version of Grammigo than this page. Nothing was added.",
};
