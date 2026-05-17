import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { createClient } from "@/lib/supabase/server";
import { db } from "@/lib/db";
import { profiles } from "@/lib/db/schema";
import { Nav } from "@/components/layout/nav";
import { GUEST_EMAIL } from "@/lib/util/guest";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // Read display name from the canonical profiles table — this is the
  // value the user can edit on /account, so the nav reflects their changes.
  // Fallback chain handles the brief window before the profile trigger
  // fires on first signup.
  const [profile] = await db
    .select({ displayName: profiles.displayName, teamEmoji: profiles.teamEmoji })
    .from(profiles)
    .where(eq(profiles.id, user.id))
    .limit(1);

  const displayName =
    profile?.displayName ??
    user.user_metadata?.display_name ??
    user.email?.split("@")[0] ??
    null;

  const isGuest = user.email === GUEST_EMAIL;

  return (
    <>
      {isGuest && (
        <div className="w-full bg-gradient-to-r from-emerald-500/15 via-emerald-500/10 to-emerald-500/15 border-b border-emerald-500/30 text-xs">
          <div className="mx-auto max-w-6xl px-4 py-1.5 flex items-center justify-between gap-3 flex-wrap">
            <span className="text-muted-foreground">
              <span className="rounded-md bg-emerald-500/25 text-emerald-700 dark:text-emerald-400 px-1.5 py-0.5 font-semibold tracking-wider uppercase text-[10px] mr-2">
                👁 Guest
              </span>
              You&apos;re viewing as a read-only guest. Mutations (bidding,
              lineup edits, trades) are disabled.
            </span>
            <a
              href="https://github.com/SuyashPatil98/auctionBhai"
              target="_blank"
              rel="noreferrer"
              className="text-muted-foreground hover:text-foreground transition"
            >
              GitHub →
            </a>
          </div>
        </div>
      )}
      <Nav displayName={displayName} />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
        {children}
      </main>
    </>
  );
}
