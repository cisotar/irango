"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertDialog } from "@base-ui/react/alert-dialog";
import { Pencil, Plus, Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { FormProduto, type Categoria } from "@/components/painel/FormProduto";
import { GerenciarCategorias } from "@/components/painel/GerenciarCategorias";
import {
  removerProduto,
  alternarDisponibilidade,
} from "@/lib/actions/produto";
import { formatarMoeda } from "@/lib/utils/formatarMoeda";
import type { Produto } from "@/lib/supabase/queries/produtos";

export type ProdutosClientProps = {
  lojaSlug: string;
  lojaId: string;
  produtos: Produto[];
  categorias: Categoria[];
};

type GrupoProdutos = {
  id: string | null;
  nome: string;
  produtos: Produto[];
};

/** Agrupa produtos por categoria, na ordem das categorias; "Sem categoria" por último. */
function agruparPorCategoria(
  produtos: Produto[],
  categorias: Categoria[],
): GrupoProdutos[] {
  const grupos: GrupoProdutos[] = categorias.map((c) => ({
    id: c.id,
    nome: c.nome,
    produtos: [],
  }));
  const porId = new Map(grupos.map((g) => [g.id, g]));
  let outros: GrupoProdutos | null = null;

  for (const p of produtos) {
    const grupo = p.categoria_id ? porId.get(p.categoria_id) : undefined;
    if (grupo) {
      grupo.produtos.push(p);
    } else {
      if (!outros) outros = { id: null, nome: "Sem categoria", produtos: [] };
      outros.produtos.push(p);
    }
  }

  const naoVazios = grupos.filter((g) => g.produtos.length > 0);
  if (outros) naoVazios.push(outros);
  return naoVazios;
}

export function ProdutosClient({
  lojaSlug,
  lojaId,
  produtos,
  categorias,
}: ProdutosClientProps) {
  const router = useRouter();

  // null => criar; Produto => editar. `formAberto` controla a abertura do Sheet.
  const [formAberto, setFormAberto] = useState(false);
  const [emEdicao, setEmEdicao] = useState<Produto | null>(null);

  // Produto pendente de remoção (controla o AlertDialog).
  const [aRemover, setARemover] = useState<Produto | null>(null);
  const [categoriasAbertas, setCategoriasAbertas] = useState(false);
  const [removendo, startRemocao] = useTransition();
  const [alternando, startAlternar] = useTransition();

  const grupos = useMemo(
    () => agruparPorCategoria(produtos, categorias),
    [produtos, categorias],
  );

  function abrirCriar() {
    setEmEdicao(null);
    setFormAberto(true);
  }

  function abrirEditar(p: Produto) {
    setEmEdicao(p);
    setFormAberto(true);
  }

  function aoSalvar() {
    setFormAberto(false);
    setEmEdicao(null);
    router.refresh();
  }

  function confirmarRemocao() {
    if (!aRemover) return;
    const id = aRemover.id;
    startRemocao(async () => {
      const resultado = await removerProduto(id);
      if (!resultado.ok) {
        toast.error(resultado.erro);
        return;
      }
      toast.success("Produto removido.");
      setARemover(null);
      router.refresh();
    });
  }

  function alternar(p: Produto) {
    startAlternar(async () => {
      const resultado = await alternarDisponibilidade(p.id, !p.disponivel);
      if (!resultado.ok) {
        toast.error(resultado.erro);
        return;
      }
      router.refresh();
    });
  }

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-6">
      <div className="mb-6 flex items-center justify-between gap-2">
        <h1 className="font-heading text-xl font-semibold text-foreground">
          Produtos
        </h1>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setCategoriasAbertas(true)}>
            Categorias
          </Button>
          <Button onClick={abrirCriar}>
            <Plus className="size-4" />
            Novo produto
          </Button>
        </div>
      </div>

      {produtos.length === 0 && (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            Nenhum produto ainda. Crie o primeiro com &ldquo;Novo produto&rdquo;.
          </CardContent>
        </Card>
      )}

      <div className="space-y-6">
        {grupos.map((grupo) => (
          <section key={grupo.id ?? "sem-categoria"}>
            <h2 className="mb-2 text-sm font-medium text-muted-foreground">
              {grupo.nome}
            </h2>
            <Card>
              <CardContent className="divide-y divide-foreground/10 p-0">
                {grupo.produtos.map((p) => (
                  <div
                    key={p.id}
                    className="flex items-center gap-3 px-4 py-3"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate font-medium text-foreground">
                          {p.nome}
                        </span>
                        <Badge
                          variant={p.disponivel ? "secondary" : "outline"}
                        >
                          {p.disponivel ? "Disponível" : "Indisponível"}
                        </Badge>
                      </div>
                      <span className="text-sm text-muted-foreground">
                        {formatarMoeda(p.preco)}
                      </span>
                    </div>

                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={alternando}
                      onClick={() => alternar(p)}
                    >
                      {p.disponivel ? "Ocultar" : "Exibir"}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Editar ${p.nome}`}
                      onClick={() => abrirEditar(p)}
                    >
                      <Pencil className="size-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Remover ${p.nome}`}
                      onClick={() => setARemover(p)}
                    >
                      <Trash2 className="size-4 text-destructive" />
                    </Button>
                  </div>
                ))}
              </CardContent>
            </Card>
          </section>
        ))}
      </div>

      {/* Gestão de categorias de produto */}
      <GerenciarCategorias
        categorias={categorias}
        open={categoriasAbertas}
        onOpenChange={setCategoriasAbertas}
      />

      {/* Sheet de criar/editar */}
      <Sheet open={formAberto} onOpenChange={setFormAberto}>
        <SheetContent className="overflow-y-auto">
          <SheetHeader>
            <SheetTitle>
              {emEdicao ? "Editar produto" : "Novo produto"}
            </SheetTitle>
            <SheetDescription>
              Preencha os dados do produto exibido na sua vitrine.
            </SheetDescription>
          </SheetHeader>
          <div className="px-4 pb-4">
            <Separator className="mb-4" />
            <FormProduto
              // Recria o form ao alternar entre produtos / criar.
              key={emEdicao?.id ?? "novo"}
              categorias={categorias}
              lojaSlug={lojaSlug}
              lojaId={lojaId}
              onSucesso={aoSalvar}
              inicial={
                emEdicao
                  ? {
                      id: emEdicao.id,
                      nome: emEdicao.nome,
                      descricao: emEdicao.descricao,
                      preco: emEdicao.preco,
                      categoria_id: emEdicao.categoria_id,
                      disponivel: emEdicao.disponivel,
                      foto_url: emEdicao.foto_url,
                      ordem: emEdicao.ordem,
                    }
                  : undefined
              }
            />
          </div>
        </SheetContent>
      </Sheet>

      {/* Confirmação de remoção */}
      <AlertDialog.Root
        open={aRemover !== null}
        onOpenChange={(aberto) => {
          if (!aberto) setARemover(null);
        }}
      >
        <AlertDialog.Portal>
          <AlertDialog.Backdrop className="fixed inset-0 z-50 bg-black/30 transition-opacity data-ending-style:opacity-0 data-starting-style:opacity-0" />
          <AlertDialog.Popup className="fixed top-1/2 left-1/2 z-50 w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-xl bg-popover p-5 text-popover-foreground shadow-lg transition-all data-ending-style:opacity-0 data-starting-style:opacity-0">
            <AlertDialog.Title className="font-heading text-base font-medium text-foreground">
              Remover produto
            </AlertDialog.Title>
            <AlertDialog.Description className="mt-1 text-sm text-muted-foreground">
              Tem certeza que deseja remover
              {aRemover ? ` "${aRemover.nome}"` : ""}? Esta ação não pode ser
              desfeita.
            </AlertDialog.Description>
            <div className="mt-5 flex justify-end gap-2">
              <AlertDialog.Close
                render={<Button variant="outline" disabled={removendo} />}
              >
                Cancelar
              </AlertDialog.Close>
              <Button
                variant="destructive"
                disabled={removendo}
                onClick={confirmarRemocao}
              >
                {removendo && <Loader2 className="mr-2 size-4 animate-spin" />}
                Remover
              </Button>
            </div>
          </AlertDialog.Popup>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </main>
  );
}
