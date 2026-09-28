import type { ReactNode } from "react";
import {
  Bike,
  Check,
  CheckCheck,
  ChefHat,
  Clock,
  Loader2,
  ShoppingBag,
  X,
  type LucideIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { rotuloStatusPedido } from "@/lib/utils/rotulosPedido";
import type { StatusPedido } from "@/lib/utils/transicaoStatus";

/**
 * Aparência de cada status no painel (RN-08). Cores são de SISTEMA — não do tema
 * da loja (design-system §8). Sempre cor + texto + ícone (nunca só cor — WCAG).
 * O TEXTO vem de `rotuloStatusPedido` (fonte única, RN-SC11).
 */
const APARENCIA_STATUS: Record<StatusPedido, { icone: LucideIcon; classes: string }> = {
  pendente: { icone: Clock, classes: "border-transparent bg-amber-100 text-amber-800" },
  confirmado: { icone: Check, classes: "border-transparent bg-blue-100 text-blue-800" },
  em_preparo: { icone: ChefHat, classes: "border-transparent bg-orange-100 text-orange-800" },
  saiu_entrega: { icone: Bike, classes: "border-transparent bg-cyan-100 text-cyan-800" },
  entregue: { icone: CheckCheck, classes: "border-transparent bg-green-100 text-green-800" },
  cancelado: { icone: X, classes: "border-transparent bg-red-100 text-red-800" },
};

/**
 * Selo de status do pedido no painel e no hub admin (tabela desktop/mobile e
 * cabeçalho do detalhe). Extraído de `TabelaPedidos`/`DetalhePedido` (issue 329)
 * para o selo estático e o gatilho do menu (`MenuStatusPedido`) compartilharem
 * cor, ícone e rótulo.
 *
 * Pedido de retirada em `saiu_entrega`: "Pronto para retirada" com `ShoppingBag`,
 * na mesma cor ciano (RN-SC11). Status fora do enum (dado legado) → sem selo.
 * `carregando` troca o ícone por spinner (preview otimista); `children` entra
 * depois do rótulo (o chevron do gatilho).
 */
export function BadgeStatusPedido({
  status,
  tipoEntrega = null,
  carregando = false,
  children,
}: {
  status: StatusPedido;
  tipoEntrega?: string | null;
  carregando?: boolean;
  children?: ReactNode;
}) {
  const aparencia = APARENCIA_STATUS[status] as (typeof APARENCIA_STATUS)[StatusPedido] | undefined;
  if (!aparencia) return null;

  const retiradaPronta = status === "saiu_entrega" && tipoEntrega === "retirada";
  const Icone = carregando ? Loader2 : retiradaPronta ? ShoppingBag : aparencia.icone;

  return (
    <Badge className={aparencia.classes}>
      <Icone aria-hidden className={cn("size-3.5", carregando && "animate-spin")} />
      {rotuloStatusPedido(status, tipoEntrega)}
      {children}
    </Badge>
  );
}
