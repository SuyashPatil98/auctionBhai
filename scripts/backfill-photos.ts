/**
 * One-shot backfill: copy transfermarkt_players.image_url onto
 * real_players.photo_url where photo_url is currently NULL, using the
 * same pg_trgm fuzzy match the rating engine uses.
 *
 * football-data.org doesn't reliably populate player photos, so most
 * real_players.photo_url cells are NULL. Transfermarkt has them via
 * the dcaribou snapshot we've already imported.
 *
 * Safe to re-run: only touches rows where photo_url IS NULL.
 *
 * Usage: pnpm backfill:photos
 */

import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env" });

import postgres from "postgres";

const MIN_SIMILARITY = 0.5;

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not set");
  const sql = postgres(url, { prepare: false, max: 1 });

  try {
    await sql.unsafe(
      `set pg_trgm.similarity_threshold = ${MIN_SIMILARITY}`
    );

    const [before] = await sql`
      select count(*)::int as n from real_players where photo_url is null
    `;
    console.log(`Players without photo: ${before.n}`);

    const updated = await sql`
      with matches as (
        select
          rp.id as real_player_id,
          tmp.image_url,
          similarity(lower(tmp.name), lower(rp.full_name)) as sim,
          row_number() over (
            partition by rp.id
            order by similarity(lower(tmp.name), lower(rp.full_name)) desc
          ) as rnk
        from real_players rp
        join transfermarkt_players tmp
          on lower(tmp.name) % lower(rp.full_name)
        where rp.photo_url is null
          and tmp.image_url is not null
      ),
      best as (
        select real_player_id, image_url, sim
        from matches
        where rnk = 1 and sim >= ${MIN_SIMILARITY}
      )
      update real_players rp
      set photo_url = best.image_url
      from best
      where rp.id = best.real_player_id
      returning rp.id
    `;
    console.log(`Backfilled ${updated.count} photos`);

    const [after] = await sql`
      select count(*)::int as n from real_players where photo_url is null
    `;
    console.log(`Players still without photo: ${after.n}`);

    // Quick sanity sample — show a few that got backfilled
    const sample = await sql`
      select rp.full_name, rp.photo_url, c.name as country
      from real_players rp
      join countries c on c.id = rp.country_id
      where rp.photo_url is not null
      order by random()
      limit 5
    `;
    console.log("\nSample of backfilled players:");
    for (const r of sample) {
      console.log(`  ${r.full_name.padEnd(28)} ${r.country.padEnd(18)} ${r.photo_url}`);
    }
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
