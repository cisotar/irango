// Classificação da CAUSA do frete indisponível (issue 003, RN-2-C).
//
// Função PURA, sem I/O — fonte única consumida por `calcularFreteAction` (005)
// para decidir a MENSAGEM ao cliente: "a loja tem zona raio_km ativa mas está
// sem coords" (misconfiguração — nenhum endereço resolveria) é diferente de
// "endereço genuinamente fora de área" (trocar de endereço pode resolver).
//
// NÃO decide taxa nem altera `calcularFrete` (o cálculo do valor permanece
// intacto: já degrada para fallback/indisponível corretamente). Aqui só
// classificamos a causa. As coords entram como BOOLEANO derivado no servidor —
// nunca o par (lat,lng) cru (seguranca.md §19).

import type { ZonaComTaxa } from "./calcularFrete";

/**
 * Veredito de preview (005) quando a loja tem zona por raio mas está sem coords.
 * Constante COMPARTILHADA entre a Server Action (`calcularFreteAction`) e a UI
 * (`EtapaEntrega`) para que o literal não divirja silenciosamente entre os dois
 * lados — um typo viraria runtime, não erro de compilação.
 */
export const VEREDITO_LOJA_SEM_COORDS = "indisponivel_loja";

/**
 * `true` quando a loja depende de raio para entregar mas não tem coordenadas:
 * existe ao menos uma zona `tipo === "raio_km"` ATIVA e COM taxa, e a loja está
 * sem coords (`temCoords === false`). Nesse estado, a zona raio nunca casa
 * (`distanciaKm` indefinido) e a mensagem "tente outro endereço" enganaria o
 * cliente — nenhum endereço resolveria a falta de coords da loja.
 *
 * Espelha o predicado de `zonaAtende` (calcularFrete): só conta zona ativa e com
 * taxa, como o cálculo do valor — assim a classificação não diverge do cálculo.
 */
export function lojaTemRaioSemCoords(
  zonas: ZonaComTaxa[],
  temCoords: boolean,
): boolean {
  if (temCoords) return false;
  return zonas.some(
    (z) => z.tipo === "raio_km" && z.ativo && z.taxa != null,
  );
}

// ─────────────────────────── STUB TDD (fase RED, issue 180-B) ───────────────
// A implementação real é da fase GREEN (`executar`), conforme plan/180-B §D3.
// Aqui só o CONTRATO: assinatura + constantes, para que o RED falhe na ASSERÇÃO
// e não na resolução do import.

import type { CausaDistancia } from "@/lib/actions/distanciaFrete";
import type { ResultadoFrete } from "./calcularFrete";

/** Frete não pôde ser calculado; o canal pode voltar — a UI retenta (10s/20s). */
export const VEREDITO_A_COMBINAR_RETRIAVEL = "a_combinar_retriavel";
/** Orçamento/credencial esgotados — retentar AGORA não adianta, sem retry. */
export const VEREDITO_A_COMBINAR_ESGOTADO = "a_combinar_esgotado";
/** O CEP não foi localizado — pede conferir o CEP, sem retry. */
export const VEREDITO_A_COMBINAR_CEP = "a_combinar_cep";

export type VereditoACombinar =
  | typeof VEREDITO_A_COMBINAR_RETRIAVEL
  | typeof VEREDITO_A_COMBINAR_ESGOTADO
  | typeof VEREDITO_A_COMBINAR_CEP;

export type VereditoFrete =
  | { tipo: "ok" }
  | { tipo: "a_combinar"; veredito: VereditoACombinar }
  | {
      tipo: "indisponivel";
      veredito: "indisponivel" | typeof VEREDITO_LOJA_SEM_COORDS;
    };

/**
 * STUB TDD — `true` quando existe ao menos uma zona `raio_km` ATIVA e COM taxa,
 * isto é, quando a distância ERA necessária para calcular o frete. Espelha o
 * predicado de `zonaAtende` para não divergir do cálculo.
 */
export function distanciaEraNecessaria(_zonas: ZonaComTaxa[]): boolean {
  throw new Error("TODO: GREEN (180-B)");
}

/**
 * STUB TDD — fonte ÚNICA da decisão "ok × a combinar × indisponível", consumida
 * pelo preview (`calcularFreteAction`) e pelo autoritativo (`criarPedido`).
 *
 * a_combinar ⟺ causa ∈ {nao_encontrado, transitorio, esgotado, erro,
 *                       loja_sem_coords}
 *            ∧ resultado.zonaId == null
 *            ∧ distanciaEraNecessaria(zonas)
 *
 * O veredito a-combinar PRECEDE o fallback fora-de-zona (inversão deliberada).
 */
export function classificarFrete(_args: {
  resultado: ResultadoFrete;
  zonas: ZonaComTaxa[];
  causaDistancia: CausaDistancia;
  temCoordsLoja: boolean | null;
}): VereditoFrete {
  throw new Error("TODO: GREEN (180-B)");
}
