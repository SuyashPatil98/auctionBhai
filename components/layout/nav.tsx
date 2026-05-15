import Link from "next/link";
import { signOut } from "@/app/(auth)/login/actions";

const LINKS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/draft", label: "Draft" },
  { href: "/team", label: "Team" },
  { href: "/fixtures", label: "Fixtures" },
  { href: "/players", label: "Players" },
  { href: "/scouting/profiles", label: "Scouting" },
  { href: "/predictions", label: "Predictions" },
  { href: "/standings", label: "Standings" },
  { href: "/admin", label: "Admin" },
];

export function Nav({ displayName }: { displayName?: string | null }) {
  return (
    <header
      className="sticky top-0 z-30 border-b border-border/60 bg-background/60 backdrop-blur-xl supports-[backdrop-filter]:bg-background/50"
    >
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4">
        <div className="flex items-center gap-6">
          <Link
            href="/dashboard"
            className="flex items-center gap-2 font-bold tracking-tight text-base"
          >
            <span className="text-base">⚽</span>
            <span className="bg-gradient-to-r from-emerald-400 to-teal-300 bg-clip-text text-transparent">
              FiFantasy
            </span>
          </Link>
          <nav className="hidden md:flex items-center gap-0.5">
            {LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="px-2.5 py-1.5 text-sm text-muted-foreground hover:text-foreground hover:bg-muted/60 rounded-md transition"
              >
                {link.label}
              </Link>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-3">
          {displayName && (
            <span className="hidden sm:inline text-sm text-muted-foreground">
              {displayName}
            </span>
          )}
          <form action={signOut}>
            <button
              type="submit"
              className="text-xs text-muted-foreground hover:text-foreground transition"
            >
              Sign out
            </button>
          </form>
        </div>
      </div>
      {/* Mobile nav */}
      <nav className="md:hidden flex items-center gap-0 overflow-x-auto border-t border-border/60 px-2 py-1">
        {LINKS.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground whitespace-nowrap"
          >
            {link.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
