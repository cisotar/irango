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
  atualizarNomeEPreco,
  criarCategoria,
  atualizarCategoria,
  removerCategoria,
  alternarExibirImagens,
  reordenarCategorias,
  reordenarProdutos,
  aplicarFrequenciaEmProdutos,
  salvarGradeDeDias,
  alternarOcultaCategoria,
  definirFrequenciaCategoria,
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
  salvarOcultacoesOpcionais,
} from "@/lib/actions/opcional";
import { enviarFotoProduto } from "@/lib/actions/upload";
import {
  projetarPromocaoDoPainel,
  type PromocaoDoPainel,
} from "@/lib/utils/promocaoPainel";
import { rotuloFusoLoja } from "@/lib/utils/fusoLoja";
import { projetarFrequenciasDoPainel } from "@/lib/utils/frequenciaPainel";
import { ROTA_CARDAPIOS_LOJISTA } from "@/lib/utils/rotasCardapios";
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
    // [323] A leitura de cardápios SAIU (S5: o cardápio sazonal virou função
    // morta). A frequência mora nas colunas de `produtos` e `categorias` que
    // as duas primeiras leituras já trazem.
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

  // [323/C8] Chip e aviso de frequência por produto e o estado de cada
  // categoria, PROJETADOS AQUI com o MESMO `agora` do bloco acima e o fuso da
  // LOJA — o browser nunca decide "encerrado" nem "nunca abre".
  const frequencias = projetarFrequenciasDoPainel(
    produtos,
    categorias,
    agora,
    loja.timezone,
  );

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
      // [323/D11] O cardápio saiu da tela: sem índice de vínculos, sem
      // `sumicos` e sem `lote` (a barra de seleção passa a ser a de
      // frequência). A rota continua existindo, fora do menu (S5), e o
      // `FormProduto` só a usa no aviso do produto legado `'cardapio'`.
      vinculosPorProduto={{}}
      hrefCardapios={ROTA_CARDAPIOS_LOJISTA}
      frequencias={frequencias}
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
        atualizarNomeEPreco,
        enviarFotoProduto,
        criarCategoria,
        atualizarCategoria,
        removerCategoria,
        alternarExibirImagens,
        reordenarCategorias,
        reordenarProdutos,
        aplicarFrequenciaEmProdutos,
        salvarGradeDeDias,
        alternarOcultaCategoria,
        definirFrequenciaCategoria,
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
        salvarOcultacoesOpcionais,
      }}
    />
  );
}
