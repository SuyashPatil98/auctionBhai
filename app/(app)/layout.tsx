import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
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

  // For now, just use email prefix as display name.
  // Phase 1 will resolve to profiles.display_name.
  const displayName =
    user.user_metadata?.display_name ?? user.email?.split("@")[0] ?? null;

  return (
    <>
      <Nav displayName={displayName} />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
        {children}
      </main>
    </>
  );
}
