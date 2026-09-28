// Tabela de faixas de entrega (issue 326) — funções PURAS da tela de Entregas.
//
// `lerFaixas` abre as zonas atuais da loja como faixas de km SEM mudar preço:
// o preço de cada faixa é o que `calcularFrete` (fonte única do frete, D3)
// cobra na distância = teto da faixa (ou, no formato já gravado pela RPC, o
// preço e o `ativo` de cada zona). Nada é gravado aqui; a tela grava pela RPC
// `salvar_faixas_entrega`, que rederiva teto/nome/tipo no servidor.
//
// Os demais helpers são só APRESENTAÇÃO e edição local (rótulo, limite,
// alerta de preço fora de ordem C1, texto do limite D7, switch/lixeira C2'/C3').
// Nenhum é autoridade de valor.

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
 * Zonas no FORMATO GRAVADO pela RPC `salvar_faixas_entrega` (D4 ajuste, it. 2):
 * todas `raio_km` com taxa; ordenadas por teto, o 1º teto ∈ {1,2} é o
 * incremento e o i-ésimo é (i+1)×inc; nome === rotuloFaixa(i, inc); ativas em
 * prefixo. Abre UMA faixa por zona com o `ativo` dela — inclusive desligadas,
 * para reabrir a tela com os preços que o lojista gravou. null se não casa.
 */
function lerFormatoGravado(zonas: ZonaNomeada[]): LeituraFaixas | null {
  if (zonas.length === 0 || zonas.length > TETO_FAIXAS_ENTREGA) return null;
  if (zonas.some((z) => z.tipo !== "raio_km" || z.taxa?.raio_max_km == null)) return null;

  const ordenadas = [...zonas].sort(
    (a, b) => (a.taxa?.raio_max_km ?? 0) - (b.taxa?.raio_max_km ?? 0),
  );
  const primeiroTeto = ordenadas[0].taxa?.raio_max_km;
  if (primeiroTeto !== 1 && primeiroTeto !== 2) return null;
  const incremento: IncrementoFaixa = primeiroTeto;

  const faixas: FaixaEntrega[] = [];
  let viuDesligada = false;
  for (const [i, z] of ordenadas.entries()) {
    const taxa = z.taxa;
    if (taxa == null || taxa.raio_max_km !== (i + 1) * incremento) return null;
    if (z.nome !== rotuloFaixa(i, incremento)) return null;
    if (z.ativo && viuDesligada) return null;
    if (!z.ativo) viuDesligada = true;
    faixas.push({ taxa: taxa.taxa, pedido_minimo_gratis: taxa.pedido_minimo_gratis, ativo: z.ativo });
  }
  return { modo: "faixas", incremento, faixas, zonasNoAviso: [] };
}

/**
 * Zonas atuais → estado inicial da tabela (D4, C4).
 *  - formato gravado pela RPC → uma faixa por zona, com o `ativo` de cada;
 *  - nenhuma zona ATIVA → tabela vazia, incremento 1, sem aviso;
 *  - ativas todas `raio_km`, com taxa e teto inteiro ≥ 1, e o resultado cabe em
 *    30 faixas → expande em faixas de 1 km (2 km se todos os tetos são pares),
 *    todas ativas; inativas não entram e vão para o aviso;
 *  - qualquer outra coisa → "legado": tabela vazia + aviso com todas as zonas.
 */
export function lerFaixas(zonas: ZonaNomeada[]): LeituraFaixas {
  const gravado = lerFormatoGravado(zonas);
  if (gravado != null) return gravado;

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
    faixas.push({ taxa: taxa.taxa, pedido_minimo_gratis: taxa.pedido_minimo_gratis, ativo: true });
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
 * grava (ver `lerFormatoGravado`, inclusive com o final desligado)? Se não —
 * zonas do formulário antigo, de bairro/CEP ou com buraco —, a 1ª gravação da
 * tabela as SUBSTITUI (D4/C4) e a tela pede confirmação. Sem zonas não há o
 * que substituir: `true`.
 */
export function zonasJaSaoFaixas(zonas: ZonaNomeada[]): boolean {
  return zonas.length === 0 || lerFormatoGravado(zonas) != null;
}

/** "de–até km" (en dash) da faixa na posição `indice` (0-based). */
export function rotuloFaixa(indice: number, incremento: IncrementoFaixa): string {
  return `${indice * incremento}–${(indice + 1) * incremento} km`;
}

/** Teto da última faixa ATIVA; null sem nenhuma ativa (não entrega). */
export function limiteEntregaKm(
  faixas: ReadonlyArray<{ ativo: boolean }>,
  incremento: IncrementoFaixa,
): number | null {
  const ultimaAtiva = faixas.findLastIndex((f) => f.ativo);
  return ultimaAtiva === -1 ? null : (ultimaAtiva + 1) * incremento;
}

/**
 * C1 (não bloqueante, só entre ATIVAS): se a faixa `indice` custa MENOS que a
 * mais cara entre as ativas anteriores, devolve o aviso citando essa faixa
 * (empate → a mais próxima). Faixa desligada nunca recebe alerta nem é citada.
 */
export function alertaDePreco(
  faixas: ReadonlyArray<{ taxa: number; ativo: boolean }>,
  indice: number,
  incremento: IncrementoFaixa,
): string | null {
  const atual = faixas[indice];
  if (atual == null || !atual.ativo) return null;

  let maisCara = -1;
  for (let j = 0; j < indice; j += 1) {
    if (faixas[j].ativo && (maisCara === -1 || faixas[j].taxa >= faixas[maisCara].taxa)) maisCara = j;
  }
  if (maisCara === -1) return null;
  const maior = faixas[maisCara].taxa;
  if (atual.taxa >= maior) return null;

  return (
    `Confira o preço: está menor que o da faixa de ${rotuloFaixa(maisCara, incremento)} (${formatarMoeda(maior)}). ` +
    `Quem está a ${rotuloFaixa(indice, incremento)} vai pagar ${formatarMoeda(atual.taxa)}.`
  );
}

// ─── Switch e lixeira da linha (C2'/C3') ────────────────────────────────────
// Puros (array novo, entrada intacta) e mantêm o PREFIXO de ativas que zod e
// RPC exigem.

/** Desliga a faixa `indice` e todas as abaixo (C2'). */
export function desligarAPartirDe<T extends { ativo: boolean }>(faixas: readonly T[], indice: number): T[] {
  return faixas.map((f, j) => (j >= indice && f.ativo ? { ...f, ativo: false } : f));
}

/** Liga da primeira desligada até `indice`; as abaixo seguem como estão (C2'). */
export function ligarAte<T extends { ativo: boolean }>(faixas: readonly T[], indice: number): T[] {
  return faixas.map((f, j) => (j <= indice && !f.ativo ? { ...f, ativo: true } : f));
}

/** Apaga a faixa `indice` e todas as abaixo (C3'). */
export function removerAPartirDe<T>(faixas: readonly T[], indice: number): T[] {
  return faixas.slice(0, indice);
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
