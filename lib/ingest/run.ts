import { db } from "@/lib/db";
import { ingestionRuns } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

type IngestionKind = "fixtures" | "squads" | "results" | "lineups" | "stats";

export type IngestionRunResult = {
  rowsChanged: number;
  notes?: string;
};

/**
 * Wraps an ingestion step with a row in `ingestion_runs`:
 *   - inserts a "started" row before the work
 *   - patches it with finished_at + rows_changed on success
 *   - patches it with finished_at + error on failure
 *
 * Returns the underlying function's result.
 */
export async function withIngestionRun<T extends IngestionRunResult>(
  source: string,
  kind: IngestionKind,
  fn: () => Promise<T>
): Promise<T> {
  const [run] = await db
    .insert(ingestionRuns)
    .values({ source, kind })
    .returning({ id: ingestionRuns.id });

  try {
    const result = await fn();
    await db
      .update(ingestionRuns)
      .set({
        finishedAt: new Date(),
        rowsChanged: result.rowsChanged,
      })
      .where(eq(ingestionRuns.id, run.id));
    return result;
  } catch (err) {
    const message =
      err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    await db
      .update(ingestionRuns)
      .set({
        finishedAt: new Date(),
        error: message.slice(0, 8000),
      })
      .where(eq(ingestionRuns.id, run.id));
    throw err;
  }
}
