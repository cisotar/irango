"use client";

// [238/D11 §7.1] Reconfirmação quando o preço SUBIU entre o carrinho e o envio.
//
// O que ele NUNCA faz: tratar o cliente como culpado ou o sistema como
// quebrado. A promoção acabou porque o lojista marcou uma data — não é erro, e
// por isso não há "erro", "falha", "desculpe" nem "não foi possível", nem ícone
// de alerta, nem vermelho, nem role="alert". O precedente é
// `ModalFreteIndisponivel`, e a copy mora em módulo puro (`copiaRevisaoPreco`)
// porque sem jsdom é a única forma de travar texto por teste.
//
// O modal NÃO decide valor: os preços de/para vêm de `revisarCarrinhoAction`
// (banco) e o pedido continua sendo recalculado do zero por `criarPedido`.
//
// M9 — as travas: o CTA do wizard sai do DOM enquanto isto está aberto (não
// fica `disabled`), o gate mora em `podeConfirmar` (`estado.ts`), e o segundo
// clique envia `promocaoExibida: false`, que é o que a trava do servidor
// (RN-12-a) exige para deixar o pedido passar. ESC e ✕ não enviam nada.

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatarMoeda } from "@/lib/utils/formatarMoeda";
import {
  descricaoMudanca,
  textosRevisao,
  ROTULO_NOVO_TOTAL,
  ROTULO_VOLTAR,
  type MudancaItem,
} from "@/lib/utils/copiaRevisaoPreco";

export type ModalRevisaoPrecoProps = {
  aberto: boolean;
  /** Linhas cujo preço SUBIU — as únicas que exigem segundo clique. */
  itens: MudancaItem[];
  /** Total estimado com os preços novos (mesmo preview do resumo). */
  novoTotal: number;
  /** Segundo clique EXPLÍCITO, sobre o número novo. */
  onConfirmar: () => void;
  /** ESC, ✕ e "Voltar ao carrinho": fechar nunca é sinônimo de confirmar. */
  onVoltar: () => void;
  enviando?: boolean;
};

export function ModalRevisaoPreco({
  aberto,
  itens,
  novoTotal,
  onConfirmar,
  onVoltar,
  enviando = false,
}: ModalRevisaoPrecoProps) {
  const { titulo, corpo, rotuloCta } = textosRevisao({
    direcao: "subiu",
    itens,
    novoTotal,
  });

  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && onVoltar()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{titulo}</DialogTitle>
          <DialogDescription>{corpo}</DialogDescription>
        </DialogHeader>

        <ul className="space-y-2">
          {itens.map((item) => (
            <li
              key={`${item.nome}-${item.de}-${item.para}`}
              className="rounded-lg border border-borda-nav bg-cinza-claro px-3 py-2 text-sm"
            >
              <span className="block font-bold text-texto">{item.nome}</span>
              {/* `<s>` sozinho não comunica: o par vai por extenso no sr-only. */}
              <span className="sr-only">{descricaoMudanca(item)}</span>
              <span aria-hidden className="text-texto-muted">
                de <s>{formatarMoeda(item.de)}</s>{" "}
                <span className="font-bold text-texto">
                  → {formatarMoeda(item.para)}
                </span>
              </span>
            </li>
          ))}
        </ul>

        <div className="flex items-baseline justify-between">
          <span className="text-sm font-extrabold text-texto">
            {ROTULO_NOVO_TOTAL}
          </span>
          <span className="text-base font-black text-[var(--cor-destaque)]">
            {formatarMoeda(novoTotal)}
          </span>
        </div>

        <DialogFooter className="flex-col gap-2 sm:flex-col">
          <Button
            type="button"
            className="h-13 min-h-13 w-full rounded-xl bg-[var(--cor-destaque)] text-base font-bold text-white hover:bg-[var(--cor-destaque)]/90"
            disabled={enviando}
            onClick={onConfirmar}
          >
            {rotuloCta}
          </Button>
          <Button
            type="button"
            variant="outline"
            className="min-h-11 w-full"
            onClick={onVoltar}
          >
            {ROTULO_VOLTAR}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
