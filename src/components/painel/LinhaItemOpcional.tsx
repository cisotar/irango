"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import {
  ArrowDown,
  ArrowUp,
  ChevronsDown,
  ChevronsUp,
  Eye,
  EyeOff,
  Loader2,
  MoreVertical,
  Pencil,
  Trash2,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuPortal,
  MenuPositioner,
  MenuTrigger,
} from "@/components/ui/menu";
import { formatarMoeda } from "@/lib/utils/formatarMoeda";
import {
  fraseAlcanceDaEdicao,
  perguntaDeRemocao,
} from "@/lib/utils/alcance-do-grupo";
import { schemaOpcional, type OpcionalFormData } from "@/lib/validacoes/opcional";
import type { Opcional } from "@/lib/supabase/queries/opcionais";

/**
 * Uma linha (`<li>`) da lista de ITENS de um grupo de opcional (issue 216).
 *
 * ─────────────────────────────────────────── Por que não é a linha de categoria
 * `LinhaCategoriaReordenavel` é a linha de GRUPO. Esta tem três estados que
 * trocam o `<li>` INTEIRO (em `confirmando` somem número, setas e kebab) e
 * NÃO chama `useSortable` — ela vive dentro da lista de grupos, que já é um
 * `DndContext`, e uma alça aqui seria contexto dentro de contexto com o
 * `pointerdown` da alça interna borbulhando para o sensor externo. São
 * componentes irmãos de propósito: enfiar isto lá seria gutar a linha de grupo.
 *
 * ─────────────────────────────────────────── As três travas de a11y
 *  1. **`aria-disabled`, NUNCA `disabled`.** Em `salvando`/`removendo` o foco
 *     está EM CIMA do botão; `disabled` o tiraria da ordem de foco e o jogaria
 *     no `<body>`. O handler guarda com `if (emVoo) return;`.
 *  2. **`Escape` com `stopPropagation()`.** Na 217 este cartão vai para dentro
 *     de um modal tela cheia: sem isso, o `Escape` sobe e fecha o MODAL em vez
 *     de cancelar a confirmação — a armadilha que motivou a recusa ao
 *     `AlertDialog` aninhado. O handler mora no container de cada estado, nunca
 *     em `window`, senão roubaria `Escape` com a linha em `leitura`.
 *  3. **Alvos de 44px LITERAIS.** `min-h-11` = 52,8px na base de 120% e
 *     `size="icon-sm"` = 33,6px — nenhum dos dois serve.
 *
 * ─────────────────────────────────────────── Inativo
 * `<Badge variant="outline">Inativo</Badge>`, como a aba Biblioteca já faz.
 * Nada de `opacity-`, tachado ou linha acinzentada: o item inativo OCUPA
 * posição real na ordem (a RPC exige a permutação completa, inativos
 * incluídos), então ele é editável, removível e móvel como qualquer outro — uma
 * linha apagada mentiria sobre isso, e derrubaria o contraste abaixo de 4.5:1.
 */

/** 44px literal em alvo de toque — ver comentário acima. */
const ALVO_TOQUE = "min-h-[44px] min-w-[44px]";

export type ModoLinhaItem = "leitura" | "editando" | "confirmando";

/** Aceita vírgula decimal (UX pt-BR), como o formulário da Biblioteca já faz. */
function paraNumero(valor: string): number {
  return Number(valor.replace(",", "."));
}

export type FormularioItemInlineProps = {
  /** Valores iniciais. Item novo entra com os dois vazios. */
  nomeInicial?: string;
  precoInicial?: string;
  /** Campos que o formulário NÃO edita, mas que o `schemaOpcional` exige. */
  grupoId: string;
  ativo: boolean;
  /**
   * `ordem` do payload. É o ÍNDICE atual da linha, nunca o `item.ordem` das
   * props: `atualizarOpcional` faz `update({...parsed.data})` sobre um schema
   * `.strict()` que exige `ordem`, então mandar a ordem velha jogaria o item de
   * volta para o lugar anterior logo depois de um reordenar. O pai dá flush no
   * salvamento coalescido antes de chamar a action, e aí índice == ordem.
   */
  ordem: number;
  /** Nomes das categorias de PRODUTO que usam o grupo. */
  alcance: readonly string[];
  emVoo: boolean;
  onSalvar: (payload: OpcionalFormData) => void;
  onCancelar: () => void;
};

/**
 * Os dois campos + Salvar/Cancelar da edição inline. Extraído porque a linha
 * NOVA (botão "Adicionar opcional") usa exatamente a mesma forma — é o que
 * mantém a promessa de "nenhum segundo overlay a partir daqui".
 *
 * Valida com `schemaOpcional` — o MESMO schema da Server Action. Aqui é UX
 * (marcar o campo); a autoridade continua sendo o servidor.
 */
export function FormularioItemInline({
  nomeInicial = "",
  precoInicial = "",
  grupoId,
  ativo,
  ordem,
  alcance,
  emVoo,
  onSalvar,
  onCancelar,
}: FormularioItemInlineProps) {
  const idBase = useId();
  const idAlcance = `${idBase}-alcance`;
  const idErro = `${idBase}-erro`;
  const [nome, setNome] = useState(nomeInicial);
  const [preco, setPreco] = useState(precoInicial);
  const [erro, setErro] = useState<string | null>(null);

  const frase = fraseAlcanceDaEdicao(alcance);
  // Quem foca o campo OUVE o alcance; o cinza sozinho só serve a quem enxerga.
  const descritores = [erro != null ? idErro : null, frase != null ? idAlcance : null]
    .filter((v) => v != null)
    .join(" ");

  function salvar() {
    if (emVoo) return;
    const parsed = schemaOpcional.safeParse({
      nome: nome.trim(),
      preco: paraNumero(preco),
      categoria_opcional_id: grupoId,
      ativo,
      ordem,
    });
    if (!parsed.success) {
      setErro("Confira o nome e o preço: o preço vai em reais, com até 2 casas.");
      return;
    }
    setErro(null);
    onSalvar(parsed.data);
  }

  function aoTeclar(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape") {
      // Sem isto, dentro do modal da 217 o Escape fecharia o MODAL inteiro.
      e.stopPropagation();
      if (emVoo) return;
      onCancelar();
      return;
    }
    if (e.key === "Enter") {
      // Salva em vez de submeter um `<form>` de fora (o cartão vive dentro de
      // outros formulários no painel).
      e.preventDefault();
      salvar();
    }
  }

  return (
    <div className="min-w-0 flex-1 space-y-2" onKeyDown={aoTeclar}>
      <Input
        autoFocus
        value={nome}
        onChange={(e) => setNome(e.target.value)}
        aria-label="Nome do opcional"
        aria-invalid={erro != null}
        aria-describedby={descritores === "" ? undefined : descritores}
        placeholder="Nome"
        className="min-h-[44px]"
      />
      <Input
        value={preco}
        onChange={(e) => setPreco(e.target.value)}
        inputMode="decimal"
        aria-label={`Preço de ${nome.trim() === "" ? "opcional" : nome.trim()} em reais`}
        aria-invalid={erro != null}
        aria-describedby={descritores === "" ? undefined : descritores}
        placeholder="0,00"
        className="min-h-[44px]"
      />
      {erro != null && (
        <p id={idErro} className="text-xs text-destructive">
          {erro}
        </p>
      )}
      {frase != null && (
        <p id={idAlcance} className="text-xs text-muted-foreground">
          {frase}
        </p>
      )}
      <div className="flex gap-2">
        <Button
          type="button"
          className={`flex-1 ${ALVO_TOQUE}`}
          aria-disabled={emVoo}
          onClick={salvar}
        >
          {emVoo && <Loader2 aria-hidden className="mr-2 size-4 animate-spin" />}
          Salvar
        </Button>
        <Button
          type="button"
          variant="outline"
          className={`flex-1 ${ALVO_TOQUE}`}
          aria-disabled={emVoo}
          onClick={() => {
            if (emVoo) return;
            onCancelar();
          }}
        >
          Cancelar
        </Button>
      </div>
    </div>
  );
}

export type LinhaItemOpcionalProps = {
  item: Opcional;
  indice: number;
  total: number;
  modo: ModoLinhaItem;
  /** Chamada ao servidor em voo por causa DESTA linha. */
  emVoo: boolean;
  /** Nomes das categorias de PRODUTO que usam o grupo (propriedade do GRUPO). */
  alcance: readonly string[];
  grupoNome: string;
  /** Recebe (de, para). O clamp/no-op é do `moverPorDeslocamento` no pai. */
  onMover: (de: number, para: number) => void;
  onEditar: () => void;
  onSalvarEdicao: (payload: OpcionalFormData) => void;
  onAlternarAtivo: () => void;
  onPedirRemocao: () => void;
  onConfirmarRemocao: () => void;
  onCancelar: () => void;
};

export function LinhaItemOpcional({
  item,
  indice,
  total,
  modo,
  emVoo,
  alcance,
  grupoNome,
  onMover,
  onEditar,
  onSalvarEdicao,
  onAlternarAtivo,
  onPedirRemocao,
  onConfirmarRemocao,
  onCancelar,
}: LinhaItemOpcionalProps) {
  const idBase = useId();
  const idPergunta = `${idBase}-pergunta`;
  const kebabRef = useRef<HTMLButtonElement>(null);
  const botaoNomeRef = useRef<HTMLButtonElement>(null);
  const modoAnterior = useRef<ModoLinhaItem>(modo);

  /*
    Foco ao SAIR de um estado, determinístico e nos dois caminhos: cancelar a
    confirmação devolve o foco ao kebab (o invocador), cancelar a edição devolve
    ao botão nome/preço. Feito em efeito porque o nó de destino NÃO EXISTE
    enquanto a linha está fora de `leitura` — ele só volta a existir depois do
    render que reabre o estado de leitura.
  */
  useEffect(() => {
    if (modoAnterior.current !== modo && modo === "leitura") {
      if (modoAnterior.current === "confirmando") kebabRef.current?.focus();
      else botaoNomeRef.current?.focus();
    }
    modoAnterior.current = modo;
  }, [modo]);

  const noTopo = indice === 0;
  const noFim = indice === total - 1;

  function mover(para: number) {
    if (emVoo) return;
    onMover(indice, para);
  }

  if (modo === "editando") {
    return (
      <li className="border-b border-border/70 py-2 last:border-b-0">
        <div className="flex items-start gap-2">
          <span className="w-6 shrink-0 pt-3 text-sm tabular-nums text-muted-foreground">
            {indice + 1}.
          </span>
          <FormularioItemInline
            nomeInicial={item.nome}
            precoInicial={String(item.preco).replace(".", ",")}
            grupoId={item.categoria_opcional_id}
            ativo={item.ativo}
            ordem={indice}
            alcance={alcance}
            emVoo={emVoo}
            onSalvar={onSalvarEdicao}
            onCancelar={onCancelar}
          />
        </div>
      </li>
    );
  }

  if (modo === "confirmando") {
    return (
      <li className="border-b border-border/70 py-2 last:border-b-0">
        {/*
          `role="group"`, NÃO `role="alertdialog"`: não há trapa de foco aqui —
          a tabulação continua saindo da linha para o resto do cartão. Declarar
          `alertdialog` sem `aria-modal` e sem trapa seria mentir para a
          tecnologia assistiva. O `<li>` NÃO é desmontado: só o conteúdo troca,
          e o `<ol>` e a numeração seguem válidos.
        */}
        <div
          role="group"
          aria-labelledby={idPergunta}
          onKeyDown={(e) => {
            if (e.key !== "Escape") return;
            e.stopPropagation();
            if (emVoo) return;
            onCancelar();
          }}
          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-destructive/40 bg-background p-2"
        >
          <p
            id={idPergunta}
            className="min-w-0 flex-1 text-sm text-foreground"
          >
            {perguntaDeRemocao({
              nomeItem: item.nome,
              alcance,
              ehUltimoDoGrupo: total === 1,
              grupoNome,
            })}
          </p>
          <span className="flex shrink-0 gap-2">
            {/* Foco entra no CANCELAR: quem tecla Enter por reflexo cancela em
                vez de destruir. */}
            <Button
              type="button"
              autoFocus
              variant="outline"
              className={ALVO_TOQUE}
              aria-disabled={emVoo}
              onClick={() => {
                if (emVoo) return;
                onCancelar();
              }}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              variant="destructive"
              className={ALVO_TOQUE}
              aria-disabled={emVoo}
              onClick={() => {
                if (emVoo) return;
                onConfirmarRemocao();
              }}
            >
              {emVoo && (
                <Loader2 aria-hidden className="mr-2 size-4 animate-spin" />
              )}
              Remover
            </Button>
          </span>
        </div>
      </li>
    );
  }

  return (
    <li className="flex items-center gap-2 border-b border-border/70 py-1 last:border-b-0">
      {/* A posição numérica é VISÍVEL: sem ela, "deslocamento" e "troca" ficam
          indistinguíveis para quem só olha o resultado. */}
      <span className="w-6 shrink-0 text-sm tabular-nums text-muted-foreground">
        {indice + 1}.
      </span>

      {/* Nome + preço são UM alvo só: em 360px sobra ~238px para o nome, e este
          é o maior alvo de toque da linha — de graça. */}
      <button
        type="button"
        ref={botaoNomeRef}
        onClick={onEditar}
        aria-label={`Editar ${item.nome}, ${formatarMoeda(item.preco)}`}
        className="flex min-h-[44px] min-w-0 flex-1 items-baseline justify-between gap-3 rounded-lg text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-medium text-foreground">
            {item.nome}
          </span>
          {!item.ativo && <Badge variant="outline">Inativo</Badge>}
        </span>
        <span className="shrink-0 text-sm text-muted-foreground">
          +{formatarMoeda(item.preco)}
        </span>
      </button>

      {/* gap-2: dois alvos de 44px encostados convidam ao toque errado. */}
      <div className="flex shrink-0 items-center gap-2">
        {/* Abaixo de `sm` as setas somem e viram itens do kebab: com elas
            visíveis sobrariam ~134px para o nome, e "Requeijão light" viraria
            "Requeij…". Nenhum caminho de teclado se perde. */}
        <Button
          variant="outline"
          size="sm"
          className={`hidden sm:inline-flex ${ALVO_TOQUE}`}
          aria-label={`Mover ${item.nome} para cima`}
          aria-disabled={noTopo || emVoo}
          onClick={() => mover(indice - 1)}
        >
          <ArrowUp aria-hidden className="size-4" />
        </Button>
        <Button
          variant="outline"
          size="sm"
          className={`hidden sm:inline-flex ${ALVO_TOQUE}`}
          aria-label={`Mover ${item.nome} para baixo`}
          aria-disabled={noFim || emVoo}
          onClick={() => mover(indice + 1)}
        >
          <ArrowDown aria-hidden className="size-4" />
        </Button>

        <Menu>
          <MenuTrigger
            render={
              <Button
                ref={kebabRef}
                variant="ghost"
                size="sm"
                className={ALVO_TOQUE}
                aria-label={`Mais ações de ${item.nome}`}
              />
            }
          >
            <MoreVertical aria-hidden className="size-4" />
          </MenuTrigger>
          <MenuPortal>
            <MenuPositioner align="end">
              <MenuPopup>
                <MenuItem
                  className="min-h-[44px] sm:hidden"
                  aria-disabled={noTopo || emVoo}
                  onClick={() => mover(indice - 1)}
                >
                  <ArrowUp aria-hidden className="size-4" />
                  Mover para cima
                </MenuItem>
                <MenuItem
                  className="min-h-[44px] sm:hidden"
                  aria-disabled={noFim || emVoo}
                  onClick={() => mover(indice + 1)}
                >
                  <ArrowDown aria-hidden className="size-4" />
                  Mover para baixo
                </MenuItem>
                <MenuItem
                  className="min-h-[44px]"
                  aria-disabled={noTopo || emVoo}
                  onClick={() => mover(0)}
                >
                  <ChevronsUp aria-hidden className="size-4" />
                  Mover para o topo
                </MenuItem>
                <MenuItem
                  className="min-h-[44px]"
                  aria-disabled={noFim || emVoo}
                  onClick={() => mover(total - 1)}
                >
                  <ChevronsDown aria-hidden className="size-4" />
                  Mover para o fim
                </MenuItem>
                <MenuItem className="min-h-[44px]" onClick={onEditar}>
                  <Pencil aria-hidden className="size-4" />
                  Editar
                </MenuItem>
                {/*
                  Mostrar "Inativo" sem permitir ativar reproduziria o problema
                  que esta issue existe para matar (sair para a aba Biblioteca).
                  O rótulo carrega o estado em TEXTO — mais acessível que um
                  switch sem rótulo visível, e sem gastar um 5º alvo de 44px.
                */}
                <MenuItem
                  className="min-h-[44px]"
                  aria-disabled={emVoo}
                  onClick={onAlternarAtivo}
                >
                  {item.ativo ? (
                    <EyeOff aria-hidden className="size-4" />
                  ) : (
                    <Eye aria-hidden className="size-4" />
                  )}
                  {item.ativo ? "Desativar na vitrine" : "Ativar na vitrine"}
                </MenuItem>
                <MenuItem
                  className="min-h-[44px] text-destructive"
                  aria-disabled={emVoo}
                  onClick={onPedirRemocao}
                >
                  <Trash2 aria-hidden className="size-4" />
                  Remover
                </MenuItem>
              </MenuPopup>
            </MenuPositioner>
          </MenuPortal>
        </Menu>
      </div>
    </li>
  );
}
