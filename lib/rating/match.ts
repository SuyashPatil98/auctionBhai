/**
 * Fuzzy-matches `real_players` (our WC squad) against `transfermarkt_players`
 * (the imported staging table). Single SQL query with a LATERAL trigram join
 * — fast even at 1213 × 47k.
 */

import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import type { DbPosition } from "@/lib/ingest/mappers";
import type { MatchQuality } from "./blend";

export type PlayerMatchRow = {
  realPlayerId: string;
  realPlayerName: string;
  position: DbPosition;
  dob: string | null;
  club: string | null;
  countryName: string | null;
  tmPlayerId: number | null;
  tmName: string | null;
  tmDob: string | null;
  tmSubPosition: string | null;
  marketValueEur: number | null;
  highestMarketValueEur: number | null;
  internationalCaps: number | null;
  internationalGoals: number | null;
  nameSimilarity: number | null;
  matchQuality: MatchQuality;
};

function classifyQuality(
  nameSim: number | null,
  rpDob: string | null,
  tmDob: string | null
): MatchQuality {
  if (nameSim === null) return "none";
  const dobMatch = rpDob !== null && tmDob !== null && rpDob === tmDob;
  if (dobMatch && nameSim >= 0.7) return "high";
  if (nameSim >= 0.95) return "high"; // near-exact name w/o DOB confirmation
  if (nameSim >= 0.7) return "medium";
  if (nameSim >= 0.5) return "low";
  return "none";
}

/**
 * For every real_player, find the single best Transfermarkt candidate.
 *
 * Uses the pg_trgm `%` operator (which can leverage the GIN trigram index
 * on lower(name)) to prefilter candidates, then ranks the survivors by
 * similarity() + DOB match.
 *
 * Without the `%` operator the query falls back to a sequential scan over
 * 47k rows × 1213 real_players = 57M similarity() calls, which blows past
 * Supabase's 60s statement timeout.
 */
export async function findBestMatches(): Promise<PlayerMatchRow[]> {
  // Lower the trigram threshold so the `%` operator includes weaker name
  // matches; classifyQuality() narrows them down afterwards.
  // (SET, not SET LOCAL — postgres-js doesn't wrap the script in a tx.)
  await db.execute(sql`set pg_trgm.similarity_threshold = 0.4`);

  const rows = (await db.execute(sql`
    select
      rp.id                            as real_player_id,
      rp.full_name                     as real_player_name,
      rp.position                      as position,
      rp.dob                           as dob,
      rp.club                          as club,
      c.name                           as country_name,
      tm.tm_player_id                  as tm_player_id,
      tm.name                          as tm_name,
      tm.date_of_birth                 as tm_dob,
      tm.sub_position                  as tm_sub_position,
      tm.market_value_eur              as market_value_eur,
      tm.highest_market_value_eur      as highest_market_value_eur,
      tm.international_caps            as international_caps,
      tm.international_goals           as international_goals,
      tm.name_sim                      as name_similarity
    from real_players rp
    join countries c on c.id = rp.country_id
    left join lateral (
      select
        tmp.tm_player_id,
        tmp.name,
        tmp.date_of_birth,
        tmp.sub_position,
        tmp.market_value_eur,
        tmp.highest_market_value_eur,
        tmp.international_caps,
        tmp.international_goals,
        similarity(lower(tmp.name), lower(rp.full_name)) as name_sim
      from transfermarkt_players tmp
      where lower(tmp.name) % lower(rp.full_name)
      order by
        (case when tmp.date_of_birth = rp.dob then 0 else 1 end),
        similarity(lower(tmp.name), lower(rp.full_name)) desc
      limit 1
    ) tm on true
  `)) as unknown as Array<{
    real_player_id: string;
    real_player_name: string;
    position: DbPosition;
    dob: string | null;
    club: string | null;
    country_name: string | null;
    tm_player_id: number | null;
    tm_name: string | null;
    tm_dob: string | null;
    tm_sub_position: string | null;
    market_value_eur: number | string | null;
    highest_market_value_eur: number | string | null;
    international_caps: number | string | null;
    international_goals: number | string | null;
    name_similarity: number | string | null;
  }>;

  const toNum = (v: number | string | null | undefined): number | null =>
    v === null || v === undefined ? null : Number(v);

  return rows.map((r) => {
    const sim = toNum(r.name_similarity);
    return {
      realPlayerId: r.real_player_id,
      realPlayerName: r.real_player_name,
      position: r.position,
      dob: r.dob,
      club: r.club,
      countryName: r.country_name,
      tmPlayerId: r.tm_player_id,
      tmName: r.tm_name,
      tmDob: r.tm_dob,
      tmSubPosition: r.tm_sub_position,
      marketValueEur: toNum(r.market_value_eur),
      highestMarketValueEur: toNum(r.highest_market_value_eur),
      internationalCaps: toNum(r.international_caps),
      internationalGoals: toNum(r.international_goals),
      nameSimilarity: sim,
      matchQuality: classifyQuality(sim, r.dob, r.tm_dob),
    };
  });
}
