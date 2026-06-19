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
import { schemaFormaPagamento, schemaPixQrUrl } from "@/lib/validacoes/pagamento";
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
    // MERGE da config: o form só envia chave/tipo_chave (ou url). Um update
    // total apagaria campos gravados em escrita separada — sobretudo
    // `pix_qr_url` (salvo por `salvarQrPix`), sumindo o QR do painel e do
    // checkout. Lê a config atual e mescla; RLS escopa por dono.
    const { data: formaAtual, error: erroBusca } = await supabase
      .from("formas_pagamento")
      .select("config")
      .eq("id", id)
      .maybeSingle();
    if (erroBusca) {
      console.error("[atualizarFormaPagamento] busca", erroBusca);
      return { ok: false, erro: "Não foi possível salvar a forma de pagamento." };
    }
    const configAtual =
      formaAtual?.config &&
      typeof formaAtual.config === "object" &&
      !Array.isArray(formaAtual.config)
        ? (formaAtual.config as Record<string, unknown>)
        : {};
    const configMesclado: Json = {
      ...configAtual,
      ...(parsed.data.config as Record<string, unknown>),
    } as Json;
    const { error } = await supabase
      .from("formas_pagamento")
      .update({ tipo: parsed.data.tipo, config: configMesclado })
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
 * Persiste a URL pública do QR Code Pix no jsonb `config` de uma forma Pix
 * existente (issue 075). Recebe `pix_qr_url` do client após o upload no bucket
 * `pix-qr`; valida com `schemaPixQrUrl` (URL DEVE pertencer ao Storage do
 * iRango); atualiza via MERGE no jsonb preservando `chave`/`tipo_chave`.
 *
 * Segurança:
 *   - `loja_id` NUNCA vem do payload — derivado da loja do dono autenticado.
 *   - O path no bucket (`{loja_id}/...`) é garantido pela RLS do bucket (074).
 *   - URL externa é rejeitada por `schemaPixQrUrl`.
 *   - O UPDATE é escopado por `tipo = 'pix'` além de `id` (RLS escrita própria).
 */
export async function salvarQrPix(
  formaId: string,
  pixQrUrl: unknown,
): Promise<ResultadoPagamento> {
  // Valida que a URL pertence ao Storage do iRango — rejeita URL externa.
  const parsed = schemaPixQrUrl.safeParse(pixQrUrl);
  if (!parsed.success) {
    return { ok: false, erro: "URL do QR deve pertencer ao Storage do iRango." };
  }
  try {
    const supabase = await createClient();
    // Deriva loja_id do dono para confirmar escopo — RLS já barra, mas é defesa em profundidade.
    const loja = await buscarLojaDoDono(supabase);
    if (loja == null) {
      return { ok: false, erro: "Loja não encontrada." };
    }
    // MERGE preserva chave/tipo_chave: jsonb_set não está disponível aqui,
    // então usamos RPC de MERGE via UPDATE com concatenação jsonb no Postgres.
    // Alternativa portável: buscar config atual, mesclar em JS, salvar.
    const { data: formaAtual, error: erroBusca } = await supabase
      .from("formas_pagamento")
      .select("config")
      .eq("id", formaId)
      .eq("loja_id", loja.id)
      .eq("tipo", "pix")
      .maybeSingle();
    if (erroBusca) {
      console.error("[salvarQrPix] busca", erroBusca);
      return { ok: false, erro: "Não foi possível salvar o QR Pix." };
    }
    if (formaAtual == null) {
      return { ok: false, erro: "Forma de pagamento Pix não encontrada." };
    }

    // Mescla a URL no config existente, preservando chave/tipo_chave.
    const configAtual =
      formaAtual.config &&
      typeof formaAtual.config === "object" &&
      !Array.isArray(formaAtual.config)
        ? (formaAtual.config as Record<string, unknown>)
        : {};
    const configNovo: Json = { ...configAtual, pix_qr_url: parsed.data } as Json;

    const { error } = await supabase
      .from("formas_pagamento")
      .update({ config: configNovo })
      .eq("id", formaId)
      .eq("loja_id", loja.id)
      .eq("tipo", "pix");
    if (error) {
      console.error("[salvarQrPix]", error);
      return { ok: false, erro: "Não foi possível salvar o QR Pix." };
    }
    revalidatePath(ROTA);
    return { ok: true };
  } catch (e) {
    console.error("[salvarQrPix]", e);
    return { ok: false, erro: "Não foi possível salvar o QR Pix." };
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
