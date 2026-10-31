import { afterAll, describe, expect, it } from "vitest";
import { DENIED, attempt, closePool, createLearner, docBody, put, q, schemaOf } from "../helpers";

afterAll(closePool);
const K = "lessons_v2" as const;
const G = "guided_v1" as const;

describe("validated writes", () => {
  it("accepts well-formed documents of both kinds", async () => {
    const u = await createLearner("docs");
    expect(await put(u, K, 0, docBody(K))).toMatchObject({ ok: true, revision: "1", error: null });
    expect(await put(u, G, 0, docBody(G))).toMatchObject({ ok: true, revision: "1", error: null });
  });

  it.each([
    ["not an object (array)", K, []],
    ["not an object (string)", K, "x"],
    ["wrong version", K, { ...docBody(K), version: 1 }],
    ["sessions is not an array", K, { ...docBody(K), sessions: {} }],
    ["no onboarding", K, { version: 2, sessions: [] }],
    ["guided wrong version", G, { ...docBody(G), version: 2 }],
    ["guided sessions missing", G, { version: 1 }],
    ["guided has more than 100 sessions", G, { ...docBody(G), sessions: Array.from({ length: 101 }, (_, i) => ({ id: i })) }],
    ["lessons has more than 2000 sessions", K, { ...docBody(K), sessions: Array.from({ length: 2001 }, (_, i) => ({ id: i })) }],
    ["larger than 1 MB", G, { ...docBody(G), junk: "x".repeat(1_100_000) }],
  ])("rejects: %s", async (_n, key, body) => {
    const u = await createLearner("bad");
    const r = await put(u, key, 0, body);
    expect(r).toMatchObject({ ok: false, error: "invalid" });
    expect((await q("select count(*)::int c from public.learner_documents where user_id = $1", [u])).rows[0].c).toBe(0);
  });

  it("rejects a schema_version that does not match the document, and unknown document keys", async () => {
    const u = await createLearner("schema");
    expect(await put(u, K, 0, docBody(K), 1)).toMatchObject({ ok: false, error: "invalid" });
    expect((await q("select * from public.put_document($1, 'secrets', 0, 1, '{\"version\":1,\"sessions\":[]}'::jsonb)", [u])).rows[0]).toMatchObject({ ok: false, error: "invalid" });
  });

  it("even a privileged direct insert cannot store an invalid document (table check constraints)", async () => {
    const u = await createLearner("direct");
    await expect(q("insert into public.learner_documents (user_id, doc_key, schema_version, body) values ($1, 'lessons_v2', 2, '[]')", [u])).rejects.toMatchObject({ code: "23514" });
    await expect(q("insert into public.learner_documents (user_id, doc_key, schema_version, body) values ($1, 'other', 1, '{\"version\":1,\"sessions\":[]}')", [u])).rejects.toMatchObject({ code: "23514" });
  });
});

describe("compare-and-swap", () => {
  it("accepts the expected revision, refuses a stale one with the current revision, and refuses creating over an existing document", async () => {
    const u = await createLearner("cas");
    expect(await put(u, G, 0, docBody(G, { n: 1 }))).toMatchObject({ ok: true, revision: "1" });
    expect(await put(u, G, 1, docBody(G, { n: 2 }))).toMatchObject({ ok: true, revision: "2" });
    expect(await put(u, G, 1, docBody(G, { n: 3 }))).toMatchObject({ ok: false, revision: "2", error: "conflict" });
    expect(await put(u, G, 0, docBody(G, { n: 4 }))).toMatchObject({ ok: false, error: "conflict" });
    expect(await put(u, K, 5, docBody(K))).toMatchObject({ ok: false, error: "conflict" });      // cannot "update" what does not exist
    expect((await q("select body->>'n' n, revision from public.learner_documents where user_id = $1 and doc_key = 'guided_v1'", [u])).rows[0]).toMatchObject({ n: "2", revision: "2" });
  });

  it("CONCURRENT: 12 writers that all read revision 1 produce exactly ONE winner, and nothing is lost", async () => {
    const u = await createLearner("race");
    await put(u, G, 0, docBody(G, { n: 0 }));
    const results = await Promise.all(Array.from({ length: 12 }, (_, i) => put(u, G, 1, docBody(G, { n: i + 1 }))));
    expect(results.filter((r) => r.ok).length).toBe(1);
    expect(results.filter((r) => r.error === "conflict").length).toBe(11);
    expect((await q("select revision from public.learner_documents where user_id = $1 and doc_key = 'guided_v1'", [u])).rows[0].revision).toBe("2");
  });

  it("two learners' documents never interfere", async () => {
    const [a, b] = [await createLearner("x"), await createLearner("y")];
    expect(await put(a, G, 0, docBody(G, { who: "a" }))).toMatchObject({ ok: true });
    expect(await put(b, G, 0, docBody(G, { who: "b" }))).toMatchObject({ ok: true });
    expect((await q("select body->>'who' w from public.learner_documents where user_id = $1 and doc_key = 'guided_v1'", [a])).rows[0].w).toBe("a");
  });
});

describe("revision history and recovery", () => {
  async function history(u: string, n: number) {
    await put(u, G, 0, docBody(G, { n: 1 }));
    for (let i = 2; i <= n; i++) await put(u, G, i - 1, docBody(G, { n: i }));
  }

  it("keeps the newest 10 revisions, in order", async () => {
    const u = await createLearner("hist");
    await history(u, 12);
    const { rows } = await q("select revision from public.learner_document_versions where user_id = $1 and doc_key = 'guided_v1' order by revision", [u]);
    expect(rows.map((r) => Number(r.revision))).toEqual([3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });

  it("restoring an earlier revision writes it as a NEW revision, never rewrites history, and is audited", async () => {
    const u = await createLearner("restore");
    await history(u, 6);                                                                        // revisions 1..6, n = revision
    const r = (await q("select * from public.restore_document_revision($1, 'guided_v1', 3, 6, null)", [u])).rows[0];
    expect(r).toMatchObject({ ok: true, revision: "7", error: null });
    expect((await q("select body->>'n' n, revision from public.learner_documents where user_id = $1 and doc_key = 'guided_v1'", [u])).rows[0]).toMatchObject({ n: "3", revision: "7" });
    expect((await q("select body->>'n' n from public.learner_document_versions where user_id = $1 and doc_key = 'guided_v1' and revision = 5", [u])).rows[0].n).toBe("5"); // history intact
    expect((await q("select count(*)::int c from public.audit_events where kind = 'document_restored' and (meta->>'from')::int = 3 and (meta->>'to')::int = 7")).rows[0].c).toBeGreaterThanOrEqual(1);
  });

  it("refuses to restore a revision that was pruned or never existed, and a restore with a stale expected revision", async () => {
    const u = await createLearner("restore2");
    await history(u, 12);
    expect((await q("select * from public.restore_document_revision($1, 'guided_v1', 1, 12, null)", [u])).rows[0]).toMatchObject({ ok: false, error: "not_found" });
    expect((await q("select * from public.restore_document_revision($1, 'guided_v1', 99, 12, null)", [u])).rows[0]).toMatchObject({ ok: false, error: "not_found" });
    expect((await q("select * from public.restore_document_revision($1, 'guided_v1', 5, 3, null)", [u])).rows[0]).toMatchObject({ ok: false, error: "conflict" });
  });

  it("a learner cannot read the history", async () => {
    const u = await createLearner("nohist");
    await put(u, G, 0, docBody(G));
    expect((await attempt("authenticated", u, "select * from public.learner_document_versions")).code).toBe(DENIED);
  });
});

describe("valid_document", () => {
  it("matches the shapes the app writes today", async () => {
    const ok = async (k: string, s: number, b: unknown) => (await q("select public.valid_document($1, $2, $3::jsonb) v", [k, s, JSON.stringify(b)])).rows[0].v;
    expect(await ok(K, schemaOf(K), docBody(K))).toBe(true);
    expect(await ok(G, schemaOf(G), docBody(G))).toBe(true);
    expect(await ok(K, 1, docBody(K))).toBe(false);
    expect(await ok("nope", 1, docBody(G))).toBe(false);
  });
});
