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
//   - (067) Reconcilia CEP↔bairro com a MESMA política fail-closed do autoritativo
//     (064, seguranca.md §10-A): bairro declarado nunca seleciona zona quando há
//     CEP — vence o canônico do ViaCEP; falha do ViaCEP descarta o declarado. O
//     preview espelha a cobrança, mas SEGUE não-vinculante (a autoridade é criarPedido).

import { z } from "zod";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { extrairIp, verificarRateLimit } from "@/lib/utils/rateLimit";
import { listarZonasComTaxas } from "@/lib/supabase/queries/entregaPagamento";
import { buscarLojaPublicaPorId } from "@/lib/supabase/queries/lojas";
import { calcularFrete, type EnderecoEntrega } from "@/lib/utils/calcularFrete";
import { reconciliarBairroCep } from "@/lib/utils/reconciliarBairroCep";

// Schema zod .strict(): rejeita qualquer campo que não seja loja_id + bairro +
// cep — impede injeção de taxa_preview, subtotal, etc. pelo cliente.
// z.guid() (não z.uuid()): valida formato uuid sem exigir nibbles de versão/variante
// RFC-4122 — alinhado com schemaCheckout e schemaPayloadPedido do projeto.
// (067) cep é OPCIONAL (espelha o autoritativo, onde endereco.cep pode faltar):
// usado para reconciliar o bairro CANÔNICO (ViaCEP) e para casar zonas
// tipo='faixa_cep'. reconciliarBairroCep já normaliza dígitos internamente, então
// a máscara do CEP é tolerada aqui — sem reimplementar limpeza.
const schemaFretePreview = z
  .object({
    loja_id: z.guid(),
    bairro: z.string().trim().min(1).optional(),
    cep: z.string().trim().optional(),
  })
  .strict()
  // Pelo menos um critério de endereço (bairro p/ zona tipo='bairro' OU cep p/
  // tipo='faixa_cep'); payload só com loja_id não tem o que calcular.
  .refine((d) => d.bairro != null || d.cep != null, {
    message: "Informe bairro ou CEP.",
  });

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
  // 0) Rate limit ~20/min por IP (issue 052, finding BAIXA auditoria 067 —
  //    enumeração de bairro/CEP + abuso do ViaCEP server-side). Antes de qualquer
  //    I/O. Excedeu → erro genérico no shape da action (§14).
  const ip = extrairIp(await headers());
  if (!(await verificarRateLimit("fretePreview", ip)).permitido) {
    return { ok: false, erro: "Muitas tentativas. Tente novamente em alguns instantes." };
  }

  // 1) Valida e normaliza o input ANTES de tocar no banco. Campo extra (injeção
  //    de taxa_preview pelo cliente) é rejeitado aqui via .strict().
  const parsed = schemaFretePreview.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, erro: "Dados de frete inválidos." };
  }
  const { loja_id, bairro, cep } = parsed.data;

  try {
    // 2) Client ANON — zonas e vitrine_lojas têm RLS pública. Nunca service_role.
    const supabase = await createClient();

    // 3) Busca paralela: zonas hidratadas + loja (para taxa_entrega_fora_zona).
    const [zonas, loja] = await Promise.all([
      listarZonasComTaxas(supabase, loja_id),
      buscarLojaPublicaPorId(supabase, loja_id),
    ]);

    // 3b) (067) Reconciliação CEP↔bairro — MESMA política fail-closed do
    //     autoritativo `criarPedido` (064, pedido.ts ~194-217). O bairro declarado
    //     seleciona a zona tipo='bairro', logo é vetor de subpagamento; o preview
    //     PRECISA espelhar o autoritativo p/ não mostrar taxa barata divergente da
    //     cobrança. Com CEP+bairro → ViaCEP no servidor → usa o bairro CANÔNICO.
    //     ViaCEP indisponível / CEP inexistente / sem CEP → DESCARTA o declarado
    //     (bairro:null), caindo no fallback fora-de-zona. O CEP numérico permanece
    //     no endereço para zonas tipo='faixa_cep' (faixa numérica, não forjável).
    //     Continua NÃO-VINCULANTE: a autoridade de cobrança é `criarPedido`.
    const endereco: EnderecoEntrega = { cep };
    if (bairro) {
      const rec = cep ? await reconciliarBairroCep(cep, bairro) : null;
      endereco.bairro =
        rec?.reconciliado && rec.bairroCanonico != null
          ? rec.bairroCanonico
          : null;
    }

    // 4) Reusa a MESMA lib do recálculo autoritativo (RN-C4 + paridade preview↔real).
    //    subtotal = 0: preview não tem itens confirmados ainda; nunca grátis por subtotal.
    const resultado = calcularFrete(
      zonas,
      endereco,
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
