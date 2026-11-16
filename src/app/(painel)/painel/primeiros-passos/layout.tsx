import type { ReactElement, ReactNode } from "react";
import { pendenciasPublicacao } from "@/lib/utils/publicacao";
import { etapasComPendencia } from "@/lib/utils/primeirosPassos";
import { exigirAssistente } from "./guard";
import { ProgressoAssistente } from "./ProgressoAssistente";

/**
 * Layout do assistente de primeiros passos (issue 368). FORA de `(bloqueavel)/`
 * (isenção posicional, D4): o gate de assinatura não roda aqui (D5). O guard
 * `exigirAssistente` manda loja já publicada para `/painel` e falha fechado
 * para `/login?erro=sessao`. O chrome mínimo vem do layout pai.
 *
 * O progresso parte só das pendências do gate (mesma `pendenciasPublicacao`
 * da retomada e da publicação). O layout não re-renderiza em navegação; as
 * telas reusadas chamam `router.refresh()` depois de salvar, o que atualiza os
 * selos "Falta".
 */
export default async function PrimeirosPassosLayout({
  children,
}: {
  children: ReactNode;
}): Promise<ReactElement> {
  const { estado } = await exigirAssistente();
  const pendentes = [...etapasComPendencia(pendenciasPublicacao(estado))];

  return (
    <div className="mx-auto w-full max-w-5xl gap-6 space-y-6 lg:grid lg:grid-cols-[15rem_1fr] lg:space-y-0">
      <aside className="lg:sticky lg:top-6 lg:self-start">
        <ProgressoAssistente pendentes={pendentes} />
      </aside>
      <div className="min-w-0 max-w-2xl space-y-6">{children}</div>
    </div>
  );
}
