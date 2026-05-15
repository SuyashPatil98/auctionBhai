import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import RefreshPanel from "./RefreshPanel";

export const dynamic = "force-dynamic";

export const metadata = { title: "Admin · FiFantasy" };

export default async function AdminPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Admin</h1>
        <p className="text-sm text-muted-foreground mt-1">
          One button. Pulls any new data from football-data.org and recomputes
          everything downstream.
        </p>
      </div>
      <RefreshPanel />
    </div>
  );
}
