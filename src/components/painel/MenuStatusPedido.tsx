"use client";

import { useRef } from "react";
import { ChevronDown } from "lucide-react";

import { BadgeStatusPedido } from "@/components/painel/BadgeStatusPedido";
import {
  DialogoConfirmacaoAcao,
  useConfirmacaoAcao,
} from "@/components/painel/ConfirmacaoAcaoStatus";
import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuPortal,
  MenuPositioner,
  MenuTrigger,
} from "@/components/ui/menu";
import { useAcaoStatusOtimista } from "@/hooks/useAcaoStatusOtimista";
import { atualizarStatusPedido, type AcaoStatus } from "@/lib/actions/status";
import { cn } from "@/lib/utils";
import { acoesDisponiveis } from "@/lib/utils/acoesStatusPedido";
import { formatarNumeroPedido } from "@/lib/utils/formatarNumeroPedido";
import { rotuloStatusPedido } from "@/lib/utils/rotulosPedido";
import type { StatusPedido } from "@/lib/utils/transicaoStatus";

/**
 * Selo de status clicável nas listas do painel e do hub admin (issue 329, spec
 * páginas 1, 2, 4 e 5). O selo é o `MenuTrigger`; o menu lista só
 * `acoesDisponiveis` (RN-SC5), na ordem RN-SC13. Atalho que pula etapa e
 * "Cancelar" passam pela confirmação (RN-SC6). O selo troca na hora (otimista,
 * RN-SC7) e o refresh da lista é coalescido pelo `ProvedorRefreshCoalescido` de
 * `TabelaPedidos`.
 *
 * A lista de ações é UX: a autoridade é a Server Action (`acao`, default a do
 * lojista; o hub admin injeta `atualizarStatusPedidoAdmin.bind(null, lojaId)`).
 *
 * Posicionamento: o gatilho é `relative z-10` para ficar ACIMA do link da linha
 * (overlay `after:absolute after:inset-0`), então o toque no selo abre o menu e
 * não navega. A área de toque vai a 44 px de altura por um `::after` invisível,
 * sem aumentar o selo visível.
 */
export function MenuStatusPedido({
  pedidoId,
  status: statusDoBanco,
  tipoEntrega,
  acao = atualizarStatusPedido,
}: {
  pedidoId: string;
  status: StatusPedido;
  tipoEntrega: string | null;
  acao?: AcaoStatus;
}) {
  const gatilhoRef = useRef<HTMLButtonElement>(null);
  const confirmacao = useConfirmacaoAcao();
  const { status, emAndamento, escolher } = useAcaoStatusOtimista({
    pedidoId,
    status: statusDoBanco,
    acao,
    confirmar: confirmacao.pedir,
    contexto: "MenuStatusPedido",
  });

  const numero = formatarNumeroPedido(pedidoId);
  const acoes = acoesDisponiveis(status, tipoEntrega);

  // Otimista chegou num status terminal (ex.: cancelado): nada a oferecer.
  if (acoes.length === 0) {
    return <BadgeStatusPedido status={status} tipoEntrega={tipoEntrega} carregando={emAndamento} />;
  }

  return (
    <>
      <Menu>
        <MenuTrigger
          ref={gatilhoRef}
          disabled={emAndamento}
          aria-label={`Alterar status do pedido #${numero}, atual: ${rotuloStatusPedido(status, tipoEntrega)}`}
          className={cn(
            "relative z-10 inline-flex cursor-pointer rounded-4xl outline-none",
            "focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-default",
            // Área de toque ≥ 44 px (badge h-5 + 2×12 px), invisível.
            "after:absolute after:-inset-x-1 after:-inset-y-3",
          )}
        >
          <BadgeStatusPedido status={status} tipoEntrega={tipoEntrega} carregando={emAndamento}>
            <ChevronDown aria-hidden className="size-3.5" />
          </BadgeStatusPedido>
        </MenuTrigger>
        <MenuPortal>
          <MenuPositioner>
            <MenuPopup>
              {acoes.map((a) => (
                <MenuItem
                  key={a.status}
                  className={cn(
                    "min-h-11",
                    a.principal && "font-medium",
                    a.destrutiva && "text-destructive data-highlighted:text-destructive",
                  )}
                  onClick={() => escolher(a)}
                >
                  {a.rotulo}
                </MenuItem>
              ))}
            </MenuPopup>
          </MenuPositioner>
        </MenuPortal>
      </Menu>
      <DialogoConfirmacaoAcao
        aberto={confirmacao.aberto}
        acao={confirmacao.acao}
        responder={confirmacao.responder}
        numero={numero}
        tipoEntrega={tipoEntrega}
        focoFinal={gatilhoRef}
      />
    </>
  );
}
