/**
 * Orchestrates ingestion from football-data.org into our Postgres schema.
 *
 * Three steps, each independently runnable & idempotent:
 *   1. ingestTournament       → upsert into `tournaments`
 *   2. ingestCountriesAndSquads → upsert into `countries` + `real_players`
 *   3. ingestFixtures         → upsert into `fixtures`
 *
 * Designed for the FIFA World Cup (competition code "WC"), but the same
 * code will work for any competition code on the free tier.
 */

import { db } from "@/lib/db";
import {
  countries,
  fixtures,
  realPlayers,
  tournaments,
} from "@/lib/db/schema";
import { sql } from "drizzle-orm";
import {
  getCompetition,
  getCompetitionMatches,
  getCompetitionTeams,
  type Match,
  type Team,
} from "@/lib/external/football-data";
import {
  deriveMatchday,
  mapFixtureStage,
  mapFixtureStatus,
  mapPosition,
  type DbFixtureStage,
  type DbFixtureStatus,
  type DbPosition,
} from "./mappers";
import { withIngestionRun, type IngestionRunResult } from "./run";

export const WC_COMPETITION_CODE = "WC";

// ---------- 1. tournament ----------

export async function ingestTournament(
  competitionCode = WC_COMPETITION_CODE
): Promise<IngestionRunResult> {
  return withIngestionRun("football-data", "fixtures", async () => {
    const comp = await getCompetition(competitionCode);
    if (!comp.currentSeason) {
      throw new Error(
        `Competition ${competitionCode} has no current season — nothing to ingest.`
      );
    }

    await db
      .insert(tournaments)
      .values({
        externalId: String(comp.id),
        name: comp.name,
        startsAt: new Date(comp.currentSeason.startDate),
        endsAt: new Date(comp.currentSeason.endDate),
      })
      .onConflictDoUpdate({
        target: tournaments.externalId,
        set: {
          name: comp.name,
          startsAt: new Date(comp.currentSeason.startDate),
          endsAt: new Date(comp.currentSeason.endDate),
        },
      });

    return {
      rowsChanged: 1,
      notes: `Tournament: ${comp.name} (${comp.currentSeason.startDate} → ${comp.currentSeason.endDate})`,
    };
  });
}

// ---------- 2. countries + squads ----------

export async function ingestCountriesAndSquads(
  competitionCode = WC_COMPETITION_CODE
): Promise<IngestionRunResult> {
  return withIngestionRun("football-data", "squads", async () => {
    const { teams } = await getCompetitionTeams(competitionCode);

    // 1. Bulk-upsert countries. Only ~48 rows; collect them first.
    type CountryRow = {
      externalId: string;
      name: string;
      code: string;
      flagUrl: string | null | undefined;
    };
    const countryRows: CountryRow[] = [];
    const seenExt = new Set<string>();

    for (const team of teams) {
      const externalId = String(team.id);
      const code = (team.area?.code ?? team.tla ?? "").toUpperCase();
      const name = team.area?.name ?? team.name;
      // Dedup on external_id (the stable football-data team id), not code.
      if (!code || seenExt.has(externalId)) continue;
      seenExt.add(externalId);
      countryRows.push({ externalId, name, code, flagUrl: team.crest ?? null });
    }

    if (countryRows.length === 0) {
      return { rowsChanged: 0, notes: "No teams returned." };
    }

    // Conflict on external_id, NOT code. A country's derived code can change
    // between ingests (e.g. Curaçao ANT→CUW — the FIFA-vs-ISO alias problem),
    // but its football-data team id never moves. Keying on external_id lets us
    // refresh code/name/flag idempotently instead of tripping the external_id
    // unique constraint with a phantom INSERT under the shifted code.
    const insertedCountries = await db
      .insert(countries)
      .values(countryRows)
      .onConflictDoUpdate({
        target: countries.externalId,
        set: {
          code: sql`excluded.code`,
          name: sql`excluded.name`,
          flagUrl: sql`excluded.flag_url`,
        },
      })
      .returning({
        id: countries.id,
        externalId: countries.externalId,
      });

    const countryIdByExternal = new Map<string, string>();
    for (const c of insertedCountries) {
      if (c.externalId) countryIdByExternal.set(c.externalId, c.id);
    }

    // 2. Build all player rows, then bulk-upsert in one query.
    type PlayerRow = {
      countryId: string;
      externalId: string;
      fullName: string;
      displayName: string;
      position: DbPosition;
      shirtNumber: number | null;
      dob: string | null;
      isActive: boolean;
    };
    const playerRows: PlayerRow[] = [];
    const seenPlayerExt = new Set<string>();

    for (const team of teams) {
      const teamExt = String(team.id);
      const countryId = countryIdByExternal.get(teamExt);
      if (!countryId) continue;

      for (const p of team.squad ?? []) {
        const ext = String(p.id);
        if (seenPlayerExt.has(ext)) continue;
        seenPlayerExt.add(ext);
        playerRows.push({
          countryId,
          externalId: ext,
          fullName: p.name,
          displayName: p.name,
          position: mapPosition(p.position),
          shirtNumber: p.shirtNumber ?? null,
          dob: p.dateOfBirth ? p.dateOfBirth.slice(0, 10) : null,
          isActive: true,
        });
      }
    }

    if (playerRows.length > 0) {
      // Postgres handles thousands of rows in a single VALUES list fine.
      await db
        .insert(realPlayers)
        .values(playerRows)
        .onConflictDoUpdate({
          target: realPlayers.externalId,
          set: {
            countryId: sql`excluded.country_id`,
            fullName: sql`excluded.full_name`,
            displayName: sql`excluded.display_name`,
            position: sql`excluded.position`,
            shirtNumber: sql`excluded.shirt_number`,
            dob: sql`excluded.dob`,
            isActive: sql`excluded.is_active`,
          },
        });
    }

    return {
      rowsChanged: countryRows.length + playerRows.length,
      notes: `${countryRows.length} countries, ${playerRows.length} players`,
    };
  });
}

// ---------- 3. fixtures ----------

export async function ingestFixtures(
  competitionCode = WC_COMPETITION_CODE
): Promise<IngestionRunResult> {
  return withIngestionRun("football-data", "fixtures", async () => {
    const { matches } = await getCompetitionMatches(competitionCode);

    // Resolve our tournament id once.
    const [tourney] = await db
      .select({
        id: tournaments.id,
      })
      .from(tournaments)
      .where(
        sql`${tournaments.externalId} = ${String(2000)}` // WC id; tolerated if integer-encoded
      )
      .limit(1);

    if (!tourney) {
      throw new Error(
        "Tournament row not found. Run ingestTournament() first."
      );
    }

    // Resolve country ids by their external_id (which we wrote as team.area.id).
    const countryRows = await db
      .select({
        id: countries.id,
        externalId: countries.externalId,
      })
      .from(countries);
    const countryIdByExt = new Map<string, string>();
    for (const c of countryRows) {
      if (c.externalId) countryIdByExt.set(c.externalId, c.id);
    }

    type FixtureRow = {
      tournamentId: string;
      externalId: string;
      kickoffAt: Date;
      stage: DbFixtureStage;
      matchday: number;
      homeCountryId: string;
      awayCountryId: string;
      homeScore: number | null;
      awayScore: number | null;
      status: DbFixtureStatus;
      venue: string | null;
      lastSyncedAt: Date;
    };
    const fixtureRows: FixtureRow[] = [];
    // Two distinct skip reasons, kept apart on purpose:
    //  - awaitingDraw: a knockout slot whose teams aren't decided yet (the API
    //    returns null team ids). Expected and benign — the fixture is created
    //    on a later sync once the bracket is drawn. We can't store it now
    //    because home/away country columns are NOT NULL.
    //  - unmapped: real team ids that aren't in our countries table. A genuine
    //    bug (a participant we failed to ingest) — surfaced loudly so a
    //    knockout fixture never silently disappears.
    const awaitingDraw: string[] = [];
    const unmapped: string[] = [];
    const now = new Date();

    for (const m of matches) {
      const homeIdRaw = m.homeTeam?.id ?? null;
      const awayIdRaw = m.awayTeam?.id ?? null;

      // Knockout slot not yet decided — skip quietly, pick it up next sync.
      if (homeIdRaw === null || awayIdRaw === null) {
        awaitingDraw.push(`${m.stage} #${m.id}`);
        continue;
      }

      const homeId = countryIdByExt.get(String(homeIdRaw));
      const awayId = countryIdByExt.get(String(awayIdRaw));

      // Teams are decided but one didn't map to a country we know — real bug.
      if (!homeId || !awayId) {
        unmapped.push(
          `#${m.id} ${m.homeTeam?.name ?? homeIdRaw} vs ${m.awayTeam?.name ?? awayIdRaw}`
        );
        continue;
      }

      fixtureRows.push({
        tournamentId: tourney.id,
        externalId: String(m.id),
        kickoffAt: new Date(m.utcDate),
        stage: mapFixtureStage(m.stage),
        matchday: deriveMatchday(m.stage, m.matchday),
        homeCountryId: homeId,
        awayCountryId: awayId,
        homeScore: m.score?.fullTime?.home ?? null,
        awayScore: m.score?.fullTime?.away ?? null,
        status: mapFixtureStatus(m.status),
        venue: m.venue ?? null,
        lastSyncedAt: now,
      });
    }

    if (fixtureRows.length > 0) {
      await db
        .insert(fixtures)
        .values(fixtureRows)
        .onConflictDoUpdate({
          target: fixtures.externalId,
          set: {
            kickoffAt: sql`excluded.kickoff_at`,
            stage: sql`excluded.stage`,
            matchday: sql`excluded.matchday`,
            homeCountryId: sql`excluded.home_country_id`,
            awayCountryId: sql`excluded.away_country_id`,
            homeScore: sql`excluded.home_score`,
            awayScore: sql`excluded.away_score`,
            status: sql`excluded.status`,
            venue: sql`excluded.venue`,
            lastSyncedAt: sql`excluded.last_synced_at`,
          },
        });
    }

    if (unmapped.length > 0) {
      // Loud signal in the function logs too, not just the notes column.
      console.warn(
        `[ingestFixtures] ${unmapped.length} decided match(es) had unmappable teams:`,
        unmapped
      );
    }

    const noteParts = [`${fixtureRows.length} fixtures upserted`];
    if (awaitingDraw.length > 0) {
      noteParts.push(`${awaitingDraw.length} awaiting knockout draw`);
    }
    if (unmapped.length > 0) {
      noteParts.push(
        `⚠ ${unmapped.length} UNMAPPED (decided but no country): ` +
          unmapped.slice(0, 5).join("; ") +
          (unmapped.length > 5 ? " …" : "")
      );
    }

    return {
      rowsChanged: fixtureRows.length,
      notes: noteParts.join(" · "),
    };
  });
}

// ---------- orchestrator ----------

export async function ingestAll() {
  const a = await ingestTournament();
  const b = await ingestCountriesAndSquads();
  const c = await ingestFixtures();
  return { tournament: a, countriesAndSquads: b, fixtures: c };
}

// Re-export the types the ingest endpoint needs.
export type { Match, Team };
