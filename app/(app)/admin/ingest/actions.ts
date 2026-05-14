"use server";

import { revalidatePath } from "next/cache";
import {
  ingestCountriesAndSquads,
  ingestFixtures,
  ingestTournament,
} from "@/lib/ingest/football-data";

// Form-action signatures must return void | Promise<void>.
// Outcomes are persisted in `ingestion_runs` and surfaced by the admin
// page's recent-runs table, so no need to return data inline.

async function safeRun(label: string, fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch (err) {
    console.error(`[ingest:${label}]`, err);
    // Error is also written to ingestion_runs by withIngestionRun().
  }
}

export async function runTournamentIngest() {
  await safeRun("tournament", () => ingestTournament());
  revalidatePath("/admin/ingest");
}

export async function runCountriesAndSquadsIngest() {
  await safeRun("countries+squads", () => ingestCountriesAndSquads());
  revalidatePath("/admin/ingest");
  revalidatePath("/players");
}

export async function runFixturesIngest() {
  await safeRun("fixtures", () => ingestFixtures());
  revalidatePath("/admin/ingest");
  revalidatePath("/fixtures");
}

export async function runAllIngests() {
  // Sequential so we have countries before we try to map fixtures to them.
  await safeRun("tournament", () => ingestTournament());
  await safeRun("countries+squads", () => ingestCountriesAndSquads());
  await safeRun("fixtures", () => ingestFixtures());
  revalidatePath("/admin/ingest");
  revalidatePath("/players");
  revalidatePath("/fixtures");
}
