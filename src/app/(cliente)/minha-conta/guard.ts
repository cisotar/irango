import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { buscarPapeisDoUsuario } from "@/lib/supabase/queries/papeis";
import { buscarPerfilCliente, type PerfilCliente } from "@/lib/supabase/queries/clientes";
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
    const supabase = await createClient();
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) return { tipo: "sem-sessao" };
    const user = data.user;
    if (!user.email_confirmed_at) {
      // Decisão 18: encerra a sessão. Em Server Component os cookies podem não
      // ser regravados, mas o GoTrue revoga a sessão (getUser passa a falhar).
      await supabase.auth.signOut();
      return { tipo: "nao-confirmado" };
    }
    // Papéis SEMPRE da tabela (RLS), nunca do JWT/metadata.
    const [papeis, perfil] = await Promise.all([
      buscarPapeisDoUsuario(supabase, user.id),
      buscarPerfilCliente(supabase, user.id),
    ]);
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
