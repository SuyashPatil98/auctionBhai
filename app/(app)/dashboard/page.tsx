import { createClient } from "@/lib/supabase/server";

export const metadata = {
  title: "Dashboard · FiFantasy",
};

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          Signed in as {user?.email}.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card title="Tournament" body="World Cup 2026 — starts June 11." />
        <Card title="Format" body="Auction draft · 4 managers · 200 credits each." />
        <Card title="Phase" body="Phase 0 — Foundations." />
      </div>

      <div className="rounded-lg border border-dashed border-border p-6 text-sm text-muted-foreground">
        This dashboard is a placeholder. Phase 5 wires up the live ticker, your
        lineup for the current matchday, and the gap to the leader.
      </div>
    </div>
  );
}

function Card({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h2 className="text-xs uppercase tracking-wider text-muted-foreground">
        {title}
      </h2>
      <p className="mt-2 text-sm">{body}</p>
    </div>
  );
}
