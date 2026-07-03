"use server";

/**
 * Variante ADMIN da mudança de status de pedido — issue 133 (crítica: SIM).
 * Escreve na LOJA-ALVO (`lojaId` da URL admin) via service_role, escopada pelo
 * wrapper `escopo` (injeta `.eq("loja_id", lojaId).eq("id", id)` por construção).
 * Diferente da action do lojista (src/lib/actions/status.ts), o isolamento NÃO
 * vem de RLS por dono — vem do escopo do wrapper + da prova de admin ANTES de
 * elevar (fail-closed, D-4 / seguranca.md §2/§14).
 *
 * Ordem fail-closed:
 *  1. validarLojaIdAdmin(lojaId) + entradaSchema.safeParse ANTES de qualquer I/O
 *     (nunca confiar no cliente — §6).
 *  2. prepararContextoAdmin(lojaId) FORA do try → verificarAdminSaaS() propaga se
 *     falhar (service client nunca criado, zero efeito).
 *  3. escopo.buscarPorId("pedidos", id, "status") — leitura escopada do status
 *     atual; pedido de outra loja/inexistente → data:null → { ok:false } SEM escrita.
 *  4. transicaoPermitida(atual, novo) — máquina de estados revalidada no servidor
 *     (RN-08); salto/reversão/saída de terminal → { ok:false } SEM UPDATE.
 *  5. escopo.atualizar("pedidos", id, { status }) escopado por loja_id+id, guard
 *     count === 1 (corrida/escopo zerado → { ok:false }, não mente ok:true).
 *  6. revalidarLojaAdmin + revalidatePath das rotas de pedidos admin;
 *     registrarAcessoAdmin no-op; catch genérico (detalhe só no log).
 *
 * REGRA: arquivo 'use server' só exporta funções async — o tipo de retorno é
 * importado de @/lib/actions/status (não redeclarado).
 */

import { z } from "zod";
import { revalidatePath } from "next/cache";
import {
  validarLojaIdAdmin,
  prepararContextoAdmin,
  revalidarLojaAdmin,
  registrarAcessoAdmin,
} from "@/lib/actions/admin-loja";
import {
  transicaoPermitida,
  STATUS_VALIDOS,
  type StatusPedido,
} from "@/lib/utils/transicaoStatus";
import type { ResultadoAtualizarStatus } from "@/lib/actions/status";

const ERRO_GENERICO = "Não foi possível atualizar o status do pedido.";

const entradaSchema = z.object({
  id: z.guid(),
  novoStatus: z.enum(STATUS_VALIDOS),
});

/**
 * Server Action admin: muda o status de um pedido da loja-alvo em nome do lojista.
 * A AUTORIDADE da máquina de estados é o servidor: o cliente envia só `id` e
 * `novoStatus`; o `status` atual é lido do banco (escopado) e a transição é
 * revalidada. Escopo cross-loja pelo wrapper `escopo` sob service_role.
 */
export async function atualizarStatusPedidoAdmin(
  lojaId: string,
  id: string,
  novoStatus: string,
): Promise<ResultadoAtualizarStatus> {
  const loja = validarLojaIdAdmin(lojaId);
  if (!loja.ok) return { ok: false, erro: ERRO_GENERICO };

  const parsed = entradaSchema.safeParse({ id, novoStatus });
  if (!parsed.success) return { ok: false, erro: ERRO_GENERICO };
  const { id: pedidoId, novoStatus: status } = parsed.data;

  // Fail-closed: prova de admin FORA do try → propaga, service só depois.
  const { svc, escopo } = await prepararContextoAdmin(loja.lojaId);

  try {
    // Leitura escopada do status atual (loja_id + id): pedido de outra loja/
    // inexistente não casa nenhuma linha → data:null.
    const { data: pedido, error: erroLeitura } = await escopo.buscarPorId(
      "pedidos",
      pedidoId,
      "status",
    );
    if (erroLeitura) {
      console.error("[atualizarStatusPedidoAdmin]", erroLeitura);
      return { ok: false, erro: ERRO_GENERICO };
    }
    if (!pedido) return { ok: false, erro: ERRO_GENERICO };

    const atual = (pedido as { status: string }).status as StatusPedido;

    // A AUTORIDADE da máquina de estados é o servidor (RN-08) — cliente ignorado.
    if (!transicaoPermitida(atual, status)) {
      return { ok: false, erro: ERRO_GENERICO };
    }

    // Escrita escopada por loja_id + id (cross-loja) pelo wrapper; o patch não
    // re-parenteia (loja_id) nem re-chaveia (id).
    const { error: erroEscrita, count } = await escopo.atualizar(
      "pedidos",
      pedidoId,
      { status },
    );
    if (erroEscrita) {
      console.error("[atualizarStatusPedidoAdmin]", erroEscrita);
      return { ok: false, erro: ERRO_GENERICO };
    }
    // count !== 1: corrida/escopo zerou o match. Não é sucesso.
    if (count !== 1) return { ok: false, erro: ERRO_GENERICO };

    registrarAcessoAdmin(svc, {
      lojaId: loja.lojaId,
      acao: "pedido.status",
      entidadeId: pedidoId,
      metadados: { de: atual, para: status },
    });
    revalidarLojaAdmin(loja.lojaId);
    revalidatePath(`/admin/assinantes/${loja.lojaId}/pedidos`);
    revalidatePath(`/admin/assinantes/${loja.lojaId}/pedidos/${pedidoId}`);

    return { ok: true, status };
  } catch (e) {
    console.error("[atualizarStatusPedidoAdmin]", e);
    return { ok: false, erro: ERRO_GENERICO };
  }
}
