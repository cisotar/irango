// Forma de frete ATIVA da loja (issue 325) — módulo PURO, sem React e sem I/O.
//
// A forma ativa é a coluna `lojas.forma_frete` (migration 20261018130000),
// gravada SÓ pela RPC `salvar_zonas_entrega` junto da versão otimista: salvar
// as zonas de uma forma = ativar essa forma. As zonas das três formas ficam
// guardadas lado a lado; só as da forma ativa cobram. O filtro do frete mora em
// `listarZonasComTaxas(client, lojaId, forma)`; aqui só se estreita o valor do
// banco para o enum e se separa as zonas por forma para a tela.
//
// FORA DAQUI: cálculo do frete, validação de payload, persistência.

import type { FormaZonasEntrega } from "@/lib/validacoes/entrega";

/** A forma é a do payload de zonas (`schemaZonasEntrega`): uma fonte só. */
export type FormaFrete = FormaZonasEntrega;

/** Ordem do seletor. `satisfies` recusa forma fora do payload; `ROTULO_FORMA` (Record) exige rótulo para todas. */
export const FORMAS_FRETE = ["raio_km", "faixa_cep", "bairro"] as const satisfies readonly FormaFrete[];

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

/** Rótulo de `zonas_entrega.tipo` (lista de zonas atuais); tipo fora do enum aparece cru. */
export function rotuloDoTipo(tipo: string): string {
  return ehFormaFrete(tipo) ? ROTULO_FORMA[tipo] : tipo;
}

/**
 * `lojas.forma_frete` estreitado para o enum. null/undefined (coluna fora do
 * select, banco antes da migration) ou valor fora do enum → "raio_km", a forma
 * padrão de loja nova.
 */
export function formaAtivaDaLoja(valor: string | null | undefined): FormaFrete {
  return valor != null && ehFormaFrete(valor) ? valor : "raio_km";
}

/** Só as zonas da forma pedida, na ordem recebida, os mesmos objetos (inclusive inativas). */
export function zonasDaForma<T extends { tipo: string }>(zonas: readonly T[], forma: FormaFrete): T[] {
  return zonas.filter((z) => z.tipo === forma);
}

/** Forma marcada ao abrir a tela: a ATIVA da loja (não a derivada das zonas guardadas). */
export function formaInicialDaTela(forma_frete: string | null | undefined): FormaFrete {
  return formaAtivaDaLoja(forma_frete);
}

/**
 * A primeira gravação neste editor substitui algo que o lojista não vê como
 * tabela? Só no km com zonas gravadas fora do formato de faixas (legado, D4 da
 * 326). Trocar de forma não pergunta nada: as zonas da forma anterior ficam
 * guardadas (325).
 */
export function precisaConfirmarSubstituicao(formaEditor: FormaFrete, kmForaDoFormato: boolean): boolean {
  return formaEditor === "raio_km" && kmForaDoFormato;
}
