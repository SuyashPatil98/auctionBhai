import Link from "next/link";
import { signInAsGuest, signInWithPassword, signUpWithPassword } from "./actions";

export const metadata = {
  title: "Sign in · FiFantasy",
};

type SearchParams = Promise<{
  mode?: string;
  error?: string;
  sent?: string;
  email?: string;
  message?: string;
}>;

const FIELD_INPUT =
  "w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { mode, error, sent, email, message } = await searchParams;
  const isSignup = mode === "signup";

  if (sent) {
    return (
      <div className="space-y-4 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">Almost there</h1>
        <p className="text-sm text-muted-foreground">
          {message ??
            "Check your inbox to confirm your email, then come back to sign in."}
        </p>
        {email && (
          <p className="text-xs text-muted-foreground">
            Sent to{" "}
            <span className="font-medium text-foreground">{email}</span>
          </p>
        )}
        <p className="text-xs text-muted-foreground pt-4">
          <Link href="/login" className="underline">
            Back to sign in
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-3 text-center">
        <div className="inline-block">
          <div className="text-5xl">⚽</div>
        </div>
        <h1 className="text-3xl font-bold tracking-tight">
          <span className="bg-gradient-to-br from-emerald-600 via-emerald-500 to-teal-400 bg-clip-text text-transparent">
            FiFantasy
          </span>
        </h1>
        <p className="text-sm text-muted-foreground">
          World Cup 2026 · 4-manager private league
        </p>
      </div>

      <div className="flex rounded-md border border-border p-0.5 text-sm">
        <Link
          href="/login"
          className={`flex-1 rounded-sm px-3 py-1.5 text-center transition ${
            !isSignup
              ? "bg-secondary text-secondary-foreground font-medium"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Sign in
        </Link>
        <Link
          href="/login?mode=signup"
          className={`flex-1 rounded-sm px-3 py-1.5 text-center transition ${
            isSignup
              ? "bg-secondary text-secondary-foreground font-medium"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Create account
        </Link>
      </div>

      {isSignup ? (
        <SignUpForm />
      ) : (
        <SignInForm />
      )}

      {error && (
        <p className="text-sm text-destructive text-center">{error}</p>
      )}

      {!isSignup && (
        <>
          <div className="flex items-center gap-3 text-[10px] uppercase tracking-widest text-muted-foreground">
            <span className="flex-1 h-px bg-border" />
            <span>or</span>
            <span className="flex-1 h-px bg-border" />
          </div>

          <form action={signInAsGuest}>
            <button
              type="submit"
              className="w-full rounded-md border border-emerald-500/40 bg-emerald-500/10 hover:bg-emerald-500/20 px-3 py-2 text-sm font-medium text-emerald-700 dark:text-emerald-400 transition-all hover:scale-[1.02]"
            >
              👁 View as Guest
            </button>
            <p className="text-[11px] text-muted-foreground text-center mt-2">
              Read-only access — explore the league without an invite.
            </p>
          </form>
        </>
      )}

      <p className="text-xs text-muted-foreground text-center">
        Only allowlisted emails can create accounts.
      </p>
    </div>
  );
}

function SignInForm() {
  return (
    <form action={signInWithPassword} className="space-y-3">
      <label className="block space-y-1.5">
        <span className="text-sm font-medium">Email</span>
        <input
          type="email"
          name="email"
          required
          autoComplete="email"
          autoFocus
          placeholder="you@example.com"
          className={FIELD_INPUT}
        />
      </label>

      <label className="block space-y-1.5">
        <span className="text-sm font-medium">Password</span>
        <input
          type="password"
          name="password"
          required
          autoComplete="current-password"
          placeholder="••••••••"
          className={FIELD_INPUT}
        />
      </label>

      <button
        type="submit"
        className="w-full rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 transition"
      >
        Sign in
      </button>
    </form>
  );
}

function SignUpForm() {
  return (
    <form action={signUpWithPassword} className="space-y-3">
      <label className="block space-y-1.5">
        <span className="text-sm font-medium">Email</span>
        <input
          type="email"
          name="email"
          required
          autoComplete="email"
          autoFocus
          placeholder="you@example.com"
          className={FIELD_INPUT}
        />
      </label>

      <label className="block space-y-1.5">
        <span className="text-sm font-medium">Password</span>
        <input
          type="password"
          name="password"
          required
          minLength={8}
          autoComplete="new-password"
          placeholder="At least 8 characters"
          className={FIELD_INPUT}
        />
      </label>

      <label className="block space-y-1.5">
        <span className="text-sm font-medium">Display name</span>
        <input
          type="text"
          name="display_name"
          required
          maxLength={40}
          placeholder="Suyash"
          className={FIELD_INPUT}
        />
      </label>

      <div className="grid grid-cols-[1fr_5rem] gap-2">
        <label className="block space-y-1.5">
          <span className="text-sm font-medium">Team name</span>
          <input
            type="text"
            name="team_name"
            maxLength={40}
            placeholder="The Inevitables"
            className={FIELD_INPUT}
          />
        </label>
        <label className="block space-y-1.5">
          <span className="text-sm font-medium">Emoji</span>
          <input
            type="text"
            name="team_emoji"
            maxLength={4}
            placeholder="⚡"
            className={`${FIELD_INPUT} text-center`}
          />
        </label>
      </div>

      <button
        type="submit"
        className="w-full rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 transition"
      >
        Create account
      </button>
    </form>
  );
}
