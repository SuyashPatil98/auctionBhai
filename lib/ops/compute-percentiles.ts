/**
 * Recomputes player_factor_percentiles from scratch.
 *
 * Library-callable (used by /admin server actions) AND the basis for
 * `pnpm compute:percentiles`. Returns a structured result rather than
 * printing — the CLI wrapper prints; the server action persists to
 * ingestion_runs.
 *
 * See lib/personal-rating/factors.ts for the factor registry.
 */

import postgres from "postgres";
import { bucketFromSubPosition, type Bucket } from "@/lib/rating/buckets";
import { FACTORS, type FactorId } from "@/lib/personal-rating/factors";
import type { DbPosition } from "@/lib/ingest/mappers";

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
  nineties: number | null;
  tackles: number | null;
  tackles_won: number | null;
  interceptions: number | null;
  blocks: number | null;
  clearances: number | null;
  recoveries: number | null;
  key_passes: number | null;
  progressive_passes: number | null;
  progressive_carries: number | null;
  pass_completion_pct: string | null;
  expected_assists: string | null;
  touches: number | null;
  saves: number | null;
  save_pct: string | null;
  clean_sheets: number | null;
  clean_sheet_pct: string | null;
  goals_against: number | null;
  wc_goals: number | null;
  wc_assists: number | null;
  wc_appearances: number | null;
  wc_tournaments: number | null;
  empirical_rating: string | null;
};

export type ComputePercentilesResult = {
  playersProcessed: number;
  factorsComputed: number;
  rowsWritten: number;
  durationMs: number;
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
 * Per-90 calculation guarded by minimum sample size — players with < 4
 * full 90s of action get NULL because per-90 stats from tiny samples are
 * noise rather than signal.
 */
function perNinety(total: number | null, nineties: number | null): number | null {
  if (total === null || nineties === null || nineties < 4) return null;
  return total / nineties;
}

function extract(row: PlayerRow, factor: FactorId, age: number | null): number | null {
  const n90 = num(row.nineties);
  switch (factor) {
    case "season_goals": return num(row.season_goals);
    case "season_assists": return num(row.season_assists);
    case "goals_per_90": return num(row.goals_per_90);
    case "assists_per_90": return num(row.assists_per_90);
    case "minutes_played": return num(row.minutes_played);
    // Defensive
    case "tackles_won_per_90": return perNinety(num(row.tackles_won), n90);
    case "interceptions_per_90": return perNinety(num(row.interceptions), n90);
    // Goalkeeping
    case "saves_per_90": return perNinety(num(row.saves), n90);
    case "save_pct": return num(row.save_pct);
    case "clean_sheets": return num(row.clean_sheets);
    case "clean_sheet_pct": return num(row.clean_sheet_pct);
    case "goals_conceded_per_90":
      return perNinety(num(row.goals_against), n90);
    case "age": return age;
    case "market_value_eur": return num(row.market_value_eur);
    case "international_caps": return num(row.international_caps);
    case "goals_per_cap": {
      const caps = num(row.international_caps);
      const goals = num(row.international_goals);
      if (caps === null || goals === null || caps < 5) return null;
      return goals / caps;
    }
    case "wc_goals": return num(row.wc_goals);
    case "wc_assists": return num(row.wc_assists);
    case "wc_appearances": return num(row.wc_appearances);
    case "wc_tournaments": return num(row.wc_tournaments);
    case "empirical_rating": return num(row.empirical_rating);
  }
}

export async function runComputePercentiles(): Promise<ComputePercentilesResult> {
  const t0 = Date.now();
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not set");
  const sql = postgres(url, { prepare: false, max: 4 });

  try {
    await sql`set pg_trgm.similarity_threshold = 0.4`;

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
        -- Convert minutes to "90s" played for per-90 calculations.
        (pcs.minutes::numeric / 90.0) as nineties,
        pcs.tackles,
        pcs.tackles_won,
        pcs.interceptions,
        pcs.blocks,
        pcs.clearances,
        pcs.recoveries,
        pcs.key_passes,
        pcs.progressive_passes,
        pcs.progressive_carries,
        pcs.pass_completion_pct,
        pcs.expected_assists,
        pcs.touches,
        pcs.saves,
        pcs.save_pct,
        pcs.clean_sheets,
        pcs.clean_sheet_pct,
        pcs.goals_against,
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
        select pcs2.*
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

    const refDate = new Date();
    const enriched = players.map((p) => ({
      row: p,
      bucket: bucketFromSubPosition(p.sub_position, p.position) as Bucket,
      age: yearsBetween(p.dob, refDate),
    }));

    const allRows: Array<{
      real_player_id: string;
      factor_id: FactorId;
      position_bucket: string;
      percentile: number;
      has_data: boolean;
    }> = [];

    const allFactors = Object.values(FACTORS);
    for (const factor of allFactors) {
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
    }

    return {
      playersProcessed: players.length,
      factorsComputed: allFactors.length,
      rowsWritten: allRows.length,
      durationMs: Date.now() - t0,
    };
  } finally {
    await sql.end();
  }
}
