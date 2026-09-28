"use client";

import { useOptimistic, useState, useTransition } from "react";
import { toast } from "sonner";

import { useRefreshCoalescido } from "@/components/painel/ProvedorRefreshCoalescido";
import type { AcaoStatus } from "@/lib/actions/status";
import {
  executarAcaoStatus,
  type AcaoDisponivel,
} from "@/lib/utils/acoesStatusPedido";
import type { StatusPedido } from "@/lib/utils/transicaoStatus";

/**
 * Estado otimista do status de UM pedido + disparo de uma ação (issue 329,
 * RN-SC7). Usado pelo selo clicável (`MenuStatusPedido`) e pelos botões do
 * detalhe (`AcoesStatus`). A ordem "confirmar → otimista → action → aviso →
 * refresh" é de `executarAcaoStatus` (puro, testado); aqui só a fiação React.
 *
 * - O selo troca na hora (`useOptimistic`) e volta sozinho se o servidor recusar
 *   (fim da transição sem confirmação).
 * - No sucesso, o destino vira o status CONFIRMADO local até o refresh
 *   coalescido trazer o valor do banco — sem piscar o status antigo na janela
 *   de ~600 ms. Quando a prop muda (refresh), ela volta a mandar.
 * - O valor autoritativo é sempre o que o refresh traz do banco.
 */
export function useAcaoStatusOtimista({
  pedidoId,
  status,
  acao,
  confirmar,
  contexto,
}: {
  pedidoId: string;
  /** Status lido do banco (prop do Server Component). */
  status: StatusPedido;
  acao: AcaoStatus;
  confirmar: (acao: AcaoDisponivel) => Promise<boolean>;
  /** Prefixo do log de erro no console. */
  contexto: string;
}) {
  const refresh = useRefreshCoalescido();
  const [statusDoBanco, setStatusDoBanco] = useState(status);
  const [confirmado, setConfirmado] = useState(status);
  // Prop nova (refresh) manda: ajuste de estado durante o render, sem efeito.
  if (status !== statusDoBanco) {
    setStatusDoBanco(status);
    setConfirmado(status);
  }
  const [exibido, aplicarOtimista] = useOptimistic(confirmado);
  const [emAndamento, iniciarTransicao] = useTransition();

  function escolher(escolhida: AcaoDisponivel): void {
    // A transição do otimista dura até a action terminar (sucesso ou falha).
    let liberar: () => void = () => {};

    void executarAcaoStatus(escolhida, {
      confirmar,
      aplicarOtimista: (destino) => {
        const fim = new Promise<void>((resolver) => {
          liberar = resolver;
        });
        iniciarTransicao(async () => {
          aplicarOtimista(destino);
          await fim;
        });
      },
      executar: async (destino) => {
        refresh?.iniciar();
        try {
          const resultado = await acao(pedidoId, destino);
          if (resultado.ok) setConfirmado(destino);
          return resultado;
        } finally {
          liberar();
        }
      },
      avisarSucesso: () => toast.success("Status atualizado."),
      avisarErro: (mensagem) => toast.error(mensagem),
      refresh: () => refresh?.concluir(),
      registrarErro: (erro) => console.error(`[${contexto}]`, erro),
    });
  }

  return { status: exibido, emAndamento, escolher };
}
