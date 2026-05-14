/**
 * Mappers from football-data.org shapes to our internal enums.
 */

export type DbPosition = "GK" | "DEF" | "MID" | "FWD";
export type DbFixtureStatus =
  | "scheduled"
  | "live"
  | "ht"
  | "ft"
  | "postponed"
  | "cancelled";
export type DbFixtureStage =
  | "group"
  | "r32"
  | "r16"
  | "qf"
  | "sf"
  | "third"
  | "final";

export function mapPosition(apiPosition: string | undefined | null): DbPosition {
  const p = (apiPosition ?? "").toLowerCase();
  if (!p) return "MID";
  if (p.includes("goal")) return "GK"; // "Goalkeeper"
  if (
    p.includes("defen") || // "Defence", "Defender"
    p.includes("back") ||
    p === "cb" ||
    p === "lb" ||
    p === "rb" ||
    p === "lwb" ||
    p === "rwb"
  )
    return "DEF";
  if (
    p.includes("offen") || // "Offence"
    p.includes("attack") ||
    p.includes("forward") ||
    p.includes("striker") ||
    p.includes("wing") ||
    p === "cf" ||
    p === "ss" ||
    p === "lf" ||
    p === "rf"
  )
    return "FWD";
  // Midfield, central midfielder, etc., and unknown fall to MID.
  return "MID";
}

export function mapFixtureStatus(apiStatus: string): DbFixtureStatus {
  switch (apiStatus) {
    case "SCHEDULED":
    case "TIMED":
    case "AWARDED":
      return "scheduled";
    case "IN_PLAY":
    case "LIVE":
      return "live";
    case "PAUSED":
      return "ht";
    case "FINISHED":
      return "ft";
    case "POSTPONED":
    case "SUSPENDED":
      return "postponed";
    case "CANCELED":
    case "CANCELLED":
      return "cancelled";
    default:
      return "scheduled";
  }
}

export function mapFixtureStage(apiStage: string): DbFixtureStage {
  switch (apiStage) {
    case "GROUP_STAGE":
    case "REGULAR_SEASON":
      return "group";
    case "LAST_32":
    case "ROUND_OF_32":
      return "r32";
    case "LAST_16":
    case "ROUND_OF_16":
      return "r16";
    case "QUARTER_FINALS":
    case "QUARTERFINALS":
      return "qf";
    case "SEMI_FINALS":
    case "SEMIFINALS":
      return "sf";
    case "THIRD_PLACE":
    case "3RD_PLACE":
      return "third";
    case "FINAL":
      return "final";
    default:
      return "group";
  }
}

/**
 * Derive a WC 2026-friendly matchday number from the API stage + matchday.
 * - Group: 1, 2, 3 (the API's own matchday)
 * - R32: 4
 * - R16: 5
 * - QF:  6
 * - SF:  7
 * - 3rd / Final: 8
 */
export function deriveMatchday(
  apiStage: string,
  apiMatchday: number | null
): number {
  const stage = mapFixtureStage(apiStage);
  if (stage === "group" && apiMatchday && apiMatchday >= 1 && apiMatchday <= 3) {
    return apiMatchday;
  }
  switch (stage) {
    case "r32":
      return 4;
    case "r16":
      return 5;
    case "qf":
      return 6;
    case "sf":
      return 7;
    case "third":
    case "final":
      return 8;
    default:
      return apiMatchday ?? 1;
  }
}
