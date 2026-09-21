import type { ReactElement } from "react";

import { carregarLojaAdmin } from "../carga";
import { carregarOpcionaisAdmin } from "../carga-opcionais";
import { carregarCardapiosAdmin } from "../carga-cardapios";
import {
  projetarPromocaoDoPainel,
  type PromocaoDoPainel,
} from "@/lib/utils/promocaoPainel";
import { rotuloFusoLoja } from "@/lib/utils/fusoLoja";
import { cardapioAberto } from "@/lib/utils/vigenciaCardapio";
import { descreverVigencia } from "@/lib/utils/descreverVigencia";
import type {
  CardapioParaLote,
  CardapiosPorProduto,
} from "@/components/painel/contrato-lote";
import { CardapioAdminClient } from "./CardapioAdminClient";

/**
 * Rota Produtos (Cardápio) do hub admin (issue 100/143). Server Component.
 *
 * Carrega o agregado da loja-alvo via `carregarLojaAdmin` (096, loja/slug +
 * categorias + produtos) e os opcionais escopados via `carregarOpcionaisAdmin`
 * (132, opcionaisPorCategoria + categoriasOpcional) em `Promise.all`. Ambos
 * validam o `lojaId` (UUID), re-provam admin ANTES de elevar a service_role e
 * escopam todas as queries por `lojaId`. Passa loja/categorias/produtos +
 * opcionais reais ao wrapper client, que reusa o `ProdutosClient` do painel
 * (097) injetando as actions admin (088/089/090/135) com o `lojaId` fixado.
 *
 * O cabeçalho, as abas e o guard de admin vêm do `layout.tsx`.
 */
export default async function CardapioAdminPage({
  params,
}: {
  params: Promise<{ lojaId: string }>;
}): Promise<ReactElement> {
  const { lojaId } = await params;
  const [
    { loja, categorias, produtos },
    // [217] `opcionais` e `associacoes` NÃO são query nova: o agregado já as
    // carregava (carga-opcionais.ts) — a page só não as desestruturava.
    { opcionaisPorCategoria, categoriasOpcional, opcionais, associacoes },
    // [Auditoria 260/261] Leitura dos cardápios da loja-alvo. Sem ela o
    // `FormProduto` afirmaria "não está em nenhum cardápio" para um produto que
    // está em dois — e o admin escreve sob `service_role`.
    cardapiosDaLoja,
  ] = await Promise.all([
    carregarLojaAdmin(lojaId),
    carregarOpcionaisAdmin(lojaId),
    carregarCardapiosAdmin(lojaId),
  ]);

  // [235] Mesma projeção do painel do lojista, com o fuso da LOJA-ALVO: o admin
  // edita em nome do lojista e não pode ver "vigente agora" por outro relógio.
  const agora = new Date();
  const promocoes: Record<string, PromocaoDoPainel> = Object.fromEntries(
    produtos.map((p) => [
      p.id,
      projetarPromocaoDoPainel(p, agora, loja.timezone),
    ]),
  );

  // [269] Os destinos da barra de seleção em lote, com a frase de vigência
  // redigida AQUI (servidor, fuso da loja-alvo) — o browser nunca redige janela
  // de vigência. Mesma projeção de `/painel/produtos`.
  const cardapiosDoLote: CardapioParaLote[] = cardapiosDaLoja.cardapios.map(
    (c) => ({
      id: c.id,
      nome: c.nome,
      descricao: descreverVigencia(c, loja.timezone, agora),
    }),
  );

  // O MESMO `agora` do bloco acima e o fuso da LOJA-ALVO: o admin edita em nome
  // do lojista e não pode ver "aberto agora" por outro relógio.
  const cardapiosPorProduto: CardapiosPorProduto = Object.fromEntries(
    [...cardapiosDaLoja.cardapiosPorProduto].map(([produtoId, lista]) => [
      produtoId,
      lista.map((c) => ({
        id: c.id,
        nome: c.nome,
        abertoAgora: cardapioAberto(c, agora, loja.timezone),
      })),
    ]),
  );

  return (
    <CardapioAdminClient
      lojaSlug={loja.slug}
      lojaId={loja.id}
      produtos={produtos}
      categorias={categorias.map((c) => ({
        id: c.id,
        nome: c.nome,
        exibir_imagens: c.exibir_imagens,
      }))}
      opcionaisPorCategoria={opcionaisPorCategoria}
      cardapiosDoLote={cardapiosDoLote}
      cardapiosPorProduto={cardapiosPorProduto}
      promocoes={promocoes}
      fusoLojaRotulo={rotuloFusoLoja(loja.timezone, agora)}
      // Linhas INTEIRAS desde a 217 — o cartão de associação exige
      // `CategoriaOpcional` completa, não mais o par `{id, nome}`.
      categoriasOpcional={categoriasOpcional}
      opcionais={opcionais}
      // Shape estreito, como a `opcionais/page.tsx` do admin já faz. `ordem`
      // (208) vai junto: é ela que abre a lista na sequência gravada.
      associacoes={associacoes.map((a) => ({
        categoria_id: a.categoria_id,
        categoria_opcional_id: a.categoria_opcional_id,
        ordem: a.ordem,
      }))}
    />
  );
}
