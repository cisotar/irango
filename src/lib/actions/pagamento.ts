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

import { schemaFormaPagamento } from "@/lib/validacoes/pagamento";
import { createClient } from "@/lib/supabase/server";
import { buscarLojaDoDono } from "@/lib/supabase/queries/lojas";
import type { Json } from "@/lib/database.types";

export type ResultadoPagamento = { ok: true } | { ok: false; erro: string };

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
    return { ok: true };
  } catch (e) {
    console.error("[salvarFormaPagamento]", e);
    return { ok: false, erro: "Não foi possível salvar a forma de pagamento." };
  }
}
