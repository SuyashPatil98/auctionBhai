/**
 * Prediction scoring sweep.
 *
 * Scores (or re-scores) every prediction whose fixture has finished. The
 * pure math lives in lib/predictions/score.ts; this just loads inputs and
 * writes results.
 *
 * Render-safe: no auth check, no revalidatePath. Safe to call from a server
 * component render (mirrors lib/auction/finalize.ts), a server action, or the
 * cron endpoint. Callers in mutation contexts handle their own revalidation.
 *
 * Gated on `status = 'ft'` — NOT merely "score is non-null" — so an in-play
 * or partial score never scores a prediction prematurely. Recomputes for ALL
 * finished fixtures (not just unscored ones) so a corrected score propagates,
 * but only writes rows whose stored points actually change. Idempotent.
 */

import "server-only";
import { and, eq, isNotNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { fixtures, predictions } from "@/lib/db/schema";
import { scorePrediction } from "./score";

export async function sweepPredictions(): Promise<{ scored: number }> {
  const rows = await db
    .select({
      predictionId: predictions.id,
      pHome: predictions.homeScore,
      pAway: predictions.awayScore,
      aHome: fixtures.homeScore,
      aAway: fixtures.awayScore,
      current: predictions.pointsAwarded,
    })
    .from(predictions)
    .innerJoin(fixtures, eq(fixtures.id, predictions.fixtureId))
    .where(
      and(
        eq(fixtures.status, "ft"),
        isNotNull(fixtures.homeScore),
        isNotNull(fixtures.awayScore)
      )
    );

  let scored = 0;
  for (const r of rows) {
    if (r.aHome === null || r.aAway === null) continue;
    const pts = scorePrediction(
      { homeScore: r.pHome, awayScore: r.pAway },
      { homeScore: r.aHome, awayScore: r.aAway }
    );
    if (r.current === pts) continue; // already correct — skip the write
    await db
      .update(predictions)
      .set({ pointsAwarded: pts })
      .where(eq(predictions.id, r.predictionId));
    scored++;
  }

  return { scored };
}
