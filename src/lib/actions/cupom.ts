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

// ──────────────────────────────────────────────────────────────────────────
// CRUD de cupons do LOJISTA (issue 032). Contrato (seguranca.md §2/§14):
//   - valida `cupomSchema` ANTES de qualquer I/O;
//   - usa o client AUTENTICADO (RLS `cupons_acesso_proprio`), nunca service_role;
//   - loja_id é DERIVADO da loja do dono (buscarLojaDoDono), NUNCA do payload —
//     não dá pra criar/editar cupom de outra loja;
//   - código único por loja → erro "Este código já existe";
//   - erro genérico no catch (sem vazar e.message).
import { cupomSchema } from "@/lib/validacoes/cupom";
import { createClient } from "@/lib/supabase/server";
import { buscarLojaDoDono } from "@/lib/supabase/queries/lojas";

export type ResultadoGestaoCupom = { ok: true } | { ok: false; erro: string };

// Mapeia o `error` do PostgREST para o contrato { ok:false, erro } — código
// duplicado (unique violation) ganha mensagem específica; o resto é genérico.
function erroPersistencia(error: { code?: string }): ResultadoGestaoCupom {
  if (error.code === "23505") {
    return { ok: false, erro: "Este código já existe" };
  }
  return { ok: false, erro: "Não foi possível salvar o cupom." };
}

export async function criarCupom(
  payload: unknown,
): Promise<ResultadoGestaoCupom> {
  // 1) Valida/normaliza a FORMA do cupom ANTES de qualquer I/O. Lixo (percentual
  //    >100, código com símbolo, valor negativo) nem chega ao banco.
  const parsed = cupomSchema.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, erro: "Cupom inválido." };
  }

  try {
    // 2) Client AUTENTICADO — RLS `cupons_acesso_proprio` isola por dono.
    const supabase = await createClient();
    // 3) loja_id DERIVADO da loja do dono, NUNCA do payload.
    const loja = await buscarLojaDoDono(supabase);
    if (loja == null) {
      return { ok: false, erro: "Loja não encontrada." };
    }
    const { error } = await supabase
      .from("cupons")
      .insert({ ...parsed.data, loja_id: loja.id });
    if (error) {
      console.error("[criarCupom]", error);
      return erroPersistencia(error);
    }
    return { ok: true };
  } catch (e) {
    console.error("[criarCupom]", e);
    return { ok: false, erro: "Não foi possível salvar o cupom." };
  }
}

export async function atualizarCupom(
  id: string,
  payload: unknown,
): Promise<ResultadoGestaoCupom> {
  const parsed = cupomSchema.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, erro: "Cupom inválido." };
  }

  try {
    const supabase = await createClient();
    const loja = await buscarLojaDoDono(supabase);
    if (loja == null) {
      return { ok: false, erro: "Loja não encontrada." };
    }
    // loja_id reafirmado como o do dono (defesa: WITH CHECK da RLS rejeitaria
    // troca para outra loja, mas nem oferecemos a opção) + escopo por id.
    const { error } = await supabase
      .from("cupons")
      .update({ ...parsed.data, loja_id: loja.id })
      .eq("id", id);
    if (error) {
      console.error("[atualizarCupom]", error);
      return erroPersistencia(error);
    }
    return { ok: true };
  } catch (e) {
    console.error("[atualizarCupom]", e);
    return { ok: false, erro: "Não foi possível salvar o cupom." };
  }
}

export async function removerCupom(
  id: string,
): Promise<ResultadoGestaoCupom> {
  try {
    const supabase = await createClient();
    // RLS `cupons_acesso_proprio` impede deletar cupom de outra loja — não há
    // necessidade (nem permissão) de service_role.
    const { error } = await supabase.from("cupons").delete().eq("id", id);
    if (error) {
      console.error("[removerCupom]", error);
      return { ok: false, erro: "Não foi possível remover o cupom." };
    }
    return { ok: true };
  } catch (e) {
    console.error("[removerCupom]", e);
    return { ok: false, erro: "Não foi possível remover o cupom." };
  }
}

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
