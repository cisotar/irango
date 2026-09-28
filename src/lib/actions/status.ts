"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { STATUS_VALIDOS, type StatusPedido } from "@/lib/utils/transicaoStatus";
import { origensPermitidas } from "@/lib/utils/acoesStatusPedido";

const ERRO_GENERICO = "Não foi possível atualizar o status do pedido.";

const entradaSchema = z.object({
  pedidoId: z.guid(),
  novoStatus: z.enum(STATUS_VALIDOS),
});

export type ResultadoAtualizarStatus =
  | { ok: true; status: StatusPedido }
  | { ok: false; erro: string };

/**
 * Contrato da action de mudança de status que a UI recebe por injeção (issue 124):
 * default `atualizarStatusPedido` (lojista); o hub admin injeta
 * `atualizarStatusPedidoAdmin.bind(null, lojaId)`. Derivado da action real (não
 * escrito à mão): se `ResultadoAtualizarStatus` mudar, o tipo acompanha. Mora
 * aqui (módulo neutro para `components/painel/`), não no `AcoesStatus` (S1 da
 * issue 329). Só tipo: não viola a regra de export de arquivo `'use server'`.
 */
export type AcaoStatus = typeof atualizarStatusPedido;

/**
 * Server Action: muda o status de um pedido respeitando a máquina de estados
 * (RN-08 com o atalho da RN-SC2). A AUTORIDADE é o servidor, numa ida só ao
 * banco (RN-SC4, issue 329):
 *
 *   update pedidos set status = novo
 *    where id = $id and status in (origensPermitidas(novo))
 *
 * O PREDICADO do UPDATE impõe a transição — sem SELECT prévio, então não há
 * janela TOCTOU entre ler e gravar (dois cliques ou dois aparelhos). Via RLS
 * `pedidos_acesso_lojista` (cliente AUTENTICADO), só toca pedido da loja do
 * `auth.uid()` (RN-02). Zero linhas = outra loja, inexistente, status atual
 * fora das origens ou corrida: indistinguíveis, mesma recusa genérica.
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

  // Destino inalcançável (ex.: "pendente") nunca vira query: `.in` com lista
  // vazia não casaria nada, mas nem o client precisa ser criado.
  const origens = origensPermitidas(status);
  if (origens.length === 0) {
    return { ok: false, erro: ERRO_GENERICO };
  }

  // Cliente AUTENTICADO: a RLS pedidos_acesso_lojista escopa por auth.uid().
  // NUNCA service_role aqui — bypass de RLS deixaria lojista alterar pedido alheio.
  const supabase = await createClient();

  const { data: atualizados, error } = await supabase
    .from("pedidos")
    .update({ status })
    .eq("id", id)
    .in("status", origens)
    .select("id");

  if (error) {
    // Detalhe só no servidor — nunca vaza e.message ao cliente (§14).
    console.error("[atualizarStatusPedido]", error);
    return { ok: false, erro: ERRO_GENERICO };
  }

  // Lista vazia: o predicado (RLS + status atual) não casou. Não é sucesso.
  if (!atualizados || atualizados.length === 0) {
    return { ok: false, erro: ERRO_GENERICO };
  }

  return { ok: true, status };
}
