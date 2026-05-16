"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { profiles } from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/server";

async function requireAuthedProfile(): Promise<string> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return user.id;
}

/**
 * Update profile fields (everything except email). Email is the auth
 * primary key and changes to it require an email confirmation flow we
 * don't want to deal with for a 4-friend app.
 */
export async function updateProfile(formData: FormData) {
  const profileId = await requireAuthedProfile();

  const displayName = String(formData.get("display_name") ?? "").trim();
  const teamName = String(formData.get("team_name") ?? "").trim();
  const teamEmoji = String(formData.get("team_emoji") ?? "").trim();
  const handleRaw = String(formData.get("handle") ?? "").trim();

  if (!displayName) throw new Error("display name is required");
  if (displayName.length > 40) {
    throw new Error("display name too long (40 max)");
  }
  if (teamName && teamName.length > 40) {
    throw new Error("team name too long (40 max)");
  }
  // Emoji input usually a single grapheme; allow up to 4 chars (some emojis
  // are zwj sequences > 1 codepoint).
  if (teamEmoji && [...teamEmoji].length > 4) {
    throw new Error("emoji too long");
  }

  // Handle is lowercased and slugified; uniqueness enforced at DB level.
  const handle = handleRaw
    ? handleRaw
        .toLowerCase()
        .replace(/[^a-z0-9_-]/g, "")
        .slice(0, 32)
    : null;
  if (handle && handle.length < 3) {
    throw new Error("handle must be at least 3 characters (a-z, 0-9, _, -)");
  }

  const updates: Record<string, string | null> = {
    displayName,
    teamName: teamName || null,
    teamEmoji: teamEmoji || null,
  };
  if (handle) updates.handle = handle;

  try {
    await db
      .update(profiles)
      .set(updates)
      .where(eq(profiles.id, profileId));
  } catch (e: unknown) {
    // Unique-violation on handle = a sibling claimed it
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.toLowerCase().includes("unique") || msg.includes("23505")) {
      throw new Error("that handle is taken — pick another");
    }
    throw e;
  }

  revalidatePath("/account");
  revalidatePath("/dashboard");
  revalidatePath("/team");
  revalidatePath("/draft");
}

/**
 * Update the auth user's password. Supabase requires re-auth for
 * password changes; we use the session client which has that context.
 */
export async function changePassword(formData: FormData) {
  await requireAuthedProfile();
  const newPassword = String(formData.get("new_password") ?? "");
  const confirmPassword = String(formData.get("confirm_password") ?? "");

  if (newPassword.length < 8) {
    throw new Error("password must be at least 8 characters");
  }
  if (newPassword !== confirmPassword) {
    throw new Error("passwords don't match");
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({
    password: newPassword,
  });
  if (error) throw new Error(error.message);

  revalidatePath("/account");
}
