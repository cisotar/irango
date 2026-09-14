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
//     vitrine_lojas têm RLS pública e seguem ANON. EXCEÇÃO documentada (007, §19):
//     as coords da loja NÃO têm SELECT anon, então a distância por raio é obtida
//     via service_role — mas SÓ para as 2 colunas de coords, através do helper
//     neutro distanciaDaLojaAoCep. Zonas/loja jamais regridem para service_role.
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
import { createServiceClient } from "@/lib/supabase/service";
import { distanciaDaLojaAoCep } from "@/lib/actions/distanciaFrete";
import { extrairIp, verificarRateLimit } from "@/lib/utils/rateLimit";
import { listarZonasComTaxas } from "@/lib/supabase/queries/entregaPagamento";
import { buscarCoordsLoja, buscarLojaPublicaPorId } from "@/lib/supabase/queries/lojas";
import { calcularFrete, type EnderecoEntrega } from "@/lib/utils/calcularFrete";
import {
  classificarFrete,
  type VereditoACombinar,
} from "@/lib/utils/freteDegradado";
import {
  resolverCepServidor,
  type ResolucaoCep,
} from "@/lib/utils/resolverCepServidor";

// Schema zod .strict(): rejeita qualquer campo que não seja loja_id + bairro +
// cep — impede injeção de taxa_preview, subtotal, etc. pelo cliente.
// z.guid() (não z.uuid()): valida formato uuid sem exigir nibbles de versão/variante
// RFC-4122 — alinhado com schemaCheckout e schemaPayloadPedido do projeto.
// (067) cep é OPCIONAL (espelha o autoritativo, onde endereco.cep pode faltar):
// usado para reconciliar o bairro CANÔNICO (ViaCEP) e para casar zonas
// tipo='faixa_cep'. Regex tolera com/sem máscara (mesma de pedido.ts:64) — CEP
// malformado (ex.: "1") não pode alcançar zonaAtende/faixa_cep sem passar pelo
// ViaCEP, senão o preview casaria uma faixa que o autoritativo rejeitaria
// (achado BAIXA auditoria 183: quebra de paridade preview↔cobrança).
const schemaFretePreview = z
  .object({
    loja_id: z.guid(),
    bairro: z.string().trim().min(1).optional(),
    cep: z.string().trim().regex(/^\d{5}-?\d{3}$/).optional(),
  })
  .strict()
  // Pelo menos um critério de endereço (bairro p/ zona tipo='bairro' OU cep p/
  // tipo='faixa_cep'); payload só com loja_id não tem o que calcular.
  .refine((d) => d.bairro != null || d.cep != null, {
    message: "Informe bairro ou CEP.",
  });

/**
 * (180-B/D5) A variante `a_combinar` é uma TERCEIRA VARIANTE DO UNION, não mais
 * um literal em `zona_nome`: um consumidor que esqueça o caso quebra no
 * type-check em vez de exibir um rótulo cru (ou, pior, um valor de frete que a
 * loja nunca vai cobrar). `veredito` é só um ENUM — nenhum par (lat,lng),
 * nenhum km e nenhum detalhe técnico da causa atravessa (§19/§14).
 */
export type ResultadoFretePreview =
  | { ok: true; taxa_preview: number; zona_nome: string }
  | { ok: true; a_combinar: true; veredito: VereditoACombinar }
  | { ok: false; erro: string };

/**
 * Preview de frete para o wizard de checkout (Etapa Entrega — issue 075).
 *
 * Recebe { loja_id, bairro } do cliente. Recalcula a taxa do BANCO — nunca do
 * cliente. Retorna shape estável:
 *   - bairro em zona  → { ok:true, taxa_preview, zona_nome: <nome da zona> }
 *   - fora + fallback → { ok:true, taxa_preview, zona_nome: 'fora_zona' }
 *   - fora + sem fal  → { ok:true, taxa_preview: 0, zona_nome: 'indisponivel' }
 *   - CEP INEXISTENTE (ViaCEP afirmou) + sem fallback → { ok:true,
 *     taxa_preview: 0, zona_nome: 'indisponivel_cep' } — a causa é o CEP, não o
 *     bairro; dizer "não atendemos seu bairro" aqui seria mentir (auditoria
 *     180-B, achado 1)
 *   - distância necessária e DESCONHECIDA (geocoding caído/esgotado/CEP não
 *     localizado) → { ok:true, a_combinar:true, veredito } — NUNCA um número
 *     (180-B): cobrar o fallback fora-de-zona aqui seria cobrar o cliente por
 *     uma falha de infraestrutura nossa
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
    //     (185) A resolução do CEP é MEMOIZADA e serve dois consumidores: o
    //     bairro canônico aqui e a consulta de geocoding em 3c. É um thunk, não
    //     uma chamada eager — sem bairro declarado e com cache de coords quente,
    //     o ViaCEP não é tocado nenhuma vez.
    //     (180-B/achado 1) O thunk repassa a `ResolucaoCep` INTEIRA: é por
    //     dentro dela que "o CEP não existe" chega ao geocoder distinto de "o
    //     ViaCEP caiu". Sem CEP o thunk nem vai ao ViaCEP — o motivo é
    //     irrelevante nesse ramo (`distanciaDaLojaAoCep` curto-circuita em
    //     `sem_cep` antes de invocá-lo) e a reconciliação só lê `endereco`.
    let promessaCep: Promise<ResolucaoCep> | undefined;
    const resolverCep = (): Promise<ResolucaoCep> =>
      cep
        ? (promessaCep ??= resolverCepServidor(cep))
        : Promise.resolve({ endereco: null, motivo: "transitorio" });

    const endereco: EnderecoEntrega = { cep };
    if (bairro) {
      const resolucao = await resolverCep();
      // Fail-closed da 064 INTACTO: sem endereço canônico (qualquer motivo), o
      // bairro declarado pelo cliente é descartado.
      endereco.bairro = resolucao.endereco?.bairro ?? null;
    }

    // 3c) (007) Distância por raio — paridade EXATA com o autoritativo (criarPedido,
    //     pedido.ts). Mesmo helper neutro, mesma assinatura: (svc, loja_id, cep). O
    //     service_role é usado SÓ para as 2 colunas de coords (sem SELECT anon, §19);
    //     o helper é fail-closed (undefined em qualquer falha/pré-condição ausente).
    //     distanciaKm jamais vem do cliente — derivado 100% no servidor (RN-4).
    //     (180-B) O retorno é discriminado: a CAUSA da ausência de distância é
    //     o que impede o fallback fora-de-zona de ser cobrado por uma falha de
    //     infraestrutura nossa. `km` só é number quando a distância é REAL.
    const svc = createServiceClient();
    const distancia = await distanciaDaLojaAoCep(svc, loja_id, cep, resolverCep, ip);
    if (distancia.causa === "ok") endereco.distanciaKm = distancia.km;

    // 4) Reusa a MESMA lib do recálculo autoritativo (RN-C4 + paridade preview↔real).
    //    subtotal = 0: preview não tem itens confirmados ainda; nunca grátis por subtotal.
    const resultado = calcularFrete(
      zonas,
      endereco,
      0,
      loja?.taxa_entrega_fora_zona,
    );

    // 5) (180-B) Classificação ÚNICA, a MESMA consumida pelo autoritativo
    //    (`criarPedido`) — é o que impede preview e cobrança de divergirem
    //    (RN-7). O veredito a-combinar PRECEDE o fallback fora-de-zona.
    //
    //    (005, RN-2-C) `temCoordsLoja` só importa no ramo `sem_cep`, para
    //    distinguir MISCONFIGURAÇÃO (loja com zona raio ativa mas sem coords —
    //    nenhum endereço resolveria) de endereço genuinamente fora de área.
    //    Consultado SÓ nesse ramo: service_role, e apenas o BOOLEANO de
    //    presença — o par (lat,lng) nunca chega à UX (§19).
    const temCoordsLoja =
      distancia.causa === "sem_cep"
        ? (await buscarCoordsLoja(svc, loja_id)) !== null
        : null;

    const veredito = classificarFrete({
      resultado,
      zonas,
      causaDistancia: distancia.causa,
      temCoordsLoja,
    });

    if (veredito.tipo === "a_combinar") {
      // Nenhum valor é exibido: "a combinar" não é R$ 0,00 nem frete grátis.
      return { ok: true, a_combinar: true, veredito: veredito.veredito };
    }

    // 6) Mapeia ResultadoFrete → shape de preview para o cliente.
    if (veredito.tipo === "indisponivel") {
      return { ok: true, taxa_preview: 0, zona_nome: veredito.veredito };
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
