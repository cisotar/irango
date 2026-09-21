import type { ReactElement } from "react";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { buscarLojaDoDono } from "@/lib/supabase/queries/lojas";
import {
  buscarProdutosDoLojista,
  buscarOpcionaisPorCategoria,
} from "@/lib/supabase/queries/produtos";
import { buscarCategorias } from "@/lib/supabase/queries/categorias";
import {
  buscarCategoriasOpcional,
  buscarOpcionaisDoLojista,
  buscarAssociacoesOpcional,
} from "@/lib/supabase/queries/opcionais";
import {
  removerProduto,
  alternarDisponibilidade,
  alternarOculto,
  criarProduto,
  atualizarProduto,
  criarCategoria,
  atualizarCategoria,
  removerCategoria,
  alternarExibirImagens,
  reordenarCategorias,
} from "@/lib/actions/produto";
import {
  criarCategoriaOpcional,
  atualizarCategoriaOpcional,
  removerCategoriaOpcional,
  criarOpcional,
  atualizarOpcional,
  alternarOpcionalAtivo,
  removerOpcional,
  salvarAssociacaoOpcionais,
  reordenarOpcionaisDaCategoria,
  reordenarItensDoGrupoOpcional,
} from "@/lib/actions/opcional";
import { enviarFotoProduto } from "@/lib/actions/upload";
import {
  projetarPromocaoDoPainel,
  type PromocaoDoPainel,
} from "@/lib/utils/promocaoPainel";
import { rotuloFusoLoja } from "@/lib/utils/fusoLoja";
import { buscarCardapiosComProdutos } from "@/lib/supabase/queries/cardapios";
import { descreverVigencia } from "@/lib/utils/descreverVigencia";
import { cardapioAberto } from "@/lib/utils/vigenciaCardapio";
import {
  diagnosticarSumico,
  type SumicoDoProduto,
} from "@/lib/utils/contarProdutosEscondidos";
import {
  aplicarCardapioEmProdutos,
  aplicarCardapioEmCategoria,
  tirarDeCardapio,
  preverLoteAction,
} from "@/lib/actions/cardapio";
import { definirVisibilidadeEmProdutos } from "@/lib/actions/produto";
import type { CardapiosPorProduto } from "@/components/painel/contrato-lote";
import { ProdutosClient } from "./ProdutosClient";

/**
 * Página de gestão de produtos do lojista (issue 044). Server Component.
 *
 * Todo o I/O usa o client AUTENTICADO — a RLS (`produtos_leitura_propria` /
 * `categorias`) isola por dono. `loja_id` é derivado da loja do dono, nunca de
 * input do cliente. Sem loja → redireciona ao onboarding/perfil. As mutações
 * acontecem via Server Actions (issue 031) disparadas pelo `ProdutosClient`.
 */
export default async function ProdutosPage(): Promise<ReactElement> {
  const supabase = await createClient();

  const loja = await buscarLojaDoDono(supabase);
  if (loja == null) {
    redirect("/painel/onboarding");
  }

  // `buscarOpcionaisPorCategoria` precisa dos ids já resolvidos de
  // `buscarCategorias`, então as duas rodam em sequência dentro do mesmo ramo do
  // `Promise.all`, preservando o paralelismo com `buscarProdutosDoLojista`.
  // [217] O 4º e o 5º ramos alimentam o cartão de associação que o modal desta
  // página monta. Não dá para derivá-los de `opcionaisPorCategoria`:
  // `buscarOpcionaisPorCategoria` traz um sub-select estreito (sem `ativo`,
  // `loja_id`, `descricao`) e — pior — DESCARTA grupo associado que ainda não
  // tem item. Um grupo vazio que abrisse desmarcado seria apagado em silêncio no
  // primeiro toggle de qualquer outro grupo, porque o toggle grava o conjunto
  // inteiro. A fonte de verdade é `categoria_produto_opcionais`, lida aqui EM
  // PARALELO — a latência da página não sobe.
  const [
    produtos,
    { categorias, opcionaisPorCategoria },
    categoriasOpcional,
    opcionais,
    associacoes,
    // [260][261] Os cardápios da loja + o índice `produto → cardápios`, no
    // MESMO round trip que a vitrine usa (`buscarCardapiosComProdutos`). Nada
    // de query nova por produto: um `count` por linha seria N+1.
    cardapiosDaLoja,
  ] = await Promise.all([
    buscarProdutosDoLojista(supabase, loja.id),
    (async () => {
      const categorias = await buscarCategorias(supabase, loja.id);
      const opcionaisPorCategoria = await buscarOpcionaisPorCategoria(
        supabase,
        categorias.map((c) => c.id),
      );
      return { categorias, opcionaisPorCategoria };
    })(),
    buscarCategoriasOpcional(supabase, loja.id),
    buscarOpcionaisDoLojista(supabase, loja.id),
    buscarAssociacoesOpcional(supabase, loja.id),
    buscarCardapiosComProdutos(supabase, loja.id),
  ]);

  // [235] Vigência da promoção e rótulo do chip PROJETADOS AQUI, no servidor.
  // Um único `agora` para a página inteira (duas linhas nunca discordam sobre
  // que instante é este) e o fuso da LOJA, não o do dispositivo — derivar isso
  // no `ProdutosClient` duplicaria RN-03 e usaria o relógio do cliente.
  const agora = new Date();
  const promocoes: Record<string, PromocaoDoPainel> = Object.fromEntries(
    produtos.map((p) => [
      p.id,
      projetarPromocaoDoPainel(p, agora, loja.timezone),
    ]),
  );

  // [260][261] As duas projeções de cardápio do painel, derivadas AQUI com o
  // relógio do SERVIDOR e o fuso da LOJA — o mesmo `agora` do bloco acima, para
  // que nenhuma linha da tela discorde sobre que instante é este. Decidir
  // "aberto agora" no browser usaria o relógio do dispositivo, que a loja não
  // controla, e duplicaria RN-02..RN-05.
  const cardapiosParaLote = cardapiosDaLoja.cardapios.map((c) => ({
    id: c.id,
    nome: c.nome,
    descricao: descreverVigencia(c, loja.timezone, agora),
  }));
  const cardapiosPorProduto: CardapiosPorProduto =
    Object.fromEntries(
      [...cardapiosDaLoja.cardapiosPorProduto].map(([produtoId, lista]) => [
        produtoId,
        lista.map((c) => ({
          id: c.id,
          nome: c.nome,
          abertoAgora: cardapioAberto(c, agora, loja.timezone),
        })),
      ]),
    );

  // [264/RN-12] O aviso reduzido da linha do produto (design §13.4 item 5). O
  // MESMO predicado da tela de cardápios — um produto não pode estar sumido
  // numa e presente na outra —, derivado no servidor com o fuso da loja.
  // Só entra no mapa o produto que de fato sumiu: o objeto é esparso de
  // propósito, e uma linha sem entrada não pinta aviso nenhum.
  const sumicos: Record<string, SumicoDoProduto> = {};
  for (const p of produtos) {
    const sumico = diagnosticarSumico(
      p,
      cardapiosDaLoja.cardapiosPorProduto.get(p.id) ?? [],
      agora,
      loja.timezone,
    );
    if (sumico !== null) sumicos[p.id] = sumico;
  }

  return (
    <ProdutosClient
      lojaSlug={loja.slug}
      lojaId={loja.id}
      produtos={produtos}
      categorias={categorias.map((c) => ({
        id: c.id,
        nome: c.nome,
        exibir_imagens: c.exibir_imagens,
      }))}
      opcionaisPorCategoria={opcionaisPorCategoria}
      promocoes={promocoes}
      fusoLojaRotulo={rotuloFusoLoja(loja.timezone, agora)}
      // [261] LEITURA, não ação: vive fora do `lote` porque o hub admin também
      // a recebe (o `FormProduto` depende dela para não mentir sobre cardápio).
      cardapiosPorProduto={cardapiosPorProduto}
      // A rota de cardápios é conhecida AQUI, não no componente: no painel do
      // lojista ela existe; no hub admin, não (o wrapper admin passa `null`).
      hrefCardapios="/painel/cardapios"
      // [264] LEITURA, preview de UX: o produto que sumiu da vitrine e o
      // cardápio a quem o sumiço é atribuído. Nenhuma decisão depende disto.
      sumicos={sumicos}
      // [260][261] O modo de seleção só existe no painel do LOJISTA: estas
      // Server Actions derivam a loja de `auth.uid()` e não têm variante
      // admin (ver a prop `lote` do `ProdutosClient`).
      lote={{
        cardapios: cardapiosParaLote,
        acoes: {
          aplicarEmProdutos: aplicarCardapioEmProdutos,
          aplicarEmCategoria: aplicarCardapioEmCategoria,
          tirarDeCardapio,
          preverLote: preverLoteAction,
          definirVisibilidade: definirVisibilidadeEmProdutos,
        },
      }}
      // [217] Linhas INTEIRAS, não mais `{id, nome}`: o cartão de associação
      // consome `CategoriaOpcional` completa.
      categoriasOpcional={categoriasOpcional}
      opcionais={opcionais}
      // `ordem` (208) vai junto: é ela que abre a lista na sequência gravada.
      // `buscarAssociacoesOpcional` já ordena.
      associacoes={associacoes.map((a) => ({
        categoria_id: a.categoria_id,
        categoria_opcional_id: a.categoria_opcional_id,
        ordem: a.ordem,
      }))}
      // Actions do LOJISTA passadas explicitamente (issue 160): `acoes` é
      // obrigatória, sem default — a via admin injeta as variantes por `lojaId`.
      acoes={{
        removerProduto,
        alternarDisponibilidade,
        alternarOculto,
        criarProduto,
        atualizarProduto,
        enviarFotoProduto,
        criarCategoria,
        atualizarCategoria,
        removerCategoria,
        alternarExibirImagens,
        reordenarCategorias,
        criarCategoriaOpcional,
        atualizarCategoriaOpcional,
        removerCategoriaOpcional,
        criarOpcional,
        atualizarOpcional,
        alternarOpcionalAtivo,
        removerOpcional,
        salvarAssociacaoOpcionais,
        reordenarOpcionaisDaCategoria,
        reordenarItensDoGrupoOpcional,
      }}
    />
  );
}
