"use client";

import { useMemo, useState, type ReactElement } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { useLoteDeProdutos } from "@/components/painel/useLoteDeProdutos";
import type {
  AcoesLote,
  CardapioParaLote,
} from "@/components/painel/contrato-lote";

/** A régua de `design-system.md` §5: valor LITERAL, nunca `min-h-11`. */
const ALVO = "min-h-[44px] min-w-[44px]";

export type ProdutoDoSeletor = {
  id: string;
  nome: string;
  /** [261] D14 — `visibilidade = 'cardapio'`, já estreitado no servidor. */
  exclusivo: boolean;
  /** Já vinculado a ESTE cardápio. */
  noCardapio: boolean;
};

export type GrupoDoSeletor = {
  id: string | null;
  nome: string;
  produtos: ProdutoDoSeletor[];
};

export type SeletorProdutosDoCardapioProps = {
  cardapio: CardapioParaLote;
  /** Lista da loja INTEIRA agrupada por categoria, montada no servidor. */
  grupos: GrupoDoSeletor[];
  acoes: AcoesLote;
};

/**
 * [260][261] `SeletorProdutosDoCardapio` — a segunda superfície da ação em
 * lote (spec, §Detalhe do cardápio).
 *
 * 🔴 Compartilha as MESMAS Server Actions e o MESMO diálogo de alcance da barra
 * de `/painel/produtos` (RN-09), via `useLoteDeProdutos`. Não há um segundo
 * caminho de escrita nem uma segunda redação de confirmação.
 *
 * "Categoria inteira" aqui é `aplicarEmCategoria`, a RPC da issue 250: a
 * expansão acontece DENTRO da transação (RN-10). Ler os produtos da categoria
 * em JS para reenviar a lista seria a janela TOCTOU que a RPC existe para
 * fechar — e é por isso que este botão não é açúcar para "Selecionar os N".
 */
export function SeletorProdutosDoCardapio({
  cardapio,
  grupos,
  acoes,
}: SeletorProdutosDoCardapioProps): ReactElement {
  const router = useRouter();
  const [selecionados, setSelecionados] = useState<ReadonlySet<string>>(
    () => new Set(),
  );

  const loteUI = useLoteDeProdutos(acoes, () => {
    setSelecionados(new Set());
    router.refresh();
  });

  /** Derivada da lista renderizada, nunca o `Set` cru (ver `ProdutosClient`). */
  const lista = useMemo(
    () =>
      grupos
        .flatMap((g) => g.produtos)
        .filter((p) => selecionados.has(p.id))
        .map((p) => p.id),
    [grupos, selecionados],
  );

  function alternar(id: string): void {
    setSelecionados((atual) => {
      const proximo = new Set(atual);
      if (proximo.has(id)) proximo.delete(id);
      else proximo.add(id);
      return proximo;
    });
  }

  function selecionarGrupo(ids: string[]): void {
    setSelecionados((atual) => new Set([...atual, ...ids]));
  }

  function limparGrupo(ids: string[]): void {
    setSelecionados((atual) => {
      const proximo = new Set(atual);
      for (const id of ids) proximo.delete(id);
      return proximo;
    });
  }

  const vazia = lista.length === 0;
  const inerte = vazia || loteUI.prevendo;

  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-heading text-lg font-semibold">
        Produtos deste cardápio
      </h2>

      {/* A mesma forma da barra de `/painel/produtos`: `fixed` no rodapé do
          mobile, `sticky top` no desktop. */}
      <div className="fixed inset-x-0 bottom-0 z-40 min-h-[64px] border-t bg-background p-3 shadow-lg sm:sticky sm:top-0 sm:bottom-auto sm:z-30 sm:rounded-xl sm:border sm:shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p aria-live="polite" className="text-sm font-medium">
            {vazia
              ? "Nenhum produto selecionado"
              : `${lista.length} ${lista.length === 1 ? "produto selecionado" : "produtos selecionados"}`}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              className={ALVO}
              disabled={inerte}
              onClick={() =>
                loteUI.abrirCardapio("adicionar", cardapio, {
                  tipo: "produtos",
                  produto_ids: lista,
                })
              }
            >
              {loteUI.prevendo ? (
                <Loader2 aria-hidden className="animate-spin" />
              ) : null}
              Adicionar ao cardápio
            </Button>
            <Button
              type="button"
              variant="outline"
              className={ALVO}
              disabled={inerte}
              onClick={() =>
                loteUI.abrirCardapio("remover", cardapio, {
                  tipo: "produtos",
                  produto_ids: lista,
                })
              }
            >
              Tirar do cardápio
            </Button>
            <Button
              type="button"
              variant="ghost"
              className={ALVO}
              disabled={vazia}
              onClick={() => setSelecionados(new Set())}
            >
              Limpar
            </Button>
          </div>
        </div>
      </div>

      {grupos.map((grupo) => {
        const ids = grupo.produtos.map((p) => p.id);
        return (
          <Card key={grupo.id ?? "sem-categoria"}>
            <CardContent className="flex flex-col gap-2 p-0">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2">
                <span className="font-heading text-base font-semibold">
                  {grupo.nome}
                </span>
                <div className="flex flex-wrap items-center gap-1">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="min-h-[44px]"
                    onClick={() => selecionarGrupo(ids)}
                  >
                    Selecionar os {ids.length}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="min-h-[44px]"
                    aria-label={`Limpar a seleção de ${grupo.nome}`}
                    onClick={() => limparGrupo(ids)}
                  >
                    Limpar
                  </Button>
                  {/* RN-10: a FOTO da categoria, expandida dentro da transação.
                      "Sem categoria" não é categoria e não tem esse gesto. */}
                  {grupo.id !== null ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="min-h-[44px]"
                      disabled={loteUI.prevendo}
                      onClick={() =>
                        loteUI.abrirCardapio("adicionar", cardapio, {
                          tipo: "categoria",
                          categoria_id: grupo.id as string,
                          categoriaNome: grupo.nome,
                        })
                      }
                    >
                      Adicionar a categoria inteira
                    </Button>
                  ) : null}
                </div>
              </div>

              <ul className="divide-y divide-foreground/10">
                {grupo.produtos.map((p) => (
                  <li
                    key={p.id}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2"
                  >
                    <label className="flex min-h-[44px] min-w-[44px] shrink-0 cursor-pointer items-center justify-center">
                      <Checkbox
                        checked={selecionados.has(p.id)}
                        onCheckedChange={() => alternar(p.id)}
                        aria-label={`Selecionar ${p.nome}`}
                      />
                    </label>
                    <span className="min-w-0 flex-1 text-sm font-medium">
                      {p.nome}
                    </span>
                    {/* [261] É esta diferença que decide o que acontece com o
                        produto quando o cardápio fechar — e é aqui que o
                        lojista está olhando quando decide. Produto do menu não
                        ganha badge. */}
                    {p.exclusivo ? (
                      <Badge variant="secondary">Exclusivo de cardápio</Badge>
                    ) : null}
                    {p.noCardapio ? (
                      <Badge variant="outline" className="font-normal">
                        Neste cardápio
                      </Badge>
                    ) : null}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        );
      })}

      {/* Só existe depois que a prévia do SERVIDOR chega. */}
      {loteUI.dialogo}
    </section>
  );
}
