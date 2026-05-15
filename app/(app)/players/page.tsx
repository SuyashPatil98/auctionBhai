import Link from "next/link";
import { db } from "@/lib/db";
import {
  countries,
  leagueMembers,
  leagues,
  personalRatings,
  playerPrices,
  playerRatings,
  profiles,
  ratingProfileFactors,
  ratingProfiles,
  realPlayers,
} from "@/lib/db/schema";
import { and, asc, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { createClient } from "@/lib/supabase/server";
import { PlayerCard } from "@/components/PlayerCard";
import BulkRatePanel from "./BulkRatePanel";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Players · FiFantasy",
};

type SearchParams = Promise<{
  q?: string;
  position?: string;
  country?: string;
  sort?: string;
  interest?: string;
  rated_by?: string;
  view?: string;
}>;

const POSITIONS = ["GK", "DEF", "MID", "FWD"] as const;
type Position = (typeof POSITIONS)[number];

export default async function PlayersPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { q, position, country, sort, interest, rated_by, view } = await searchParams;
  const minInterest = Number.parseInt(interest ?? "", 10);
  const minInterestSafe = Number.isFinite(minInterest) ? minInterest : 0;
  const ratedByFilter = rated_by ?? "";
  const viewMode: "table" | "cards" = view === "cards" ? "cards" : "table";
  const posFilter = POSITIONS.includes(position as Position)
    ? (position as Position)
    : null;
  const sortMode: "name" | "country" | "rating" | "price" =
    sort === "name" ||
    sort === "country" ||
    sort === "rating" ||
    sort === "price"
      ? sort
      : "price"; // default to price — it's what the auction cares about

  const filters = [];
  if (q && q.trim()) {
    const like = `%${q.trim()}%`;
    filters.push(
      or(ilike(realPlayers.fullName, like), ilike(realPlayers.displayName, like))
    );
  }
  if (posFilter) filters.push(eq(realPlayers.position, posFilter));
  if (country) filters.push(eq(countries.code, country.toUpperCase()));

  // Latest rating per player (max captures latest baseline; we re-write
  // with each compute:ratings run).
  const latestRating = db
    .select({
      realPlayerId: playerRatings.realPlayerId,
      rating: sql<number>`max(${playerRatings.rating}::numeric)`.as("rating"),
    })
    .from(playerRatings)
    .groupBy(playerRatings.realPlayerId)
    .as("lr");

  const orderBy =
    sortMode === "name"
      ? [asc(realPlayers.displayName)]
      : sortMode === "country"
      ? [asc(countries.name), asc(realPlayers.displayName)]
      : sortMode === "rating"
      ? [
          desc(sql`coalesce(${latestRating.rating}, 0)`),
          asc(realPlayers.displayName),
        ]
      : // price (default)
        [
          desc(sql`coalesce(${playerPrices.price}, 0)`),
          desc(sql`coalesce(${latestRating.rating}, 0)`),
        ];

  const rows = await db
    .select({
      id: realPlayers.id,
      fullName: realPlayers.fullName,
      displayName: realPlayers.displayName,
      position: realPlayers.position,
      shirtNumber: realPlayers.shirtNumber,
      club: realPlayers.club,
      photoUrl: realPlayers.photoUrl,
      countryCode: countries.code,
      countryName: countries.name,
      flagUrl: countries.flagUrl,
      rating: latestRating.rating,
      price: playerPrices.price,
      tier: playerPrices.tier,
    })
    .from(realPlayers)
    .innerJoin(countries, eq(realPlayers.countryId, countries.id))
    .leftJoin(latestRating, eq(latestRating.realPlayerId, realPlayers.id))
    .leftJoin(playerPrices, eq(playerPrices.realPlayerId, realPlayers.id))
    .where(filters.length > 0 ? and(...filters) : undefined)
    .orderBy(...orderBy)
    .limit(500);

  const countryList = await db
    .select({ code: countries.code, name: countries.name })
    .from(countries)
    .orderBy(asc(countries.name));

  // ----------------------------------------------------------------------
  // Personal scouting overlay: for each visible player, count how many
  // managers have rated them ("interest") and surface my own score.
  // ----------------------------------------------------------------------
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const myId = user?.id ?? null;

  const playerIds = rows.map((r) => r.id);
  type PrRow = {
    realPlayerId: string;
    managerId: string;
    score: string;
  };
  const prs: PrRow[] =
    playerIds.length > 0
      ? await db
          .select({
            realPlayerId: personalRatings.realPlayerId,
            managerId: personalRatings.managerId,
            score: personalRatings.score,
          })
          .from(personalRatings)
          .where(inArray(personalRatings.realPlayerId, playerIds))
      : [];

  // Index: player_id → array of (manager_id, score). Lets us derive both
  // the interest count and my-own-score in one pass per row.
  const ratingsByPlayer = new Map<string, PrRow[]>();
  for (const pr of prs) {
    const arr = ratingsByPlayer.get(pr.realPlayerId) ?? [];
    arr.push(pr);
    ratingsByPlayer.set(pr.realPlayerId, arr);
  }

  // League member count for the "N/4" denominator.
  const [league] = await db.select().from(leagues).limit(1);
  const memberList = league
    ? await db
        .select({
          id: leagueMembers.profileId,
          order: leagueMembers.nominationOrder,
          displayName: profiles.displayName,
          teamEmoji: profiles.teamEmoji,
        })
        .from(leagueMembers)
        .innerJoin(profiles, eq(profiles.id, leagueMembers.profileId))
        .where(eq(leagueMembers.leagueId, league.id))
        .orderBy(asc(leagueMembers.nominationOrder))
    : [];
  const memberCount = memberList.length;

  // My saved formulas, for the BulkRatePanel above the table.
  const myProfiles = myId
    ? await db
        .select({
          id: ratingProfiles.id,
          name: ratingProfiles.name,
        })
        .from(ratingProfiles)
        .where(eq(ratingProfiles.managerId, myId))
        .orderBy(asc(ratingProfiles.createdAt))
    : [];
  let myProfilesWithCounts: Array<{
    id: string;
    name: string;
    factorCount: number;
  }> = [];
  if (myProfiles.length > 0) {
    const factorCounts = await db
      .select({
        profileId: ratingProfileFactors.profileId,
        n: sql<number>`count(*)::int`,
      })
      .from(ratingProfileFactors)
      .where(
        inArray(
          ratingProfileFactors.profileId,
          myProfiles.map((p) => p.id)
        )
      )
      .groupBy(ratingProfileFactors.profileId);
    const byProfile = new Map(
      factorCounts.map((f) => [f.profileId, Number(f.n)])
    );
    myProfilesWithCounts = myProfiles.map((p) => ({
      id: p.id,
      name: p.name,
      factorCount: byProfile.get(p.id) ?? 0,
    }));
  }

  // Apply the personal-scouting filters AFTER fetching (we need the
  // per-player interest count derived from ratingsByPlayer):
  //  - "Min interest" filters rows where N managers have rated >= threshold
  //  - "Rated by" narrows to players a specific manager (or "me") rated
  const filteredRows = rows.filter((r) => {
    const playerPrs = ratingsByPlayer.get(r.id) ?? [];
    if (minInterestSafe > 0 && playerPrs.length < minInterestSafe) return false;
    if (ratedByFilter) {
      const targetId = ratedByFilter === "me" ? myId : ratedByFilter;
      if (!targetId) return true;
      if (!playerPrs.some((pr) => pr.managerId === targetId)) return false;
    }
    return true;
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Players</h1>
          <p className="text-sm text-muted-foreground">
            {filteredRows.length}
            {filteredRows.length !== rows.length && (
              <span className="text-muted-foreground/70">
                {" "}
                of {rows.length}
              </span>
            )}{" "}
            {filteredRows.length === 1 ? "player" : "players"}
            {rows.length >= 500 ? " (server cap 500)" : ""}
            {" · sorted by "}
            {sortMode}
          </p>
        </div>
      </div>

      <form className="flex flex-wrap items-end gap-2 text-sm">
        <label className="flex flex-col">
          <span className="text-xs text-muted-foreground mb-1">Search</span>
          <input
            type="text"
            name="q"
            defaultValue={q ?? ""}
            placeholder="Name…"
            className="rounded-md border border-input bg-background px-3 py-1.5 w-56"
          />
        </label>
        <label className="flex flex-col">
          <span className="text-xs text-muted-foreground mb-1">Position</span>
          <select
            name="position"
            defaultValue={posFilter ?? ""}
            className="rounded-md border border-input bg-background px-3 py-1.5"
          >
            <option value="">All</option>
            {POSITIONS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col">
          <span className="text-xs text-muted-foreground mb-1">Country</span>
          <select
            name="country"
            defaultValue={country ?? ""}
            className="rounded-md border border-input bg-background px-3 py-1.5"
          >
            <option value="">All</option>
            {countryList.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col">
          <span className="text-xs text-muted-foreground mb-1">Sort</span>
          <select
            name="sort"
            defaultValue={sortMode}
            className="rounded-md border border-input bg-background px-3 py-1.5"
          >
            <option value="price">Price ↓</option>
            <option value="rating">Rating ↓</option>
            <option value="name">Name</option>
            <option value="country">Country</option>
          </select>
        </label>
        <label className="flex flex-col">
          <span className="text-xs text-muted-foreground mb-1">
            Min interest
          </span>
          <select
            name="interest"
            defaultValue={interest ?? "0"}
            className="rounded-md border border-input bg-background px-3 py-1.5"
            title="Filter to players rated by at least N managers"
          >
            <option value="0">Any</option>
            <option value="1">≥ 1 manager</option>
            <option value="2">≥ 2 managers</option>
            <option value="3">≥ 3 managers</option>
            <option value="4">All {memberCount}</option>
          </select>
        </label>
        <label className="flex flex-col">
          <span className="text-xs text-muted-foreground mb-1">Rated by</span>
          <select
            name="rated_by"
            defaultValue={ratedByFilter}
            className="rounded-md border border-input bg-background px-3 py-1.5"
            title="Filter to players a specific manager has rated"
          >
            <option value="">Anyone</option>
            {myId && (
              <option value="me">Me</option>
            )}
            {memberList.map((m) => (
              <option key={m.id} value={m.id}>
                {m.teamEmoji ? `${m.teamEmoji} ` : ""}
                {m.displayName}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          className="rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-sm font-medium hover:opacity-90 transition"
        >
          Apply
        </button>
        <Link
          href="/players"
          className="rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground transition"
        >
          Reset
        </Link>
        <div className="ml-auto inline-flex rounded-md border border-border overflow-hidden text-xs">
          <Link
            href={`?${new URLSearchParams({
              ...(q ? { q } : {}),
              ...(posFilter ? { position: posFilter } : {}),
              ...(country ? { country } : {}),
              ...(sort ? { sort } : {}),
              ...(interest ? { interest } : {}),
              ...(rated_by ? { rated_by } : {}),
              view: "table",
            }).toString()}`}
            className={`px-3 py-1.5 transition ${
              viewMode === "table"
                ? "bg-foreground text-background"
                : "bg-background hover:bg-muted text-muted-foreground"
            }`}
          >
            Table
          </Link>
          <Link
            href={`?${new URLSearchParams({
              ...(q ? { q } : {}),
              ...(posFilter ? { position: posFilter } : {}),
              ...(country ? { country } : {}),
              ...(sort ? { sort } : {}),
              ...(interest ? { interest } : {}),
              ...(rated_by ? { rated_by } : {}),
              view: "cards",
            }).toString()}`}
            className={`px-3 py-1.5 transition ${
              viewMode === "cards"
                ? "bg-foreground text-background"
                : "bg-background hover:bg-muted text-muted-foreground"
            }`}
          >
            Cards
          </Link>
        </div>
      </form>

      {myProfilesWithCounts.length > 0 && (
        <BulkRatePanel
          profiles={myProfilesWithCounts}
          filters={{
            q: q ?? null,
            position: posFilter,
            countryCode: country ?? null,
          }}
          matchCount={rows.length}
        />
      )}

      {filteredRows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          {rows.length === 0
            ? "No players match the base filters. If the table is empty entirely, run an ingest from /admin."
            : "No players match the scouting filters. Lower the Min interest or change Rated by."}
        </div>
      ) : viewMode === "cards" ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
          {filteredRows.slice(0, 100).map((p) => (
            <PlayerCard
              key={p.id}
              variant="grid"
              player={{
                id: p.id,
                displayName: p.displayName,
                position: p.position as "GK" | "DEF" | "MID" | "FWD",
                rating: p.rating !== null ? Number(p.rating) : null,
                price: p.price,
                tier: p.tier,
                countryName: p.countryName,
                countryCode: p.countryCode,
                flagUrl: p.flagUrl,
                club: p.club,
                photoUrl: p.photoUrl,
              }}
            />
          ))}
          {filteredRows.length > 100 && (
            <div className="col-span-full text-center text-xs text-muted-foreground py-4">
              Showing 100 of {filteredRows.length}. Filter further or switch
              to Table view to see all.
            </div>
          )}
        </div>
      ) : (
        <div className="rounded-lg border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="text-right px-3 py-2 w-16">Price</th>
                <th className="text-right px-3 py-2 w-16" title="Consensus rating (the empirical engine)">Cons.</th>
                <th
                  className="text-right px-3 py-2 w-16"
                  title="Your personal rating from your active scouting profile"
                >
                  Yours
                </th>
                <th
                  className="text-right px-3 py-2 w-16"
                  title="How many managers have rated this player"
                >
                  Interest
                </th>
                <th className="text-left px-3 py-2">Player</th>
                <th className="text-left px-3 py-2">Tier</th>
                <th className="text-left px-3 py-2">Country</th>
                <th className="text-left px-3 py-2">Pos</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((p) => {
                const rating = p.rating !== null ? Number(p.rating) : null;
                const playerPrs = ratingsByPlayer.get(p.id) ?? [];
                const myPr = myId
                  ? playerPrs.find((r) => r.managerId === myId)
                  : undefined;
                const myScore = myPr ? Number(myPr.score) : null;
                const interest = playerPrs.length;
                return (
                  <tr
                    key={p.id}
                    className="border-t border-border hover:bg-muted/30"
                  >
                    <td className="px-3 py-2 text-right tabular-nums">
                      {p.price !== null && p.price !== undefined ? (
                        <PriceBadge value={p.price} />
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {rating !== null ? (
                        <RatingBadge value={rating} />
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {myScore !== null ? (
                        <YoursBadge value={myScore} consensus={rating} />
                      ) : (
                        <span className="text-muted-foreground/60">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {interest > 0 ? (
                        <InterestBadge n={interest} of={memberCount} />
                      ) : (
                        <span className="text-muted-foreground/60">
                          0/{memberCount || "—"}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 font-medium">
                      <Link
                        href={`/players/${p.id}`}
                        className="hover:underline"
                      >
                        {p.displayName}
                      </Link>
                    </td>
                    <td className="px-3 py-2">
                      {p.tier ? <TierBadge tier={p.tier} /> : "—"}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {p.flagUrl && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={p.flagUrl}
                          alt=""
                          className="inline-block w-4 h-4 mr-1 align-text-bottom"
                        />
                      )}
                      {p.countryName}
                    </td>
                    <td className="px-3 py-2">
                      <PositionBadge position={p.position} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function PositionBadge({ position }: { position: string }) {
  const color: Record<string, string> = {
    GK: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
    DEF: "bg-sky-500/15 text-sky-700 dark:text-sky-400",
    MID: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
    FWD: "bg-rose-500/15 text-rose-700 dark:text-rose-400",
  };
  return (
    <span
      className={`inline-block rounded px-1.5 py-0.5 text-xs font-medium ${
        color[position] ?? "bg-muted text-muted-foreground"
      }`}
    >
      {position}
    </span>
  );
}

function RatingBadge({ value }: { value: number }) {
  const tone =
    value >= 85
      ? "text-rose-700 dark:text-rose-400 font-semibold"
      : value >= 70
      ? "text-foreground font-medium"
      : value >= 50
      ? "text-muted-foreground"
      : "text-muted-foreground/60";
  return <span className={tone}>{value.toFixed(1)}</span>;
}

function PriceBadge({ value }: { value: number }) {
  const tone =
    value >= 30
      ? "text-emerald-700 dark:text-emerald-400 font-bold"
      : value >= 15
      ? "text-foreground font-semibold"
      : value >= 5
      ? "text-foreground"
      : "text-muted-foreground";
  return <span className={tone}>{value}</span>;
}

function YoursBadge({
  value,
  consensus,
}: {
  value: number;
  consensus: number | null;
}) {
  // Encode conviction: how far above/below consensus your view sits.
  const delta = consensus !== null ? value - consensus : null;
  const arrow =
    delta === null
      ? ""
      : delta >= 5
      ? "↑"
      : delta <= -5
      ? "↓"
      : "";
  const tone =
    delta === null
      ? "text-foreground font-medium"
      : delta >= 5
      ? "text-emerald-700 dark:text-emerald-400 font-semibold"
      : delta <= -5
      ? "text-rose-700 dark:text-rose-400 font-semibold"
      : "text-foreground font-medium";
  return (
    <span
      className={tone}
      title={
        delta === null
          ? "your rating"
          : `${delta >= 0 ? "+" : ""}${delta.toFixed(1)} vs consensus`
      }
    >
      {value.toFixed(0)}
      {arrow && <span className="ml-0.5 text-xs">{arrow}</span>}
    </span>
  );
}

function InterestBadge({ n, of }: { n: number; of: number }) {
  // Heat by share-of-league: 4/4 = scorching, 1/4 = cool.
  const tone =
    of <= 0
      ? "text-muted-foreground"
      : n >= of
      ? "text-rose-700 dark:text-rose-400 font-bold"
      : n >= Math.ceil(of * 0.75)
      ? "text-amber-700 dark:text-amber-400 font-semibold"
      : n >= 2
      ? "text-foreground font-medium"
      : "text-muted-foreground";
  return (
    <span className={tone} title={`${n} of ${of} managers rated`}>
      {n}/{of || "—"}
    </span>
  );
}

function TierBadge({ tier }: { tier: string }) {
  const styles: Record<string, string> = {
    superstar: "bg-rose-500/15 text-rose-700 dark:text-rose-400",
    star: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
    starter: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
    rotation: "bg-sky-500/15 text-sky-700 dark:text-sky-400",
    depth: "bg-muted text-muted-foreground",
  };
  return (
    <span
      className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider ${
        styles[tier] ?? "bg-muted text-muted-foreground"
      }`}
    >
      {tier}
    </span>
  );
}
