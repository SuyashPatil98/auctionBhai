/**
 * Nightly demo-reset endpoint for LineUp Lab.
 *
 * GET /api/demo-reset → wipes visitor-mutated state (lineups, trades, FA
 * bids, matchday_scores) and re-seeds the canonical demo data.
 *
 * Disabled in private mode (auction-bhai). Disabled by default in demo
 * mode — enable by setting DEMO_RESET_TOKEN and adding the vercel.json
 * cron entry. Token-gated so the endpoint can't be DoS'd by random web
 * traffic.
 *
 * Recommended schedule: 4am UTC daily (between Tuesday window close and
 * morning traffic).
 */

import { NextResponse } from "next/server";
import { siteMode } from "@/lib/util/site-mode";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (siteMode() !== "demo") {
    return NextResponse.json(
      { ok: false, error: "Not a demo deployment" },
      { status: 403 }
    );
  }

  const expectedToken = process.env.DEMO_RESET_TOKEN;
  if (!expectedToken) {
    return NextResponse.json(
      { ok: false, error: "DEMO_RESET_TOKEN not configured" },
      { status: 503 }
    );
  }

  const authHeader = request.headers.get("authorization") ?? "";
  const url = new URL(request.url);
  const queryToken = url.searchParams.get("token") ?? "";
  const providedToken = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7)
    : queryToken;
  if (providedToken !== expectedToken) {
    return NextResponse.json({ ok: false, error: "Bad token" }, { status: 401 });
  }

  const { db } = await import("@/lib/db");
  const { sql } = await import("drizzle-orm");
  const startedAt = Date.now();

  // Wipe visitor-mutated state. Keep auth users, profiles, league,
  // rosters, fixtures and player data — those are canonical.
  await db.execute(sql`
    truncate table
      manager_lineups,
      matchday_scores,
      motm_votes,
      free_agent_bids,
      free_agent_resolutions,
      trades
    restart identity cascade
  `);

  // Re-sweep matchday 1 so the leaderboard isn't empty after wipe.
  // (The fixture stats survived truncate.)
  let sweepReport = "";
  try {
    const { sweepMatchday } = await import("@/lib/scoring/sweep");
    const r = await sweepMatchday(1);
    sweepReport = `MD1 swept · ${r.managersScored} manager rows`;
  } catch (e) {
    sweepReport = `sweep failed: ${e instanceof Error ? e.message : String(e)}`;
  }

  return NextResponse.json({
    ok: true,
    mode: siteMode(),
    durationMs: Date.now() - startedAt,
    cleared: [
      "manager_lineups",
      "matchday_scores",
      "motm_votes",
      "free_agent_bids",
      "free_agent_resolutions",
      "trades",
    ],
    sweepReport,
    note: "To restore demo lineups + the sample pending trade, run `pnpm seed:demo` against the demo DB.",
  });
}
