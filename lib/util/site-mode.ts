/**
 * Site mode — distinguishes the private 4-friend deployment ("auction-bhai")
 * from the public portfolio demo ("LineUp Lab").
 *
 * Set via Vercel environment variable NEXT_PUBLIC_SITE_MODE.
 *   - "private" (default) → real friends-only app
 *   - "demo"              → portfolio showcase, anyone can land + click
 *                          through pre-seeded data as a fake manager
 *
 * Both modes share the same codebase. Behaviour differences:
 *   - demo mode shows a top banner ("Portfolio demo — data resets...")
 *   - demo mode replaces /login with a "pick a manager" landing page
 *   - demo mode allows the one-click demo sign-in flow (4 known
 *     fake-user credentials in seed-demo.ts)
 *
 * Why NEXT_PUBLIC_*: we need the value on the client (for the banner +
 * the welcome-page branching), not just the server.
 */

export type SiteMode = "private" | "demo";

export function siteMode(): SiteMode {
  const raw = process.env.NEXT_PUBLIC_SITE_MODE;
  return raw === "demo" ? "demo" : "private";
}

export const IS_DEMO = siteMode() === "demo";
