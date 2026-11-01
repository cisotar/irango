import type { createClient } from "@/lib/supabase/server";
import { ehSessaoDeRecuperacao } from "@/lib/utils/sessaoRecuperacao";

type ClienteSupabase = Awaited<ReturnType<typeof createClient>>;

/**
 * `true` só com sessão válida (`getUser()`, consulta o GoTrue) aberta pelo link
 * de recuperação (`amr` com `recovery`, achado P18). Recebe o client para a
 * action trocar a senha com a mesma sessão. Exceção propaga: quem chama decide.
 */
export async function temSessaoDeRecuperacao(supabase: ClienteSupabase): Promise<boolean> {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return false;
  const { data: claims, error: erroClaims } = await supabase.auth.getClaims();
  return !erroClaims && !!claims && ehSessaoDeRecuperacao(claims.claims.amr);
}
