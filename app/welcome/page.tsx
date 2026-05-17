import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { siteMode } from "@/lib/util/site-mode";
import { DEMO_PERSONAS } from "@/lib/demo/personas";
import { loginAsDemoPersona } from "./actions";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "LineUp Lab — pick a manager",
};

export default async function WelcomePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  // Outside demo mode this page is meaningless — bounce to /login.
  if (siteMode() !== "demo") {
    redirect("/login");
  }

  // Already signed in → dashboard
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) redirect("/dashboard");

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-10 bg-gradient-to-br from-emerald-950/40 via-background to-zinc-950">
      <div className="w-full max-w-3xl space-y-8">
        <header className="text-center space-y-3">
          <p className="text-xs uppercase tracking-[0.3em] text-emerald-500">
            Portfolio demo
          </p>
          <h1 className="text-4xl sm:text-5xl font-bold tracking-tight">
            <span className="bg-gradient-to-r from-emerald-400 via-teal-300 to-emerald-400 bg-clip-text text-transparent">
              LineUp Lab
            </span>
          </h1>
          <p className="text-base text-muted-foreground max-w-xl mx-auto">
            A working demo of FiFantasy — a private fantasy-football app
            built for the WC 2026. Pick a manager below to one-click sign
            in and explore the app from their perspective. Data resets
            nightly.
          </p>
          <div className="flex items-center justify-center gap-3 text-xs">
            <Link
              href="/about"
              className="text-muted-foreground hover:text-foreground underline-offset-2 hover:underline transition"
            >
              About the project →
            </Link>
            <span className="text-muted-foreground/40">·</span>
            <a
              href="https://github.com/SuyashPatil98/auctionBhai"
              target="_blank"
              rel="noreferrer"
              className="text-muted-foreground hover:text-foreground underline-offset-2 hover:underline transition"
            >
              GitHub
            </a>
          </div>
        </header>

        {error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive text-center">
            {error}
          </div>
        )}

        <div className="grid sm:grid-cols-2 gap-3">
          {DEMO_PERSONAS.map((p) => (
            <form key={p.id} action={loginAsDemoPersona}>
              <input type="hidden" name="persona_id" value={p.id} />
              <button
                type="submit"
                className="w-full text-left rounded-2xl border border-border bg-card p-5 hover:bg-card/80 hover:border-emerald-500/40 hover:shadow-lg hover:shadow-emerald-500/10 transition-all hover:-translate-y-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/50"
              >
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center text-2xl ring-2 ring-border">
                    {p.teamEmoji}
                  </div>
                  <div className="min-w-0">
                    <p className="font-semibold tracking-tight">
                      {p.displayName}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {p.teamName}
                    </p>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {p.blurb}
                </p>
                <p className="mt-3 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                  Sign in as {p.displayName.split(" ")[1]} →
                </p>
              </button>
            </form>
          ))}
        </div>

        <p className="text-center text-[10px] uppercase tracking-widest text-muted-foreground/60">
          Building real things requires real data. Click around — every
          page is functional. Nothing here is mocked.
        </p>
      </div>
    </div>
  );
}
