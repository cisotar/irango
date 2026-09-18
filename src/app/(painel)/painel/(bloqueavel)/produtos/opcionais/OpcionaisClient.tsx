"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { AlertDialog } from "@base-ui/react/alert-dialog";
import {
  Check,
  MoreVertical,
  Pencil,
  Plus,
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
import { Checkbox } from "@/components/ui/checkbox";
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
import { medirEObservarBarra } from "@/components/vitrine/medicaoBarraVitrine";
import { alternarAssociacaoOpcional } from "@/lib/utils/alternar-associacao-opcional";
import {
  schemaCategoriaOpcional,
  schemaOpcional,
} from "@/lib/validacoes/opcional";
import type { StatusSalvamento } from "@/lib/utils/salvamento-coalescido";
import type {
  criarCategoriaOpcional,
  atualizarCategoriaOpcional,
  removerCategoriaOpcional,
  criarOpcional,
  atualizarOpcional,
  alternarOpcionalAtivo,
  removerOpcional,
  salvarAssociacaoOpcionais,
  reordenarOpcionaisDaCategoria,
} from "@/lib/actions/opcional";
import type {
  CategoriaOpcional,
  Opcional,
} from "@/lib/supabase/queries/opcionais";
import {
  ReordenarOpcionaisDaCategoria,
  type GrupoOpcionalReordenavel,
} from "@/components/painel/ReordenarOpcionaisDaCategoria";
import type { ManipuladorModoReordenar } from "@/components/painel/ModoReordenar";

/** Altura real da barra de navegação desta página, medida em runtime. */
const VAR_ALTURA_NAV = "--altura-nav-opcionais";

/** Fallback só vale até a primeira medição (e em browser sem ResizeObserver). */
const SCROLL_MT = `scroll-mt-[var(${VAR_ALTURA_NAV},4rem)]`;

type CategoriaProduto = { id: string; nome: string };
/** `ordem` (coluna da 208) é o que abre a lista na sequência da vitrine. */
type Associacao = {
  categoria_id: string;
  categoria_opcional_id: string;
  ordem: number;
};

/** 44px literal — `size="icon-sm"` daria 33,6px na base de 120% (design-system §5). */
const ALVO_TOQUE = "min-h-[44px] min-w-[44px]";

/**
 * Actions injetadas das 9 operações de opcionais. Todas OBRIGATÓRIAS (issue
 * 160): a page do painel passa as 9 do lojista, a via admin (137) passa as 9
 * variantes escopadas por `lojaId`. Sem default — omitir uma chave aqui quebra
 * o build em vez de cair na action do lojista (que resolve a loja por
 * `auth.uid()`) e gravar na loja errada. Tipadas via `typeof` (single-source,
 * espelha `ProdutosClient`).
 *
 * A 9ª (`reordenarOpcionaisDaCategoria`, issues 208/209) segue a mesma regra: é
 * escrita de ordem escopada por loja, e um default aqui seria exatamente o bug
 * que a 160 existe para impedir.
 */
export type OpcionaisClientAcoes = {
  criarCategoriaOpcional: typeof criarCategoriaOpcional;
  atualizarCategoriaOpcional: typeof atualizarCategoriaOpcional;
  removerCategoriaOpcional: typeof removerCategoriaOpcional;
  criarOpcional: typeof criarOpcional;
  atualizarOpcional: typeof atualizarOpcional;
  alternarOpcionalAtivo: typeof alternarOpcionalAtivo;
  removerOpcional: typeof removerOpcional;
  salvarAssociacaoOpcionais: typeof salvarAssociacaoOpcionais;
  reordenarOpcionaisDaCategoria: typeof reordenarOpcionaisDaCategoria;
};

export type OpcionaisClientProps = {
  categoriasOpcional: CategoriaOpcional[];
  opcionais: Opcional[];
  categoriasProduto: CategoriaProduto[];
  associacoes: Associacao[];
  acoes: OpcionaisClientAcoes;
};

export function OpcionaisClient({
  categoriasOpcional,
  opcionais,
  categoriasProduto,
  associacoes,
  acoes,
}: OpcionaisClientProps) {
  const navRef = useRef<HTMLElement>(null);

  /*
    A âncora tem que parar EMBAIXO da barra sticky, e a altura dela não é
    constante: "Por categoria de produto" quebra em duas linhas no celular.
    `scroll-mt` fixo seria o mesmo erro que a issue 201 corrigiu na vitrine —
    o valor antigo era coincidência. Por isso a altura é MEDIDA e publicada
    numa CSS var, reusando `medirEObservarBarra` (o módulo é neutro e recebe o
    nome da var por parâmetro desde a 213).

    `useLayoutEffect` e não `useEffect`: a var precisa existir antes da pintura,
    senão o primeiro clique numa âncora usa o fallback e para no lugar errado.
  */
  useLayoutEffect(() => {
    const barra = navRef.current;
    if (barra == null) return;
    return medirEObservarBarra(barra, {
      raiz: document.documentElement,
      ResizeObserverCtor:
        typeof ResizeObserver === "undefined" ? undefined : ResizeObserver,
      variavel: VAR_ALTURA_NAV,
    });
  }, []);

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

      {/*
        Âncoras, não `Tabs`: as duas seções COEXISTEM na mesma página e a
        semântica ARIA de tab esconderia um painel. O toggle só ROLA até a seção
        — sem rastrear a seção visível, sem IntersectionObserver e sem estado
        reativo de "seção ativa" a manter em sincronia com o scroll.
      */}
      <nav
        ref={navRef}
        aria-label="Seções desta página"
        className="sticky top-0 z-20 -mx-4 mb-6 border-b border-border bg-background/95 px-4 py-2 backdrop-blur"
      >
        <ul className="flex flex-wrap gap-2">
          <li>
            <LinkSecao href="#biblioteca">Biblioteca</LinkSecao>
          </li>
          <li>
            <LinkSecao href="#por-categoria">Por categoria de produto</LinkSecao>
          </li>
        </ul>
      </nav>

      <div className="space-y-10">
        <BibliotecaOpcionais
          categoriasOpcional={categoriasOpcional}
          opcionais={opcionais}
          acoes={acoes}
        />
        <Separator />
        <AssociacaoOpcionais
          categoriasOpcional={categoriasOpcional}
          opcionais={opcionais}
          categoriasProduto={categoriasProduto}
          associacoes={associacoes}
          acoes={acoes}
        />
      </div>
    </main>
  );
}

/** Pílula sólida do toggle (mockup aprovado). 44px literais no alvo de toque. */
function LinkSecao({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  return (
    <a
      href={href}
      className={`${ALVO_TOQUE} inline-flex items-center rounded-full bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors outline-none hover:bg-primary/90 focus-visible:ring-3 focus-visible:ring-ring/50`}
    >
      {children}
    </a>
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
    <section id="biblioteca" className={SCROLL_MT}>
      <div className="mb-4 flex items-center justify-between gap-2">
        <h2 className="font-heading text-lg font-semibold text-foreground">
          Biblioteca
        </h2>
        <Button onClick={() => setCatForm({ aberto: true, cat: null })}>
          <Plus className="size-4" />
          Nova categoria
        </Button>
      </div>

      <div className="mb-4">
        <Input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar opcional por nome…"
          aria-label="Buscar opcional por nome"
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

  // Conjunto atual por categoria de produto → set de categoria_opcional_id.
  const inicialPorProduto = useMemo(() => {
    const mapa = new Map<string, Set<string>>();
    for (const a of associacoes) {
      const set = mapa.get(a.categoria_id) ?? new Set<string>();
      set.add(a.categoria_opcional_id);
      mapa.set(a.categoria_id, set);
    }
    return mapa;
  }, [associacoes]);

  /*
    `ordem` gravada (208) por categoria de produto → grupo de opcional. Vem
    SEMPRE das props, nunca de estado: todo toggle e toda reordenação terminam
    em `router.refresh()`, e é por aqui que a ordem recém-gravada volta.
  */
  const ordemPorProduto = useMemo(() => {
    const mapa = new Map<string, Map<string, number>>();
    for (const a of associacoes) {
      const porGrupo = mapa.get(a.categoria_id) ?? new Map<string, number>();
      porGrupo.set(a.categoria_opcional_id, a.ordem);
      mapa.set(a.categoria_id, porGrupo);
    }
    return mapa;
  }, [associacoes]);

  /** `categoria_opcional_id → nº de itens`, só para o `detalhe` de cada linha. */
  const totalItensPorGrupo = useMemo(() => {
    const mapa = new Map<string, number>();
    for (const o of opcionais) {
      mapa.set(
        o.categoria_opcional_id,
        (mapa.get(o.categoria_opcional_id) ?? 0) + 1,
      );
    }
    return mapa;
  }, [opcionais]);

  return (
    <section id="por-categoria" className={SCROLL_MT}>
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
          <CartaoAssociacao
            key={catProd.id}
            categoriaProduto={catProd}
            categoriasOpcional={categoriasOpcional}
            selecionadosIniciais={inicialPorProduto.get(catProd.id) ?? new Set()}
            ordemPorGrupo={ordemPorProduto.get(catProd.id) ?? new Map()}
            totalItensPorGrupo={totalItensPorGrupo}
            onSalvo={() => router.refresh()}
            acoes={acoes}
          />
        ))}
      </Accordion>
    </section>
  );
}

/** "3 itens" / "1 item" — a singularização mora onde o domínio é conhecido. */
function rotuloItens(total: number): string {
  return `${total} ${total === 1 ? "item" : "itens"}`;
}

/**
 * Um cartão = uma categoria de PRODUTO (issue 213).
 *
 * ─────────────────────────────────────────── Um modo só
 * Antes havia dois que nunca coexistiam (grade de checkbox OU lista arrastável,
 * atrás de um botão "Reordenar" com gate de ≥2 marcados). Agora a lista já
 * nasce na ORDEM DA VITRINE com o checkbox na própria linha, e o salvamento é
 * automático: some o botão "Salvar" e some o gate.
 *
 * ─────────────────────────────────────────── Por que a lista é SEGMENTADA
 * Razão técnica, não estética: marcados e desmarcados no MESMO
 * `SortableContext` fariam o `closestCenter` do dnd-kit aceitar soltura na
 * região dos desmarcados e produzir posição para um grupo que NÃO tem linha em
 * `categoria_produto_opcionais` — a RPC confere `row_count` e derruba a
 * transação. Com dois segmentos, só os marcados entram no `SortableContext`.
 *
 * ─────────────────────────────────────────── A corrida do autosave
 * Um toggle disparado com um reorder ainda no debounce (500ms) mandaria à RPC
 * um conjunto de ids que não bate com as linhas persistidas → `row_count`
 * mismatch → erro genérico. Por isso o toggle AGUARDA o `finalizar()` do handle
 * imperativo ANTES de mexer no conjunto e de chamar `salvarAssociacaoOpcionais`.
 * Enquanto está em voo, alça e setas ficam `aria-disabled` — nunca `disabled`,
 * que tira da tabulação e perde o foco.
 *
 * ─────────────────────────────────────────── Desmarcar perde a posição
 * Decisão do usuário, sem confirmação: `planejarAssociacaoOpcionais` remove a
 * linha, e remarcar reinsere com `ordem = max(permanentes) + 1`, isto é, no FIM.
 * A UI só mostra a verdade que o banco já tinha.
 */
function CartaoAssociacao({
  categoriaProduto,
  categoriasOpcional,
  selecionadosIniciais,
  ordemPorGrupo,
  totalItensPorGrupo,
  onSalvo,
  acoes,
}: {
  categoriaProduto: CategoriaProduto;
  categoriasOpcional: CategoriaOpcional[];
  /** Ids PERSISTIDOS desta categoria de produto (props = verdade do servidor). */
  selecionadosIniciais: Set<string>;
  /** `categoria_opcional_id → ordem` gravada. Ausente = ainda não persistido. */
  ordemPorGrupo: Map<string, number>;
  totalItensPorGrupo: Map<string, number>;
  onSalvo: () => void;
  acoes: OpcionaisClientAcoes;
}) {
  const [selecionados, setSelecionados] =
    useState<Set<string>>(selecionadosIniciais);
  const [togglando, setTogglando] = useState(false);
  const [statusAssociacao, setStatusAssociacao] =
    useState<StatusSalvamento>("");
  const [statusOrdem, setStatusOrdem] = useState<StatusSalvamento>("");
  const [mensagemSemLista, setMensagemSemLista] = useState("");
  const reordenarRef = useRef<ManipuladorModoReordenar | null>(null);
  const togglandoRef = useRef(false);
  // Lido dentro do handler do toggle, que capturaria um `selecionados` velho.
  // Sincronizado em EFEITO (escrever ref durante o render é proibido pelo
  // `react-hooks/refs`): o efeito passivo é liberado antes do próximo evento
  // discreto, então todo clique já lê o valor recém-commitado.
  const selecionadosRef = useRef(selecionados);
  useEffect(() => {
    selecionadosRef.current = selecionados;
  }, [selecionados]);

  /**
   * Toggle do checkbox — ÚNICO caminho de escrita da associação.
   *
   * A ORDEM é a trava da corrida descrita no cabeçalho: flush do reorder
   * pendente → novo conjunto → gravação → refresh. Trocar o conjunto antes do
   * flush remontaria a lista (a `key` deriva dos marcados) e o `finalizar()`
   * cairia no handle da instância nova, que não tem o movimento pendente.
   */
  const alternar = useCallback(
    async (catOpcId: string, marcado: boolean) => {
      // Reentrância: dois toggles simultâneos disputariam o mesmo flush.
      if (togglandoRef.current) return;
      togglandoRef.current = true;
      setTogglando(true);

      const anterior = selecionadosRef.current;
      const nome =
        categoriasOpcional.find((c) => c.id === catOpcId)?.nome ?? "Grupo";
      const total = marcado
        ? anterior.size + (anterior.has(catOpcId) ? 0 : 1)
        : anterior.size - (anterior.has(catOpcId) ? 1 : 0);
      const frase = marcado
        ? `${nome} incluído. Posição ${total} de ${total}.`
        : `${nome} removido. ${total} ${total === 1 ? "grupo" : "grupos"} na ordem.`;

      try {
        // A ORDEM (flush → seleção → gravação) é a trava da corrida e mora em
        // `alternarAssociacaoOpcional`, fora do componente, porque aqui dentro
        // ela era inalcançável por teste — ver o cabeçalho daquele arquivo.
        await alternarAssociacaoOpcional(anterior, catOpcId, marcado, frase, {
          finalizarReordenacao: () => reordenarRef.current?.finalizar(),
          salvar: (ids) =>
            acoes.salvarAssociacaoOpcionais({
              categoria_id: categoriaProduto.id,
              categoria_opcional_id: ids,
            }),
          aplicarSelecao: setSelecionados,
          definirStatus: setStatusAssociacao,
          avisarErro: (m) => toast.error(m),
          // A região viva é a do `ModoReordenar` quando ele está montado — duas
          // `aria-live` na mesma tela silenciam ou duplicam o anúncio.
          anunciar: (f) => {
            if (reordenarRef.current) {
              reordenarRef.current.anunciar(f);
            } else {
              setMensagemSemLista(f);
            }
          },
          aoSucesso: onSalvo,
          registrarErro: (e) => console.error("[alternarAssociacao]", e),
        });
      } finally {
        togglandoRef.current = false;
        setTogglando(false);
      }
    },
    [acoes, categoriaProduto.id, categoriasOpcional, onSalvo],
  );

  /*
    Só os marcados, na ordem do servidor. Quem ainda NÃO tem linha gravada (o
    recém-marcado, antes do `router.refresh()`) vai para o FIM — é onde
    `planejarAssociacaoOpcionais` acabou de inseri-lo. Usar 0 como default o
    jogaria para o topo e a tela mentiria por uma fração de segundo. O desempate
    por id espelha o segundo `.order` de `buscarAssociacoesOpcional`: sem ele,
    linhas pré-208 (todas com `ordem = 0`) abririam numa ordem que o SSR não
    garante.
  */
  const gruposMarcados = useMemo<GrupoOpcionalReordenavel[]>(
    () =>
      categoriasOpcional
        .filter((c) => selecionados.has(c.id))
        .map((c) => ({
          id: c.id,
          nome: c.nome,
          totalItens: totalItensPorGrupo.get(c.id) ?? 0,
          prefixo: (
            <span
              className={`${ALVO_TOQUE} flex shrink-0 items-center justify-center`}
            >
              <Checkbox
                checked
                aria-label={`Remover ${c.nome} dos opcionais de ${categoriaProduto.nome}`}
                onCheckedChange={() => void alternar(c.id, false)}
              />
            </span>
          ),
        }))
        .sort((a, b) => {
          const ordemA = ordemPorGrupo.get(a.id) ?? Number.MAX_SAFE_INTEGER;
          const ordemB = ordemPorGrupo.get(b.id) ?? Number.MAX_SAFE_INTEGER;
          return ordemA - ordemB || a.id.localeCompare(b.id);
        }),
    [
      categoriasOpcional,
      selecionados,
      ordemPorGrupo,
      totalItensPorGrupo,
      categoriaProduto.nome,
      alternar,
    ],
  );

  const disponiveis = useMemo(
    () => categoriasOpcional.filter((c) => !selecionados.has(c.id)),
    [categoriasOpcional, selecionados],
  );


  /*
    Status AGREGADO do cartão: um só texto para a associação e para a ordem.
    Dois indicadores lado a lado dizendo "Salvando…" seriam ruído, e o lojista
    não faz ideia de que são duas escritas diferentes.
  */
  const status: StatusSalvamento =
    statusAssociacao === "salvando" || statusOrdem === "salvando"
      ? "salvando"
      : statusAssociacao === "salvo" || statusOrdem === "salvo"
        ? "salvo"
        : "";

  /*
    REMONTA a lista quando o conjunto de marcados muda: o `ModoReordenar`
    captura `itens` no primeiro render de propósito (é isso que preserva o
    otimismo durante o arrasto), então sem a `key` um grupo recém-marcado nunca
    apareceria. Só o CONJUNTO entra na chave — a ordem não, senão cada arrasto
    remontaria a lista sob o dedo.
  */
  const chaveDaLista = Array.from(selecionados).sort().join("|");

  return (
    <AccordionItem
      value={categoriaProduto.id}
      className="not-last:border-b-0"
    >
      <Card>
        <div className="flex items-center justify-between gap-2 border-b px-4 [&>h3]:min-w-0 [&>h3]:flex-1">
          <AccordionTrigger className="min-h-[44px] font-heading text-base font-semibold text-foreground">
            <span className="flex min-w-0 items-center gap-2">
              <span className="truncate">{categoriaProduto.nome}</span>
              <Badge variant="outline">
                {selecionados.size}{" "}
                {selecionados.size === 1 ? "incluído" : "incluídos"}
              </Badge>
            </span>
          </AccordionTrigger>
        </div>

        <AccordionContent className="pt-0 pb-0">
          <CardContent className="space-y-3 p-4">
            {categoriasOpcional.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Crie categorias de opcional para poder associá-las.
              </p>
            ) : (
              <>
                {gruposMarcados.length === 0 ? (
                  <>
                    <p
                      role="status"
                      aria-live="polite"
                      aria-atomic="true"
                      className="sr-only"
                    >
                      {mensagemSemLista}
                    </p>
                    <p className="px-2 py-3 text-sm text-muted-foreground">
                      Nenhum grupo incluído ainda. Marque um em
                      &ldquo;Disponíveis&rdquo; para incluir.
                    </p>
                  </>
                ) : (
                  <ReordenarOpcionaisDaCategoria
                    key={chaveDaLista}
                    ref={reordenarRef}
                    categoriaProdutoId={categoriaProduto.id}
                    grupos={gruposMarcados}
                    onReordenar={acoes.reordenarOpcionaisDaCategoria}
                    semCartao
                    ocultarStatus
                    aoMudarStatus={setStatusOrdem}
                    arrastoBloqueado={togglando}
                  />
                )}

                <Separator />

                {/*
                  Segmento COLAPSADO por padrão e SEM alça: nada aqui tem
                  posição, e uma alça que não move nada seria um controle que
                  não faz nada.
                */}
                <Accordion>
                  <AccordionItem
                    value="disponiveis"
                    className="not-last:border-b-0"
                  >
                    <AccordionTrigger className="min-h-[44px] -mx-4 rounded-none bg-muted/60 px-4 text-sm font-medium text-foreground">
                      <span className="flex flex-wrap items-baseline gap-x-2">
                        Disponíveis ({disponiveis.length})
                        <span className="text-xs font-normal text-muted-foreground">
                          o cliente não vê estes
                        </span>
                      </span>
                    </AccordionTrigger>
                    {/* `keepMounted`: o segmento nasce colapsado, mas o
                        conteúdo já vem do servidor — sem ele os checkboxes de
                        "Incluir" não existiriam no DOM até o primeiro clique. */}
                    <AccordionContent keepMounted>
                      {disponiveis.length === 0 ? (
                        <p className="text-sm text-muted-foreground">
                          Todos os grupos já estão incluídos.
                        </p>
                      ) : (
                        <>
                          <p className="mb-1 text-xs text-muted-foreground">
                            Marque para incluir — entra no fim da ordem.
                          </p>
                          <ul className="divide-y divide-foreground/10">
                            {disponiveis.map((catOpc) => (
                              <li key={catOpc.id}>
                                <label className="flex cursor-pointer items-center gap-2 py-1">
                                  <span
                                    className={`${ALVO_TOQUE} flex shrink-0 items-center justify-center`}
                                  >
                                    <Checkbox
                                      checked={false}
                                      aria-label={`Incluir ${catOpc.nome} nos opcionais de ${categoriaProduto.nome}`}
                                      onCheckedChange={() =>
                                        void alternar(catOpc.id, true)
                                      }
                                    />
                                  </span>
                                  <span className="min-w-0 flex-1">
                                    <span className="line-clamp-1 text-sm font-medium text-foreground">
                                      {catOpc.nome}
                                    </span>
                                    <span className="text-xs text-muted-foreground">
                                      {rotuloItens(
                                        totalItensPorGrupo.get(catOpc.id) ?? 0,
                                      )}
                                    </span>
                                  </span>
                                </label>
                              </li>
                            ))}
                          </ul>
                        </>
                      )}
                    </AccordionContent>
                  </AccordionItem>
                </Accordion>

                {/*
                  `aria-hidden`: a região viva do modo já cobre o leitor de tela.
                */}
                <div
                  aria-hidden
                  className="-mx-4 mt-1 flex min-h-8 items-center justify-end gap-1.5 border-t border-border px-4 pt-2 text-xs text-muted-foreground"
                >
                  {status === "salvando" && <span>Salvando…</span>}
                  {status === "salvo" && (
                    <>
                      <Check className="size-3.5 text-emerald-600" />
                      <span className="font-medium text-emerald-700">Salvo</span>
                    </>
                  )}
                </div>
              </>
            )}
          </CardContent>
        </AccordionContent>
      </Card>
    </AccordionItem>
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
