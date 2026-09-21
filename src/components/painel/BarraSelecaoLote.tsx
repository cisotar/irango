"use client";

import type { ReactElement } from "react";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuPortal,
  MenuPositioner,
  MenuTrigger,
} from "@/components/ui/menu";
import type { CardapioParaLote } from "@/components/painel/contrato-lote";
import type { AcaoLote, AcaoVisibilidade } from "@/lib/utils/copiaLotePromocao";

/** A régua de `design-system.md` §5: valor LITERAL, nunca `min-h-11`. */
const ALVO = "min-h-[44px] min-w-[44px]";

export type BarraSelecaoLoteProps = {
  /** Só a CONTAGEM LOCAL da intenção — nunca o número que o diálogo anuncia. */
  selecionados: readonly string[];
  /** Destinos possíveis. Vazio ⇒ a loja ainda não tem cardápio. */
  cardapios: CardapioParaLote[];
  abrirCardapio: (acao: AcaoLote, cardapio: CardapioParaLote) => void;
  abrirVisibilidade: (acao: AcaoVisibilidade) => void;
  /** Prévia em voo: os gatilhos viram `Loader2` e param de responder. */
  prevendo: boolean;
  onLimpar: () => void;
  onCancelar: () => void;
};

/**
 * [260][261] A barra de ação do modo de seleção (design §10.1).
 *
 * Forma copiada da barra de carrinho da vitrine (`VitrineClient`): no mobile
 * `fixed inset-x-0 bottom-0` com ≥64px de altura; a partir de `sm` ela vira
 * `sticky top-0`, sob o cabeçalho da página, onde o olho do desktop já está
 * (design §10.3). Uma árvore só — nenhum `useMediaQuery` decide layout aqui.
 *
 * 🔴 `selecionados.length` é a contagem da INTENÇÃO, e só aparece nesta barra.
 * O número que o lojista lê antes de confirmar (e o que vai dentro do rótulo
 * do botão) vem do SERVIDOR, no diálogo — ver `useLoteDeProdutos`.
 */
export function BarraSelecaoLote({
  selecionados,
  cardapios,
  abrirCardapio,
  abrirVisibilidade,
  prevendo,
  onLimpar,
  onCancelar,
}: BarraSelecaoLoteProps): ReactElement {
  const vazia = selecionados.length === 0;
  const inerte = vazia || prevendo;

  function menuDeCardapios(acao: AcaoLote, rotulo: string): ReactElement {
    return (
      <Menu>
        <MenuTrigger
          render={
            <Button
              type="button"
              variant={acao === "adicionar" ? "default" : "outline"}
              className={ALVO}
              disabled={inerte || cardapios.length === 0}
            />
          }
        >
          {prevendo ? <Loader2 aria-hidden className="animate-spin" /> : null}
          {rotulo}
        </MenuTrigger>
        <MenuPortal>
          <MenuPositioner align="end">
            <MenuPopup>
              {cardapios.map((cardapio) => (
                <MenuItem
                  key={cardapio.id}
                  className="min-h-[44px]"
                  onClick={() => abrirCardapio(acao, cardapio)}
                >
                  {cardapio.nome}
                </MenuItem>
              ))}
            </MenuPopup>
          </MenuPositioner>
        </MenuPortal>
      </Menu>
    );
  }

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 min-h-[64px] border-t bg-background p-3 shadow-lg sm:sticky sm:top-0 sm:bottom-auto sm:z-30 sm:rounded-xl sm:border sm:shadow-sm">
      <div className="mx-auto flex w-full max-w-3xl flex-wrap items-center justify-between gap-2">
        {/* `aria-live="polite"`: a contagem é anunciada a cada mudança, para
            quem não enxerga os checkboxes marcando. */}
        <p aria-live="polite" className="text-sm font-medium">
          {vazia
            ? "Nenhum produto selecionado"
            : `${selecionados.length} ${selecionados.length === 1 ? "produto selecionado" : "produtos selecionados"}`}
        </p>

        <div className="flex flex-wrap items-center gap-2">
          {menuDeCardapios("adicionar", "Adicionar ao cardápio…")}
          {menuDeCardapios("remover", "Tirar do cardápio…")}
          <Button
            type="button"
            variant="outline"
            className={ALVO}
            disabled={inerte}
            onClick={() => abrirVisibilidade("exclusivo")}
          >
            Marcar como exclusivo de cardápio
          </Button>
          {/* Sempre disponível com seleção: é a saída de qualquer estado preso
              (RN-14). Nunca fica `disabled` por causa do estado do produto. */}
          <Button
            type="button"
            variant="outline"
            className={ALVO}
            disabled={inerte}
            onClick={() => abrirVisibilidade("menu")}
          >
            Devolver ao menu
          </Button>
          <Button
            type="button"
            variant="ghost"
            className={ALVO}
            disabled={vazia}
            onClick={onLimpar}
          >
            Limpar
          </Button>
          <Button
            type="button"
            variant="ghost"
            className={ALVO}
            onClick={onCancelar}
          >
            Cancelar
          </Button>
        </div>
      </div>
    </div>
  );
}
