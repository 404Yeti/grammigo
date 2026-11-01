import pg from "pg";

/** Fails the whole run (it does not skip) when the local database is missing or the migrations were not applied. */
export default async function setup() {
  const url = process.env.SUPABASE_DB_URL;
  if (!url) throw new Error("SUPABASE_DB_URL is not set. Run `npm run test:db` (it reads it from the local Supabase stack).");
  const client = new pg.Client({ connectionString: url });
  try {
    await client.connect();
  } catch (error) {
    throw new Error(`Cannot reach the local database (${(error as Error).message}). Start it with: npx supabase@2.122.0 start`);
  }
  try {
    const { rows } = await client.query("select to_regclass('public.profiles') as p, to_regclass('public.deletion_ledger') as d, to_regprocedure('public.reserve_invitation(bytea, interval)') as f, to_regprocedure('public.rate_limit_hit(bytea, integer, interval)') as r");
    if (!rows[0].p || !rows[0].d || !rows[0].f || !rows[0].r) throw new Error("Migrations are not applied. Run: npx supabase@2.122.0 db reset");
  } finally {
    await client.end();
  }
}
