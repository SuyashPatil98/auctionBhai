import { signInWithEmail } from "./actions";

export const metadata = {
  title: "Sign in · FiFantasy",
};

type SearchParams = Promise<{
  error?: string;
  sent?: string;
  email?: string;
}>;

export default async function LoginPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { error, sent, email } = await searchParams;

  if (sent) {
    return (
      <div className="space-y-4 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">
          Check your email
        </h1>
        <p className="text-sm text-muted-foreground">
          We sent a magic link to{" "}
          <span className="font-medium text-foreground">{email}</span>.
          <br />
          Click it to sign in.
        </p>
        <p className="text-xs text-muted-foreground pt-4">
          Didn&apos;t get it?{" "}
          <a href="/login" className="underline">
            Try again
          </a>
          .
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">
          FiFantasy
        </h1>
        <p className="text-sm text-muted-foreground">
          World Cup 2026 · 4-manager private league
        </p>
      </div>

      <form action={signInWithEmail} className="space-y-3">
        <label className="block space-y-1.5">
          <span className="text-sm font-medium">Email</span>
          <input
            type="email"
            name="email"
            required
            autoComplete="email"
            autoFocus
            placeholder="you@example.com"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </label>

        <button
          type="submit"
          className="w-full rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 transition"
        >
          Send magic link
        </button>
      </form>

      {error && (
        <p className="text-sm text-destructive text-center">{error}</p>
      )}

      <p className="text-xs text-muted-foreground text-center">
        Only allowlisted emails can sign in.
      </p>
    </div>
  );
}
