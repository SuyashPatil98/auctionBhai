"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { withIngestionRun } from "@/lib/ingest/run";
import { runComputePercentiles } from "@/lib/ops/compute-percentiles";
import { runComputePrices } from "@/lib/ops/compute-prices";
import { runSimulateBracket } from "@/lib/ops/simulate-bracket";

// ============================================================================
// Auth gate — only allowlisted emails can hit /admin actions. (We use the
// same gate as the rest of the app; the league has 4 friends, anyone in the
// league can recompute.)
// ============================================================================

async function requireAuthed(): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
}

// ============================================================================
// Recompute actions
//
// All three are "fast" (<10s under normal conditions), so they fit inside
// Vercel's serverless timeout. Each is wrapped in withIngestionRun so the
// /admin recent-runs feed shows the result + duration + any error.
// ============================================================================

export async function refreshPercentiles() {
  await requireAuthed();
  try {
    await withIngestionRun("compute:percentiles", "recompute", async () => {
      const r = await runComputePercentiles();
      return {
        rowsChanged: r.rowsWritten,
        notes: `${r.playersProcessed} players × ${r.factorsComputed} factors`,
      };
    });
  } catch (err) {
    console.error("[admin:refreshPercentiles]", err);
    // Error is also persisted to ingestion_runs.
  }
  revalidatePath("/admin");
  revalidatePath("/players");
}

export async function refreshPrices() {
  await requireAuthed();
  try {
    await withIngestionRun("compute:prices", "recompute", async () => {
      const r = await runComputePrices();
      return {
        rowsChanged: r.rowsWritten,
        notes: `${r.eligible} eligible · top: ${r.topByPrice[0]?.displayName} ${r.topByPrice[0]?.price}cr`,
      };
    });
  } catch (err) {
    console.error("[admin:refreshPrices]", err);
  }
  revalidatePath("/admin");
  revalidatePath("/players");
}

export async function refreshBracket() {
  await requireAuthed();
  try {
    await withIngestionRun("sim:bracket", "recompute", async () => {
      const r = await runSimulateBracket();
      const champ = r.top10[0];
      return {
        rowsChanged: r.teamsCount,
        notes: `${r.sims} sims · favorite: ${champ?.name} (${champ?.championPct.toFixed(1)}% champ)`,
      };
    });
  } catch (err) {
    console.error("[admin:refreshBracket]", err);
  }
  revalidatePath("/admin");
  revalidatePath("/players");
}

/**
 * Convenience: chain the derived-data recomputes in correct dependency
 * order. Bracket writes country.expected_matches; prices reads them; both
 * affect what's relevant for percentiles. Roughly 8-12s under load — within
 * the serverless timeout but at the upper end.
 */
export async function refreshDerivedAll() {
  await requireAuthed();
  try {
    await withIngestionRun("sim:bracket", "recompute", async () => {
      const r = await runSimulateBracket();
      const champ = r.top10[0];
      return {
        rowsChanged: r.teamsCount,
        notes: `${r.sims} sims · favorite: ${champ?.name} (${champ?.championPct.toFixed(1)}% champ)`,
      };
    });
  } catch (err) {
    console.error("[admin:refreshDerivedAll:bracket]", err);
  }
  try {
    await withIngestionRun("compute:prices", "recompute", async () => {
      const r = await runComputePrices();
      return {
        rowsChanged: r.rowsWritten,
        notes: `${r.eligible} eligible · top: ${r.topByPrice[0]?.displayName} ${r.topByPrice[0]?.price}cr`,
      };
    });
  } catch (err) {
    console.error("[admin:refreshDerivedAll:prices]", err);
  }
  try {
    await withIngestionRun("compute:percentiles", "recompute", async () => {
      const r = await runComputePercentiles();
      return {
        rowsChanged: r.rowsWritten,
        notes: `${r.playersProcessed} players × ${r.factorsComputed} factors`,
      };
    });
  } catch (err) {
    console.error("[admin:refreshDerivedAll:percentiles]", err);
  }
  revalidatePath("/admin");
  revalidatePath("/players");
}
