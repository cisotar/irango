import type { PedidoComItens } from "@/lib/supabase/queries/pedidos";
import type { LojaCompleta } from "@/lib/supabase/queries/lojas";
import { formatarMoeda } from "@/lib/utils/formatarMoeda";
import { formatarNumeroPedido } from "@/lib/utils/formatarNumeroPedido";

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
 * Formata endereço de entrega a partir do JSONB `endereco_entrega`.
 * O objeto pode conter campos livres; só lemos os conhecidos (rua, numero, bairro, cidade, estado, cep).
 */
function formatarEndereco(endereco: unknown): string {
  if (endereco == null || typeof endereco !== "object") return "—";
  const e = endereco as Record<string, unknown>;
  const str = (v: unknown): string =>
    typeof v === "string" && v.trim() !== "" ? v.trim() : "";

  const linha1 = [str(e.rua), str(e.numero)].filter(Boolean).join(", ");
  const linha2 = [str(e.bairro), str(e.cidade), str(e.estado)]
    .filter(Boolean)
    .join(" — ");
  const cep = str(e.cep) ? `CEP ${str(e.cep)}` : "";
  return [linha1, linha2, cep].filter(Boolean).join(" · ") || "—";
}

/**
 * Monta o link de notificação do pedido para o WhatsApp da loja (RN-W1/RN-W2).
 * `null` quando a loja não tem WhatsApp cadastrado (RN-W3) — a mensagem é
 * conveniência, nunca a fonte de verdade do pedido (RN-W4).
 */
export function montarLinkWhatsappPedido(
  pedido: PedidoComItens,
  loja: Pick<LojaCompleta, "nome" | "whatsapp">,
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
  const valorTaxa =
    pedido.tipo_entrega === "retirada" && pedido.taxa_entrega === 0
      ? "Grátis"
      : formatarMoeda(pedido.taxa_entrega);
  linhas.push(`${rotuloTaxa}: ${valorTaxa}`);
  linhas.push(`Total: ${formatarMoeda(pedido.total)}`);

  linhas.push("", `Entrega: ${rotuloTipoEntrega(pedido.tipo_entrega)}`);
  if (pedido.tipo_entrega === "entrega") {
    linhas.push(`Endereço: ${formatarEndereco(pedido.endereco_entrega)}`);
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
    linhas.push(`Obs.: ${pedido.observacoes}`);
  }

  linhas.push("", `Localize este pedido no painel pelo nº ${formatarNumeroPedido(pedido.id)}.`);

  const mensagem = linhas.join("\n");
  return {
    href: `https://api.whatsapp.com/send?phone=${numeroLimpo}&text=${encodeURIComponent(mensagem)}`,
  };
}
