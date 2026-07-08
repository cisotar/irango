"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Trash2, Loader2, Check, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import type { Categoria } from "@/components/painel/FormProduto";
import {
  criarCategoria as criarCategoriaLojista,
  atualizarCategoria as atualizarCategoriaLojista,
  removerCategoria as removerCategoriaLojista,
  alternarExibirImagens as alternarExibirImagensLojista,
} from "@/lib/actions/produto";

/**
 * Gestão das categorias de PRODUTO (não confundir com categorias de OPCIONAL).
 * A categoria de produto agrupa o catálogo na vitrine E é o elo que resolve quais
 * opcionais um produto aceita (associação 089). Sem ela, produto cai em "Sem
 * categoria" e nunca herda opcionais. O backend (criar/atualizar/removerCategoria)
 * já existia; faltava só esta UI para criá-las pelo painel.
 *
 * `ordem` é auto-atribuída (fim da lista) — o schema do servidor exige int>=0.
 */
export function GerenciarCategorias({
  categorias,
  open,
  onOpenChange,
  onCriar = criarCategoriaLojista,
  onAtualizar = atualizarCategoriaLojista,
  onRemover = removerCategoriaLojista,
  onAlternarExibirImagens = alternarExibirImagensLojista,
}: {
  categorias: Categoria[];
  open: boolean;
  onOpenChange: (aberto: boolean) => void;
  /** Action de criação. Default: action do lojista. A via admin injeta a variante por `lojaId`. */
  onCriar?: typeof criarCategoriaLojista;
  /** Action de edição. Default: action do lojista. */
  onAtualizar?: typeof atualizarCategoriaLojista;
  /** Action de remoção. Default: action do lojista. */
  onRemover?: typeof removerCategoriaLojista;
  /** Action do toggle "exibir imagens". Default: action do lojista. A via admin injeta a variante por `lojaId`. */
  onAlternarExibirImagens?: (
    id: string,
    exibirImagens: boolean,
  ) => Promise<{ ok: boolean; erro?: string }>;
}) {
  const router = useRouter();
  const [nova, setNova] = useState("");
  const [salvando, startSalvar] = useTransition();

  // Edição inline de uma categoria existente.
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [nomeEdicao, setNomeEdicao] = useState("");

  // Preview otimista do toggle "exibir imagens", por categoria (id → estado
  // local). Fonte de verdade é `categoria.exibir_imagens` (prop); este mapa só
  // existe enquanto uma alternância está em voo ou acabou de ser confirmada
  // nesta sessão — evita esperar o `router.refresh()` para o switch responder.
  const [exibicaoOtimista, setExibicaoOtimista] = useState<
    Record<string, boolean>
  >({});

  function alternarExibirImagens(cat: Categoria) {
    const anterior = exibicaoOtimista[cat.id] ?? cat.exibir_imagens;
    const novo = !anterior;
    setExibicaoOtimista((atual) => ({ ...atual, [cat.id]: novo })); // otimista
    startSalvar(async () => {
      const r = await onAlternarExibirImagens(cat.id, novo);
      if (!r.ok) {
        setExibicaoOtimista((atual) => ({ ...atual, [cat.id]: anterior })); // rollback
        toast.error(r.erro ?? "Não foi possível atualizar a categoria.");
        return;
      }
      router.refresh();
    });
  }

  function adicionar() {
    const nome = nova.trim();
    if (!nome) return;
    startSalvar(async () => {
      const r = await onCriar({ nome, ordem: categorias.length });
      if (!r.ok) {
        toast.error(r.erro);
        return;
      }
      toast.success("Categoria criada.");
      setNova("");
      router.refresh();
    });
  }

  function salvarEdicao(id: string, ordem: number) {
    const nome = nomeEdicao.trim();
    if (!nome) return;
    startSalvar(async () => {
      const r = await onAtualizar(id, { nome, ordem });
      if (!r.ok) {
        toast.error(r.erro);
        return;
      }
      toast.success("Categoria atualizada.");
      setEditandoId(null);
      router.refresh();
    });
  }

  function remover(id: string) {
    startSalvar(async () => {
      const r = await onRemover(id);
      if (!r.ok) {
        toast.error(r.erro);
        return;
      }
      toast.success("Categoria removida.");
      router.refresh();
    });
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Categorias de produto</SheetTitle>
          <SheetDescription>
            Agrupam o catálogo na vitrine e definem quais opcionais cada produto
            aceita.
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-4 px-4 pb-4">
          <Separator />

          {/* Nova categoria */}
          <div className="flex items-end gap-2">
            <div className="flex-1 space-y-1">
              <label htmlFor="nova-categoria" className="text-sm font-medium">
                Nova categoria
              </label>
              <Input
                id="nova-categoria"
                value={nova}
                onChange={(e) => setNova(e.target.value)}
                placeholder="Ex.: Pizzas tradicionais"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    adicionar();
                  }
                }}
              />
            </div>
            <Button onClick={adicionar} disabled={salvando || !nova.trim()}>
              {salvando && <Loader2 className="mr-2 size-4 animate-spin" />}
              Adicionar
            </Button>
          </div>

          {/* Lista de categorias existentes */}
          {categorias.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Nenhuma categoria ainda. Crie a primeira acima.
            </p>
          ) : (
            <ul className="divide-y divide-foreground/10">
              {categorias.map((cat, indice) => (
                <li
                  key={cat.id}
                  className="flex items-center gap-2 py-2.5"
                >
                  {editandoId === cat.id ? (
                    <>
                      <Input
                        value={nomeEdicao}
                        onChange={(e) => setNomeEdicao(e.target.value)}
                        autoFocus
                        className="flex-1"
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            salvarEdicao(cat.id, indice);
                          }
                          if (e.key === "Escape") setEditandoId(null);
                        }}
                      />
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Salvar"
                        disabled={salvando}
                        onClick={() => salvarEdicao(cat.id, indice)}
                      >
                        <Check className="size-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Cancelar"
                        onClick={() => setEditandoId(null)}
                      >
                        <X className="size-4" />
                      </Button>
                    </>
                  ) : (
                    <>
                      <span className="flex-1 truncate text-sm text-foreground">
                        {cat.nome}
                      </span>
                      <span
                        className="whitespace-nowrap text-xs text-muted-foreground"
                        aria-hidden="true"
                      >
                        {(exibicaoOtimista[cat.id] ?? cat.exibir_imagens)
                          ? "Imagens visíveis"
                          : "Imagens ocultas"}
                      </span>
                      <Switch
                        checked={exibicaoOtimista[cat.id] ?? cat.exibir_imagens}
                        disabled={salvando}
                        aria-label={`Exibir imagens dos produtos de ${cat.nome} na vitrine`}
                        onCheckedChange={() => alternarExibirImagens(cat)}
                      />
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Renomear ${cat.nome}`}
                        onClick={() => {
                          setEditandoId(cat.id);
                          setNomeEdicao(cat.nome);
                        }}
                      >
                        <Pencil className="size-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Remover ${cat.nome}`}
                        disabled={salvando}
                        onClick={() => remover(cat.id)}
                      >
                        <Trash2 className="size-4 text-destructive" />
                      </Button>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
