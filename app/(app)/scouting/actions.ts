"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  drafts,
  leagueMembers,
  leagues,
  personalRatings,
  playerFactorPercentiles,
  ratingProfileFactors,
  ratingProfiles,
} from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/server";
import {
  computePersonalRating,
  type FactorPercentile,
  type FactorWeight,
  type Importance,
} from "@/lib/personal-rating/compute";
import type { FactorId } from "@/lib/personal-rating/factors";

// ============================================================================
// Auth + lock helpers
// ============================================================================

async function requireAuthedProfile(): Promise<string> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return user.id;
}

/**
 * Throws if the draft is past 'scheduled' — profile mutations and rating
 * changes must be frozen once the auction goes live, otherwise managers
 * could reweight mid-draft to rationalize chases.
 *
 * No-op if there's no league yet (admin setup phase).
 */
async function assertNotLocked(): Promise<void> {
  const [league] = await db.select().from(leagues).limit(1);
  if (!league) return;
  const [draft] = await db
    .select({ status: drafts.status })
    .from(drafts)
    .where(eq(drafts.leagueId, league.id))
    .limit(1);
  if (draft && draft.status !== "scheduled") {
    throw new Error(
      `scouting profiles are locked (draft is ${draft.status})`
    );
  }
}

/**
 * Ensures the caller is a league member. Returns the league id for
 * downstream queries.
 */
async function requireLeagueMember(profileId: string): Promise<string> {
  const [league] = await db.select().from(leagues).limit(1);
  if (!league) throw new Error("no league");
  const [member] = await db
    .select()
    .from(leagueMembers)
    .where(
      and(
        eq(leagueMembers.leagueId, league.id),
        eq(leagueMembers.profileId, profileId)
      )
    )
    .limit(1);
  if (!member) throw new Error("not a league member");
  return league.id;
}

// ============================================================================
// Profile CRUD
// ============================================================================

export type ProfileFactorInput = {
  factor_id: FactorId;
  importance: Importance;
};

export async function createProfile(input: {
  name: string;
  description?: string;
  factors: ProfileFactorInput[];
}): Promise<{ profileId: string }> {
  const managerId = await requireAuthedProfile();
  await requireLeagueMember(managerId);
  await assertNotLocked();

  const name = input.name.trim();
  if (!name) throw new Error("name required");
  if (input.factors.length === 0) throw new Error("at least one factor required");

  const profileId = await db.transaction(async (tx) => {
    const [p] = await tx
      .insert(ratingProfiles)
      .values({
        managerId,
        name,
        description: input.description?.trim() || null,
      })
      .returning({ id: ratingProfiles.id });

    await tx.insert(ratingProfileFactors).values(
      input.factors.map((f) => ({
        profileId: p.id,
        factorId: f.factor_id,
        importance: f.importance,
      }))
    );

    return p.id;
  });

  revalidatePath("/scouting");
  return { profileId };
}

export async function updateProfile(input: {
  profileId: string;
  name?: string;
  description?: string;
  factors?: ProfileFactorInput[];
}): Promise<void> {
  const managerId = await requireAuthedProfile();
  await requireLeagueMember(managerId);
  await assertNotLocked();

  const [p] = await db
    .select()
    .from(ratingProfiles)
    .where(eq(ratingProfiles.id, input.profileId))
    .limit(1);
  if (!p) throw new Error("profile not found");
  if (p.managerId !== managerId) throw new Error("not your profile");

  await db.transaction(async (tx) => {
    const updates: { name?: string; description?: string | null; updatedAt: Date } = {
      updatedAt: new Date(),
    };
    if (input.name !== undefined) {
      const n = input.name.trim();
      if (!n) throw new Error("name cannot be blank");
      updates.name = n;
    }
    if (input.description !== undefined) {
      updates.description = input.description.trim() || null;
    }
    await tx
      .update(ratingProfiles)
      .set(updates)
      .where(eq(ratingProfiles.id, input.profileId));

    if (input.factors !== undefined) {
      if (input.factors.length === 0) throw new Error("at least one factor required");
      await tx
        .delete(ratingProfileFactors)
        .where(eq(ratingProfileFactors.profileId, input.profileId));
      await tx.insert(ratingProfileFactors).values(
        input.factors.map((f) => ({
          profileId: input.profileId,
          factorId: f.factor_id,
          importance: f.importance,
        }))
      );
    }
  });

  // Re-score any personal_ratings that were applied with this profile, so
  // numbers stay consistent with the updated weights.
  await rescoreRatingsForProfile(input.profileId);

  revalidatePath("/scouting");
  revalidatePath("/players");
}

export async function deleteProfile(profileId: string): Promise<void> {
  const managerId = await requireAuthedProfile();
  await requireLeagueMember(managerId);
  await assertNotLocked();

  const [p] = await db
    .select()
    .from(ratingProfiles)
    .where(eq(ratingProfiles.id, profileId))
    .limit(1);
  if (!p) return;
  if (p.managerId !== managerId) throw new Error("not your profile");

  // FK on personal_ratings.source_profile_id is `set null` — ratings
  // computed from this profile survive with source_profile_id=null. The
  // manager can re-rate them with a new profile later.
  await db.delete(ratingProfiles).where(eq(ratingProfiles.id, profileId));

  revalidatePath("/scouting");
}

// ============================================================================
// Per-player rating actions
// ============================================================================

/**
 * Apply a saved profile to a specific player → produce a personal_ratings row.
 * If `overrides` is provided, those factor weights replace the profile's
 * default for this player.
 */
export async function applyProfileToPlayer(input: {
  profileId: string;
  realPlayerId: string;
  overrides?: ProfileFactorInput[];
}): Promise<{ score: number; coverage: number; total: number }> {
  const managerId = await requireAuthedProfile();
  await requireLeagueMember(managerId);
  await assertNotLocked();

  // Load profile + factors, asserting ownership.
  const [profile] = await db
    .select()
    .from(ratingProfiles)
    .where(eq(ratingProfiles.id, input.profileId))
    .limit(1);
  if (!profile) throw new Error("profile not found");
  if (profile.managerId !== managerId) throw new Error("not your profile");

  const profileFactors = await db
    .select()
    .from(ratingProfileFactors)
    .where(eq(ratingProfileFactors.profileId, input.profileId));

  const effectiveWeights = mergeWithOverrides(profileFactors, input.overrides);
  const result = await scoreFromWeights(input.realPlayerId, effectiveWeights);

  await db
    .insert(personalRatings)
    .values({
      managerId,
      realPlayerId: input.realPlayerId,
      sourceProfileId: input.profileId,
      overrides: input.overrides ?? null,
      score: result.score.toFixed(2),
      coverageCount: result.coverage,
      totalFactors: result.total,
    })
    .onConflictDoUpdate({
      target: [personalRatings.managerId, personalRatings.realPlayerId],
      set: {
        sourceProfileId: input.profileId,
        overrides: input.overrides ?? null,
        score: result.score.toFixed(2),
        coverageCount: result.coverage,
        totalFactors: result.total,
        computedAt: new Date(),
      },
    });

  revalidatePath("/players");
  revalidatePath(`/players/${input.realPlayerId}`);
  return result;
}

export async function unratePlayer(realPlayerId: string): Promise<void> {
  const managerId = await requireAuthedProfile();
  await requireLeagueMember(managerId);
  await assertNotLocked();

  await db
    .delete(personalRatings)
    .where(
      and(
        eq(personalRatings.managerId, managerId),
        eq(personalRatings.realPlayerId, realPlayerId)
      )
    );

  revalidatePath("/players");
  revalidatePath(`/players/${realPlayerId}`);
}

// ============================================================================
// Internals
// ============================================================================

function mergeWithOverrides(
  base: Array<{ factorId: string; importance: string }>,
  overrides?: ProfileFactorInput[]
): FactorWeight[] {
  if (!overrides || overrides.length === 0) {
    return base.map((b) => ({
      factor_id: b.factorId as FactorId,
      importance: b.importance as Importance,
    }));
  }
  // Overrides REPLACE the base entirely — the design treats a per-player
  // override as "this player's weights, not a tweak of the profile's".
  // Simpler mental model; managers always see the full picker pre-filled
  // with the profile's defaults when they decide to override.
  return overrides.map((o) => ({
    factor_id: o.factor_id,
    importance: o.importance,
  }));
}

async function scoreFromWeights(
  realPlayerId: string,
  weights: FactorWeight[]
): Promise<{ score: number; coverage: number; total: number }> {
  if (weights.length === 0) {
    return { score: 50, coverage: 0, total: 0 };
  }
  const factorIds = weights.map((w) => w.factor_id);
  const rows = await db
    .select()
    .from(playerFactorPercentiles)
    .where(
      and(
        eq(playerFactorPercentiles.realPlayerId, realPlayerId),
        inArray(playerFactorPercentiles.factorId, factorIds)
      )
    );

  const percentiles: FactorPercentile[] = rows.map((r) => ({
    factor_id: r.factorId as FactorId,
    percentile: Number(r.percentile),
    has_data: r.hasData,
  }));

  return computePersonalRating(weights, percentiles);
}

/**
 * Re-score every personal_ratings row that was applied with this profile
 * (and without per-player overrides). Called from updateProfile so numbers
 * don't go stale after a weight change.
 */
async function rescoreRatingsForProfile(profileId: string): Promise<void> {
  const factors = await db
    .select()
    .from(ratingProfileFactors)
    .where(eq(ratingProfileFactors.profileId, profileId));
  if (factors.length === 0) return;

  const weights: FactorWeight[] = factors.map((f) => ({
    factor_id: f.factorId as FactorId,
    importance: f.importance as Importance,
  }));

  // Only re-score rows where the manager didn't set per-player overrides;
  // overridden rows have their own custom weights and shouldn't change.
  const ratings = await db
    .select()
    .from(personalRatings)
    .where(eq(personalRatings.sourceProfileId, profileId));

  for (const r of ratings) {
    if (r.overrides && r.overrides.length > 0) continue;
    const result = await scoreFromWeights(r.realPlayerId, weights);
    await db
      .update(personalRatings)
      .set({
        score: result.score.toFixed(2),
        coverageCount: result.coverage,
        totalFactors: result.total,
        computedAt: new Date(),
      })
      .where(eq(personalRatings.id, r.id));
  }
}
