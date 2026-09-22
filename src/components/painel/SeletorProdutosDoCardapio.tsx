"use client";

import { useMemo, useState, type ReactElement } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { useLoteDeProdutos } from "@/components/painel/useLoteDeProdutos";
import { PilulasDeDias } from "@/components/painel/PilulasDeDias";
import {
  payloadDeDias,
  podeDefinirDias,
} from "@/components/painel/agendaDoVinculo";
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
  /**
   * [276] Os dias do VÍNCULO com ESTE cardápio. `null` = todos os dias do
   * cardápio. Produto não vinculado também chega `null` e não mostra pílulas.
   */
  dias: number[] | null;
  /** A linha de agenda, JÁ REDIGIDA no servidor. `null` = não vinculado. */
  fraseAgenda: string | null;
  /** RN-06, redigido no SERVIDOR. `null` = a agenda abre em algum dia. */
  avisoNuncaAbre: string | null;
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

  /**
   * [276] Estado OTIMISTA por `produto_id`: a pílula pinta antes de a escrita
   * voltar, e volta ao estado anterior se a action recusar. A fonte da verdade
   * continua sendo o SSR — `router.refresh()` recalcula frase e aviso no
   * servidor, com o fuso da loja.
   */
  const [agendas, setAgendas] = useState<Record<string, number[] | null>>({});
  const [emVoo, setEmVoo] = useState<ReadonlySet<string>>(() => new Set());
  const [anuncios, setAnuncios] = useState<Record<string, string>>({});

  async function salvarDias(
    produto: ProdutoDoSeletor,
    dias: number[],
  ): Promise<void> {
    const anterior = agendas[produto.id] ?? produto.dias;
    setAgendas((atual) => ({ ...atual, [produto.id]: dias }));
    setAnuncios((atual) => ({ ...atual, [produto.id]: "Salvando…" }));
    // Decisão D do desenho: o grupo desabilita enquanto a escrita está em voo.
    // Duas escritas concorrentes do array inteiro teriam como vencedor o último
    // a CHEGAR, não o último CLICADO.
    setEmVoo((atual) => new Set(atual).add(produto.id));
    try {
      const resultado = await acoes.definirDias(
        payloadDeDias(cardapio.id, produto.id, dias),
      );
      if (!resultado.ok) {
        setAgendas((atual) => ({ ...atual, [produto.id]: anterior }));
        setAnuncios((atual) => ({ ...atual, [produto.id]: "" }));
        // A frase é a da action (alheio e inexistente byte a byte iguais);
        // nenhum detalhe de banco é redigido aqui.
        toast.error(resultado.erro);
        return;
      }
      setAnuncios((atual) => ({ ...atual, [produto.id]: "Dias salvos." }));
      router.refresh();
    } finally {
      setEmVoo((atual) => {
        const proximo = new Set(atual);
        proximo.delete(produto.id);
        return proximo;
      });
    }
  }

  const vazia = lista.length === 0;
  const inerte = vazia || loteUI.prevendo;
  /**
   * [277/decisão B] "Definir dias" só com a seleção INTEIRA já vinculada: a
   * prévia conta PRODUTOS, a escrita alcança VÍNCULOS. É conveniência de UI,
   * não autoridade — burlar isto no browser só rende `count === 0` por par.
   */
  const podeDias = podeDefinirDias(
    grupos.flatMap((g) => g.produtos),
    lista,
  );

  /**
   * Quem JÁ está vinculado, para o resumo em cards — sem isso o lojista só
   * descobre "o que tem aqui" rolando a lista da loja INTEIRA procurando o
   * badge "Neste cardápio" no meio dos produtos que não estão. Deriva de
   * `grupos`, o mesmo dado do checklist abaixo — nenhuma leitura nova.
   */
  const produtosNoCardapio = useMemo(
    () => grupos.flatMap((g) => g.produtos).filter((p) => p.noCardapio),
    [grupos],
  );

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-col gap-2">
        <h2 className="font-heading text-lg font-semibold">
          {produtosNoCardapio.length === 0
            ? "Nenhum produto neste cardápio ainda"
            : produtosNoCardapio.length === 1
              ? "1 produto neste cardápio"
              : `${produtosNoCardapio.length} produtos neste cardápio`}
        </h2>
        {produtosNoCardapio.length > 0 ? (
          <ul className="flex flex-wrap gap-2">
            {produtosNoCardapio.map((p) => (
              <li key={p.id}>
                <Card className="w-40 shrink-0 gap-1 py-2">
                  <CardContent className="flex flex-col gap-1 px-3">
                    <span className="line-clamp-2 text-sm font-medium">
                      {p.nome}
                    </span>
                    {p.exclusivo ? (
                      <Badge variant="secondary" className="w-fit">
                        Exclusivo
                      </Badge>
                    ) : null}
                    {p.fraseAgenda !== null ? (
                      <span className="text-xs text-texto-muted">
                        {p.fraseAgenda}
                      </span>
                    ) : null}
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <h2 className="font-heading text-lg font-semibold">
        Adicionar ou remover produtos
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
              variant="outline"
              className={ALVO}
              disabled={inerte || !podeDias}
              title={
                !vazia && !podeDias
                  ? "Só vale para quem já está neste cardápio."
                  : undefined
              }
              onClick={() => loteUI.abrirDias(cardapio, lista)}
            >
              Definir dias
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
                {grupo.produtos.map((p) => {
                  const salvando = emVoo.has(p.id);
                  const dias = agendas[p.id] ?? p.dias ?? [];
                  const idAgenda = `agenda-${p.id}`;
                  return (
                    <li
                      key={p.id}
                      aria-busy={salvando}
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
                          lojista está olhando quando decide. Produto do menu
                          não ganha badge. */}
                      {p.exclusivo ? (
                        <Badge variant="secondary">Exclusivo de cardápio</Badge>
                      ) : null}
                      {p.noCardapio ? (
                        <Badge variant="outline" className="font-normal">
                          Neste cardápio
                        </Badge>
                      ) : null}

                      {/* [276] A agenda é do VÍNCULO: produto não vinculado não
                          mostra pílulas, frase nem placeholder. As 7 pílulas
                          ficam em SEGUNDA linha — a primeira já carrega
                          checkbox de 44px + nome + até dois badges, e 7 alvos a
                          mais estouram 360px (design-system §5). */}
                      {p.noCardapio ? (
                        <div className="flex w-full flex-col gap-1 pl-[56px]">
                          <p
                            id={idAgenda}
                            className="text-xs text-texto-muted"
                          >
                            {p.fraseAgenda}
                          </p>
                          <PilulasDeDias
                            compacto
                            valor={dias}
                            onChange={(proximos) => void salvarDias(p, proximos)}
                            rotulo={`Dias em que ${p.nome} aparece neste cardápio`}
                            descritoPor={idAgenda}
                            desabilitado={salvando}
                          />
                          {/* RN-06: avisa, não bloqueia. Sem `aria-invalid`, sem
                              roubar foco, sem oferecer conserto — o consertável
                              é a vigência do cardápio, na mesma rota. */}
                          {p.avisoNuncaAbre !== null ? (
                            <p
                              role="status"
                              className="rounded-lg border border-amber-300 bg-amber-100 px-2 py-1 text-xs text-amber-900"
                            >
                              {p.avisoNuncaAbre}
                            </p>
                          ) : null}
                          <p aria-live="polite" className="sr-only">
                            {anuncios[p.id] ?? ""}
                          </p>
                        </div>
                      ) : null}
                    </li>
                  );
                })}
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
