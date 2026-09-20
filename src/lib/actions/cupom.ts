"use server";

// (228) O antigo endpoint de validação de uso de cupom vivia neste arquivo e
// foi REMOVIDO: uma função exportada de módulo `'use server'` é um endpoint RPC
// vivo, e aquele recebia o subtotal do CLIENTE. Quem revisa carrinho e cupom
// hoje é `revisarCarrinhoAction` (revisarCarrinho.ts), que deriva subtotal,
// base elegível e desconto do BANCO — a mesma cadeia do autoritativo
// `criarPedido` (D5-b / RN-11). Não reabrir a porta.

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
// Fonte ÚNICA do contrato de resultado + do mapper 23505 (compartilhada com o
// CRUD admin, admin-cupom.ts). Módulo NEUTRO: 'use server' não pode exportar
// type nem função sync (ver MEMORY use-server-export-constraint).
import {
  erroPersistenciaCupom as erroPersistencia,
  type ResultadoGestaoCupom,
} from "@/lib/actions/cupom-erros";

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
