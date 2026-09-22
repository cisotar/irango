import type { ReactElement } from "react";

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
import type { ItemDoCardapio } from "@/components/painel/ItensDoCardapio";
import type { GrupoDoSheet } from "@/components/painel/SheetAdicionarItens";
import { formatarMoeda } from "@/lib/utils/formatarMoeda";
import { Badge } from "@/components/ui/badge";
import { CardapioDetalheAdminClient } from "./CardapioDetalheAdminClient";
import { CabecalhoPagina } from "@/components/painel/CabecalhoPagina";

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

  /** [288] Espelho EXATO da projeção do lojista — mesmas funções puras. */
  const grupos: GrupoDoSheet[] = [
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
      produtos: grupo.produtos.map((p) => ({
        id: p.id,
        nome: p.nome,
        noCardapio: (vinculosPorProduto.get(p.id) ?? []).some(
          (v) => v.cardapio.id === cardapioId,
        ),
        precoRotulo: formatarMoeda(p.preco),
      })),
    }));

  const nomeDaCategoria = new Map(categorias.map((c) => [c.id, c.nome]));

  const itens: ItemDoCardapio[] = produtos.flatMap((p) => {
    // [276] O vínculo com ESTE cardápio, achado uma vez: dele saem os dias, a
    // frase da linha e o aviso de RN-06 — os três REDIGIDOS aqui, no servidor,
    // com o fuso da LOJA-ALVO.
    const vinculo =
      (vinculosPorProduto.get(p.id) ?? []).find(
        (v) => v.cardapio.id === cardapioId,
      ) ?? null;
    if (vinculo === null) return [];
    return [
      {
        id: p.id,
        nome: p.nome,
        // Estreitamento FAIL-OPEN de D14, o mesmo da vitrine (247/D6).
        exclusivo: visibilidadeDe(p) === "cardapio",
        dias: vinculo.dias_semana ?? null,
        fraseAgenda: fraseAgendaDoItem(rotuloDiasDoItem(vinculo.dias_semana)),
        avisoNuncaAbre: avisoAgendaQueNuncaAbre(vinculo),
        precoRotulo: formatarMoeda(p.preco),
        categoriaNome:
          p.categoria_id == null
            ? null
            : (nomeDaCategoria.get(p.categoria_id) ?? null),
      },
    ];
  });

  const linhaAgora = rotuloAgora(
    agora,
    loja.timezone,
    cardapioAberto(cardapio, agora, loja.timezone),
  );

  return (
    <div className="flex flex-col gap-4">
      <CabecalhoPagina
        voltarHref={rotaCardapiosAdmin(loja.id)}
        voltarRotulo="Voltar para cardápios"
        titulo={cardapio.nome}
      >
        <Badge variant="secondary" className="whitespace-normal">
          {linhaAgora}
        </Badge>
      </CabecalhoPagina>
      <CardapioDetalheAdminClient
        lojaId={loja.id}
        cardapioId={cardapio.id}
        cardapio={cardapio}
        timezone={loja.timezone}
        fusoRotulo={rotuloFusoLoja(loja.timezone, agora)}
        agoraLocal={horaLocalNoFuso(agora.toISOString(), loja.timezone)}
        linhaAgora={linhaAgora}
        resumoVigencia={descreverVigencia(cardapio, loja.timezone, agora)}
        cardapioDoLote={{
          id: cardapio.id,
          nome: cardapio.nome,
          // A frase de vigência da confirmação — redigida no SERVIDOR, com o
          // fuso da loja-alvo.
          descricao: descreverVigencia(cardapio, loja.timezone, agora),
        }}
        itens={itens}
        grupos={grupos}
      />
    </div>
  );
}
