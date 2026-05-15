-- Extend the ingestion_kind enum to cover derived-data recompute ops
-- (compute-prices, compute-percentiles, sim-bracket, etc.). These aren't
-- "ingestion" in the strict sense, but they share the audit-log shape
-- (started_at / finished_at / rows_changed / error) so reusing
-- ingestion_runs keeps the admin UI simple.

do $$ begin
  alter type ingestion_kind add value if not exists 'recompute';
exception when invalid_text_representation then null; end $$;
