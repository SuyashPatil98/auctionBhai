import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Diagnostic endpoint — returns env-var presence + a real DB query result
 * (or the error if it fails) as plain JSON. Visit /api/health to see what's
 * actually breaking on the deployed instance without needing log access.
 *
 * Safe to leave in: no secrets are exposed (just presence checks and
 * sanitized error messages).
 */
export async function GET() {
  const env = {
    NEXT_PUBLIC_SUPABASE_URL: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    DATABASE_URL: !!process.env.DATABASE_URL,
    DATABASE_URL_host: process.env.DATABASE_URL
      ? (process.env.DATABASE_URL.match(/@([^/:]+)/)?.[1] ?? "unparseable")
      : null,
    DATABASE_URL_port: process.env.DATABASE_URL
      ? (process.env.DATABASE_URL.match(/:(\d+)\//)?.[1] ?? "unparseable")
      : null,
    ALLOWED_EMAILS: !!process.env.ALLOWED_EMAILS,
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL ?? null,
    NODE_ENV: process.env.NODE_ENV,
  };

  let dbResult: unknown = null;
  let dbError: { message: string; code?: string } | null = null;

  try {
    const { db } = await import("@/lib/db");
    const { profiles } = await import("@/lib/db/schema");
    const rows = await db.select({ id: profiles.id }).from(profiles).limit(1);
    dbResult = { ok: true, rowCount: rows.length };
  } catch (e: unknown) {
    const err = e as { message?: string; code?: string; stack?: string };
    dbError = {
      message: err.message ?? String(e),
      code: err.code,
    };
  }

  return NextResponse.json(
    { env, db: dbResult, dbError, timestamp: new Date().toISOString() },
    { status: 200 }
  );
}
