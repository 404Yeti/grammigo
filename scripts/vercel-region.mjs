#!/usr/bin/env node
// Prepares vercel.json with the function region NEXT TO the database. It never guesses: the region must be given as the Supabase region that
// was actually VERIFIED for the production project, and only known mappings are accepted.
//
//   node scripts/vercel-region.mjs --supabase-region ap-southeast-1                  (prints the config; writes nothing)
//   node scripts/vercel-region.mjs --supabase-region ap-southeast-1 --with-cron --write
//
// Nothing here is applied by itself: the output is a file in the repository, reviewed in a pull request. Merging it changes how production
// is deployed, so it needs the owner's approval; this tool does not deploy anything.
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

/** AWS region (what Supabase reports) -> the nearest Vercel function region. Only regions where the pairing is clear are listed. */
export const REGION_MAP = Object.freeze({
  "ap-southeast-1": "sin1",
  "ap-southeast-2": "syd1",
  "ap-northeast-1": "hnd1",
  "ap-northeast-2": "icn1",
  "ap-south-1": "bom1",
  "eu-central-1": "fra1",
  "eu-west-1": "dub1",
  "eu-west-2": "lhr1",
  "eu-west-3": "cdg1",
  "eu-north-1": "arn1",
  "us-east-1": "iad1",
  "us-east-2": "cle1",
  "us-west-1": "sfo1",
  "us-west-2": "pdx1",
  "sa-east-1": "gru1",
});

export function vercelConfigFor(supabaseRegion, { cron = false } = {}) {
  if (typeof supabaseRegion !== "string" || !Object.hasOwn(REGION_MAP, supabaseRegion)) {
    throw new Error(`Unknown or missing Supabase region. Known: ${Object.keys(REGION_MAP).join(", ")}. This tool does not guess a region.`);
  }
  return {
    regions: [REGION_MAP[supabaseRegion]],
    ...(cron ? { crons: [{ path: "/api/auth/cleanup", schedule: "17 3 * * *" }] } : {}),
  };
}

function main() {
  const arg = (n) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : undefined; };
  let config;
  try {
    config = vercelConfigFor(arg("supabase-region"), { cron: process.argv.includes("--with-cron") });
  } catch (e) {
    console.error(e.message);
    process.exit(2);
  }
  const text = JSON.stringify(config, null, 2) + "\n";
  if (!process.argv.includes("--write")) return void process.stdout.write(text);
  try {
    // "wx" creates the file only if it does not exist, in one step (no check-then-write gap); --force replaces it deliberately.
    writeFileSync("vercel.json", text, { flag: process.argv.includes("--force") ? "w" : "wx" });
  } catch (e) {
    if (e && e.code === "EEXIST") {
      console.error("vercel.json already exists; refusing to overwrite it (use --force after reviewing it).");
      process.exit(1);
    }
    throw e;
  }
  console.log("Wrote vercel.json. Review it in a pull request; nothing was deployed.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
