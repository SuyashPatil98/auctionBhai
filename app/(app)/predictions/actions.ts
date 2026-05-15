"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  fixtures,
  predictions,
} from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/server";
import { scorePrediction } from "@/lib/predictions/score";

async function requireAuthedProfile(): Promise<string> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return user.id;
}

/**
 * Save (insert or update) my prediction for a fixture. Refuses if the
 * fixture has already kicked off — predictions lock at kickoff.
 */
export async function savePrediction(formData: FormData) {
  const profileId = await requireAuthedProfile();
  const fixtureId = String(formData.get("fixture_id") ?? "");
  const homeScore = Number.parseInt(
    String(formData.get("home_score") ?? ""),
    10
  );
  const awayScore = Number.parseInt(
    String(formData.get("away_score") ?? ""),
    10
  );
  if (
    !fixtureId ||
    !Number.isFinite(homeScore) ||
    homeScore < 0 ||
    !Number.isFinite(awayScore) ||
    awayScore < 0
  ) {
    throw new Error("invalid prediction");
  }

  // Lock check against kickoff
  const [fixture] = await db
    .select({
      kickoff: fixtures.kickoffAt,
      homeFinal: fixtures.homeScore,
      awayFinal: fixtures.awayScore,
    })
    .from(fixtures)
    .where(eq(fixtures.id, fixtureId))
    .limit(1);
  if (!fixture) throw new Error("fixture not found");
  if (fixture.kickoff.getTime() <= Date.now()) {
    throw new Error("locked: fixture already kicked off");
  }

  // Compute points NOW only if the fixture is somehow already finalised
  // (shouldn't be — but defensive). Otherwise points stays NULL and gets
  // filled in when the fixture is finalised.
  const pointsAwarded =
    fixture.homeFinal !== null && fixture.awayFinal !== null
      ? scorePrediction(
          { homeScore, awayScore },
          { homeScore: fixture.homeFinal, awayScore: fixture.awayFinal }
        )
      : null;

  await db
    .insert(predictions)
    .values({
      profileId,
      fixtureId,
      homeScore,
      awayScore,
      pointsAwarded,
    })
    .onConflictDoUpdate({
      target: [predictions.profileId, predictions.fixtureId],
      set: {
        homeScore,
        awayScore,
        pointsAwarded,
        updatedAt: sql`now()`,
      },
    });

  revalidatePath("/predictions");
  revalidatePath("/dashboard");
}

export async function clearPrediction(formData: FormData) {
  const profileId = await requireAuthedProfile();
  const fixtureId = String(formData.get("fixture_id") ?? "");
  if (!fixtureId) throw new Error("fixture_id required");

  const [fixture] = await db
    .select({ kickoff: fixtures.kickoffAt })
    .from(fixtures)
    .where(eq(fixtures.id, fixtureId))
    .limit(1);
  if (!fixture) throw new Error("fixture not found");
  if (fixture.kickoff.getTime() <= Date.now()) {
    throw new Error("locked: fixture already kicked off");
  }

  await db
    .delete(predictions)
    .where(
      and(
        eq(predictions.profileId, profileId),
        eq(predictions.fixtureId, fixtureId)
      )
    );

  revalidatePath("/predictions");
}

/**
 * Backfill: for every fixture with a final score that has predictions with
 * NULL points_awarded, compute and store points. Idempotent — safe to call
 * any time after match-stat entry, or once daily during the tournament.
 *
 * Returns the number of predictions scored.
 */
export async function scoreFinalisedFixtures(): Promise<{ scored: number }> {
  await requireAuthedProfile();

  // Pull all finalised fixtures + their as-yet-unscored predictions in one
  // round trip.
  const rows = await db
    .select({
      predictionId: predictions.id,
      pHome: predictions.homeScore,
      pAway: predictions.awayScore,
      aHome: fixtures.homeScore,
      aAway: fixtures.awayScore,
    })
    .from(predictions)
    .innerJoin(fixtures, eq(fixtures.id, predictions.fixtureId))
    .where(
      and(
        isNotNull(fixtures.homeScore),
        isNotNull(fixtures.awayScore),
        sql`${predictions.pointsAwarded} is null`
      )
    );

  let scored = 0;
  for (const r of rows) {
    if (r.aHome === null || r.aAway === null) continue;
    const pts = scorePrediction(
      { homeScore: r.pHome, awayScore: r.pAway },
      { homeScore: r.aHome, awayScore: r.aAway }
    );
    await db
      .update(predictions)
      .set({ pointsAwarded: pts })
      .where(eq(predictions.id, r.predictionId));
    scored++;
  }

  revalidatePath("/predictions");
  revalidatePath("/dashboard");
  return { scored };
}
