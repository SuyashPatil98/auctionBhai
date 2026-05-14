/**
 * Sub-position normalization buckets.
 *
 * football-data.org gives us only 4 position buckets (GK/DEF/MID/FWD), which
 * is too coarse for fair Layer 2 (market value) comparison: a defensive
 * midfielder gets compared against an attacking midfielder against a winger
 * — three very different market profiles all collapsed into "MID".
 *
 * Transfermarkt's `sub_position` is finer-grained. We map it into 9
 * buckets that share market-value distributions:
 *
 *   GK                Goalkeeper
 *   CB                Centre-Back
 *   FB                Left-Back, Right-Back, Wing-Back
 *   DM                Defensive Midfield
 *   CM                Central Midfield
 *   AM                Attacking Midfield, Second Striker (free roles)
 *   W                 Left/Right Winger, Left/Right Midfield (wide roles)
 *   ST                Centre-Forward
 *   (fallback to DbPosition when sub_position is missing)
 */

import type { DbPosition } from "@/lib/ingest/mappers";

export type Bucket = "GK" | "CB" | "FB" | "DM" | "CM" | "AM" | "W" | "ST" | DbPosition;

/**
 * Maps a Transfermarkt sub_position string to a normalization bucket.
 * Falls back to the player's coarse position when the sub-position is
 * missing or unrecognised.
 */
export function bucketFromSubPosition(
  subPosition: string | null | undefined,
  position: DbPosition
): Bucket {
  if (!subPosition) return position;
  const s = subPosition.toLowerCase();

  if (s.includes("goalkeeper")) return "GK";

  if (s.includes("centre-back") || s === "centre back" || s.includes("center-back"))
    return "CB";
  if (
    s.includes("left-back") ||
    s.includes("right-back") ||
    s.includes("wing-back") ||
    s.includes("full-back")
  )
    return "FB";

  if (s.includes("defensive midfield")) return "DM";
  if (s.includes("attacking midfield") || s.includes("second striker"))
    return "AM";
  if (
    s.includes("left winger") ||
    s.includes("right winger") ||
    s.includes("left midfield") ||
    s.includes("right midfield")
  )
    return "W";
  if (s.includes("midfield")) return "CM"; // catch-all for "Central Midfield" + generic "Midfield"

  if (s.includes("centre-forward") || s.includes("center-forward")) return "ST";
  if (s.includes("forward") || s.includes("striker")) return "ST";

  // Unknown sub-position — fall back to coarse position.
  return position;
}

export const ALL_BUCKETS: Bucket[] = [
  "GK",
  "CB",
  "FB",
  "DM",
  "CM",
  "AM",
  "W",
  "ST",
  // fallbacks (only used when sub_position is missing)
  "DEF",
  "MID",
  "FWD",
];
