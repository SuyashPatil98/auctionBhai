/**
 * Pure-function tests for lib/scoring/points.ts and lib/scoring/matchday.ts.
 *
 * No test framework — node:assert against expected scalars. Run via
 * `pnpm test:scoring`. Exits non-zero on any failure.
 *
 * Each case is named so a failure points directly at the rule it covers.
 */

import assert from "node:assert/strict";
import {
  pointsForPlayer,
  STAGE_MULTIPLIERS,
  type PlayerMatchStats,
} from "../lib/scoring/points";
import { scoreMatchday, type MatchdayInput } from "../lib/scoring/matchday";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (e) {
    console.error(`  ✗ ${name}`);
    console.error("    " + ((e as Error).stack ?? (e as Error).message));
    failed++;
  }
}

function emptyStats(overrides: Partial<PlayerMatchStats> = {}): PlayerMatchStats {
  return {
    minutes: 0,
    goals: 0,
    assists: 0,
    cleanSheet: false,
    goalsConceded: 0,
    pensMissed: 0,
    yellows: 0,
    reds: 0,
    ownGoals: 0,
    penSaves: 0,
    motmVoteWinner: false,
    ...overrides,
  };
}

console.log("Scoring engine — points.ts\n");

// ---------------------------------------------------------------------------
// Appearance
// ---------------------------------------------------------------------------

test("DNP scores zero, no breakdown rows", () => {
  const s = pointsForPlayer({
    position: "MID",
    stage: "group",
    stats: emptyStats(),
    role: "none",
  });
  assert.equal(s.base, 0);
  assert.equal(s.total, 0);
  assert.equal(s.breakdown.length, 0);
});

test("Sub appearance (1-59 min) = +1", () => {
  const s = pointsForPlayer({
    position: "MID",
    stage: "group",
    stats: emptyStats({ minutes: 30 }),
    role: "none",
  });
  assert.equal(s.base, 1);
  assert.equal(s.total, 1);
});

test("Full appearance (60+ min) = +2", () => {
  const s = pointsForPlayer({
    position: "FWD",
    stage: "group",
    stats: emptyStats({ minutes: 90 }),
    role: "none",
  });
  assert.equal(s.base, 2);
});

// ---------------------------------------------------------------------------
// Position-relative goals
// ---------------------------------------------------------------------------

test("MID goal = +5 (2 app + 5 goal = 7)", () => {
  const s = pointsForPlayer({
    position: "MID",
    stage: "group",
    stats: emptyStats({ minutes: 90, goals: 1 }),
    role: "none",
  });
  assert.equal(s.base, 7);
});

test("FWD goal = +4 (2 + 4 = 6)", () => {
  const s = pointsForPlayer({
    position: "FWD",
    stage: "group",
    stats: emptyStats({ minutes: 90, goals: 1 }),
    role: "none",
  });
  assert.equal(s.base, 6);
});

test("DEF goal = +6 (2 + 6 = 8)", () => {
  const s = pointsForPlayer({
    position: "DEF",
    stage: "group",
    stats: emptyStats({ minutes: 90, goals: 1 }),
    role: "none",
  });
  assert.equal(s.base, 8);
});

test("GK goal = +10 (rare but possible)", () => {
  const s = pointsForPlayer({
    position: "GK",
    stage: "group",
    stats: emptyStats({ minutes: 90, goals: 1, cleanSheet: false }),
    role: "none",
  });
  // 2 app + 10 goal = 12 (no clean sheet since they presumably had to attack)
  assert.equal(s.base, 12);
});

// ---------------------------------------------------------------------------
// Clean sheet + concessions
// ---------------------------------------------------------------------------

test("DEF clean sheet (60+ min) = +4", () => {
  const s = pointsForPlayer({
    position: "DEF",
    stage: "group",
    stats: emptyStats({ minutes: 90, cleanSheet: true }),
    role: "none",
  });
  // 2 app + 4 CS = 6
  assert.equal(s.base, 6);
});

test("MID clean sheet (60+ min) = +1", () => {
  const s = pointsForPlayer({
    position: "MID",
    stage: "group",
    stats: emptyStats({ minutes: 90, cleanSheet: true }),
    role: "none",
  });
  assert.equal(s.base, 3);
});

test("FWD clean sheet = 0 (no row added)", () => {
  const s = pointsForPlayer({
    position: "FWD",
    stage: "group",
    stats: emptyStats({ minutes: 90, cleanSheet: true }),
    role: "none",
  });
  assert.equal(s.base, 2);
  assert.equal(
    s.breakdown.find((l) => l.label.includes("Clean sheet")),
    undefined
  );
});

test("GK conceded 3 = -1 (floor(3/2))", () => {
  const s = pointsForPlayer({
    position: "GK",
    stage: "group",
    stats: emptyStats({ minutes: 90, goalsConceded: 3 }),
    role: "none",
  });
  // 2 app + 0 CS + (-1 conceded) = 1
  assert.equal(s.base, 1);
});

test("MID conceded 4 = 0 penalty (only GK/DEF)", () => {
  const s = pointsForPlayer({
    position: "MID",
    stage: "group",
    stats: emptyStats({ minutes: 90, goalsConceded: 4 }),
    role: "none",
  });
  assert.equal(s.base, 2);
});

test("DEF DNP 30min → no CS bonus even if 0 conceded", () => {
  const s = pointsForPlayer({
    position: "DEF",
    stage: "group",
    stats: emptyStats({ minutes: 30, cleanSheet: true }),
    role: "none",
  });
  // 1 app only — CS requires 60+
  assert.equal(s.base, 1);
});

// ---------------------------------------------------------------------------
// GK-specific
// ---------------------------------------------------------------------------

test("GK pen save = +5", () => {
  const s = pointsForPlayer({
    position: "GK",
    stage: "group",
    stats: emptyStats({ minutes: 90, penSaves: 1, cleanSheet: true }),
    role: "none",
  });
  // 2 app + 4 CS + 5 pen save = 11
  assert.equal(s.base, 11);
});

// ---------------------------------------------------------------------------
// Negative events
// ---------------------------------------------------------------------------

test("Yellow card = -1", () => {
  const s = pointsForPlayer({
    position: "MID",
    stage: "group",
    stats: emptyStats({ minutes: 90, yellows: 1 }),
    role: "none",
  });
  assert.equal(s.base, 1);
});

test("Red card = -3", () => {
  const s = pointsForPlayer({
    position: "MID",
    stage: "group",
    stats: emptyStats({ minutes: 45, reds: 1 }),
    role: "none",
  });
  // 1 app + (-3 red) = -2
  assert.equal(s.base, -2);
});

test("Own goal + pen miss = -4 total", () => {
  const s = pointsForPlayer({
    position: "FWD",
    stage: "group",
    stats: emptyStats({ minutes: 90, ownGoals: 1, pensMissed: 1 }),
    role: "none",
  });
  // 2 app + (-2 OG) + (-2 pen miss) = -2
  assert.equal(s.base, -2);
});

// ---------------------------------------------------------------------------
// Assists + MOTM
// ---------------------------------------------------------------------------

test("Assist = +3 (all positions)", () => {
  const s = pointsForPlayer({
    position: "DEF",
    stage: "group",
    stats: emptyStats({ minutes: 90, assists: 1, cleanSheet: true }),
    role: "none",
  });
  // 2 + 4 CS + 3 assist = 9
  assert.equal(s.base, 9);
});

test("MOTM = +3 bonus", () => {
  const s = pointsForPlayer({
    position: "MID",
    stage: "group",
    stats: emptyStats({ minutes: 90, goals: 1, motmVoteWinner: true }),
    role: "none",
  });
  // 2 + 5 + 3 = 10
  assert.equal(s.base, 10);
});

// ---------------------------------------------------------------------------
// Captain / vice multipliers
// ---------------------------------------------------------------------------

test("Captain doubles base", () => {
  const s = pointsForPlayer({
    position: "MID",
    stage: "group",
    stats: emptyStats({ minutes: 90, goals: 1 }),
    role: "captain",
  });
  assert.equal(s.base, 7);
  assert.equal(s.captainMultiplier, 2);
  assert.equal(s.total, 14);
});

test("Vice promoted = ×1.5 (one decimal preserved)", () => {
  const s = pointsForPlayer({
    position: "FWD",
    stage: "group",
    stats: emptyStats({ minutes: 90, goals: 1 }),
    role: "vice_promoted",
  });
  // base = 2 + 4 = 6 → 6 × 1.5 = 9
  assert.equal(s.total, 9);
});

test("Vice promoted with odd base = .5 result", () => {
  const s = pointsForPlayer({
    position: "MID",
    stage: "group",
    stats: emptyStats({ minutes: 90 }), // base = 2
    role: "vice_promoted",
  });
  assert.equal(s.base, 2);
  // 2 × 1.5 = 3.0 (not interesting). Try odd:
  const s2 = pointsForPlayer({
    position: "MID",
    stage: "group",
    stats: emptyStats({ minutes: 30 }), // base = 1
    role: "vice_promoted",
  });
  assert.equal(s2.base, 1);
  assert.equal(s2.total, 1.5);
});

// ---------------------------------------------------------------------------
// Stage multipliers
// ---------------------------------------------------------------------------

test("R16 stage ×1.4", () => {
  const s = pointsForPlayer({
    position: "MID",
    stage: "r16",
    stats: emptyStats({ minutes: 90, goals: 1 }),
    role: "none",
  });
  assert.equal(s.base, 7);
  assert.equal(s.stageMultiplier, 1.4);
  // 7 × 1.4 = 9.8
  assert.equal(s.total, 9.8);
});

test("Final stage ×2 + captain ×2 = ×4 effective", () => {
  const s = pointsForPlayer({
    position: "FWD",
    stage: "final",
    stats: emptyStats({ minutes: 90, goals: 1 }),
    role: "captain",
  });
  assert.equal(s.base, 6);
  // 6 × 2 (cap) × 2 (final) = 24
  assert.equal(s.total, 24);
});

test("Stage multipliers all present and sensible", () => {
  assert.equal(STAGE_MULTIPLIERS.group, 1.0);
  assert.equal(STAGE_MULTIPLIERS.r16, 1.4);
  assert.equal(STAGE_MULTIPLIERS.qf, 1.6);
  assert.equal(STAGE_MULTIPLIERS.sf, 1.8);
  assert.equal(STAGE_MULTIPLIERS.final, 2.0);
});

// ---------------------------------------------------------------------------
// matchday.ts — lineup orchestration
// ---------------------------------------------------------------------------

console.log("\nScoring engine — matchday.ts\n");

/** Helper: build a 11+4 lineup with given player ids in each slot. */
function buildLineup(args: {
  profileId: string;
  starters: Array<[string, "GK" | "DEF" | "MID" | "FWD"]>;
  bench: Array<[string, "GK" | "DEF" | "MID" | "FWD"]>;
  captainId: string;
  viceId: string;
  formation?: string;
}) {
  return {
    profileId: args.profileId,
    formation: args.formation ?? "4-4-2",
    starters: args.starters.map(([id, pos]) => ({
      realPlayerId: id,
      position: pos,
    })),
    bench: args.bench.map(([id, pos]) => ({
      realPlayerId: id,
      position: pos,
    })),
    captainId: args.captainId,
    viceId: args.viceId,
  };
}

function statsMap(
  entries: Array<{
    id: string;
    position: "GK" | "DEF" | "MID" | "FWD";
    fixtures: Array<{ fixtureId: string; stage: "group" | "r16" | "qf" | "sf" | "final"; stats: PlayerMatchStats }>;
  }>
) {
  const m = new Map<string, MatchdayInput["playerStats"] extends Map<string, infer V> ? V : never>();
  for (const e of entries) {
    m.set(e.id, {
      realPlayerId: e.id,
      position: e.position,
      fixtures: e.fixtures,
    });
  }
  return m;
}

test("All 11 played, captain played → captain ×2 applied once", () => {
  const lineup = buildLineup({
    profileId: "P1",
    starters: [
      ["gk1", "GK"],
      ["d1", "DEF"], ["d2", "DEF"], ["d3", "DEF"], ["d4", "DEF"],
      ["m1", "MID"], ["m2", "MID"], ["m3", "MID"], ["m4", "MID"],
      ["f1", "FWD"], ["f2", "FWD"],
    ],
    bench: [["bgk", "GK"], ["bd", "DEF"], ["bm", "MID"], ["bf", "FWD"]],
    captainId: "f1",
    viceId: "f2",
  });

  const stats = statsMap(
    [...lineup.starters, ...lineup.bench].map((s) => ({
      id: s.realPlayerId,
      position: s.position,
      fixtures: [
        {
          fixtureId: "fx1",
          stage: "group",
          stats: emptyStats({ minutes: 90 }),
        },
      ],
    }))
  );
  // Captain f1 scores a goal
  stats.set("f1", {
    realPlayerId: "f1",
    position: "FWD",
    fixtures: [
      {
        fixtureId: "fx1",
        stage: "group",
        stats: emptyStats({ minutes: 90, goals: 1 }),
      },
    ],
  });

  const result = scoreMatchday({ matchday: 1, lineups: [lineup], playerStats: stats });
  const mgr = result.managers[0];
  assert.equal(mgr.captainPlayed, true);

  // 11 starters: 10 × 2 (appearance only) + captain f1: (2+4) × 2 = 12
  // = 20 + 12 = 32
  assert.equal(mgr.total, 32);

  // Bench players also reported but not counted
  assert.equal(mgr.slots.length, 15);
  const benchSlots = mgr.slots.filter((s) => s.fromBench);
  assert.equal(benchSlots.length, 4);
});

test("Captain DNP, vice played → vice gets ×1.5", () => {
  const lineup = buildLineup({
    profileId: "P1",
    starters: [
      ["gk1", "GK"],
      ["d1", "DEF"], ["d2", "DEF"], ["d3", "DEF"], ["d4", "DEF"],
      ["m1", "MID"], ["m2", "MID"], ["m3", "MID"], ["m4", "MID"],
      ["f1", "FWD"], ["f2", "FWD"],
    ],
    bench: [["bgk", "GK"], ["bd", "DEF"], ["bm", "MID"], ["bf", "FWD"]],
    captainId: "f1",
    viceId: "f2",
  });

  const stats = statsMap(
    [...lineup.starters, ...lineup.bench].map((s) => ({
      id: s.realPlayerId,
      position: s.position,
      fixtures: [
        {
          fixtureId: "fx1",
          stage: "group",
          stats: emptyStats({ minutes: 90 }),
        },
      ],
    }))
  );
  // f1 (captain) DNP
  stats.set("f1", {
    realPlayerId: "f1",
    position: "FWD",
    fixtures: [{ fixtureId: "fx1", stage: "group", stats: emptyStats({ minutes: 0 }) }],
  });
  // f2 (vice) scores a goal
  stats.set("f2", {
    realPlayerId: "f2",
    position: "FWD",
    fixtures: [
      { fixtureId: "fx1", stage: "group", stats: emptyStats({ minutes: 90, goals: 1 }) },
    ],
  });

  const result = scoreMatchday({ matchday: 1, lineups: [lineup], playerStats: stats });
  const mgr = result.managers[0];
  assert.equal(mgr.captainPlayed, false);

  // bench FWD bf subs in for f1 → 2 pts (appearance)
  // f2 vice: (2 + 4) × 1.5 = 9
  // 9 other starters × 2 (appearance) = 18
  // total: 2 + 9 + 18 = 29
  assert.equal(mgr.total, 29);

  // f1 slot replaced by bf, marked fromBench
  const f1Slot = mgr.slots.find((s) => s.slotPosition === "FWD" && s.fromBench);
  assert.equal(f1Slot?.realPlayerId, "bf");
});

test("Both captain + vice DNP → no captaincy bonus", () => {
  const lineup = buildLineup({
    profileId: "P1",
    starters: [
      ["gk1", "GK"],
      ["d1", "DEF"], ["d2", "DEF"], ["d3", "DEF"], ["d4", "DEF"],
      ["m1", "MID"], ["m2", "MID"], ["m3", "MID"], ["m4", "MID"],
      ["f1", "FWD"], ["f2", "FWD"],
    ],
    bench: [["bgk", "GK"], ["bd", "DEF"], ["bm", "MID"], ["bf", "FWD"]],
    captainId: "f1",
    viceId: "f2",
  });

  const stats = statsMap(
    [...lineup.starters, ...lineup.bench].map((s) => ({
      id: s.realPlayerId,
      position: s.position,
      fixtures: [
        { fixtureId: "fx1", stage: "group", stats: emptyStats({ minutes: 90 }) },
      ],
    }))
  );
  stats.set("f1", {
    realPlayerId: "f1",
    position: "FWD",
    fixtures: [{ fixtureId: "fx1", stage: "group", stats: emptyStats({ minutes: 0 }) }],
  });
  stats.set("f2", {
    realPlayerId: "f2",
    position: "FWD",
    fixtures: [{ fixtureId: "fx1", stage: "group", stats: emptyStats({ minutes: 0 }) }],
  });

  const result = scoreMatchday({ matchday: 1, lineups: [lineup], playerStats: stats });
  const mgr = result.managers[0];
  // Only one bench FWD available — covers f1. f2 stays DNP.
  // 9 played starters × 2 = 18; f1 slot = bf @ 2; f2 slot = 0
  // No captaincy bonus, no vice bonus.
  assert.equal(mgr.captainPlayed, false);
  assert.equal(mgr.total, 20);
});

test("Bench order matters — earlier bench used first", () => {
  const lineup = buildLineup({
    profileId: "P1",
    starters: [
      ["gk1", "GK"],
      ["d1", "DEF"], ["d2", "DEF"], ["d3", "DEF"], ["d4", "DEF"],
      ["m1", "MID"], ["m2", "MID"], ["m3", "MID"], ["m4", "MID"],
      ["f1", "FWD"], ["f2", "FWD"],
    ],
    // Two MID bench players — bench[0] should sub in for the first DNP MID
    bench: [["bench_mid_first", "MID"], ["bench_mid_second", "MID"], ["bgk", "GK"], ["bd", "DEF"]],
    captainId: "f1",
    viceId: "f2",
  });

  const stats = statsMap(
    [...lineup.starters, ...lineup.bench].map((s) => ({
      id: s.realPlayerId,
      position: s.position,
      fixtures: [
        { fixtureId: "fx1", stage: "group", stats: emptyStats({ minutes: 90 }) },
      ],
    }))
  );
  // m1 DNP — first bench MID should sub in
  stats.set("m1", {
    realPlayerId: "m1",
    position: "MID",
    fixtures: [{ fixtureId: "fx1", stage: "group", stats: emptyStats({ minutes: 0 }) }],
  });

  const result = scoreMatchday({ matchday: 1, lineups: [lineup], playerStats: stats });
  const mgr = result.managers[0];
  const subbedSlot = mgr.slots.find(
    (s) => s.slotPosition === "MID" && s.fromBench && !s.realPlayerId.startsWith("bench_mid_second")
  );
  assert.equal(subbedSlot?.realPlayerId, "bench_mid_first");
});

test("Idempotent: same input → same output", () => {
  const lineup = buildLineup({
    profileId: "P1",
    starters: [
      ["gk1", "GK"],
      ["d1", "DEF"], ["d2", "DEF"], ["d3", "DEF"], ["d4", "DEF"],
      ["m1", "MID"], ["m2", "MID"], ["m3", "MID"], ["m4", "MID"],
      ["f1", "FWD"], ["f2", "FWD"],
    ],
    bench: [["bgk", "GK"], ["bd", "DEF"], ["bm", "MID"], ["bf", "FWD"]],
    captainId: "f1",
    viceId: "f2",
  });
  const stats = statsMap(
    [...lineup.starters, ...lineup.bench].map((s) => ({
      id: s.realPlayerId,
      position: s.position,
      fixtures: [{ fixtureId: "fx1", stage: "qf", stats: emptyStats({ minutes: 90, goals: s.realPlayerId === "f1" ? 1 : 0 }) }],
    }))
  );
  const a = scoreMatchday({ matchday: 6, lineups: [lineup], playerStats: stats });
  const b = scoreMatchday({ matchday: 6, lineups: [lineup], playerStats: stats });
  assert.deepEqual(a, b);
});

// ---------------------------------------------------------------------------
// Done
// ---------------------------------------------------------------------------

console.log(`\n${passed} passed · ${failed} failed`);
if (failed > 0) process.exit(1);
