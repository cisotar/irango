"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import {
  transicaoPermitida,
  STATUS_VALIDOS,
  type StatusPedido,
} from "@/lib/utils/transicaoStatus";

const ERRO_GENERICO = "Não foi possível atualizar o status do pedido.";

const entradaSchema = z.object({
  pedidoId: z.guid(),
  novoStatus: z.enum(STATUS_VALIDOS),
});

export type ResultadoAtualizarStatus =
  | { ok: true; status: StatusPedido }
  | { ok: false; erro: string };

/**
 * Server Action: avança o status de um pedido respeitando a máquina de estados
 * (RN-08). A AUTORIDADE é o servidor — recusa salto/reversão e, via RLS
 * `pedidos_acesso_lojista` (cliente AUTENTICADO), só toca pedido da loja do
 * `auth.uid()` (RN-02). Lojista de outra loja não casa nenhuma linha.
 */
export async function atualizarStatusPedido(
  pedidoId: string,
  novoStatus: string,
): Promise<ResultadoAtualizarStatus> {
  // Valida o input ANTES de qualquer I/O — nunca confiar no cliente (§6).
  const parsed = entradaSchema.safeParse({ pedidoId, novoStatus });
  if (!parsed.success) {
    return { ok: false, erro: ERRO_GENERICO };
  }
  const { pedidoId: id, novoStatus: status } = parsed.data;

  // Cliente AUTENTICADO: a RLS pedidos_acesso_lojista escopa por auth.uid().
  // NUNCA service_role aqui — bypass de RLS deixaria lojista alterar pedido alheio.
  const supabase = await createClient();

  // Lê o status atual. RLS barra pedido de outra loja → null/PGRST116.
  const { data: pedido, error: erroLeitura } = await supabase
    .from("pedidos")
    .select("status")
    .eq("id", id)
    .single();

  if (erroLeitura || !pedido) {
    return { ok: false, erro: ERRO_GENERICO };
  }

  const atual = pedido.status as StatusPedido;

  // A AUTORIDADE da máquina de estados é o servidor (RN-08).
  if (!transicaoPermitida(atual, status)) {
    return { ok: false, erro: ERRO_GENERICO };
  }

  const { data: atualizados, error: erroEscrita } = await supabase
    .from("pedidos")
    .update({ status })
    .eq("id", id)
    .select();

  if (erroEscrita) {
    // Detalhe só no servidor — nunca vaza e.message ao cliente (§14).
    console.error("[atualizarStatusPedido]", erroEscrita);
    return { ok: false, erro: ERRO_GENERICO };
  }

  // Lista vazia: RLS WITH CHECK barrou a escrita (corrida/escopo). Não é sucesso.
  if (!atualizados || atualizados.length === 0) {
    return { ok: false, erro: ERRO_GENERICO };
  }

  return { ok: true, status };
}
