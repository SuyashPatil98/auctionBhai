"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  countries,
  drafts,
  leagueMembers,
  leagues,
  personalRatings,
  playerFactorPercentiles,
  ratingProfileFactors,
  ratingProfiles,
  realPlayers,
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

// ============================================================================
// Bulk apply — rate many players at once with one formula
// ============================================================================

export type BulkFilters = {
  position?: "GK" | "DEF" | "MID" | "FWD" | null;
  countryCode?: string | null;
  query?: string | null; // matches against full_name + display_name
  skipExisting?: boolean; // if true, only insert; don't overwrite manual ratings
};

export type BulkResult = {
  matched: number;
  inserted: number;
  updated: number;
  skipped: number;
};

/**
 * Apply a saved profile to every player matching the filter (or every player
 * if no filter). Each row in personal_ratings is upserted, EXCEPT when the
 * row has manager overrides — those are personalized and we leave them.
 *
 * Filter behavior:
 *   - position: narrow to GK/DEF/MID/FWD
 *   - countryCode: narrow by ISO/FIFA code (matches countries.code)
 *   - query: substring match against full_name OR display_name
 *   - skipExisting: when true, never overwrite — only rate new players
 *
 * Returns counts so the UI can say "rated 47 players (4 already rated,
 * skipped)" or similar.
 */
export async function applyProfileBulk(input: {
  profileId: string;
  filters?: BulkFilters;
}): Promise<BulkResult> {
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
  if (profileFactors.length === 0) {
    throw new Error("profile has no factors");
  }

  const weights: FactorWeight[] = profileFactors.map((f) => ({
    factor_id: f.factorId as FactorId,
    importance: f.importance as Importance,
  }));

  // Resolve filters into a player_id list.
  const filters = input.filters ?? {};
  const conditions = [eq(realPlayers.isActive, true)];
  if (filters.position) {
    conditions.push(eq(realPlayers.position, filters.position));
  }
  if (filters.countryCode) {
    conditions.push(eq(countries.code, filters.countryCode.toUpperCase()));
  }
  if (filters.query && filters.query.trim()) {
    const like = `%${filters.query.trim()}%`;
    conditions.push(
      or(
        ilike(realPlayers.fullName, like),
        ilike(realPlayers.displayName, like)
      )!
    );
  }

  const candidatePlayers = await db
    .select({
      id: realPlayers.id,
    })
    .from(realPlayers)
    .innerJoin(countries, eq(countries.id, realPlayers.countryId))
    .where(and(...conditions));

  if (candidatePlayers.length === 0) {
    return { matched: 0, inserted: 0, updated: 0, skipped: 0 };
  }
  const candidateIds = candidatePlayers.map((p) => p.id);

  // Bulk-fetch percentiles for all candidates × the factors in this profile.
  // One query — saves N round-trips.
  const factorIds = weights.map((w) => w.factor_id);
  const pctRows = await db
    .select({
      realPlayerId: playerFactorPercentiles.realPlayerId,
      factorId: playerFactorPercentiles.factorId,
      percentile: playerFactorPercentiles.percentile,
      hasData: playerFactorPercentiles.hasData,
    })
    .from(playerFactorPercentiles)
    .where(
      and(
        inArray(playerFactorPercentiles.realPlayerId, candidateIds),
        inArray(playerFactorPercentiles.factorId, factorIds)
      )
    );

  // Index percentiles by player.
  const pctByPlayer = new Map<string, FactorPercentile[]>();
  for (const r of pctRows) {
    const arr = pctByPlayer.get(r.realPlayerId) ?? [];
    arr.push({
      factor_id: r.factorId as FactorId,
      percentile: Number(r.percentile),
      has_data: r.hasData,
    });
    pctByPlayer.set(r.realPlayerId, arr);
  }

  // Pre-fetch existing personal_ratings for these players so we know
  // which rows are inserts vs updates and which have overrides.
  const existing = await db
    .select({
      realPlayerId: personalRatings.realPlayerId,
      hasOverrides: sql<boolean>`coalesce(${personalRatings.overrides} is not null and jsonb_array_length(${personalRatings.overrides}) > 0, false)`,
    })
    .from(personalRatings)
    .where(
      and(
        eq(personalRatings.managerId, managerId),
        inArray(personalRatings.realPlayerId, candidateIds)
      )
    );
  const existingByPlayer = new Map<string, { hasOverrides: boolean }>();
  for (const r of existing) {
    existingByPlayer.set(r.realPlayerId, { hasOverrides: r.hasOverrides });
  }

  let inserted = 0;
  let updated = 0;
  let skipped = 0;

  // Score + upsert each. Group inserts/updates to keep the tx tight.
  type Row = {
    realPlayerId: string;
    score: string;
    coverageCount: number;
    totalFactors: number;
  };
  const toInsert: Row[] = [];
  const toUpdate: Row[] = [];

  for (const id of candidateIds) {
    const ex = existingByPlayer.get(id);
    // Never blow away a manager's per-player overrides — those are
    // intentional customization beyond the profile's defaults.
    if (ex?.hasOverrides) {
      skipped++;
      continue;
    }
    if (filters.skipExisting && ex) {
      skipped++;
      continue;
    }
    const percentiles = pctByPlayer.get(id) ?? [];
    const result = computePersonalRating(weights, percentiles);
    const row: Row = {
      realPlayerId: id,
      score: result.score.toFixed(2),
      coverageCount: result.coverage,
      totalFactors: result.total,
    };
    if (ex) {
      toUpdate.push(row);
    } else {
      toInsert.push(row);
    }
  }

  if (toInsert.length > 0 || toUpdate.length > 0) {
    await db.transaction(async (tx) => {
      // Bulk insert in chunks.
      const CHUNK = 200;
      for (let i = 0; i < toInsert.length; i += CHUNK) {
        const slice = toInsert.slice(i, i + CHUNK);
        await tx.insert(personalRatings).values(
          slice.map((r) => ({
            managerId,
            realPlayerId: r.realPlayerId,
            sourceProfileId: input.profileId,
            overrides: null,
            score: r.score,
            coverageCount: r.coverageCount,
            totalFactors: r.totalFactors,
          }))
        );
        inserted += slice.length;
      }
      // Bulk updates — drizzle doesn't have multi-row update so issue
      // one per row. ~30 players = quick. ~1213 still under a few sec.
      for (const r of toUpdate) {
        await tx
          .update(personalRatings)
          .set({
            sourceProfileId: input.profileId,
            overrides: null,
            score: r.score,
            coverageCount: r.coverageCount,
            totalFactors: r.totalFactors,
            computedAt: new Date(),
          })
          .where(
            and(
              eq(personalRatings.managerId, managerId),
              eq(personalRatings.realPlayerId, r.realPlayerId)
            )
          );
        updated++;
      }
    });
  }

  revalidatePath("/players");
  revalidatePath("/scouting/profiles");
  return {
    matched: candidateIds.length,
    inserted,
    updated,
    skipped,
  };
}

// ============================================================================
// Clear / reset — bulk removal of personal ratings
// ============================================================================

/**
 * Remove every personal_rating row this manager created via the given
 * profile. Manual overrides set later are also wiped if their
 * source_profile_id still points to this profile.
 *
 * Useful when a manager wants to redo their evaluation for a position —
 * change the formula, clear the old ratings, re-apply.
 */
export async function clearRatingsForProfile(profileId: string): Promise<{
  deleted: number;
}> {
  const managerId = await requireAuthedProfile();
  await requireLeagueMember(managerId);
  await assertNotLocked();

  // Verify ownership of the profile.
  const [profile] = await db
    .select()
    .from(ratingProfiles)
    .where(eq(ratingProfiles.id, profileId))
    .limit(1);
  if (!profile) throw new Error("profile not found");
  if (profile.managerId !== managerId) throw new Error("not your profile");

  const rows = await db
    .delete(personalRatings)
    .where(
      and(
        eq(personalRatings.managerId, managerId),
        eq(personalRatings.sourceProfileId, profileId)
      )
    )
    .returning({ id: personalRatings.id });

  revalidatePath("/players");
  revalidatePath("/scouting/profiles");
  return { deleted: rows.length };
}

/**
 * Wipe ALL of this manager's personal ratings — across every profile,
 * including manual per-player overrides. Their scouting list goes
 * fully blank.
 */
export async function clearAllMyRatings(): Promise<{ deleted: number }> {
  const managerId = await requireAuthedProfile();
  await requireLeagueMember(managerId);
  await assertNotLocked();

  const rows = await db
    .delete(personalRatings)
    .where(eq(personalRatings.managerId, managerId))
    .returning({ id: personalRatings.id });

  revalidatePath("/players");
  revalidatePath("/scouting/profiles");
  return { deleted: rows.length };
}
