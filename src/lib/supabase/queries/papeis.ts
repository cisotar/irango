import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { ehPapel, type Papel } from "@/lib/utils/papeis";

/**
 * Queries de `papeis_usuario` (issue 332). Leitura via RLS (só as próprias
 * linhas); escrita SÓ pela RPC `atribuir_papel_inicial` (EXECUTE apenas para
 * service_role) — nunca INSERT direto. Ambas propagam `error` (o chamador
 * decide a mensagem genérica, seguranca.md §14) e descartam valor desconhecido.
 */
type Client = SupabaseClient<Database>;

/** Papéis do usuário. Usa o client da sessão (RLS escopa por `auth.uid()`). */
export async function buscarPapeisDoUsuario(
  client: Client,
  usuarioId: string,
): Promise<Papel[]> {
  const { data, error } = await client
    .from("papeis_usuario")
    .select("papel")
    .eq("usuario_id", usuarioId);
  if (error) throw error;
  return (data ?? []).map((l) => l.papel).filter(ehPapel);
}

/**
 * Grava `papel` só se a conta ainda não tem nenhum (lock no banco) e devolve
 * os papéis atuais. Exige o client service_role; `usuarioId` deve ser
 * autoritativo (sessão/signUp), nunca do payload.
 */
export async function atribuirPapelInicial(
  svc: Client,
  usuarioId: string,
  papel: Papel,
): Promise<Papel[]> {
  const { data, error } = await svc.rpc("atribuir_papel_inicial", {
    p_usuario_id: usuarioId,
    p_papel: papel,
  });
  if (error) throw error;
  return (data ?? []).filter(ehPapel);
}
