import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { profiles } from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/server";
import AccountForms from "./AccountForms";

export const dynamic = "force-dynamic";

export const metadata = { title: "Account · FiFantasy" };

export default async function AccountPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [profile] = await db
    .select()
    .from(profiles)
    .where(eq(profiles.id, user.id))
    .limit(1);
  if (!profile) {
    // Trigger should always create one; this branch is a safety net.
    return (
      <div className="space-y-4 max-w-2xl">
        <h1 className="text-2xl font-semibold">Account</h1>
        <p className="text-sm text-muted-foreground">
          No profile row found for your auth user. This usually means the
          profile trigger didn&apos;t fire. Sign out and back in, or contact
          the commissioner.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-8 max-w-2xl">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Account</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Change your display name, team identity, handle, or password.
          Your email stays put — it&apos;s how the app knows it&apos;s you.
        </p>
      </div>

      <section className="rounded-lg border border-border bg-card p-5 space-y-2">
        <p className="text-xs uppercase tracking-widest text-muted-foreground">
          Signed in as
        </p>
        <p className="text-sm font-mono">{user.email}</p>
        <p className="text-xs text-muted-foreground">
          Email is fixed. To change it you&apos;d need a new account.
        </p>
      </section>

      <AccountForms
        initialProfile={{
          handle: profile.handle,
          displayName: profile.displayName,
          teamName: profile.teamName,
          teamEmoji: profile.teamEmoji,
          timezone: profile.timezone,
        }}
      />
    </div>
  );
}
