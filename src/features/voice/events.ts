import { scopedKey } from "@/lib/scope/storage-scope";

// Tab-local playback markers, separate from learner progress and account sync. No answer text.
const memory = new Map<string, string[]>();
function read(key: string): string[] {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return memory.get(key) ?? [];
    const value: unknown = JSON.parse(raw);
    if (Array.isArray(value) && value.every(v => typeof v === "string")) return value.slice(-128);
  } catch { /* memory fallback when storage is unavailable */ }
  return memory.get(key) ?? [];
}
export function claimAutomaticSpeech(event: string): boolean {
  const key = scopedKey("grammigo:spoken:v1");
  const seen = read(key);
  if (seen.includes(event)) return false;
  const next = [...seen, event].slice(-128);
  memory.set(key, next);
  try { sessionStorage.setItem(key, JSON.stringify(next)); } catch { /* memory only */ }
  return true;
}
export function armCelebration(sessionId: string) {
  const key = scopedKey("grammigo:celebration:v1");
  const value = [`complete:${sessionId}`, String(Date.now())];
  memory.set(key, value);
  try { sessionStorage.setItem(key, JSON.stringify(value)); } catch { /* memory only */ }
}
export function pendingCelebration(sessionId: string): string | undefined {
  const [event, time] = read(scopedKey("grammigo:celebration:v1"));
  return event === `complete:${sessionId}` && Date.now() - Number(time) < 30_000 ? event : undefined;
}
