"use server";

/**
 * Variante ADMIN do registro do frete combinado (spec modalidades-entrega-loja,
 * paridade hub ↔ painel). Molde: `admin-status.ts`.
 *
 * Ordem fail-closed:
 *  1. validarLojaIdAdmin + `schemaRegistroFreteCombinado` (`.strict()`, o MESMO
 *     da action do lojista) ANTES de qualquer I/O.
 *  2. prepararContextoAdmin FORA do try → prova de admin propaga.
 *  3. escopo.buscarPorId — `subtotal`/`desconto` lidos do banco, escopados por
 *     `loja_id` + `id`; pedido de outra loja → null → recusa.
 *  4. escopo.atualizar + filtros de D1/D2 NO UPDATE (`frete_a_combinar = true`,
 *     `tipo_entrega = 'entrega'`, status ∈ não-cancelados) com `count === 1`.
 *     Status via `.in` com a lista DERIVADA de `STATUS_VALIDOS` menos
 *     `cancelado`: o wrapper `escopo` expõe `in`, não `neq` — e a allowlist é
 *     fail-closed para um status novo que ainda não exista no domínio.
 *  5. registrarAcessoAdmin (`pedido.frete`) + revalidação das rotas admin.
 */

import { revalidatePath } from "next/cache";
import {
  validarLojaIdAdmin,
  prepararContextoAdmin,
  revalidarLojaAdmin,
  registrarAcessoAdmin,
} from "@/lib/actions/admin-loja";
import { calcularTotal } from "@/lib/utils/calcularTotal";
import { STATUS_VALIDOS } from "@/lib/utils/transicaoStatus";
import { schemaRegistroFreteCombinado } from "@/lib/validacoes/entrega";
import type { ResultadoRegistroFrete } from "@/lib/actions/freteCombinado";

const ERRO_GENERICO = "Não foi possível registrar o frete do pedido.";

/** D2: o registro vale em qualquer status, exceto `cancelado`. */
const STATUS_ACEITA_REGISTRO = STATUS_VALIDOS.filter((s) => s !== "cancelado");

export async function registrarFreteCombinadoAdmin(
  lojaId: string,
  payload: unknown,
): Promise<ResultadoRegistroFrete> {
  const loja = validarLojaIdAdmin(lojaId);
  if (!loja.ok) return { ok: false, erro: ERRO_GENERICO };

  const parsed = schemaRegistroFreteCombinado.safeParse(payload);
  if (!parsed.success) return { ok: false, erro: ERRO_GENERICO };
  const { pedidoId, valor } = parsed.data;

  // Fail-closed: prova de admin FORA do try → propaga, service só depois.
  const { svc, escopo } = await prepararContextoAdmin(loja.lojaId);

  try {
    const { data: pedido, error: erroLeitura } = await escopo.buscarPorId(
      "pedidos",
      pedidoId,
      "subtotal, desconto",
    );
    if (erroLeitura) {
      console.error("[registrarFreteCombinadoAdmin]", erroLeitura);
      return { ok: false, erro: ERRO_GENERICO };
    }
    if (!pedido) return { ok: false, erro: ERRO_GENERICO };

    const base = pedido as { subtotal: number; desconto: number };
    const { total } = calcularTotal({
      subtotal: base.subtotal,
      desconto: base.desconto,
      taxaEntrega: valor,
    });

    const { error: erroEscrita, count } = await escopo
      .atualizar("pedidos", pedidoId, {
        taxa_entrega: valor,
        total,
        frete_a_combinar: false,
      })
      .eq("frete_a_combinar", true)
      .eq("tipo_entrega", "entrega")
      .in("status", STATUS_ACEITA_REGISTRO);
    if (erroEscrita) {
      console.error("[registrarFreteCombinadoAdmin]", erroEscrita);
      return { ok: false, erro: ERRO_GENERICO };
    }
    // count !== 1: já registrado (D1), retirada, cancelado (D2), corrida ou escopo.
    if (count !== 1) return { ok: false, erro: ERRO_GENERICO };

    registrarAcessoAdmin(svc, {
      lojaId: loja.lojaId,
      acao: "pedido.frete",
      entidadeId: pedidoId,
      metadados: { valor },
    });
    revalidarLojaAdmin(loja.lojaId);
    revalidatePath(`/admin/assinantes/${loja.lojaId}/pedidos`);
    revalidatePath(`/admin/assinantes/${loja.lojaId}/pedidos/${pedidoId}`);

    return { ok: true };
  } catch (e) {
    console.error("[registrarFreteCombinadoAdmin]", e);
    return { ok: false, erro: ERRO_GENERICO };
  }
}
