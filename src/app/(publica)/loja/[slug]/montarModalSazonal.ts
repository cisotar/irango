import type { ModalSazonalDados } from "@/components/vitrine/VitrineClient";
import type { ProdutoModalDados } from "@/components/vitrine/ProdutoModal";
import { dentroDaJanelaExibicao } from "@/lib/utils/janelaModalSazonal";
import type { MensagemModalValidada } from "@/lib/validacoes/mensagemModal";

/** O mínimo do modal ativo que a decisão de abertura precisa. */
export type ModalAtivoParaVitrine = {
  titulo: string;
  exibicao_inicio: string;
  exibicao_fim: string;
  mostrar_promocoes_junto: boolean;
};

export type ModalSazonalMontado = {
  /** O que desce ao cliente; `null` = nenhum modal sazonal abre. */
  modalSazonal: ModalSazonalDados | null;
  /** [RN-M07] Suprime o `ModalPromocoes`. Só `true` com `modalSazonal !== null`. */
  suprimirPromocoes: boolean;
};

/**
 * [314] Decisão SSR do modal sazonal na vitrine. Função pura: `agora` entra por
 * parâmetro, nenhum `new Date()` aqui.
 *
 * - RN-M01: abre com modal ATIVO (a query já filtrou) + DENTRO DA JANELA, e só
 *   isso. `mensagem` e `produtos` decidem o que aparece dentro, nunca SE abre.
 * - RN-M07: a supressão deriva do objeto que DE FATO desce ao cliente —
 *   `suprimirPromocoes` implica `modalSazonal !== null`, por construção.
 *
 * `produtos` chega já derivado (`derivarProdutosDoModalSazonal`) e `mensagem`
 * já lida (`lerMensagemModal`, fail-closed): esta função não parseia nada.
 */
export function montarModalSazonal(entrada: {
  modalAtivo: ModalAtivoParaVitrine | null;
  agora: Date;
  produtos: ProdutoModalDados[];
  mensagem: MensagemModalValidada | null;
}): ModalSazonalMontado {
  const { modalAtivo, agora, produtos, mensagem } = entrada;

  if (modalAtivo === null || !dentroDaJanelaExibicao(modalAtivo, agora)) {
    return { modalSazonal: null, suprimirPromocoes: false };
  }

  const modalSazonal: ModalSazonalDados = {
    titulo: modalAtivo.titulo,
    mensagem,
    produtos,
  };
  return {
    modalSazonal,
    suprimirPromocoes: modalSazonal !== null && !modalAtivo.mostrar_promocoes_junto,
  };
}
