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
  AlertTriangle,
  ArrowUpDown,
  Pencil,
  PencilLine,
  Plus,
  Trash2,
  Loader2,
  SlidersHorizontal,
  EyeOff,
  ListChecks,
  MoreVertical,
  X,
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  DialogClose,
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
  ReordenarProdutos,
  type ManipuladorReordenarProdutos,
} from "@/components/painel/ReordenarProdutos";
import { CartaoAssociacaoOpcionais } from "@/components/painel/CartaoAssociacaoOpcionais";
import { BarraSelecaoLote } from "@/components/painel/BarraSelecaoLote";
import { useLoteDeProdutos } from "@/components/painel/useLoteDeProdutos";
import type {
  LoteDeProdutos,
  VinculosPorProduto,
} from "@/components/painel/contrato-lote";
import { visibilidadeDe } from "@/lib/utils/vigenciaCardapio";
import type { SumicoDoProduto } from "@/lib/utils/contarProdutosEscondidos";
import {
  avisoNaLinhaDoProduto,
  rotuloReligarOuEstender,
} from "@/lib/utils/copiaCardapioPainel";
import type {
  Associacao,
  CategoriaProduto,
  OpcionaisClientAcoes,
} from "@/components/painel/contrato-opcionais";
import {
  agruparOpcionaisPorGrupo,
  contarItensPorGrupo,
  selecionadosPorCategoria,
  ordemPorCategoria,
  alcancePorGrupo as derivarAlcancePorGrupo,
} from "@/lib/utils/derivar-associacao-opcionais";
import type {
  removerProduto as removerProdutoLojista,
  alternarDisponibilidade as alternarDisponibilidadeLojista,
  alternarOculto as alternarOcultoLojista,
  criarProduto as criarProdutoLojista,
  atualizarProduto as atualizarProdutoLojista,
  atualizarNomeEPreco as atualizarNomeEPrecoLojista,
  criarCategoria as criarCategoriaLojista,
  atualizarCategoria as atualizarCategoriaLojista,
  removerCategoria as removerCategoriaLojista,
  alternarExibirImagens as alternarExibirImagensLojista,
  reordenarCategorias as reordenarCategoriasLojista,
  reordenarProdutos as reordenarProdutosLojista,
} from "@/lib/actions/produto";
import type { EnviarFotoProduto } from "@/components/painel/UploadFotoProduto";
import { formatarMoeda } from "@/lib/utils/formatarMoeda";
import type {
  Produto,
  OpcionaisPorCategoria,
} from "@/lib/supabase/queries/produtos";
import type { PromocaoDoPainel } from "@/lib/utils/promocaoPainel";
import type {
  CategoriaOpcional,
  Opcional,
} from "@/lib/supabase/queries/opcionais";

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
  /** Todas as categorias de opcional da loja, LINHAS INTEIRAS (217). */
  categoriasOpcional: CategoriaOpcional[];
  /**
   * Biblioteca de opcionais da loja (ativos E inativos), já ordenada. Alimenta
   * a sanfona de itens do cartão dentro do modal (217). NÃO sai de
   * `opcionaisPorCategoria`: aquele é um sub-select estreito da vitrine.
   */
  opcionais: Opcional[];
  /**
   * Linhas de `categoria_produto_opcionais` — a FONTE DE VERDADE da associação
   * (217). `opcionaisPorCategoria` descarta grupo associado que ainda não tem
   * item; usá-lo como seleção inicial apagaria essa associação em silêncio no
   * primeiro toggle, porque o toggle grava o conjunto inteiro.
   */
  associacoes: Associacao[];
  /**
   * Promoção de cada produto (`produto.id → projeção`), PROJETADA NO SERVER
   * COMPONENT (issue 235, design §8.4). Não é campo novo de banco nem derivação
   * do cliente: decidir "está vigente agora" aqui duplicaria RN-03 e usaria o
   * relógio do dispositivo, que a loja não controla. Produto ausente do mapa =
   * sem promoção.
   */
  promocoes: Record<string, PromocaoDoPainel>;
  /** Linha de fuso pronta do servidor, repassada ao `FormProduto` (§8.1). */
  fusoLojaRotulo: string;
  /**
   * [260][261] O modo de seleção e a ação em lote. OPCIONAL, e é a única prop
   * deste componente que é: as Server Actions de lote derivam a loja de
   * `auth.uid()` e NÃO têm variante admin (issue 251). Injetá-las no hub admin
   * gravaria na loja do ADMIN logado, não na loja-alvo. Ausente ⇒ o botão
   * "Selecionar" não existe e não há modo de seleção — o mesmo espírito da
   * issue 160 (nunca cair num default que escreve na loja errada), resolvido
   * pela ausência da funcionalidade em vez de por um fallback silencioso.
   */
  lote?: LoteDeProdutos;
  /**
   * [261] `produto.id → cardápios dele`, projetado no Server Component (com o
   * relógio do servidor e o fuso da loja). OBRIGATÓRIA nos dois mundos: é o que
   * o `FormProduto` lê para decidir entre "está em: …" e o aviso de RN-14.
   * Separada de `lote` de propósito — ver `VinculosPorProduto`.
   */
  vinculosPorProduto: VinculosPorProduto;
  /**
   * Destino da tela de cardápios NESTE mundo, ou `null` quando ele não tem uma.
   * OBRIGATÓRIA e sem default (issue 160, e o mesmo contrato do `NavPainel`:
   * href vem de quem conhece a rota, nunca do componente de apresentação).
   * O painel do lojista passa `ROTA_CARDAPIOS_LOJISTA`; o hub admin passa
   * `rotaCardapiosAdmin(lojaId)` (issue 269). Um link fixo mandaria o admin
   * para o painel da PRÓPRIA loja dele — foi o bug de `8bfe902` e `f26cc6a`.
   *
   * `null` ⇒ some a saída do kebab que depende da rota, e o `FormProduto`
   * troca o botão por instrução. Repassada, não inferida.
   */
  hrefCardapios: string | null;
  /**
   * [264/RN-12] `produto.id → por que ele sumiu da vitrine`, derivado no Server
   * Component pelo MESMO predicado de `/painel/cardapios`. Esparso: só o
   * produto que de fato sumiu tem entrada, e o resto da lista não ganha ruído.
   *
   * Opcional porque o hub admin não o projeta — ausente ⇒ nenhum aviso, nunca
   * um aviso errado. Preview de UX: nenhuma decisão depende dele.
   */
  sumicos?: Record<string, SumicoDoProduto>;
  /**
   * Actions injetadas. Todas OBRIGATÓRIAS (issue 160): a page do painel passa
   * as 21 do lojista, a via admin passa as 21 variantes escopadas por `lojaId`.
   * Sem default — omitir uma chave aqui quebra o build em vez de cair na action
   * do lojista (que resolve a loja por `auth.uid()`) e gravar na loja errada.
   */
  acoes: AcoesProdutosClient;
};

/**
 * Contrato das actions do cardápio. Fonte única do conjunto exigido.
 *
 * INTERSEÇÃO desde a 217: as 11 de produto/categoria/upload mais as 10 de
 * opcionais (`salvarAssociacaoOpcionais` é comum às duas metades, daí 21 chaves
 * distintas). O cartão de associação recebe `acoes` inteiro e tipa direto — sem
 * montar um objeto novo, que seria mais uma lista para esquecer uma chave.
 */
export type AcoesProdutosClient = {
  removerProduto: typeof removerProdutoLojista;
  alternarDisponibilidade: typeof alternarDisponibilidadeLojista;
  alternarOculto: typeof alternarOcultoLojista;
  criarProduto: typeof criarProdutoLojista;
  atualizarProduto: typeof atualizarProdutoLojista;
  /**
   * [290] Patch ESTREITO de nome+preço da edição inline. Chave PRÓPRIA, e
   * não uma sobrecarga de `atualizarProduto`: aquela grava a linha inteira,
   * e reusá-la aqui obrigaria o cliente a remontar foto, visibilidade e
   * promoção — apagando em silêncio o que o lojista não tocou.
   */
  atualizarNomeEPreco: typeof atualizarNomeEPrecoLojista;
  enviarFotoProduto: EnviarFotoProduto;
  criarCategoria: typeof criarCategoriaLojista;
  atualizarCategoria: typeof atualizarCategoriaLojista;
  removerCategoria: typeof removerCategoriaLojista;
  alternarExibirImagens: typeof alternarExibirImagensLojista;
  reordenarCategorias: typeof reordenarCategoriasLojista;
  /**
   * [293] Reordenação dos PRODUTOS de UMA categoria. Chave própria, e não uma
   * sobrecarga de `reordenarCategorias`: o escopo da permutação é o PAR (loja,
   * categoria), e o payload carrega o `categoria_id` do grupo.
   */
  reordenarProdutos: typeof reordenarProdutosLojista;
} & OpcionaisClientAcoes;

type GrupoProdutos = {
  id: string | null;
  nome: string;
  produtos: Produto[];
};

/**
 * Agrupa produtos por categoria, na ordem das categorias; "Sem categoria" por
 * último.
 *
 * Categoria VAZIA continua na lista (issue 261): esconder grupo vazio é regra
 * da VITRINE (issue 177, `projetarCatalogoVitrine`), onde o cliente não tem o
 * que fazer com uma seção sem item. No painel do lojista — e no hub admin, que
 * reusa este mesmo componente — a categoria recém-criada nasce vazia por
 * definição, e sumir da lista fazia o lojista concluir que não criou nada.
 * "Sem categoria" é a exceção: não é categoria, é o resíduo dos órfãos, então
 * só existe quando existe produto órfão.
 */
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

  if (outros) grupos.push(outros);
  return grupos;
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

/**
 * [261] D14 na lista — `Badge variant="secondary"` com o texto literal
 * `Exclusivo de cardápio`, ao lado do `badgeStatus(p)`. Produto do MENU não
 * ganha badge nenhum: é o default e não merece ruído em toda linha.
 *
 * `visibilidadeDe` é o estreitamento FAIL-OPEN já usado pela vitrine (247/D6):
 * valor desconhecido lê como `menu`, e a linha não anuncia uma exclusividade
 * que o projeto não sabe avaliar.
 */
function badgeExclusivo(p: Produto) {
  if (visibilidadeDe(p) !== "cardapio") return null;
  return <Badge variant="secondary">Exclusivo de cardápio</Badge>;
}

export function ProdutosClient({
  lojaSlug,
  lojaId,
  produtos,
  categorias,
  // Encanada no server (issue 105); consumida pela UI na issue 107.
  opcionaisPorCategoria,
  categoriasOpcional,
  opcionais,
  associacoes,
  promocoes,
  fusoLojaRotulo,
  lote,
  vinculosPorProduto,
  hrefCardapios,
  sumicos = {},
  acoes,
}: ProdutosClientProps) {
  const router = useRouter();

  const { removerProduto, alternarDisponibilidade, alternarOculto } = acoes;

  /**
   * [264] Devolve ESTE produto ao menu — a segunda saída do aviso de RN-12.
   * Reusa a action de lote da 261 (`definirVisibilidadeEmProdutos`) com uma
   * lista de um: nenhuma Server Action nova, e o `loja_id` continua saindo de
   * `buscarLojaDoDono` dentro dela. Só existe no painel do lojista, onde `lote`
   * existe — no hub admin a action gravaria na loja errada (issue 251).
   */
  async function devolverAoMenu(produto: Produto): Promise<void> {
    if (lote == null) return;
    const resultado = await lote.acoes.definirVisibilidade({
      produto_ids: [produto.id],
      visibilidade: "menu",
    });
    if (!resultado.ok) {
      toast.error(resultado.erro);
      return;
    }
    toast.success(`${produto.nome} voltou para o menu.`);
    router.refresh();
  }

  /*
    [217] As cinco derivações do cartão de associação são PURAS e moram em
    `lib/utils/derivar-associacao-opcionais.ts` — a mesma cópia que
    `OpcionaisClient` usa. Duplicar aqui significaria duas cópias do comparador
    `ordem || id` divergindo em silêncio.
  */

  /** `categoria_id (produto) → set de categoria_opcional_id` PERSISTIDOS. */
  const inicialPorProduto = useMemo(
    () => selecionadosPorCategoria(associacoes),
    [associacoes],
  );

  /** `ordem` gravada (208) por categoria de produto. */
  const ordemPorProduto = useMemo(
    () => ordemPorCategoria(associacoes),
    [associacoes],
  );

  /** `categoria_opcional_id → itens do grupo` (216), ativos E inativos. */
  const opcionaisPorGrupo = useMemo(
    () => agruparOpcionaisPorGrupo(opcionais),
    [opcionais],
  );

  /** `categoria_opcional_id → nº de itens`, para o detalhe de cada linha. */
  const totalItensPorGrupo = useMemo(
    () => contarItensPorGrupo(opcionaisPorGrupo),
    [opcionaisPorGrupo],
  );

  /** `categoria_opcional_id → nomes das categorias de PRODUTO que usam o grupo`. */
  const alcancePorGrupo = useMemo(
    () => derivarAlcancePorGrupo(associacoes, categorias),
    [associacoes, categorias],
  );

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

  // Categoria de produto com o modal de opcionais aberto (null => fechado).
  // É `CategoriaProduto` (id NÃO-nulo), não `GrupoProdutos`: "Sem categoria"
  // não tem linha em `categoria_produto_opcionais` e nem exibe o botão.
  const [categoriaOpcionaisAberta, setCategoriaOpcionaisAberta] =
    useState<CategoriaProduto | null>(null);

  // Produto pendente de remoção (controla o AlertDialog).
  const [aRemover, setARemover] = useState<Produto | null>(null);
  const [categoriasAbertas, setCategoriasAbertas] = useState(false);
  const [removendo, startRemocao] = useTransition();
  const [alternandoDisp, startAlternarDisp] = useTransition();
  const [alternandoOculto, startAlternarOculto] = useTransition();
  // Id do produto em transição em cada eixo — evita travar a lista inteira
  // ao togglar um único produto (cada linha desabilita só o próprio controle).
  const [idAlternandoDisp, setIdAlternandoDisp] = useState<string | null>(null);
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

  /*
    [293] Segundo modo, IRMÃO do de categorias: reordenar os PRODUTOS de um
    grupo. Guarda o GRUPO inteiro em vez de um booleano porque a permutação é
    escopada pelo par (loja, categoria) — e `null` em `id` é o grupo legítimo
    "Sem categoria" (`categoria_id IS NULL`), não "nenhum grupo". Por isso o
    estado é `{ id, nome } | null`, e não `string | null`: as duas ausências
    seriam o mesmo valor.
  */
  const [grupoReordenando, setGrupoReordenando] = useState<{
    id: string | null;
    nome: string;
  } | null>(null);
  const reordenarProdutosRef = useRef<ManipuladorReordenarProdutos>(null);
  const saindoDoModoProdutosRef = useRef(false);

  /*
    [260] Modo de SELEÇÃO — mesmo desenho de `modoReordenar` (issue 175):
    estado no PAI, a linha troca de aparência, uma barra de ação aparece. Não é
    chrome permanente porque a linha que ganha um checkbox soma ~44px de chrome
    e em 360px sobra pouco para o nome (`design-system.md` §5).

    🔴 `selecionados` é INTENÇÃO, não permissão. Nada aqui autoriza coisa
    alguma: a trava é a FK composta + a RLS + o `loja_id` da sessão (243/251), e
    a contagem que o lojista lê antes de confirmar vem do SERVIDOR.
  */
  const [modoSelecao, setModoSelecao] = useState(false);
  const [selecionados, setSelecionados] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  // Para onde o foco volta ao sair do modo (ESC ou "Cancelar").
  const botaoSelecionarRef = useRef<HTMLButtonElement>(null);

  /**
   * A seleção que vai ao servidor, DERIVADA da lista renderizada — nunca o
   * `Set` cru. Depois de um `router.refresh()` (lote aplicado, produto
   * removido de outro dispositivo) o id que sumiu da tela sai daqui sozinho,
   * sem efeito nenhum: mandar ao servidor uma lista que descreve um catálogo
   * que não existe mais só produziria recusa genérica.
   */
  const lista = useMemo(
    () => produtos.filter((p) => selecionados.has(p.id)).map((p) => p.id),
    [produtos, selecionados],
  );

  const limparSelecao = useCallback(() => setSelecionados(new Set()), []);

  const aoConcluirLote = useCallback(() => {
    // A ação terminou: a seleção velha não descreve mais nada. O MODO
    // permanece — o lojista costuma aplicar dois cardápios em seguida.
    limparSelecao();
    router.refresh();
  }, [limparSelecao, router]);

  const loteUI = useLoteDeProdutos(lote?.acoes, aoConcluirLote);

  /** Sair do modo LIMPA a seleção e devolve o foco ao botão "Selecionar". */
  const sairDoModoSelecao = useCallback(() => {
    limparSelecao();
    setModoSelecao(false);
    // `requestAnimationFrame` porque o botão só volta a existir no próximo
    // render (a barra some e o cabeçalho normal reaparece).
    requestAnimationFrame(() => botaoSelecionarRef.current?.focus());
  }, [limparSelecao]);

  // ESC sai do modo — mas NUNCA por cima do diálogo de confirmação, que tem o
  // próprio ESC (fechar o diálogo não pode cancelar a seleção junto).
  useEffect(() => {
    if (!modoSelecao) return;
    function aoTeclar(e: KeyboardEvent) {
      if (e.key === "Escape" && !loteUI.dialogoAberto) sairDoModoSelecao();
    }
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [modoSelecao, loteUI.dialogoAberto, sairDoModoSelecao]);

  function alternarSelecao(id: string) {
    setSelecionados((atual) => {
      const proximo = new Set(atual);
      if (proximo.has(id)) proximo.delete(id);
      else proximo.add(id);
      return proximo;
    });
  }

  /** "Selecionar os 12" do cabeçalho do grupo (design §10.1). */
  function selecionarGrupo(ids: string[]) {
    setSelecionados((atual) => new Set([...atual, ...ids]));
  }

  /** "Limpar" do cabeçalho do grupo — só os produtos dele. */
  function limparGrupo(ids: string[]) {
    setSelecionados((atual) => {
      const proximo = new Set(atual);
      for (const id of ids) proximo.delete(id);
      return proximo;
    });
  }

  const grupos = useMemo(
    () => agruparPorCategoria(produtos, categorias),
    [produtos, categorias],
  );

  /**
   * `categoria_id → nº de produtos`. Contado sobre TODOS os produtos, não sobre
   * `grupos`, que carrega o grupo sintético "Sem categoria" e é montado para a
   * listagem; o modo reordenar lê de `categorias` e só precisa do número.
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

  /**
   * [293] Produtos do grupo em modo reordenar, lidos de `grupos` — a MESMA
   * lista que a tela mostra, já ordenada. Reprojetar de `produtos` aqui
   * duplicaria a regra de agrupamento (e o casamento de `categoria_id` nulo).
   */
  const produtosDoGrupoReordenando = useMemo(
    () =>
      grupoReordenando == null
        ? []
        : (grupos.find((g) => g.id === grupoReordenando.id)?.produtos ?? []),
    [grupos, grupoReordenando],
  );

  /** Mesma ordem do modo de categorias: flush → desmonta → refresh. */
  const sairDoModoReordenarProdutos = useCallback(async () => {
    if (saindoDoModoProdutosRef.current) return; // ESC repetido / duplo clique
    saindoDoModoProdutosRef.current = true;
    try {
      await reordenarProdutosRef.current?.finalizar();
    } finally {
      saindoDoModoProdutosRef.current = false;
      setGrupoReordenando(null);
      router.refresh();
    }
  }, [router]);

  useEffect(() => {
    if (grupoReordenando == null) return;
    function aoTeclar(e: KeyboardEvent) {
      if (e.key === "Escape") void sairDoModoReordenarProdutos();
    }
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [grupoReordenando, sairDoModoReordenarProdutos]);

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

  /*
    [290] Edição INLINE de nome e preço. Estado no PAI, como `editandoId` de
    `GerenciarCategorias` — mas com os alvos de toque em 44px LITERAL, e não no
    `size="icon-sm"` (33,6px na base de 120%) de lá, que está abaixo do mínimo
    de `design-system.md` §5 (débito registrado na issue 291).

    🔴 O que este estado NÃO é: autoridade sobre valor. Nada daqui decide preço
    — a Server Action relê o desconto do banco, reaplica D10 e grava um patch
    de duas chaves. As conferências abaixo são PREVIEW de UX: poupam um
    roundtrip, nunca substituem o servidor.
  */
  const [editandoInlineId, setEditandoInlineId] = useState<string | null>(null);
  const [nomeInline, setNomeInline] = useState("");
  const [precoInline, setPrecoInline] = useState("");
  const [erroInline, setErroInline] = useState<string | null>(null);
  const [salvandoInline, startSalvarInline] = useTransition();

  function abrirEdicaoInline(p: Produto) {
    setEditandoInlineId(p.id);
    setNomeInline(p.nome);
    // Vírgula: é o separador que o lojista digita, o mesmo do `FormProduto`.
    setPrecoInline(String(p.preco).replace(".", ","));
    setErroInline(null);
  }

  function fecharEdicaoInline() {
    setEditandoInlineId(null);
    setErroInline(null);
  }

  function salvarEdicaoInline(p: Produto) {
    const nome = nomeInline.trim();
    // Mesma coerção do `FormProduto`: vírgula → ponto, `Number`, sem máscara
    // nova (`inputMode="decimal"` no input).
    const preco = Number(precoInline.replace(",", "."));
    if (nome === "") {
      setErroInline("Informe o nome do produto.");
      return;
    }
    if (!Number.isFinite(preco) || preco < 0) {
      setErroInline("Informe um preço válido, como 12,90.");
      return;
    }
    startSalvarInline(async () => {
      const resultado = await acoes.atualizarNomeEPreco(p.id, { nome, preco });
      if (!resultado.ok) {
        // A recusa de D10 tem dois números e duas saídas: fica NA LINHA,
        // re-legível, não num toast que some em 4 segundos (design §8.3).
        setErroInline(resultado.erro);
        return;
      }
      setEditandoInlineId(null);
      setErroInline(null);
      toast.success("Produto atualizado.");
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
      onCriar={acoes.criarProduto}
      onAtualizar={acoes.atualizarProduto}
      onEnviarFoto={acoes.enviarFotoProduto}
      fusoLojaRotulo={fusoLojaRotulo}
      // Repasse puro: quem sabe a rota é a page/wrapper de cada mundo.
      hrefCardapios={hrefCardapios}
      // [261] Preview de UX para a recusa de RN-14: o form explica e oferece a
      // saída quando o produto não está em cardápio nenhum. A autoridade segue
      // sendo o trigger + a mensagem da Server Action.
      cardapiosDoProduto={
        emEdicao ? (vinculosPorProduto[emEdicao.id] ?? []) : []
      }
      inicial={
        emEdicao
          ? {
              id: emEdicao.id,
              nome: emEdicao.nome,
              descricao: emEdicao.descricao,
              preco: emEdicao.preco,
              categoria_id: emEdicao.categoria_id,
              disponivel: emEdicao.disponivel,
              // [261] D14 — estreitado FAIL-OPEN (247/D6): valor desconhecido
              // abre o form em "menu", nunca fazendo o produto sumir sozinho.
              visibilidade: visibilidadeDe(emEdicao),
              foto_url: emEdicao.foto_url,
              ordem: emEdicao.ordem,
              // RN-07: o form recebe a promoção INTEIRA, inclusive desligada.
              // Os dois prazos vêm em hora LOCAL da loja, já convertidos pelo
              // Server Component — nada de fuso é feito no browser.
              desconto_ativo: emEdicao.desconto_ativo,
              desconto_tipo:
                emEdicao.desconto_tipo === "percentual" ||
                emEdicao.desconto_tipo === "fixo"
                  ? emEdicao.desconto_tipo
                  : null,
              desconto_valor: emEdicao.desconto_valor,
              desconto_inicio: promocoes[emEdicao.id]?.inicioLocal ?? null,
              desconto_fim: promocoes[emEdicao.id]?.fimLocal ?? null,
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
        ) : grupoReordenando != null ? (
          // [293] Mesma troca de BARRA do modo de categorias, pelo mesmo motivo.
          <Button onClick={() => void sairDoModoReordenarProdutos()}>
            Concluir
          </Button>
        ) : modoSelecao ? (
          // No modo, as ações de criação somem (não ficam `disabled`): botão
          // inerte sai da tabulação e não explica por que não funciona — a
          // mesma regra que `modoReordenar` fixou.
          <p className="text-sm text-muted-foreground">
            Marque os produtos que a ação deve atingir.
          </p>
        ) : (
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => setCategoriasAbertas(true)}
            >
              Categorias
            </Button>
            <Button onClick={abrirCriar}>
              <Plus className="size-4" />
              Novo produto
            </Button>
            {podeReordenar && (
              <Button variant="outline" onClick={() => setModoReordenar(true)}>
                <ArrowUpDown className="size-4" />
                Reordenar categorias
              </Button>
            )}
            {/* Só existe onde a ação em lote existe (ver a prop `lote`). */}
            {lote != null && produtos.length > 0 && (
              <Button
                ref={botaoSelecionarRef}
                variant="outline"
                onClick={() => setModoSelecao(true)}
              >
                <ListChecks className="size-4" />
                Selecionar
              </Button>
            )}
          </div>
        )}
      </div>

      {/* A barra de ação do modo (design §10.1): `fixed` no rodapé do mobile,
          `sticky top` no desktop. Fica ACIMA da lista na árvore para que o
          `sticky` se ancore no topo do scroll da página. */}
      {modoSelecao && lote != null && (
        <BarraSelecaoLote
          selecionados={lista}
          cardapios={lote.cardapios}
          prevendo={loteUI.prevendo}
          abrirCardapio={(acao, cardapio) =>
            loteUI.abrirCardapio(acao, cardapio, {
              tipo: "produtos",
              produto_ids: lista,
            })
          }
          abrirVisibilidade={(acao) => loteUI.abrirVisibilidade(acao, lista)}
          onLimpar={limparSelecao}
          onCancelar={sairDoModoSelecao}
        />
      )}

      {/* No modo reordenar a listagem normal dá lugar à lista de reordenação:
          é o que colapsa tudo e faz a tela ler de `categorias` (todas, sem o
          grupo sintético "Sem categoria", que não é ordenável). */}
      {modoReordenar ? (
        <>
          <p className="mb-3 text-sm text-muted-foreground">
            Ordene as categorias. A ordem daqui é a do cardápio.
          </p>
          <ReordenarCategorias
            ref={reordenarRef}
            categorias={categorias}
            contagemPorCategoria={contagemPorCategoria}
            temSemCategoria={temSemCategoria}
            onReordenar={acoes.reordenarCategorias}
          />
        </>
      ) : grupoReordenando != null ? (
        /* [293] Reordenação ESCOPADA a um grupo: a listagem inteira dá lugar à
           lista do grupo escolhido. Sai do cabeçalho da categoria (e não da
           barra do topo) porque a ordem de produto só existe dentro do grupo. */
        <>
          <p className="mb-3 text-sm text-muted-foreground">
            Ordene os produtos de {grupoReordenando.nome}. A ordem daqui é a do
            cardápio.
          </p>
          <ReordenarProdutos
            ref={reordenarProdutosRef}
            produtos={produtosDoGrupoReordenando}
            categoriaId={grupoReordenando.id}
            nomeCategoria={grupoReordenando.nome}
            onReordenar={acoes.reordenarProdutos}
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
                    {modoSelecao ? (
                      // Par de botões com o NÚMERO escrito, nunca checkbox
                      // tri-estado: o `Checkbox` gerado renderiza `CheckIcon`
                      // fixo e um estado "mixed" mostraria um ✓ — corrigir isso
                      // exigiria editar arquivo do shadcn CLI. Grupo vazio não
                      // ganha o par: "Selecionar os 0" é controle para operação
                      // impossível.
                      grupo.produtos.length === 0 ? null : (
                        <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
                          <Button
                            variant="outline"
                            size="sm"
                            className="min-h-[44px]"
                            onClick={() =>
                              selecionarGrupo(grupo.produtos.map((p) => p.id))
                            }
                          >
                            Selecionar os {grupo.produtos.length}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="min-h-[44px]"
                            aria-label={`Limpar a seleção de ${grupo.nome}`}
                            onClick={() =>
                              limparGrupo(grupo.produtos.map((p) => p.id))
                            }
                          >
                            Limpar
                          </Button>
                        </div>
                      )
                    ) : grupo.id != null || grupo.produtos.length >= 2 ? (
                      <div className="flex shrink-0 items-center">
                        {/* [293] Ponto de entrada do modo reordenar PRODUTOS —
                            no cabeçalho do grupo, porque a permutação é
                            escopada a UMA categoria. Espelha o gate do modo de
                            categorias (`podeReordenar`): abaixo de 2 itens não
                            há ordem a escolher, e um botão desabilitado ali só
                            produziria "por que não funciona?" sem resposta.
                            Aparece também no grupo "Sem categoria" — lá o
                            `categoria_id` é NULL e a RPC o trata como grupo. */}
                        {grupo.produtos.length >= 2 && (
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-label={`Reordenar produtos de ${grupo.nome}`}
                            onClick={() =>
                              setGrupoReordenando({
                                id: grupo.id,
                                nome: grupo.nome,
                              })
                            }
                          >
                            <ArrowUpDown className="size-4" />
                            <span className="hidden sm:inline">Reordenar</span>
                          </Button>
                        )}
                        {grupo.id != null && (
                          <>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            if (grupo.id == null) return;
                            setCategoriaOpcionaisAberta({
                              id: grupo.id,
                              nome: grupo.nome,
                            });
                          }}
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
                          </>
                        )}
                      </div>
                    ) : null}
                  </div>
                  <AccordionContent className="pt-0 pb-0">
                    <CardContent className="divide-y divide-foreground/10 p-0">
                      {/* Categoria vazia diz que está vazia, em vez de sumir
                          (issue 261): o cabeçalho acima já oferece o
                          "Novo produto em {nome}" que a preenche. */}
                      {grupo.produtos.length === 0 && (
                        <p className="px-4 py-3 text-sm text-muted-foreground">
                          Nenhum produto nesta categoria ainda.
                        </p>
                      )}
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
                          {/* Prefixo do modo. Alvo de 44px LITERAL; o `label`
                              é o alvo, não o quadradinho do checkbox. */}
                          {modoSelecao && (
                            <label className="flex min-h-[44px] min-w-[44px] shrink-0 cursor-pointer items-center justify-center">
                              <Checkbox
                                checked={selecionados.has(p.id)}
                                onCheckedChange={() => alternarSelecao(p.id)}
                                aria-label={`Selecionar ${p.nome}`}
                              />
                            </label>
                          )}
                          <ThumbProduto fotoUrl={p.foto_url} nome={p.nome} />
                          {/* `sm:min-w-[14rem]` é o piso do nome no desktop. Sem
                              ele, a lista de opcionais (que não encolhe) comia a
                              linha inteira e o nome virava "X - b..". No mobile a
                              lista é `w-full` e quebra sozinha, por isso lá o
                              nome já tinha a largura toda. */}
                          <div className="min-w-0 flex-1 sm:min-w-[14rem]">
                            {/* [290] Em edição inline, a faixa de texto (nome +
                                preço/status) dá lugar a dois campos EMPILHADOS
                                — em 360px eles não cabem lado a lado. A linha
                                em REPOUSO não muda: o mockup segue byte a
                                byte, e o gatilho é o item do kebab. */}
                            {editandoInlineId === p.id ? (
                              <div className="space-y-2">
                                <div className="space-y-1">
                                  <Label
                                    htmlFor={`inline-nome-${p.id}`}
                                    className="text-xs text-muted-foreground"
                                  >
                                    Nome
                                  </Label>
                                  <Input
                                    id={`inline-nome-${p.id}`}
                                    value={nomeInline}
                                    autoFocus
                                    disabled={salvandoInline}
                                    onChange={(e) =>
                                      setNomeInline(e.target.value)
                                    }
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter") {
                                        e.preventDefault();
                                        salvarEdicaoInline(p);
                                      }
                                      if (e.key === "Escape")
                                        fecharEdicaoInline();
                                    }}
                                    // D10 é erro de PAR (preço × desconto): os
                                    // dois campos apontam para a MESMA
                                    // descrição, como no `FormProduto`.
                                    aria-invalid={
                                      erroInline != null ? true : undefined
                                    }
                                    aria-describedby={
                                      erroInline != null
                                        ? `inline-erro-${p.id}`
                                        : undefined
                                    }
                                  />
                                </div>
                                <div className="space-y-1">
                                  <Label
                                    htmlFor={`inline-preco-${p.id}`}
                                    className="text-xs text-muted-foreground"
                                  >
                                    Preço (R$)
                                  </Label>
                                  <Input
                                    id={`inline-preco-${p.id}`}
                                    value={precoInline}
                                    inputMode="decimal"
                                    placeholder="0,00"
                                    disabled={salvandoInline}
                                    onChange={(e) =>
                                      setPrecoInline(e.target.value)
                                    }
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter") {
                                        e.preventDefault();
                                        salvarEdicaoInline(p);
                                      }
                                      if (e.key === "Escape")
                                        fecharEdicaoInline();
                                    }}
                                    aria-invalid={
                                      erroInline != null ? true : undefined
                                    }
                                    aria-describedby={
                                      erroInline != null
                                        ? `inline-erro-${p.id}`
                                        : undefined
                                    }
                                  />
                                </div>
                                {erroInline != null && (
                                  <p
                                    id={`inline-erro-${p.id}`}
                                    role="alert"
                                    className="text-xs text-destructive"
                                  >
                                    {erroInline}
                                  </p>
                                )}
                                {/* Alvo de toque: 44px LITERAL. `min-h-11`
                                    seria 52,8px na base de 120% do projeto, e
                                    `size="icon-sm"` seria 33,6px — abaixo do
                                    mínimo de `design-system.md` §5. */}
                                <div className="flex gap-2">
                                  <Button
                                    size="sm"
                                    className="min-h-[44px] min-w-[44px] flex-1 sm:flex-none"
                                    disabled={salvandoInline}
                                    onClick={() => salvarEdicaoInline(p)}
                                  >
                                    {salvandoInline && (
                                      <Loader2 className="mr-2 size-4 animate-spin" />
                                    )}
                                    Salvar
                                  </Button>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="min-h-[44px] min-w-[44px] flex-1 sm:flex-none"
                                    disabled={salvandoInline}
                                    onClick={fecharEdicaoInline}
                                  >
                                    Cancelar
                                  </Button>
                                </div>
                              </div>
                            ) : (
                              <>
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
                                  {/* [261] D14 — nada para o produto do menu. */}
                                  {badgeExclusivo(p)}
                                  {/* Chip de promoção VIGENTE. O rótulo inteiro
                                      (`-20% até 30/09`) vem projetado do servidor;
                                      aqui não há derivação de vigência nenhuma. */}
                                  {promocoes[p.id]?.rotulo != null && (
                                    <Badge
                                      variant="secondary"
                                      className="text-promo-texto"
                                    >
                                      {promocoes[p.id].rotulo}
                                    </Badge>
                                  )}
                                </div>
                              </>
                            )}
                            {!modoSelecao &&
                              (() => {
                                const gruposOpcionais =
                                  opcionaisPorCategoria[
                                    p.categoria_id ?? ""
                                  ] ?? [];
                                if (gruposOpcionais.length === 0) return null;
                                return (
                                  <ul
                                    className="mt-1.5 flex flex-wrap gap-1.5"
                                    aria-label={`Opcionais da categoria ${grupo.nome}`}
                                  >
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
                            {/* [261] De quais cardápios o produto participa e
                                se algum está DENTRO da janela agora. Os dois
                                vêm projetados do Server Component, com o
                                relógio do servidor e o fuso da loja — o painel
                                nunca decide vigência no browser. */}
                            {(vinculosPorProduto[p.id]?.length ?? 0) > 0 && (
                              <ul className="mt-1 flex flex-wrap items-center gap-1.5">
                                {vinculosPorProduto[p.id]?.map((c) => (
                                  <li key={c.id}>
                                    <Badge
                                      variant="outline"
                                      // [278] Em 360px o chip com os três
                                      // trechos quebra em duas linhas em vez de
                                      // esticar a linha do produto.
                                      className="font-normal whitespace-normal"
                                    >
                                      {c.nome}
                                      {/* [278] Ordem fixada: nome · dias ·
                                          estado. O estado é consequência, vem
                                          por último. Redigido no SERVIDOR. */}
                                      {c.rotuloDias === null
                                        ? ""
                                        : ` · ${c.rotuloDias}`}
                                      {c.abertoAgora
                                        ? ""
                                        : " · fora da janela agora"}
                                    </Badge>
                                  </li>
                                ))}
                              </ul>
                            )}
                            {/* [264/RN-12] O aviso REDUZIDO: com D14 este
                                produto sumiu da vitrine e o painel é o único
                                lugar onde isso é observável. Âmbar, nunca
                                vermelho: requer ação, não é falha. A frase vem
                                do módulo puro de copy — nenhum texto de estado
                                escrito aqui. */}
                            {sumicos[p.id] && (
                              <p
                                role="alert"
                                className="mt-1 flex items-center gap-1.5 text-xs text-amber-700"
                              >
                                <AlertTriangle
                                  aria-hidden
                                  className="size-3.5 shrink-0"
                                />
                                {avisoNaLinhaDoProduto(
                                  sumicos[p.id].cardapio,
                                  sumicos[p.id].ativo,
                                )}
                              </p>
                            )}
                          </div>

                          {/* Alvo de toque: 44px LITERAL. `min-h-11` seria 2.75rem =
                              52.8px na base de 120% do projeto (globals.css). */}
                          {!modoSelecao && (
                            <div className="order-last flex w-full basis-full gap-2 sm:order-4 sm:w-auto sm:basis-auto">
                              <Button
                                variant="outline"
                                size="sm"
                                className="min-h-[44px] flex-1 sm:flex-none"
                                disabled={
                                  alternandoOculto &&
                                  idAlternandoOculto === p.id
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
                                disabled={
                                  alternandoDisp && idAlternandoDisp === p.id
                                }
                                aria-label={
                                  p.disponivel
                                    ? `Marcar ${p.nome} como esgotado`
                                    : `Disponibilizar ${p.nome}`
                                }
                                onClick={() => alternarDispon(p)}
                              >
                                {p.disponivel
                                  ? "Marcar esgotado"
                                  : "Disponibilizar"}
                              </Button>
                              {/* Editar/Remover consolidados no kebab: elimina os dois
                                  ícones cortados na borda e afasta a ação destrutiva do
                                  alvo de toque de "Marcar esgotado". Último filho deste
                                  grupo: fica à direita de Ocultar/Disponibilizar nos
                                  dois breakpoints, sem classe `order-*` própria — se
                                  algum dia quebrar, quebra junto com os botões do
                                  produto dele, nunca sozinho. */}
                              <Menu>
                                <MenuTrigger
                                  render={
                                    <Button
                                      variant="outline"
                                      size="icon"
                                      className="min-h-[44px] min-w-[44px] shrink-0"
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
                                      {/* [290] ADICIONAL ao "Editar" acima, não
                                          substituto: aquele abre o formulário
                                          inteiro (foto, desconto, vigência),
                                          este edita a linha no lugar. */}
                                      <MenuItem
                                        className="min-h-[44px]"
                                        aria-label={`Editar nome e preço de ${p.nome}`}
                                        onClick={() => abrirEdicaoInline(p)}
                                      >
                                        <PencilLine
                                          aria-hidden
                                          className="size-4"
                                        />
                                        Editar nome e preço
                                      </MenuItem>
                                      {/* [264/§13.4 item 5] O MESMO par de saídas
                                          do aviso de `/painel/cardapios`, aqui no
                                          kebab. Nenhuma das duas roda sozinha, e
                                          devolver ao menu mexe só NESTE produto —
                                          o sistema nunca converte `visibilidade`
                                          por conta própria. */}
                                      {sumicos[p.id] && hrefCardapios !== null && (
                                        <MenuItem
                                          className="min-h-[44px]"
                                          onClick={() =>
                                            router.push(hrefCardapios)
                                          }
                                        >
                                          {rotuloReligarOuEstender(
                                            sumicos[p.id].ativo,
                                          )}
                                        </MenuItem>
                                      )}
                                      {sumicos[p.id] && lote != null && (
                                        <MenuItem
                                          className="min-h-[44px]"
                                          onClick={() => void devolverAoMenu(p)}
                                        >
                                          Devolver ao menu
                                        </MenuItem>
                                      )}
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
                            </div>
                          )}
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

      {/* [260] O diálogo de alcance. `loteUI.dialogo` é `null` até a prévia
          do SERVIDOR chegar — não existe caminho que o monte antes. */}
      {loteUI.dialogo}

      {/* Gestão de categorias de produto */}
      <GerenciarCategorias
        categorias={categorias}
        open={categoriasAbertas}
        onOpenChange={setCategoriasAbertas}
        onCriar={acoes.criarCategoria}
        onAtualizar={acoes.atualizarCategoria}
        onRemover={acoes.removerCategoria}
        onAlternarExibirImagens={acoes.alternarExibirImagens}
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

      {/*
        Opcionais da categoria (217) — UM Dialog só, com classes responsivas,
        nunca duas árvores sob `useMediaQuery`. O cartão de dentro carrega
        estado pesado (seleção, grupo aberto, handle imperativo de reordenação e
        um autosave com debounce de 500ms): remontá-lo na hidratação e a cada
        cruzada de 768px DESCARTARIA o movimento pendente em silêncio. Molde:
        `components/vitrine/ProdutoModal.tsx` — base full-bleed no mobile
        (h-dvh/w-screen/rounded-none), `md:` restaura o box centralizado do
        primitivo e alarga para `max-w-3xl`.
      */}
      <Dialog
        open={categoriaOpcionaisAberta !== null}
        onOpenChange={(aberto) => {
          if (!aberto) setCategoriaOpcionaisAberta(null);
        }}
      >
        <DialogContent
          // O ✕ padrão é `absolute` sem z-index; o cabeçalho STICKY do cartão é
          // `z-10` e o cobriria. Por isso o fechar vem no cabeçalho do Dialog.
          showCloseButton={false}
          className="top-0 left-0 h-dvh max-h-none w-screen max-w-none translate-x-0 translate-y-0 gap-0 rounded-none p-0 md:top-1/2 md:left-1/2 md:h-[min(640px,calc(100dvh-2rem))] md:max-h-[calc(100dvh-2rem)] md:w-[calc(100vw-2rem)] md:max-w-3xl md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-2xl"
        >
          <DialogHeader className="shrink-0 flex-row items-center justify-between gap-2 border-b pr-2">
            {/* Título GENÉRICO de propósito: o nome da categoria é o cabeçalho
                sticky do cartão, logo abaixo. Repeti-lo aqui seria a mesma
                string duas vezes na mesma dobra. */}
            <DialogTitle>Opcionais</DialogTitle>
            <DialogDescription className="sr-only">
              Escolha quais categorias de opcional aparecem para os produtos de{" "}
              {categoriaOpcionaisAberta?.nome}, e em que ordem.
            </DialogDescription>
            <DialogClose
              render={<Button variant="ghost" size="icon-sm" />}
              aria-label="Fechar"
            >
              <X aria-hidden className="size-4" />
            </DialogClose>
          </DialogHeader>

          {/* O corpo ROLÁVEL — é ele que dá sentido ao `cabecalhoFixo`.
              `min-h-0` é o que deixa o `flex-1` encolher dentro do flex-col do
              `DialogContent` em vez de estourar a altura.

              SEM `pt` aqui, e o respiro de topo vai no filho: `sticky top-0` se
              ancora no PADDING BOX do container de scroll, então um `pt-4` no
              próprio container empurraria o cabeçalho grudado 1rem para baixo e
              deixaria uma faixa acima dele onde o conteúdo continua rolando
              visível, cortado no meio da linha. Com o respiro no filho ele
              rola embora normalmente e o cabeçalho gruda rente ao topo. */}
          <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
            {categoriaOpcionaisAberta && (
              // `Accordion` é OBRIGATÓRIO: o cartão devolve um `AccordionItem`,
              // que sem raiz não renderiza. `key` zera o estado interno ao
              // trocar de categoria.
              <Accordion
                multiple
                defaultValue={[categoriaOpcionaisAberta.id]}
                className="gap-4 pt-4"
              >
                <CartaoAssociacaoOpcionais
                  key={categoriaOpcionaisAberta.id}
                  categoriaProduto={categoriaOpcionaisAberta}
                  categoriasOpcional={categoriasOpcional}
                  selecionadosIniciais={
                    inicialPorProduto.get(categoriaOpcionaisAberta.id) ??
                    new Set()
                  }
                  ordemPorGrupo={
                    ordemPorProduto.get(categoriaOpcionaisAberta.id) ??
                    new Map()
                  }
                  totalItensPorGrupo={totalItensPorGrupo}
                  opcionaisPorGrupo={opcionaisPorGrupo}
                  alcancePorGrupo={alcancePorGrupo}
                  cabecalhoFixo
                  onSalvo={() => router.refresh()}
                  acoes={acoes}
                />
              </Accordion>
            )}
          </div>
        </DialogContent>
      </Dialog>

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
