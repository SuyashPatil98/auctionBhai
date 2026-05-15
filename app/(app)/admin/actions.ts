"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { withIngestionRun } from "@/lib/ingest/run";
import {
  ingestFixtures,
  ingestTournament,
} from "@/lib/ingest/football-data";
import { runComputePercentiles } from "@/lib/ops/compute-percentiles";
import { runComputePrices } from "@/lib/ops/compute-prices";
import { runSimulateBracket } from "@/lib/ops/simulate-bracket";

async function requireAuthed(): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
}

// ============================================================================
// One-button refresh
//
// Chains every fast op in dependency order:
//   1. Tournament ingest        (1 API call, ~1s)
//   2. Fixtures ingest          (1 API call, ~2s)
//   3. Bracket Monte Carlo      (10k sims, ~1s)
//   4. Recompute prices         (~3s)
//   5. Recompute percentiles    (~5s)
//
// Total: ~12s. Within Vercel hobby's 10s/60s timeouts (hobby is 10s
// max, paid is 60s — squeaks under on paid, may time out on hobby for
// a slow DB roundtrip).
//
// NOT done here (would time out):
//   - Countries + squads ingest (5 min, rate-limited)
//   - Full compute:ratings (30s+ with engine layers)
//   - Transfermarkt / FBref / WC pedigree ingest (CSV-based, local-only)
// Those stay CLI — see CLAUDE.md.
//
// Returns structured result so the client can show "47 new rows" etc.
// ============================================================================

export type StepResult = {
  name: string;
  ok: boolean;
  rowsChanged: number | null;
  notes: string | null;
  durationMs: number;
  error?: string;
};

export type RefreshResult = {
  steps: StepResult[];
  totalMs: number;
  totalRowsChanged: number;
};

async function timed<T extends { rowsChanged: number; notes?: string }>(
  name: string,
  fn: () => Promise<T>
): Promise<StepResult> {
  const t0 = Date.now();
  try {
    const r = await fn();
    return {
      name,
      ok: true,
      rowsChanged: r.rowsChanged,
      notes: r.notes ?? null,
      durationMs: Date.now() - t0,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[admin:refresh:${name}]`, err);
    return {
      name,
      ok: false,
      rowsChanged: null,
      notes: null,
      durationMs: Date.now() - t0,
      error: msg,
    };
  }
}

export async function refreshAll(): Promise<RefreshResult> {
  await requireAuthed();
  const t0 = Date.now();

  const steps: StepResult[] = [];

  // ingestTournament/ingestFixtures wrap themselves in withIngestionRun.
  steps.push(await timed("Tournament metadata", () => ingestTournament()));
  steps.push(await timed("Fixtures", () => ingestFixtures()));

  steps.push(
    await timed("Bracket simulation", () =>
      withIngestionRun("sim:bracket", "recompute", async () => {
        const r = await runSimulateBracket();
        const champ = r.top10[0];
        return {
          rowsChanged: r.teamsCount,
          notes: champ
            ? `${r.sims} sims · favorite: ${champ.name} (${champ.championPct.toFixed(1)}% champ)`
            : `${r.sims} sims`,
        };
      })
    )
  );

  steps.push(
    await timed("Player prices", () =>
      withIngestionRun("compute:prices", "recompute", async () => {
        const r = await runComputePrices();
        return {
          rowsChanged: r.rowsWritten,
          notes: r.topByPrice[0]
            ? `top: ${r.topByPrice[0].displayName} ${r.topByPrice[0].price}cr`
            : `${r.eligible} eligible`,
        };
      })
    )
  );

  steps.push(
    await timed("Factor percentiles", () =>
      withIngestionRun("compute:percentiles", "recompute", async () => {
        const r = await runComputePercentiles();
        return {
          rowsChanged: r.rowsWritten,
          notes: `${r.playersProcessed} players × ${r.factorsComputed} factors`,
        };
      })
    )
  );

  revalidatePath("/admin");
  revalidatePath("/players");
  revalidatePath("/team");
  revalidatePath("/dashboard");

  return {
    steps,
    totalMs: Date.now() - t0,
    totalRowsChanged: steps.reduce(
      (a, s) => a + (s.rowsChanged ?? 0),
      0
    ),
  };
}
