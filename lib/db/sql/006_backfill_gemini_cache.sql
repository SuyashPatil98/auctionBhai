-- One-shot backfill: copy the Layer 3 results from the most-recent
-- player_ratings row per player into the new gemini_research cache.
--
-- Safe to re-run; uses ON CONFLICT DO NOTHING so we don't clobber
-- post-backfill researches.

with latest as (
  select distinct on (real_player_id)
    real_player_id,
    inputs
  from player_ratings
  where (inputs->>'layer3') is not null
    and (inputs->'layer3') <> 'null'::jsonb
  order by real_player_id, as_of desc
)
insert into gemini_research (
  real_player_id, model, prompt_version, score, confidence, reasoning, researched_at
)
select
  latest.real_player_id,
  'gemini-2.5-flash-lite' as model,
  'v1' as prompt_version,
  (latest.inputs->'layer3'->>'score')::numeric as score,
  latest.inputs->'layer3'->>'confidence' as confidence,
  latest.inputs->'layer3'->>'reasoning' as reasoning,
  now() as researched_at
from latest
where (latest.inputs->'layer3'->>'score') is not null
on conflict (real_player_id) do nothing;

-- Sanity check
select
  (select count(*) from gemini_research) as cached_rows,
  (select count(distinct real_player_id) from player_ratings where inputs->>'layer3' is not null and inputs->'layer3' <> 'null'::jsonb) as source_distinct_players;
