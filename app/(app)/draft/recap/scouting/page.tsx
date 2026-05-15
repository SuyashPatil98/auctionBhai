import Link from "next/link";
import { redirect } from "next/navigation";
import { asc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  drafts,
  leagueMembers,
  leagues,
  personalRatings,
  profiles,
  ratingProfileFactors,
  ratingProfiles,
  rosters,
  realPlayers,
} from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/server";
import { FACTORS, type FactorId } from "@/lib/personal-rating/factors";

export const dynamic = "force-dynamic";

export const metadata = { title: "Scouting recap · FiFantasy" };

/**
 * Post-draft scouting reveal. Available once the draft is `live`, `paused`,
 * or `complete` — the formulas froze at startDraft so they're safe to show.
 *
 * Two sections per manager:
 *  - Their saved formulas (factor list + importance)
 *  - The players they bought and what their personal-rating said
 */

export default async function ScoutingRecapPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [league] = await db.select().from(leagues).limit(1);
  if (!league) return <EmptyState reason="No league yet." />;

  const [draft] = await db
    .select()
    .from(drafts)
    .where(eq(drafts.leagueId, league.id))
    .limit(1);

  if (!draft || draft.status === "scheduled") {
    return (
      <EmptyState reason="The draft hasn't started yet — formulas are still private." />
    );
  }

  // Members in nomination order = the canonical "A/B/C/D" reading.
  const members = await db
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
    .orderBy(asc(leagueMembers.nominationOrder));

  if (members.length === 0) {
    return <EmptyState reason="No members in the league." />;
  }

  const memberIds = members.map((m) => m.id);

  // All saved profiles for these managers + their factors.
  const allProfiles = await db
    .select()
    .from(ratingProfiles)
    .where(inArray(ratingProfiles.managerId, memberIds))
    .orderBy(asc(ratingProfiles.createdAt));

  const factorRows =
    allProfiles.length > 0
      ? await db
          .select()
          .from(ratingProfileFactors)
          .where(
            inArray(
              ratingProfileFactors.profileId,
              allProfiles.map((p) => p.id)
            )
          )
      : [];

  const factorsByProfile = new Map<
    string,
    Array<{ factor_id: FactorId; importance: "important" | "standard" }>
  >();
  for (const r of factorRows) {
    const arr = factorsByProfile.get(r.profileId) ?? [];
    arr.push({
      factor_id: r.factorId as FactorId,
      importance: r.importance,
    });
    factorsByProfile.set(r.profileId, arr);
  }

  // Roster picks per manager → join with their personal rating for that
  // player so we can show "you paid 28 — your formula said 73".
  const rosterRows = await db
    .select({
      managerId: rosters.profileId,
      acquiredAmount: rosters.acquiredAmount,
      acquiredAt: rosters.acquiredAt,
      playerName: realPlayers.displayName,
      playerId: realPlayers.id,
    })
    .from(rosters)
    .innerJoin(realPlayers, eq(realPlayers.id, rosters.realPlayerId))
    .where(eq(rosters.leagueId, league.id))
    .orderBy(asc(rosters.acquiredAt));

  const myRatings = await db
    .select({
      managerId: personalRatings.managerId,
      playerId: personalRatings.realPlayerId,
      score: personalRatings.score,
      sourceProfileId: personalRatings.sourceProfileId,
    })
    .from(personalRatings)
    .where(inArray(personalRatings.managerId, memberIds));

  const personalByMgrPlayer = new Map<string, (typeof myRatings)[number]>();
  for (const r of myRatings) {
    personalByMgrPlayer.set(`${r.managerId}:${r.playerId}`, r);
  }

  return (
    <div className="space-y-8">
      <div>
        <p className="text-xs uppercase tracking-widest text-muted-foreground mb-1">
          <Link href="/draft" className="hover:text-foreground transition">
            ← Draft
          </Link>
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">
          Scouting reveal
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Everyone&apos;s formulas, finally public. Compare what each manager
          weighted against the squad they actually built.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {members.map((m) => {
          const myProfiles = allProfiles.filter((p) => p.managerId === m.id);
          const myPicks = rosterRows.filter((r) => r.managerId === m.id);
          return (
            <article
              key={m.id}
              className="rounded-lg border border-border bg-card p-5 space-y-4"
            >
              <header>
                <p className="text-xs uppercase tracking-wider text-muted-foreground">
                  Manager #{m.order}
                </p>
                <h2 className="text-lg font-semibold">
                  {m.teamEmoji} {m.displayName}
                  {m.teamName && (
                    <span className="ml-2 text-sm text-muted-foreground">
                      ({m.teamName})
                    </span>
                  )}
                </h2>
              </header>

              {/* Formulas */}
              <section className="space-y-2">
                <h3 className="text-xs uppercase tracking-wider text-muted-foreground">
                  Formulas ({myProfiles.length})
                </h3>
                {myProfiles.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Didn&apos;t build any scouting formulas.
                  </p>
                ) : (
                  <div className="space-y-3">
                    {myProfiles.map((p) => {
                      const factors = factorsByProfile.get(p.id) ?? [];
                      const important = factors.filter(
                        (f) => f.importance === "important"
                      );
                      const standard = factors.filter(
                        (f) => f.importance === "standard"
                      );
                      return (
                        <div
                          key={p.id}
                          className="rounded-md border border-border bg-background p-3 space-y-2"
                        >
                          <p className="text-sm font-medium">{p.name}</p>
                          {p.description && (
                            <p className="text-xs text-muted-foreground italic">
                              {p.description}
                            </p>
                          )}
                          {important.length > 0 && (
                            <FactorChips
                              label="Important"
                              factors={important.map((f) => f.factor_id)}
                              tone="emerald"
                            />
                          )}
                          {standard.length > 0 && (
                            <FactorChips
                              label="Standard"
                              factors={standard.map((f) => f.factor_id)}
                              tone="sky"
                            />
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>

              {/* Picks */}
              <section className="space-y-2">
                <h3 className="text-xs uppercase tracking-wider text-muted-foreground">
                  Won at auction ({myPicks.length})
                </h3>
                {myPicks.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No picks yet.
                  </p>
                ) : (
                  <div className="space-y-1">
                    {myPicks.map((pk) => {
                      const personal = personalByMgrPlayer.get(
                        `${m.id}:${pk.playerId}`
                      );
                      return (
                        <div
                          key={pk.playerId}
                          className="flex items-center justify-between gap-2 text-sm"
                        >
                          <Link
                            href={`/players/${pk.playerId}`}
                            className="truncate hover:underline"
                          >
                            {pk.playerName}
                          </Link>
                          <div className="flex items-center gap-2 shrink-0 text-xs">
                            {personal && (
                              <span
                                className="text-muted-foreground"
                                title="Their formula's score"
                              >
                                rated{" "}
                                <strong className="text-foreground">
                                  {Math.round(Number(personal.score))}
                                </strong>
                              </span>
                            )}
                            <span className="rounded bg-muted px-1.5 py-0.5 tabular-nums">
                              {pk.acquiredAmount ?? "—"}cr
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            </article>
          );
        })}
      </div>
    </div>
  );
}

function EmptyState({ reason }: { reason: string }) {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Scouting recap</h1>
      <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
        {reason}
      </div>
    </div>
  );
}

function FactorChips({
  label,
  factors,
  tone,
}: {
  label: string;
  factors: FactorId[];
  tone: "emerald" | "sky";
}) {
  const bg =
    tone === "emerald"
      ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30"
      : "bg-sky-500/10 text-sky-700 dark:text-sky-400 border-sky-500/30";
  return (
    <div className="flex flex-wrap gap-1.5 items-center">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}:
      </span>
      {factors.map((f) => (
        <span
          key={f}
          className={`inline-block rounded border px-1.5 py-0.5 text-[11px] ${bg}`}
        >
          {FACTORS[f]?.label ?? f}
        </span>
      ))}
    </div>
  );
}
