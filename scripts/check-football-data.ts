/**
 * Capability check for football-data.org.
 *
 * Lists every competition our API token can access and flags whether the
 * FIFA World Cup 2026 is one of them. Run before building the ingestion
 * pipeline to make sure the free-tier scope covers the tournament.
 *
 * Usage: pnpm check:fd
 */

import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env" });

import {
  listCompetitions,
  getCompetition,
  rateLimitSnapshot,
  FootballDataError,
} from "../lib/external/football-data";

async function main() {
  console.log("Checking football-data.org access...\n");

  const { count, competitions } = await listCompetitions();
  console.log(`Token can see ${count} competitions:\n`);

  // Group by plan tier for readability.
  const byPlan: Record<string, typeof competitions> = {};
  for (const c of competitions) {
    const key = c.plan ?? "UNKNOWN";
    (byPlan[key] ??= []).push(c);
  }

  for (const [plan, list] of Object.entries(byPlan).sort()) {
    console.log(`  [${plan}]  ${list.length} competitions`);
    for (const c of list) {
      console.log(
        `    - ${c.code.padEnd(6)} (${String(c.id).padEnd(4)}) ${c.name}${
          c.area ? ` — ${c.area.name}` : ""
        }`
      );
    }
    console.log();
  }

  // Look for the World Cup specifically.
  const wcCandidates = competitions.filter(
    (c) =>
      c.code === "WC" ||
      /world\s*cup/i.test(c.name) ||
      c.type === "WORLD_CUP" ||
      c.type === "WORLDCUP"
  );

  if (wcCandidates.length === 0) {
    console.log(
      "❌ No World Cup competition visible to this token. The 2026 edition is probably gated behind a paid tier on football-data.org."
    );
    console.log(
      "   Fallback: use TheSportsDB (free, no key) for fixtures + squads."
    );
  } else {
    console.log("✅ World Cup candidate(s) found:");
    for (const wc of wcCandidates) {
      console.log(
        `    - id=${wc.id} code=${wc.code} ${wc.name} plan=${wc.plan ?? "?"}`
      );
      if (wc.currentSeason) {
        console.log(
          `        season: ${wc.currentSeason.startDate} → ${wc.currentSeason.endDate}`
        );
      }
    }

    // Probe deeper on the first match.
    const wc = wcCandidates[0];
    console.log(`\nProbing /competitions/${wc.code} for season detail...`);
    try {
      const detail = await getCompetition(wc.code);
      console.log(
        `    current season: ${detail.currentSeason?.startDate ?? "?"} → ${
          detail.currentSeason?.endDate ?? "?"
        }`
      );
    } catch (err) {
      if (err instanceof FootballDataError) {
        console.log(
          `    ⚠ ${wc.code} listed but not accessible: ${err.status} — ${err.message}`
        );
      } else {
        throw err;
      }
    }
  }

  const snap = rateLimitSnapshot();
  console.log(
    `\nRate limit: ${snap.remaining} req(s) remaining this minute. ` +
      `Resets at ${
        snap.resetAt ? new Date(snap.resetAt).toLocaleTimeString() : "unknown"
      }.`
  );
}

main().catch((err) => {
  if (err instanceof FootballDataError) {
    console.error(`\nfootball-data error ${err.status}: ${err.message}`);
    if (err.body) console.error(err.body);
  } else {
    console.error(err);
  }
  process.exit(1);
});
