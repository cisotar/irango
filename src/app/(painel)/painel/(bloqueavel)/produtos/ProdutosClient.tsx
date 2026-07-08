"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertDialog } from "@base-ui/react/alert-dialog";
import {
  Pencil,
  Plus,
  Trash2,
  Loader2,
  SlidersHorizontal,
  EyeOff,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { FormProduto, type Categoria } from "@/components/painel/FormProduto";
import { ThumbProduto } from "@/components/painel/ThumbProduto";
import { GerenciarCategorias } from "@/components/painel/GerenciarCategorias";
import {
  removerProduto as removerProdutoLojista,
  alternarDisponibilidade as alternarDisponibilidadeLojista,
  alternarOculto as alternarOcultoLojista,
  criarProduto as criarProdutoLojista,
  atualizarProduto as atualizarProdutoLojista,
  criarCategoria as criarCategoriaLojista,
  atualizarCategoria as atualizarCategoriaLojista,
  removerCategoria as removerCategoriaLojista,
  alternarExibirImagens as alternarExibirImagensLojista,
} from "@/lib/actions/produto";
import { salvarAssociacaoOpcionais } from "@/lib/actions/opcional";
import type { EnviarFotoProduto } from "@/components/painel/UploadFotoProduto";
import { formatarMoeda } from "@/lib/utils/formatarMoeda";
import type {
  Produto,
  OpcionaisPorCategoria,
} from "@/lib/supabase/queries/produtos";

type CategoriaOpcional = { id: string; nome: string };

export type ProdutosClientProps = {
  lojaSlug: string;
  lojaId: string;
  produtos: Produto[];
  categorias: Categoria[];
  /**
   * Mapa `categoria_id → grupos de opcionais` carregado no server (issue 105).
   * Consumido pela UI de thumbnail/opcionais na issue 107 e como seleção
   * inicial do seletor de associação no título da categoria.
   */
  opcionaisPorCategoria: OpcionaisPorCategoria;
  /** Todas as categorias de opcional da loja, para o seletor por categoria. */
  categoriasOpcional: CategoriaOpcional[];
  /**
   * Actions injetáveis. Omitidas no painel do lojista (caem nos defaults =
   * comportamento atual). A via admin passa as variantes escopadas por `lojaId`.
   */
  acoes?: {
    removerProduto?: typeof removerProdutoLojista;
    alternarDisponibilidade?: typeof alternarDisponibilidadeLojista;
    alternarOculto?: typeof alternarOcultoLojista;
    criarProduto?: typeof criarProdutoLojista;
    atualizarProduto?: typeof atualizarProdutoLojista;
    enviarFotoProduto?: EnviarFotoProduto;
    criarCategoria?: typeof criarCategoriaLojista;
    atualizarCategoria?: typeof atualizarCategoriaLojista;
    removerCategoria?: typeof removerCategoriaLojista;
    alternarExibirImagens?: typeof alternarExibirImagensLojista;
    salvarAssociacaoOpcionais?: typeof salvarAssociacaoOpcionais;
  };
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

/**
 * Badge de status efetivo na vitrine, derivado dos dois eixos com precedência
 * Oculto > Esgotado > Disponível (RN-6 / decisão de design 089). Não depende só
 * de cor (WCAG 1.4.1): "Oculto" carrega ícone `EyeOff` além do texto.
 */
function badgeStatus(p: Produto) {
  if (p.oculto) {
    return (
      <Badge variant="outline" className="text-muted-foreground">
        <EyeOff className="size-3" />
        Oculto
      </Badge>
    );
  }
  return (
    <Badge variant="secondary">
      {p.disponivel ? "Disponível" : "Esgotado"}
    </Badge>
  );
}

export function ProdutosClient({
  lojaSlug,
  lojaId,
  produtos,
  categorias,
  // Encanada no server (issue 105); consumida pela UI na issue 107.
  opcionaisPorCategoria,
  categoriasOpcional,
  acoes,
}: ProdutosClientProps) {
  const router = useRouter();

  const removerProduto = acoes?.removerProduto ?? removerProdutoLojista;
  const alternarDisponibilidade =
    acoes?.alternarDisponibilidade ?? alternarDisponibilidadeLojista;
  const alternarOculto = acoes?.alternarOculto ?? alternarOcultoLojista;
  const salvarAssociacao =
    acoes?.salvarAssociacaoOpcionais ?? salvarAssociacaoOpcionais;

  // null => criar; Produto => editar. `formAberto` controla a abertura do
  // Sheet (mobile) ou Dialog (desktop) — uma árvore por vez, sem duplicar
  // estado/efeitos do FormProduto (mesmo padrão do CheckoutWizard, issue 006).
  const [formAberto, setFormAberto] = useState(false);
  const [emEdicao, setEmEdicao] = useState<Produto | null>(null);
  const ehDesktop = useMediaQuery("(min-width: 768px)");

  // Categoria de produto com o seletor de opcionais aberto (null => fechado).
  const [categoriaOpcionaisAberta, setCategoriaOpcionaisAberta] =
    useState<GrupoProdutos | null>(null);

  // Produto pendente de remoção (controla o AlertDialog).
  const [aRemover, setARemover] = useState<Produto | null>(null);
  const [categoriasAbertas, setCategoriasAbertas] = useState(false);
  const [removendo, startRemocao] = useTransition();
  const [alternandoDisp, startAlternarDisp] = useTransition();
  const [alternandoOculto, startAlternarOculto] = useTransition();
  // Id do produto em transição em cada eixo — evita travar a lista inteira
  // ao togglar um único produto (cada linha desabilita só o próprio controle).
  const [idAlternandoDisp, setIdAlternandoDisp] = useState<string | null>(
    null,
  );
  const [idAlternandoOculto, setIdAlternandoOculto] = useState<string | null>(
    null,
  );

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

  // Eixo DISPONIBILIDADE (`disponivel`) — lógica inalterada da action existente.
  function alternarDispon(p: Produto) {
    setIdAlternandoDisp(p.id);
    startAlternarDisp(async () => {
      const resultado = await alternarDisponibilidade(p.id, !p.disponivel);
      if (!resultado.ok) {
        toast.error(resultado.erro);
        setIdAlternandoDisp(null);
        return;
      }
      router.refresh();
    });
  }

  // Eixo VISIBILIDADE (`oculto`) — NÃO toca em `disponivel` (RN-6).
  function alternarVisibilidade(p: Produto) {
    setIdAlternandoOculto(p.id);
    startAlternarOculto(async () => {
      const resultado = await alternarOculto(p.id, !p.oculto);
      if (!resultado.ok) {
        toast.error(resultado.erro);
        setIdAlternandoOculto(null);
        return;
      }
      router.refresh();
    });
  }

  const formProduto = (
    <FormProduto
      // Recria o form ao alternar entre produtos / criar.
      key={emEdicao?.id ?? "novo"}
      categorias={categorias}
      lojaSlug={lojaSlug}
      lojaId={lojaId}
      onSucesso={aoSalvar}
      onCriar={acoes?.criarProduto}
      onAtualizar={acoes?.atualizarProduto}
      onEnviarFoto={acoes?.enviarFotoProduto}
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
  );

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
            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 border-b">
                <CardTitle className="font-heading text-lg font-semibold text-foreground">
                  {grupo.nome}
                </CardTitle>
                {grupo.id != null && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setCategoriaOpcionaisAberta(grupo)}
                  >
                    <SlidersHorizontal className="size-4" />
                    Opcionais
                  </Button>
                )}
              </CardHeader>
              <CardContent className="divide-y divide-foreground/10 p-0">
                {grupo.produtos.map((p) => (
                  <div
                    key={p.id}
                    className="flex min-h-11 items-center gap-3 px-4 py-3"
                  >
                    <ThumbProduto fotoUrl={p.foto_url} nome={p.nome} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate font-medium text-foreground">
                          {p.nome}
                        </span>
                        {badgeStatus(p)}
                      </div>
                      <span className="text-sm text-muted-foreground">
                        {formatarMoeda(p.preco)}
                      </span>
                      {(() => {
                        const gruposOpcionais =
                          opcionaisPorCategoria[p.categoria_id ?? ""] ?? [];
                        if (gruposOpcionais.length === 0) return null;
                        return (
                          <ul className="mt-2 flex flex-wrap gap-1.5">
                            {gruposOpcionais
                              .slice()
                              .sort((a, b) => a.ordem - b.ordem)
                              .map((g) => (
                                <li key={g.categoriaOpcionalId}>
                                  <Badge
                                    variant="secondary"
                                    className="font-normal"
                                  >
                                    {g.categoriaOpcionalNome}
                                  </Badge>
                                </li>
                              ))}
                          </ul>
                        );
                      })()}
                    </div>

                    <Button
                      variant="ghost"
                      size="sm"
                      className="min-h-11"
                      disabled={alternandoOculto && idAlternandoOculto === p.id}
                      aria-label={
                        p.oculto
                          ? `Exibir ${p.nome} na vitrine`
                          : `Ocultar ${p.nome} da vitrine`
                      }
                      onClick={() => alternarVisibilidade(p)}
                    >
                      {p.oculto ? "Exibir" : "Ocultar"}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="min-h-11"
                      disabled={alternandoDisp && idAlternandoDisp === p.id}
                      aria-label={
                        p.disponivel
                          ? `Marcar ${p.nome} como esgotado`
                          : `Disponibilizar ${p.nome}`
                      }
                      onClick={() => alternarDispon(p)}
                    >
                      {p.disponivel ? "Marcar esgotado" : "Disponibilizar"}
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
        onCriar={acoes?.criarCategoria}
        onAtualizar={acoes?.atualizarCategoria}
        onRemover={acoes?.removerCategoria}
        onAlternarExibirImagens={acoes?.alternarExibirImagens}
      />

      {/* Criar/editar: Dialog centralizado no desktop (aproveita a largura da
          tela), Sheet lateral no mobile. Uma árvore por vez — ver ehDesktop. */}
      {ehDesktop ? (
        <Dialog open={formAberto} onOpenChange={setFormAberto}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>
                {emEdicao ? "Editar produto" : "Novo produto"}
              </DialogTitle>
              <DialogDescription>
                Preencha os dados do produto exibido na sua vitrine.
              </DialogDescription>
            </DialogHeader>
            <div className="overflow-y-auto px-4 pb-4">
              <Separator className="mb-4" />
              {formProduto}
            </div>
          </DialogContent>
        </Dialog>
      ) : (
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
              {formProduto}
            </div>
          </SheetContent>
        </Sheet>
      )}

      {/* Seletor de opcionais da categoria */}
      <Sheet
        open={categoriaOpcionaisAberta !== null}
        onOpenChange={(aberto) => {
          if (!aberto) setCategoriaOpcionaisAberta(null);
        }}
      >
        <SheetContent className="overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Opcionais de {categoriaOpcionaisAberta?.nome}</SheetTitle>
            <SheetDescription>
              Escolha quais categorias de opcional aparecem para os produtos
              desta categoria.
            </SheetDescription>
          </SheetHeader>
          <div className="px-4 pb-4">
            <Separator className="mb-4" />
            {categoriaOpcionaisAberta && (
              <SeletorOpcionaisCategoria
                key={categoriaOpcionaisAberta.id}
                categoriaId={categoriaOpcionaisAberta.id as string}
                categoriasOpcional={categoriasOpcional}
                salvarAssociacao={salvarAssociacao}
                selecionadosIniciais={
                  new Set(
                    (opcionaisPorCategoria[categoriaOpcionaisAberta.id ?? ""] ?? []).map(
                      (g) => g.categoriaOpcionalId,
                    ),
                  )
                }
                onSalvo={() => {
                  setCategoriaOpcionaisAberta(null);
                  router.refresh();
                }}
              />
            )}
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

/**
 * Checkboxes de categorias de opcional aplicáveis a UMA categoria de produto.
 * Grava via `salvarAssociacaoOpcionais` (issue 089) — mesma action da tela
 * /painel/produtos/opcionais, sem lógica nova.
 */
function SeletorOpcionaisCategoria({
  categoriaId,
  categoriasOpcional,
  salvarAssociacao,
  selecionadosIniciais,
  onSalvo,
}: {
  categoriaId: string;
  categoriasOpcional: CategoriaOpcional[];
  salvarAssociacao: typeof salvarAssociacaoOpcionais;
  selecionadosIniciais: Set<string>;
  onSalvo: () => void;
}) {
  const [selecionados, setSelecionados] =
    useState<Set<string>>(selecionadosIniciais);
  const [salvando, startSalvar] = useTransition();

  function alternar(catOpcId: string, marcado: boolean) {
    setSelecionados((atual) => {
      const proximo = new Set(atual);
      if (marcado) {
        proximo.add(catOpcId);
      } else {
        proximo.delete(catOpcId);
      }
      return proximo;
    });
  }

  function salvar() {
    startSalvar(async () => {
      const r = await salvarAssociacao({
        categoria_id: categoriaId,
        categoria_opcional_id: Array.from(selecionados),
      });
      if (!r.ok) {
        toast.error(r.erro);
        return;
      }
      toast.success("Opcionais atualizados!");
      onSalvo();
    });
  }

  if (categoriasOpcional.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Crie categorias de opcional em &ldquo;Opcionais&rdquo; para poder
        associá-las.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        {categoriasOpcional.map((catOpc) => (
          <label
            key={catOpc.id}
            className="flex cursor-pointer items-center gap-2 text-sm text-foreground"
          >
            <Checkbox
              checked={selecionados.has(catOpc.id)}
              onCheckedChange={(v) => alternar(catOpc.id, v === true)}
            />
            <span>{catOpc.nome}</span>
          </label>
        ))}
      </div>
      <Button className="w-full" disabled={salvando} onClick={salvar}>
        {salvando && <Loader2 className="mr-2 size-4 animate-spin" />}
        Salvar
      </Button>
    </div>
  );
}
