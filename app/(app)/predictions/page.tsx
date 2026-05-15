import { redirect } from "next/navigation";
import { asc, eq, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/lib/db";
import {
  countries,
  fixtures,
  leagueMembers,
  leagues,
  predictions,
  profiles,
} from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/server";
import PredictionRow from "./PredictionRow";

export const dynamic = "force-dynamic";

export const metadata = { title: "Predictions · FiFantasy" };

export default async function PredictionsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const myId = user.id;

  // Members for the leaderboard
  const [league] = await db.select().from(leagues).limit(1);
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

  // Per-manager: total points + number of predictions made + number scored
  type LeaderRow = {
    profileId: string;
    totalPoints: number;
    predictionsCount: number;
    scoredCount: number;
  };
  const leaderRows: LeaderRow[] = (
    (await db.execute(sql`
      select
        profile_id as "profileId",
        coalesce(sum(points_awarded), 0)::int as "totalPoints",
        count(*)::int as "predictionsCount",
        count(*) filter (where points_awarded is not null)::int as "scoredCount"
      from predictions
      group by profile_id
    `)) as unknown as LeaderRow[]
  );
  const leaderByProfile = new Map<string, LeaderRow>(
    leaderRows.map((r) => [r.profileId, r])
  );

  // Fixtures with both teams resolved (some knockout slots are TBD)
  const home = alias(countries, "home");
  const away = alias(countries, "away");
  const fixtureRows = await db
    .select({
      id: fixtures.id,
      kickoffAt: fixtures.kickoffAt,
      stage: fixtures.stage,
      status: fixtures.status,
      homeFinal: fixtures.homeScore,
      awayFinal: fixtures.awayScore,
      homeName: home.name,
      homeCode: home.code,
      homeFlag: home.flagUrl,
      awayName: away.name,
      awayCode: away.code,
      awayFlag: away.flagUrl,
    })
    .from(fixtures)
    .innerJoin(home, eq(fixtures.homeCountryId, home.id))
    .innerJoin(away, eq(fixtures.awayCountryId, away.id))
    .orderBy(asc(fixtures.kickoffAt));

  // My predictions, indexed by fixture
  const myPredictions = await db
    .select()
    .from(predictions)
    .where(eq(predictions.profileId, myId));
  const myByFixture = new Map<
    string,
    { homeScore: number; awayScore: number; pointsAwarded: number | null }
  >();
  for (const p of myPredictions) {
    myByFixture.set(p.fixtureId, {
      homeScore: p.homeScore,
      awayScore: p.awayScore,
      pointsAwarded: p.pointsAwarded,
    });
  }

  const now = Date.now();
  const upcoming = fixtureRows.filter(
    (f) => f.kickoffAt.getTime() > now
  );
  const past = fixtureRows
    .filter((f) => f.kickoffAt.getTime() <= now)
    .reverse(); // most-recent first

  const myLeader = leaderByProfile.get(myId);

  // Sort leaderboard by total points desc, with ties broken by predictions made
  const leaderboard = members
    .map((m) => ({
      ...m,
      stats: leaderByProfile.get(m.id) ?? {
        profileId: m.id,
        totalPoints: 0,
        predictionsCount: 0,
        scoredCount: 0,
      },
    }))
    .sort((a, b) => {
      if (b.stats.totalPoints !== a.stats.totalPoints) {
        return b.stats.totalPoints - a.stats.totalPoints;
      }
      return b.stats.predictionsCount - a.stats.predictionsCount;
    });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Predictions</h1>
        <p className="text-sm text-muted-foreground mt-1">
          A side game: predict the score of every WC fixture, earn points,
          climb the leaderboard. Predictions lock at kickoff.
        </p>
        <p className="text-xs text-muted-foreground mt-2">
          Scoring · <strong>3 pts</strong> exact · <strong>2 pts</strong>{" "}
          correct outcome + goal difference · <strong>1 pt</strong> correct
          outcome only · <strong>0</strong> otherwise.
        </p>
      </div>

      {/* Leaderboard */}
      <section className="space-y-2">
        <h2 className="text-xs uppercase tracking-widest text-muted-foreground">
          Leaderboard
        </h2>
        {leaderboard.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
            No league members yet.
          </div>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {leaderboard.map((m, idx) => {
              const isMe = m.id === myId;
              const rank = idx + 1;
              return (
                <div
                  key={m.id}
                  className={`rounded-xl border p-3 transition ${
                    rank === 1
                      ? "border-amber-500/40 bg-amber-500/5"
                      : isMe
                      ? "border-emerald-500/30 bg-emerald-500/5"
                      : "border-border bg-card"
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <div
                      className={`w-9 h-9 rounded-full flex items-center justify-center text-lg shrink-0 ring-2 ${
                        rank === 1
                          ? "ring-amber-500/50 bg-amber-500/15"
                          : "ring-border bg-muted"
                      }`}
                    >
                      {m.teamEmoji ?? "👤"}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">
                        {rank === 1 && <span className="mr-1">🏆</span>}
                        {m.displayName}
                        {isMe && (
                          <span className="ml-1 text-xs text-muted-foreground">
                            (you)
                          </span>
                        )}
                      </p>
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                        Rank #{rank}
                      </p>
                    </div>
                  </div>
                  <div className="mt-2 flex items-baseline justify-between">
                    <div>
                      <span className="text-2xl font-bold tabular-nums">
                        {m.stats.totalPoints}
                      </span>
                      <span className="text-xs text-muted-foreground ml-1">
                        pts
                      </span>
                    </div>
                    <span className="text-[10px] tabular-nums text-muted-foreground">
                      {m.stats.predictionsCount} pred·{" "}
                      {m.stats.scoredCount} scored
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {myLeader && (
          <p className="text-xs text-muted-foreground mt-2">
            You: <strong className="text-foreground">{myLeader.totalPoints}</strong>{" "}
            pts from {myLeader.predictionsCount} prediction
            {myLeader.predictionsCount === 1 ? "" : "s"} (
            {myLeader.scoredCount} scored,{" "}
            {myLeader.predictionsCount - myLeader.scoredCount} pending)
          </p>
        )}
      </section>

      {/* Upcoming fixtures — editable */}
      <section className="space-y-3">
        <h2 className="text-xs uppercase tracking-widest text-muted-foreground">
          Upcoming · {upcoming.length} fixture
          {upcoming.length === 1 ? "" : "s"}
        </h2>
        {upcoming.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            All fixtures kicked off. Check the past section below for results.
          </div>
        ) : (
          <div className="rounded-lg border border-border bg-card divide-y divide-border">
            {upcoming.map((f) => (
              <PredictionRow
                key={f.id}
                fixture={{
                  id: f.id,
                  stage: f.stage,
                  kickoffAt: f.kickoffAt.toISOString(),
                  status: f.status,
                  homeName: f.homeName,
                  homeFlag: f.homeFlag,
                  awayName: f.awayName,
                  awayFlag: f.awayFlag,
                  homeFinal: f.homeFinal,
                  awayFinal: f.awayFinal,
                }}
                myPrediction={myByFixture.get(f.id) ?? null}
                mode="upcoming"
              />
            ))}
          </div>
        )}
      </section>

      {/* Past fixtures — locked, show results */}
      {past.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-xs uppercase tracking-widest text-muted-foreground">
            Past · {past.length} fixture{past.length === 1 ? "" : "s"}
          </h2>
          <div className="rounded-lg border border-border bg-card divide-y divide-border">
            {past.slice(0, 30).map((f) => (
              <PredictionRow
                key={f.id}
                fixture={{
                  id: f.id,
                  stage: f.stage,
                  kickoffAt: f.kickoffAt.toISOString(),
                  status: f.status,
                  homeName: f.homeName,
                  homeFlag: f.homeFlag,
                  awayName: f.awayName,
                  awayFlag: f.awayFlag,
                  homeFinal: f.homeFinal,
                  awayFinal: f.awayFinal,
                }}
                myPrediction={myByFixture.get(f.id) ?? null}
                mode="past"
              />
            ))}
          </div>
          {past.length > 30 && (
            <p className="text-xs text-muted-foreground text-center">
              showing 30 most-recent of {past.length}
            </p>
          )}
        </section>
      )}
    </div>
  );
}
