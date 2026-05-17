/**
 * Demo personas for LineUp Lab. Imported by both the welcome-page
 * server component (to render the picker) and the server action (to
 * sign in). Lives outside the "use server" file because that file can
 * only export async functions.
 *
 * Emails + passwords are PUBLIC by design — these accounts only exist
 * in the demo Supabase project, never in the real auction-bhai one.
 * The seed script creates them with these exact credentials.
 */

export const DEMO_PERSONAS = [
  {
    id: "aggressor",
    email: "aggressor@lineuplab.demo",
    password: "demo-aggressor-7421",
    displayName: "The Aggressor",
    teamName: "Stars & Stripes",
    teamEmoji: "🔥",
    handle: "aggressor",
    blurb:
      "Spent 80% of budget on superstars. Top-heavy squad, thin bench.",
  },
  {
    id: "defender",
    email: "defender@lineuplab.demo",
    password: "demo-defender-3902",
    displayName: "The Defender",
    teamName: "Clean Sheets FC",
    teamEmoji: "🛡️",
    handle: "defender",
    blurb:
      "Loaded up on defenders + GKs. Bets on clean-sheet bonuses.",
  },
  {
    id: "punter",
    email: "punter@lineuplab.demo",
    password: "demo-punter-5168",
    displayName: "The Punter",
    teamName: "Long Odds",
    teamEmoji: "🎲",
    handle: "punter",
    blurb:
      "Cheap squad full of dark-horse picks from underrated nations.",
  },
  {
    id: "builder",
    email: "builder@lineuplab.demo",
    password: "demo-builder-2735",
    displayName: "The Builder",
    teamName: "Balanced XI",
    teamEmoji: "⚖️",
    handle: "builder",
    blurb:
      "Even spend across positions. Played the price engine straight.",
  },
] as const;

export type DemoPersonaId = (typeof DEMO_PERSONAS)[number]["id"];
