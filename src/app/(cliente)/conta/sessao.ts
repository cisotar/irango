import "server-only";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { sanitizarNext } from "@/lib/utils/sanitizarNext";

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
