import { cache, type ReactNode, type ReactElement } from "react";
import { redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import {
  buscarLojaDoDono,
  type LojaCompleta,
} from "@/lib/supabase/queries/lojas";
import { decidirAssinatura } from "@/lib/utils/acessoPainel";

// Dedup do I/O de loja no request (o layout pai também busca). `cache` fora de um
// render de RSC apenas repassa a chamada (não lança) — comportamento seguro.
const buscarLojaCache = cache(buscarLojaDoDono);

/**
 * Gate de assinatura POSICIONAL (issue 142). Server Component aninhado que
 * envolve APENAS as telas sob `(bloqueavel)/`. Não decide sessão/email/loja
 * (isso é do layout pai) nem renderiza chrome — só aplica `decidirAssinatura`.
 *
 * A isenção do paywall passa a ser estrutura de filesystem: `assinatura-bloqueada/`
 * e `configuracoes/assinatura/` ficam FORA deste grupo, logo nunca são gated —
 * imune a header de rota forjado (classe CVE-2025-29927).
 *
 * Fail-closed (§14): todo I/O de sessão/loja em try/catch → `/login?erro=sessao`;
 * detalhe só no `console.error`, nunca ao cliente.
 */
export default async function BloqueavelLayout({
  children,
}: {
  children: ReactNode;
}): Promise<ReactElement | ReactNode> {
  let loja: LojaCompleta | null;
  try {
    const supabase = await createClient();
    const user: User | null = (await supabase.auth.getUser()).data.user;
    loja = user ? await buscarLojaCache(supabase) : null;
  } catch (e) {
    console.error("[gateAssinatura]", e);
    redirect("/login?erro=sessao");
  }

  // Loja ausente aqui é anômalo (o layout pai já gateia sessão/email/loja antes
  // de chegar neste grupo). Postura fail-closed: nunca renderiza sem loja.
  if (loja === null) {
    redirect("/login?erro=sessao");
  }

  if (decidirAssinatura(loja, new Date()) === "assinatura-bloqueada") {
    redirect("/painel/assinatura-bloqueada");
  }

  // Liberado: children CRU — o chrome (Sidebar/Topbar) vem do layout pai.
  return children;
}
