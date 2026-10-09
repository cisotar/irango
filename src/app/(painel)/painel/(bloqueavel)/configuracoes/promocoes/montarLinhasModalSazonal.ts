// Montagem das LINHAS de modal sazonal que o `PromocoesClient` consome, a
// partir das linhas cruas de `listarModaisSazonaisDoDono`. Módulo NEUTRO (sem
// 'use server', função pura síncrona): é chamado pela page do LOJISTA e pela
// page ADMIN da loja-alvo (issue 362) — molde de `montarPayloadModalSazonal`.
//
// Existe para que as duas vias tenham UMA forma de linha só. Duplicada, um
// campo novo em `ModalSazonalLinha` deixaria de aparecer numa das telas sem
// quebrar compilação — o dado some calado, que é o defeito mais caro aqui.
//
// Duas invariantes moram nesta função:
//  - `agora` é RECEBIDO, um só para a página inteira: duas linhas nunca
//    discordam sobre que instante é este, e o relógio é o do SERVIDOR (o
//    `estado` é preview de UX recalculado a cada request, nenhuma decisão
//    depende dele e o cliente nunca o envia de volta);
//  - `mensagem` passa por `lerMensagemModal` (parse fail-closed, RN-M04): a RLS
//    deixa o dono gravar direto no PostgREST, então o que vem do banco é tão
//    hostil quanto um payload. Inválida vira `null` (editor vazio) com log só
//    dos ids.

import type { ModalSazonalComSelecao } from "@/lib/supabase/queries/modaisSazonais";
import { estadoDoModalSazonal } from "@/lib/utils/estadoModalSazonal";
import { lerMensagemModal } from "@/lib/validacoes/mensagemModal";

import type { ModalSazonalLinha } from "./PromocoesClient";

export function montarLinhasModalSazonal(
  modais: ModalSazonalComSelecao[],
  lojaId: string,
  agora: Date,
): ModalSazonalLinha[] {
  return modais.map((modal) => ({
    id: modal.id,
    titulo: modal.titulo,
    ativo: modal.ativo,
    exibicao_inicio: modal.exibicao_inicio,
    exibicao_fim: modal.exibicao_fim,
    mostrar_promocoes_junto: modal.mostrar_promocoes_junto,
    mensagem: lerMensagemModal(modal.mensagem, { lojaId, modalId: modal.id }),
    categorias: modal.categorias,
    cardapios: modal.cardapios,
    estado: estadoDoModalSazonal(modal, agora),
  }));
}
