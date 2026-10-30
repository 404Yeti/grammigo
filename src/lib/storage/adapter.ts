/**
 * Persistence seam. v0.2 ships a localStorage adapter only; a remote adapter (e.g. Supabase) can
 * implement this same interface later without touching the rest of the app.
 */
export interface RawSnapshot {
  /** The current-version document, or null. */
  primary: string | null;
  /** The previous-version document, read only when there is no current one (for migration). */
  legacy: string | null;
}

export interface PersistenceAdapter {
  read(): RawSnapshot;
  /** Returns false when the write could not be persisted (the app then keeps state in memory). */
  write(serialized: string): boolean;
  /** Keeps unreadable data aside instead of destroying it. */
  quarantine(raw: string): void;
  subscribe(onExternalChange: () => void): () => void;
}
