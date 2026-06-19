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
