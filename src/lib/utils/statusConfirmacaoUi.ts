import type { StatusPedido } from "@/lib/utils/transicaoStatus";

/**
 * Fonte ÚNICA da copy do CLIENTE na página de confirmação (título + mensagem
 * afetiva por `status`). Consumida por `StatusPedidoLive` (131) e
 * `LinhaTempoStatus` (130) — para que o texto não divirja entre a badge e a
 * linha do tempo.
 *
 * NÃO confundir com a copy do LOJISTA (`APARENCIA_STATUS` em `DetalhePedido.tsx`
 * / `TabelaPedidos.tsx`): audiências diferentes, copy diferente. Duplicação
 * intencional — não acoplar as duas telas.
 *
 * Só APRESENTAÇÃO: função pura, sem I/O, sem valor monetário, sem PII. A ordem
 * e a terminalidade da máquina de estados vivem em `transicaoStatus.ts`.
 */
export interface CopyStatus {
  titulo: string;
  mensagem: string;
}

/**
 * Textos exatos da tabela "UI por estado" do spec
 * (`specs/1-status-automatico-confirmacao.md`). A mensagem de `saiu_entrega`
 * usa a variante `entrega` ("a caminho") como base; `retirada` é aplicada em
 * `copyStatusConfirmacao`. O `Record<StatusPedido, ...>` força cobertura
 * exaustiva no compilador: um status novo no grafo quebra o build até ser
 * preenchido aqui.
 */
const COPY_STATUS: Record<StatusPedido, CopyStatus> = {
  pendente: {
    titulo: "Pedido recebido",
    mensagem: "Aguardando a loja confirmar seu pedido.",
  },
  confirmado: {
    titulo: "Pedido confirmado",
    mensagem: "A loja confirmou! Logo começa o preparo.",
  },
  em_preparo: {
    titulo: "Em preparo",
    mensagem: "Seu pedido está sendo preparado.",
  },
  saiu_entrega: {
    titulo: "Saiu para entrega",
    mensagem: "Seu pedido está a caminho.",
  },
  entregue: {
    titulo: "Pedido entregue",
    mensagem: "Pedido entregue. Bom apetite!",
  },
  cancelado: {
    titulo: "Pedido cancelado",
    mensagem: "Este pedido foi cancelado pela loja.",
  },
};

/** Mensagem de `saiu_entrega` quando o pedido é para retirada no balcão. */
const MENSAGEM_SAIU_RETIRADA = "Seu pedido está pronto para retirada.";

/** Fallback seguro para `status` fora do enum (drift de dado/schema legado). */
const COPY_FALLBACK: CopyStatus = {
  titulo: "Pedido em andamento",
  mensagem: "Acompanhe o status do seu pedido.",
};

function ehStatusPedido(s: string): s is StatusPedido {
  // `in` percorreria a cadeia de protótipo ("toString" etc. passariam).
  return Object.prototype.hasOwnProperty.call(COPY_STATUS, s);
}

/**
 * Copy do cliente para um `status`. `tipoEntrega` só é consultado em
 * `saiu_entrega`: `"retirada"` → "pronto para retirada"; qualquer outro valor
 * (incluindo `"entrega"`, `null`, `""` ou desconhecido) usa o texto de
 * `entrega` ("a caminho") como default seguro. Nunca lança — status fora do
 * enum cai no fallback genérico.
 */
export function copyStatusConfirmacao(
  status: StatusPedido | string,
  tipoEntrega: string | null,
): CopyStatus {
  if (!ehStatusPedido(status)) {
    return COPY_FALLBACK;
  }

  if (status === "saiu_entrega" && tipoEntrega === "retirada") {
    return { ...COPY_STATUS.saiu_entrega, mensagem: MENSAGEM_SAIU_RETIRADA };
  }

  return COPY_STATUS[status];
}
