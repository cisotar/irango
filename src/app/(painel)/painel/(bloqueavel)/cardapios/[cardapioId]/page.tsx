import type { ReactElement } from "react";
import { notFound, redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { buscarLojaDoDono } from "@/lib/supabase/queries/lojas";
import {
  buscarCardapioPorId,
  buscarCardapiosComProdutos,
} from "@/lib/supabase/queries/cardapios";
import { buscarProdutosDoLojista } from "@/lib/supabase/queries/produtos";
import { buscarCategorias } from "@/lib/supabase/queries/categorias";
import {
  atualizarCardapio,
  aplicarCardapioEmProdutos,
  aplicarCardapioEmCategoria,
  tirarDeCardapio,
  preverLoteAction,
  definirDiasDoVinculo,
} from "@/lib/actions/cardapio";
import { definirVisibilidadeEmProdutos } from "@/lib/actions/produto";
import { horaLocalNoFuso, rotuloFusoLoja } from "@/lib/utils/fusoLoja";
import {
  rotuloAgora,
  descreverVigencia,
  rotuloDiasDoItem,
  avisoAgendaQueNuncaAbre,
} from "@/lib/utils/descreverVigencia";
import { fraseAgendaDoItem } from "@/lib/utils/copiaCardapioPainel";
import { cardapioAberto, visibilidadeDe } from "@/lib/utils/vigenciaCardapio";
import { ROTA_CARDAPIOS_LOJISTA } from "@/lib/utils/rotasCardapios";
import { VigenciaRecolhida } from "@/components/painel/VigenciaRecolhida";
import { CabecalhoPagina } from "@/components/painel/CabecalhoPagina";
import { Badge } from "@/components/ui/badge";
import { DetalheDoCardapio } from "@/components/painel/DetalheDoCardapio";
import type { ItemDoCardapio } from "@/components/painel/ItensDoCardapio";
import type { GrupoDoSheet } from "@/components/painel/SheetAdicionarItens";
import { formatarMoeda } from "@/lib/utils/formatarMoeda";

export const dynamic = "force-dynamic";

/**
 * [257][258][259] `/painel/cardapios/[cardapioId]` — Server Component.
 *
 * A linha "Agora:" da prévia é montada AQUI (design §9.4 item 3): ela é o
 * veredito de `cardapioAberto` no instante do request, com o fuso da loja.
 * Derivá-la do relógio do browser diria ao lojista algo que o cliente não vê.
 *
 * Id inexistente e id de outra loja caem no MESMO `notFound()` — a rota não
 * vira oráculo de existência (a autorização é a RLS mais o `.eq("loja_id")`).
 */
export default async function CardapioDetalhePage({
  params,
}: {
  params: Promise<{ cardapioId: string }>;
}): Promise<ReactElement> {
  const { cardapioId } = await params;
  const supabase = await createClient();

  const loja = await buscarLojaDoDono(supabase);
  if (loja == null) {
    redirect("/painel/onboarding");
  }

  const cardapio = await buscarCardapioPorId(supabase, loja.id, cardapioId);
  if (cardapio == null) notFound();

  const agora = new Date();

  // [260] A lista da loja inteira agrupada por categoria + quem já está neste
  // cardápio. Duas idas ao banco em paralelo, nenhuma por produto: o índice
  // `produto → vínculos` de `buscarCardapiosComProdutos` é o mesmo que a
  // vitrine consome, e é dele que sai `noCardapio`.
  const [produtos, categorias, { vinculosPorProduto }] = await Promise.all([
    buscarProdutosDoLojista(supabase, loja.id),
    buscarCategorias(supabase, loja.id),
    buscarCardapiosComProdutos(supabase, loja.id),
  ]);

  /**
   * [288] A loja INTEIRA agrupada por categoria — o insumo do SHEET de
   * adicionar. `noCardapio` sai do índice `produto → vínculos` que a vitrine já
   * consome; `precoRotulo` é projeção nova sobre dado que a página já tinha
   * (`buscarProdutosDoLojista`), não leitura nova.
   */
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

  /**
   * [288] Os itens DESTE cardápio — o objeto da página. Toda frase é REDIGIDA
   * aqui, no servidor, com o fuso da loja: o browser nunca redige janela de
   * vigência nem avalia dia.
   */
  const itens: ItemDoCardapio[] = produtos.flatMap((p) => {
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
        voltarHref={ROTA_CARDAPIOS_LOJISTA}
        voltarRotulo="Voltar para cardápios"
        titulo={cardapio.nome}
      >
        {/* O selo de estado, com a frase que o SERVIDOR escreveu. */}
        <Badge variant="secondary" className="whitespace-normal">
          {linhaAgora}
        </Badge>
      </CabecalhoPagina>

      <VigenciaRecolhida
        resumo={descreverVigencia(cardapio, loja.timezone, agora)}
        cardapio={cardapio}
        timezone={loja.timezone}
        fusoRotulo={rotuloFusoLoja(loja.timezone, agora)}
        agoraLocal={horaLocalNoFuso(agora.toISOString(), loja.timezone)}
        linhaAgora={linhaAgora}
        salvar={atualizarCardapio.bind(null, cardapioId)}
        voltarHref={ROTA_CARDAPIOS_LOJISTA}
      />

      <DetalheDoCardapio
        cardapio={{
          id: cardapio.id,
          nome: cardapio.nome,
          // A frase de vigência que a confirmação mostra — redigida no
          // SERVIDOR, com o fuso da loja (a mesma de `/painel/cardapios`).
          descricao: descreverVigencia(cardapio, loja.timezone, agora),
        }}
        itens={itens}
        grupos={grupos}
        hrefProdutos="/painel/produtos"
        // Não existe rota de EDIÇÃO de produto por id neste painel (o form
        // abre dentro de `/painel/produtos`): o item do kebab simplesmente não
        // é oferecido, em vez de virar um link que cai em 404.
        hrefEditarProduto={null}
        acoes={{
          aplicarEmProdutos: aplicarCardapioEmProdutos,
          aplicarEmCategoria: aplicarCardapioEmCategoria,
          tirarDeCardapio,
          preverLote: preverLoteAction,
          definirVisibilidade: definirVisibilidadeEmProdutos,
          definirDias: definirDiasDoVinculo,
        }}
      />
    </div>
  );
}
