/**
 * Bracket Monte Carlo: writes countries.expected_matches.
 *
 * Library-callable. CLI wrapper lives in scripts/simulate-bracket.ts.
 */

import { db } from "@/lib/db";
import { countries } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { runMonteCarlo, DEFAULT_ELO } from "@/lib/sim/bracket";

export type SimBracketResult = {
  sims: number;
  teamsCount: number;
  top10: Array<{
    code: string;
    name: string;
    elo: number;
    expectedMatches: number;
    championPct: number;
    finalPct: number;
    sfPct: number;
    qfPct: number;
  }>;
  durationMs: number;
};

export async function runSimulateBracket(opts?: {
  sims?: number;
}): Promise<SimBracketResult> {
  const t0 = Date.now();
  const sims = opts?.sims ?? 10_000;
  if (!Number.isFinite(sims) || sims < 100) {
    throw new Error("sims must be a positive integer ≥ 100");
  }

  const all = await db
    .select({
      id: countries.id,
      code: countries.code,
      name: countries.name,
      elo: countries.elo,
      groupLetter: countries.groupLetter,
    })
    .from(countries);

  const teams = all.map((c) => ({
    id: c.id,
    code: c.code,
    name: c.name,
    elo: c.elo !== null ? Number(c.elo) : DEFAULT_ELO,
    groupLetter: c.groupLetter,
  }));

  const result = runMonteCarlo(teams, sims);

  const ranked = teams
    .map((t) => ({
      ...t,
      expected: result.expectedMatches.get(t.id) ?? 0,
      stage: result.stageProb.get(t.id)!,
    }))
    .sort((a, b) => b.expected - a.expected);

  const top10 = ranked.slice(0, 10).map((r) => ({
    code: r.code,
    name: r.name,
    elo: Number(r.elo),
    expectedMatches: r.expected,
    championPct: r.stage.champion * 100,
    finalPct: r.stage.final * 100,
    sfPct: r.stage.sf * 100,
    qfPct: r.stage.qf * 100,
  }));

  const now = new Date();
  for (const r of ranked) {
    await db
      .update(countries)
      .set({
        expectedMatches: r.expected.toFixed(2),
        expectedMatchesUpdatedAt: now,
      })
      .where(eq(countries.id, r.id));
  }

  return {
    sims,
    teamsCount: teams.length,
    top10,
    durationMs: Date.now() - t0,
  };
}
