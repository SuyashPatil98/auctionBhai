/**
 * Seeds the main league + adds every existing profile as a member +
 * creates a draft row in 'scheduled' state.
 *
 * Idempotent — safe to re-run; it'll only create missing rows.
 *
 * Usage: pnpm seed:league
 */

import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env" });

const LEAGUE_NAME = "FiFantasy Main · WC 2026";

async function main() {
  const { db } = await import("../lib/db");
  const {
    profiles,
    leagues,
    leagueMembers,
    tournaments,
    drafts,
  } = await import("../lib/db/schema");
  const { eq } = await import("drizzle-orm");

  // 1. Find the WC 2026 tournament we ingested earlier.
  const [tourney] = await db
    .select()
    .from(tournaments)
    .where(eq(tournaments.externalId, "2000"))
    .limit(1);
  if (!tourney) {
    throw new Error(
      "Tournament not found. Run `pnpm ingest tournament` first."
    );
  }
  console.log(`Tournament: ${tourney.name} (${tourney.startsAt.toISOString().slice(0, 10)} → ${tourney.endsAt.toISOString().slice(0, 10)})`);

  // 2. Ensure exactly one league for this tournament.
  let [league] = await db
    .select()
    .from(leagues)
    .where(eq(leagues.tournamentId, tourney.id))
    .limit(1);
  if (!league) {
    const inserted = await db
      .insert(leagues)
      .values({
        tournamentId: tourney.id,
        name: LEAGUE_NAME,
        format: "auction",
        status: "setup",
      })
      .returning();
    league = inserted[0];
    console.log(`Created league: ${league.name} (${league.id})`);
  } else {
    console.log(`League exists: ${league.name} (${league.id})`);
  }

  // 3. Add every profile as a member (in profiles.created_at order).
  const allProfiles = await db.select().from(profiles);
  console.log(`Found ${allProfiles.length} profiles`);

  const existingMembers = await db
    .select()
    .from(leagueMembers)
    .where(eq(leagueMembers.leagueId, league.id));
  const memberIds = new Set(existingMembers.map((m) => m.profileId));

  const sortedProfiles = [...allProfiles].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime()
  );

  let added = 0;
  for (let i = 0; i < sortedProfiles.length; i++) {
    const p = sortedProfiles[i];
    if (memberIds.has(p.id)) continue;
    await db.insert(leagueMembers).values({
      leagueId: league.id,
      profileId: p.id,
      nominationOrder: existingMembers.length + added + 1,
    });
    console.log(`  + ${p.displayName} as member #${existingMembers.length + added + 1}`);
    added++;
  }
  console.log(`Added ${added} new member(s); ${memberIds.size + added} total`);

  // 4. Ensure a scheduled draft row.
  const [existingDraft] = await db
    .select()
    .from(drafts)
    .where(eq(drafts.leagueId, league.id))
    .limit(1);
  if (!existingDraft) {
    const [d] = await db
      .insert(drafts)
      .values({
        leagueId: league.id,
        status: "scheduled",
      })
      .returning();
    console.log(`Created draft: ${d.id}`);
  } else {
    console.log(`Draft exists: ${existingDraft.id} (status=${existingDraft.status})`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
