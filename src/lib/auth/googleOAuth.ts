"use client";

import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";

export async function entrarComGoogle() {
  const supabase = createClient();
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: `${window.location.origin}/auth/callback` },
  });
  if (error) {
    console.error("[entrarComGoogle]", error);
    toast.error("Não foi possível entrar com o Google. Tente novamente.");
  }
}
