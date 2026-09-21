"use client";

import { useState, type ReactElement } from "react";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { PilulasDeDias } from "@/components/painel/PilulasDeDias";
import {
  perguntaLote,
  perguntaVisibilidade,
  perguntaDias,
  FRASE_SO_QUEM_ESTA_NO_CARDAPIO,
  frasesDeVisibilidade,
  fraseCategoriaEhFoto,
  fraseOcultos,
  fraseEMais,
  type AcaoLote,
  type AcaoVisibilidade,
} from "@/lib/utils/copiaLotePromocao";
import type {
  CardapioParaLote,
  PreviaDoLote,
} from "@/components/painel/contrato-lote";

/** A régua de `design-system.md` §5: valor LITERAL, nunca `min-h-11`. */
const ALVO = "min-h-[44px] min-w-[44px]";

/** Quantos nomes a lista mostra fechada (design §10.3): 3 no mobile, 6 no desktop. */
const NOMES_MOBILE = 3;
const NOMES_DESKTOP = 6;

/** O que a ação vai fazer — é isso que escolhe a redação do módulo puro. */
export type AlvoDoLote =
  | {
      tipo: "cardapio";
      acao: AcaoLote;
      cardapio: CardapioParaLote;
      /**
       * Nome da categoria quando o gesto foi "categoria inteira" (RN-10):
       * dispara a frase de FOTO. `null` numa seleção explícita de produtos.
       */
      categoriaNome: string | null;
    }
  | { tipo: "visibilidade"; acao: AcaoVisibilidade }
  /**
   * [277] "Definir dias": os dias moram no HOOK (junto do resto do ciclo) e
   * chegam aqui controlados, como em toda outra superfície de `PilulasDeDias`.
   * Este arquivo continua sem redigir uma frase e sem calcular um número.
   */
  | {
      tipo: "dias";
      cardapio: CardapioParaLote;
      dias: number[];
      onDias: (dias: number[]) => void;
    };

export type DialogoLoteCardapioProps = {
  /**
   * 🔴 OBRIGATÓRIA e vinda do SERVIDOR (`preverLoteAction`, M8 / RN-09-a). O
   * diálogo NÃO EXISTE antes de a prévia chegar: o chamador o monta só depois
   * da resposta, e enquanto ela está em voo mostra `Loader2` no botão.
   *
   * A obrigatoriedade é a trava possível sem jsdom — omitir a prop é erro de
   * `tsc`, não um diálogo que conta a seleção do cliente. A seleção pode estar
   * velha (outro dispositivo mexeu no catálogo) ou conter id de outra loja, e
   * só o servidor resolve nomes e contagem sob RLS.
   */
  previa: PreviaDoLote;
  alvo: AlvoDoLote;
  /** Ação em voo: desabilita os dois botões, sem trocar o rótulo. */
  pendente: boolean;
  onConfirmar: () => void;
  onCancelar: () => void;
};

/**
 * [260] A confirmação de alcance da ação em lote (design §10.2, mecanismo M8).
 *
 * `AlertDialog` e não `Dialog`: a ação muda o que a vitrine mostra para todos
 * os clientes da loja. Toda a redação vem de `lib/utils/copiaLotePromocao.ts`
 * — nenhuma frase é escrita neste arquivo, e nenhum número é calculado aqui.
 */
export function DialogoLoteCardapio({
  previa,
  alvo,
  pendente,
  onConfirmar,
  onCancelar,
}: DialogoLoteCardapioProps): ReactElement {
  const ehDesktop = useMediaQuery("(min-width: 768px)");
  const [verTodos, setVerTodos] = useState(false);

  const copia =
    alvo.tipo === "cardapio"
      ? perguntaLote({
          acao: alvo.acao,
          nomeCardapio: alvo.cardapio.nome,
          nomes: previa.nomes,
          total: previa.total,
        })
      : alvo.tipo === "dias"
        ? perguntaDias({
            nomeCardapio: alvo.cardapio.nome,
            nomes: previa.nomes,
            total: previa.total,
            dias: alvo.dias,
          })
        : perguntaVisibilidade({
            acao: alvo.acao,
            nomes: previa.nomes,
            total: previa.total,
          });

  const limite = verTodos
    ? previa.nomes.length
    : ehDesktop
      ? NOMES_DESKTOP
      : NOMES_MOBILE;
  const visiveis = previa.nomes.slice(0, limite);
  const eMais = fraseEMais(previa.total, visiveis.length);
  const podeExpandir = !verTodos && previa.nomes.length > visiveis.length;

  // As duas frases de D14 só fazem sentido na janela de um cardápio; na
  // declaração de visibilidade a consequência já está no corpo.
  const frasesD14 =
    alvo.tipo === "cardapio"
      ? frasesDeVisibilidade({ menu: previa.menu, cardapio: previa.cardapio })
      : [];
  const avisoOcultos = fraseOcultos(previa.ocultos);

  return (
    <AlertDialog
      open
      onOpenChange={(aberto) => {
        // ESC e clique fora passam por aqui — a mesma saída do "Cancelar".
        if (!aberto) onCancelar();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{copia.titulo}</AlertDialogTitle>
          <AlertDialogDescription>{copia.corpo}</AlertDialogDescription>
        </AlertDialogHeader>

        {visiveis.length > 0 ? (
          <ul className="max-h-48 list-disc overflow-y-auto pl-5 text-sm">
            {visiveis.map((nome) => (
              <li key={nome}>{nome}</li>
            ))}
          </ul>
        ) : null}

        {eMais !== null || podeExpandir ? (
          <div className="flex flex-wrap items-center gap-2 text-sm text-texto-muted">
            {eMais !== null ? <span>{eMais}</span> : null}
            {podeExpandir ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className={ALVO}
                onClick={() => setVerTodos(true)}
              >
                Ver todos
              </Button>
            ) : null}
          </div>
        ) : null}

        {/* [277] As 7 pílulas dentro do diálogo. O mesmo componente das outras
            duas superfícies — nenhuma pílula é recriada aqui. */}
        {alvo.tipo === "dias" ? (
          <div className="flex flex-col gap-2">
            <PilulasDeDias
              compacto
              valor={alvo.dias}
              onChange={alvo.onDias}
              rotulo="Dias em que estes produtos aparecem neste cardápio"
              desabilitado={pendente}
            />
            <p className="text-sm text-texto-muted">
              {FRASE_SO_QUEM_ESTA_NO_CARDAPIO}
            </p>
          </div>
        ) : null}

        <div className="flex flex-col gap-2 text-sm">
          {/* A janela do cardápio, redigida no SERVIDOR (`descreverVigencia`). */}
          {alvo.tipo === "cardapio" || alvo.tipo === "dias" ? (
            <p>{alvo.cardapio.descricao}</p>
          ) : null}
          {frasesD14.map((frase) => (
            <p key={frase}>{frase}</p>
          ))}
          {alvo.tipo === "cardapio" && alvo.categoriaNome !== null ? (
            <p>{fraseCategoriaEhFoto(previa.total, alvo.categoriaNome)}</p>
          ) : null}
          {avisoOcultos !== null ? <p>{avisoOcultos}</p> : null}
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel className={ALVO} disabled={pendente}>
            Cancelar
          </AlertDialogCancel>
          <Button
            type="button"
            className={ALVO}
            // Prévia vazia = a seleção inteira sumiu sob a RLS. Não há escrita
            // a oferecer, e o rótulo já diz "Nada a adicionar".
            disabled={pendente || previa.total === 0}
            onClick={onConfirmar}
          >
            {pendente ? <Loader2 aria-hidden className="animate-spin" /> : null}
            {copia.rotuloConfirmar}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
