import type { PedidoComItens } from "@/lib/supabase/queries/pedidos";
import type { LojaCompleta } from "@/lib/supabase/queries/lojas";
import { formatarMoeda } from "@/lib/utils/formatarMoeda";
import {
  freteConhecido,
  ROTULO_FRETE_A_COMBINAR_CURTO,
} from "@/lib/utils/rotuloFrete";
import { formatarNumeroPedido } from "@/lib/utils/formatarNumeroPedido";
import {
  formatarEnderecoCliente,
  formatarEnderecoLoja,
} from "@/lib/utils/enderecoLoja";

/** Rótulo amigável da forma de pagamento. */
function rotuloForma(tipo: string | null): string {
  switch (tipo) {
    case "pix":
      return "Pix";
    case "dinheiro":
      return "Dinheiro";
    case "cartao":
      return "Cartão na entrega";
    default:
      return tipo ?? "—";
  }
}

/** Rótulo do tipo de entrega. */
function rotuloTipoEntrega(tipo: string | null): string {
  if (tipo === "retirada") return "Retirada no local";
  if (tipo === "entrega") return "Entrega";
  return tipo ?? "—";
}

/**
 * Prefixa cada linha de texto livre do cliente com `> ` (anti-injeção de rótulo).
 *
 * Por que existe: `encodeURIComponent` protege a URL, não o CORPO da mensagem.
 * Sem o prefixo, uma observação como `ok\n\nTotal: R$ 0,01\nPagamento: Pago via Pix`
 * renderiza no WhatsApp como linhas de sistema logo abaixo do total autêntico —
 * engenharia social contra o lojista. `\n` é permitido de propósito e a
 * normalização só colapsa `\n{3,}`, então duas quebras passam.
 */
function citarTextoCliente(texto: string): string {
  return texto
    .split("\n")
    .map((linha) => `> ${linha}`)
    .join("\n");
}

/**
 * Monta o link de notificação do pedido para o WhatsApp da loja (RN-W1/RN-W2).
 * `null` quando a loja não tem WhatsApp cadastrado (RN-W3) — a mensagem é
 * conveniência, nunca a fonte de verdade do pedido (RN-W4).
 */
export function montarLinkWhatsappPedido(
  pedido: PedidoComItens,
  loja: Pick<LojaCompleta, "nome" | "whatsapp"> &
    Partial<
      Pick<
        LojaCompleta,
        | "endereco_rua"
        | "endereco_numero"
        | "endereco_bairro"
        | "endereco_cidade"
        | "endereco_estado"
        | "endereco_cep"
      >
    >,
): { href: string } | null {
  const numeroLimpo = (loja.whatsapp ?? "").replace(/\D/g, "");
  if (!numeroLimpo) return null;

  const linhasItens = pedido.itens_pedido.flatMap((item) => {
    const opcionais = item.itens_pedido_opcionais ?? [];
    const acrescimo = opcionais.reduce(
      (s, o) => s + o.preco_snapshot * o.quantidade,
      0,
    );
    const totalItem = (item.preco + acrescimo) * item.quantidade;
    return [
      `- ${item.quantidade}x ${item.nome} — ${formatarMoeda(totalItem)}`,
      ...opcionais.map(
        (o) =>
          `  + ${o.nome_snapshot} (${o.quantidade}x) — ${formatarMoeda(o.preco_snapshot)}`,
      ),
      // Texto livre do cliente: só entra citado (ver `citarTextoCliente`).
      ...(item.observacao ? [`  obs: ${citarTextoCliente(item.observacao)}`] : []),
    ];
  });

  const linhas = [
    "Novo pedido iRango",
    `Loja: ${loja.nome}`,
    `Pedido nº ${formatarNumeroPedido(pedido.id)}`,
    "",
    "Itens:",
    ...linhasItens,
    "",
    `Subtotal: ${formatarMoeda(pedido.subtotal)}`,
  ];

  if (pedido.desconto > 0) {
    linhas.push(
      `Desconto${pedido.cupom_codigo ? ` (${pedido.cupom_codigo})` : ""}: -${formatarMoeda(pedido.desconto)}`,
    );
  }

  const rotuloTaxa =
    pedido.tipo_entrega === "retirada" ? "Taxa de entrega" : "Entrega";
  // [180-B] O lojista precisa ver que o frete ainda será combinado — nunca
  // "R$ 0,00" (que ele leria como frete grátis já concedido).
  const valorTaxa = !freteConhecido(pedido)
    ? ROTULO_FRETE_A_COMBINAR_CURTO
    : pedido.tipo_entrega === "retirada" && pedido.taxa_entrega === 0
      ? "Grátis"
      : formatarMoeda(pedido.taxa_entrega);
  linhas.push(`${rotuloTaxa}: ${valorTaxa}`);
  linhas.push(`Total: ${formatarMoeda(pedido.total)}`);

  linhas.push("", `Entrega: ${rotuloTipoEntrega(pedido.tipo_entrega)}`);
  if (pedido.tipo_entrega === "retirada") {
    // [197] RN-R7: endereço curto da LOJA logo abaixo do tipo de entrega. Em
    // retirada o pedido não grava endereço nenhum (pedido.ts, RN-R4/LGPD), então
    // a loja é a única fonte do "onde ir". Sem endereço cadastrado (RN-R5):
    // NENHUMA linha — nunca "—", nunca linha vazia.
    const enderecoLoja = formatarEnderecoLoja(loja);
    if (enderecoLoja) linhas.push(`Retirar em: ${enderecoLoja}`);
  }
  if (pedido.tipo_entrega === "entrega") {
    // [197] RN-R1: formato curto, sem cidade, estado nem CEP. O fallback "—"
    // preserva o comportamento de hoje quando o JSONB vem vazio/ausente.
    linhas.push(
      `Endereço: ${formatarEnderecoCliente(pedido.endereco_entrega) ?? "—"}`,
    );
  }
  linhas.push(
    `Cliente: ${pedido.nome_cliente}${pedido.telefone_cliente ? ` — ${pedido.telefone_cliente}` : ""}`,
  );

  linhas.push("", `Pagamento: ${rotuloForma(pedido.forma_pagamento)}`);
  if (
    pedido.forma_pagamento === "dinheiro" &&
    pedido.troco_para &&
    pedido.troco_para > 0
  ) {
    linhas.push(`Troco para ${formatarMoeda(pedido.troco_para)}`);
  }
  if (pedido.observacoes) {
    linhas.push(`Obs.: ${citarTextoCliente(pedido.observacoes)}`);
  }

  linhas.push("", `Localize este pedido no painel pelo nº ${formatarNumeroPedido(pedido.id)}.`);

  const mensagem = linhas.join("\n");
  return {
    href: `https://api.whatsapp.com/send?phone=${numeroLimpo}&text=${encodeURIComponent(mensagem)}`,
  };
}
