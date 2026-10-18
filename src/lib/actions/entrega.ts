"use server";

// Server Actions de ENTREGA do lojista: modalidades e zonas de entrega.
//
// Contrato (seguranca.md §2/§14):
//   - valida o zod ANTES de qualquer I/O;
//   - usa o client AUTENTICADO (RLS), nunca service_role;
//   - loja_id é DERIVADO da loja do dono (buscarLojaDoDono), NUNCA do payload;
//   - as zonas só são gravadas pela RPC `salvar_zonas_entrega` (conjunto inteiro,
//     uma forma, versão otimista) — não há escrita por zona (issue 327);
//   - erro genérico no catch (sem vazar e.message).

import { revalidatePath } from "next/cache";
import {
  MENSAGEM_ERRO_ZONAS,
  argsSalvarZonas,
  resultadoDaRpcZonas,
  schemaModalidadesEntrega,
  validarPayloadZonas,
  type ResultadoZonas,
} from "@/lib/validacoes/entrega";
import { createClient } from "@/lib/supabase/server";
import { buscarLojaDoDono } from "@/lib/supabase/queries/lojas";
import { montarPatchModalidades } from "@/lib/actions/patches-loja";

export type ResultadoEntrega = { ok: true } | { ok: false; erro: string };

const ROTA = "/painel/configuracoes/entregas";

/**
 * Liga/desliga retirada e entrega e escolhe o modo do frete (spec
 * modalidades-entrega-loja). zod ANTES de qualquer I/O (espelha os CHECKs de
 * `lojas`); client AUTENTICADO (RLS `lojas_update_proprio`); loja = a do dono
 * logado, nunca do payload; patch pela allowlist `montarPatchModalidades`, que
 * grava só as três colunas. Não toca zonas/taxas/bairros: elas continuam salvas
 * com a entrega desligada ou no modo a combinar.
 */
export async function salvarModalidadesEntrega(
  payload: unknown,
): Promise<ResultadoEntrega> {
  const parsed = schemaModalidadesEntrega.safeParse(payload);
  if (!parsed.success) {
    const regra = parsed.error.issues.find((i) => i.code === "custom");
    return { ok: false, erro: regra?.message ?? "Configuração de entrega inválida." };
  }

  try {
    const supabase = await createClient();
    const loja = await buscarLojaDoDono(supabase);
    if (loja == null) {
      return { ok: false, erro: "Loja não encontrada." };
    }
    const { error } = await supabase
      .from("lojas")
      .update(montarPatchModalidades(parsed.data))
      .eq("id", loja.id);
    if (error) {
      console.error("[salvarModalidadesEntrega]", error);
      return { ok: false, erro: "Não foi possível salvar as modalidades de entrega." };
    }
    revalidatePath(ROTA);
    revalidatePath("/loja/[slug]", "page");
    return { ok: true };
  } catch (e) {
    console.error("[salvarModalidadesEntrega]", e);
    return { ok: false, erro: "Não foi possível salvar as modalidades de entrega." };
  }
}

export type { ResultadoZonas };

/**
 * Grava as zonas de entrega da loja numa forma só (issues 325/328): faixas de
 * km, faixas de CEP ou bairros. zod ANTES de qualquer I/O (`.strict()` em todo
 * nível); client AUTENTICADO; loja = a do dono logado, nunca do payload. UMA
 * chamada à RPC `salvar_zonas_entrega`, que confere a versão no banco
 * (compare-and-set), apaga só as zonas da forma pedida (`tipo = p_forma`), as
 * regrava e ativa essa forma; as zonas das outras formas ficam guardadas.
 * Validação e tradução da resposta são as mesmas do admin
 * (`validarPayloadZonas`/`resultadoDaRpcZonas`); aqui fica só o que é do
 * lojista: a loja do dono e o `revalidatePath` (não em conflito nem erro).
 */
export async function salvarZonasEntrega(payload: unknown): Promise<ResultadoZonas> {
  const validado = validarPayloadZonas(payload);
  if (!validado.ok) return validado;

  try {
    const supabase = await createClient();
    const loja = await buscarLojaDoDono(supabase);
    if (loja == null) {
      return { ok: false, erro: "Loja não encontrada." };
    }
    // Tenant por ÚLTIMO: nenhum spread sobrescreve a loja derivada.
    const resposta = await supabase.rpc("salvar_zonas_entrega", {
      ...argsSalvarZonas(validado.data),
      p_loja_id: loja.id,
    });
    const resultado = resultadoDaRpcZonas("salvarZonasEntrega", resposta);
    if (resultado.ok) {
      revalidatePath(ROTA);
      revalidatePath("/loja/[slug]", "page");
    }
    return resultado;
  } catch (e) {
    console.error("[salvarZonasEntrega]", e);
    return { ok: false, erro: MENSAGEM_ERRO_ZONAS };
  }
}
