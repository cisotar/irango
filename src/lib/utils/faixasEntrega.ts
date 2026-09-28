// Tabela de faixas de entrega (issue 326) — funções PURAS da tela de Entregas.
//
// `lerFaixas` abre as zonas atuais da loja como faixas de km SEM mudar preço:
// o preço de cada faixa é o que `calcularFrete` (fonte única do frete, D3)
// cobra na distância = teto da faixa. Nada é gravado aqui; só o Salvar grava,
// pela RPC `salvar_faixas_entrega`, que rederiva teto/nome/tipo no servidor.
//
// Os demais helpers são só APRESENTAÇÃO (rótulo, limite, alerta de preço fora
// de ordem C1, texto do limite D7). Nenhum é autoridade de valor.

import { calcularFrete, type ZonaComTaxa } from "./calcularFrete";
import { formatarMoeda } from "./formatarMoeda";
import {
  TETO_FAIXAS_ENTREGA,
  type DadosFaixasEntrega,
} from "@/lib/validacoes/entrega";

export type IncrementoFaixa = DadosFaixasEntrega["incremento"];
export type FaixaEntrega = DadosFaixasEntrega["faixas"][number];

type ZonaNomeada = ZonaComTaxa & { nome: string };

export type LeituraFaixas = {
  modo: "faixas" | "legado";
  incremento: IncrementoFaixa;
  faixas: FaixaEntrega[];
  /** No legado, TODAS as zonas atuais; em "faixas", as inativas (que somem no Salvar). */
  zonasNoAviso: Array<{ id: string; nome: string }>;
};

const resumo = (z: ZonaNomeada) => ({ id: z.id, nome: z.nome });

/**
 * Zonas atuais → estado inicial da tabela (D4, C4).
 *  - nenhuma zona ATIVA → tabela vazia, incremento 1, sem aviso;
 *  - ativas todas `raio_km`, com taxa e teto inteiro ≥ 1, e o resultado cabe em
 *    30 faixas → expande em faixas de 1 km (2 km se todos os tetos são pares);
 *    inativas não entram e vão para o aviso;
 *  - qualquer outra coisa → "legado": tabela vazia + aviso com todas as zonas.
 */
export function lerFaixas(zonas: ZonaNomeada[]): LeituraFaixas {
  const ativas = zonas.filter((z) => z.ativo);
  if (ativas.length === 0) {
    return { modo: "faixas", incremento: 1, faixas: [], zonasNoAviso: [] };
  }

  const legado: LeituraFaixas = {
    modo: "legado",
    incremento: 1,
    faixas: [],
    zonasNoAviso: zonas.map(resumo),
  };

  const tetos: number[] = [];
  for (const z of ativas) {
    const teto = z.taxa?.raio_max_km;
    if (z.tipo !== "raio_km" || teto == null || !Number.isInteger(teto) || teto < 1) {
      return legado;
    }
    tetos.push(teto);
  }

  const incremento: IncrementoFaixa = tetos.every((t) => t % 2 === 0) ? 2 : 1;
  const quantidade = Math.max(...tetos) / incremento;
  if (quantidade > TETO_FAIXAS_ENTREGA) return legado;

  const porId = new Map(ativas.map((z) => [z.id, z]));
  const faixas: FaixaEntrega[] = [];
  for (let i = 1; i <= quantidade; i += 1) {
    // calcularFrete decide QUAL zona cobra nesta distância (faixa exclusiva,
    // desempate RN-C8); a faixa herda a taxa e o grátis crus dessa zona.
    const { zonaId } = calcularFrete(ativas, { distanciaKm: i * incremento }, 0);
    const taxa = zonaId == null ? null : porId.get(zonaId)?.taxa;
    if (taxa == null) return legado;
    faixas.push({ taxa: taxa.taxa, pedido_minimo_gratis: taxa.pedido_minimo_gratis });
  }

  return {
    modo: "faixas",
    incremento,
    faixas,
    zonasNoAviso: zonas.filter((z) => !z.ativo).map(resumo),
  };
}

/**
 * As zonas gravadas já estão no formato que a RPC `salvar_faixas_entrega`
 * grava (todas ativas, `raio_km`, uma por faixa, nome derivado da posição)?
 * Se não — zonas cadastradas pelo formulário antigo, de bairro/CEP ou com
 * alguma inativa —, o 1º Salvar da tabela as SUBSTITUI (D4/C4) e a tela pede
 * confirmação. Sem zonas não há o que substituir: `true`.
 */
export function zonasJaSaoFaixas(zonas: ZonaNomeada[]): boolean {
  const leitura = lerFaixas(zonas);
  if (leitura.modo !== "faixas" || leitura.zonasNoAviso.length > 0) return false;
  if (zonas.length !== leitura.faixas.length) return false;

  const tetos = new Set<number>();
  for (const z of zonas) {
    const teto = z.taxa?.raio_max_km;
    if (teto == null) return false;
    if (z.nome !== rotuloFaixa(teto / leitura.incremento - 1, leitura.incremento)) return false;
    tetos.add(teto);
  }
  return tetos.size === zonas.length;
}

/** "de–até km" (en dash) da faixa na posição `indice` (0-based). */
export function rotuloFaixa(indice: number, incremento: IncrementoFaixa): string {
  return `${indice * incremento}–${(indice + 1) * incremento} km`;
}

/** Teto da última faixa; null sem faixas (estado vazio). */
export function limiteEntregaKm(quantidade: number, incremento: IncrementoFaixa): number | null {
  return quantidade > 0 ? quantidade * incremento : null;
}

/**
 * C1 (não bloqueante): se a faixa `indice` custa MENOS que a mais cara entre as
 * anteriores, devolve o aviso citando essa faixa (empate → a mais próxima).
 */
export function alertaDePreco(
  faixas: { taxa: number }[],
  indice: number,
  incremento: IncrementoFaixa,
): string | null {
  const atual = faixas[indice];
  if (atual == null || indice === 0) return null;

  let maisCara = 0;
  for (let j = 1; j < indice; j += 1) {
    if (faixas[j].taxa >= faixas[maisCara].taxa) maisCara = j;
  }
  const maior = faixas[maisCara].taxa;
  if (atual.taxa >= maior) return null;

  return (
    `Confira o preço: está menor que o da faixa de ${rotuloFaixa(maisCara, incremento)} (${formatarMoeda(maior)}). ` +
    `Quem está a ${rotuloFaixa(indice, incremento)} vai pagar ${formatarMoeda(atual.taxa)}.`
  );
}

/** D7: texto do limite derivado do estado real (faixas e taxa fora da zona). */
export function textoLimiteEntrega(limiteKm: number | null, taxaForaZona: number | null): string {
  if (limiteKm == null) {
    return taxaForaZona == null
      ? "Sem faixa cadastrada, a vitrine mostra entrega indisponível — só retirada."
      : `Sem faixa cadastrada, a vitrine cobra ${formatarMoeda(taxaForaZona)} (fora da área) em qualquer distância.`;
  }
  const acima =
    taxaForaZona == null
      ? "Acima disso, a vitrine mostra “fora da área de entrega”."
      : `Acima disso cobra ${formatarMoeda(taxaForaZona)} (fora da área).`;
  return `Você entrega até ${limiteKm} km. ${acima}`;
}
