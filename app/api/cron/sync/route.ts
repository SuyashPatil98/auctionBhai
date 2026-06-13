/**
 * Scheduled sync — the automatic "fetch results after a match" job.
 *
 * Runs three idempotent steps in order:
 *   1. ingestFixtures()          → pull fresh scores + status from
 *                                  football-data.org (one API call).
 *   2. sweepPredictions()        → score the score-prediction side-game.
 *   3. sweepAllActiveMatchdays() → re-settle fantasy standings for every
 *                                  matchday with finalized player stats.
 *
 * It deliberately does NOT auto-import per-player stats or auto-finalize
 * fixtures — that path keeps a steward review step by design (see CLAUDE.md
 * and importMatchStatsFromApi). This job only needs the fixture score, which
 * is all predictions require, and it leaves fantasy stat entry to stewards.
 *
 * Auth: Vercel Cron sends `Authorization: Bearer ${CRON_SECRET}` automatically.
 * If CRON_SECRET is set, we require it (so the public URL can't be abused, and
 * a free external pinger like cron-job.org can call it with the same header).
 * If it's unset (local dev), the route is open.
 *
 * Wired in vercel.json. On Vercel Hobby, crons are throttled to ~once/day —
 * fine as a backstop; the predictions page self-heals on every open, and the
 * /admin "Refresh everything" button runs the same steps on demand. For live
 * cadence during the tournament, point a free external cron at this URL.
 */

import { NextResponse } from "next/server";
import { ingestFixtures } from "@/lib/ingest/football-data";
import { sweepPredictions } from "@/lib/predictions/sweep";
import { sweepAllActiveMatchdays } from "@/lib/scoring/sweep";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  const startedAt = new Date().toISOString();
  const out: Record<string, unknown> = { ok: true, startedAt };

  try {
    const fx = await ingestFixtures();
    out.fixtures = { rowsChanged: fx.rowsChanged, notes: fx.notes };
  } catch (e) {
    out.ok = false;
    out.fixturesError = e instanceof Error ? e.message : String(e);
  }

  try {
    out.predictions = await sweepPredictions();
  } catch (e) {
    out.ok = false;
    out.predictionsError = e instanceof Error ? e.message : String(e);
  }

  try {
    const reports = await sweepAllActiveMatchdays();
    out.matchdays = reports.map((r) => ({
      matchday: r.matchday,
      managersScored: r.managersScored,
    }));
  } catch (e) {
    out.ok = false;
    out.matchdaysError = e instanceof Error ? e.message : String(e);
  }

  out.finishedAt = new Date().toISOString();
  return NextResponse.json(out, { status: out.ok ? 200 : 500 });
}
