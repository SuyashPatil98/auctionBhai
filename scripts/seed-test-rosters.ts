/**
 * Dev convenience: give every league member a 20-player squad
 * (2 GK / 6 DEF / 7 MID / 5 FWD) sampled fairly from the available pool.
 *
 * Idempotent in the safe direction: skips any manager who already has at
 * least one active roster row. Won't stomp real auction results.
 *
 * Flags:
 *   --wipe   delete all fake (acquired_via='free_agent') rosters and exit
 *   --reset  wipe then re-seed
 *
 * Usage:
 *   pnpm seed:test-rosters
 *   pnpm seed:test-rosters --wipe
 *   pnpm seed:test-rosters --reset
 */

import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env" });

const QUOTA = { GK: 2, DEF: 5, MID: 5, FWD: 4 } as const;

async function main() {
  const reset = process.argv.includes("--reset");
  const wipeOnly = process.argv.includes("--wipe");

  const { db } = await import("../lib/db");
  const { and, eq, sql } = await import("drizzle-orm");
  const { leagueMembers, leagues, realPlayers, rosters } = await import(
    "../lib/db/schema"
  );

  const [league] = await db.select().from(leagues).limit(1);
  if (!league) throw new Error("no league — run pnpm seed:league first");

  const members = await db
    .select({ profileId: leagueMembers.profileId })
    .from(leagueMembers)
    .where(eq(leagueMembers.leagueId, league.id));

  if (members.length === 0) {
    console.log("No league members — nothing to seed.");
    return;
  }

  if (reset || wipeOnly) {
    const r = await db
      .delete(rosters)
      .where(
        and(
          eq(rosters.leagueId, league.id),
          // Only wipe rows that look fake: free_agent acquired_via with
          // null acquired_amount. Auction rows survive.
          eq(rosters.acquiredVia, "free_agent")
        )
      )
      .returning({ id: rosters.realPlayerId });
    console.log(`Removed ${r.length} fake roster rows.`);
    if (wipeOnly) return;
  }

  // Find which managers already have rosters — skip them.
  const existing = await db
    .select({
      profileId: rosters.profileId,
      n: sql<number>`count(*)::int`,
    })
    .from(rosters)
    .where(
      and(eq(rosters.leagueId, league.id), sql`${rosters.droppedAt} is null`)
    )
    .groupBy(rosters.profileId);
  const hasRoster = new Set(existing.filter((e) => e.n > 0).map((e) => e.profileId));
  const toFill = members.filter((m) => !hasRoster.has(m.profileId));

  if (toFill.length === 0) {
    console.log("All league members already have rosters — nothing to do.");
    return;
  }

  console.log(`Filling rosters for ${toFill.length} manager(s)...`);

  // Pull active players grouped by position, sorted somewhat — we'll
  // shuffle and distribute. Use a deterministic shuffle keyed by manager
  // index so reruns of the same manager get the same picks (helpful for
  // dev), but different managers get different picks.
  const playerPool = await db
    .select({
      id: realPlayers.id,
      position: realPlayers.position,
    })
    .from(realPlayers)
    .where(eq(realPlayers.isActive, true));

  const byPos: Record<keyof typeof QUOTA, string[]> = {
    GK: [],
    DEF: [],
    MID: [],
    FWD: [],
  };
  for (const p of playerPool) {
    if (p.position in byPos) {
      byPos[p.position as keyof typeof QUOTA].push(p.id);
    }
  }

  // Distribute without overlap across the to-fill managers (within this run).
  // If existing rosters already claim some players, exclude them too.
  const claimed = new Set<string>();
  const existingClaims = await db
    .select({ id: rosters.realPlayerId })
    .from(rosters)
    .where(
      and(eq(rosters.leagueId, league.id), sql`${rosters.droppedAt} is null`)
    );
  for (const c of existingClaims) claimed.add(c.id);

  let totalInserted = 0;
  for (let i = 0; i < toFill.length; i++) {
    const m = toFill[i];
    const inserts: Array<{
      leagueId: string;
      profileId: string;
      realPlayerId: string;
    }> = [];
    for (const pos of Object.keys(QUOTA) as Array<keyof typeof QUOTA>) {
      const wanted = QUOTA[pos];
      const available = byPos[pos].filter((id) => !claimed.has(id));
      if (available.length < wanted) {
        throw new Error(
          `Not enough ${pos} players: need ${wanted}, have ${available.length}`
        );
      }
      // Deterministic pick: rotate by manager index to give each manager
      // a non-overlapping window into the available pool.
      const offset = (i * 31 + pos.charCodeAt(0)) % Math.max(1, available.length);
      const rotated = [...available.slice(offset), ...available.slice(0, offset)];
      const picks = rotated.slice(0, wanted);
      for (const id of picks) {
        claimed.add(id);
        inserts.push({
          leagueId: league.id,
          profileId: m.profileId,
          realPlayerId: id,
        });
      }
    }
    await db
      .insert(rosters)
      .values(
        inserts.map((row) => ({
          ...row,
          acquiredVia: "free_agent" as const,
          acquiredAmount: null,
        }))
      );
    totalInserted += inserts.length;
    console.log(`  ✓ manager ${m.profileId.slice(0, 8)} → ${inserts.length} players`);
  }
  console.log(`\nDone. Inserted ${totalInserted} roster rows.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
