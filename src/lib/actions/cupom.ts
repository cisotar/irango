"use server";

// FRONTEIRA preview ↔ autoritativo (D-fronteira do plano): esta action valida o
// USO do cupom de forma autoritativa (ativo/expira/usos), mas o VALOR retornado
// é PREVIEW — depende do `subtotal` que o cliente controla. A autoridade final
// de quanto se paga é a criarPedido (014), que re-deriva o subtotal dos itens
// reais (seguranca.md §10). NÃO pular a revalidação na 014.
//
// D4: loja inativa NÃO é barrada aqui (preview) — é barrada na RLS de INSERT de
//     pedido (014, public.loja_esta_ativa).
// D6: rate limit ~20/min por IP — issue 052 (seguranca.md §12). Não nesta action.

import { validarCupomInput } from "@/lib/validacoes/cupomUso";
import type { EntradaValidarCupom } from "@/lib/validacoes/cupomUso";
import {
  validarUsoCupom,
  type MotivoInvalido,
} from "@/lib/utils/validarUsoCupom";
import { calcularDesconto } from "@/lib/utils/calcularDesconto";
import { createServiceClient } from "@/lib/supabase/service";
import { buscarCupomPorCodigo } from "@/lib/supabase/queries/entregaPagamento";

export type ResultadoValidacaoCupom =
  | { valido: true; desconto: number }
  | { valido: false; motivo: MotivoInvalido };

export async function validarCupom(
  entrada: EntradaValidarCupom,
): Promise<ResultadoValidacaoCupom> {
  // 1) Valida e normaliza o input ANTES de tocar no banco. Input lixo
  //    (UUID malformado, subtotal NaN/negativo) sai como "invalido" sem I/O.
  const parsed = validarCupomInput.safeParse(entrada);
  if (!parsed.success) {
    return { valido: false, motivo: "invalido" };
  }
  const { lojaId, codigo, subtotal } = parsed.data;

  try {
    // 2) Busca escopada por (lojaId, codigo) via service_role — nunca SELECT
    //    público. Cupom de outra loja não casa → null.
    const svc = createServiceClient();
    const cupom = await buscarCupomPorCodigo(svc, lojaId, codigo);

    // 3) Inexistente → mesmo motivo que inativo (anti-enumeração).
    if (cupom == null) {
      return { valido: false, motivo: "invalido" };
    }

    // 4) Validade de uso autoritativa (ativo/expira/usos/mínimo).
    const uso = validarUsoCupom(cupom, subtotal, new Date());
    if (!uso.valido) {
      return { valido: false, motivo: uso.motivo ?? "invalido" };
    }

    // 5) Valor do desconto (PREVIEW sobre o subtotal recebido).
    //    cupons.tipo é `string` no tipo gerado, mas o CHECK do banco garante
    //    o enum; estreitamos para o contrato de calcularDesconto.
    const { desconto } = calcularDesconto(
      { ...cupom, tipo: cupom.tipo as "percentual" | "fixo" },
      subtotal,
    );
    return { valido: true, desconto };
  } catch (e) {
    // Erro interno nunca vaza ao cliente (seguranca.md §14): log no servidor,
    // retorno genérico.
    console.error("[validarCupom]", e);
    return { valido: false, motivo: "invalido" };
  }
}
