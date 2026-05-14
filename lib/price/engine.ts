/**
 * Price engine: turns rating + country expected_matches into auction
 * credit prices.
 *
 * Three steps:
 *   1. Estimate starter probability per (country, position) by ranking
 *      players within country+position by rating. Yields expected
 *      minutes per match.
 *   2. Estimate raw expected fantasy value per player:
 *        pts/match  = max(0, (rating - 40) × 0.15) × P(starter)
 *        total_pts  = pts/match × country.expected_matches
 *   3. Normalize across the league so the top 80 drafted players sum
 *      to the league budget × inflation factor.
 *
 * Output: per-player price ∈ [1, ~90] and tier label.
 */

export type Position = "GK" | "DEF" | "MID" | "FWD";

export type PricingInput = {
  realPlayerId: string;
  countryId: string;
  position: Position;
  rating: number; // 0-100
  expectedMatches: number; // from bracket sim
};

export type PricingOutput = {
  realPlayerId: string;
  price: number;
  tier: "superstar" | "star" | "starter" | "rotation" | "depth";
  expectedPoints: number;
  expectedMatches: number;
  starterProb: number;
  positionRankInCountry: number;
};

/**
 * Per-position starter cutoff. Players ranked at or before the cutoff
 * within their country are considered first-choice; beyond, rotation
 * or bench.
 */
const STARTER_CUTOFF: Record<Position, number> = {
  GK: 1,
  DEF: 4,
  MID: 4,
  FWD: 2,
};

function starterProbability(rankInPos: number, position: Position): number {
  const cutoff = STARTER_CUTOFF[position];
  if (rankInPos <= cutoff) return 0.85;
  if (rankInPos <= cutoff + 2) return 0.30;
  if (rankInPos <= cutoff + 4) return 0.10;
  return 0.02;
}

/**
 * League pricing parameters (per leagues.settings; defaults here).
 */
export const PRICING_PARAMS = {
  managers: 4,
  budgetPerManager: 200,
  squadSize: 20,
  inflationFactor: 1.10, // top-80 prices sum to 110% of total budget
  minPrice: 1,
  maxPrice: 100,
};

export type TierThresholds = {
  superstarRank: number;
  starRank: number;
  starterRank: number;
  rotationRank: number;
};

const TIER_THRESHOLDS: TierThresholds = {
  superstarRank: 6,
  starRank: 20, // ranks 7-20 = star
  starterRank: 60, // ranks 21-60 = starter
  rotationRank: 160, // ranks 61-160 = rotation
  // remainder = depth
};

export type PriceComputeRow = {
  realPlayerId: string;
  countryId: string;
  position: Position;
  rating: number;
};

export type CountryExpectedMatches = Map<string, number>; // countryId → expected_matches

export function computePrices(
  rows: PriceComputeRow[],
  expectedMatchesByCountry: CountryExpectedMatches
): PricingOutput[] {
  // Step 1: rank players within country+position by rating desc.
  const grouped = new Map<string, PriceComputeRow[]>(); // key=`${countryId}|${position}`
  for (const r of rows) {
    const key = `${r.countryId}|${r.position}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(r);
  }
  for (const list of grouped.values()) {
    list.sort((a, b) => b.rating - a.rating);
  }

  const rankInPos = new Map<string, number>();
  for (const [, list] of grouped) {
    list.forEach((r, idx) => {
      rankInPos.set(r.realPlayerId, idx + 1);
    });
  }

  // Step 2: raw expected value.
  //
  // We use a power-law on (rating - 50): top-tier players are
  // disproportionately more valuable, which produces a realistic auction
  // spread where elite players take 30%+ of a manager's budget.
  //
  // Linear formula compressed top:depth to ~3x. Power 2.5 pushes it to
  // ~30x, giving Mbappé-tier players ~60-80 credits while keepers and
  // depth go for 1-3.
  const RATING_POWER = 3.5;
  const PTS_SCALE = 1.5; // soft scale; final normalization handles total

  type Intermediate = PricingOutput & { rawValue: number };
  const intermediate: Intermediate[] = rows.map((r) => {
    const rank = rankInPos.get(r.realPlayerId) ?? 99;
    const starterProb = starterProbability(rank, r.position);
    const expMatches = expectedMatchesByCountry.get(r.countryId) ?? 3.0;
    const excess = Math.max(0, (r.rating - 50) / 10); // 0 for rating ≤ 50
    const ptsPerMatch = Math.pow(excess, RATING_POWER) * PTS_SCALE * starterProb;
    const expectedPoints = ptsPerMatch * expMatches;
    return {
      realPlayerId: r.realPlayerId,
      price: 0,
      tier: "depth" as const,
      expectedPoints,
      expectedMatches: expMatches,
      starterProb,
      positionRankInCountry: rank,
      rawValue: expectedPoints,
    };
  });

  // Step 3: normalize so top-80 prices sum to league budget × inflation.
  const drafted = PRICING_PARAMS.managers * PRICING_PARAMS.squadSize; // 80
  const totalBudget =
    PRICING_PARAMS.managers *
    PRICING_PARAMS.budgetPerManager *
    PRICING_PARAMS.inflationFactor;
  const sortedDesc = [...intermediate].sort(
    (a, b) => b.rawValue - a.rawValue
  );
  const topSum = sortedDesc.slice(0, drafted).reduce(
    (acc, r) => acc + r.rawValue,
    0
  );
  const scale = topSum > 0 ? totalBudget / topSum : 1;

  // Assign price + tier.
  const results: PricingOutput[] = sortedDesc.map((r, i) => {
    const raw = Math.round(r.rawValue * scale);
    const priced = Math.min(
      PRICING_PARAMS.maxPrice,
      Math.max(PRICING_PARAMS.minPrice, raw)
    );
    let tier: PricingOutput["tier"];
    const overallRank = i + 1;
    if (overallRank <= TIER_THRESHOLDS.superstarRank) tier = "superstar";
    else if (overallRank <= TIER_THRESHOLDS.starRank) tier = "star";
    else if (overallRank <= TIER_THRESHOLDS.starterRank) tier = "starter";
    else if (overallRank <= TIER_THRESHOLDS.rotationRank) tier = "rotation";
    else tier = "depth";
    return {
      realPlayerId: r.realPlayerId,
      price: priced,
      tier,
      expectedPoints: Number(r.expectedPoints.toFixed(2)),
      expectedMatches: r.expectedMatches,
      starterProb: r.starterProb,
      positionRankInCountry: r.positionRankInCountry,
    };
  });

  return results;
}
