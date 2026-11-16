import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  buscarLojaDoDono,
  type LojaCompleta,
} from "@/lib/supabase/queries/lojas";
import { carregarProntidaoPublicacao } from "@/lib/supabase/queries/publicacao";
import { decidirPrimeirosPassos } from "@/lib/utils/acessoPainel";
import type { EstadoProntidao } from "@/lib/utils/publicacao";

export type ContextoAssistente = {
  supabase: Awaited<ReturnType<typeof createClient>>;
  loja: LojaCompleta;
  estado: EstadoProntidao;
};

type Leitura = { tipo: "erro" } | ({ tipo: "ok" } & ContextoAssistente);

/**
 * Uma leitura por requisição (layout + página compartilham via `cache`):
 * sessão → loja do dono (RLS) → estado de prontidão (contagens com
 * `eq("loja_id")`). Qualquer falha, sessão ou loja ausente → "erro".
 */
const lerAssistente = cache(async (): Promise<Leitura> => {
  try {
    const supabase = await createClient();
    const user = (await supabase.auth.getUser()).data.user;
    if (!user) return { tipo: "erro" };
    const loja = await buscarLojaDoDono(supabase);
    if (!loja) return { tipo: "erro" };
    const estado = await carregarProntidaoPublicacao(supabase, loja);
    return { tipo: "ok", supabase, loja, estado };
  } catch (e) {
    console.error("[guardAssistente]", e);
    return { tipo: "erro" };
  }
});

/**
 * Guard fail-closed do assistente de primeiros passos (issue 368, D4/D5).
 * Chamado pelo layout E por cada página da pasta (layout não re-renderiza em
 * navegação). Loja já publicada alguma vez → `/painel`. NÃO aplica
 * `decidirAssinatura` (D5): o assistente fica fora do paywall. `redirect` fica
 * fora do try (lança por design).
 */
export async function exigirAssistente(): Promise<ContextoAssistente> {
  const leitura = await lerAssistente();
  if (leitura.tipo === "erro") {
    redirect("/login?erro=sessao");
  }
  if (decidirPrimeirosPassos(leitura.loja) === "concluido") {
    redirect("/painel");
  }
  const { supabase, loja, estado } = leitura;
  return { supabase, loja, estado };
}
