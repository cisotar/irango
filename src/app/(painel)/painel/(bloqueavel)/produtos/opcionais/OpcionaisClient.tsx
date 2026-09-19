"use client";

import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { AlertDialog } from "@base-ui/react/alert-dialog";
import {
  MoreVertical,
  Pencil,
  Plus,
  Search,
  Trash2,
  Loader2,
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
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuPortal,
  MenuPositioner,
  MenuTrigger,
} from "@/components/ui/menu";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { formatarMoeda } from "@/lib/utils/formatarMoeda";
import {
  schemaCategoriaOpcional,
  schemaOpcional,
} from "@/lib/validacoes/opcional";
import type {
  CategoriaOpcional,
  Opcional,
} from "@/lib/supabase/queries/opcionais";
import { CartaoAssociacaoOpcionais } from "@/components/painel/CartaoAssociacaoOpcionais";
import type {
  Associacao,
  CategoriaProduto,
  OpcionaisClientAcoes,
} from "@/components/painel/contrato-opcionais";
import {
  agruparOpcionaisPorGrupo,
  alcancePorGrupo as derivarAlcancePorGrupo,
  contarItensPorGrupo,
  ordemPorCategoria,
  selecionadosPorCategoria,
} from "@/lib/utils/derivar-associacao-opcionais";
import {
  ehTeclaDeNavegacaoHorizontal,
  proximoIndicePorTecla,
} from "@/lib/utils/navegacao-por-teclado";

/** As duas abas da página. O id é usado em `aria-controls`/`aria-labelledby`. */
type IdSecao = "biblioteca" | "por-categoria";

/** Ordem física das abas — é o que ←/→/Home/End percorrem. */
const ORDEM_ABAS: readonly IdSecao[] = ["biblioteca", "por-categoria"];

/** 44px literal — `size="icon-sm"` daria 33,6px na base de 120% (design-system §5). */
const ALVO_TOQUE = "min-h-[44px] min-w-[44px]";

export type OpcionaisClientProps = {
  categoriasOpcional: CategoriaOpcional[];
  opcionais: Opcional[];
  categoriasProduto: CategoriaProduto[];
  associacoes: Associacao[];
  acoes: OpcionaisClientAcoes;
  /**
   * Aba aberta ao montar. Existe como costura de TESTE: sem jsdom não há como
   * clicar na aba, e o painel de "por categoria" nunca seria renderizado por
   * `renderToStaticMarkup`. Em produção fica no default.
   */
  secaoInicial?: IdSecao;
};

export function OpcionaisClient({
  categoriasOpcional,
  opcionais,
  categoriasProduto,
  associacoes,
  acoes,
  secaoInicial = "biblioteca",
}: OpcionaisClientProps) {
  const navRef = useRef<HTMLElement>(null);
  /** Marcador NÃO-sticky logo antes da barra: o `getBoundingClientRect` da
   *  própria barra mente quando ela já está grudada no topo. */
  const ancoraRef = useRef<HTMLDivElement>(null);
  const painelRef = useRef<HTMLDivElement>(null);
  const [espacoFinal, setEspacoFinal] = useState(0);
  const [secaoAtiva, setSecaoAtiva] = useState<IdSecao>(secaoInicial);

  /**
   * O contêiner que realmente rola é o `<main>` do layout do painel
   * (`overflow-y-auto`), não a janela — `window.scrollTo` aqui não faz nada.
   * Sobe na árvore até achar quem tem overflow de rolagem.
   */
  const acharRolador = useCallback((de: HTMLElement | null): HTMLElement => {
    let no = de?.parentElement ?? null;
    while (no != null) {
      const { overflowY } = getComputedStyle(no);
      if (overflowY === "auto" || overflowY === "scroll") return no;
      no = no.parentElement;
    }
    return document.documentElement;
  }, []);

  /*
    Filler no fim: para a seção encostar embaixo da barra, o conteúdo depois da
    barra precisa ter ao menos uma tela de altura. Com "Bebidas — 0 incluídos"
    a página é curta demais e a rolagem para antes. O vazio é medido, não
    chutado: sobra exata entre a altura do rolador e o que já existe.
  */
  const recalcularEspaco = useCallback(() => {
    const barra = navRef.current;
    const painel = painelRef.current;
    if (barra == null || painel == null) return;
    const rolador = acharRolador(barra);
    const falta =
      rolador.clientHeight -
      barra.getBoundingClientRect().height -
      painel.getBoundingClientRect().height;
    setEspacoFinal(Math.max(0, Math.ceil(falta)));
  }, [acharRolador]);

  useLayoutEffect(() => {
    recalcularEspaco();
    if (typeof ResizeObserver === "undefined") return;
    // O painel muda de altura ao abrir/fechar sanfona e ao trocar de aba.
    const observer = new ResizeObserver(recalcularEspaco);
    if (painelRef.current != null) observer.observe(painelRef.current);
    if (navRef.current != null) observer.observe(navRef.current);
    return () => observer.disconnect();
  }, [recalcularEspaco, secaoAtiva]);

  /**
   * Troca de aba: marca o estado e ROLA até a barra grudar no topo, para a
   * seção escolhida ficar imediatamente abaixo dela. O scroll é o feedback de
   * que a troca aconteceu — sem ele a página só pisca.
   */
  const trocarSecao = useCallback(
    (id: IdSecao) => {
      setSecaoAtiva(id);
      const barra = navRef.current;
      const ancora = ancoraRef.current;
      if (barra == null || ancora == null) return;
      const rolador = acharRolador(barra);
      const alvo =
        ancora.getBoundingClientRect().top -
        rolador.getBoundingClientRect().top +
        rolador.scrollTop;
      const suave = window.matchMedia("(prefers-reduced-motion: no-preference)")
        .matches;
      // Depois da pintura: o painel novo muda a altura e, sem esperar, o
      // destino seria calculado sobre o layout velho.
      requestAnimationFrame(() => {
        rolador.scrollTo({ top: alvo, behavior: suave ? "smooth" : "auto" });
      });
    },
    [acharRolador],
  );

  /**
   * Padrão WAI-ARIA APG de `tablist`: ←/→ (com volta ao extremo oposto) e
   * Home/End andam entre abas, ativando na hora — mesmo efeito do clique,
   * incluindo o scroll de `trocarSecao`. O foco SEGUE a seleção: só a aba
   * ativa fica em `tabIndex 0` (ver `AbaSecao`), então sem mover o foco a
   * tecla Tab seguinte pularia para o painel da aba errada.
   */
  const aoTeclarNaAba = useCallback(
    (evento: KeyboardEvent<HTMLDivElement>, atual: IdSecao) => {
      if (!ehTeclaDeNavegacaoHorizontal(evento.key)) return;
      evento.preventDefault();
      const indiceAtual = ORDEM_ABAS.indexOf(atual);
      const proximoIndice = proximoIndicePorTecla(
        evento.key,
        indiceAtual,
        ORDEM_ABAS.length,
      );
      const proximoId = ORDEM_ABAS[proximoIndice];
      trocarSecao(proximoId);
      navRef.current
        ?.querySelector<HTMLButtonElement>(`#aba-${proximoId}`)
        ?.focus();
    },
    [trocarSecao],
  );

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-6">
      <div className="mb-4">
        <h1 className="font-heading text-xl font-semibold text-foreground">
          Opcionais
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Monte a biblioteca de opcionais e escolha quais aparecem em cada
          categoria de produto.
        </p>
      </div>

      {/* Marcador não-sticky: é ele que diz onde a barra COMEÇA. A própria
          barra, já grudada, devolveria sempre topo 0. */}
      <div ref={ancoraRef} aria-hidden />

      {/* Abas de verdade (não mais âncoras): só um painel existe por vez, então
          a semântica correta é `tablist`/`tab`/`tabpanel`. Fundo `bg-fundo` (o
          creme da própria página, não o branco do `bg-background`): sem fundo o
          conteúdo rola por trás; com branco vira card extra. `-mx-4 px-4` sangra
          até a borda para nada espiar pelos lados. */}
      <nav
        ref={navRef}
        className="sticky top-0 z-20 -mx-4 mb-6 bg-fundo px-4 py-2"
      >
        <div
          role="tablist"
          aria-label="Seções desta página"
          onKeyDown={(e) => aoTeclarNaAba(e, secaoAtiva)}
          className="flex gap-1 rounded-xl border border-border bg-card p-1"
        >
          <AbaSecao
            id="biblioteca"
            ativo={secaoAtiva === "biblioteca"}
            onSelecionar={trocarSecao}
          >
            Biblioteca
          </AbaSecao>
          <AbaSecao
            id="por-categoria"
            ativo={secaoAtiva === "por-categoria"}
            onSelecionar={trocarSecao}
          >
            Por categoria de produto
          </AbaSecao>
        </div>
      </nav>

      <div ref={painelRef}>
        {secaoAtiva === "biblioteca" ? (
          <BibliotecaOpcionais
            categoriasOpcional={categoriasOpcional}
            opcionais={opcionais}
            acoes={acoes}
          />
        ) : (
          <AssociacaoOpcionais
            categoriasOpcional={categoriasOpcional}
            opcionais={opcionais}
            categoriasProduto={categoriasProduto}
            associacoes={associacoes}
            acoes={acoes}
          />
        )}
      </div>

      {/* Vazio medido: sem ele a rolagem para antes de a barra grudar no topo
          quando o painel é curto. Só background, nada dentro. */}
      <div aria-hidden style={{ height: espacoFinal }} />
    </main>
  );
}

/** Pílula da aba (mockup aprovado). `flex-1`: as duas dividem o espaço do
 *  contêiner igual — sem isso ficam do tamanho do texto, coladas à esquerda.
 *  `<button>` e não `<a href="#...">`: só um painel existe por vez, então não
 *  há âncora para onde navegar. 44px literais no alvo de toque. */
function AbaSecao({
  id,
  ativo,
  onSelecionar,
  children,
}: {
  id: IdSecao;
  ativo: boolean;
  onSelecionar: (id: IdSecao) => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      id={`aba-${id}`}
      aria-selected={ativo}
      aria-controls={id}
      // A aba inativa sai da ordem de tabulação: ←/→/Home/End (tratados em
      // `aoTeclarNaAba`, no pai) é que andam entre abas — Tab salta para o
      // painel.
      tabIndex={ativo ? 0 : -1}
      onClick={() => onSelecionar(id)}
      className={`${ALVO_TOQUE} flex flex-1 items-center justify-center rounded-lg px-4 text-center text-sm font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50 ${
        ativo
          ? "bg-primary text-primary-foreground"
          : "text-muted-foreground hover:bg-muted"
      }`}
    >
      {children}
    </button>
  );
}

// ── 088 — biblioteca: categorias de opcional + itens ────────────────────────

function BibliotecaOpcionais({
  categoriasOpcional,
  opcionais,
  acoes,
}: {
  categoriasOpcional: CategoriaOpcional[];
  opcionais: Opcional[];
  acoes: OpcionaisClientAcoes;
}) {
  const router = useRouter();
  const [busca, setBusca] = useState("");

  // Sheets de form. null => criar.
  const [catForm, setCatForm] = useState<{
    aberto: boolean;
    cat: CategoriaOpcional | null;
  }>({ aberto: false, cat: null });
  const [opcForm, setOpcForm] = useState<{
    aberto: boolean;
    opc: Opcional | null;
    categoriaOpcionalId: string | null;
  }>({ aberto: false, opc: null, categoriaOpcionalId: null });

  const [catARemover, setCatARemover] = useState<CategoriaOpcional | null>(
    null,
  );
  const [opcARemover, setOpcARemover] = useState<Opcional | null>(null);
  const [removendoCat, startRemoverCat] = useTransition();
  const [removendoOpc, startRemoverOpc] = useTransition();
  const [alternando, startAlternar] = useTransition();

  const buscaNorm = busca.trim().toLowerCase();

  /*
    A busca filtra ITENS; enquanto ela existe, categoria SEM match some da tela.
    Antes da 213 as 12 categorias continuavam renderizadas e 11 diziam "Nenhum
    item nesta categoria" — o resultado ficava escondido dentro do ruído.
    Sem busca, a categoria vazia continua aparecendo (é ali que se cria o
    primeiro item dela).
  */
  const grupos = useMemo(() => {
    const todos = categoriasOpcional.map((cat) => ({
      cat,
      itens: opcionais
        .filter((o) => o.categoria_opcional_id === cat.id)
        .filter(
          (o) => !buscaNorm || o.nome.toLowerCase().includes(buscaNorm),
        ),
    }));
    return buscaNorm ? todos.filter((g) => g.itens.length > 0) : todos;
  }, [categoriasOpcional, opcionais, buscaNorm]);

  function aoSalvar() {
    setCatForm({ aberto: false, cat: null });
    setOpcForm({ aberto: false, opc: null, categoriaOpcionalId: null });
    router.refresh();
  }

  function confirmarRemoverCat() {
    if (!catARemover) return;
    const id = catARemover.id;
    startRemoverCat(async () => {
      const r = await acoes.removerCategoriaOpcional(id);
      if (!r.ok) {
        toast.error(r.erro);
        return;
      }
      toast.success("Categoria removida.");
      setCatARemover(null);
      router.refresh();
    });
  }

  function confirmarRemoverOpc() {
    if (!opcARemover) return;
    const id = opcARemover.id;
    startRemoverOpc(async () => {
      const r = await acoes.removerOpcional(id);
      if (!r.ok) {
        toast.error(r.erro);
        return;
      }
      toast.success("Opcional removido.");
      setOpcARemover(null);
      router.refresh();
    });
  }

  function alternar(o: Opcional) {
    startAlternar(async () => {
      const r = await acoes.alternarOpcionalAtivo(o.id, !o.ativo);
      if (!r.ok) {
        toast.error(r.erro);
        return;
      }
      router.refresh();
    });
  }

  return (
    <section id="biblioteca" role="tabpanel" aria-labelledby="aba-biblioteca">
      <div className="mb-4 flex items-center justify-between gap-2">
        <h2 className="font-heading text-lg font-semibold text-foreground">
          Biblioteca
        </h2>
        <Button onClick={() => setCatForm({ aberto: true, cat: null })}>
          <Plus className="size-4" />
          Nova categoria
        </Button>
      </div>

      <div className="relative mb-4">
        <Search
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
        />
        {/* `bg-card` e `h-11`: o Input do projeto é `bg-transparent h-8` e,
            sobre o creme da página, vira uma linha fina. O mockup mostra campo
            BRANCO e com respiro. */}
        <Input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar opcional por nome…"
          aria-label="Buscar opcional por nome"
          className="h-11 rounded-xl bg-card pl-9"
        />
      </div>

      {categoriasOpcional.length === 0 && (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            Nenhuma categoria de opcional ainda. Crie a primeira com &ldquo;Nova
            categoria&rdquo;.
          </CardContent>
        </Card>
      )}

      {categoriasOpcional.length > 0 && grupos.length === 0 && (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            Nenhum opcional encontrado para &ldquo;{busca.trim()}&rdquo;.
          </CardContent>
        </Card>
      )}

      {/*
        O nome da categoria virou o HEADER do Card, com `border-b` e a contagem
        num Badge: antes ele era um `text-sm text-muted-foreground` FORA do
        cartão enquanto o item era `font-medium text-foreground` DENTRO — o
        filho pesava mais que o pai. Sanfona ABERTA por padrão (mesma decisão do
        `ProdutosClient`: a tela não muda de comportamento para quem nunca vai
        fechar nada).
      */}
      <Accordion
        multiple
        defaultValue={categoriasOpcional.map((c) => c.id)}
        className="gap-4"
      >
        {grupos.map(({ cat, itens }) => (
          <AccordionItem
            key={cat.id}
            value={cat.id}
            className="not-last:border-b-0"
          >
            <Card>
              {/* O gatilho da sanfona é um <button>; as ações da categoria ficam
                  FORA dele (button aninhado é HTML inválido). */}
              <div className="flex items-center justify-between gap-2 border-b px-4 [&>h3]:min-w-0 [&>h3]:flex-1">
                <AccordionTrigger className="min-h-[44px] font-heading text-base font-semibold text-foreground">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate">{cat.nome}</span>
                    <Badge variant="outline">
                      {itens.length} {itens.length === 1 ? "item" : "itens"}
                    </Badge>
                  </span>
                </AccordionTrigger>
                <div className="flex shrink-0 items-center">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="min-h-[44px]"
                    aria-label={`Novo item em ${cat.nome}`}
                    onClick={() =>
                      setOpcForm({
                        aberto: true,
                        opc: null,
                        categoriaOpcionalId: cat.id,
                      })
                    }
                  >
                    <Plus className="size-4" />
                    <span className="hidden sm:inline">Item</span>
                  </Button>
                  {/* Editar/Remover consolidados no kebab: os dois ícones em
                      `size="icon-sm"` davam 33,6px, abaixo dos 44px da régua. */}
                  <Menu>
                    <MenuTrigger
                      render={
                        <Button
                          variant="ghost"
                          size="sm"
                          className={ALVO_TOQUE}
                          aria-label={`Mais ações da categoria ${cat.nome}`}
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
                            onClick={() => setCatForm({ aberto: true, cat })}
                          >
                            <Pencil aria-hidden className="size-4" />
                            Editar categoria
                          </MenuItem>
                          <MenuItem
                            className="min-h-[44px] text-destructive"
                            onClick={() => setCatARemover(cat)}
                          >
                            <Trash2 aria-hidden className="size-4" />
                            Remover categoria
                          </MenuItem>
                        </MenuPopup>
                      </MenuPositioner>
                    </MenuPortal>
                  </Menu>
                </div>
              </div>

              <AccordionContent className="pt-0 pb-0">
                <CardContent className="divide-y divide-foreground/10 p-0">
                  {itens.length === 0 && (
                    <div className="px-4 py-3 text-sm text-muted-foreground">
                      Nenhum item nesta categoria.
                    </div>
                  )}
                  {itens.map((o) => (
                    <div
                      key={o.id}
                      className="flex items-center gap-3 px-4 py-3"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate font-medium text-foreground">
                            {o.nome}
                          </span>
                          {!o.ativo && <Badge variant="outline">Inativo</Badge>}
                        </div>
                        <span className="text-sm text-muted-foreground">
                          +{formatarMoeda(o.preco)}
                        </span>
                      </div>

                      <label
                        className={`${ALVO_TOQUE} flex cursor-pointer items-center justify-center`}
                      >
                        <Switch
                          checked={o.ativo}
                          disabled={alternando}
                          onCheckedChange={() => alternar(o)}
                          aria-label={`${o.ativo ? "Desativar" : "Ativar"} ${o.nome}`}
                        />
                      </label>

                      <Menu>
                        <MenuTrigger
                          render={
                            <Button
                              variant="ghost"
                              size="sm"
                              className={ALVO_TOQUE}
                              aria-label={`Mais ações de ${o.nome}`}
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
                                onClick={() =>
                                  setOpcForm({
                                    aberto: true,
                                    opc: o,
                                    categoriaOpcionalId:
                                      o.categoria_opcional_id,
                                  })
                                }
                              >
                                <Pencil aria-hidden className="size-4" />
                                Editar
                              </MenuItem>
                              <MenuItem
                                className="min-h-[44px] text-destructive"
                                onClick={() => setOpcARemover(o)}
                              >
                                <Trash2 aria-hidden className="size-4" />
                                Remover
                              </MenuItem>
                            </MenuPopup>
                          </MenuPositioner>
                        </MenuPortal>
                      </Menu>
                    </div>
                  ))}
                </CardContent>
              </AccordionContent>
            </Card>
          </AccordionItem>
        ))}
      </Accordion>

      {/* Sheet categoria de opcional */}
      <Sheet
        open={catForm.aberto}
        onOpenChange={(aberto) =>
          setCatForm((s) => ({ ...s, aberto }))
        }
      >
        <SheetContent className="overflow-y-auto">
          <SheetHeader>
            <SheetTitle>
              {catForm.cat ? "Editar categoria" : "Nova categoria"}
            </SheetTitle>
            <SheetDescription>
              Agrupe os opcionais (ex.: Laticínios, Charcutaria).
            </SheetDescription>
          </SheetHeader>
          <div className="px-4 pb-4">
            <Separator className="mb-4" />
            <FormCategoriaOpcional
              key={catForm.cat?.id ?? "nova"}
              inicial={catForm.cat}
              onSucesso={aoSalvar}
              acoes={acoes}
            />
          </div>
        </SheetContent>
      </Sheet>

      {/* Sheet opcional (item) */}
      <Sheet
        open={opcForm.aberto}
        onOpenChange={(aberto) =>
          setOpcForm((s) => ({ ...s, aberto }))
        }
      >
        <SheetContent className="overflow-y-auto">
          <SheetHeader>
            <SheetTitle>
              {opcForm.opc ? "Editar opcional" : "Novo opcional"}
            </SheetTitle>
            <SheetDescription>
              Item adicional pago, escolhido pelo cliente no produto.
            </SheetDescription>
          </SheetHeader>
          <div className="px-4 pb-4">
            <Separator className="mb-4" />
            <FormOpcional
              key={opcForm.opc?.id ?? `novo-${opcForm.categoriaOpcionalId}`}
              inicial={opcForm.opc}
              categoriasOpcional={categoriasOpcional}
              categoriaOpcionalIdPadrao={opcForm.categoriaOpcionalId}
              onSucesso={aoSalvar}
              acoes={acoes}
            />
          </div>
        </SheetContent>
      </Sheet>

      {/* Confirmação remover categoria */}
      <DialogConfirmarRemocao
        aberto={catARemover !== null}
        titulo="Remover categoria"
        descricao={
          catARemover
            ? `Remover "${catARemover.nome}" e todos os seus opcionais? Esta ação não pode ser desfeita.`
            : ""
        }
        carregando={removendoCat}
        onConfirmar={confirmarRemoverCat}
        onFechar={() => setCatARemover(null)}
      />

      {/* Confirmação remover opcional */}
      <DialogConfirmarRemocao
        aberto={opcARemover !== null}
        titulo="Remover opcional"
        descricao={
          opcARemover
            ? `Remover "${opcARemover.nome}"? Pedidos anteriores não são afetados.`
            : ""
        }
        carregando={removendoOpc}
        onConfirmar={confirmarRemoverOpc}
        onFechar={() => setOpcARemover(null)}
      />
    </section>
  );
}

function FormCategoriaOpcional({
  inicial,
  onSucesso,
  acoes,
}: {
  inicial: CategoriaOpcional | null;
  onSucesso: () => void;
  acoes: OpcionaisClientAcoes;
}) {
  const ehEdicao = inicial != null;
  const [nome, setNome] = useState(inicial?.nome ?? "");
  const [ordem, setOrdem] = useState(String(inicial?.ordem ?? 0));
  const [enviando, startEnvio] = useTransition();

  function salvar() {
    const payload = { nome: nome.trim(), ordem: Number(ordem) || 0 };
    const parsed = schemaCategoriaOpcional.safeParse(payload);
    if (!parsed.success) {
      toast.error("Confira os dados da categoria.");
      return;
    }
    startEnvio(async () => {
      const r =
        ehEdicao && inicial
          ? await acoes.atualizarCategoriaOpcional(inicial.id, parsed.data)
          : await acoes.criarCategoriaOpcional(parsed.data);
      if (!r.ok) {
        toast.error(r.erro);
        return;
      }
      toast.success("Categoria salva!");
      onSucesso();
    });
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        salvar();
      }}
    >
      <div className="space-y-1">
        <Label htmlFor="cat-opc-nome">Nome</Label>
        <Input
          id="cat-opc-nome"
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          placeholder="Ex.: Laticínios"
          required
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="cat-opc-ordem">Ordem</Label>
        <Input
          id="cat-opc-ordem"
          value={ordem}
          onChange={(e) => setOrdem(e.target.value)}
          inputMode="numeric"
          placeholder="0"
        />
      </div>
      <Button type="submit" className="w-full" disabled={enviando}>
        {enviando && <Loader2 className="mr-2 size-4 animate-spin" />}
        {ehEdicao ? "Salvar alterações" : "Criar categoria"}
      </Button>
    </form>
  );
}

function FormOpcional({
  inicial,
  categoriasOpcional,
  categoriaOpcionalIdPadrao,
  onSucesso,
  acoes,
}: {
  inicial: Opcional | null;
  categoriasOpcional: CategoriaOpcional[];
  categoriaOpcionalIdPadrao: string | null;
  onSucesso: () => void;
  acoes: OpcionaisClientAcoes;
}) {
  const ehEdicao = inicial != null;
  const [nome, setNome] = useState(inicial?.nome ?? "");
  const [preco, setPreco] = useState(
    inicial?.preco != null ? String(inicial.preco) : "",
  );
  const [categoriaOpcionalId, setCategoriaOpcionalId] = useState(
    inicial?.categoria_opcional_id ?? categoriaOpcionalIdPadrao ?? "",
  );
  const [ativo, setAtivo] = useState(inicial?.ativo ?? true);
  const [ordem, setOrdem] = useState(String(inicial?.ordem ?? 0));
  const [enviando, startEnvio] = useTransition();

  function salvar() {
    // Aceita vírgula decimal (UX pt-BR).
    const precoNumero = Number(preco.replace(",", "."));
    const payload = {
      nome: nome.trim(),
      preco: precoNumero,
      categoria_opcional_id: categoriaOpcionalId,
      ativo,
      ordem: Number(ordem) || 0,
    };
    const parsed = schemaOpcional.safeParse(payload);
    if (!parsed.success) {
      toast.error("Confira os dados do opcional.");
      return;
    }
    startEnvio(async () => {
      const r =
        ehEdicao && inicial
          ? await acoes.atualizarOpcional(inicial.id, parsed.data)
          : await acoes.criarOpcional(parsed.data);
      if (!r.ok) {
        toast.error(r.erro);
        return;
      }
      toast.success("Opcional salvo!");
      onSucesso();
    });
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        salvar();
      }}
    >
      <div className="space-y-1">
        <Label htmlFor="opc-nome">Nome</Label>
        <Input
          id="opc-nome"
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          placeholder="Ex.: Brie extra"
          required
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="opc-preco">Acréscimo (R$)</Label>
        <Input
          id="opc-preco"
          value={preco}
          onChange={(e) => setPreco(e.target.value)}
          placeholder="0,00"
          inputMode="decimal"
          required
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="opc-categoria">Categoria de opcional</Label>
        <select
          id="opc-categoria"
          value={categoriaOpcionalId}
          onChange={(e) => setCategoriaOpcionalId(e.target.value)}
          className="flex h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
          required
        >
          <option value="">Selecione…</option>
          {categoriasOpcional.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nome}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-1">
        <Label htmlFor="opc-ordem">Ordem</Label>
        <Input
          id="opc-ordem"
          value={ordem}
          onChange={(e) => setOrdem(e.target.value)}
          inputMode="numeric"
          placeholder="0"
        />
      </div>
      <label className="flex cursor-pointer items-center gap-2 text-sm">
        <Switch checked={ativo} onCheckedChange={(v) => setAtivo(v === true)} />
        <span className="text-foreground">Ativo na vitrine</span>
      </label>
      <Button type="submit" className="w-full" disabled={enviando}>
        {enviando && <Loader2 className="mr-2 size-4 animate-spin" />}
        {ehEdicao ? "Salvar alterações" : "Criar opcional"}
      </Button>
    </form>
  );
}

// ── 089 — associação categoria de produto ⋈ categorias de opcional ──────────

function AssociacaoOpcionais({
  categoriasOpcional,
  opcionais,
  categoriasProduto,
  associacoes,
  acoes,
}: {
  categoriasOpcional: CategoriaOpcional[];
  opcionais: Opcional[];
  categoriasProduto: CategoriaProduto[];
  associacoes: Associacao[];
  acoes: OpcionaisClientAcoes;
}) {
  const router = useRouter();

  /*
    As cinco derivações são PURAS e moram em
    `lib/utils/derivar-associacao-opcionais.ts` (issue 217): o mesmo cartão é
    montado pelo modal de `/painel/produtos`, e duas cópias do comparador
    `ordem || id` divergiriam em silêncio. Os `useMemo` ficam — o que saiu foi
    o corpo.
  */

  /** Conjunto PERSISTIDO por categoria de produto → set de categoria_opcional_id. */
  const inicialPorProduto = useMemo(
    () => selecionadosPorCategoria(associacoes),
    [associacoes],
  );

  /** `ordem` gravada (208). Vem SEMPRE das props: todo toggle e toda
      reordenação terminam em `router.refresh()`, e é por aqui que a ordem
      recém-gravada volta. */
  const ordemPorProduto = useMemo(
    () => ordemPorCategoria(associacoes),
    [associacoes],
  );

  /** `categoria_opcional_id → itens do grupo` (216), ativos E inativos. */
  const opcionaisPorGrupo = useMemo(
    () => agruparOpcionaisPorGrupo(opcionais),
    [opcionais],
  );

  /** `categoria_opcional_id → nº de itens`, para o `detalhe` de cada linha. */
  const totalItensPorGrupo = useMemo(
    () => contarItensPorGrupo(opcionaisPorGrupo),
    [opcionaisPorGrupo],
  );

  /*
    ALCANCE (216): `categoria_opcional_id → nomes das categorias de PRODUTO que
    usam o grupo`. Derivado de `associacoes` ⋈ `categoriasProduto`, ambas já
    props e ambas dados RLS-escopados da própria loja: nenhuma leitura nova,
    nenhum vetor cross-tenant.
  */
  const alcancePorGrupo = useMemo(
    () => derivarAlcancePorGrupo(associacoes, categoriasProduto),
    [associacoes, categoriasProduto],
  );

  return (
    <section id="por-categoria" role="tabpanel" aria-labelledby="aba-por-categoria">
      <h2 className="mb-1 font-heading text-lg font-semibold text-foreground">
        Opcionais por categoria de produto
      </h2>
      <p className="mb-4 text-sm text-muted-foreground">
        Escolha quais categorias de opcional aparecem para os produtos de cada
        categoria, e em que ordem. Quem não tiver nenhuma marcada fica &ldquo;sem
        opcionais&rdquo;.
      </p>

      {categoriasProduto.length === 0 && (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            Crie categorias de produto primeiro para associar opcionais.
          </CardContent>
        </Card>
      )}

      {/*
        Só a PRIMEIRA nasce aberta (decisão do usuário, sem limiar por
        quantidade): com 12 categorias de produto abertas a página viraria um
        rolo, e a lista segmentada de cada cartão é alta.
      */}
      <Accordion
        multiple
        defaultValue={categoriasProduto.slice(0, 1).map((c) => c.id)}
        className="gap-4"
      >
        {categoriasProduto.map((catProd) => (
          <CartaoAssociacaoOpcionais
            key={catProd.id}
            categoriaProduto={catProd}
            categoriasOpcional={categoriasOpcional}
            selecionadosIniciais={inicialPorProduto.get(catProd.id) ?? new Set()}
            ordemPorGrupo={ordemPorProduto.get(catProd.id) ?? new Map()}
            totalItensPorGrupo={totalItensPorGrupo}
            opcionaisPorGrupo={opcionaisPorGrupo}
            alcancePorGrupo={alcancePorGrupo}
            onSalvo={() => router.refresh()}
            acoes={acoes}
          />
        ))}
      </Accordion>
    </section>
  );
}

// ── auxiliar — diálogo de confirmação de remoção ────────────────────────────

function DialogConfirmarRemocao({
  aberto,
  titulo,
  descricao,
  carregando,
  onConfirmar,
  onFechar,
}: {
  aberto: boolean;
  titulo: string;
  descricao: string;
  carregando: boolean;
  onConfirmar: () => void;
  onFechar: () => void;
}) {
  return (
    <AlertDialog.Root
      open={aberto}
      onOpenChange={(estaAberto) => {
        if (!estaAberto) onFechar();
      }}
    >
      <AlertDialog.Portal>
        <AlertDialog.Backdrop className="fixed inset-0 z-50 bg-black/30 transition-opacity data-ending-style:opacity-0 data-starting-style:opacity-0" />
        <AlertDialog.Popup className="fixed top-1/2 left-1/2 z-50 w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-xl bg-popover p-5 text-popover-foreground shadow-lg transition-all data-ending-style:opacity-0 data-starting-style:opacity-0">
          <AlertDialog.Title className="font-heading text-base font-medium text-foreground">
            {titulo}
          </AlertDialog.Title>
          <AlertDialog.Description className="mt-1 text-sm text-muted-foreground">
            {descricao}
          </AlertDialog.Description>
          <div className="mt-5 flex justify-end gap-2">
            <AlertDialog.Close
              render={<Button variant="outline" disabled={carregando} />}
            >
              Cancelar
            </AlertDialog.Close>
            <Button
              variant="destructive"
              disabled={carregando}
              onClick={onConfirmar}
            >
              {carregando && <Loader2 className="mr-2 size-4 animate-spin" />}
              Remover
            </Button>
          </div>
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
