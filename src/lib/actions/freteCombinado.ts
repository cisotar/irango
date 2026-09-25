"use server";

import { createClient } from "@/lib/supabase/server";
import { calcularTotal } from "@/lib/utils/calcularTotal";
import { schemaRegistroFreteCombinado } from "@/lib/validacoes/entrega";

const ERRO_GENERICO = "Não foi possível registrar o frete do pedido.";

export type ResultadoRegistroFrete = { ok: true } | { ok: false; erro: string };

/**
 * Server Action: o lojista registra o frete COMBINADO de um pedido de entrega
 * (spec modalidades-entrega-loja). Payload `{ pedidoId, valor }` — mais nada.
 *
 *  - Valor monetário do cliente é só o `valor` do frete; `subtotal` e
 *    `desconto` são LIDOS DO BANCO e o `total` é recalculado por
 *    `calcularTotal` (mesma aritmética do checkout). Campo extra → recusa.
 *  - D1/D2: as três condições (`frete_a_combinar = true`,
 *    `tipo_entrega = 'entrega'`, `status <> 'cancelado'`) são FILTRO DO UPDATE,
 *    não só da leitura — um segundo registro concorrente não casa nenhuma linha
 *    (TOCTOU). Zero linhas atualizadas = recusa.
 *  - Client AUTENTICADO: a RLS `pedidos_acesso_lojista` escopa pela loja do
 *    `auth.uid()`. NUNCA service_role aqui.
 */
export async function registrarFreteCombinado(
  payload: unknown,
): Promise<ResultadoRegistroFrete> {
  // Valida ANTES de qualquer I/O — nunca confiar no cliente (§6).
  const parsed = schemaRegistroFreteCombinado.safeParse(payload);
  if (!parsed.success) return { ok: false, erro: ERRO_GENERICO };
  const { pedidoId, valor } = parsed.data;

  const supabase = await createClient();

  // Base do total vem do banco. RLS barra pedido de outra loja → null.
  const { data: pedido, error: erroLeitura } = await supabase
    .from("pedidos")
    .select("subtotal, desconto")
    .eq("id", pedidoId)
    .maybeSingle();
  if (erroLeitura) {
    console.error("[registrarFreteCombinado]", erroLeitura);
    return { ok: false, erro: ERRO_GENERICO };
  }
  if (!pedido) return { ok: false, erro: ERRO_GENERICO };

  const { total } = calcularTotal({
    subtotal: pedido.subtotal,
    desconto: pedido.desconto,
    taxaEntrega: valor,
  });

  const { data: atualizados, error: erroEscrita } = await supabase
    .from("pedidos")
    .update({ taxa_entrega: valor, total, frete_a_combinar: false })
    .eq("id", pedidoId)
    .eq("frete_a_combinar", true)
    .eq("tipo_entrega", "entrega")
    .neq("status", "cancelado")
    .select("id");
  if (erroEscrita) {
    // Detalhe só no servidor — nunca vaza constraint/código ao cliente (§14).
    console.error("[registrarFreteCombinado]", erroEscrita);
    return { ok: false, erro: ERRO_GENERICO };
  }
  // Nenhuma linha: já registrado (D1), retirada, cancelado (D2) ou fora do escopo.
  if (!atualizados || atualizados.length === 0) {
    return { ok: false, erro: ERRO_GENERICO };
  }

  return { ok: true };
}
