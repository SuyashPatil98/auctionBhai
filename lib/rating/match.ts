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
  tmPlayerId: number | null;
  tmName: string | null;
  tmDob: string | null;
  marketValueEur: number | null;
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
  await db.execute(sql`set local pg_trgm.similarity_threshold = 0.4`);

  const rows = (await db.execute(sql`
    select
      rp.id                       as real_player_id,
      rp.full_name                as real_player_name,
      rp.position                 as position,
      rp.dob                      as dob,
      tm.tm_player_id             as tm_player_id,
      tm.name                     as tm_name,
      tm.date_of_birth            as tm_dob,
      tm.market_value_eur         as market_value_eur,
      tm.name_sim                 as name_similarity
    from real_players rp
    left join lateral (
      select
        tmp.tm_player_id,
        tmp.name,
        tmp.date_of_birth,
        tmp.market_value_eur,
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
    tm_player_id: number | null;
    tm_name: string | null;
    tm_dob: string | null;
    market_value_eur: number | string | null;
    name_similarity: number | string | null;
  }>;

  return rows.map((r) => {
    const sim =
      r.name_similarity === null || r.name_similarity === undefined
        ? null
        : Number(r.name_similarity);
    const mv =
      r.market_value_eur === null || r.market_value_eur === undefined
        ? null
        : Number(r.market_value_eur);
    return {
      realPlayerId: r.real_player_id,
      realPlayerName: r.real_player_name,
      position: r.position,
      dob: r.dob,
      tmPlayerId: r.tm_player_id,
      tmName: r.tm_name,
      tmDob: r.tm_dob,
      marketValueEur: mv,
      nameSimilarity: sim,
      matchQuality: classifyQuality(sim, r.dob, r.tm_dob),
    };
  });
}
