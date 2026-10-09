import type { ReactElement } from "react";

import { montarLinhasModalSazonal } from "@/app/(painel)/painel/(bloqueavel)/configuracoes/promocoes/montarLinhasModalSazonal";

import { carregarPromocoesAdmin } from "../../carga-promocoes";
import { PromocoesAdminClient } from "./PromocoesAdminClient";

/**
 * O estado de cada aviso ("Ativo"/"Rascunho"/"Fora da janela") é AO VIVO: muda
 * com a passagem do tempo, não com a escrita de ninguém. Uma resposta cacheada
 * mostraria "Ativo" depois de a janela de exibição fechar. Daí `force-dynamic`
 * — o request é o relógio. Mesmo motivo da page do lojista.
 */
export const dynamic = "force-dynamic";

/**
 * [362] Sub-rota admin de AVISOS (modal sazonal) da loja-alvo —
 * `/admin/assinantes/[lojaId]/configuracoes/promocoes`. Server Component.
 *
 * A elevação a service_role e o guard de admin ficam no loader
 * (`carregarPromocoesAdmin`, que valida o `lojaId`, prova admin ANTES de elevar
 * e escopa as duas leituras por `loja_id`), nunca aqui.
 *
 * A montagem das linhas é a MESMA função da page do lojista
 * (`montarLinhasModalSazonal`): um único `agora` para a página inteira e
 * `lerMensagemModal` no parse fail-closed. Só fiação.
 */
export default async function PromocoesAdminPage({
  params,
}: {
  params: Promise<{ lojaId: string }>;
}): Promise<ReactElement> {
  const { lojaId } = await params;
  const { modais, categorias } = await carregarPromocoesAdmin(lojaId);

  const linhas = montarLinhasModalSazonal(modais, lojaId, new Date());

  return (
    <PromocoesAdminClient
      lojaId={lojaId}
      modais={linhas}
      categorias={categorias.map((c) => ({ id: c.id, nome: c.nome }))}
    />
  );
}
