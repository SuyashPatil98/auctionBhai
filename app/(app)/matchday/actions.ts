"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { fixtures } from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/server";
import { requireLeagueMember } from "@/lib/util/require-league-member";
import {
  sweepAllActiveMatchdays,
  sweepMatchday,
  type SweepReport,
} from "@/lib/scoring/sweep";

async function requireProfileId(): Promise<string> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return user.id;
}

/**
 * Score one matchday. Idempotent. Any league member can trigger it.
 */
export async function recomputeMatchdayScores(matchday: number) {
  const me = await requireProfileId();
  await requireLeagueMember(me);
  const report = await sweepMatchday(matchday);
  revalidatePath(`/matchday/${matchday}`);
  revalidatePath("/dashboard");
  return report;
}

/**
 * Sync every matchday that has at least one finalized fixture. Single
 * "make everything up to date" entry point. Idempotent.
 */
export async function syncAllStandings(): Promise<{
  reports: SweepReport[];
  totalManagersScored: number;
}> {
  const me = await requireProfileId();
  await requireLeagueMember(me);
  const reports = await sweepAllActiveMatchdays();
  let totalManagersScored = 0;
  for (const r of reports) totalManagersScored += r.managersScored;

  // Best-effort revalidation
  revalidatePath("/dashboard");
  for (const r of reports) {
    revalidatePath(`/matchday/${r.matchday}`);
  }
  return { reports, totalManagersScored };
}

/**
 * Find the matchday for a fixture and recompute it. Used as the
 * auto-trigger after stat/MOTM mutations elsewhere.
 */
export async function recomputeForFixture(
  fixtureId: string
): Promise<SweepReport | null> {
  const [fx] = await db
    .select({ matchday: fixtures.matchday })
    .from(fixtures)
    .where(eq(fixtures.id, fixtureId))
    .limit(1);
  if (!fx) return null;
  const report = await sweepMatchday(fx.matchday);
  revalidatePath(`/matchday/${fx.matchday}`);
  revalidatePath("/dashboard");
  return report;
}
