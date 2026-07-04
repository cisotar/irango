/**
 * Fonte única do enum de status — reusada por `status.ts` (lojista) e
 * `admin-status.ts` (admin) no `z.enum(STATUS_VALIDOS)`. Evita duas cópias
 * divergindo silenciosamente se o grafo de `TRANSICOES` ganhar um status novo.
 */
export const STATUS_VALIDOS = [
  "pendente",
  "confirmado",
  "em_preparo",
  "saiu_entrega",
  "entregue",
  "cancelado",
] as const;

export type StatusPedido = (typeof STATUS_VALIDOS)[number];

/**
 * Máquina de estados do status do pedido (RN-08). Retorna `true` apenas se a
 * transição `de → para` é permitida pelo grafo. Função PURA — reusada na action
 * (033) e na UI (049) para exibir só os botões de ação válidos.
 *
 * Grafo (issue 033):
 *   pendente → confirmado → em_preparo → saiu_entrega → entregue
 *   cancelar permitido de: pendente | confirmado | em_preparo
 *   entregue e cancelado são TERMINAIS (sem saída)
 *   sem reversão / sem salto
 */
const TRANSICOES: Record<StatusPedido, readonly StatusPedido[]> = {
  pendente: ["confirmado", "cancelado"],
  confirmado: ["em_preparo", "cancelado"],
  em_preparo: ["saiu_entrega", "cancelado"],
  saiu_entrega: ["entregue"],
  entregue: [],
  cancelado: [],
};

export function transicaoPermitida(de: StatusPedido, para: StatusPedido): boolean {
  // `de` chega tipado StatusPedido, mas o valor real vem do banco via cast
  // (`pedido.status as StatusPedido`) — defesa em profundidade contra status
  // fora do enum (drift de schema/dado legado) em vez de lançar TypeError.
  return (TRANSICOES[de] ?? []).includes(para);
}

/**
 * Predicado puro de terminalidade (issue 127). Terminal ⇔ nó RECONHECIDO no
 * grafo e sem saída (`entregue`/`cancelado`). Derivado de `TRANSICOES`, não de
 * uma segunda lista de terminais — se o grafo ganhar um status terminal novo,
 * este predicado acompanha sem edição.
 *
 * Fonte única da regra "terminalidade encerra o polling" — reusada pela action
 * (status autoritativo do servidor) e pela UI (`StatusPedidoLive`, issue 131).
 *
 * Guarda: um `status` fora do enum (drift de schema/dado legado via cast) NÃO é
 * terminal. Usar `?? []` classificaria desconhecido como terminal (length 0) e
 * encerraria o polling cedo, escondendo atualizações reais — por isso exigimos
 * que a lista de saídas EXISTA no grafo antes de checar o tamanho.
 */
export function ehStatusTerminal(status: StatusPedido): boolean {
  const saidas = TRANSICOES[status] as readonly StatusPedido[] | undefined;
  return saidas !== undefined && saidas.length === 0;
}
