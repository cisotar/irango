"use server";

// Server Action de PREVIEW de cupom para o wizard de checkout (Etapa 1 — issue 073).
//
// FRONTEIRA preview ↔ autoritativo:
//   Esta action retorna { valido, desconto_preview, mensagem } para UX. O valor
//   aqui é ESTIMATIVA sobre o subtotal enviado pelo cliente. A autoridade real
//   de desconto é criarPedido (071/RPC), que re-deriva o subtotal dos preços
//   reais do banco e revalida o cupom (seguranca.md §10). Nunca pular a
//   revalidação na 071.
//
// Diferença de contrato em relação a validarCupom (013):
//   - 013 retorna union { valido:true, desconto } | { valido:false, motivo }
//   - 073 retorna shape uniforme { valido, desconto_preview, mensagem } para
//     o wizard exibir feedback sem precisar discriminar union.
//   Internamente reutiliza as mesmas utils (sem duplicar lógica).
//
// Segurança:
//   - service_role para buscar cupom (RLS de cupom não tem SELECT público).
//   - Escopo sempre por (loja_id, codigo) — nunca vaza cupom de outra loja.
//   - Cupom inexistente/inativo → mensagem genérica (anti-enumeração §6).
//   - Erro interno → log no servidor, retorno genérico (seguranca.md §14).

import { z } from "zod";
import { cupomSchema } from "@/lib/validacoes/cupom";
import { validarUsoCupom } from "@/lib/utils/validarUsoCupom";
import { calcularDesconto } from "@/lib/utils/calcularDesconto";
import { createServiceClient } from "@/lib/supabase/service";
import { buscarCupomPorCodigo } from "@/lib/supabase/queries/entregaPagamento";

// ── Schema de input ────────────────────────────────────────────────────────

const inputSchema = z.object({
  loja_id: z.guid(),
  codigo: cupomSchema.shape.codigo, // trim + uppercase + regex [A-Z0-9]+
  subtotal_preview: z.number().nonnegative().finite(),
});

// ── Tipo de retorno (contrato do wizard) ───────────────────────────────────

export interface ResultadoPreviewCupom {
  valido: boolean;
  desconto_preview: number;
  mensagem: string;
}

/** Retorno de falha: desconto zero, mensagem genérica ou revelável. */
function invalido(mensagem: string): ResultadoPreviewCupom {
  return { valido: false, desconto_preview: 0, mensagem };
}

// ── Action pública ─────────────────────────────────────────────────────────

/**
 * Valida um cupom para preview de UX no wizard de checkout.
 *
 * @param loja_id  UUID da loja (escopo da busca — nunca vaza cupom de outra loja)
 * @param codigo   Código do cupom (normalizado: trim + uppercase)
 * @param subtotal_preview  Subtotal dos produtos (RN-C1: desconto nunca inclui frete)
 * @returns { valido, desconto_preview, mensagem } — shape uniforme para o wizard
 *
 * IMPORTANTE: desconto_preview é estimativa sobre `subtotal_preview` enviado
 * pelo cliente. O desconto cobrado de verdade vem da revalidação em criarPedido
 * (071) sobre os preços reais do banco.
 */
export async function validarCupomAction(
  loja_id: string,
  codigo: string,
  subtotal_preview: number,
): Promise<ResultadoPreviewCupom> {
  // 1) Valida input — rejeita lixo antes de qualquer I/O.
  const parsed = inputSchema.safeParse({ loja_id, codigo, subtotal_preview });
  if (!parsed.success) {
    return invalido("Cupom inválido.");
  }
  const {
    loja_id: lojaId,
    codigo: codigoNorm,
    subtotal_preview: subtotal,
  } = parsed.data;

  try {
    // 2) Busca escopada por (lojaId, codigo) via service_role — RLS de cupom
    //    não tem SELECT público (cupons_acesso_proprio). Cupom de outra loja
    //    não casa → null.
    const svc = createServiceClient();
    const cupom = await buscarCupomPorCodigo(svc, lojaId, codigoNorm);

    // 3) Inexistente → mesmo motivo que inativo (anti-enumeração §6).
    if (cupom == null) {
      return invalido("Cupom inválido ou não encontrado.");
    }

    // 4) Validade de uso (ativo / expira / usos / mínimo).
    const uso = validarUsoCupom(cupom, subtotal, new Date());
    if (!uso.valido) {
      if (uso.motivo === "pedido_minimo") {
        return invalido(
          `Pedido mínimo para este cupom é R$ ${cupom.pedido_minimo.toFixed(2).replace(".", ",")}.`,
        );
      }
      // Inativo / expirado / esgotado → genérico (anti-enumeração).
      return invalido("Cupom inválido ou não encontrado.");
    }

    // 5) Cálculo do desconto (RN-C1: base = subtotal dos produtos, nunca frete).
    //    cupons.tipo é `string` no tipo gerado; estreitamos ao enum do schema.
    const { desconto } = calcularDesconto(
      { ...cupom, tipo: cupom.tipo as "percentual" | "fixo" },
      subtotal,
    );

    return {
      valido: true,
      desconto_preview: desconto,
      mensagem: `Cupom aplicado! Desconto de R$ ${desconto.toFixed(2).replace(".", ",")} no subtotal.`,
    };
  } catch (e) {
    // Erro interno nunca vaza ao cliente (seguranca.md §14): log no servidor,
    // retorno genérico.
    console.error("[validarCupomAction]", e);
    return invalido("Não foi possível validar o cupom. Tente novamente.");
  }
}
