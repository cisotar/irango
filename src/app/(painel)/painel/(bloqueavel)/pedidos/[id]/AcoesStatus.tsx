"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { atualizarStatusPedido } from "@/lib/actions/status";
import {
  transicaoPermitida,
  type StatusPedido,
} from "@/lib/utils/transicaoStatus";

/**
 * Botões de transição de status do pedido (issue 049). Exibe APENAS ações
 * permitidas a partir do status atual, usando a mesma função pura `transicaoPermitida`
 * que o servidor (033). A UI é só conveniência — a AUTORIDADE da máquina de
 * estados (RN-08) é a Server Action que executa a transição, que revalida tudo.
 *
 * O prop `acao` (issue 124) permite injetar a Server Action de transição —
 * default `atualizarStatusPedido` (lojista); o wrapper admin injeta sua variante
 * escopada por loja. O prop NÃO afrouxa a autoridade: ambas as actions revalidam
 * `transicaoPermitida` no servidor. É injeção de dependência de UI, nada mais.
 */
// Derivado da action real (não escrito à mão): se `ResultadoAtualizarStatus`
// mudar, este tipo acompanha em compile-time. Exportado para o wrapper admin
// (issues 133/140) tipar sua variante sem redigitar a assinatura.
export type AcaoStatus = typeof atualizarStatusPedido;

const ACOES: { status: StatusPedido; rotulo: string }[] = [
  { status: "confirmado", rotulo: "Confirmar" },
  { status: "em_preparo", rotulo: "Iniciar preparo" },
  { status: "saiu_entrega", rotulo: "Saiu pra entrega" },
  { status: "entregue", rotulo: "Marcar entregue" },
  { status: "cancelado", rotulo: "Cancelar" },
];

export function AcoesStatus({
  pedidoId,
  statusAtual,
  acao,
}: {
  pedidoId: string;
  statusAtual: StatusPedido;
  acao?: AcaoStatus;
}) {
  const router = useRouter();
  const [pendente, startTransition] = useTransition();
  const executar = acao ?? atualizarStatusPedido;

  const disponiveis = ACOES.filter((a) =>
    transicaoPermitida(statusAtual, a.status),
  );

  if (disponiveis.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Este pedido está finalizado — nenhuma ação disponível.
      </p>
    );
  }

  function aplicar(novoStatus: StatusPedido) {
    startTransition(async () => {
      const resultado = await executar(pedidoId, novoStatus);
      if (!resultado.ok) {
        toast.error(resultado.erro);
        return;
      }
      toast.success("Status atualizado.");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-wrap gap-2">
      {disponiveis.map((a) => (
        <Button
          key={a.status}
          variant={a.status === "cancelado" ? "destructive" : "default"}
          disabled={pendente}
          onClick={() => aplicar(a.status)}
        >
          {pendente && <Loader2 className="mr-2 size-4 animate-spin" />}
          {a.rotulo}
        </Button>
      ))}
    </div>
  );
}
