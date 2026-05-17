"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { GUEST_EMAIL, GUEST_PASSWORD } from "@/lib/util/guest";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD = 8;

function getAllowedEmails(): string[] {
  return (process.env.ALLOWED_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

function isEmailAllowed(email: string): boolean {
  const allowed = getAllowedEmails();
  return allowed.length === 0 || allowed.includes(email);
}

function backToSignIn(error: string): never {
  redirect(`/login?error=${encodeURIComponent(error)}`);
}

function backToSignUp(error: string): never {
  redirect(`/login?mode=signup&error=${encodeURIComponent(error)}`);
}

/**
 * One-click sign-in as the shared "Guest viewer" account. Anyone with
 * the URL can use this. The guest user is NOT in league_members, so
 * the requireLeagueMember() gate on every mutation makes them
 * read-only by construction — they can view everything but mutate
 * nothing.
 */
export async function signInAsGuest() {
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: GUEST_EMAIL,
    password: GUEST_PASSWORD,
  });
  if (error) {
    backToSignIn(
      `Guest sign-in unavailable (${error.message}). The guest user may not be seeded yet.`
    );
  }
  redirect("/dashboard");
}

export async function signInWithPassword(formData: FormData) {
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const password = String(formData.get("password") ?? "");

  if (!EMAIL_RE.test(email)) {
    backToSignIn("Enter a valid email address.");
  }
  if (!password) {
    backToSignIn("Enter your password.");
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    backToSignIn(
      error.message.includes("Invalid login credentials")
        ? "Wrong email or password."
        : error.message
    );
  }

  redirect("/dashboard");
}

export async function signUpWithPassword(formData: FormData) {
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const password = String(formData.get("password") ?? "");
  const displayName = String(formData.get("display_name") ?? "").trim();
  const teamName = String(formData.get("team_name") ?? "").trim();
  const teamEmoji = String(formData.get("team_emoji") ?? "").trim();

  if (!EMAIL_RE.test(email)) {
    backToSignUp("Enter a valid email address.");
  }
  if (!isEmailAllowed(email)) {
    backToSignUp("This email is not in the league allowlist.");
  }
  if (password.length < MIN_PASSWORD) {
    backToSignUp(`Password must be at least ${MIN_PASSWORD} characters.`);
  }
  if (!displayName) {
    backToSignUp("Enter a display name.");
  }

  const handleSeed = email.split("@")[0].toLowerCase().replace(/[^a-z0-9_]/g, "");
  const handle = handleSeed || `user${Math.floor(Math.random() * 10000)}`;

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      // Picked up by the on_auth_user_created trigger to seed public.profiles
      data: {
        handle,
        display_name: displayName,
        team_name: teamName || null,
        team_emoji: teamEmoji || null,
      },
    },
  });

  if (error) {
    backToSignUp(
      error.message.includes("already registered")
        ? "An account with this email already exists. Try signing in."
        : error.message
    );
  }

  // If email confirmation is enabled in Supabase, session will be null here.
  // We can't auto-sign-in until they click the confirm link.
  if (!data.session) {
    redirect(
      `/login?sent=1&email=${encodeURIComponent(
        email
      )}&message=${encodeURIComponent(
        "Check your inbox to confirm your email, then sign in."
      )}`
    );
  }

  redirect("/dashboard");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
