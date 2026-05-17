/**
 * Constants for the shared "View as Guest" Supabase user.
 *
 * Kept separate from lib/util/guest.ts (which has `import "server-only"`)
 * so plain Node scripts like `scripts/seed-guest.ts` can read these
 * without pulling in Next.js runtime helpers.
 *
 * Credentials are PUBLIC by design — they're how the demo sign-in works.
 */

export const GUEST_EMAIL = "guest@auction-bhai.demo";
export const GUEST_PASSWORD = "guest-view-only-9d3f81";
