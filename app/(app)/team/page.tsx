import Link from "next/link";
import { redirect } from "next/navigation";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  countries,
  drafts,
  leagueMembers,
  leagues,
  managerBudgets,
  playerPrices,
  playerRatings,
  profiles,
  realPlayers,
  rosters,
} from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/server";
import { PlayerCard } from "@/components/PlayerCard";

export const dynamic = "force-dynamic";

export const metadata = { title: "Team · FiFantasy" };

const POSITIONS = ["GK", "DEF", "MID", "FWD"] as const;

const POSITION_LABEL: Record<(typeof POSITIONS)[number], string> = {
  GK: "Goalkeepers",
  DEF: "Defenders",
  MID: "Midfielders",
  FWD: "Forwards",
};

type SearchParams = Promise<{ manager?: string }>;

export default async function TeamPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { manager } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [league] = await db.select().from(leagues).limit(1);
  if (!league) {
    return (
      <Empty>
        No league yet. Run <code>pnpm seed:league</code>.
      </Empty>
    );
  }

  const [draft] = await db
    .select()
    .from(drafts)
    .where(eq(drafts.leagueId, league.id))
    .limit(1);

  // Members in nomination order — used for the switcher.
  const members = await db
    .select({
      id: leagueMembers.profileId,
      order: leagueMembers.nominationOrder,
      displayName: profiles.displayName,
      teamName: profiles.teamName,
      teamEmoji: profiles.teamEmoji,
    })
    .from(leagueMembers)
    .innerJoin(profiles, eq(profiles.id, leagueMembers.profileId))
    .where(eq(leagueMembers.leagueId, league.id))
    .orderBy(asc(leagueMembers.nominationOrder));

  // Default to viewing my own squad. ?manager=<id> lets you scout opponents.
  const viewingId = manager
    ? members.find((m) => m.id === manager)?.id
    : user.id;
  if (!viewingId) {
    return (
      <Empty>
        That manager isn&apos;t in the league.{" "}
        <Link href="/team" className="underline">
          View your team →
        </Link>
      </Empty>
    );
  }
  const viewing = members.find((m) => m.id === viewingId);
  const isMe = viewingId === user.id;

  // Squad rows — active (non-dropped) rosters for the chosen manager.
  const squad = await db
    .select({
      realPlayerId: rosters.realPlayerId,
      acquiredAmount: rosters.acquiredAmount,
      acquiredVia: rosters.acquiredVia,
      acquiredAt: rosters.acquiredAt,
      displayName: realPlayers.displayName,
      fullName: realPlayers.fullName,
      position: realPlayers.position,
      shirtNumber: realPlayers.shirtNumber,
      club: realPlayers.club,
      photoUrl: realPlayers.photoUrl,
      countryCode: countries.code,
      countryName: countries.name,
      flagUrl: countries.flagUrl,
      price: playerPrices.price,
      tier: playerPrices.tier,
    })
    .from(rosters)
    .innerJoin(realPlayers, eq(realPlayers.id, rosters.realPlayerId))
    .innerJoin(countries, eq(countries.id, realPlayers.countryId))
    .leftJoin(playerPrices, eq(playerPrices.realPlayerId, realPlayers.id))
    .where(
      and(
        eq(rosters.leagueId, league.id),
        eq(rosters.profileId, viewingId),
        isNull(rosters.droppedAt)
      )
    )
    .orderBy(desc(rosters.acquiredAt));

  // Latest rating per player — fetch all then pick max(asOf) per player.
  // ~20 squad rows * a few ratings each = trivial to do in JS, simpler
  // than DISTINCT ON.
  const squadPlayerIds = squad.map((s) => s.realPlayerId);
  const ratingRows =
    squadPlayerIds.length > 0
      ? await db
          .select({
            realPlayerId: playerRatings.realPlayerId,
            rating: playerRatings.rating,
            asOf: playerRatings.asOf,
          })
          .from(playerRatings)
          .where(inArray(playerRatings.realPlayerId, squadPlayerIds))
      : [];
  const latestByPlayer = new Map<string, { rating: number; asOf: Date }>();
  for (const r of ratingRows) {
    const existing = latestByPlayer.get(r.realPlayerId);
    if (!existing || r.asOf > existing.asOf) {
      latestByPlayer.set(r.realPlayerId, {
        rating: Number(r.rating),
        asOf: r.asOf,
      });
    }
  }
  const ratingByPlayer = new Map<string, number>();
  for (const [id, v] of latestByPlayer) ratingByPlayer.set(id, v.rating);

  // Manager budget (post-draft is the truth; pre-draft these counters are 0).
  const [budget] = draft
    ? await db
        .select()
        .from(managerBudgets)
        .where(
          and(
            eq(managerBudgets.draftId, draft.id),
            eq(managerBudgets.profileId, viewingId)
          )
        )
        .limit(1)
    : [];

  const reqs = (draft?.rosterRequirements as Record<string, number>) ?? {
    GK: 2,
    DEF: 6,
    MID: 7,
    FWD: 5,
  };
  const rosterSize = draft?.rosterSize ?? 20;
  const totalBudget = draft?.budgetPerManager ?? 200;
  const spent = budget?.spent ?? 0;
  const slotsFilled = budget?.slotsFilled ?? squad.length;
  const remaining = totalBudget - spent;

  // Group squad by position
  const byPosition = new Map<string, typeof squad>();
  for (const p of POSITIONS) byPosition.set(p, []);
  for (const p of squad) {
    const arr = byPosition.get(p.position) ?? [];
    arr.push(p);
    byPosition.set(p.position, arr);
  }

  // Lineup CTA — only when viewing own team, with a roster. Links to MD 1
  // for now (WC kicks off June 11); will become "next upcoming MD" once
  // we have a helper for that.
  const showLineupCta = isMe && squad.length > 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {isMe ? "Your squad" : `${viewing?.teamEmoji ?? ""} ${viewing?.displayName}`}
            {viewing?.teamName && (
              <span className="ml-2 text-base font-normal text-muted-foreground">
                ({viewing.teamName})
              </span>
            )}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {squad.length}/{rosterSize} players · {spent} spent · {remaining} remaining
            {draft && (
              <>
                {" · draft "}
                <code>{draft.status}</code>
              </>
            )}
          </p>
        </div>
        {showLineupCta && (
          <Link
            href="/team/lineup/1"
            className="rounded-md bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 text-sm font-semibold transition-all hover:scale-[1.03] hover:shadow-md hover:shadow-emerald-500/30"
          >
            Set lineup →
          </Link>
        )}
      </div>

      {/* Manager switcher */}
      <ManagerSwitcher
        members={members}
        currentId={viewingId}
        myId={user.id}
      />

      {/* Budget bar */}
      <section className="rounded-lg border border-border bg-card p-4 space-y-2">
        <div className="flex items-baseline justify-between text-sm">
          <span className="font-medium">Budget</span>
          <span className="tabular-nums">
            <span className="font-semibold">{spent}</span>
            <span className="text-muted-foreground"> / {totalBudget} cr</span>
          </span>
        </div>
        <div className="h-2 rounded-full bg-muted overflow-hidden">
          <div
            className={`h-full transition-all ${
              remaining < 20
                ? "bg-rose-500"
                : remaining < 50
                ? "bg-amber-500"
                : "bg-emerald-500"
            }`}
            style={{ width: `${Math.min(100, (spent / totalBudget) * 100)}%` }}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          Avg per remaining slot:{" "}
          <span className="tabular-nums">
            {slotsFilled < rosterSize
              ? Math.round(remaining / (rosterSize - slotsFilled))
              : 0}
          </span>{" "}
          cr
        </p>
      </section>

      {/* Position quota cards */}
      <section className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {POSITIONS.map((pos) => {
          const filled = (byPosition.get(pos) ?? []).length;
          const required = reqs[pos] ?? 0;
          const done = filled >= required;
          return (
            <div
              key={pos}
              className={`rounded-lg border p-3 ${
                done
                  ? "border-emerald-500/30 bg-emerald-500/5"
                  : "border-border bg-card"
              }`}
            >
              <p className="text-xs uppercase tracking-wider text-muted-foreground">
                {POSITION_LABEL[pos]}
              </p>
              <p className="text-2xl font-semibold tabular-nums mt-1">
                {filled}
                <span className="text-base text-muted-foreground">/{required}</span>
              </p>
            </div>
          );
        })}
      </section>

      {/* Squad grouped by position — FIFA card grid */}
      {squad.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          {isMe
            ? "You haven't won any players yet. Your squad will populate as you win bids in the draft."
            : "This manager hasn't won any players yet."}
        </div>
      ) : (
        <div className="space-y-6">
          {POSITIONS.map((pos) => {
            const players = byPosition.get(pos) ?? [];
            if (players.length === 0) return null;
            return (
              <section key={pos} className="space-y-3">
                <h2 className="text-xs uppercase tracking-widest text-muted-foreground">
                  {POSITION_LABEL[pos]} ·{" "}
                  <span className="text-foreground">{players.length}</span>
                  <span className="text-muted-foreground/70">
                    /{reqs[pos] ?? 0}
                  </span>
                </h2>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                  {players.map((p) => (
                    <PlayerCard
                      key={p.realPlayerId}
                      variant="grid"
                      player={{
                        id: p.realPlayerId,
                        displayName: p.displayName,
                        position: p.position as "GK" | "DEF" | "MID" | "FWD",
                        rating:
                          ratingByPlayer.get(p.realPlayerId) ?? null,
                        // Show what they paid rather than current price on the team page
                        // — owned players don't care about price drift.
                        price: p.acquiredAmount,
                        tier: p.tier,
                        countryName: p.countryName,
                        countryCode: p.countryCode,
                        flagUrl: p.flagUrl,
                        club: p.club,
                        photoUrl: p.photoUrl,
                      }}
                    />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {/* Phase 5 stub */}
      <section className="rounded-lg border border-dashed border-border p-4 text-xs text-muted-foreground">
        <p>
          <strong>Coming in Phase 5:</strong> formation picker + pitch view +
          captain/vice for matchday lineups. Squad locks at first WC kickoff;
          this page becomes the lineup builder.
        </p>
      </section>
    </div>
  );
}

function ManagerSwitcher({
  members,
  currentId,
  myId,
}: {
  members: Array<{
    id: string;
    order: number;
    displayName: string;
    teamName: string | null;
    teamEmoji: string | null;
  }>;
  currentId: string;
  myId: string;
}) {
  return (
    <nav className="flex flex-wrap gap-1.5 text-xs">
      {members.map((m) => {
        const active = m.id === currentId;
        const isMe = m.id === myId;
        return (
          <Link
            key={m.id}
            href={isMe ? "/team" : `/team?manager=${m.id}`}
            className={`rounded-md border px-2.5 py-1.5 transition ${
              active
                ? "border-foreground bg-foreground text-background"
                : "border-border bg-card hover:bg-muted"
            }`}
          >
            {m.teamEmoji ?? "👤"} {m.displayName}
            {isMe && (
              <span className="ml-1 opacity-70">(you)</span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Team</h1>
      <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
        {children}
      </div>
    </div>
  );
}
