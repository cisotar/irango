// Forma de frete ATIVA da loja (issue 325) — módulo PURO, sem React e sem I/O.
//
// A forma ativa é a coluna `lojas.forma_frete` (migration 20261018130000). O
// app só a grava pela RPC `definir_forma_frete` (botão "Usar esta forma", junto
// da versão otimista; migration 20261018140000) e pela legada
// `salvar_faixas_entrega`; a RLS de `lojas` ainda permite ao dono gravá-la
// direto na própria loja (ver issue 363). Salvar as zonas de uma forma NÃO a
// ativa. As zonas das três formas ficam guardadas lado a lado; só as da forma
// ativa cobram. O filtro do frete mora em
// `listarZonasComTaxas(client, lojaId, forma)`; aqui só se estreita o valor do
// banco para o enum e se separa as zonas por forma para a tela.
//
// FORA DAQUI: cálculo do frete, validação de payload, persistência.

import type { ZonaResumo } from "@/lib/utils/modalidadesEntrega";
import type { DadosZonasSemVersao, FormaZonasEntrega } from "@/lib/validacoes/entrega";

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

/**
 * Zonas que a forma passa a ter depois de gravar `payload`, no formato que
 * `entregaDisponivel`/`temZonaQueCobra` leem. A RPC regrava as zonas da forma exatamente com as
 * faixas/grupos do payload, cada uma com a sua taxa: o payload aceito É a lista
 * efetiva, sem precisar recarregar a página.
 */
export function zonasResumoDoPayload(payload: DadosZonasSemVersao): ZonaResumo[] {
  const itens = payload.forma === "bairro" ? payload.grupos : payload.faixas;
  return itens.map(({ ativo, taxa }) => ({ ativo, taxa }));
}

/**
 * A gravação neste editor substitui algo que o lojista não vê como tabela? Só
 * no km com zonas gravadas fora do formato de faixas (legado, D4 da 326), na
 * primeira gravação e enquanto o lojista não confirmou. Trocar de forma não
 * pergunta nada: as zonas da forma anterior ficam guardadas (325).
 */
export function precisaConfirmarSubstituicao(estado: {
  kmForaDoFormato: boolean;
  jaGravou: boolean;
  confirmou: boolean;
}): boolean {
  return estado.kmForaDoFormato && !estado.jaGravou && !estado.confirmou;
}
