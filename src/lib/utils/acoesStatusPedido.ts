/**
 * Ações de status do pedido no painel e no hub admin (issue 329, spec
 * `specs/status-pedido-clicavel-e-latencia.md`: RN-SC2, RN-SC5, RN-SC6,
 * RN-SC11, RN-SC13).
 *
 * Módulo PURO (sem React, sem I/O). Tudo aqui DERIVA de `transicaoPermitida`,
 * a fonte única do grafo (`TRANSICOES` em `transicaoStatus.ts`): nenhuma aresta
 * é listada de novo. Se o grafo ganhar ou perder uma aresta, o menu do selo, os
 * botões do detalhe e o predicado do UPDATE condicional acompanham sem edição.
 *
 * A lista de ações é UX (RN-SC5): esconder um item nunca é controle de acesso.
 * A autoridade é a Server Action, que usa `origensPermitidas` no próprio UPDATE.
 */

import {
  STATUS_VALIDOS,
  transicaoPermitida,
  type StatusPedido,
} from "@/lib/utils/transicaoStatus";
import { rotuloStatusPedido } from "@/lib/utils/rotulosPedido";
import type { ResultadoAtualizarStatus } from "@/lib/actions/status";

/** Uma ação oferecida ao lojista para um pedido, já com a apresentação decidida. */
export type AcaoDisponivel = {
  /** Status de DESTINO — o único dado que a Server Action recebe. */
  status: StatusPedido;
  rotulo: string;
  /** Só "Cancelar": botão/item em variante destrutiva. */
  destrutiva: boolean;
  /** Atalho que pula etapa e "Cancelar" pedem confirmação (RN-SC6). */
  exigeConfirmacao: boolean;
  /** A próxima etapa: botão primário no detalhe, 1º item do menu (RN-SC13). */
  principal: boolean;
};

const CANCELADO: StatusPedido = "cancelado";

/**
 * Status de onde `para` é alcançável. Alimenta o UPDATE condicional
 * `.in("status", origensPermitidas(novo))` da action do lojista (RN-SC4):
 * a transição é imposta pelo PREDICADO da escrita, numa ida só ao banco.
 * Lista vazia (ex.: `"pendente"`) = destino inalcançável.
 */
export function origensPermitidas(para: StatusPedido): StatusPedido[] {
  return STATUS_VALIDOS.filter((de) => transicaoPermitida(de, para));
}

/**
 * Próxima etapa do fluxo linear a partir de `de`: o primeiro destino permitido,
 * fora "cancelado", na ordem do enum (`STATUS_VALIDOS` está na ordem do fluxo:
 * pendente → confirmado → em_preparo → saiu_entrega → entregue).
 */
function proximaEtapa(de: StatusPedido): StatusPedido | undefined {
  return STATUS_VALIDOS.find((para) => para !== CANCELADO && transicaoPermitida(de, para));
}

/**
 * A ação pula etapa (RN-SC6)? Verdadeiro para um avanço permitido que não é a
 * próxima etapa — hoje, só `pendente|confirmado → saiu_entrega` (RN-SC2).
 * Cancelar nunca é atalho (tem confirmação por outro motivo).
 */
export function ehAtalho(de: StatusPedido, para: StatusPedido): boolean {
  return para !== CANCELADO && transicaoPermitida(de, para) && para !== proximaEtapa(de);
}

/** Texto do botão/item. `saiu_entrega` usa o rótulo por modalidade (RN-SC11). */
function rotuloDaAcao(destino: StatusPedido, tipoEntrega: string | null): string {
  switch (destino) {
    case "confirmado":
      return "Confirmar";
    case "em_preparo":
      return "Iniciar preparo";
    case "entregue":
      return "Marcar entregue";
    case "cancelado":
      return "Cancelar";
    default:
      // saiu_entrega ("Saiu pra entrega" / "Pronto para retirada"). `pendente`
      // nunca é destino (sem origem no grafo).
      return rotuloStatusPedido(destino, tipoEntrega);
  }
}

/**
 * Ações válidas para o status atual, JÁ na ordem de exibição (RN-SC13):
 * 1º a próxima etapa (`principal`), 2º o atalho para `saiu_entrega` (só quando
 * difere da próxima etapa), por último "Cancelar". Status terminal → `[]`.
 * Fonte única da lista para o menu do selo e para `AcoesStatus`.
 */
export function acoesDisponiveis(
  status: StatusPedido,
  tipoEntrega: string | null,
): AcaoDisponivel[] {
  const destinos = STATUS_VALIDOS.filter((para) => transicaoPermitida(status, para));
  const proxima = proximaEtapa(status);
  const peso = (destino: StatusPedido) =>
    destino === proxima ? 0 : destino === CANCELADO ? 2 : 1;

  return [...destinos]
    .sort((a, b) => peso(a) - peso(b))
    .map((destino) => ({
      status: destino,
      rotulo: rotuloDaAcao(destino, tipoEntrega),
      destrutiva: destino === CANCELADO,
      exigeConfirmacao: destino === CANCELADO || ehAtalho(status, destino),
      principal: destino === proxima,
    }));
}

/** Textos do `AlertDialog` de confirmação (copy literal da issue 329 / spec:414-416). */
export type CopyConfirmacaoAcao = {
  titulo: string;
  corpo: string;
  confirmar: string;
  voltar: string;
};

/**
 * Copy da confirmação de uma ação que `exigeConfirmacao`. `numero` é o número
 * curto já formatado (sem `#`). O rótulo do botão de confirmar do atalho é o
 * próprio `acao.rotulo` (fonte `rotuloStatusPedido`), para não duplicar rótulo
 * de status aqui.
 */
export function copyConfirmacaoAcao(
  acao: AcaoDisponivel,
  numero: string,
  tipoEntrega: string | null,
): CopyConfirmacaoAcao {
  if (acao.status === CANCELADO) {
    return {
      titulo: `Cancelar o pedido #${numero}?`,
      corpo:
        "Confirme só se o pedido não vai ser preparado. O cliente vê o pedido como cancelado. Não dá para desfazer.",
      confirmar: "Cancelar pedido",
      voltar: "Voltar",
    };
  }
  if (tipoEntrega === "retirada") {
    return {
      titulo: `Marcar o pedido #${numero} como pronto para retirada?`,
      corpo:
        "Confirme só se o pedido já está pronto no balcão. O cliente é avisado na hora, e o pedido não pode mais ser cancelado.",
      confirmar: acao.rotulo,
      voltar: "Voltar",
    };
  }
  return {
    titulo: `Marcar o pedido #${numero} como saiu para entrega?`,
    corpo:
      "Confirme só se o pedido já saiu com o entregador. O cliente é avisado na hora, e o pedido não pode mais ser cancelado.",
    confirmar: acao.rotulo,
    voltar: "Voltar",
  };
}

/** Mesma mensagem genérica das actions (`seguranca.md` §14: nada de detalhe na UI). */
const ERRO_GENERICO = "Não foi possível atualizar o status do pedido.";

export type DepsExecutarAcaoStatus = {
  /** Abre a confirmação e resolve com a escolha. Só chamada se `exigeConfirmacao`. */
  confirmar: (acao: AcaoDisponivel) => Promise<boolean>;
  /** Preview otimista do destino (RN-SC7). O revert é do React ao fim da transição. */
  aplicarOtimista: (status: StatusPedido) => void;
  /** A Server Action injetada (lojista ou admin), já ligada ao pedido. */
  executar: (status: StatusPedido) => Promise<ResultadoAtualizarStatus>;
  avisarSucesso: () => void;
  /** Mensagem genérica na UI — nunca o `error.message` da exceção. */
  avisarErro: (mensagem: string) => void;
  /** Pede o refresh do painel (coalescido por quem injeta). */
  refresh: () => void;
  /** Registra a exceção real (não vai para a UI). */
  registrarErro?: (erro: unknown) => void;
};

/**
 * Orquestração "confirmar → otimista → action → aviso → refresh" (S2 da issue
 * 329). Fora do componente porque a ORDEM é a regra (confirmação pendente não
 * chama a action) e `renderToStaticMarkup` não dispara handler — padrão de
 * `alternarAssociacaoOpcional` (architecture §8).
 *
 * O refresh roda sempre que a action rodou, com sucesso ou falha: no sucesso
 * traz o valor autoritativo; na recusa (ex.: outro aparelho já mudou o status e
 * o UPDATE condicional casou 0 linhas), traz o status real do banco.
 *
 * Devolve `true` só quando o servidor confirmou a mudança.
 */
export async function executarAcaoStatus(
  acao: AcaoDisponivel,
  deps: DepsExecutarAcaoStatus,
): Promise<boolean> {
  if (acao.exigeConfirmacao && !(await deps.confirmar(acao))) {
    return false;
  }

  deps.aplicarOtimista(acao.status);

  let resultado: ResultadoAtualizarStatus;
  try {
    resultado = await deps.executar(acao.status);
  } catch (erro) {
    // Rede/transporte: mesmo tratamento de `{ ok: false }`, detalhe só no log.
    deps.registrarErro?.(erro);
    resultado = { ok: false, erro: ERRO_GENERICO };
  }

  if (resultado.ok) {
    deps.avisarSucesso();
  } else {
    deps.avisarErro(resultado.erro);
  }
  deps.refresh();
  return resultado.ok;
}
