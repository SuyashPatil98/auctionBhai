"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, count, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  fixtures,
  leagueMembers,
  leagues,
  motmVotes,
  playerMatchStats,
  profiles,
} from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/server";
import { requireLeagueMember } from "@/lib/util/require-league-member";

const VOTE_WINDOW_HOURS = 24;

async function requireProfileId(): Promise<string> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return user.id;
}

// ----------------------------------------------------------------------------
// Cast / clear vote
// ----------------------------------------------------------------------------

export async function castMotmVote(
  fixtureId: string,
  candidateRealPlayerId: string
) {
  const profileId = await requireProfileId();
  await requireLeagueMember(profileId);

  // Window check
  const [fx] = await db
    .select({
      statsFinalizedAt: fixtures.statsFinalizedAt,
      motmResolvedAt: fixtures.motmResolvedAt,
    })
    .from(fixtures)
    .where(eq(fixtures.id, fixtureId))
    .limit(1);
  if (!fx) throw new Error("fixture not found");
  if (!fx.statsFinalizedAt) {
    throw new Error("MOTM voting opens after stats are finalized");
  }
  if (fx.motmResolvedAt) {
    throw new Error("MOTM voting has closed for this fixture");
  }

  // Candidate must have played > 0 min in this fixture
  const [eligible] = await db
    .select({ minutes: playerMatchStats.minutes })
    .from(playerMatchStats)
    .where(
      and(
        eq(playerMatchStats.fixtureId, fixtureId),
        eq(playerMatchStats.realPlayerId, candidateRealPlayerId)
      )
    )
    .limit(1);
  if (!eligible || eligible.minutes <= 0) {
    throw new Error(
      "candidate must have featured in the match (minutes > 0)"
    );
  }

  // Upsert vote
  await db
    .insert(motmVotes)
    .values({
      fixtureId,
      voterProfileId: profileId,
      candidateRealPlayerId,
    })
    .onConflictDoUpdate({
      target: [motmVotes.fixtureId, motmVotes.voterProfileId],
      set: {
        candidateRealPlayerId,
        votedAt: new Date(),
      },
    });

  // Auto-resolve when all league members have voted
  await maybeAutoResolve(fixtureId);

  revalidatePath(`/fixtures/${fixtureId}/motm`);
  revalidatePath(`/fixtures/${fixtureId}`);
}

export async function clearMotmVote(fixtureId: string) {
  const profileId = await requireProfileId();
  await requireLeagueMember(profileId);

  const [fx] = await db
    .select({ motmResolvedAt: fixtures.motmResolvedAt })
    .from(fixtures)
    .where(eq(fixtures.id, fixtureId))
    .limit(1);
  if (fx?.motmResolvedAt) {
    throw new Error("voting has closed; cannot withdraw your vote");
  }

  await db
    .delete(motmVotes)
    .where(
      and(
        eq(motmVotes.fixtureId, fixtureId),
        eq(motmVotes.voterProfileId, profileId)
      )
    );

  revalidatePath(`/fixtures/${fixtureId}/motm`);
}

// ----------------------------------------------------------------------------
// Resolve
// ----------------------------------------------------------------------------

/**
 * Tally votes and stamp motm_vote_winner on the winning player(s). Ties
 * split: every player at the max vote count gets motmVoteWinner=true and
 * the +3 bonus from the scoring engine. Idempotent on second call (the
 * motmResolvedAt timestamp blocks re-entry).
 */
export async function resolveMotm(fixtureId: string) {
  const [fx] = await db
    .select({
      statsFinalizedAt: fixtures.statsFinalizedAt,
      motmResolvedAt: fixtures.motmResolvedAt,
    })
    .from(fixtures)
    .where(eq(fixtures.id, fixtureId))
    .limit(1);
  if (!fx) throw new Error("fixture not found");
  if (!fx.statsFinalizedAt) {
    throw new Error("cannot resolve MOTM before stats are finalized");
  }
  if (fx.motmResolvedAt) {
    return { winners: [], resolved: true };
  }

  // Clear any prior winners on this fixture (defensive)
  await db
    .update(playerMatchStats)
    .set({ motmVoteWinner: false })
    .where(eq(playerMatchStats.fixtureId, fixtureId));

  // Compute winners — max vote count, ties allowed
  const tallies = (await db.execute(sql`
    select candidate_real_player_id as "playerId", count(*)::int as "votes"
    from motm_votes
    where fixture_id = ${fixtureId}
    group by candidate_real_player_id
    order by votes desc
  `)) as unknown as Array<{ playerId: string; votes: number }>;

  if (tallies.length === 0) {
    // Nobody voted — still mark fixture resolved, no winner
    await db
      .update(fixtures)
      .set({ motmResolvedAt: new Date() })
      .where(eq(fixtures.id, fixtureId));
    revalidatePath(`/fixtures/${fixtureId}/motm`);
    return { winners: [], resolved: true };
  }

  const top = tallies[0].votes;
  const winners = tallies.filter((t) => t.votes === top).map((t) => t.playerId);

  for (const playerId of winners) {
    await db
      .update(playerMatchStats)
      .set({ motmVoteWinner: true })
      .where(
        and(
          eq(playerMatchStats.fixtureId, fixtureId),
          eq(playerMatchStats.realPlayerId, playerId)
        )
      );
  }

  await db
    .update(fixtures)
    .set({ motmResolvedAt: new Date() })
    .where(eq(fixtures.id, fixtureId));

  revalidatePath(`/fixtures/${fixtureId}/motm`);
  revalidatePath(`/fixtures/${fixtureId}`);
  return { winners, resolved: true };
}

/**
 * Resolve automatically once every league member has cast a vote.
 * Called from castMotmVote after each successful insert.
 */
async function maybeAutoResolve(fixtureId: string) {
  const [league] = await db.select().from(leagues).limit(1);
  if (!league) return;

  const [memberCount] = await db
    .select({ n: count() })
    .from(leagueMembers)
    .where(eq(leagueMembers.leagueId, league.id));

  const [voteCount] = await db
    .select({ n: count() })
    .from(motmVotes)
    .where(eq(motmVotes.fixtureId, fixtureId));

  if (memberCount.n > 0 && voteCount.n >= memberCount.n) {
    await resolveMotm(fixtureId);
  }
}

// ----------------------------------------------------------------------------
// Force-resolve (commissioner / 24h-elapsed safety valve)
// ----------------------------------------------------------------------------

export async function forceResolveMotm(fixtureId: string) {
  const profileId = await requireProfileId();
  await requireLeagueMember(profileId);
  const [me] = await db
    .select({ role: profiles.role })
    .from(profiles)
    .where(eq(profiles.id, profileId))
    .limit(1);

  const [fx] = await db
    .select({
      statsFinalizedAt: fixtures.statsFinalizedAt,
      motmResolvedAt: fixtures.motmResolvedAt,
    })
    .from(fixtures)
    .where(eq(fixtures.id, fixtureId))
    .limit(1);
  if (!fx) throw new Error("fixture not found");
  if (fx.motmResolvedAt) {
    return { winners: [], resolved: true };
  }

  // Commissioner can always force-resolve. Otherwise the 24h window
  // must have elapsed since stats were finalized.
  const isCommissioner = me?.role === "commissioner";
  if (!isCommissioner) {
    if (!fx.statsFinalizedAt) {
      throw new Error("stats not finalized yet");
    }
    const windowMs = VOTE_WINDOW_HOURS * 60 * 60 * 1000;
    if (Date.now() - fx.statsFinalizedAt.getTime() < windowMs) {
      throw new Error(
        `voting window still open — closes ${VOTE_WINDOW_HOURS}h after stats were finalized`
      );
    }
  }

  return resolveMotm(fixtureId);
}
