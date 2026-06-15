"use server";

// Server Action PÚBLICA de PREVIEW de frete (issue 072).
//
// FRONTEIRA preview ↔ autoritativo (seguranca.md §10): o valor retornado é só
// UX — nenhum campo monetário vem do cliente. O recálculo definitivo (e vinculante)
// ocorre em `criarPedido` (issue 071), que re-busca zonas e taxa do banco. NÃO
// pular a revalidação autoritativa no pedido.
//
// Segurança:
//   - Schema zod .strict() valida ANTES de qualquer I/O. Campo extra (ex.: taxa_preview
//     injetado pelo cliente) → rejeitado imediatamente.
//   - Leitura PÚBLICA via client anon (createClient do servidor). Zonas e view
//     vitrine_lojas têm RLS pública — NUNCA service_role nesta action.
//   - Erro interno nunca vaza ao cliente (seguranca.md §14): log no servidor,
//     retorno genérico.
//   - Reusa EXATAMENTE a mesma lib do recálculo autoritativo (calcularFrete +
//     normalizarBairro de lib/utils/calcularFrete.ts) — RN-C4, paridade preview↔real.

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { listarZonasComTaxas } from "@/lib/supabase/queries/entregaPagamento";
import { buscarLojaPublicaPorId } from "@/lib/supabase/queries/lojas";
import { calcularFrete } from "@/lib/utils/calcularFrete";

// Schema zod .strict(): rejeita qualquer campo que não seja loja_id + bairro —
// impede injeção de taxa_preview, subtotal, etc. pelo cliente.
// z.guid() (não z.uuid()): valida formato uuid sem exigir nibbles de versão/variante
// RFC-4122 — alinhado com schemaCheckout e schemaPayloadPedido do projeto.
const schemaFretePreview = z
  .object({
    loja_id: z.guid(),
    bairro: z.string().trim().min(1),
  })
  .strict();

export type ResultadoFretePreview =
  | { ok: true; taxa_preview: number; zona_nome: string }
  | { ok: false; erro: string };

/**
 * Preview de frete para o wizard de checkout (Etapa Entrega — issue 075).
 *
 * Recebe { loja_id, bairro } do cliente. Recalcula a taxa do BANCO — nunca do
 * cliente. Retorna shape estável:
 *   - bairro em zona  → { ok:true, taxa_preview, zona_nome: <nome da zona> }
 *   - fora + fallback → { ok:true, taxa_preview, zona_nome: 'fora_zona' }
 *   - fora + sem fal  → { ok:true, taxa_preview: 0, zona_nome: 'indisponivel' }
 *   - payload inválid → { ok:false, erro }  (sem I/O)
 *   - erro interno    → { ok:false, erro }  (genérico)
 */
export async function calcularFreteAction(
  payload: unknown,
): Promise<ResultadoFretePreview> {
  // 1) Valida e normaliza o input ANTES de tocar no banco. Campo extra (injeção
  //    de taxa_preview pelo cliente) é rejeitado aqui via .strict().
  const parsed = schemaFretePreview.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, erro: "Dados de frete inválidos." };
  }
  const { loja_id, bairro } = parsed.data;

  try {
    // 2) Client ANON — zonas e vitrine_lojas têm RLS pública. Nunca service_role.
    const supabase = await createClient();

    // 3) Busca paralela: zonas hidratadas + loja (para taxa_entrega_fora_zona).
    const [zonas, loja] = await Promise.all([
      listarZonasComTaxas(supabase, loja_id),
      buscarLojaPublicaPorId(supabase, loja_id),
    ]);

    // 4) Reusa a MESMA lib do recálculo autoritativo (RN-C4 + paridade preview↔real).
    //    subtotal = 0: preview não tem itens confirmados ainda; nunca grátis por subtotal.
    const resultado = calcularFrete(
      zonas,
      { bairro },
      0,
      loja?.taxa_entrega_fora_zona,
    );

    // 5) Mapeia ResultadoFrete → shape de preview para o cliente.
    if (!resultado.atendido) {
      return { ok: true, taxa_preview: 0, zona_nome: "indisponivel" };
    }

    if (resultado.zonaId == null) {
      // Fallback fora-de-zona (RN-C4 passo 4): atendido mas sem zona específica.
      return { ok: true, taxa_preview: resultado.taxa, zona_nome: "fora_zona" };
    }

    // Bairro dentro de uma zona — busca o nome da zona para exibir na UX.
    const zonaEscolhida = zonas.find((z) => z.id === resultado.zonaId);
    const zona_nome = zonaEscolhida?.nome ?? resultado.zonaId;

    return { ok: true, taxa_preview: resultado.taxa, zona_nome };
  } catch (e) {
    // Erro interno nunca vaza ao cliente (seguranca.md §14).
    console.error("[calcularFreteAction]", e);
    return { ok: false, erro: "Não foi possível calcular o frete." };
  }
}
