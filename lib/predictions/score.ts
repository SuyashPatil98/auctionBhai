/**
 * FPL-style score-prediction scoring.
 *
 *   exact score                        → 3 points
 *   correct outcome + goal difference  → 2 points
 *   correct outcome (W/D/L only)       → 1 point
 *   otherwise                          → 0 points
 *
 * Pure — no DB. Used by both the per-fixture scorer (when a fixture is
 * finalised) and any backfill script.
 */

export function scorePrediction(
  predicted: { homeScore: number; awayScore: number },
  actual: { homeScore: number; awayScore: number }
): number {
  // Exact
  if (
    predicted.homeScore === actual.homeScore &&
    predicted.awayScore === actual.awayScore
  ) {
    return 3;
  }

  const predOutcome = outcome(predicted.homeScore, predicted.awayScore);
  const actOutcome = outcome(actual.homeScore, actual.awayScore);
  if (predOutcome !== actOutcome) return 0;

  // Correct outcome, check goal difference
  const predDiff = predicted.homeScore - predicted.awayScore;
  const actDiff = actual.homeScore - actual.awayScore;
  if (predDiff === actDiff) return 2;

  return 1;
}

function outcome(home: number, away: number): "home" | "draw" | "away" {
  if (home > away) return "home";
  if (home < away) return "away";
  return "draw";
}
