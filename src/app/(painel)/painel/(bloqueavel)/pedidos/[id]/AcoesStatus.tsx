"use client";

import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DialogoConfirmacaoAcao,
  useConfirmacaoAcao,
} from "@/components/painel/ConfirmacaoAcaoStatus";
import { ProvedorRefreshCoalescido } from "@/components/painel/ProvedorRefreshCoalescido";
import { useAcaoStatusOtimista } from "@/hooks/useAcaoStatusOtimista";
import { atualizarStatusPedido, type AcaoStatus } from "@/lib/actions/status";
import { acoesDisponiveis } from "@/lib/utils/acoesStatusPedido";
import { formatarNumeroPedido } from "@/lib/utils/formatarNumeroPedido";
import type { StatusPedido } from "@/lib/utils/transicaoStatus";

type PropsAcoesStatus = {
  pedidoId: string;
  statusAtual: StatusPedido;
  /** `tipo_entrega` do pedido: decide o rótulo de `saiu_entrega` (RN-SC11). */
  tipoEntrega?: string | null;
  acao?: AcaoStatus;
};

/**
 * Botões de transição de status no detalhe do pedido (issues 049 e 329). A
 * lista vem de `acoesDisponiveis` — a mesma derivação do grafo que o servidor
 * usa — na ordem RN-SC13: a próxima etapa como botão primário, o atalho para
 * `saiu_entrega` como secundário (`outline`) e "Cancelar". O atalho que pula
 * etapa e "Cancelar" pedem confirmação (RN-SC6). A UI é só conveniência: a
 * AUTORIDADE da máquina de estados é a Server Action, que revalida tudo.
 *
 * O prop `acao` (issue 124) injeta a Server Action — default
 * `atualizarStatusPedido` (lojista); o hub admin injeta a variante escopada por
 * loja. Não afrouxa a autoridade: é injeção de dependência de UI.
 */
export function AcoesStatus(props: PropsAcoesStatus) {
  return (
    <ProvedorRefreshCoalescido>
      <BotoesAcoesStatus {...props} />
    </ProvedorRefreshCoalescido>
  );
}

function BotoesAcoesStatus({
  pedidoId,
  statusAtual,
  tipoEntrega = null,
  acao = atualizarStatusPedido,
}: PropsAcoesStatus) {
  const confirmacao = useConfirmacaoAcao();
  const { status, emAndamento, escolher } = useAcaoStatusOtimista({
    pedidoId,
    status: statusAtual,
    acao,
    confirmar: confirmacao.pedir,
    contexto: "AcoesStatus",
  });

  const acoes = acoesDisponiveis(status, tipoEntrega);

  if (acoes.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Este pedido está finalizado — nenhuma ação disponível.
      </p>
    );
  }

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {acoes.map((a) => (
          <Button
            key={a.status}
            variant={a.destrutiva ? "destructive" : a.principal ? "default" : "outline"}
            disabled={emAndamento}
            onClick={() => escolher(a)}
          >
            {emAndamento && <Loader2 className="mr-2 size-4 animate-spin" />}
            {a.rotulo}
          </Button>
        ))}
      </div>
      <DialogoConfirmacaoAcao
        aberto={confirmacao.aberto}
        acao={confirmacao.acao}
        responder={confirmacao.responder}
        numero={formatarNumeroPedido(pedidoId)}
        tipoEntrega={tipoEntrega}
      />
    </>
  );
}
