import { redirect } from "next/navigation";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  countries,
  drafts,
  leagueMembers,
  leagues,
  playerFactorPercentiles,
  playerPrices,
  ratingProfileFactors,
  ratingProfiles,
  realPlayers,
} from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/server";
import ProfileBuilder, {
  type ProfileBuilderProps,
  type PercentileRow,
  type PreviewPlayer,
  type SavedProfile,
} from "./ProfileBuilder";

export const dynamic = "force-dynamic";

export const metadata = { title: "Scouting · FiFantasy" };

export default async function ScoutingProfilesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Determine lock state from the (single) league's draft status.
  const [league] = await db.select().from(leagues).limit(1);
  const [draft] = league
    ? await db
        .select({ status: drafts.status })
        .from(drafts)
        .where(eq(drafts.leagueId, league.id))
        .limit(1)
    : [];
  const locked = !!draft && draft.status !== "scheduled";

  const isMember =
    league !== undefined &&
    (
      await db
        .select()
        .from(leagueMembers)
        .where(
          and(
            eq(leagueMembers.leagueId, league.id),
            eq(leagueMembers.profileId, user.id)
          )
        )
        .limit(1)
    ).length > 0;

  // Load my profiles + their factors.
  const myProfileRows = await db
    .select()
    .from(ratingProfiles)
    .where(eq(ratingProfiles.managerId, user.id))
    .orderBy(asc(ratingProfiles.createdAt));

  const profileIds = myProfileRows.map((p) => p.id);
  const factorsByProfile = new Map<
    string,
    Array<{ factor_id: string; importance: "important" | "standard" }>
  >();
  if (profileIds.length > 0) {
    const rows = await db
      .select()
      .from(ratingProfileFactors)
      .where(inArray(ratingProfileFactors.profileId, profileIds));
    for (const r of rows) {
      const arr = factorsByProfile.get(r.profileId) ?? [];
      arr.push({ factor_id: r.factorId, importance: r.importance });
      factorsByProfile.set(r.profileId, arr);
    }
  }

  const savedProfiles: SavedProfile[] = myProfileRows.map((p) => ({
    id: p.id,
    name: p.name,
    description: p.description,
    factors: factorsByProfile.get(p.id) ?? [],
    lockedAt: p.lockedAt?.toISOString() ?? null,
    updatedAt: p.updatedAt.toISOString(),
  }));

  // Default preview player = the highest-priced active player.
  const [topPriced] = await db
    .select({
      id: realPlayers.id,
      displayName: realPlayers.displayName,
      position: realPlayers.position,
      countryName: countries.name,
      price: playerPrices.price,
    })
    .from(realPlayers)
    .innerJoin(countries, eq(countries.id, realPlayers.countryId))
    .innerJoin(playerPrices, eq(playerPrices.realPlayerId, realPlayers.id))
    .where(eq(realPlayers.isActive, true))
    .orderBy(desc(playerPrices.price))
    .limit(1);

  let previewPlayer: PreviewPlayer | null = null;
  let previewPercentiles: PercentileRow[] = [];
  if (topPriced) {
    previewPlayer = {
      id: topPriced.id,
      displayName: topPriced.displayName,
      position: topPriced.position,
      countryName: topPriced.countryName,
    };
    const pcts = await db
      .select({
        factorId: playerFactorPercentiles.factorId,
        percentile: playerFactorPercentiles.percentile,
        hasData: playerFactorPercentiles.hasData,
        bucket: playerFactorPercentiles.positionBucket,
      })
      .from(playerFactorPercentiles)
      .where(eq(playerFactorPercentiles.realPlayerId, topPriced.id));
    previewPercentiles = pcts.map((p) => ({
      factor_id: p.factorId,
      percentile: Number(p.percentile),
      has_data: p.hasData,
    }));
  }

  const props: ProfileBuilderProps = {
    isMember,
    locked,
    lockReason: draft ? `draft is ${draft.status}` : null,
    savedProfiles,
    previewPlayer,
    previewPercentiles,
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Scouting</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Save reusable formulas that weight factors the way you value them.
          Apply a profile to any player and you&apos;ll get your personal
          rating in the players list. Your numbers are visible to other
          managers; your <strong>formulas</strong> are private until the
          draft ends (then revealed in the recap).
        </p>
      </div>

      {!isMember && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-4 text-sm">
          You&apos;re not in the league yet — sign-up is fine, but scouting
          features unlock once an admin adds you as a member.
        </div>
      )}

      {locked && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-4 text-sm space-y-2">
          <p>
            <strong>Profiles locked.</strong> The draft is{" "}
            <code>{draft?.status}</code> — formulas froze when the auction
            started, so people couldn&apos;t reweight mid-draft to chase
            players.
          </p>
          <p>
            <a
              href="/draft/recap/scouting"
              className="underline text-foreground hover:text-primary"
            >
              See everyone&apos;s formulas →
            </a>
          </p>
        </div>
      )}

      <ProfileBuilder {...props} />
    </div>
  );
}
