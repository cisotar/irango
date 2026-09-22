"use client";

import { useState, type ReactElement } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useLoteDeProdutos } from "@/components/painel/useLoteDeProdutos";
import {
  ItensDoCardapio,
  type ItemDoCardapio,
} from "@/components/painel/ItensDoCardapio";
import {
  SheetAdicionarItens,
  type GrupoDoSheet,
} from "@/components/painel/SheetAdicionarItens";
import type {
  AcoesLote,
  CardapioParaLote,
} from "@/components/painel/contrato-lote";

/** A régua de `design-system.md` §5: valor LITERAL, nunca `min-h-11`. */
const ALVO = "min-h-[44px] min-w-[44px]";

export type DetalheDoCardapioProps = {
  cardapio: CardapioParaLote;
  /** Os itens DESTE cardápio — o objeto da página. */
  itens: ItemDoCardapio[];
  /** A loja INTEIRA agrupada por categoria, para o sheet. */
  grupos: GrupoDoSheet[];
  acoes: AcoesLote;
  /** Rotas INJETADAS: componente compartilhado não conhece rota. */
  hrefProdutos: string | null;
  hrefEditarProduto: ((produtoId: string) => string) | null;
};

/**
 * [288] A superfície única do detalhe do cardápio, montada pelos DOIS mundos
 * (painel do lojista e hub admin) com as mesmas props e as actions injetadas.
 *
 * É a partição do antigo `SeletorProdutosDoCardapio`, que fazia duas tarefas na
 * mesma tela: a lista de itens deste cardápio ficou na página
 * (`ItensDoCardapio`) e o checklist da loja inteira foi para o overlay
 * (`SheetAdicionarItens`).
 *
 * O `loteUI.dialogo` NÃO é renderizado aqui de propósito: a confirmação vive
 * DENTRO do sheet (D7), porque overlay sobre overlay é a armadilha de ESC que
 * `design-system.md` §6 registra.
 */
export function DetalheDoCardapio({
  cardapio,
  itens,
  grupos,
  acoes,
  hrefProdutos,
  hrefEditarProduto,
}: DetalheDoCardapioProps): ReactElement {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  /**
   * Trocar a chave do sheet ao concluir zera busca, seleção e escolha de dias.
   * Uma agenda herdada do lote anterior seria escrita sem intenção — o mesmo
   * cuidado que `useLoteDeProdutos` tem com `diasEscolhidos`.
   */
  const [versao, setVersao] = useState(0);

  const loteUI = useLoteDeProdutos(acoes, () => {
    setAberto(false);
    setVersao((v) => v + 1);
    router.refresh();
  });

  return (
    <>
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-heading text-lg font-semibold">
            {itens.length === 1
              ? "1 item no cardápio"
              : `${itens.length} itens no cardápio`}
          </h2>
          <Button
            type="button"
            className={ALVO}
            onClick={() => setAberto(true)}
          >
            Adicionar item
          </Button>
        </CardContent>
      </Card>

      <ItensDoCardapio
        cardapio={cardapio}
        itens={itens}
        acoes={acoes}
        hrefEditarProduto={hrefEditarProduto}
        onAdicionar={() => setAberto(true)}
        onTirar={(produtoId) =>
          // [D8] A remoção passa pelo MESMO ciclo do lote: prévia do servidor,
          // copy de `copiaLotePromocao.ts`, uma instrução só. Nenhuma contagem
          // e nenhuma frase nascem no cliente.
          loteUI.abrirCardapio("remover", cardapio, {
            tipo: "produtos",
            produto_ids: [produtoId],
          })
        }
        onMudou={() => router.refresh()}
      />

      <SheetAdicionarItens
        key={versao}
        cardapio={cardapio}
        grupos={grupos}
        aberto={aberto}
        onAbertoChange={setAberto}
        lote={loteUI}
        hrefProdutos={hrefProdutos}
      />

      {/* A confirmação da remoção, só com o sheet FECHADO: dentro dele a
          confirmação é um passo do próprio sheet, porque overlay sobre overlay
          é a armadilha de ESC que `design-system.md` §6 registra. */}
      {aberto ? null : loteUI.dialogo}
    </>
  );
}
