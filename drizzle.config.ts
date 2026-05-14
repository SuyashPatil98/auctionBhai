import { defineConfig } from "drizzle-kit";
import { config } from "dotenv";

// Load .env.local (Next.js convention) before .env, so local overrides win.
// drizzle-kit runs outside Next.js, so it doesn't auto-load these.
config({ path: ".env.local" });
config({ path: ".env" });

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error(
    "DATABASE_URL is not set. Add it to .env.local (Supabase → Connect → Direct connection or Transaction pooler URL with your db password)."
  );
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./lib/db/schema/index.ts",
  out: "./lib/db/migrations",
  dbCredentials: { url },
  strict: true,
  verbose: true,
  schemaFilter: ["public"],
});
