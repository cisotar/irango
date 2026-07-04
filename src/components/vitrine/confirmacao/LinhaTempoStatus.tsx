import {
  Bike,
  Check,
  CircleCheck,
  Clock,
  CookingPot,
  PartyPopper,
  ShoppingBag,
  XCircle,
  type LucideIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { copyStatusConfirmacao } from "@/lib/utils/statusConfirmacaoUi";
import { STATUS_VALIDOS, type StatusPedido } from "@/lib/utils/transicaoStatus";

/**
 * Linha do tempo (stepper vertical) do status do pedido na confirmação do
 * CLIENTE. Componente APRESENTACIONAL PURO: sem estado, sem fetch, sem timers —
 * recebe o `status` (dado autoritativo que o pai já obteve do servidor, issue
 * 131) e desenha os passos, destacando o atual.
 *
 * Regras de negócio (ordem e terminalidade) NÃO são recriadas aqui: a ordem da
 * trilha é DERIVADA de `STATUS_VALIDOS` (fonte única, issue 127) e a copy vem de
 * `copyStatusConfirmacao` (fonte única, issue 129). Nada de segunda lista.
 *
 * Cores de status são de SISTEMA (fixas, design-system §8.2) — NÃO herdam
 * `lojas.tema`: um status significa o mesmo em qualquer loja. Mesmo padrão de
 * override de cor literal do `BadgeStatus.tsx`.
 *
 * Sem `"use client"`: é Server Component (nenhum hook/estado), consumível pelo
 * client `StatusPedidoLive` (131) sem custo de bundle.
 *
 * Acessibilidade: `role="list"` no container, `role="listitem"` por passo,
 * `aria-current="step"` no atual, estado (concluído/atual/a seguir) exposto por
 * texto `sr-only` + ícone (nunca só cor). O componente NÃO define `aria-live` —
 * o pai (`StatusPedidoLive`) já envolve o bloco com `role="status"
 * aria-live="polite"`, evitando região viva aninhada/anúncio duplo.
 */

interface LinhaTempoStatusProps {
  status: StatusPedido;
  tipoEntrega: string | null;
}

/**
 * Aparência fixa (de sistema) por passo da trilha. Só o que é genuinamente
 * visual (ícone, cores) — o texto do passo vem de `copyStatusConfirmacao`
 * (fonte única, issue 129), nunca duplicado aqui.
 */
interface AparenciaPasso {
  icone: LucideIcon;
  tintBg: string;
  texto: string;
  borda: string;
}

/**
 * Passos da trilha linear, DERIVADOS de `STATUS_VALIDOS` filtrando o terminal
 * `cancelado` (que não é um passo, mas um desvio — ver bloco destructive). Se o
 * grafo ganhar um status novo, a trilha acompanha sem edição de lista paralela.
 */
const PASSOS = STATUS_VALIDOS.filter(
  (s): s is Exclude<StatusPedido, "cancelado"> => s !== "cancelado",
);

/**
 * Mapa de cor/ícone FIXO (design-claude/foundations/status-badges.html §8.2).
 * Literais intencionais (não tokens de tema da loja), como `BadgeStatus.tsx`.
 */
const APARENCIA: Record<StatusPedido, AparenciaPasso> = {
  pendente: {
    icone: Clock,
    tintBg: "#fef3c7",
    texto: "#854d0e",
    borda: "#fcd34d",
  },
  confirmado: {
    icone: CircleCheck,
    tintBg: "#dbeafe",
    texto: "#1e40af",
    borda: "#93c5fd",
  },
  em_preparo: {
    icone: CookingPot,
    tintBg: "#e0e7ff",
    texto: "#3730a3",
    borda: "#a5b4fc",
  },
  saiu_entrega: {
    icone: Bike,
    tintBg: "#cffafe",
    texto: "#155e75",
    borda: "#67e8f9",
  },
  entregue: {
    icone: PartyPopper,
    tintBg: "#dcfce7",
    texto: "#166534",
    borda: "#86efac",
  },
  cancelado: {
    icone: XCircle,
    tintBg: "#fee2e2",
    texto: "#991b1b",
    borda: "#fca5a5",
  },
};

/**
 * Ícone do passo `saiu_entrega` varia por `tipoEntrega`: `retirada` →
 * `ShoppingBag` ("pronto para retirada"); qualquer outro (entrega/null/"") →
 * `Bike` ("a caminho"). Coerente com a variante de mensagem que
 * `copyStatusConfirmacao` já resolve.
 */
function iconeDoPasso(
  passo: Exclude<StatusPedido, "cancelado">,
  tipoEntrega: string | null,
): LucideIcon {
  if (passo === "saiu_entrega" && tipoEntrega === "retirada") {
    return ShoppingBag;
  }
  return APARENCIA[passo].icone;
}

export function LinhaTempoStatus({ status, tipoEntrega }: LinhaTempoStatusProps) {
  // Caso `cancelado`: NÃO é um passo da trilha. Interrompe a linha e vira um
  // bloco de alerta autônomo (tom destructive). Distinção não-cromática pelo
  // ícone X + texto "Pedido cancelado".
  if (status === "cancelado") {
    const copy = copyStatusConfirmacao(status, tipoEntrega);
    const cor = APARENCIA.cancelado;
    return (
      <div
        role="status"
        className="flex items-start gap-3 rounded-xl border p-4"
        style={{
          backgroundColor: cor.tintBg,
          borderColor: cor.borda,
          color: cor.texto,
        }}
      >
        <XCircle aria-hidden className="mt-0.5 size-6 shrink-0" />
        <div className="space-y-1">
          <p className="font-bold">{copy.titulo}</p>
          <p className="text-sm">{copy.mensagem}</p>
        </div>
      </div>
    );
  }

  // Índice do status na trilha. `-1` = status fora do enum (drift de dado/cast):
  // nenhum passo é marcado atual e toda a trilha vira "a seguir", sem lançar.
  const indiceAtual = PASSOS.indexOf(status);

  return (
    <div role="list" className="space-y-0">
      {PASSOS.map((passo, i) => {
        const concluido = indiceAtual !== -1 && i < indiceAtual;
        const atual = i === indiceAtual;
        const cor = APARENCIA[passo];
        // Fonte única de texto (129): rótulo do passo = titulo da copy. Quando
        // o passo é o atual, a mesma copy fornece a mensagem afetiva.
        const copy = copyStatusConfirmacao(passo, tipoEntrega);
        const Icone = iconeDoPasso(passo, tipoEntrega);
        const ehUltimo = i === PASSOS.length - 1;

        const estadoTexto = concluido
          ? "concluído"
          : atual
            ? "atual"
            : "a seguir";

        return (
          <div
            key={passo}
            role="listitem"
            aria-current={atual ? "step" : undefined}
            className="flex min-h-11 gap-3"
          >
            {/* Rail vertical + nó */}
            <div className="flex flex-col items-center">
              <span
                className={cn(
                  "flex size-9 shrink-0 items-center justify-center rounded-full border-2",
                  atual && "ring-2 ring-offset-2",
                )}
                style={{
                  backgroundColor: concluido || atual ? cor.tintBg : "transparent",
                  borderColor: concluido || atual ? cor.borda : "#d4cfc4",
                  color: concluido || atual ? cor.texto : "#a89f8d",
                  // ring usa a borda do status quando atual
                  ...(atual ? { ["--tw-ring-color" as string]: cor.borda } : {}),
                }}
              >
                {concluido ? (
                  <Check aria-hidden className="size-4" />
                ) : (
                  <Icone aria-hidden className="size-4" />
                )}
              </span>
              {!ehUltimo ? (
                <span
                  aria-hidden
                  className="w-0.5 flex-1"
                  style={{
                    minHeight: "1.25rem",
                    backgroundColor: concluido ? cor.borda : "#e5e0d5",
                  }}
                />
              ) : null}
            </div>

            {/* Rótulo + (só no atual) pílula e mensagem afetiva */}
            <div className="flex-1 pb-4">
              <p
                className={cn(
                  "text-sm",
                  atual ? "font-bold" : "font-medium text-muted-foreground",
                )}
                style={atual ? { color: cor.texto } : undefined}
              >
                {copy.titulo}
                <span className="sr-only"> — {estadoTexto}</span>
              </p>
              {atual ? (
                <div className="mt-1.5 space-y-1.5">
                  <Badge
                    className="font-bold"
                    style={{
                      backgroundColor: cor.tintBg,
                      borderColor: cor.borda,
                      color: cor.texto,
                    }}
                  >
                    {copy.titulo}
                  </Badge>
                  <p className="text-sm text-muted-foreground">
                    {copy.mensagem}
                  </p>
                </div>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}
