"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
import { AlertDialog } from "@base-ui/react/alert-dialog";
import {
  ArrowUpDown,
  Pencil,
  Plus,
  Trash2,
  Loader2,
  SlidersHorizontal,
  EyeOff,
  MoreVertical,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
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
import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuPortal,
  MenuPositioner,
  MenuTrigger,
} from "@/components/ui/menu";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { FormProduto, type Categoria } from "@/components/painel/FormProduto";
import { ThumbProduto } from "@/components/painel/ThumbProduto";
import { GerenciarCategorias } from "@/components/painel/GerenciarCategorias";
import {
  ReordenarCategorias,
  type ManipuladorReordenarCategorias,
} from "@/components/painel/ReordenarCategorias";
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
  reordenarCategorias as reordenarCategoriasLojista,
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
    reordenarCategorias?: typeof reordenarCategoriasLojista;
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
  // Categoria pré-selecionada ao criar pelo botão do header de um card
  // (null => criar global, sem pré-seleção). Segue o padrão de `emEdicao`:
  // não reseta no fechamento — cada `abrir*` define o valor fresco.
  const [categoriaNovoProduto, setCategoriaNovoProduto] = useState<
    string | null
  >(null);
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

  // Modo "Reordenar categorias" (issue 175). Fica no pai porque é ele que troca
  // a barra de ações; a LISTA do modo mora em `ReordenarCategorias`.
  const [modoReordenar, setModoReordenar] = useState(false);
  // Handle da lista: o pai precisa AGUARDAR o salvamento pendente antes de
  // desmontá-la e de chamar `router.refresh()` (ver `sairDoModoReordenar`).
  const reordenarRef = useRef<ManipuladorReordenarCategorias>(null);
  // Guard de reentrância enquanto o flush está em voo (ESC repetido, duplo
  // clique em Concluir). Ref, não estado: não deve provocar render.
  const saindoDoModoRef = useRef(false);

  const grupos = useMemo(
    () => agruparPorCategoria(produtos, categorias),
    [produtos, categorias],
  );

  /**
   * `categoria_id → nº de produtos`. Contado sobre TODOS os produtos, não sobre
   * `grupos`: `agruparPorCategoria` descarta as categorias vazias, e o modo
   * reordenar precisa mostrar "0 produtos" para elas.
   */
  const contagemPorCategoria = useMemo(() => {
    const contagem: Record<string, number> = {};
    for (const p of produtos) {
      if (p.categoria_id == null) continue;
      contagem[p.categoria_id] = (contagem[p.categoria_id] ?? 0) + 1;
    }
    return contagem;
  }, [produtos]);

  const temSemCategoria = useMemo(
    () => produtos.some((p) => p.categoria_id == null),
    [produtos],
  );

  /**
   * Gate do botão: sobre `categorias.length` (TODAS), nunca `grupos.length`
   * (que esconde as vazias). 0 ou 1 categoria não tem ordem — e um botão
   * desabilitado ali só produziria "por que não funciona?" sem resposta na tela.
   */
  const podeReordenar = categorias.length >= 2;

  /**
   * Saída do modo — Concluir e ESC passam os dois por aqui.
   *
   * O `await finalizar()` NÃO é decorativo: o modo salva com debounce de 500ms,
   * e mover uma categoria + sair antes disso descartava o movimento em silêncio
   * (o `router.refresh()` abaixo trazia a ordem ANTIGA). O contrato de interação
   * §5 promete o contrário: "sem risco de perda — cada movimento já foi
   * persistido". Daí a ORDEM: flush → desmonta → refresh. Fazer o flush no
   * cleanup da desmontagem correria com o refresh, e o refresh venceria.
   */
  const sairDoModoReordenar = useCallback(async () => {
    if (saindoDoModoRef.current) return; // ESC repetido / duplo clique
    saindoDoModoRef.current = true;
    try {
      await reordenarRef.current?.finalizar();
    } finally {
      saindoDoModoRef.current = false;
      setModoReordenar(false);
      router.refresh();
    }
  }, [router]);

  // ESC também sai do modo (expectativa de qualquer modo contextual).
  useEffect(() => {
    if (!modoReordenar) return;
    function aoTeclar(e: KeyboardEvent) {
      if (e.key === "Escape") void sairDoModoReordenar();
    }
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [modoReordenar, sairDoModoReordenar]);

  function abrirCriar() {
    abrirCriarNaCategoria(null);
  }

  function abrirCriarNaCategoria(categoriaId: string | null) {
    setCategoriaNovoProduto(categoriaId);
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
      // Recria o form ao alternar entre produtos / criar (global ou por
      // categoria) — o useState do select só lê `inicial` na montagem (RN-3).
      key={emEdicao?.id ?? `novo-${categoriaNovoProduto ?? ""}`}
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
          : categoriaNovoProduto != null
            ? // Sem `id` => FormProduto permanece em modo criar (RN-1);
              // a categoria é só valor inicial do select, editável.
              { categoria_id: categoriaNovoProduto }
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
        {/*
          Troca de BARRA, não toggle no mesmo botão: "+ Novo produto" e as ações
          de produto DESAPARECEM no modo, não ficam `disabled` — botão
          desabilitado sai da tabulação e não explica por que está inerte.
        */}
        {modoReordenar ? (
          <Button onClick={() => void sairDoModoReordenar()}>Concluir</Button>
        ) : (
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button variant="outline" onClick={() => setCategoriasAbertas(true)}>
              Categorias
            </Button>
            <Button onClick={abrirCriar}>
              <Plus className="size-4" />
              Novo produto
            </Button>
            {podeReordenar && (
              <Button
                variant="outline"
                onClick={() => setModoReordenar(true)}
              >
                <ArrowUpDown className="size-4" />
                Reordenar categorias
              </Button>
            )}
          </div>
        )}
      </div>

      {/* No modo reordenar a listagem normal dá lugar à lista de reordenação:
          é o que colapsa tudo e faz a tela ler de `categorias` (todas), e não de
          `grupos` (que esconde categoria vazia). */}
      {modoReordenar ? (
        <>
          <p className="mb-3 text-sm text-muted-foreground">
            Ordene as categorias. Categorias sem produtos aparecem só aqui.
          </p>
          <ReordenarCategorias
            ref={reordenarRef}
            categorias={categorias}
            contagemPorCategoria={contagemPorCategoria}
            temSemCategoria={temSemCategoria}
            onReordenar={acoes?.reordenarCategorias}
          />
        </>
      ) : (
        <>
          {produtos.length === 0 && (
            <Card>
              <CardContent className="py-8 text-center text-sm text-muted-foreground">
                Nenhum produto ainda. Crie o primeiro com &ldquo;Novo
                produto&rdquo;.
              </CardContent>
            </Card>
          )}

          {/* Sanfona na listagem NORMAL, todas ABERTAS por padrão: a tela não
              pode mudar de comportamento para quem nunca vai reordenar nada. */}
          <Accordion
            multiple
            defaultValue={grupos.map((g) => g.id ?? "sem-categoria")}
            className="gap-6"
          >
            {grupos.map((grupo) => (
              <AccordionItem
                key={grupo.id ?? "sem-categoria"}
                value={grupo.id ?? "sem-categoria"}
                className="not-last:border-b-0"
              >
                <Card>
                  {/* O gatilho da sanfona é um <button>; as ações da categoria
                      ficam FORA dele (button aninhado é HTML inválido). O <h3>
                      do AccordionHeader é quem cresce. */}
                  <div className="flex items-center justify-between gap-2 border-b px-4 [&>h3]:min-w-0 [&>h3]:flex-1">
                    <AccordionTrigger className="min-h-[44px] font-heading text-lg font-semibold text-foreground">
                      {grupo.nome}
                    </AccordionTrigger>
                    {grupo.id != null && (
                      <div className="flex shrink-0 items-center">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setCategoriaOpcionaisAberta(grupo)}
                        >
                          <SlidersHorizontal className="size-4" />
                          Opcionais
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={`Novo produto em ${grupo.nome}`}
                          onClick={() => abrirCriarNaCategoria(grupo.id)}
                        >
                          <Plus className="size-4" />
                          {/* Ícone-only no mobile para o header não estourar
                              (RN-5); o aria-label mantém o nome acessível. */}
                          <span className="hidden sm:inline">Novo produto</span>
                        </Button>
                      </div>
                    )}
                  </div>
                  <AccordionContent className="pt-0 pb-0">
                    <CardContent className="divide-y divide-foreground/10 p-0">
                      {grupo.produtos.map((p) => (
                        // `flex-wrap` + `items-start` é o coração do fix de layout
                        // mobile: em 360px os 7 filhos somavam ~433px de largura
                        // mínima e o bloco de texto (único flex-1) era esmagado.
                        // As classes `order-*` mantêm UMA árvore só: no mobile as
                        // ações quebram para a última linha; a partir de `sm` a
                        // ordem visual volta a ser thumb → texto → opcionais →
                        // ações → kebab numa linha só.
                        <div
                          key={p.id}
                          className="flex flex-wrap items-start gap-x-3 gap-y-2 px-4 py-3"
                        >
                          <ThumbProduto fotoUrl={p.foto_url} nome={p.nome} />
                          <div className="min-w-0 flex-1">
                            {/* `line-clamp-2` no lugar de `truncate`: em 360px o nome
                                cabe em duas linhas em vez de sumir. */}
                            <span className="line-clamp-2 text-base leading-snug font-semibold text-foreground">
                              {p.nome}
                            </span>
                            <div className="mt-1 flex flex-wrap items-center gap-2">
                              <span className="shrink-0 text-sm font-medium tabular-nums text-foreground">
                                {formatarMoeda(p.preco)}
                              </span>
                              {badgeStatus(p)}
                            </div>
                          </div>

                          {/* Editar/Remover consolidados no kebab: elimina os dois
                              ícones cortados na borda e afasta a ação destrutiva do
                              alvo de toque de "Marcar esgotado". */}
                          <Menu>
                            <MenuTrigger
                              render={
                                <Button
                                  variant="outline"
                                  size="icon"
                                  className="order-3 min-h-[44px] min-w-[44px] sm:order-last"
                                  aria-label={`Mais ações de ${p.nome}`}
                                />
                              }
                            >
                              <MoreVertical aria-hidden className="size-4" />
                            </MenuTrigger>
                            <MenuPortal>
                              <MenuPositioner align="end">
                                <MenuPopup>
                                  <MenuItem
                                    className="min-h-[44px]"
                                    aria-label={`Editar ${p.nome}`}
                                    onClick={() => abrirEditar(p)}
                                  >
                                    <Pencil aria-hidden className="size-4" />
                                    Editar
                                  </MenuItem>
                                  <MenuItem
                                    className="min-h-[44px]"
                                    aria-label={`Remover ${p.nome}`}
                                    onClick={() => setARemover(p)}
                                  >
                                    <Trash2
                                      aria-hidden
                                      className="size-4 text-destructive"
                                    />
                                    Remover
                                  </MenuItem>
                                </MenuPopup>
                              </MenuPositioner>
                            </MenuPortal>
                          </Menu>

                          {(() => {
                            const gruposOpcionais =
                              opcionaisPorCategoria[p.categoria_id ?? ""] ?? [];
                            if (gruposOpcionais.length === 0) return null;
                            return (
                              <ul className="order-4 flex w-full flex-wrap gap-1.5 sm:order-3 sm:w-auto">
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

                          {/* Alvo de toque: 44px LITERAL. `min-h-11` seria 2.75rem =
                              52.8px na base de 120% do projeto (globals.css). */}
                          <div className="order-last flex w-full basis-full gap-2 sm:order-4 sm:w-auto sm:basis-auto">
                            <Button
                              variant="outline"
                              size="sm"
                              className="min-h-[44px] flex-1 sm:flex-none"
                              disabled={
                                alternandoOculto && idAlternandoOculto === p.id
                              }
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
                              variant="outline"
                              size="sm"
                              className="min-h-[44px] flex-1 sm:flex-none"
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
                          </div>
                        </div>
                      ))}
                    </CardContent>
                  </AccordionContent>
                </Card>
              </AccordionItem>
            ))}
          </Accordion>
        </>
      )}

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
