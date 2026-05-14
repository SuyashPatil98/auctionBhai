import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import {
  countries,
  playerClubStats,
  playerPrices,
  playerRatings,
  realPlayers,
  transfermarktPlayers,
} from "@/lib/db/schema";
import { and, desc, eq, sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

type Params = Promise<{ id: string }>;

type PlayerRow = {
  id: string;
  fullName: string;
  displayName: string;
  position: "GK" | "DEF" | "MID" | "FWD";
  shirtNumber: number | null;
  dob: string | null;
  club: string | null;
  photoUrl: string | null;
  countryCode: string | null;
  countryName: string;
  flagUrl: string | null;
};

type RatingInputs = {
  bucket?: string;
  layer1?: {
    age: number | null;
    ageAdjustment: number;
    positionBaseline: number;
    score: number;
  };
  layer2?: {
    score: number | null;
    bucket?: string;
    marketValueEur: number | null;
    logValue: number | null;
    zScore: number | null;
  };
  layer3?: {
    score: number;
    confidence: "high" | "medium" | "low";
    reasoning: string;
  } | null;
  layer4?: {
    adjustment: number;
    capVolume: number | null;
    goalRate: number | null;
    goalRateZ: number | null;
    pedigreeScore: number;
  };
  match?: {
    tmPlayerId: number | null;
    tmName: string | null;
    tmSubPosition: string | null;
    quality: "high" | "medium" | "low" | "none";
    nameSimilarity: number | null;
  };
  final?: { afterPositionNormalization: number };
};

type Raw = {
  pos?: string | null;
  shooting?: {
    shots: number | null;
    shotsOnTarget: number | null;
    shotsOnTargetPct: number | null;
    shotsPer90: number | null;
    shotsOnTargetPer90: number | null;
    goalsPerShot: number | null;
    goalsPerShotOnTarget: number | null;
  };
  keeper?: {
    goalsAgainst: number | null;
    goalsAgainstPer90: number | null;
    saves: number | null;
    savePct: number | null;
    cleanSheets: number | null;
    cleanSheetPct: number | null;
    pensSaved: number | null;
  };
  misc?: {
    tacklesWon: number | null;
    interceptions: number | null;
    crosses: number | null;
    fouls: number | null;
    fouled: number | null;
    ownGoals: number | null;
  };
  playingTime?: {
    minutesPerMatch: number | null;
    minutesPct: number | null;
  };
};

export default async function PlayerDetailPage({ params }: { params: Params }) {
  const { id } = await params;

  const [player] = (await db
    .select({
      id: realPlayers.id,
      fullName: realPlayers.fullName,
      displayName: realPlayers.displayName,
      position: realPlayers.position,
      shirtNumber: realPlayers.shirtNumber,
      dob: realPlayers.dob,
      club: realPlayers.club,
      photoUrl: realPlayers.photoUrl,
      countryCode: countries.code,
      countryName: countries.name,
      flagUrl: countries.flagUrl,
    })
    .from(realPlayers)
    .innerJoin(countries, eq(realPlayers.countryId, countries.id))
    .where(eq(realPlayers.id, id))
    .limit(1)) as PlayerRow[];

  if (!player) notFound();

  const [latestRating] = await db
    .select()
    .from(playerRatings)
    .where(eq(playerRatings.realPlayerId, id))
    .orderBy(desc(playerRatings.asOf))
    .limit(1);

  // TM record (for photo, market value history, caps/goals).
  let tm: typeof transfermarktPlayers.$inferSelect | null = null;
  const inputs = latestRating?.inputs as RatingInputs | undefined;
  const tmPlayerId = inputs?.match?.tmPlayerId;
  if (tmPlayerId) {
    [tm] =
      (await db
        .select()
        .from(transfermarktPlayers)
        .where(eq(transfermarktPlayers.tmPlayerId, tmPlayerId))
        .limit(1)) ?? [];
  }

  // FBref club stats for the most recent season.
  const [club] = await db
    .select()
    .from(playerClubStats)
    .where(
      and(eq(playerClubStats.realPlayerId, id), eq(playerClubStats.source, "fbref"))
    )
    .orderBy(desc(playerClubStats.importedAt))
    .limit(1);

  // Auction price + tier.
  const [price] = await db
    .select()
    .from(playerPrices)
    .where(eq(playerPrices.realPlayerId, id))
    .limit(1);

  // Position rank within pool.
  const [rank] = (await db.execute(sql`
    with pool as (
      select
        rp.id,
        max((pr.rating)::numeric) as rating
      from real_players rp
      left join player_ratings pr on pr.real_player_id = rp.id
      where rp.position = ${player.position}
      group by rp.id
    ),
    ranked as (
      select id, rating, rank() over (order by rating desc nulls last) as rnk,
        count(*) over () as total
      from pool
    )
    select rnk::int as rank, total::int as total
    from ranked where id = ${player.id}
  `)) as unknown as Array<{ rank: number; total: number }>;

  const photo = tm?.imageUrl ?? player.photoUrl;
  const rating = latestRating ? Number(latestRating.rating) : null;
  const age = computeAge(player.dob);
  const raw = (club?.raw ?? {}) as Raw;
  const verdict = buildVerdict({ player, rating, age, tm, club, raw, inputs });

  return (
    <div className="space-y-8">
      {/* HERO */}
      <div className="relative overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-card to-muted/30 p-6">
        <div className="flex flex-col sm:flex-row items-start gap-6">
          {photo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={photo}
              alt={player.displayName}
              className="w-28 h-28 rounded-full object-cover border-2 border-border shadow-md"
            />
          ) : (
            <div className="w-28 h-28 rounded-full bg-muted flex items-center justify-center text-3xl text-muted-foreground border-2 border-border">
              {player.displayName[0]}
            </div>
          )}

          <div className="flex-1 space-y-2">
            <p className="text-xs uppercase tracking-widest text-muted-foreground">
              {player.position} · {raw?.pos ?? inputs?.match?.tmSubPosition ?? ""}
            </p>
            <h1 className="text-3xl font-bold tracking-tight">
              {player.fullName}
            </h1>
            <p className="text-sm text-muted-foreground flex flex-wrap items-center gap-2">
              {player.flagUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={player.flagUrl} alt="" className="w-4 h-4" />
              )}
              <span>{player.countryName}</span>
              <Sep />
              <span>{age !== null ? `${age} yrs` : "age unknown"}</span>
              {player.club && (
                <>
                  <Sep />
                  <span>{player.club}</span>
                </>
              )}
              {player.shirtNumber !== null && (
                <>
                  <Sep />
                  <span>#{player.shirtNumber}</span>
                </>
              )}
            </p>
          </div>

          <div className="flex flex-col sm:flex-row items-end gap-4">
            {price && (
              <div className="text-right">
                <p className="text-xs uppercase tracking-widest text-muted-foreground">
                  Auction price
                </p>
                <p className="text-5xl font-bold tabular-nums leading-none mt-1 text-emerald-700 dark:text-emerald-400">
                  {price.price}
                </p>
                <p className="mt-1 text-xs uppercase tracking-wider text-muted-foreground">
                  {price.tier}
                </p>
              </div>
            )}
            {rating !== null && (
              <div className="text-right">
                <p className="text-xs uppercase tracking-widest text-muted-foreground">
                  Rating
                </p>
                <p className="text-3xl font-semibold tabular-nums leading-none mt-1">
                  {rating.toFixed(1)}
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Position rank + pool bar */}
        {rating !== null && rank && (
          <div className="mt-6 space-y-2">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>
                <strong className="text-foreground">
                  #{rank.rank}
                </strong>{" "}
                of {rank.total} {positionLong(player.position)}
              </span>
              <span>
                top{" "}
                <strong className="text-foreground">
                  {percentile(rank.rank, rank.total)}
                </strong>
              </span>
            </div>
            <div className="h-2 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-emerald-500 to-rose-500"
                style={{ width: `${rating}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* VERDICT */}
      <section className="space-y-2">
        <h2 className="text-xs uppercase tracking-widest text-muted-foreground">
          The take
        </h2>
        <p className="text-base leading-relaxed">{verdict}</p>
        {inputs?.layer3?.reasoning && (
          <p className="text-sm text-muted-foreground italic border-l-2 border-border pl-3">
            &ldquo;{inputs.layer3.reasoning}&rdquo;
          </p>
        )}
      </section>

      {/* PRICE BREAKDOWN */}
      {price && (
        <section className="space-y-3">
          <h2 className="text-xs uppercase tracking-widest text-muted-foreground">
            What he should cost
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard
              label="Price"
              value={String(price.price)}
              sub={`${price.tier} tier`}
            />
            <StatCard
              label="Expected matches"
              value={fmt(price.expectedMatches, 2)}
              sub={
                price.expectedMatches != null && Number(price.expectedMatches) >= 5.5
                  ? "deep tournament run"
                  : Number(price.expectedMatches) <= 3.5
                  ? "group stage exit likely"
                  : "into the knockouts"
              }
            />
            <StatCard
              label="Expected points"
              value={fmt(price.expectedPoints, 1)}
              sub="from rating + matches"
            />
            <StatCard
              label="Starter chance"
              value={
                price.inputs &&
                typeof (price.inputs as { starterProb?: number })
                  .starterProb === "number"
                  ? `${Math.round(
                      (price.inputs as { starterProb: number }).starterProb *
                        100
                    )}%`
                  : "—"
              }
              sub={
                price.inputs &&
                typeof (price.inputs as { positionRankInCountry?: number })
                  .positionRankInCountry === "number"
                  ? `#${
                      (price.inputs as { positionRankInCountry: number })
                        .positionRankInCountry
                    } at ${player.position}`
                  : undefined
              }
            />
          </div>
        </section>
      )}

      {/* CLUB SEASON STATS */}
      {club ? (
        <section className="space-y-3">
          <div className="flex items-end justify-between">
            <h2 className="text-xs uppercase tracking-widest text-muted-foreground">
              {club.season} club season · {club.squad}
            </h2>
            <span className="text-xs text-muted-foreground">
              {club.competition}
            </span>
          </div>
          <ClubStatsGrid position={player.position} club={club} raw={raw} />
        </section>
      ) : (
        <section className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
          Club season stats unavailable. (Outside top-5 European leagues.)
        </section>
      )}

      {/* INTERNATIONAL */}
      <section className="space-y-3">
        <h2 className="text-xs uppercase tracking-widest text-muted-foreground">
          International record
        </h2>
        <InternationalGrid tm={tm} layer4={inputs?.layer4} />
      </section>

      {/* MARKET */}
      {tm && (
        <section className="space-y-3">
          <h2 className="text-xs uppercase tracking-widest text-muted-foreground">
            Market
          </h2>
          <MarketGrid tm={tm} />
        </section>
      )}

      {/* RATING BREAKDOWN (collapsible) */}
      <details className="group rounded-lg border border-border bg-card">
        <summary className="cursor-pointer px-4 py-3 text-sm text-muted-foreground hover:text-foreground transition select-none">
          ▸ How we calculated this rating
        </summary>
        <div className="px-4 pb-4 pt-2 space-y-2 text-sm">
          <RatingBreakdown inputs={inputs} rating={rating} />
        </div>
      </details>

      <Link
        href="/players"
        className="inline-block text-sm text-muted-foreground hover:text-foreground transition"
      >
        ← All players
      </Link>
    </div>
  );
}

// =============== helpers ===============

function Sep() {
  return <span className="text-muted-foreground/40">·</span>;
}

function positionLong(p: string) {
  return p === "GK"
    ? "goalkeepers"
    : p === "DEF"
    ? "defenders"
    : p === "MID"
    ? "midfielders"
    : "forwards";
}

function percentile(rank: number, total: number) {
  if (total === 0) return "—";
  const pct = (rank / total) * 100;
  if (pct <= 1) return "1%";
  return `${pct.toFixed(0)}%`;
}

function computeAge(dob: string | null): number | null {
  if (!dob) return null;
  const birth = new Date(dob);
  if (Number.isNaN(birth.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const before =
    now.getMonth() < birth.getMonth() ||
    (now.getMonth() === birth.getMonth() && now.getDate() < birth.getDate());
  if (before) age -= 1;
  return age;
}

function fmt(v: number | string | null | undefined, decimals = 0): string {
  if (v === null || v === undefined) return "—";
  const n = typeof v === "string" ? Number(v) : v;
  if (!Number.isFinite(n)) return "—";
  return decimals === 0 ? Math.round(n).toString() : n.toFixed(decimals);
}

function fmtEur(eur: number | null): string {
  if (eur === null || eur === undefined) return "—";
  if (eur >= 1_000_000) return `€${(eur / 1_000_000).toFixed(1)}M`;
  if (eur >= 1_000) return `€${(eur / 1_000).toFixed(0)}K`;
  return `€${eur}`;
}

// ----------- verdict (reporter style) -----------

function buildVerdict(args: {
  player: PlayerRow;
  rating: number | null;
  age: number | null;
  tm: typeof transfermarktPlayers.$inferSelect | null;
  club: typeof playerClubStats.$inferSelect | undefined;
  raw: Raw;
  inputs: RatingInputs | undefined;
}): string {
  const { player, rating, age, tm, club, raw, inputs } = args;

  const parts: string[] = [];
  const tier = tierFromRating(rating, player.position);

  // Opening line
  if (rating !== null && rating >= 85) {
    parts.push(`Elite ${positionShortFor(player.position)} at the heart of ${player.countryName}'s tournament hopes.`);
  } else if (rating !== null && rating >= 70) {
    parts.push(`A reliable starter for ${player.countryName} and one of the better ${positionLong(player.position)} in this World Cup pool.`);
  } else if (rating !== null && rating >= 55) {
    parts.push(`Squad-tier ${positionShortFor(player.position)} for ${player.countryName}, useful depth rather than a first-name-on-the-team-sheet pick.`);
  } else {
    parts.push(`Fringe option in ${player.countryName}'s squad.`);
  }

  // Club form line if data exists
  if (club) {
    const goals = club.goals ?? 0;
    const assists = club.assists ?? 0;
    const mp = club.matchesPlayed ?? 0;
    const minutes = club.minutes ?? 0;
    const ninetyEq = minutes / 90;

    if (player.position === "GK") {
      const cs = raw.keeper?.cleanSheets ?? 0;
      const savePct = raw.keeper?.savePct;
      parts.push(
        `Has ${cs} clean sheet${cs === 1 ? "" : "s"} in ${mp} appearances for ${club.squad} this ${club.season} season${
          savePct !== null && savePct !== undefined
            ? `, saving ${savePct.toFixed(1)}% of shots faced`
            : ""
        }.`
      );
    } else {
      const g90 = ninetyEq > 0 ? (goals / ninetyEq).toFixed(2) : "0.00";
      const a90 = ninetyEq > 0 ? (assists / ninetyEq).toFixed(2) : "0.00";
      parts.push(
        `${goals} ${plural(goals, "goal")} and ${assists} ${plural(assists, "assist")} in ${mp} matches for ${club.squad} this season — that's ${g90} G / 90 and ${a90} A / 90.`
      );
    }
  }

  // International line
  const caps = tm?.internationalCaps ?? 0;
  const intGoals = tm?.internationalGoals ?? 0;
  if (caps > 0) {
    if (intGoals > 0) {
      parts.push(
        `${caps} caps for ${player.countryName}, ${intGoals} goal${intGoals === 1 ? "" : "s"}${
          caps >= 10
            ? ` — ${(intGoals / caps).toFixed(2)} per game at international level`
            : ""
        }.`
      );
    } else {
      parts.push(`${caps} cap${caps === 1 ? "" : "s"} for ${player.countryName}.`);
    }
  }

  // Pedigree commentary
  if (inputs?.layer4) {
    if (inputs.layer4.adjustment >= 3) {
      parts.push(`International output is well above the typical ${player.position} — pedigree is a clear plus for tournament play.`);
    } else if (inputs.layer4.adjustment <= -3) {
      parts.push(`International record is light for a player of his profile — pedigree is a question mark heading into the WC.`);
    }
  }

  // Age context
  if (age !== null) {
    if (player.position === "GK" && age < 24) parts.push(`At ${age} he's young for a top-tier goalkeeper, where peak years arrive at 28-32.`);
    else if (player.position === "FWD" && age >= 32) parts.push(`At ${age} the pace-and-running side of the forward role is past peak.`);
  }

  void tier;
  return parts.join(" ");
}

function tierFromRating(
  rating: number | null,
  _position: string
): "elite" | "star" | "starter" | "depth" {
  if (rating === null) return "depth";
  if (rating >= 88) return "elite";
  if (rating >= 75) return "star";
  if (rating >= 60) return "starter";
  return "depth";
}

function positionShortFor(p: string) {
  return p === "GK"
    ? "goalkeeper"
    : p === "DEF"
    ? "defender"
    : p === "MID"
    ? "midfielder"
    : "forward";
}

function plural(n: number, word: string) {
  return n === 1 ? word : `${word}s`;
}

// ----------- club stats grid -----------

function ClubStatsGrid({
  position,
  club,
  raw,
}: {
  position: string;
  club: typeof playerClubStats.$inferSelect;
  raw: Raw;
}) {
  const stats: Array<{ label: string; value: string; sub?: string }> = [];

  stats.push({
    label: "Matches",
    value: fmt(club.matchesPlayed),
    sub: `${fmt(club.starts)} starts`,
  });
  stats.push({
    label: "Minutes",
    value: fmt(club.minutes),
    sub:
      raw.playingTime?.minutesPct != null
        ? `${raw.playingTime.minutesPct.toFixed(0)}% of squad`
        : undefined,
  });

  if (position === "GK") {
    stats.push({
      label: "Clean sheets",
      value: fmt(raw.keeper?.cleanSheets),
      sub:
        raw.keeper?.cleanSheetPct != null
          ? `${raw.keeper.cleanSheetPct.toFixed(0)}%`
          : undefined,
    });
    stats.push({ label: "Saves", value: fmt(raw.keeper?.saves) });
    stats.push({
      label: "Save %",
      value:
        raw.keeper?.savePct != null
          ? `${raw.keeper.savePct.toFixed(1)}%`
          : "—",
    });
    stats.push({
      label: "Goals against / 90",
      value: fmt(raw.keeper?.goalsAgainstPer90, 2),
      sub: `${fmt(raw.keeper?.goalsAgainst)} total`,
    });
    stats.push({
      label: "Penalty saves",
      value: fmt(raw.keeper?.pensSaved),
    });
  } else {
    stats.push({
      label: "Goals",
      value: fmt(club.goals),
      sub:
        club.goalsPer90 !== null && club.goalsPer90 !== undefined
          ? `${fmt(club.goalsPer90, 2)} / 90`
          : undefined,
    });
    stats.push({
      label: "Assists",
      value: fmt(club.assists),
      sub:
        club.assistsPer90 !== null && club.assistsPer90 !== undefined
          ? `${fmt(club.assistsPer90, 2)} / 90`
          : undefined,
    });
    stats.push({
      label: "Shots",
      value: fmt(raw.shooting?.shots),
      sub:
        raw.shooting?.shotsPer90 != null
          ? `${raw.shooting.shotsPer90.toFixed(2)} / 90`
          : undefined,
    });
    if (position === "DEF" || position === "MID") {
      stats.push({
        label: "Tackles won",
        value: fmt(raw.misc?.tacklesWon),
      });
      stats.push({
        label: "Interceptions",
        value: fmt(raw.misc?.interceptions),
      });
    }
  }

  stats.push({
    label: "Cards",
    value: `${club.yellowCards ?? 0}Y · ${club.redCards ?? 0}R`,
  });

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
      {stats.map((s) => (
        <StatCard key={s.label} {...s} />
      ))}
    </div>
  );
}

function StatCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
      {sub && (
        <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>
      )}
    </div>
  );
}

// ----------- international grid -----------

function InternationalGrid({
  tm,
  layer4,
}: {
  tm: typeof transfermarktPlayers.$inferSelect | null;
  layer4: RatingInputs["layer4"];
}) {
  if (!tm) {
    return (
      <p className="text-sm text-muted-foreground">
        International record not available.
      </p>
    );
  }
  const caps = tm.internationalCaps ?? 0;
  const goals = tm.internationalGoals ?? 0;
  const goalRate = caps > 0 ? goals / caps : 0;

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
      <StatCard label="Caps" value={fmt(caps)} />
      <StatCard
        label="Goals"
        value={fmt(goals)}
        sub={caps > 0 ? `${goalRate.toFixed(2)} / game` : undefined}
      />
      {layer4 && layer4.pedigreeScore != null && (
        <StatCard
          label="Pedigree"
          value={layer4.pedigreeScore.toFixed(0)}
          sub={
            layer4.adjustment >= 0
              ? `+${layer4.adjustment.toFixed(1)} to rating`
              : `${layer4.adjustment.toFixed(1)} to rating`
          }
        />
      )}
    </div>
  );
}

// ----------- market grid -----------

function MarketGrid({
  tm,
}: {
  tm: typeof transfermarktPlayers.$inferSelect;
}) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
      <StatCard label="Current value" value={fmtEur(tm.marketValueEur)} />
      <StatCard
        label="Career high"
        value={fmtEur(tm.highestMarketValueEur)}
        sub={
          tm.marketValueEur && tm.highestMarketValueEur
            ? `${((tm.marketValueEur / tm.highestMarketValueEur) * 100).toFixed(0)}% of peak`
            : undefined
        }
      />
      {tm.subPosition && (
        <StatCard label="Role" value={tm.subPosition} />
      )}
      {tm.currentClubName && (
        <StatCard label="Club" value={tm.currentClubName} />
      )}
    </div>
  );
}

// ----------- breakdown -----------

function RatingBreakdown({
  inputs,
  rating,
}: {
  inputs: RatingInputs | undefined;
  rating: number | null;
}) {
  if (!inputs) return <p className="text-muted-foreground">No breakdown.</p>;
  return (
    <>
      {inputs.layer1 && (
        <Line
          label="Age + position baseline"
          value={inputs.layer1.score.toFixed(1)}
          detail={`baseline ${inputs.layer1.positionBaseline} ${
            inputs.layer1.ageAdjustment >= 0 ? "+" : ""
          }${inputs.layer1.ageAdjustment} (age ${inputs.layer1.age ?? "?"})`}
        />
      )}
      {inputs.layer2 && (
        <Line
          label="Market value"
          value={
            inputs.layer2.score !== null
              ? inputs.layer2.score.toFixed(1)
              : "—"
          }
          detail={
            inputs.layer2.marketValueEur
              ? `${fmtEur(inputs.layer2.marketValueEur)} · ${
                  inputs.layer2.bucket ?? inputs.bucket ?? ""
                } pool · z=${inputs.layer2.zScore?.toFixed(2) ?? "?"}`
              : "no Transfermarkt match"
          }
        />
      )}
      {inputs.layer3 && (
        <Line
          label="AI research"
          value={inputs.layer3.score.toFixed(1)}
          detail={`${inputs.layer3.confidence} confidence`}
        />
      )}
      {inputs.layer4 && (
        <Line
          label="International pedigree"
          value={inputs.layer4.pedigreeScore.toFixed(1)}
          detail={`${
            inputs.layer4.adjustment >= 0 ? "+" : ""
          }${inputs.layer4.adjustment.toFixed(1)} adjustment`}
        />
      )}
      {inputs.match && (
        <Line
          label="Transfermarkt match"
          value={inputs.match.quality}
          detail={
            inputs.match.tmName
              ? `${inputs.match.tmName} · sim=${
                  inputs.match.nameSimilarity?.toFixed(2) ?? "?"
                }`
              : "—"
          }
        />
      )}
      {rating !== null && (
        <Line label="Final rating" value={rating.toFixed(1)} bold />
      )}
    </>
  );
}

function Line({
  label,
  value,
  detail,
  bold,
}: {
  label: string;
  value: string;
  detail?: string;
  bold?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-1">
      <div>
        <p className={bold ? "font-medium" : ""}>{label}</p>
        {detail && (
          <p className="text-xs text-muted-foreground">{detail}</p>
        )}
      </div>
      <p
        className={`tabular-nums ${
          bold ? "text-lg font-semibold" : "text-foreground"
        }`}
      >
        {value}
      </p>
    </div>
  );
}
