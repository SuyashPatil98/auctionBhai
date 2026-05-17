import Link from "next/link";

/**
 * Persistent top strip on the demo deployment ("LineUp Lab"). Tells
 * visitors what they're looking at and gives them a path back to the
 * person who built it. Server component — zero JS.
 *
 * Only rendered in demo mode (callers check siteMode() first).
 */

export function DemoBanner() {
  return (
    <div className="w-full bg-gradient-to-r from-amber-500/15 via-amber-500/10 to-amber-500/15 border-b border-amber-500/30 text-xs">
      <div className="mx-auto max-w-6xl px-4 py-1.5 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="rounded-md bg-amber-500/25 text-amber-700 dark:text-amber-300 px-1.5 py-0.5 font-semibold tracking-wider uppercase text-[10px]">
            Demo
          </span>
          <span className="text-muted-foreground">
            You&apos;re in <strong className="text-foreground">LineUp Lab</strong>
            , a portfolio demo. Data resets nightly. Sign in as any of 4
            personas from the{" "}
            <Link
              href="/welcome"
              className="underline-offset-2 hover:underline text-foreground"
            >
              welcome page
            </Link>
            .
          </span>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/about"
            className="text-muted-foreground hover:text-foreground transition"
          >
            About
          </Link>
          <a
            href="https://github.com/SuyashPatil98/auctionBhai"
            target="_blank"
            rel="noreferrer"
            className="text-muted-foreground hover:text-foreground transition"
          >
            GitHub
          </a>
        </div>
      </div>
    </div>
  );
}
