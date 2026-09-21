import type { ReactElement } from "react";
import Link from "next/link";

import { carregarCardapioDetalheAdmin } from "../../carga-cardapio-detalhe";
import { horaLocalNoFuso, rotuloFusoLoja } from "@/lib/utils/fusoLoja";
import {
  rotuloAgora,
  descreverVigencia,
  rotuloDiasDoItem,
  avisoAgendaQueNuncaAbre,
} from "@/lib/utils/descreverVigencia";
import { fraseAgendaDoItem } from "@/lib/utils/copiaCardapioPainel";
import { cardapioAberto, visibilidadeDe } from "@/lib/utils/vigenciaCardapio";
import { rotaCardapiosAdmin } from "@/lib/utils/rotasCardapios";
import type { GrupoDoSeletor } from "@/components/painel/SeletorProdutosDoCardapio";
import { CardapioDetalheAdminClient } from "./CardapioDetalheAdminClient";

export const dynamic = "force-dynamic";

/**
 * [269 · fase 6] `/admin/assinantes/[lojaId]/cardapios/[cardapioId]` — o gêmeo
 * admin de `/painel/cardapios/[cardapioId]`. Server Component.
 *
 * As projeções são as MESMAS funções puras da rota do lojista, com o relógio do
 * SERVIDOR e o fuso da LOJA-ALVO. Id inexistente e id de outra loja caem no
 * MESMO `notFound()` do loader — a rota não vira oráculo de existência.
 */
export default async function CardapioDetalheAdminPage({
  params,
}: {
  params: Promise<{ lojaId: string; cardapioId: string }>;
}): Promise<ReactElement> {
  const { lojaId, cardapioId } = await params;
  const { loja, cardapio, produtos, categorias, vinculosPorProduto } =
    await carregarCardapioDetalheAdmin(lojaId, cardapioId);

  const agora = new Date();

  const grupos: GrupoDoSeletor[] = [
    ...categorias.map((categoria) => ({
      id: categoria.id as string | null,
      nome: categoria.nome,
      produtos: produtos.filter((p) => p.categoria_id === categoria.id),
    })),
    {
      id: null,
      nome: "Sem categoria",
      produtos: produtos.filter((p) => p.categoria_id == null),
    },
  ]
    .filter((grupo) => grupo.produtos.length > 0)
    .map((grupo) => ({
      id: grupo.id,
      nome: grupo.nome,
      produtos: grupo.produtos.map((p) => {
        // [276] O vínculo com ESTE cardápio, achado uma vez: dele saem
        // `noCardapio`, os dias do item, a frase da linha e o aviso de RN-06 —
        // os três REDIGIDOS aqui, no servidor, com o fuso da loja. O browser
        // nunca redige janela de vigência nem avalia dia.
        const vinculo =
          (vinculosPorProduto.get(p.id) ?? []).find(
            (v) => v.cardapio.id === cardapioId,
          ) ?? null;
        return {
          id: p.id,
          nome: p.nome,
          // Estreitamento FAIL-OPEN de D14, o mesmo da vitrine (247/D6).
          exclusivo: visibilidadeDe(p) === "cardapio",
          noCardapio: vinculo !== null,
          dias: vinculo?.dias_semana ?? null,
          fraseAgenda:
            vinculo === null
              ? null
              : fraseAgendaDoItem(rotuloDiasDoItem(vinculo.dias_semana)),
          avisoNuncaAbre:
            vinculo === null ? null : avisoAgendaQueNuncaAbre(vinculo),
        };
      }),
    }));

  return (
    <div className="flex flex-col gap-4">
      <Link href={rotaCardapiosAdmin(loja.id)} className="text-sm underline">
        Voltar para cardápios
      </Link>
      <h1 className="text-xl font-semibold">{cardapio.nome}</h1>
      <CardapioDetalheAdminClient
        lojaId={loja.id}
        cardapioId={cardapio.id}
        cardapio={cardapio}
        timezone={loja.timezone}
        fusoRotulo={rotuloFusoLoja(loja.timezone, agora)}
        agoraLocal={horaLocalNoFuso(agora.toISOString(), loja.timezone)}
        linhaAgora={rotuloAgora(
          agora,
          loja.timezone,
          cardapioAberto(cardapio, agora, loja.timezone),
        )}
        cardapioDoLote={{
          id: cardapio.id,
          nome: cardapio.nome,
          // A frase de vigência do diálogo de confirmação — redigida no
          // SERVIDOR, com o fuso da loja-alvo.
          descricao: descreverVigencia(cardapio, loja.timezone, agora),
        }}
        grupos={grupos}
      />
    </div>
  );
}
