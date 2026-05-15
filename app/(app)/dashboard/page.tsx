import Link from "next/link";
import { and, asc, count, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  auctionLots,
  countries,
  drafts,
  fixtures,
  leagueMembers,
  leagues,
  personalRatings,
  playerPrices,
  profiles,
  ratingProfiles,
  realPlayers,
  rosters,
} from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata = { title: "Dashboard · FiFantasy" };

const WC_KICKOFF = new Date("2026-06-11T16:00:00Z");

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [league] = await db.select().from(leagues).limit(1);
  const [draft] = league
    ? await db
        .select()
        .from(drafts)
        .where(eq(drafts.leagueId, league.id))
        .limit(1)
    : [];

  const members = league
    ? await db
        .select({
          id: leagueMembers.profileId,
          order: leagueMembers.nominationOrder,
          displayName: profiles.displayName,
          teamEmoji: profiles.teamEmoji,
          teamName: profiles.teamName,
        })
        .from(leagueMembers)
        .innerJoin(profiles, eq(profiles.id, leagueMembers.profileId))
        .where(eq(leagueMembers.leagueId, league.id))
        .orderBy(asc(leagueMembers.nominationOrder))
    : [];

  const isMember = user && members.some((m) => m.id === user.id);

  const mySquad = user && league
    ? await db
        .select({
          realPlayerId: rosters.realPlayerId,
          displayName: realPlayers.displayName,
          position: realPlayers.position,
          acquiredAmount: rosters.acquiredAmount,
          countryName: countries.name,
          tier: playerPrices.tier,
        })
        .from(rosters)
        .innerJoin(realPlayers, eq(realPlayers.id, rosters.realPlayerId))
        .innerJoin(countries, eq(countries.id, realPlayers.countryId))
        .leftJoin(playerPrices, eq(playerPrices.realPlayerId, realPlayers.id))
        .where(
          and(
            eq(rosters.leagueId, league.id),
            eq(rosters.profileId, user.id),
            isNull(rosters.droppedAt)
          )
        )
    : [];

  // Auction activity: recent sold lots
  const recentSold = draft
    ? await db
        .select({
          lotNumber: auctionLots.lotNumber,
          soldAt: auctionLots.soldAt,
          amount: auctionLots.currentBid,
          bidderName: profiles.displayName,
          bidderEmoji: profiles.teamEmoji,
          playerName: realPlayers.displayName,
          position: realPlayers.position,
          countryName: countries.name,
        })
        .from(auctionLots)
        .innerJoin(profiles, eq(profiles.id, auctionLots.currentBidderId))
        .innerJoin(realPlayers, eq(realPlayers.id, auctionLots.realPlayerId))
        .innerJoin(countries, eq(countries.id, realPlayers.countryId))
        .where(
          and(eq(auctionLots.draftId, draft.id), eq(auctionLots.status, "sold"))
        )
        .orderBy(desc(auctionLots.soldAt))
        .limit(5)
    : [];

  // Scouting summary
  const [profileCount] = user
    ? await db
        .select({ n: count() })
        .from(ratingProfiles)
        .where(eq(ratingProfiles.managerId, user.id))
    : [{ n: 0 }];
  const [ratedCount] = user
    ? await db
        .select({ n: count() })
        .from(personalRatings)
        .where(eq(personalRatings.managerId, user.id))
    : [{ n: 0 }];

  // Next fixtures
  const upcoming = await db
    .select({
      kickoff: fixtures.kickoffAt,
      stage: fixtures.stage,
      homeName: sql<string>`coalesce((select name from countries where id = ${fixtures.homeCountryId}), 'TBD')`,
      awayName: sql<string>`coalesce((select name from countries where id = ${fixtures.awayCountryId}), 'TBD')`,
    })
    .from(fixtures)
    .where(sql`${fixtures.kickoffAt} > now()`)
    .orderBy(asc(fixtures.kickoffAt))
    .limit(5);

  const daysToKickoff = Math.max(
    0,
    Math.round((WC_KICKOFF.getTime() - Date.now()) / (24 * 60 * 60 * 1000))
  );
  const draftStatus = draft?.status ?? "no draft";
  const rosterSize = draft?.rosterSize ?? 20;
  const totalBudget = draft?.budgetPerManager ?? 200;

  const spent = mySquad.reduce((a, p) => a + (p.acquiredAmount ?? 0), 0);
  const remaining = totalBudget - spent;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {greetingFor(user?.email ?? null)}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          {league?.name ?? "No league configured."} ·{" "}
          <span className="text-foreground">{draftStatus}</span>
          {daysToKickoff > 0 && (
            <> · {daysToKickoff} days to first kickoff</>
          )}
        </p>
      </div>

      <section className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat
          label="Your squad"
          value={`${mySquad.length}/${rosterSize}`}
          hint={`${remaining} cr left`}
          href="/team"
        />
        <Stat
          label="Your formulas"
          value={profileCount.n}
          hint={`rated ${ratedCount.n} players`}
          href="/scouting/profiles"
        />
        <Stat
          label="Managers"
          value={`${members.length}/4`}
          hint={members.length < 4 ? "waiting for signups" : "league full"}
        />
        <Stat
          label="Days to kickoff"
          value={daysToKickoff}
          hint={WC_KICKOFF.toDateString()}
        />
      </section>

      <PrimaryCta draft={draft} isMember={!!isMember} />

      <div className="grid gap-6 lg:grid-cols-3">
        <section className="lg:col-span-2 space-y-3">
          <h2 className="text-xs uppercase tracking-widest text-muted-foreground">
            Recent auction activity
          </h2>
          {recentSold.length === 0 ? (
            <p className="text-sm text-muted-foreground italic">
              Nothing sold yet.{" "}
              {draft?.status === "live"
                ? "Auction is live — go win something."
                : "The auction will populate here once underway."}
            </p>
          ) : (
            <div className="space-y-2">
              {recentSold.map((s) => (
                <div
                  key={s.lotNumber}
                  className="rounded-lg border border-border bg-card px-4 py-3 flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">
                      <span className="text-muted-foreground">
                        Lot {s.lotNumber} ·{" "}
                      </span>
                      {s.playerName}
                      <span className="ml-2 text-xs text-muted-foreground">
                        {s.position} · {s.countryName}
                      </span>
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      to{" "}
                      <strong className="text-foreground">
                        {s.bidderEmoji} {s.bidderName}
                      </strong>
                      {s.soldAt &&
                        ` · ${new Date(s.soldAt).toLocaleString()}`}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="rounded bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 px-2.5 py-1 text-sm font-bold tabular-nums">
                      {s.amount} cr
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="space-y-3">
          <h2 className="text-xs uppercase tracking-widest text-muted-foreground">
            Upcoming fixtures
          </h2>
          {upcoming.length === 0 ? (
            <p className="text-sm text-muted-foreground italic">
              No upcoming fixtures.
            </p>
          ) : (
            <div className="rounded-lg border border-border bg-card divide-y divide-border">
              {upcoming.map((f, i) => (
                <div key={i} className="px-3 py-2 text-sm">
                  <p className="text-xs uppercase tracking-wider text-muted-foreground">
                    {f.stage}
                  </p>
                  <p className="font-medium truncate">
                    {f.homeName}{" "}
                    <span className="text-muted-foreground">vs</span>{" "}
                    {f.awayName}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(f.kickoff).toLocaleString()}
                  </p>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <section className="space-y-3">
        <h2 className="text-xs uppercase tracking-widest text-muted-foreground">
          Managers
        </h2>
        {members.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
            No managers yet. Run <code>pnpm seed:league</code> after signups.
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {members.map((m) => (
              <Link
                key={m.id}
                href={user?.id === m.id ? "/team" : `/team?manager=${m.id}`}
                className="rounded-lg border border-border bg-card p-4 hover:bg-muted transition"
              >
                <p className="text-2xl">{m.teamEmoji ?? "👤"}</p>
                <p className="font-medium mt-1 truncate">
                  {m.displayName}
                  {user?.id === m.id && (
                    <span className="ml-1 text-xs text-muted-foreground">
                      (you)
                    </span>
                  )}
                </p>
                {m.teamName && (
                  <p className="text-xs text-muted-foreground truncate">
                    {m.teamName}
                  </p>
                )}
                <p className="text-xs text-muted-foreground mt-1">
                  Manager #{m.order}
                </p>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function greetingFor(email: string | null): string {
  if (!email) return "Welcome";
  const name = email.split("@")[0];
  const hour = new Date().getHours();
  const part =
    hour < 5 || hour >= 22
      ? "Up late"
      : hour < 12
      ? "Morning"
      : hour < 17
      ? "Afternoon"
      : "Evening";
  return `${part}, ${name}`;
}

function Stat({
  label,
  value,
  hint,
  href,
}: {
  label: string;
  value: number | string;
  hint?: string;
  href?: string;
}) {
  const inner = (
    <div className="rounded-lg border border-border bg-card p-4 h-full">
      <p className="text-xs uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      {hint && (
        <p className="text-xs text-muted-foreground mt-0.5 truncate">{hint}</p>
      )}
    </div>
  );
  if (href) {
    return (
      <Link href={href} className="block hover:opacity-80 transition">
        {inner}
      </Link>
    );
  }
  return inner;
}

function PrimaryCta({
  draft,
  isMember,
}: {
  draft: typeof drafts.$inferSelect | undefined;
  isMember: boolean;
}) {
  if (!draft) {
    return (
      <section className="rounded-lg border border-dashed border-border p-4 text-sm">
        No draft scheduled. Have an admin run{" "}
        <code className="rounded bg-muted px-1.5 py-0.5">pnpm seed:league</code>.
      </section>
    );
  }
  if (!isMember) {
    return (
      <section className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 text-sm">
        You&apos;re signed in but not yet a league member. An admin needs to
        run <code className="rounded bg-muted px-1.5 py-0.5">pnpm seed:league</code> to add you.
      </section>
    );
  }
  if (draft.status === "scheduled") {
    return (
      <section className="rounded-xl border border-primary/30 bg-primary/5 p-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium">Pre-draft prep</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Build your scouting formulas, rate the players you want, then
            head to the draft when everyone&apos;s ready.
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/scouting/profiles"
            className="rounded-md border border-border bg-background px-3 py-1.5 text-sm hover:bg-muted transition"
          >
            Scouting →
          </Link>
          <Link
            href="/draft"
            className="rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-sm font-medium hover:opacity-90 transition"
          >
            Draft room →
          </Link>
        </div>
      </section>
    );
  }
  if (draft.status === "live") {
    return (
      <section className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">
            ● Draft is live
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Get in there before someone steals your target.
          </p>
        </div>
        <Link
          href="/draft"
          className="rounded-md bg-emerald-600 text-white px-4 py-2 text-sm font-semibold hover:opacity-90 transition"
        >
          Open draft room →
        </Link>
      </section>
    );
  }
  if (draft.status === "paused") {
    return (
      <section className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-5">
        <p className="text-sm font-medium text-amber-700 dark:text-amber-400">
          ⏸ Draft is paused
        </p>
        <p className="text-xs text-muted-foreground mt-0.5">
          A commissioner has frozen bidding. Resumes from{" "}
          <Link href="/draft/admin" className="underline">
            /draft/admin
          </Link>
          .
        </p>
      </section>
    );
  }
  if (draft.status === "complete") {
    return (
      <section className="rounded-xl border border-sky-500/30 bg-sky-500/5 p-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-sky-700 dark:text-sky-400">
            Draft complete 🎉
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Set your lineup before kickoff (Phase 5).
          </p>
        </div>
        <Link
          href="/draft/recap/scouting"
          className="rounded-md border border-border bg-background px-3 py-1.5 text-sm hover:bg-muted transition"
        >
          Scouting reveal →
        </Link>
      </section>
    );
  }
  return null;
}
