/** The two documents a learner's progress is saved as. Shared by the browser and the server so both mean exactly the same thing. */
export const DOC_KEYS = ["lessons_v2", "guided_v1"] as const;
export type DocKey = (typeof DOC_KEYS)[number];

/** Must equal the schema versions the database accepts (`valid_document`). */
export const DOC_SCHEMA: Record<DocKey, number> = { lessons_v2: 2, guided_v1: 1 };

/** The database refuses documents of 1,000,000 bytes or more. This is the app's own, lower ceiling, so it fails here with a plain message first. */
export const MAX_DOC_BYTES = 900_000;

export const isDocKey = (v: unknown): v is DocKey => typeof v === "string" && (DOC_KEYS as readonly string[]).includes(v);

export type RemoteDoc = { revision: number; body: Record<string, unknown>; updatedAt: string };
export type SyncState = { consent: boolean; documents: Record<DocKey, { revision: number; updatedAt: string } | null> };
