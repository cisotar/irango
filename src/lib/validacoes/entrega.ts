// Schemas de ENTREGA — validam a FORMA da config de entrega do lojista no
// cadastro (lojista é cliente não-confiável tanto quanto o comprador):
//   - schemaZona   → zonas_entrega (nome, tipo enum, ativo)
//   - schemaTaxa   → taxas_entrega (taxa, pedido_minimo_gratis, raio_max_km,
//                    cep_inicio, cep_fim — a faixa espelha o CHECK
//                    `taxas_faixa_cep_coerente` da migration 20260615011000)
//   - schemaBairro → bairros_zona (nome)
// FORA daqui: cálculo de frete, match de zona por endereço, RLS/unicidade.
import { z } from "zod";

const nomeObrigatorio = z.string().trim().min(1);

export const schemaZona = z.object({
  nome: nomeObrigatorio,
  tipo: z.enum(["bairro", "raio_km", "faixa_cep"]),
  ativo: z.boolean(),
});

/** CEP como inteiro de até 8 dígitos ("01000-000" → 1000000). Conversão da
 *  máscara é do form (`payloadZona.ts`), não do schema. */
const cepInteiro = z.number().int().min(0).max(99999999).nullable().default(null);

/**
 * Valor de frete em reais: não-negativo e com centavos. CRÍTICO: taxa negativa
 * abriria valor de entrega que reduz o total. Regra única, reusada pela taxa da
 * zona e por quem mais gravar um valor de frete (frete combinado, spec
 * modalidades-entrega-loja), que só acrescenta o próprio teto.
 */
export const valorFrete = z.number().min(0).multipleOf(0.01);

export const schemaTaxa = z
  .object({
    taxa: valorFrete,
    pedido_minimo_gratis: z.number().min(0).nullable(),
    raio_max_km: z.number().positive().nullable(),
    // Faixa de CEP (issue 183). `.nullable().default(null)` mantém compat com
    // payload legado (zona bairro/raio_km não manda as chaves).
    cep_inicio: cepInteiro,
    cep_fim: cepInteiro,
  })
  .superRefine((taxa, ctx) => {
    // Espelho do CHECK `taxas_faixa_cep_coerente`: par tudo-ou-nada.
    if ((taxa.cep_inicio == null) !== (taxa.cep_fim == null)) {
      ctx.addIssue({
        code: "custom",
        path: ["cep_fim"],
        message: "Informe o CEP inicial e o CEP final da faixa.",
      });
      return;
    }
    // Faixa inclusiva: cep_inicio === cep_fim é uma faixa de um CEP só.
    if (
      taxa.cep_inicio != null &&
      taxa.cep_fim != null &&
      taxa.cep_inicio > taxa.cep_fim
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["cep_fim"],
        message: "O CEP final deve ser maior ou igual ao CEP inicial.",
      });
    }
  });

export const schemaBairro = z.object({
  nome: nomeObrigatorio,
});

// ─── Modalidades de entrega da loja (spec modalidades-entrega-loja) ─────────
// ISOMÓRFICO: gate de UX no form e autoridade na Server Action (lojista e
// admin). Espelha no zod os dois CHECKs de `lojas` para recusar ANTES de
// qualquer I/O: `lojas_modo_frete_check` (enum) e
// `lojas_ao_menos_uma_modalidade` (superRefine). Chave extra é descartada pelo
// zod e, de novo, pela allowlist `montarPatchModalidades` (patches-loja.ts).
export const MODOS_FRETE = ["automatico", "a_combinar"] as const;
export type ModoFrete = (typeof MODOS_FRETE)[number];

export const MENSAGEM_AO_MENOS_UMA_MODALIDADE =
  "Deixe ligada pelo menos a retirada ou a entrega.";

export const schemaModalidadesEntrega = z
  .object({
    aceita_retirada: z.boolean(),
    aceita_entrega: z.boolean(),
    modo_frete: z.enum(MODOS_FRETE),
  })
  .superRefine((m, ctx) => {
    if (!m.aceita_retirada && !m.aceita_entrega) {
      ctx.addIssue({
        code: "custom",
        path: ["aceita_entrega"],
        message: MENSAGEM_AO_MENOS_UMA_MODALIDADE,
      });
    }
  });

export type DadosModalidadesEntrega = z.infer<typeof schemaModalidadesEntrega>;

// ─── Registro do frete combinado (spec modalidades-entrega-loja, D1/D2/D3) ──
// ISOMÓRFICO: gate de UX no form do detalhe e autoridade nas duas Server
// Actions (lojista `registrarFreteCombinado` e admin
// `registrarFreteCombinadoAdmin`). `.strict()`: o payload só pode carregar o
// pedido e o valor — `desconto`/`subtotal`/`total`/`frete_a_combinar` extras
// são RECUSADOS (não descartados), porque o total é recalculado do banco.
/** D3: teto de sanidade do frete combinado, em reais. */
export const TETO_FRETE_COMBINADO = 1000;

export const schemaRegistroFreteCombinado = z
  .object({
    pedidoId: z.guid(),
    valor: valorFrete.max(TETO_FRETE_COMBINADO),
  })
  .strict();

// Payload completo do form de zona (issue 046): zona + taxa (1:1) + bairros
// (1:N) num só envio. ISOMÓRFICO — usado no client (gate de UX) e revalidado
// na Server Action (autoridade). FORA daqui: loja_id/zona_id (derivados no
// servidor), unicidade/RLS.
// ATENÇÃO: o `.superRefine` vem DEPOIS do `.extend` — a instância refinada não
// é mais extensível. Só este nível enxerga `tipo`, então a obrigatoriedade da
// faixa condicionada ao tipo da zona mora aqui (issue 183).
export const schemaZonaCompleta = schemaZona
  .extend({
    taxa: schemaTaxa,
    bairros: z.array(nomeObrigatorio).default([]),
  })
  .superRefine((zona, ctx) => {
    const temFaixa = zona.taxa.cep_inicio != null && zona.taxa.cep_fim != null;
    if (zona.tipo === "faixa_cep" && !temFaixa) {
      ctx.addIssue({
        code: "custom",
        path: ["taxa", "cep_inicio"],
        message: "Zona por faixa de CEP exige o CEP inicial e o final.",
      });
      return;
    }
    // Faixa órfã: zona de bairro/raio não pode carregar faixa (troca de tipo).
    if (zona.tipo !== "faixa_cep" && temFaixa) {
      ctx.addIssue({
        code: "custom",
        path: ["taxa", "cep_inicio"],
        message: "Faixa de CEP só se aplica a zonas do tipo faixa de CEP.",
      });
    }
  });
