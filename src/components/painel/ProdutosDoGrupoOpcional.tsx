"use client";

import { useState, type ReactElement } from "react";
import { EyeOff, Loader2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTrigger,
} from "@/components/ui/sheet";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import type {
  AlteracaoOcultacao,
  OcultacoesOpcionais,
} from "@/components/painel/useOcultacoesOpcionais";

/** A régua de `design-system.md` §5: valor LITERAL, nunca `min-h-11`. */
const ALVO = "min-h-[44px] min-w-[44px]";

export type ProdutoDoGrupo = { id: string; nome: string; categoria_id: string | null };

export type ProdutosDoGrupoOpcionalProps = {
  grupo: { id: string; nome: string };
  categoriaProduto: { id: string; nome: string };
  /** Todos os produtos da loja; o componente lista só os DESTA categoria. */
  produtos: readonly ProdutoDoGrupo[];
  /** A instância única do `OpcionaisClient` (`useOcultacoesOpcionais`). */
  ocultacoes: Pick<OcultacoesOpcionais, "oculto" | "aplicarLote">;
};

/**
 * O lote que "Salvar" manda: SÓ o que mudou em relação ao estado atual.
 * Marcado = o grupo aparece; desmarcado = oculto. Id marcado que não está em
 * `produtoIds` (outra categoria) não vira alteração. Preserva a ordem da lista.
 */
export function diffOcultacoesDoGrupo({
  grupoId,
  produtoIds,
  estaOculto,
  marcados,
}: {
  grupoId: string;
  produtoIds: readonly string[];
  estaOculto: (produtoId: string) => boolean;
  /** Marcado = o grupo APARECE no produto. */
  marcados: ReadonlySet<string>;
}): AlteracaoOcultacao[] {
  const alteracoes: AlteracaoOcultacao[] = [];
  for (const produtoId of produtoIds) {
    const ocultar = !marcados.has(produtoId);
    if (ocultar !== estaOculto(produtoId)) {
      alteracoes.push({ produtoId, categoriaOpcionalId: grupoId, oculto: ocultar });
    }
  }
  return alteracoes;
}

/**
 * [331] "Por produto": em quais produtos DESTA categoria o grupo aparece. Aberto
 * a partir de cada grupo marcado e salvo do `CartaoAssociacaoOpcionais` (tela de
 * opcionais, lojista e admin).
 *
 * `showCloseButton={false}` e um fechar próprio de 44px, pelo mesmo motivo de
 * `SheetAdicionarItens`: o close padrão do `sheet.tsx` tem 33,6px e
 * `components/ui/` não se edita à mão.
 */
export function ProdutosDoGrupoOpcional(props: ProdutosDoGrupoOpcionalProps): ReactElement {
  const [aberto, setAberto] = useState(false);
  const ehDesktop = useMediaQuery("(min-width: 640px)");
  const { grupo, categoriaProduto } = props;

  return (
    <Sheet open={aberto} onOpenChange={setAberto}>
      <SheetTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className={`${ALVO} text-xs font-medium text-muted-foreground`}
            aria-label={`Por produto: em quais produtos de ${categoriaProduto.nome} o grupo ${grupo.nome} aparece`}
          />
        }
      >
        <EyeOff aria-hidden className="size-3.5" />
        Por produto
      </SheetTrigger>
      <SheetContent
        side={ehDesktop ? "right" : "bottom"}
        showCloseButton={false}
        className="max-h-[90dvh] gap-0 sm:max-h-none"
        aria-labelledby={idTitulo(grupo.id, categoriaProduto.id)}
        aria-describedby={idDescricao(grupo.id, categoriaProduto.id)}
      >
        <ConteudoProdutosDoGrupoOpcional {...props} onFechar={() => setAberto(false)} />
      </SheetContent>
    </Sheet>
  );
}

const idTitulo = (grupoId: string, categoriaId: string) =>
  `por-produto-${categoriaId}-${grupoId}-titulo`;
const idDescricao = (grupoId: string, categoriaId: string) =>
  `por-produto-${categoriaId}-${grupoId}-descricao`;

/**
 * O CONTEÚDO do sheet, exportado à parte: um `Sheet` aberto renderiza em portal
 * e portal não existe em `renderToStaticMarkup` (sem jsdom neste repo). Título
 * e descrição são elementos comuns com id — `SheetTitle` exigiria o contexto do
 * `Dialog` (mesmo motivo de `ConteudoAdicionarItens`).
 *
 * O rascunho de marcados nasce do hook ao abrir (o conteúdo remonta a cada
 * abertura) e só vira escrita em "Salvar", como diff. Falhou: o hook já
 * reverteu e anunciou; o sheet fica aberto com a escolha, para tentar de novo.
 */
export function ConteudoProdutosDoGrupoOpcional({
  grupo,
  categoriaProduto,
  produtos,
  ocultacoes,
  onFechar,
}: ProdutosDoGrupoOpcionalProps & { onFechar: () => void }): ReactElement {
  const daCategoria = produtos.filter((p) => p.categoria_id === categoriaProduto.id);
  const [marcados, setMarcados] = useState<ReadonlySet<string>>(
    () =>
      new Set(daCategoria.filter((p) => !ocultacoes.oculto(p.id, grupo.id)).map((p) => p.id)),
  );
  const [salvando, setSalvando] = useState(false);

  function alternar(id: string, aparece: boolean): void {
    setMarcados((atual) => {
      const proximo = new Set(atual);
      if (aparece) proximo.add(id);
      else proximo.delete(id);
      return proximo;
    });
  }

  async function salvar(): Promise<void> {
    if (salvando) return;
    const alteracoes = diffOcultacoesDoGrupo({
      grupoId: grupo.id,
      produtoIds: daCategoria.map((p) => p.id),
      estaOculto: (id) => ocultacoes.oculto(id, grupo.id),
      marcados,
    });
    setSalvando(true);
    const ok = await ocultacoes.aplicarLote(alteracoes);
    setSalvando(false);
    if (ok) onFechar();
  }

  const visiveis = daCategoria.filter((p) => marcados.has(p.id)).length;

  return (
    <>
      <SheetHeader className="flex-row items-start justify-between gap-2 border-b">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2
            id={idTitulo(grupo.id, categoriaProduto.id)}
            className="font-heading text-base font-medium text-foreground"
          >
            {grupo.nome} por produto
          </h2>
          <p
            id={idDescricao(grupo.id, categoriaProduto.id)}
            className="text-sm text-muted-foreground"
          >
            Produtos de {categoriaProduto.nome}. Desmarque para ocultar {grupo.nome}{" "}
            só naquele produto.
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          className={ALVO}
          aria-label="Fechar"
          onClick={onFechar}
        >
          <X aria-hidden className="size-4" />
        </Button>
      </SheetHeader>

      <div className="flex flex-col overflow-y-auto px-4 py-3">
        {daCategoria.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">
            Nenhum produto em {categoriaProduto.nome} ainda.
          </p>
        ) : (
          <ul className="divide-y divide-foreground/10">
            {daCategoria.map((p) => {
              const aparece = marcados.has(p.id);
              return (
                <li key={p.id}>
                  <label className="flex min-h-[44px] cursor-pointer items-center gap-3 py-1">
                    <span className={`${ALVO} flex shrink-0 items-center justify-center`}>
                      <Checkbox
                        checked={aparece}
                        aria-label={`Exibir ${grupo.nome} em ${p.nome}`}
                        onCheckedChange={(v) => alternar(p.id, v === true)}
                      />
                    </span>
                    <span className="min-w-0 flex-1 text-sm text-foreground">{p.nome}</span>
                    {!aparece && (
                      <span className="text-xs text-muted-foreground">oculto</span>
                    )}
                  </label>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <SheetFooter className="border-t">
        <p aria-live="polite" className="text-sm font-medium">
          {`Aparece em ${visiveis} de ${daCategoria.length} ${
            daCategoria.length === 1 ? "produto" : "produtos"
          }`}
        </p>
        <Button
          type="button"
          className={`${ALVO} w-full`}
          aria-disabled={salvando}
          onClick={() => void salvar()}
        >
          {salvando && <Loader2 aria-hidden className="animate-spin" />}
          Salvar
        </Button>
      </SheetFooter>
    </>
  );
}
