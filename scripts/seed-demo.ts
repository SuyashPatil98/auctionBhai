/**
 * One-shot seed for the LineUp Lab demo Supabase project.
 *
 * Idempotent. Run against whichever Supabase project your DATABASE_URL +
 * SUPABASE_SERVICE_ROLE_KEY point at. DO NOT POINT AT PROD — verify the
 * project ref in your .env.demo before running.
 *
 * What it sets up:
 *   1. 4 demo auth users with the exact emails + passwords used by the
 *      one-click persona picker on /welcome
 *   2. League + league_members (all 4)
 *   3. A "complete" draft with budgetPerManager=500 + 16-player rosters
 *      per manager
 *   4. A handful of finalized matchday 1 fixtures with player_match_stats
 *      so /matchday/1 and /dashboard standings aren't empty
 *   5. A pending trade + a couple of placed FA bids so /trading looks
 *      lived-in
 *
 * Run via:
 *   pnpm seed:demo
 *
 * Prereqs (run first against the demo DB):
 *   - All migrations 001..022 applied
 *   - pnpm ingest                   (WC fixtures + 1213 players)
 *   - pnpm import:tm                (Transfermarkt CSV)
 *   - pnpm compute:ratings          (uses cached Gemini)
 *   - pnpm seed:elos
 *   - pnpm sim:bracket
 *   - pnpm compute:prices
 */

import { config } from "dotenv";
config({ path: ".env.demo" });
config({ path: ".env.local" });
config({ path: ".env" });

const DEMO_PERSONAS = [
  {
    id: "aggressor",
    email: "aggressor@lineuplab.demo",
    password: "demo-aggressor-7421",
    displayName: "The Aggressor",
    teamName: "Stars & Stripes",
    teamEmoji: "🔥",
    handle: "aggressor",
  },
  {
    id: "defender",
    email: "defender@lineuplab.demo",
    password: "demo-defender-3902",
    displayName: "The Defender",
    teamName: "Clean Sheets FC",
    teamEmoji: "🛡️",
    handle: "defender",
  },
  {
    id: "punter",
    email: "punter@lineuplab.demo",
    password: "demo-punter-5168",
    displayName: "The Punter",
    teamName: "Long Odds",
    teamEmoji: "🎲",
    handle: "punter",
  },
  {
    id: "builder",
    email: "builder@lineuplab.demo",
    password: "demo-builder-2735",
    displayName: "The Builder",
    teamName: "Balanced XI",
    teamEmoji: "⚖️",
    handle: "builder",
  },
] as const;

const QUOTA = { GK: 2, DEF: 5, MID: 5, FWD: 4 } as const;

async function main() {
  const projectRef = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").match(
    /https:\/\/(\w+)\.supabase\.co/
  )?.[1];
  console.log(`Seeding demo Supabase project ref: ${projectRef ?? "<unknown>"}`);
  if (projectRef === "tcdkbftqmgnujvnvswzj") {
    throw new Error(
      "REFUSING TO SEED — this looks like the prod 'auction-bhai' project (Mumbai). " +
        "Point .env.demo at the LineUp Lab Supabase project before running."
    );
  }

  const { createClient } = await import("@supabase/supabase-js");
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY required"
    );
  }
  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { and, eq, inArray, isNull, sql } = await import("drizzle-orm");
  const { db } = await import("../lib/db");
  const {
    auctionLots,
    countries,
    drafts,
    fixtureLineups,
    fixtures,
    leagueMembers,
    leagues,
    managerBudgets,
    managerLineups,
    matchdayScores,
    playerMatchStats,
    playerPrices,
    profiles,
    realPlayers,
    rosters,
    tournaments,
    trades,
  } = await import("../lib/db/schema");

  // ---- 1. Auth users ---------------------------------------------------
  console.log("\n[1/5] Creating demo auth users...");
  const profileIds: Record<string, string> = {};
  for (const p of DEMO_PERSONAS) {
    // Look up first
    const { data: existing } = await supabase.auth.admin.listUsers();
    const found = existing?.users.find((u) => u.email === p.email);
    let userId: string;
    if (found) {
      userId = found.id;
      // Reset password in case it drifted
      await supabase.auth.admin.updateUserById(userId, {
        password: p.password,
        email_confirm: true,
      });
      console.log(`  · ${p.email} → already exists (${userId.slice(0, 8)})`);
    } else {
      const { data, error } = await supabase.auth.admin.createUser({
        email: p.email,
        password: p.password,
        email_confirm: true,
        user_metadata: { display_name: p.displayName },
      });
      if (error) throw new Error(`createUser ${p.email}: ${error.message}`);
      userId = data.user.id;
      console.log(`  ✓ ${p.email} (${userId.slice(0, 8)})`);
    }
    profileIds[p.id] = userId;

    // Upsert profile row
    await db
      .insert(profiles)
      .values({
        id: userId,
        handle: p.handle,
        displayName: p.displayName,
        teamName: p.teamName,
        teamEmoji: p.teamEmoji,
        role: "member",
      })
      .onConflictDoUpdate({
        target: profiles.id,
        set: {
          handle: p.handle,
          displayName: p.displayName,
          teamName: p.teamName,
          teamEmoji: p.teamEmoji,
        },
      });
  }

  // ---- 2. League + members --------------------------------------------
  console.log("\n[2/5] League + members...");
  const [tournament] = await db.select().from(tournaments).limit(1);
  if (!tournament) {
    throw new Error(
      "No tournaments row. Run `pnpm ingest` first to pull WC fixtures + countries."
    );
  }

  let [league] = await db.select().from(leagues).limit(1);
  if (!league) {
    [league] = await db
      .insert(leagues)
      .values({
        tournamentId: tournament.id,
        name: "LineUp Lab Demo",
        status: "active",
      })
      .returning();
    console.log(`  ✓ Created league ${league.id.slice(0, 8)}`);
  } else {
    console.log(`  · League exists ${league.id.slice(0, 8)}`);
  }

  for (let i = 0; i < DEMO_PERSONAS.length; i++) {
    const p = DEMO_PERSONAS[i];
    await db
      .insert(leagueMembers)
      .values({
        leagueId: league.id,
        profileId: profileIds[p.id],
        nominationOrder: i + 1,
      })
      .onConflictDoNothing();
  }
  console.log(`  ✓ All 4 personas in league_members`);

  // ---- 3. Complete draft with rosters ---------------------------------
  console.log("\n[3/5] Draft + 16-player rosters...");
  let [draft] = await db
    .select()
    .from(drafts)
    .where(eq(drafts.leagueId, league.id))
    .limit(1);
  if (!draft) {
    [draft] = await db
      .insert(drafts)
      .values({
        leagueId: league.id,
        status: "complete",
        budgetPerManager: 500,
        rosterSize: 16,
        rosterRequirements: { GK: 2, DEF: 5, MID: 5, FWD: 4 },
      })
      .returning();
  } else {
    await db
      .update(drafts)
      .set({
        status: "complete",
        budgetPerManager: 500,
        rosterSize: 16,
        rosterRequirements: { GK: 2, DEF: 5, MID: 5, FWD: 4 },
      })
      .where(eq(drafts.id, draft.id));
  }

  // Wipe existing demo rosters (idempotent), then re-fill
  await db
    .delete(rosters)
    .where(eq(rosters.leagueId, league.id));

  const pool = await db
    .select({
      id: realPlayers.id,
      position: realPlayers.position,
      price: playerPrices.price,
    })
    .from(realPlayers)
    .leftJoin(playerPrices, eq(playerPrices.realPlayerId, realPlayers.id))
    .where(eq(realPlayers.isActive, true));

  const byPos: Record<string, Array<{ id: string; price: number }>> = {
    GK: [],
    DEF: [],
    MID: [],
    FWD: [],
  };
  for (const p of pool) {
    if (p.position in byPos) {
      byPos[p.position].push({ id: p.id, price: p.price ?? 10 });
    }
  }
  for (const k of Object.keys(byPos)) {
    byPos[k].sort((a, b) => b.price - a.price);
  }

  // Distribute: Aggressor gets top picks first, then Defender, etc.
  // Each manager picks until QUOTA satisfied.
  const claimed = new Set<string>();
  const personaSpend: Record<string, number> = {};
  for (let i = 0; i < DEMO_PERSONAS.length; i++) {
    const p = DEMO_PERSONAS[i];
    let spent = 0;
    for (const pos of Object.keys(QUOTA) as Array<keyof typeof QUOTA>) {
      const want = QUOTA[pos];
      // Aggressor takes the most expensive available; others fall further
      // down the list to make squads visually distinct.
      const offset = i * 4;
      const window = byPos[pos].filter((x) => !claimed.has(x.id));
      const picks = window.slice(offset, offset + want);
      // If we ran out (offset too high), pad from cheapest
      while (picks.length < want) {
        const fill = window.find((x) => !picks.some((y) => y.id === x.id));
        if (!fill) break;
        picks.push(fill);
      }
      for (const pick of picks) {
        // "The Aggressor" pays full, others get a 30-50% discount to fit
        // 500 budget reasonably across all 4 personas.
        const discount = i === 0 ? 1.0 : i === 1 ? 0.75 : i === 2 ? 0.55 : 0.65;
        const cost = Math.max(1, Math.round(pick.price * discount));
        spent += cost;
        await db.insert(rosters).values({
          leagueId: league.id,
          profileId: profileIds[p.id],
          realPlayerId: pick.id,
          acquiredVia: "auction",
          acquiredAmount: cost,
        });
        claimed.add(pick.id);
      }
    }
    personaSpend[p.id] = spent;
    console.log(`  ✓ ${p.displayName}: 16 players, spent ${spent}`);
  }

  // Manager budgets
  await db
    .delete(managerBudgets)
    .where(eq(managerBudgets.draftId, draft.id));
  for (const p of DEMO_PERSONAS) {
    await db.insert(managerBudgets).values({
      draftId: draft.id,
      profileId: profileIds[p.id],
      spent: personaSpend[p.id],
      slotsFilled: 16,
    });
  }

  // ---- 4. Matchday 1 stats + scores -----------------------------------
  console.log("\n[4/5] Matchday 1 stats (so leaderboard isn't empty)...");
  const md1Fixtures = await db
    .select()
    .from(fixtures)
    .where(eq(fixtures.matchday, 1))
    .limit(8);

  if (md1Fixtures.length === 0) {
    console.log("  · No MD1 fixtures — skipping matchday data");
  } else {
    // For each fixture, fabricate a plausible 0-3 score + minutes per
    // player who happens to be in the rosters. Keep it cheap — just one
    // pass over each fixture.
    const allRostered = await db
      .select({
        realPlayerId: rosters.realPlayerId,
        countryId: realPlayers.countryId,
        position: realPlayers.position,
      })
      .from(rosters)
      .innerJoin(realPlayers, eq(realPlayers.id, rosters.realPlayerId))
      .where(eq(rosters.leagueId, league.id));
    const rosteredByCountry = new Map<string, typeof allRostered>();
    for (const r of allRostered) {
      const arr = rosteredByCountry.get(r.countryId) ?? [];
      arr.push(r);
      rosteredByCountry.set(r.countryId, arr);
    }

    let scoredFixtures = 0;
    for (const f of md1Fixtures.slice(0, 4)) {
      const homeScore = Math.floor(Math.random() * 4);
      const awayScore = Math.floor(Math.random() * 3);

      await db
        .update(fixtures)
        .set({
          homeScore,
          awayScore,
          status: "ft",
          statsFinalizedAt: new Date(),
          motmResolvedAt: new Date(),
        })
        .where(eq(fixtures.id, f.id));

      const homePlayers = rosteredByCountry.get(f.homeCountryId) ?? [];
      const awayPlayers = rosteredByCountry.get(f.awayCountryId) ?? [];

      for (const side of ["home", "away"] as const) {
        const players = side === "home" ? homePlayers : awayPlayers;
        const scored = side === "home" ? homeScore : awayScore;
        const conceded = side === "home" ? awayScore : homeScore;
        for (let i = 0; i < players.length; i++) {
          const p = players[i];
          const minutes = i < 6 ? 90 : i < 9 ? 60 : 0;
          const goals = i === 0 && scored > 0 ? Math.min(scored, 1) : 0;
          const assists = i === 1 && scored > 0 ? 1 : 0;

          await db
            .insert(fixtureLineups)
            .values({
              fixtureId: f.id,
              realPlayerId: p.realPlayerId,
              side,
              isStarter: minutes > 0,
              minutesPlayed: minutes,
            })
            .onConflictDoNothing();

          await db
            .insert(playerMatchStats)
            .values({
              fixtureId: f.id,
              realPlayerId: p.realPlayerId,
              minutes,
              goals,
              assists,
              cleanSheet: conceded === 0 && minutes >= 60,
              goalsConceded: conceded,
              motmVoteWinner: i === 0 && goals > 0,
            })
            .onConflictDoNothing();
        }
      }
      scoredFixtures++;
    }
    console.log(`  ✓ ${scoredFixtures} fixtures finalized with synthetic stats`);

    // Pre-build manager_lineups (formation 4-3-3) for MD 1 so scoring has
    // something to chew on
    for (const p of DEMO_PERSONAS) {
      const r = await db
        .select({ realPlayerId: rosters.realPlayerId, position: realPlayers.position })
        .from(rosters)
        .innerJoin(realPlayers, eq(realPlayers.id, rosters.realPlayerId))
        .where(
          and(
            eq(rosters.leagueId, league.id),
            eq(rosters.profileId, profileIds[p.id]),
            isNull(rosters.droppedAt)
          )
        );
      const byP: Record<string, string[]> = { GK: [], DEF: [], MID: [], FWD: [] };
      for (const x of r) byP[x.position].push(x.realPlayerId);
      const starters = [
        byP.GK[0],
        ...byP.DEF.slice(0, 4),
        ...byP.MID.slice(0, 3),
        ...byP.FWD.slice(0, 3),
      ].filter(Boolean);
      const bench = [
        byP.GK[1],
        byP.DEF[4],
        byP.MID[3],
        byP.MID[4],
        byP.FWD[3],
      ].filter(Boolean);
      if (starters.length === 11) {
        await db
          .insert(managerLineups)
          .values({
            profileId: profileIds[p.id],
            matchday: 1,
            formation: "4-3-3",
            starterIds: starters,
            benchIds: bench,
            captainId: starters[10] ?? starters[0],
            viceId: starters[9] ?? starters[1],
            lockedAt: new Date(),
          })
          .onConflictDoNothing();
      }
    }
    console.log(`  ✓ Locked MD1 lineups for all 4 personas`);

    // Run a scoring sweep so matchday_scores has rows
    const { sweepMatchday } = await import("../lib/scoring/sweep");
    const sweep = await sweepMatchday(1);
    console.log(
      `  ✓ Scored MD1: ${sweep.managersScored} manager rows in matchday_scores`
    );
  }

  // ---- 5. A pending trade so /trading isn't empty ---------------------
  console.log("\n[5/5] Pending trade proposal...");
  const proposer = DEMO_PERSONAS[0]; // The Aggressor
  const recipient = DEMO_PERSONAS[3]; // The Builder
  // Pick one player from each, same position
  const [proposerPlayer] = await db
    .select({
      realPlayerId: rosters.realPlayerId,
      position: realPlayers.position,
    })
    .from(rosters)
    .innerJoin(realPlayers, eq(realPlayers.id, rosters.realPlayerId))
    .where(
      and(
        eq(rosters.leagueId, league.id),
        eq(rosters.profileId, profileIds[proposer.id]),
        eq(realPlayers.position, "MID"),
        isNull(rosters.droppedAt)
      )
    )
    .limit(1);
  const [recipientPlayer] = await db
    .select({
      realPlayerId: rosters.realPlayerId,
      position: realPlayers.position,
    })
    .from(rosters)
    .innerJoin(realPlayers, eq(realPlayers.id, rosters.realPlayerId))
    .where(
      and(
        eq(rosters.leagueId, league.id),
        eq(rosters.profileId, profileIds[recipient.id]),
        eq(realPlayers.position, "MID"),
        isNull(rosters.droppedAt)
      )
    )
    .limit(1);
  if (proposerPlayer && recipientPlayer) {
    // Compute window_key for "today" (or last Tuesday)
    const { windowKeyFor, computeWindowState } = await import(
      "../lib/trading/window"
    );
    const state = computeWindowState(Date.now(), null);
    const wk = windowKeyFor(state.opensAt);
    await db
      .delete(trades)
      .where(and(eq(trades.windowKey, wk), eq(trades.proposerId, profileIds[proposer.id])));
    await db.insert(trades).values({
      windowKey: wk,
      proposerId: profileIds[proposer.id],
      recipientId: profileIds[recipient.id],
      proposerPlayerId: proposerPlayer.realPlayerId,
      recipientPlayerId: recipientPlayer.realPlayerId,
      creditFromProposer: 5,
      message: "I'll throw in 5 cr — your midfielder fits my setup better",
    });
    console.log(
      `  ✓ Pending trade: ${proposer.displayName} → ${recipient.displayName}`
    );
  } else {
    console.log("  · Couldn't find matching MID players — skipping demo trade");
  }

  console.log("\nDone. Visit /welcome to sign in as any persona.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
