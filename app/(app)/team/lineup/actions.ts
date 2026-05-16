"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  fixtures,
  leagueMembers,
  leagues,
  managerLineups,
  realPlayers,
  rosters,
} from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/server";
import {
  isFormationKey,
  type FormationKey,
} from "@/lib/lineup/formations";
import {
  isValid,
  validateLineup,
  WC_RULES,
  type LineupDraft,
  type RosterPlayer,
} from "@/lib/lineup/validate";
import { computeLockTime, isLocked } from "@/lib/lineup/lock";
import type { Position } from "@/lib/scoring/points";

// ----------------------------------------------------------------------------
// Auth
// ----------------------------------------------------------------------------

async function requireProfileId(): Promise<string> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return user.id;
}

// ----------------------------------------------------------------------------
// Save lineup — upsert, validated server-side
// ----------------------------------------------------------------------------

export type SaveLineupInput = {
  matchday: number;
  formation: string;
  starterIds: string[];
  benchIds: string[];
  captainId: string;
  viceId: string;
};

export async function saveLineup(input: SaveLineupInput) {
  const profileId = await requireProfileId();

  if (!isFormationKey(input.formation)) {
    throw new Error(`unknown formation: ${input.formation}`);
  }
  if (!Number.isInteger(input.matchday) || input.matchday < 0) {
    throw new Error("invalid matchday");
  }

  // 1. Lock check — load fixtures for this MD, compute lock-time, refuse if past it.
  const md = input.matchday;
  const mdFixtures = await db
    .select({ kickoffAt: fixtures.kickoffAt })
    .from(fixtures)
    .where(eq(fixtures.matchday, md));
  const lockTime = computeLockTime(mdFixtures);
  if (isLocked(lockTime)) {
    throw new Error(
      `Matchday ${md} is locked. Lineup edits closed at ` +
        `${lockTime?.toISOString()}.`
    );
  }

  // 2. Load roster — current owned players, with positions.
  const [league] = await db.select().from(leagues).limit(1);
  if (!league) throw new Error("league not set up yet");

  const rosterRows = await db
    .select({
      realPlayerId: rosters.realPlayerId,
      position: realPlayers.position,
    })
    .from(rosters)
    .innerJoin(realPlayers, eq(realPlayers.id, rosters.realPlayerId))
    .where(
      and(
        eq(rosters.leagueId, league.id),
        eq(rosters.profileId, profileId),
        sql`${rosters.droppedAt} is null`
      )
    );

  const roster: RosterPlayer[] = rosterRows.map((r) => ({
    realPlayerId: r.realPlayerId,
    position: r.position as Position,
  }));

  // 3. Validate against WC rules (11 starters + 4 bench, position quotas).
  const draft: LineupDraft = {
    formation: input.formation as FormationKey,
    starters: input.starterIds,
    bench: input.benchIds,
    captainId: input.captainId,
    viceId: input.viceId,
  };
  const errors = validateLineup(draft, roster, WC_RULES);
  if (!isValid(errors)) {
    throw new Error(
      "lineup invalid: " +
        errors
          .map((e) => `[${e.code}]`)
          .join(", ")
    );
  }

  // 4. Upsert into manager_lineups. lockedAt stays null until isLocked flips.
  await db
    .insert(managerLineups)
    .values({
      profileId,
      matchday: md,
      formation: input.formation,
      starterIds: input.starterIds,
      benchIds: input.benchIds,
      captainId: input.captainId,
      viceId: input.viceId,
      isAutoFilled: false,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [managerLineups.profileId, managerLineups.matchday],
      set: {
        formation: input.formation,
        starterIds: input.starterIds,
        benchIds: input.benchIds,
        captainId: input.captainId,
        viceId: input.viceId,
        isAutoFilled: false,
        updatedAt: new Date(),
      },
    });

  revalidatePath(`/team/lineup/${md}`);
  revalidatePath("/team");
  revalidatePath("/dashboard");
}

// ----------------------------------------------------------------------------
// Auto-fill from prior matchday
// ----------------------------------------------------------------------------

/**
 * Copy the manager's most recent lineup (matchday < target) into the
 * target matchday. Used as a one-click "start from last week" affordance
 * and as the fallback when a matchday is about to lock with no lineup set.
 *
 * Returns the matchday it copied from, or null if there was nothing to
 * copy.
 */
export async function autoFillFromPriorMatchday(
  targetMatchday: number
): Promise<number | null> {
  const profileId = await requireProfileId();

  // Lock check for the target
  const mdFixtures = await db
    .select({ kickoffAt: fixtures.kickoffAt })
    .from(fixtures)
    .where(eq(fixtures.matchday, targetMatchday));
  if (isLocked(computeLockTime(mdFixtures))) {
    throw new Error(`Matchday ${targetMatchday} is locked.`);
  }

  // Latest prior lineup
  const [prior] = await db
    .select()
    .from(managerLineups)
    .where(
      and(
        eq(managerLineups.profileId, profileId),
        sql`${managerLineups.matchday} < ${targetMatchday}`
      )
    )
    .orderBy(desc(managerLineups.matchday))
    .limit(1);

  if (!prior) return null;

  await db
    .insert(managerLineups)
    .values({
      profileId,
      matchday: targetMatchday,
      formation: prior.formation,
      starterIds: prior.starterIds,
      benchIds: prior.benchIds,
      captainId: prior.captainId,
      viceId: prior.viceId,
      isAutoFilled: true,
      updatedAt: new Date(),
    })
    .onConflictDoNothing({
      target: [managerLineups.profileId, managerLineups.matchday],
    });

  revalidatePath(`/team/lineup/${targetMatchday}`);
  return prior.matchday;
}

// ----------------------------------------------------------------------------
// Stamp lockedAt on lineups whose matchday window has passed -6h
// ----------------------------------------------------------------------------

/**
 * Idempotent: stamps lockedAt on any lineup whose MD's earliest fixture is
 * now within 6h. Safe to call on every page load — UPDATE WHERE lockedAt
 * IS NULL means it's a no-op once stamped.
 *
 * Returns the count of rows updated.
 */
export async function stampLineupLocks(matchday: number): Promise<number> {
  const mdFixtures = await db
    .select({ kickoffAt: fixtures.kickoffAt })
    .from(fixtures)
    .where(eq(fixtures.matchday, matchday));
  const lockTime = computeLockTime(mdFixtures);
  if (!isLocked(lockTime)) return 0;

  const result = await db
    .update(managerLineups)
    .set({ lockedAt: new Date() })
    .where(
      and(
        eq(managerLineups.matchday, matchday),
        sql`${managerLineups.lockedAt} is null`
      )
    )
    .returning({ id: managerLineups.id });
  return result.length;
}
