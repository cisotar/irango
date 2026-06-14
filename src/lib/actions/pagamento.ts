"use server";

// STUB TDD (issue 032) — Server Action de PAGAMENTO. Implementação real é da
// fase GREEN (executar).
//
// Contrato (issue 032 + seguranca.md §2/§14):
//   - salvarFormaPagamento: valida schemaFormaPagamento (config por tipo —
//     chave pix malformada faria o comprador pagar pra ninguém);
//   - INSERT/UPSERT em formas_pagamento via client AUTENTICADO (RLS
//     pagamentos escrita própria); loja_id DERIVADO da loja do dono
//     (buscarLojaDoDono), NUNCA do payload;
//   - erro genérico no catch.

import { revalidatePath } from "next/cache";
import { schemaFormaPagamento } from "@/lib/validacoes/pagamento";
import { createClient } from "@/lib/supabase/server";
import { buscarLojaDoDono } from "@/lib/supabase/queries/lojas";
import type { Json } from "@/lib/database.types";

export type ResultadoPagamento = { ok: true } | { ok: false; erro: string };

const ROTA = "/painel/configuracoes/pagamentos";

export async function salvarFormaPagamento(
  payload: unknown,
): Promise<ResultadoPagamento> {
  // Valida config por tipo ANTES de I/O — chave pix malformada faria o
  // comprador pagar pra ninguém; url de link inválida idem.
  const parsed = schemaFormaPagamento.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, erro: "Forma de pagamento inválida." };
  }

  try {
    // Client AUTENTICADO — RLS `pagamentos_escrita_propria` (auth.uid() = dono).
    const supabase = await createClient();
    // loja_id DERIVADO da loja do dono, NUNCA do payload.
    const loja = await buscarLojaDoDono(supabase);
    if (loja == null) {
      return { ok: false, erro: "Loja não encontrada." };
    }
    const { error } = await supabase.from("formas_pagamento").insert({
      tipo: parsed.data.tipo,
      config: parsed.data.config as Json,
      loja_id: loja.id,
    });
    if (error) {
      console.error("[salvarFormaPagamento]", error);
      return { ok: false, erro: "Não foi possível salvar a forma de pagamento." };
    }
    revalidatePath(ROTA);
    return { ok: true };
  } catch (e) {
    console.error("[salvarFormaPagamento]", e);
    return { ok: false, erro: "Não foi possível salvar a forma de pagamento." };
  }
}

/**
 * Atualiza a config de uma forma existente (issue 047). Escopo por `id`; a RLS
 * `pagamentos_escrita_propria` impede tocar a de outra loja. `tipo` revalidado
 * junto da config (discriminated union) e reafirmado no update.
 */
export async function atualizarFormaPagamento(
  id: string,
  payload: unknown,
): Promise<ResultadoPagamento> {
  const parsed = schemaFormaPagamento.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, erro: "Forma de pagamento inválida." };
  }
  try {
    const supabase = await createClient();
    const { error } = await supabase
      .from("formas_pagamento")
      .update({ tipo: parsed.data.tipo, config: parsed.data.config as Json })
      .eq("id", id);
    if (error) {
      console.error("[atualizarFormaPagamento]", error);
      return { ok: false, erro: "Não foi possível salvar a forma de pagamento." };
    }
    revalidatePath(ROTA);
    return { ok: true };
  } catch (e) {
    console.error("[atualizarFormaPagamento]", e);
    return { ok: false, erro: "Não foi possível salvar a forma de pagamento." };
  }
}

/**
 * Remove (desativa) uma forma de pagamento (issue 047). A tabela não tem coluna
 * `ativo` — a presença é o que define "aceita", então desativar = remover.
 * Escopo por `id` (RLS `pagamentos_escrita_propria`).
 */
export async function removerFormaPagamento(
  id: string,
): Promise<ResultadoPagamento> {
  try {
    const supabase = await createClient();
    const { error } = await supabase
      .from("formas_pagamento")
      .delete()
      .eq("id", id);
    if (error) {
      console.error("[removerFormaPagamento]", error);
      return { ok: false, erro: "Não foi possível remover a forma de pagamento." };
    }
    revalidatePath(ROTA);
    return { ok: true };
  } catch (e) {
    console.error("[removerFormaPagamento]", e);
    return { ok: false, erro: "Não foi possível remover a forma de pagamento." };
  }
}
