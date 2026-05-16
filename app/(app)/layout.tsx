import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { createClient } from "@/lib/supabase/server";
import { db } from "@/lib/db";
import { profiles } from "@/lib/db/schema";
import { Nav } from "@/components/layout/nav";

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

  return (
    <>
      <Nav displayName={displayName} />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
        {children}
      </main>
    </>
  );
}
