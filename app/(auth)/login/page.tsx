import Link from "next/link";
import { signInWithPassword, signUpWithPassword } from "./actions";

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
      <div className="space-y-2 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">FiFantasy</h1>
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
