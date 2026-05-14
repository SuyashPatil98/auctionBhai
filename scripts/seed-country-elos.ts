/**
 * Seeds approximate Elo ratings for the 48 WC 2026 participants.
 *
 * Values are calibrated from FIFA rank + recent-form consensus as of
 * May 2026. They're inputs to the bracket simulator (and downstream the
 * price engine), and they're overrideable via SQL or an admin UI.
 *
 * The simulator falls back to 1500 for any country missing an Elo.
 *
 * Usage: pnpm seed:elos
 */

import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env" });

// ISO 3166-1 alpha-3 → approximate international Elo.
// Top tier ~2050+, strong 1800-1950, mid 1550-1800, lower 1400-1550,
// minnows <1400.
const ELOS: Record<string, number> = {
  // Tier 1: heavy favorites
  ARG: 2080, // reigning champion
  FRA: 2050,
  ESP: 2030,
  ENG: 2000,
  BRA: 1980,
  POR: 1920, // football-data uses POR not PRT
  PRT: 1920, // ISO alias
  NLD: 1900,
  DEU: 1880, // football-data uses DEU not GER
  GER: 1880, // ISO alias

  // Tier 2: strong contenders
  ITA: 1850,
  BEL: 1830,
  HRV: 1790, // football-data uses HRV not CRO
  CRO: 1790, // ISO alias
  URY: 1780,
  COL: 1750,
  MAR: 1740,
  SUI: 1730,
  CHE: 1730,
  DNK: 1700,
  NOR: 1680, // Haaland

  // Tier 3: mid-table
  USA: 1670,
  SWE: 1670, // Sweden, mid
  MEX: 1660,
  JPN: 1660,
  AUT: 1640,
  SEN: 1640,
  TUR: 1640,
  KOR: 1620,
  IRN: 1620,
  CHL: 1620,
  SCO: 1610,
  SRB: 1610,
  WAL: 1600,
  ECU: 1600,
  POL: 1600,
  PRY: 1580,
  CZE: 1580,
  AUS: 1580,
  IRL: 1560,
  HUN: 1560,
  SVK: 1560,
  BIH: 1560, // Bosnia
  COD: 1560, // DR Congo

  // Tier 4: lower
  EGY: 1530,
  NGA: 1530,
  CIV: 1530,
  PER: 1530,
  ROU: 1530,
  CAN: 1530,
  CPV: 1520, // Cape Verde (debut)
  VEN: 1500,
  CMR: 1500,
  GHA: 1500,
  TUN: 1500,
  KSA: 1490,
  ALG: 1490, // football-data uses ALG not DZA
  DZA: 1490,
  CRC: 1480,
  QAT: 1480,
  JAM: 1460,
  PAN: 1450,
  RSA: 1450, // football-data uses RSA not ZAF
  ZAF: 1450,
  UZB: 1450,
  BOL: 1430,
  IRQ: 1430,
  NZL: 1430,
  UAE: 1430,
  JOR: 1420,
  HND: 1410,
  SLV: 1380,
  LBN: 1380,
  TRI: 1370,
  HTI: 1360, // football-data uses HTI not HAI
  HAI: 1360,
  ANT: 1340, // football-data uses ANT for Curaçao
  CUW: 1340,
};

const DEFAULT_ELO = 1500;

async function main() {
  const { db } = await import("../lib/db");
  const { countries } = await import("../lib/db/schema");
  const { eq, sql } = await import("drizzle-orm");

  const all = await db
    .select({ id: countries.id, code: countries.code, name: countries.name })
    .from(countries);

  console.log(`Seeding Elos for ${all.length} countries...\n`);

  let updated = 0;
  let defaulted = 0;
  const missing: string[] = [];

  for (const c of all) {
    const elo = ELOS[c.code] ?? DEFAULT_ELO;
    await db
      .update(countries)
      .set({ elo: String(elo) })
      .where(eq(countries.id, c.id));
    if (ELOS[c.code] !== undefined) {
      updated++;
    } else {
      defaulted++;
      missing.push(`${c.code} (${c.name})`);
    }
  }

  console.log(`  ${updated} countries seeded from curated map`);
  console.log(`  ${defaulted} countries defaulted to ${DEFAULT_ELO}`);
  if (missing.length > 0) {
    console.log("\nUsing default Elo for (override via admin if needed):");
    for (const m of missing) console.log(`  - ${m}`);
  }

  // Print top + bottom for sanity.
  const ranked = await db
    .select({ code: countries.code, name: countries.name, elo: countries.elo })
    .from(countries)
    .orderBy(sql`elo desc nulls last`);

  console.log("\nTop 10 Elo:");
  for (const r of ranked.slice(0, 10)) {
    console.log(
      `  ${r.code}  ${Number(r.elo).toFixed(0)}  ${r.name}`
    );
  }
  console.log("\nBottom 10 Elo:");
  for (const r of ranked.slice(-10)) {
    console.log(
      `  ${r.code}  ${Number(r.elo).toFixed(0)}  ${r.name}`
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
