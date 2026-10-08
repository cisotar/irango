// Calendário do relatório de vendas (issue 357). Função PURA: o instante vem de
// `agora`; o dia local sai de `diaNoFuso` e a borda local → UTC de
// `instanteNoFuso` (fusoLoja.ts, fonte única de fuso do projeto). A aritmética de
// DIAS (somar, semana ISO, ciclo) é de calendário, feita em UTC sem fuso: um
// "YYYY-MM-DD" não tem hora, então não há horário de verão a errar aqui.
// Plano: plan/tecnico-relatorio-vendas.md §7.3.

import { diaNoFuso, instanteNoFuso } from "./fusoLoja";
import { nomeDoMes } from "./mesDeReferencia";
import type {
  DiaLocal,
  IntervaloDias,
  PeriodoRanking,
  PresetVendas,
} from "@/lib/vendas/tipos";
import type { FiltrosVendas } from "@/lib/validacoes/vendas";

/** Teto da faixa personalizada, em dias inclusivos (RN-V09, D14). */
export const TETO_DIAS_PERSONALIZADO = 366;

const DIA_MS = 86_400_000;
const RE_DIA = /^(\d{4})-(\d{2})-(\d{2})$/;

function partes(dia: DiaLocal): [number, number, number] {
  const m = RE_DIA.exec(dia);
  if (m == null) throw new Error("Dia fora do formato YYYY-MM-DD");
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function paraMs(dia: DiaLocal): number {
  const [a, m, d] = partes(dia);
  return Date.UTC(a, m - 1, d);
}

function deMs(ms: number): DiaLocal {
  return new Date(ms).toISOString().slice(0, 10);
}

/** `true` só para "YYYY-MM-DD" que existe no calendário (2026-02-29 não existe). */
export function ehDiaLocalValido(dia: string): boolean {
  if (!RE_DIA.test(dia)) return false;
  return deMs(paraMs(dia)) === dia;
}

export function somarDias(dia: DiaLocal, n: number): DiaLocal {
  return deMs(paraMs(dia) + n * DIA_MS);
}

/** Quantidade de dias de `de` a `ate`, contando os dois. */
export function diasInclusivos(de: DiaLocal, ate: DiaLocal): number {
  return Math.round((paraMs(ate) - paraMs(de)) / DIA_MS) + 1;
}

/** Segunda-feira da semana ISO que contém `dia`. */
export function inicioDaSemanaIso(dia: DiaLocal): DiaLocal {
  const diaDaSemana = new Date(paraMs(dia)).getUTCDay(); // 0=dom..6=sab
  return somarDias(dia, -((diaDaSemana + 6) % 7));
}

/**
 * Ciclo mensal (RN-V07) que contém `dia`. Começa no `diaInicioCiclo` do mesmo
 * mês se o dia já chegou nele, senão no do mês anterior; termina na véspera do
 * mesmo dia no mês seguinte. Com 1..28, todo mês tem o dia de início.
 */
export function cicloQueContem(dia: DiaLocal, diaInicioCiclo: number): IntervaloDias {
  const [a, m, d] = partes(dia);
  const mesInicio = d >= diaInicioCiclo ? m - 1 : m - 2; // 0-based; Date.UTC normaliza a virada de ano
  const inicio = Date.UTC(a, mesInicio, diaInicioCiclo);
  const proximo = Date.UTC(a, mesInicio + 1, diaInicioCiclo);
  return { deDia: deMs(inicio), ateDia: deMs(proximo - DIA_MS) };
}

/** "05/out". */
export function rotuloDia(dia: DiaLocal): string {
  const [, m] = partes(dia);
  return `${dia.slice(8, 10)}/${nomeDoMes(m).slice(0, 3)}`;
}

/** "05/out a 04/nov"; com anos diferentes, "05/dez/2026 a 04/jan/2027"; um dia só, "05/out". */
export function rotuloIntervalo(i: IntervaloDias): string {
  if (i.deDia === i.ateDia) return rotuloDia(i.deDia);
  const anoDe = i.deDia.slice(0, 4);
  const anoAte = i.ateDia.slice(0, 4);
  if (anoDe === anoAte) return `${rotuloDia(i.deDia)} a ${rotuloDia(i.ateDia)}`;
  return `${rotuloDia(i.deDia)}/${anoDe} a ${rotuloDia(i.ateDia)}/${anoAte}`;
}

/** Converte dias locais inclusivos na faixa `[inicio, fim)` em ISO UTC, no fuso da loja. */
export function janelaDeDias(
  i: IntervaloDias,
  timezone: string,
): IntervaloDias & { inicio: string; fim: string } {
  return {
    deDia: i.deDia,
    ateDia: i.ateDia,
    inicio: instanteNoFuso(`${i.deDia}T00:00`, timezone),
    fim: instanteNoFuso(`${somarDias(i.ateDia, 1)}T00:00`, timezone),
  };
}

export function intervaloDoPreset(
  f: { periodo: PresetVendas; de: DiaLocal | null; ate: DiaLocal | null },
  hoje: DiaLocal,
  diaInicioCiclo: number,
): IntervaloDias {
  switch (f.periodo) {
    case "hoje":
      return { deDia: hoje, ateDia: hoje };
    case "semana": {
      const segunda = inicioDaSemanaIso(hoje);
      return { deDia: segunda, ateDia: somarDias(segunda, 6) };
    }
    case "mes":
      return cicloQueContem(hoje, diaInicioCiclo);
    case "mes_anterior": {
      const atual = cicloQueContem(hoje, diaInicioCiclo);
      return cicloQueContem(somarDias(atual.deDia, -1), diaInicioCiclo);
    }
    case "ano": {
      const ano = hoje.slice(0, 4);
      return { deDia: `${ano}-01-01`, ateDia: `${ano}-12-31` };
    }
    case "personalizado":
      // `lerParamsVendas` só entrega "personalizado" com as duas datas válidas.
      if (f.de == null || f.ate == null) throw new Error("Período personalizado sem datas");
      return { deDia: f.de, ateDia: f.ate };
  }
}

/**
 * Janela do ranking de clientes (RN-V18), independente dos filtros globais.
 * "tudo" não tem início e termina no começo de amanhã local.
 */
export function janelaDoRanking(
  periodo: PeriodoRanking,
  agora: Date,
  timezone: string,
  diaInicioCiclo: number,
): { inicio: string | null; fim: string; rotulo: string } {
  const hoje = diaNoFuso(agora, timezone);
  if (periodo === "tudo") {
    return {
      inicio: null,
      fim: instanteNoFuso(`${somarDias(hoje, 1)}T00:00`, timezone),
      rotulo: "desde o início",
    };
  }
  const intervalo = intervaloDoPreset({ periodo, de: null, ate: null }, hoje, diaInicioCiclo);
  const janela = janelaDeDias(intervalo, timezone);
  return { inicio: janela.inicio, fim: janela.fim, rotulo: rotuloIntervalo(intervalo) };
}

export type ContextoVendas = {
  janela: IntervaloDias & { inicio: string; fim: string };
  rotuloPeriodo: string;
  cicloAtual: IntervaloDias & { rotulo: string };
  diaInicioCiclo: number;
};

export function montarContextoVendas(
  loja: { timezone: string; dia_inicio_ciclo: number },
  filtros: FiltrosVendas,
  agora: Date,
): ContextoVendas {
  const hoje = diaNoFuso(agora, loja.timezone);
  const intervalo = intervaloDoPreset(filtros, hoje, loja.dia_inicio_ciclo);
  const ciclo = cicloQueContem(hoje, loja.dia_inicio_ciclo);
  return {
    janela: janelaDeDias(intervalo, loja.timezone),
    rotuloPeriodo: rotuloIntervalo(intervalo),
    cicloAtual: { ...ciclo, rotulo: rotuloIntervalo(ciclo) },
    diaInicioCiclo: loja.dia_inicio_ciclo,
  };
}
