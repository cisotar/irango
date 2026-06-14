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
import type { Categoria } from "@/components/painel/FormProduto";
import {
  criarCategoria,
  atualizarCategoria,
  removerCategoria,
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
}: {
  categorias: Categoria[];
  open: boolean;
  onOpenChange: (aberto: boolean) => void;
}) {
  const router = useRouter();
  const [nova, setNova] = useState("");
  const [salvando, startSalvar] = useTransition();

  // Edição inline de uma categoria existente.
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [nomeEdicao, setNomeEdicao] = useState("");

  function adicionar() {
    const nome = nova.trim();
    if (!nome) return;
    startSalvar(async () => {
      const r = await criarCategoria({ nome, ordem: categorias.length });
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
      const r = await atualizarCategoria(id, { nome, ordem });
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
      const r = await removerCategoria(id);
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
