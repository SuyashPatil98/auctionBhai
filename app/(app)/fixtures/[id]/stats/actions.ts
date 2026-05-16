"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  fixtureLineups,
  fixtures,
  playerMatchStats,
  profiles,
  realPlayers,
} from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/server";

// ----------------------------------------------------------------------------
// Auth + permission
// ----------------------------------------------------------------------------

async function requireProfileId(): Promise<string> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return user.id;
}

/**
 * Edit gate: any signed-in user can edit fixture stats. The 4-friend trust
 * model treats stewards as a coordination signal ("you're scheduled for
 * this one"), not a security boundary — anyone can pinch-hit.
 *
 * Destructive paths (unfinalize) still require commissioner.
 */
async function assertCanEdit(_fixtureId: string, _profileId: string) {
  // intentional no-op — see comment above
}

// ----------------------------------------------------------------------------
// Score + status
// ----------------------------------------------------------------------------

export async function setFixtureScore(
  fixtureId: string,
  homeScore: number,
  awayScore: number
) {
  const me = await requireProfileId();
  await assertCanEdit(fixtureId, me);
  if (!Number.isInteger(homeScore) || homeScore < 0) {
    throw new Error("home score must be a non-negative integer");
  }
  if (!Number.isInteger(awayScore) || awayScore < 0) {
    throw new Error("away score must be a non-negative integer");
  }

  await db
    .update(fixtures)
    .set({
      homeScore,
      awayScore,
      // Bump status to "ft" if it wasn't already in a finished/active state.
      status: sql`case when ${fixtures.status} in ('scheduled', 'live', 'ht') then 'ft' else ${fixtures.status} end`,
      lastSyncedAt: new Date(),
    })
    .where(eq(fixtures.id, fixtureId));

  // Recompute derived stats: clean sheet for all GKs/DEFs/MIDs etc. on each side.
  await recomputeCleanSheetsForFixture(fixtureId);

  revalidatePath(`/fixtures/${fixtureId}`);
  revalidatePath(`/fixtures/${fixtureId}/stats`);
}

// ----------------------------------------------------------------------------
// Player stats — upsert one row at a time (server actions are small)
// ----------------------------------------------------------------------------

export type PlayerStatInput = {
  realPlayerId: string;
  side: "home" | "away";
  isStarter: boolean;
  minutes: number;
  goals?: number;
  assists?: number;
  yellows?: number;
  reds?: number;
  ownGoals?: number;
  pensMissed?: number;
  penSaves?: number;
};

export async function upsertPlayerStats(
  fixtureId: string,
  input: PlayerStatInput
) {
  const me = await requireProfileId();
  await assertCanEdit(fixtureId, me);

  // Verify the player exists (cheap sanity check)
  const [p] = await db
    .select({ id: realPlayers.id })
    .from(realPlayers)
    .where(eq(realPlayers.id, input.realPlayerId))
    .limit(1);
  if (!p) throw new Error("unknown player");

  // Sanity on numbers
  const num = (v: number | undefined) => Math.max(0, Math.floor(v ?? 0));
  const minutes = Math.min(Math.max(0, Math.floor(input.minutes)), 130);

  // 1. Lineup row (side + isStarter + minutes mirror)
  await db
    .insert(fixtureLineups)
    .values({
      fixtureId,
      realPlayerId: input.realPlayerId,
      side: input.side,
      isStarter: input.isStarter,
      minutesPlayed: minutes,
    })
    .onConflictDoUpdate({
      target: [fixtureLineups.fixtureId, fixtureLineups.realPlayerId],
      set: {
        side: input.side,
        isStarter: input.isStarter,
        minutesPlayed: minutes,
      },
    });

  // 2. Aggregate stats — cleanSheet + goalsConceded computed by sweep below
  await db
    .insert(playerMatchStats)
    .values({
      fixtureId,
      realPlayerId: input.realPlayerId,
      minutes,
      goals: num(input.goals),
      assists: num(input.assists),
      yellows: num(input.yellows),
      reds: num(input.reds),
      ownGoals: num(input.ownGoals),
      pensMissed: num(input.pensMissed),
      penSaves: num(input.penSaves),
      // cleanSheet + goalsConceded recomputed below from fixture score
    })
    .onConflictDoUpdate({
      target: [playerMatchStats.fixtureId, playerMatchStats.realPlayerId],
      set: {
        minutes,
        goals: num(input.goals),
        assists: num(input.assists),
        yellows: num(input.yellows),
        reds: num(input.reds),
        ownGoals: num(input.ownGoals),
        pensMissed: num(input.pensMissed),
        penSaves: num(input.penSaves),
        computedAt: new Date(),
      },
    });

  await recomputeCleanSheetsForFixture(fixtureId);

  revalidatePath(`/fixtures/${fixtureId}`);
  revalidatePath(`/fixtures/${fixtureId}/stats`);
}

export async function removePlayerFromFixture(
  fixtureId: string,
  realPlayerId: string
) {
  const me = await requireProfileId();
  await assertCanEdit(fixtureId, me);

  await db
    .delete(playerMatchStats)
    .where(
      and(
        eq(playerMatchStats.fixtureId, fixtureId),
        eq(playerMatchStats.realPlayerId, realPlayerId)
      )
    );
  await db
    .delete(fixtureLineups)
    .where(
      and(
        eq(fixtureLineups.fixtureId, fixtureId),
        eq(fixtureLineups.realPlayerId, realPlayerId)
      )
    );

  revalidatePath(`/fixtures/${fixtureId}`);
  revalidatePath(`/fixtures/${fixtureId}/stats`);
}

// ----------------------------------------------------------------------------
// Finalize / unfinalize
// ----------------------------------------------------------------------------

export async function finalizeFixtureStats(fixtureId: string) {
  const me = await requireProfileId();
  await assertCanEdit(fixtureId, me);

  await db
    .update(fixtures)
    .set({
      statsFinalizedAt: new Date(),
      status: sql`case when ${fixtures.status} in ('scheduled', 'live', 'ht') then 'ft' else ${fixtures.status} end`,
    })
    .where(eq(fixtures.id, fixtureId));

  revalidatePath(`/fixtures/${fixtureId}`);
  revalidatePath(`/fixtures/${fixtureId}/stats`);
}

export async function unfinalizeFixtureStats(fixtureId: string) {
  const me = await requireProfileId();
  // Only commissioner can unfinalize (locked workflow safeguard).
  const [meRow] = await db
    .select({ role: profiles.role })
    .from(profiles)
    .where(eq(profiles.id, me))
    .limit(1);
  if (meRow?.role !== "commissioner") {
    throw new Error("only commissioner can unfinalize stats");
  }

  await db
    .update(fixtures)
    .set({ statsFinalizedAt: null, motmResolvedAt: null })
    .where(eq(fixtures.id, fixtureId));

  revalidatePath(`/fixtures/${fixtureId}`);
  revalidatePath(`/fixtures/${fixtureId}/stats`);
}

// ----------------------------------------------------------------------------
// Derived: clean sheet + goals conceded
// ----------------------------------------------------------------------------

/**
 * Clean sheet rule (from scoring rule sheet): a player on side S gets a
 * clean sheet iff side S conceded 0 goals AND the player played 60+ min.
 * Goals conceded for a player on side S = goals scored by the opposing
 * side. Computed entirely from fixture.home_score, fixture.away_score,
 * and the lineup's side.
 *
 * Idempotent.
 */
async function recomputeCleanSheetsForFixture(fixtureId: string) {
  // UPDATE...FROM in Postgres needs the target table aliased and joins
  // expressed via WHERE, not via JOIN syntax referencing the target.
  await db.execute(sql`
    update player_match_stats
    set
      goals_conceded = src.conceded,
      clean_sheet = (src.conceded = 0 and player_match_stats.minutes >= 60)
    from (
      select
        fl.real_player_id,
        case
          when fl.side = 'home' then coalesce(f.away_score, 0)
          else coalesce(f.home_score, 0)
        end as conceded
      from fixtures f
      join fixture_lineups fl on fl.fixture_id = f.id
      where f.id = ${fixtureId}
    ) src
    where player_match_stats.fixture_id = ${fixtureId}
      and player_match_stats.real_player_id = src.real_player_id
  `);
}
