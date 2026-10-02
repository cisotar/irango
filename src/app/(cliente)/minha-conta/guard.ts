import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import type { PerfilCliente } from "@/lib/supabase/queries/clientes";
import { lerSessaoCliente } from "../conta/sessao";
import type { Papel } from "@/lib/utils/papeis";

export type ClienteAutenticado = {
  supabase: Awaited<ReturnType<typeof createClient>>;
  user: User;
  perfil: PerfilCliente;
  papeis: Papel[];
};

type Leitura =
  | { tipo: "sem-sessao" }
  | { tipo: "nao-confirmado" }
  | { tipo: "incompleto" }
  | { tipo: "erro" }
  | ({ tipo: "ok" } & ClienteAutenticado);

/** Uma leitura por requisição (layout + página compartilham via `cache`). */
const lerCliente = cache(async (): Promise<Leitura> => {
  try {
    const sessao = await lerSessaoCliente();
    if (sessao.tipo !== "ok") return sessao;
    const { supabase, user, papeis, perfil } = sessao;
    if (!papeis.includes("cliente") || !perfil) return { tipo: "incompleto" };
    return { tipo: "ok", supabase, user, perfil, papeis };
  } catch (e) {
    console.error("[guardMinhaConta]", e instanceof Error ? e.name : "erro");
    return { tipo: "erro" };
  }
});

/**
 * Guard fail-closed da área logada (spec "Minha conta"), na ordem: sem sessão →
 * `/conta/entrar?next=<rota>`; e-mail não confirmado → signOut + entrar com a
 * mensagem da decisão 18; sem papel `cliente` ou sem perfil → `/conta/completar`;
 * erro de leitura → `/conta/entrar?erro=sessao`. Chamado pelo layout E por cada
 * página (layout não re-renderiza em navegação client-side — guia de auth do
 * Next 16). `redirect` fica fora do try (lança por design).
 */
export async function exigirCliente(rota: string): Promise<ClienteAutenticado> {
  const leitura = await lerCliente();
  switch (leitura.tipo) {
    case "sem-sessao":
      redirect(`/conta/entrar?${new URLSearchParams({ next: rota }).toString()}`);
    case "nao-confirmado":
      redirect("/conta/entrar?erro=confirme");
    case "incompleto":
      redirect("/conta/completar");
    case "erro":
      redirect("/conta/entrar?erro=sessao");
    case "ok": {
      const { supabase, user, perfil, papeis } = leitura;
      return { supabase, user, perfil, papeis };
    }
  }
}
