"use client";

import { useMemo, useState, type ReactElement } from "react";
import Link from "next/link";
import { Loader2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
} from "@/components/ui/sheet";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { PilulasDeDias } from "@/components/painel/PilulasDeDias";
import {
  ESCOLHA_PADRAO,
  MOTIVO_CATEGORIA_SEM_DIAS,
  MOTIVO_SEM_DIA,
  escolhaValida,
  montarDiasDoLote,
  type EscolhaDeDias,
} from "@/components/painel/escolhaDeDias";
import { rotuloCategoriaInteira } from "@/lib/utils/copiaCardapioPainel";
import { rotuloDiasDoItem } from "@/lib/utils/descreverVigencia";
import {
  fraseCategoriaEhFoto,
  fraseEMais,
  fraseOcultos,
  frasesDeVisibilidade,
  perguntaLote,
} from "@/lib/utils/copiaLotePromocao";
import type { CardapioParaLote } from "@/components/painel/contrato-lote";
import type { EscopoDoLote } from "@/components/painel/useLoteDeProdutos";
import type { AlvoDoLote } from "@/components/painel/DialogoLoteCardapio";
import type { PreviaDoLote } from "@/components/painel/contrato-lote";

/** A régua de `design-system.md` §5: valor LITERAL, nunca `min-h-11`. */
const ALVO = "min-h-[44px] min-w-[44px]";

/** Quantos nomes a confirmação mostra (design §10.3): 3 no mobile, 6 no desktop. */
const NOMES_MOBILE = 3;
const NOMES_DESKTOP = 6;

/**
 * O nome acessível do diálogo. Título e descrição são elementos COMUNS com id,
 * apontados por `aria-labelledby`/`aria-describedby` no `SheetContent`, em vez
 * de `SheetTitle`/`SheetDescription`: aqueles exigem o contexto do `Dialog` e
 * tornariam o conteúdo do sheet impossível de montar em `renderToStaticMarkup`
 * — que é a única forma de afirmar markup neste repo (sem jsdom).
 */
const ID_TITULO = "sheet-adicionar-itens-titulo";
const ID_DESCRICAO = "sheet-adicionar-itens-descricao";

export type ProdutoDoSheet = {
  id: string;
  nome: string;
  /** Já vinculado a ESTE cardápio (D4: aparece esmaecido, não some). */
  noCardapio: boolean;
  /** `formatarMoeda` aplicada no SERVIDOR. */
  precoRotulo: string;
};

export type GrupoDoSheet = {
  /** `null` = "Sem categoria", que não é categoria e não tem gesto de lote. */
  id: string | null;
  nome: string;
  produtos: ProdutoDoSheet[];
};

export type SheetAdicionarItensProps = {
  cardapio: CardapioParaLote;
  /** A loja INTEIRA agrupada por categoria, montada no servidor. */
  grupos: GrupoDoSheet[];
  aberto: boolean;
  onAbertoChange: (aberto: boolean) => void;
  /**
   * O ciclo prever → confirmar → escrever, vindo de `useLoteDeProdutos`: as
   * MESMAS Server Actions das outras superfícies (RN-09), com a prévia do
   * SERVIDOR. Este componente não conta nada e não escreve direto.
   */
  lote: {
    abrirCardapio: (
      acao: "adicionar",
      cardapio: CardapioParaLote,
      escopo: EscopoDoLote,
      dias?: number[],
      diasPorProduto?: Record<string, number[]>,
    ) => void;
    prevendo: boolean;
    pendente: boolean;
    pedido: { alvo: AlvoDoLote; previa: PreviaDoLote } | null;
    confirmar: () => void;
    cancelar: () => void;
  };
  /** Destino de "criar produtos", INJETADO. `null` = mundo sem essa rota. */
  hrefProdutos: string | null;
};

/** Filtro PURO sobre o dado que já está no cliente — não é leitura nova (D6). */
function filtrar(grupos: GrupoDoSheet[], busca: string): GrupoDoSheet[] {
  const alvo = busca.trim().toLocaleLowerCase("pt-BR");
  if (alvo === "") return grupos;
  return grupos
    .map((grupo) => ({
      ...grupo,
      produtos: grupo.produtos.filter((p) =>
        p.nome.toLocaleLowerCase("pt-BR").includes(alvo),
      ),
    }))
    .filter((grupo) => grupo.produtos.length > 0);
}

/**
 * [288/D2·D3·D4·D6·D7] O sheet de adicionar itens ao cardápio.
 *
 * O checklist da loja inteira saiu da página e veio para cá; a escolha de dias
 * acontece na MESMA interação (D3), com o par "Todos os dias do cardápio"
 * (pré-marcado, grava `NULL` no servidor) e "Escolher dias".
 *
 * Três decisões travadas neste arquivo:
 *  1. **`showCloseButton={false}`** e um `SheetClose` próprio de 44px: o padrão
 *     do `sheet.tsx` usa `size="icon-sm"` (33,6px na base de 120%), e
 *     `components/ui/` é gerado pelo shadcn CLI — não se edita à mão.
 *  2. **a confirmação é um PASSO deste sheet**, não um `AlertDialog` por cima:
 *     overlay sobre overlay é a armadilha de ESC registrada em
 *     `design-system.md` §6. A prévia e a copy continuam as mesmas.
 *  3. **"categoria inteira" não aceita dias**: a RPC expande dentro da
 *     transação e não tem parâmetro de agenda (issue 287, fora de escopo). Com
 *     "Escolher dias" marcado o botão fica `aria-disabled` e o motivo aparece
 *     em TEXTO — nunca em `title`, que não chega a leitor de tela nem a toque.
 */
export function SheetAdicionarItens({
  aberto,
  onAbertoChange,
  lote,
  ...conteudo
}: SheetAdicionarItensProps): ReactElement {
  const ehDesktop = useMediaQuery("(min-width: 640px)");

  function fechar(): void {
    if (lote.pendente) return;
    // Fechar o sheet descarta o pedido pendente junto: deixar a prévia viva
    // atrás de um sheet fechado é estado invisível.
    lote.cancelar();
    onAbertoChange(false);
  }

  return (
    <Sheet
      open={aberto}
      onOpenChange={(proximo) => {
        if (proximo) onAbertoChange(true);
        else fechar();
      }}
    >
      <SheetContent
        side={ehDesktop ? "right" : "bottom"}
        // O close padrão do `sheet.tsx` usa `size="icon-sm"` — 33,6px na base
        // de 120%, abaixo dos 44px de `design-system.md` §5. `components/ui/` é
        // gerado pelo shadcn CLI e não se edita à mão, então o close é nosso.
        showCloseButton={false}
        className="h-[90dvh] gap-0 sm:h-full"
        aria-labelledby={ID_TITULO}
        aria-describedby={ID_DESCRICAO}
      >
        <ConteudoAdicionarItens
          {...conteudo}
          lote={lote}
          ehDesktop={ehDesktop}
          onFechar={fechar}
        />
      </SheetContent>
    </Sheet>
  );
}

/**
 * O CONTEÚDO do sheet, exportado à parte porque um `Sheet` aberto renderiza em
 * portal e portal não existe em `renderToStaticMarkup` (sem jsdom neste repo,
 * `react-dom/server` devolve string vazia). É este componente que os testes
 * montam — o shell acima é só posição e o `showCloseButton={false}`.
 */
export function ConteudoAdicionarItens({
  cardapio,
  grupos,
  lote,
  hrefProdutos,
  ehDesktop,
  onFechar,
}: Omit<SheetAdicionarItensProps, "aberto" | "onAbertoChange"> & {
  ehDesktop: boolean;
  onFechar: () => void;
}): ReactElement {
  const [busca, setBusca] = useState("");
  const [selecionados, setSelecionados] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [escolha, setEscolha] = useState<EscolhaDeDias>(ESCOLHA_PADRAO);
  /**
   * [289] A escolha PRÓPRIA de cada produto, quando ele tem uma. Ausente =
   * "não escolheu", e o produto herda o rodapé — a regra mora em
   * `montarDiasDoLote`, função pura, não neste handler.
   */
  const [porProduto, setPorProduto] = useState<
    Record<string, EscolhaDeDias | undefined>
  >({});
  const [verTodos, setVerTodos] = useState(false);

  const visiveis = useMemo(() => filtrar(grupos, busca), [grupos, busca]);

  /** Derivada da lista renderizada, nunca o `Set` cru (ver `ProdutosClient`). */
  const lista = useMemo(
    () =>
      grupos
        .flatMap((g) => g.produtos)
        .filter((p) => !p.noCardapio && selecionados.has(p.id))
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

  function definirDoProduto(id: string, propria: EscolhaDeDias): void {
    setPorProduto((atual) => ({ ...atual, [id]: propria }));
  }

  const semProduto = grupos.every((g) => g.produtos.length === 0);
  const escolhaOk = escolhaValida(escolha);
  const podeAdicionar = lista.length > 0 && escolhaOk && !lote.prevendo;
  const categoriaBloqueada = escolha.modo === "dias";

  function adicionarSelecionados(): void {
    if (!podeAdicionar) return;
    // [289] O fragmento de payload sai da função PURA: só produto marcado entra
    // no mapa, e sem ninguém com pílula própria a chave nem aparece.
    const { dias_semana, dias_por_produto } = montarDiasDoLote(
      lista,
      escolha,
      porProduto,
    );
    lote.abrirCardapio(
      "adicionar",
      cardapio,
      { tipo: "produtos", produto_ids: lista },
      dias_semana,
      dias_por_produto,
    );
  }

  function adicionarCategoria(grupo: GrupoDoSheet): void {
    if (categoriaBloqueada || grupo.id === null || lote.prevendo) return;
    lote.abrirCardapio("adicionar", cardapio, {
      tipo: "categoria",
      categoria_id: grupo.id,
      categoriaNome: grupo.nome,
    });
  }

  const pedido = lote.pedido;
  const confirmando = pedido !== null && pedido.alvo.tipo === "cardapio";

  return (
    <>
      <SheetHeader className="flex-row items-start justify-between gap-2 border-b">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2
            id={ID_TITULO}
            className="font-heading text-base font-medium text-foreground"
          >
            Adicionar itens
          </h2>
          <p id={ID_DESCRICAO} className="text-sm text-muted-foreground">
            {cardapio.nome} — {cardapio.descricao}
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

      {confirmando && pedido !== null ? (
        <PassoDeConfirmacao
          alvo={pedido.alvo}
          previa={pedido.previa}
          pendente={lote.pendente}
          ehDesktop={ehDesktop}
          verTodos={verTodos}
          onVerTodos={() => setVerTodos(true)}
          onConfirmar={lote.confirmar}
          onVoltar={() => {
            lote.cancelar();
            setVerTodos(false);
          }}
        />
      ) : (
        <>
          <div className="flex flex-col gap-2 overflow-y-auto px-4 py-3">
            <div className="flex flex-col gap-1">
              <Label htmlFor="busca-produtos" className="sr-only">
                Buscar produto pelo nome
              </Label>
              <Input
                id="busca-produtos"
                type="search"
                className={ALVO}
                placeholder="Buscar produto"
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
              />
            </div>

            {semProduto ? (
              <div className="flex flex-col gap-2 py-4 text-sm">
                <p>Você ainda não tem produtos.</p>
                {hrefProdutos !== null ? (
                  <Link href={hrefProdutos} className="w-fit text-sm underline">
                    Cadastrar produtos
                  </Link>
                ) : null}
              </div>
            ) : visiveis.length === 0 ? (
              <p className="py-4 text-sm">Nenhum produto com esse nome.</p>
            ) : (
              <Accordion multiple defaultValue={[]}>
                {visiveis.map((grupo) => {
                  const faltantes = grupo.produtos.filter(
                    (p) => !p.noCardapio,
                  ).length;
                  const jaNoCardapio = grupo.produtos.length - faltantes;
                  const rotuloCategoria =
                    grupo.id === null
                      ? null
                      : rotuloCategoriaInteira(faltantes, grupo.nome);
                  const idMotivo = `motivo-categoria-${grupo.id ?? "sem"}`;
                  return (
                    <AccordionItem
                      key={grupo.id ?? "sem-categoria"}
                      value={grupo.id ?? "sem-categoria"}
                    >
                      <AccordionTrigger className={ALVO}>
                        <span className="flex min-w-0 flex-col text-left">
                          <span className="truncate font-medium">
                            {grupo.nome}
                          </span>
                          <span className="text-xs font-normal text-texto-muted">
                            {grupo.produtos.length === 1
                              ? "1 produto"
                              : `${grupo.produtos.length} produtos`}
                            {jaNoCardapio > 0
                              ? ` · ${jaNoCardapio} já no cardápio`
                              : ""}
                          </span>
                        </span>
                      </AccordionTrigger>

                      <AccordionContent keepMounted className="pb-2">
                        {rotuloCategoria !== null ? (
                          <div className="flex flex-col gap-1 pb-2">
                            <Button
                              type="button"
                              variant="outline"
                              className={ALVO}
                              aria-label={rotuloCategoria.longo}
                              aria-disabled={categoriaBloqueada}
                              aria-describedby={
                                categoriaBloqueada ? idMotivo : undefined
                              }
                              onClick={() => adicionarCategoria(grupo)}
                            >
                              {rotuloCategoria.curto}
                            </Button>
                            {categoriaBloqueada ? (
                              <p
                                id={idMotivo}
                                className="text-xs text-texto-muted"
                              >
                                {MOTIVO_CATEGORIA_SEM_DIAS}
                              </p>
                            ) : null}
                          </div>
                        ) : null}

                        <ul className="flex flex-col">
                          {grupo.produtos.map((p) =>
                            p.noCardapio ? (
                              // D4: some do alcance, não da tela. Marcar quem
                              // já está produziria seleção que não escreve
                              // nada (`ON CONFLICT DO NOTHING`) e uma prévia
                              // do servidor menor que a seleção.
                              <li key={p.id}>
                                <div className="flex min-h-[44px] flex-wrap items-center gap-x-2 opacity-70">
                                  <span className="min-w-0 flex-1 text-sm">
                                    {p.nome}
                                  </span>
                                  <span className="text-xs text-texto-muted">
                                    Já está neste cardápio
                                  </span>
                                </div>
                              </li>
                            ) : (
                              <li key={p.id}>
                                <div className="rounded-lg border border-border bg-card p-2">
                                  <label className="flex min-h-[44px] cursor-pointer items-center gap-2">
                                    <Checkbox
                                      checked={selecionados.has(p.id)}
                                      onCheckedChange={() => alternar(p.id)}
                                      aria-label={`Selecionar ${p.nome}`}
                                    />
                                    <span className="min-w-0 flex-1 text-sm">
                                      {p.nome}
                                    </span>
                                    <span className="text-xs text-texto-muted tabular-nums">
                                      {p.precoRotulo}
                                    </span>
                                  </label>
                                  {selecionados.has(p.id) ? (
                                    <DiasDoProduto
                                      produto={p}
                                      escolha={porProduto[p.id]}
                                      onEscolha={(propria) =>
                                        definirDoProduto(p.id, propria)
                                      }
                                    />
                                  ) : null}
                                </div>
                              </li>
                            ),
                          )}
                        </ul>
                      </AccordionContent>
                    </AccordionItem>
                  );
                })}
              </Accordion>
            )}
          </div>

          <SheetFooter className="border-t">
            <RadioGroup
              value={escolha.modo}
              onValueChange={(valor) =>
                setEscolha(
                  valor === "dias"
                    ? { modo: "dias", dias: [] }
                    : ESCOLHA_PADRAO,
                )
              }
            >
              <label className="flex min-h-[44px] items-center gap-2 text-sm">
                <RadioGroupItem value="cardapio" />
                Todos os dias do cardápio
              </label>
              <label className="flex min-h-[44px] items-center gap-2 text-sm">
                <RadioGroupItem value="dias" />
                Escolher dias
              </label>
            </RadioGroup>

            {escolha.modo === "dias" ? (
              <div className="flex flex-col gap-1">
                <PilulasDeDias
                  compacto
                  valor={escolha.dias}
                  onChange={(dias) => setEscolha({ modo: "dias", dias })}
                  rotulo="Dias em que estes produtos aparecem neste cardápio"
                  descritoPor={escolhaOk ? undefined : "motivo-sem-dia"}
                />
                {!escolhaOk ? (
                  <p id="motivo-sem-dia" className="text-xs text-texto-muted">
                    {MOTIVO_SEM_DIA}
                  </p>
                ) : null}
              </div>
            ) : null}

            <p aria-live="polite" className="text-sm font-medium">
              {lista.length === 0
                ? "Nenhum produto selecionado"
                : `${lista.length} ${lista.length === 1 ? "produto selecionado" : "produtos selecionados"}`}
            </p>

            <Button
              type="button"
              className={`${ALVO} w-full`}
              aria-disabled={!podeAdicionar}
              aria-describedby={escolhaOk ? undefined : "motivo-sem-dia"}
              onClick={adicionarSelecionados}
            >
              {lote.prevendo ? (
                <Loader2 aria-hidden className="animate-spin" />
              ) : null}
              Adicionar ao cardápio
            </Button>
          </SheetFooter>
        </>
      )}
    </>
  );
}

/**
 * [289] As pílulas do PRODUTO, sob o produto marcado — `PilulasDeDias` em reuso
 * DIRETO, sem variante nova (é o mesmo componente do rodapé e do card do item).
 *
 * Só aparece com o produto marcado: pílula de produto que não vai no lote é
 * estado que não escreve. Enquanto ninguém mexer aqui, o produto herda o
 * rodapé — a regra é de `montarDiasDoLote`, não deste handler.
 */
function DiasDoProduto({
  produto,
  escolha,
  onEscolha,
}: {
  produto: ProdutoDoSheet;
  escolha: EscolhaDeDias | undefined;
  onEscolha: (escolha: EscolhaDeDias) => void;
}): ReactElement {
  // Desmarcar a última pílula é escolher EXPLICITAMENTE "todos os dias" para
  // este produto (entra no mapa como `[]`, que o servidor grava como NULL) —
  // não é voltar a herdar o rodapé, e por isso nunca fica em estado inválido.
  const dias =
    escolha === undefined || escolha.modo === "cardapio" ? [] : escolha.dias;
  // A transição "limpei a última pílula" é silenciosa demais sem isto: o
  // lojista que desmarca tudo pensando em revisar depois liberaria o produto
  // para todos os dias sem ver o estado mudar. A frase é a MESMA redação de
  // `rotuloDiasDoItem`, usada no card do item — nenhuma copy nova.
  const rotulo = rotuloDiasDoItem(dias.length === 0 ? null : dias);
  return (
    <div className="flex flex-col gap-1 pl-8">
      <PilulasDeDias
        compacto
        valor={dias}
        onChange={(proximos) =>
          onEscolha(
            proximos.length === 0
              ? ESCOLHA_PADRAO
              : { modo: "dias", dias: proximos },
          )
        }
        rotulo={`Dias em que ${produto.nome} aparece neste cardápio`}
      />
      <span className="text-xs text-texto-muted">
        {rotulo === null ? "Todos os dias do cardápio" : `Só ${rotulo}`}
      </span>
    </div>
  );
}

/**
 * [D7] O passo de confirmação — MESMA prévia do servidor e MESMA copy de
 * `copiaLotePromocao.ts` do `DialogoLoteCardapio`; muda só o container, que
 * aqui é o próprio sheet em vez de um overlay por cima dele.
 */
function PassoDeConfirmacao({
  alvo,
  previa,
  pendente,
  ehDesktop,
  verTodos,
  onVerTodos,
  onConfirmar,
  onVoltar,
}: {
  alvo: AlvoDoLote;
  previa: PreviaDoLote;
  pendente: boolean;
  ehDesktop: boolean;
  verTodos: boolean;
  onVerTodos: () => void;
  onConfirmar: () => void;
  onVoltar: () => void;
}): ReactElement | null {
  if (alvo.tipo !== "cardapio") return null;

  const copia = perguntaLote({
    acao: alvo.acao,
    nomeCardapio: alvo.cardapio.nome,
    nomes: previa.nomes,
    total: previa.total,
  });

  const limite = verTodos
    ? previa.nomes.length
    : ehDesktop
      ? NOMES_DESKTOP
      : NOMES_MOBILE;
  const nomes = previa.nomes.slice(0, limite);
  const eMais = fraseEMais(previa.total, nomes.length);
  const podeExpandir = !verTodos && previa.nomes.length > nomes.length;
  const avisoOcultos = fraseOcultos(previa.ocultos);

  return (
    <>
      <div className="flex flex-col gap-2 overflow-y-auto px-4 py-3 text-sm">
        <p className="font-heading text-base font-semibold">{copia.titulo}</p>
        <p>{copia.corpo}</p>

        {nomes.length > 0 ? (
          <ul className="list-disc pl-5">
            {nomes.map((nome) => (
              <li key={nome}>{nome}</li>
            ))}
          </ul>
        ) : null}

        {eMais !== null || podeExpandir ? (
          <div className="flex flex-wrap items-center gap-2 text-texto-muted">
            {eMais !== null ? <span>{eMais}</span> : null}
            {podeExpandir ? (
              <Button
                type="button"
                variant="outline"
                className={ALVO}
                onClick={onVerTodos}
              >
                Ver todos
              </Button>
            ) : null}
          </div>
        ) : null}

        {/* A janela do cardápio, redigida no SERVIDOR. */}
        <p>{alvo.cardapio.descricao}</p>
        {frasesDeVisibilidade({
          menu: previa.menu,
          cardapio: previa.cardapio,
        }).map((frase) => (
          <p key={frase}>{frase}</p>
        ))}
        {alvo.categoriaNome !== null ? (
          <p>{fraseCategoriaEhFoto(previa.total, alvo.categoriaNome)}</p>
        ) : null}
        {avisoOcultos !== null ? <p>{avisoOcultos}</p> : null}
      </div>

      <SheetFooter className="border-t">
        <Button
          type="button"
          className={`${ALVO} w-full`}
          // Prévia vazia = a seleção inteira sumiu sob a RLS. Não há escrita a
          // oferecer, e o rótulo já diz "Nada a adicionar".
          disabled={pendente || previa.total === 0}
          onClick={onConfirmar}
        >
          {pendente ? <Loader2 aria-hidden className="animate-spin" /> : null}
          {copia.rotuloConfirmar}
        </Button>
        <Button
          type="button"
          variant="outline"
          className={`${ALVO} w-full`}
          disabled={pendente}
          onClick={onVoltar}
        >
          Voltar
        </Button>
      </SheetFooter>
    </>
  );
}
