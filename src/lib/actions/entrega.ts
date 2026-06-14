"use server";

// STUB TDD (issue 032) — Server Actions de ENTREGA (zonas/taxas) e PAGAMENTO
// vivem em arquivos próprios. Aqui: zonas + taxas. Implementação real é da
// fase GREEN (executar).
//
// Contrato (issue 032 + seguranca.md §2/§14):
//   - salvarZona: valida schemaZona; INSERT/UPSERT em zonas_entrega via client
//     AUTENTICADO (RLS zonas_escrita_propria); loja_id DERIVADO da loja do dono
//     (buscarLojaDoDono), NUNCA do payload.
//   - salvarTaxa: valida schemaTaxa; escopo por zona da própria loja (zona_id
//     pertencente ao dono — RLS via zona → loja). NUNCA confiar em zona_id de
//     outra loja.
//   - erro genérico no catch.

import { schemaZona, schemaTaxa } from "@/lib/validacoes/entrega";
import { createClient } from "@/lib/supabase/server";
import { buscarLojaDoDono } from "@/lib/supabase/queries/lojas";

export type ResultadoEntrega = { ok: true } | { ok: false; erro: string };

export async function salvarZona(
  payload: unknown,
): Promise<ResultadoEntrega> {
  // Valida a FORMA da zona ANTES de qualquer I/O (tipo enum, nome não-vazio).
  const parsed = schemaZona.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, erro: "Zona inválida." };
  }

  try {
    // Client AUTENTICADO — RLS `zonas_escrita_propria` (auth.uid() = dono).
    const supabase = await createClient();
    // loja_id DERIVADO da loja do dono, NUNCA do payload.
    const loja = await buscarLojaDoDono(supabase);
    if (loja == null) {
      return { ok: false, erro: "Loja não encontrada." };
    }
    const { error } = await supabase
      .from("zonas_entrega")
      .insert({ ...parsed.data, loja_id: loja.id });
    if (error) {
      console.error("[salvarZona]", error);
      return { ok: false, erro: "Não foi possível salvar a zona." };
    }
    return { ok: true };
  } catch (e) {
    console.error("[salvarZona]", e);
    return { ok: false, erro: "Não foi possível salvar a zona." };
  }
}

export async function salvarTaxa(
  zonaId: string,
  payload: unknown,
): Promise<ResultadoEntrega> {
  // Valida a FORMA da taxa ANTES de I/O — taxa negativa abriria valor de
  // entrega que reduz o total do pedido.
  const parsed = schemaTaxa.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, erro: "Taxa inválida." };
  }

  try {
    const supabase = await createClient();
    // A taxa é escopada pela zona; a RLS `taxas_escrita_propria` exige que a
    // zona pertença ao dono autenticado (zona → loja → dono_id = auth.uid()).
    // zona_id de outra loja → WITH CHECK rejeita. Não confiamos no client.
    const { error } = await supabase
      .from("taxas_entrega")
      .insert({ ...parsed.data, zona_id: zonaId });
    if (error) {
      console.error("[salvarTaxa]", error);
      return { ok: false, erro: "Não foi possível salvar a taxa." };
    }
    return { ok: true };
  } catch (e) {
    console.error("[salvarTaxa]", e);
    return { ok: false, erro: "Não foi possível salvar a taxa." };
  }
}
