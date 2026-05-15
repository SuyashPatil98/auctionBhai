/**
 * Compute per-factor per-player percentile ranks within position buckets.
 * Populates `player_factor_percentiles`, which Phase 4's personal-rating
 * compute engine reads.
 *
 * Strategy:
 *   1. One mega-query fetches every player with all upstream factor values
 *      (FBref season stats via lateral join, TM via fuzzy lateral, WC
 *      pedigree, latest empirical rating).
 *   2. Bucket each player via lib/rating/buckets (sub-position aware).
 *   3. For each (factor, bucket): sort by raw value, assign percentile = rank
 *      / (n-1). NULL values get has_data=false + percentile=0.5 (neutral
 *      placeholder — the compute engine drops missing factors entirely, so
 *      the percentile value is unused there, but keeping the row makes the
 *      UI "N/16 factors" coverage display trivial).
 *   4. Truncate + bulk re-insert into player_factor_percentiles.
 *
 * Idempotent; safe to re-run any time upstream data refreshes.
 *
 * Usage: pnpm compute:percentiles
 */

import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env" });

import postgres from "postgres";
import { bucketFromSubPosition, type Bucket } from "../lib/rating/buckets";
import { FACTORS, type FactorId } from "../lib/personal-rating/factors";
import type { DbPosition } from "../lib/ingest/mappers";

type PlayerRow = {
  id: string;
  full_name: string;
  position: DbPosition;
  dob: string | null;
  sub_position: string | null;
  market_value_eur: number | null;
  international_caps: number | null;
  international_goals: number | null;
  season_goals: number | null;
  season_assists: number | null;
  goals_per_90: string | null;
  assists_per_90: string | null;
  xg_per_90: string | null;
  xag_per_90: string | null;
  minutes_played: number | null;
  wc_goals: number | null;
  wc_assists: number | null;
  wc_appearances: number | null;
  wc_tournaments: number | null;
  empirical_rating: string | null;
};

function yearsBetween(dob: string | null, refDate: Date): number | null {
  if (!dob) return null;
  const birth = new Date(dob);
  const ms = refDate.getTime() - birth.getTime();
  if (!Number.isFinite(ms)) return null;
  return ms / (365.25 * 24 * 60 * 60 * 1000);
}

function num(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Returns the raw factor value for a player. The compute step will negate
 * for "lower_better" factors before sorting.
 */
function extract(row: PlayerRow, factor: FactorId, age: number | null): number | null {
  switch (factor) {
    case "season_goals":
      return num(row.season_goals);
    case "season_assists":
      return num(row.season_assists);
    case "goals_per_90":
      return num(row.goals_per_90);
    case "assists_per_90":
      return num(row.assists_per_90);
    case "xg_per_90":
      return num(row.xg_per_90);
    case "xag_per_90":
      return num(row.xag_per_90);
    case "minutes_played":
      return num(row.minutes_played);
    case "age":
      return age;
    case "market_value_eur":
      return num(row.market_value_eur);
    case "international_caps":
      return num(row.international_caps);
    case "goals_per_cap": {
      const caps = num(row.international_caps);
      const goals = num(row.international_goals);
      if (caps === null || goals === null || caps < 5) return null; // tiny denominators are noise
      return goals / caps;
    }
    case "wc_goals":
      return num(row.wc_goals);
    case "wc_assists":
      return num(row.wc_assists);
    case "wc_appearances":
      return num(row.wc_appearances);
    case "wc_tournaments":
      return num(row.wc_tournaments);
    case "empirical_rating":
      return num(row.empirical_rating);
  }
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not set");
  const sql = postgres(url, { prepare: false, max: 4 });

  try {
    // Trigram threshold for TM matching (matches the rating engine).
    await sql`set pg_trgm.similarity_threshold = 0.4`;

    console.log("Fetching player data…");
    const players = (await sql`
      select
        rp.id::text as id,
        rp.full_name,
        rp.position,
        rp.dob::text as dob,
        tm.sub_position,
        tm.market_value_eur,
        tm.international_caps,
        tm.international_goals,
        pcs.goals as season_goals,
        pcs.assists as season_assists,
        pcs.goals_per_90,
        pcs.assists_per_90,
        pcs.xg_per_90,
        pcs.xag_per_90,
        pcs.minutes as minutes_played,
        wp.wc_goals,
        wp.wc_assists,
        wp.wc_appearances,
        wp.wc_tournaments,
        pr.rating as empirical_rating
      from real_players rp
      left join lateral (
        select tmp.sub_position, tmp.market_value_eur,
               tmp.international_caps, tmp.international_goals
        from transfermarkt_players tmp
        where lower(tmp.name) % lower(rp.full_name)
        order by similarity(lower(tmp.name), lower(rp.full_name)) desc
        limit 1
      ) tm on true
      left join lateral (
        select pcs2.goals, pcs2.assists, pcs2.goals_per_90, pcs2.assists_per_90,
               pcs2.xg_per_90, pcs2.xag_per_90, pcs2.minutes
        from player_club_stats pcs2
        where pcs2.real_player_id = rp.id
        order by pcs2.season desc, pcs2.minutes desc nulls last
        limit 1
      ) pcs on true
      left join wc_pedigree wp on wp.real_player_id = rp.id
      left join lateral (
        select pr2.rating
        from player_ratings pr2
        where pr2.real_player_id = rp.id
        order by pr2.as_of desc
        limit 1
      ) pr on true
      where rp.is_active = true
    `) as unknown as PlayerRow[];

    console.log(`  ${players.length} active players`);

    const refDate = new Date();
    const enriched = players.map((p) => ({
      row: p,
      bucket: bucketFromSubPosition(p.sub_position, p.position) as Bucket,
      age: yearsBetween(p.dob, refDate),
    }));

    // For each factor: group by bucket, sort, compute percentile.
    const allRows: Array<{
      real_player_id: string;
      factor_id: FactorId;
      position_bucket: string;
      percentile: number;
      has_data: boolean;
    }> = [];

    for (const factor of Object.values(FACTORS)) {
      // Group players by bucket
      const byBucket = new Map<Bucket, typeof enriched>();
      for (const p of enriched) {
        const arr = byBucket.get(p.bucket) ?? [];
        arr.push(p);
        byBucket.set(p.bucket, arr);
      }

      for (const [bucket, group] of byBucket) {
        const withValue: Array<{ id: string; value: number }> = [];
        const withoutValue: string[] = [];
        for (const p of group) {
          const raw = extract(p.row, factor.id, p.age);
          if (raw === null) {
            withoutValue.push(p.row.id);
          } else {
            // Invert direction for "lower_better" so the sort still puts
            // "best" at the high end.
            const v = factor.direction === "lower_better" ? -raw : raw;
            withValue.push({ id: p.row.id, value: v });
          }
        }
        withValue.sort((a, b) => a.value - b.value);

        const n = withValue.length;
        for (let i = 0; i < n; i++) {
          const percentile = n === 1 ? 0.5 : i / (n - 1);
          allRows.push({
            real_player_id: withValue[i].id,
            factor_id: factor.id,
            position_bucket: bucket,
            percentile,
            has_data: true,
          });
        }
        for (const id of withoutValue) {
          allRows.push({
            real_player_id: id,
            factor_id: factor.id,
            position_bucket: bucket,
            percentile: 0.5,
            has_data: false,
          });
        }
      }
    }

    console.log(`Computed ${allRows.length} percentile rows`);
    console.log("Truncating + inserting…");

    await sql`truncate table player_factor_percentiles`;

    const CHUNK = 1000;
    for (let i = 0; i < allRows.length; i += CHUNK) {
      const chunk = allRows.slice(i, i + CHUNK);
      const valueGroups = chunk
        .map(
          (_, ri) =>
            `($${ri * 5 + 1}, $${ri * 5 + 2}::rating_factor, $${ri * 5 + 3}, $${ri * 5 + 4}, $${ri * 5 + 5})`
        )
        .join(", ");
      const params = chunk.flatMap((r) => [
        r.real_player_id,
        r.factor_id,
        r.position_bucket,
        r.percentile.toFixed(4),
        r.has_data,
      ]);
      await sql.unsafe(
        `insert into player_factor_percentiles
           (real_player_id, factor_id, position_bucket, percentile, has_data)
         values ${valueGroups}`,
        params as never[]
      );
      process.stdout.write(`\r  inserted ${Math.min(i + CHUNK, allRows.length)}/${allRows.length}`);
    }
    console.log("\nDone.");
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
