import type { ReactElement } from "react";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { buscarLojaDoDono } from "@/lib/supabase/queries/lojas";
import { criarCardapio } from "@/lib/actions/cardapio";
import { horaLocalNoFuso, rotuloFusoLoja } from "@/lib/utils/fusoLoja";
import { ROTA_CARDAPIOS_LOJISTA } from "@/lib/utils/rotasCardapios";
import { FormVigencia } from "@/components/painel/FormVigencia";
import { CabecalhoPagina } from "@/components/painel/CabecalhoPagina";

export const dynamic = "force-dynamic";

/**
 * [257] Criação de cardápio — a MESMA rota própria do detalhe, em modo novo.
 * Não é modal: sete controles e uma prévia num `Dialog` de 360px nascem
 * quebrados (`design-system.md` §1).
 *
 * `agoraLocal` e o rótulo do fuso descem prontos do SERVIDOR, com o relógio do
 * servidor e o fuso da LOJA. A linha "Agora:" não existe aqui: ela só vale
 * para configuração SALVA (design §9.4).
 */
export default async function NovoCardapioPage(): Promise<ReactElement> {
  const supabase = await createClient();
  const loja = await buscarLojaDoDono(supabase);
  if (loja == null) {
    redirect("/painel/onboarding");
  }

  const agora = new Date();

  return (
    <div className="flex flex-col gap-4">
      <CabecalhoPagina
        voltarHref={ROTA_CARDAPIOS_LOJISTA}
        voltarRotulo="Voltar para cardápios"
        titulo="Novo cardápio"
      />
      <FormVigencia
        cardapio={null}
        timezone={loja.timezone}
        fusoRotulo={rotuloFusoLoja(loja.timezone, agora)}
        agoraLocal={horaLocalNoFuso(agora.toISOString(), loja.timezone)}
        linhaAgora={null}
        salvar={criarCardapio}
        voltarHref={ROTA_CARDAPIOS_LOJISTA}
      />
    </div>
  );
}
