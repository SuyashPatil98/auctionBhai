"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { DEMO_PERSONAS } from "@/lib/demo/personas";

export async function loginAsDemoPersona(formData: FormData) {
  if (process.env.NEXT_PUBLIC_SITE_MODE !== "demo") {
    redirect("/login?error=" + encodeURIComponent("Demo login is disabled"));
  }
  const personaId = String(formData.get("persona_id") ?? "");
  const persona = DEMO_PERSONAS.find((p) => p.id === personaId);
  if (!persona) {
    redirect("/welcome?error=" + encodeURIComponent("Unknown persona"));
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: persona.email,
    password: persona.password,
  });
  if (error) {
    redirect(
      "/welcome?error=" +
        encodeURIComponent(
          `Couldn't sign in (${error.message}). Demo data may not be seeded yet.`
        )
    );
  }
  redirect("/dashboard");
}
