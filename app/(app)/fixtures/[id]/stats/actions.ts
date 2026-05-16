"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  fixtureLineups,
  fixtures,
  playerMatchStats,
  profiles,
  realPlayers,
} from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/server";
import { requireLeagueMember } from "@/lib/util/require-league-member";
import { getMatch, type MatchDetail } from "@/lib/external/football-data";
import { sweepMatchday } from "@/lib/scoring/sweep";

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
async function assertCanEdit(_fixtureId: string, profileId: string) {
  // Stewards aren't enforced (4-friend trust model), but the actor must
  // be a league member. This blocks random strangers who signed up at
  // the public URL from editing stats.
  await requireLeagueMember(profileId);
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
  await rescoreFixtureMatchday(fixtureId);

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
  await rescoreFixtureMatchday(fixtureId);

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

  await rescoreFixtureMatchday(fixtureId);

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

  await rescoreFixtureMatchday(fixtureId);

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

  await rescoreFixtureMatchday(fixtureId);

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
// ----------------------------------------------------------------------------
// Auto-import from football-data.org
// ----------------------------------------------------------------------------

export type ImportResult = {
  homePlayersImported: number;
  awayPlayersImported: number;
  unmappedFromApi: number;
  goalsImported: number;
  cardsImported: number;
  substitutionsApplied: number;
  homeScore: number;
  awayScore: number;
};

/**
 * Pulls the post-FT match data from football-data.org and upserts:
 *   - fixture score (homeScore + awayScore)
 *   - fixture_lineups (starters + bench, side + isStarter)
 *   - player_match_stats (minutes, goals, assists, yellows, reds, OG, pen miss)
 *
 * Idempotent: re-running overwrites with the latest API response. Steward
 * still has to finalize manually after reviewing.
 *
 * Returns counts so the UI can surface what landed and what didn't.
 */
export async function importMatchStatsFromApi(
  fixtureId: string
): Promise<ImportResult> {
  const me = await requireProfileId();
  await assertCanEdit(fixtureId, me);

  const [fx] = await db
    .select({
      id: fixtures.id,
      externalId: fixtures.externalId,
      homeCountryId: fixtures.homeCountryId,
      awayCountryId: fixtures.awayCountryId,
    })
    .from(fixtures)
    .where(eq(fixtures.id, fixtureId))
    .limit(1);
  if (!fx) throw new Error("fixture not found");
  if (!fx.externalId) {
    throw new Error(
      "this fixture has no external_id — likely a test or manual fixture, " +
        "no API data to pull"
    );
  }
  const apiId = Number.parseInt(fx.externalId, 10);
  if (!Number.isFinite(apiId)) {
    throw new Error(`external_id '${fx.externalId}' isn't numeric`);
  }

  const match = await getMatch(apiId);

  // Status check — we shouldn't pull pre-match (no lineups yet)
  if (match.status !== "FINISHED" && match.status !== "IN_PLAY" && match.status !== "PAUSED") {
    throw new Error(
      `match status is '${match.status}'. Lineups + events only available after kickoff.`
    );
  }

  // Map football-data team ids to home/away side via comparing against
  // the fixture's stored country ids. We need to fetch the team's API id
  // for our home/away countries — football-data team id != country id.
  // Easier: use the match's homeTeam.id / awayTeam.id directly as the
  // "side" key, since those are the ones referenced in goals/bookings.
  const homeTeamApiId = match.homeTeam.id;
  const awayTeamApiId = match.awayTeam.id;
  const sideForTeam = (teamId: number): "home" | "away" =>
    teamId === homeTeamApiId ? "home" : "away";

  // Collect every player id referenced in lineup/bench/goals/bookings/subs.
  const apiPlayerIds = new Set<number>();
  const collect = (id?: number) => {
    if (typeof id === "number") apiPlayerIds.add(id);
  };
  match.homeTeam.lineup?.forEach((p) => collect(p.id));
  match.homeTeam.bench?.forEach((p) => collect(p.id));
  match.awayTeam.lineup?.forEach((p) => collect(p.id));
  match.awayTeam.bench?.forEach((p) => collect(p.id));
  match.goals?.forEach((g) => {
    collect(g.scorer?.id);
    if (g.assist) collect(g.assist.id);
  });
  match.bookings?.forEach((b) => collect(b.player?.id));
  match.substitutions?.forEach((s) => {
    collect(s.playerIn?.id);
    collect(s.playerOut?.id);
  });

  // Map API player ids -> our real_players.id via external_id
  const externalIds = [...apiPlayerIds].map((n) => String(n));
  const realRows = externalIds.length
    ? await db
        .select({
          realPlayerId: realPlayers.id,
          externalId: realPlayers.externalId,
        })
        .from(realPlayers)
        .where(inArray(realPlayers.externalId, externalIds))
    : [];
  const idMap = new Map<number, string>();
  for (const r of realRows) {
    if (r.externalId) idMap.set(Number.parseInt(r.externalId, 10), r.realPlayerId);
  }

  const unmappedCount = apiPlayerIds.size - idMap.size;

  // ---- Build the upsert plan ---------------------------------------------

  type StatAccum = {
    realPlayerId: string;
    side: "home" | "away";
    isStarter: boolean;
    minutes: number;
    goals: number;
    assists: number;
    yellows: number;
    reds: number;
    ownGoals: number;
    pensMissed: number;
    penSaves: number;
  };
  const stats = new Map<string, StatAccum>();
  const init = (
    apiId: number,
    side: "home" | "away",
    isStarter: boolean,
    startingMinutes: number
  ): StatAccum | null => {
    const realPlayerId = idMap.get(apiId);
    if (!realPlayerId) return null;
    if (!stats.has(realPlayerId)) {
      stats.set(realPlayerId, {
        realPlayerId,
        side,
        isStarter,
        minutes: startingMinutes,
        goals: 0,
        assists: 0,
        yellows: 0,
        reds: 0,
        ownGoals: 0,
        pensMissed: 0,
        penSaves: 0,
      });
    }
    return stats.get(realPlayerId)!;
  };

  // Starters: assume 90 min unless subbed off
  for (const p of match.homeTeam.lineup ?? []) {
    init(p.id, "home", true, 90);
  }
  for (const p of match.awayTeam.lineup ?? []) {
    init(p.id, "away", true, 90);
  }
  // Bench: 0 min unless subbed in
  for (const p of match.homeTeam.bench ?? []) {
    init(p.id, "home", false, 0);
  }
  for (const p of match.awayTeam.bench ?? []) {
    init(p.id, "away", false, 0);
  }

  // Apply substitutions to derive accurate minutes
  let subsApplied = 0;
  for (const s of match.substitutions ?? []) {
    const outId = s.playerOut?.id;
    const inId = s.playerIn?.id;
    const min = s.minute ?? 0;
    if (outId) {
      const out = idMap.get(outId);
      if (out && stats.has(out)) {
        stats.get(out)!.minutes = Math.max(0, Math.min(90, min));
      }
    }
    if (inId) {
      const into = idMap.get(inId);
      if (into && stats.has(into)) {
        stats.get(into)!.minutes = Math.max(0, Math.min(90, 90 - min));
      }
    }
    subsApplied++;
  }

  // Apply goals + assists. Own goals count against the player's stats row.
  let goalsImported = 0;
  for (const g of match.goals ?? []) {
    goalsImported++;
    const scorerRealId = g.scorer ? idMap.get(g.scorer.id) : undefined;
    const assistRealId = g.assist ? idMap.get(g.assist.id) : undefined;
    if (scorerRealId && stats.has(scorerRealId)) {
      if (g.type === "OWN") {
        stats.get(scorerRealId)!.ownGoals++;
      } else {
        stats.get(scorerRealId)!.goals++;
      }
    }
    if (assistRealId && stats.has(assistRealId)) {
      stats.get(assistRealId)!.assists++;
    }
  }

  // Apply bookings
  let cardsImported = 0;
  for (const b of match.bookings ?? []) {
    cardsImported++;
    const realId = b.player ? idMap.get(b.player.id) : undefined;
    if (!realId || !stats.has(realId)) continue;
    const row = stats.get(realId)!;
    if (b.card === "YELLOW") row.yellows++;
    else if (b.card === "RED") row.reds++;
    else if (b.card === "YELLOW_RED") {
      row.yellows++; // second yellow
      row.reds++; // → red
    }
  }

  // ---- Persist ----------------------------------------------------------

  // Fixture score
  const homeScore = match.score.fullTime.home ?? 0;
  const awayScore = match.score.fullTime.away ?? 0;
  await db
    .update(fixtures)
    .set({
      homeScore,
      awayScore,
      status: sql`case when ${fixtures.status} in ('scheduled', 'live', 'ht') then 'ft' else ${fixtures.status} end`,
      lastSyncedAt: new Date(),
    })
    .where(eq(fixtures.id, fixtureId));

  // Upsert each player's lineup + stats row
  let homeCount = 0;
  let awayCount = 0;
  for (const row of stats.values()) {
    if (row.side === "home") homeCount++;
    else awayCount++;

    await db
      .insert(fixtureLineups)
      .values({
        fixtureId,
        realPlayerId: row.realPlayerId,
        side: row.side,
        isStarter: row.isStarter,
        minutesPlayed: row.minutes,
      })
      .onConflictDoUpdate({
        target: [fixtureLineups.fixtureId, fixtureLineups.realPlayerId],
        set: {
          side: row.side,
          isStarter: row.isStarter,
          minutesPlayed: row.minutes,
        },
      });

    await db
      .insert(playerMatchStats)
      .values({
        fixtureId,
        realPlayerId: row.realPlayerId,
        minutes: row.minutes,
        goals: row.goals,
        assists: row.assists,
        yellows: row.yellows,
        reds: row.reds,
        ownGoals: row.ownGoals,
        pensMissed: row.pensMissed,
        penSaves: row.penSaves,
      })
      .onConflictDoUpdate({
        target: [playerMatchStats.fixtureId, playerMatchStats.realPlayerId],
        set: {
          minutes: row.minutes,
          goals: row.goals,
          assists: row.assists,
          yellows: row.yellows,
          reds: row.reds,
          ownGoals: row.ownGoals,
          pensMissed: row.pensMissed,
          penSaves: row.penSaves,
          computedAt: new Date(),
        },
      });
  }

  await recomputeCleanSheetsForFixture(fixtureId);
  await rescoreFixtureMatchday(fixtureId);

  revalidatePath(`/fixtures/${fixtureId}`);
  revalidatePath(`/fixtures/${fixtureId}/stats`);

  return {
    homePlayersImported: homeCount,
    awayPlayersImported: awayCount,
    unmappedFromApi: unmappedCount,
    goalsImported,
    cardsImported,
    substitutionsApplied: subsApplied,
    homeScore,
    awayScore,
  };
}

/**
 * Best-effort: after any stat-affecting mutation, re-score the fixture's
 * matchday so standings stay in sync. Failures are logged but don't roll
 * back the caller's write.
 */
async function rescoreFixtureMatchday(fixtureId: string) {
  try {
    const [fx] = await db
      .select({ matchday: fixtures.matchday })
      .from(fixtures)
      .where(eq(fixtures.id, fixtureId))
      .limit(1);
    if (fx) {
      await sweepMatchday(fx.matchday);
      revalidatePath(`/matchday/${fx.matchday}`);
      revalidatePath("/dashboard");
    }
  } catch (e) {
    console.error("rescoreFixtureMatchday failed:", e);
  }
}

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
