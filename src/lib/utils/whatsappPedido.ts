import type { PedidoComItens } from "@/lib/supabase/queries/pedidos";
import type { LojaCompleta } from "@/lib/supabase/queries/lojas";
import { formatarMoeda } from "@/lib/utils/formatarMoeda";
import { totalDaLinha } from "@/lib/utils/calcularTotal";
import { textoDePor } from "@/lib/utils/linhaItemPedido";
import { mapearOpcionaisExibicao } from "@/lib/utils/rotulosPedido";
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
    // [239] Opcionais pelo mapper único (`mapearOpcionaisExibicao`) — nenhum
    // campo do snapshot lido na mão — e o total da linha por `totalDaLinha`
    // (RN-20), a MESMA função que produz o subtotal cobrado. O par de/por é
    // UNITÁRIO e vem do helper (RN-14): em texto plano usa PARÊNTESES, nunca
    // `~tachado~` (marcação do WhatsApp numa string que carrega texto livre do
    // cliente seria superfície nova sem ganho de leitura).
    const opcionais = mapearOpcionaisExibicao(
      item.itens_pedido_opcionais ?? [],
    );
    const totalItem = totalDaLinha({
      preco: item.preco,
      quantidade: item.quantidade,
      opcionais,
    });
    const dePor = textoDePor(item);
    return [
      `- ${item.quantidade}x ${item.nome} — ${formatarMoeda(totalItem)}${dePor ? ` (${dePor})` : ""}`,
      ...opcionais.map(
        (o) => `  + ${o.nome} (${o.quantidade}x) — ${formatarMoeda(o.preco)}`,
      ),
      // Texto livre do cliente: só entra citado (ver `citarTextoCliente`).
      ...(item.observacao
        ? [`  obs: ${citarTextoCliente(item.observacao)}`]
        : []),
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

  linhas.push(
    "",
    `Localize este pedido no painel pelo nº ${formatarNumeroPedido(pedido.id)}.`,
  );

  const mensagem = linhas.join("\n");
  return {
    // [287] `wa.me` é a rota canônica de redirecionamento: pula a intersticial
    // "Continue to chat" que `api.whatsapp.com/send` serve antes do chat. Mesmo
    // esquema `https` (passa no guard §15) e MESMA mensagem, byte a byte — só o
    // host mudou, RN-A6 segue intacta.
    href: `https://wa.me/${numeroLimpo}?text=${encodeURIComponent(mensagem)}`,
  };
}
