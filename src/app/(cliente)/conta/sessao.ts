import "server-only";
import { redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { buscarPapeisDoUsuario } from "@/lib/supabase/queries/papeis";
import { buscarPerfilCliente, type PerfilCliente } from "@/lib/supabase/queries/clientes";
import { sanitizarNext } from "@/lib/utils/sanitizarNext";
import type { Papel } from "@/lib/utils/papeis";

/** `searchParams` do Next pode trazer string[]; só a 1ª ocorrência vale. */
export function primeiro(valor: string | string[] | undefined): string | undefined {
  return Array.isArray(valor) ? valor[0] : valor;
}

/**
 * `/conta/entrar` e `/conta/cadastro` com sessão (e-mail confirmado) →
 * `next` sanitizado ou `/minha-conta` (o guard decide dali). Falha de leitura
 * = trata como sem sessão (a tela abre; nada sensível nela).
 */
export async function redirecionarSeLogado(next: string | undefined): Promise<void> {
  let logado = false;
  try {
    const supabase = await createClient();
    const { data } = await supabase.auth.getUser();
    logado = !!data.user?.email_confirmed_at;
  } catch (e) {
    console.error("[conta] sessao", e instanceof Error ? e.name : "erro");
  }
  if (logado) redirect(sanitizarNext(next) ?? "/minha-conta");
}

export type SessaoCliente =
  | { tipo: "sem-sessao" }
  | { tipo: "nao-confirmado" }
  | {
      tipo: "ok";
      supabase: Awaited<ReturnType<typeof createClient>>;
      user: User;
      papeis: Papel[];
      perfil: PerfilCliente | null;
    };

/**
 * Leitura base da sessão do cliente (guard de /minha-conta e /conta/completar):
 * sem sessão; e-mail não confirmado → signOut (decisão 18 — em Server Component
 * os cookies podem não ser regravados, mas o GoTrue revoga a sessão); senão
 * papéis (SEMPRE da tabela, via RLS, nunca do JWT) e perfil. Erros propagam:
 * cada chamador decide o fail-closed.
 */
export async function lerSessaoCliente(): Promise<SessaoCliente> {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return { tipo: "sem-sessao" };
  const user = data.user;
  if (!user.email_confirmed_at) {
    await supabase.auth.signOut();
    return { tipo: "nao-confirmado" };
  }
  const [papeis, perfil] = await Promise.all([
    buscarPapeisDoUsuario(supabase, user.id),
    buscarPerfilCliente(supabase, user.id),
  ]);
  return { tipo: "ok", supabase, user, papeis, perfil };
}
