// Forma de frete ATIVA da loja (issue 325) — módulo PURO, sem React e sem I/O.
//
// A forma é um FATO das zonas gravadas (`zonas_entrega.tipo`), não uma coluna
// própria: uma segunda fonte de verdade divergiria do `tipo` com qualquer
// escrita direta ou legado, e a vitrine continua cobrando pelo `tipo`
// (`calcularFrete`). Aqui só se deriva o que a tela mostra e quando ela pede
// confirmação. A exclusividade de forma é garantida na RPC
// `salvar_zonas_entrega` (DELETE de todos os tipos + INSERT só da forma).
//
// FORA DAQUI: cálculo do frete, validação de payload, persistência.

export const FORMAS_FRETE = ["raio_km", "faixa_cep", "bairro"] as const;
export type FormaFrete = (typeof FORMAS_FRETE)[number];
export type FormaGravada = FormaFrete | "nenhuma" | "mista";

/** Rótulo de título (seletor, cartões). */
export const ROTULO_FORMA: Record<FormaFrete, string> = {
  raio_km: "Faixas de distância (km)",
  faixa_cep: "Faixas de CEP",
  bairro: "Bairros",
};

/** O mesmo rótulo no meio de frase ("a vitrine passa a cobrar por faixas de CEP"). */
export const ROTULO_FORMA_FRASE: Record<FormaFrete, string> = {
  raio_km: "faixas de distância (km)",
  faixa_cep: "faixas de CEP",
  bairro: "bairros",
};

function ehFormaFrete(tipo: string): tipo is FormaFrete {
  return (FORMAS_FRETE as readonly string[]).includes(tipo);
}

/**
 * [] → "nenhuma"; todos do mesmo tipo → esse tipo; tipos diferentes → "mista".
 * Conta zonas inativas também: elas saem na próxima gravação. Tipo fora do enum
 * não acontece (CHECK em `zonas_entrega.tipo`); se acontecer, conta como mista
 * para a tela pedir confirmação antes de substituir.
 */
export function formaGravadaDasZonas(zonas: ReadonlyArray<{ tipo: string }>): FormaGravada {
  if (zonas.length === 0) return "nenhuma";
  const primeiro = zonas[0].tipo;
  if (!ehFormaFrete(primeiro)) return "mista";
  return zonas.every((z) => z.tipo === primeiro) ? primeiro : "mista";
}

/** Forma marcada ao abrir: a gravada; "nenhuma" e "mista" → faixas de km (decisão do Pedido). */
export function formaInicialDaTela(gravada: FormaGravada): FormaFrete {
  return gravada === "nenhuma" || gravada === "mista" ? "raio_km" : gravada;
}

/**
 * A primeira gravação nesta forma substitui algo que vale hoje na vitrine?
 * Loja sem zonas nunca pergunta; forma diferente da gravada sempre pergunta; km
 * gravado fora do formato de faixas (legado) também pergunta (D4 da 326).
 */
export function precisaConfirmarSubstituicao(
  formaEditor: FormaFrete,
  gravada: FormaGravada,
  kmForaDoFormato: boolean,
): boolean {
  if (gravada === "nenhuma") return false;
  if (gravada !== formaEditor) return true;
  return formaEditor === "raio_km" && kmForaDoFormato;
}
