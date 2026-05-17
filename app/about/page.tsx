import Link from "next/link";

export const metadata = {
  title: "About — LineUp Lab",
};

export default function AboutPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-10 space-y-10">
      <header className="space-y-3">
        <p className="text-xs uppercase tracking-[0.3em] text-emerald-500">
          About the project
        </p>
        <h1 className="text-3xl font-bold tracking-tight">
          A private fantasy app, built for 4 friends, deployed for everyone
        </h1>
        <p className="text-base text-muted-foreground leading-relaxed">
          <strong className="text-foreground">FiFantasy</strong> is a custom
          fantasy-football league for the FIFA World Cup 2026, built end-to-end
          for myself and three friends. <strong className="text-foreground">LineUp Lab</strong>{" "}
          is a public demo of the same codebase, pre-seeded with four
          fictional managers so anyone can click through the app.
        </p>
        <div className="flex flex-wrap gap-3 text-xs">
          <a
            href="https://github.com/SuyashPatil98/auctionBhai"
            target="_blank"
            rel="noreferrer"
            className="rounded-md border border-border bg-card hover:bg-muted px-3 py-1.5 transition"
          >
            View source on GitHub →
          </a>
          <Link
            href="/welcome"
            className="rounded-md border border-emerald-500/40 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 px-3 py-1.5 transition"
          >
            Try the demo →
          </Link>
        </div>
      </header>

      <Section title="What it does">
        <Bullet>
          <strong>Auction-style draft.</strong> Live realtime room. Bid timer
          with anti-snipe, proxy max-bids, pause/resume by commissioner,
          opt-out passing.
        </Bullet>
        <Bullet>
          <strong>Layered player rating engine.</strong> Combines a position
          baseline + age curves, market value from Transfermarkt (47k players
          fuzzy-matched), a Gemini Flash Layer-3 pass for the top 316
          candidates, and an international-pedigree bump.
        </Bullet>
        <Bullet>
          <strong>Personal scouting profiles.</strong> Each manager builds
          their own rating formula from 21 weighted factors (geometric mean
          with soft floor). Locked at draft start, revealed in the recap.
        </Bullet>
        <Bullet>
          <strong>Bracket Monte Carlo + price engine.</strong> 10k Elo-driven
          tournament sims feed a price model (rating × P(starter) × expected
          matches), normalized so the top 80 equal four 200-credit budgets.
        </Bullet>
        <Bullet>
          <strong>Matchday scoring.</strong> Position-relative points
          (FPL-tuned), captain ×2, vice ×1.5 if captain plays 0&apos;, bench
          auto-substitution by position, idempotent score sweep that
          re-runs after any stat or MOTM change.
        </Bullet>
        <Bullet>
          <strong>Steward stat entry.</strong> Auto-imports lineups, goals,
          cards and minutes from football-data.org with one click. Steward
          just verifies + adds the bits the API can&apos;t see (own goals,
          pen misses, pen saves).
        </Bullet>
        <Bullet>
          <strong>MOTM peer vote.</strong> 24-hour window after stats are
          finalized. Self-vote allowed. Ties split the +3 bonus.
        </Bullet>
        <Bullet>
          <strong>Weekly trading window.</strong> Every Tuesday: sell-back
          (50% refund), free-agent sealed-bid auction, direct
          manager-to-manager trades with credit balancing. Locked at the
          knockout stage.
        </Bullet>
        <Bullet>
          <strong>Realtime everywhere.</strong> Supabase Realtime push so
          leaderboards, lineups, bids and trades update across browsers
          without refresh.
        </Bullet>
        <Bullet>
          <strong>Timezone-aware.</strong> Pin a timezone in /account or
          fall back to the browser&apos;s detected zone. Fixture times
          render correctly for everyone.
        </Bullet>
      </Section>

      <Section title="Stack">
        <Stack
          rows={[
            ["Framework", "Next.js 16 (App Router, Turbopack, Server Actions)"],
            ["Language", "TypeScript"],
            ["Styling", "Tailwind v4 + custom dark-first theme"],
            ["Database", "Supabase Postgres (Mumbai)"],
            ["ORM", "Drizzle (raw SQL where needed)"],
            ["Auth", "Supabase Auth (email + password)"],
            ["Realtime", "Supabase Realtime (postgres_changes)"],
            ["AI", "Gemini 2.5 Flash Lite (rating Layer 3 + planned Smart Search)"],
            ["Data sources", "football-data.org (fixtures + stats), Transfermarkt CSV (market value), FBref Kaggle (performance stats)"],
            ["Hosting", "Vercel (Hobby tier · pinned bom1 region)"],
            ["Package manager", "pnpm 11"],
          ]}
        />
      </Section>

      <Section title="Design principles">
        <Bullet>
          <strong>Empirical, not generative.</strong> Every rating + price
          shows its breakdown. Auction state machine + scoring engine are
          pure functions with unit tests, not vibes.
        </Bullet>
        <Bullet>
          <strong>Transparent over secure.</strong> Built for 4 trusted
          friends — write actions gate on league membership, but every page
          shows everyone every number. Trust is the access-control model.
        </Bullet>
        <Bullet>
          <strong>Subtle AI.</strong> Only one feature uses generative AI
          (the rating Layer-3 pass), and even then the output is cached and
          inspectable. No daily-recap fluff.
        </Bullet>
        <Bullet>
          <strong>Polished where it counts.</strong> The draft, lineup and
          matchday flows have invested UX (formation picker, pitch view,
          captain/vice badges, realtime tickers). Admin tooling is plainer
          on purpose.
        </Bullet>
      </Section>

      <Section title="Why this and not just FPL?">
        <p className="text-sm text-muted-foreground leading-relaxed">
          FPL exists. We didn&apos;t want it for our group of 4. We wanted
          an auction draft (so squads diverge meaningfully), peer MOTM votes
          (so the trash-talk has teeth), a steward rotation (so nobody&apos;s
          stuck inputting stats every match), and a weekly trading window
          (so the meta keeps shifting). Off-the-shelf doesn&apos;t do any
          of this; building it ourselves does. Plus it was a good excuse
          to build something real with Next.js&nbsp;16 + Supabase Realtime.
        </p>
      </Section>

      <footer className="pt-6 border-t border-border space-y-2 text-xs text-muted-foreground">
        <p>
          Built by{" "}
          <a
            href="https://github.com/SuyashPatil98"
            target="_blank"
            rel="noreferrer"
            className="text-foreground hover:underline"
          >
            Suyash Patil
          </a>
          . If you&apos;re hiring, the source is on GitHub and the demo is
          one click away.
        </p>
        <p>
          The private friends-only deployment runs at{" "}
          <a
            href="https://auction-bhai.vercel.app"
            target="_blank"
            rel="noreferrer"
            className="hover:underline"
          >
            auction-bhai.vercel.app
          </a>
          . You&apos;re seeing the same codebase here, with seed data instead
          of real league data.
        </p>
      </footer>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </h2>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

function Bullet({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-sm leading-relaxed pl-4 border-l-2 border-emerald-500/30">
      {children}
    </p>
  );
}

function Stack({ rows }: { rows: Array<[string, string]> }) {
  return (
    <dl className="grid sm:grid-cols-[10rem_1fr] gap-x-4 gap-y-1 text-sm">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted-foreground">{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}
