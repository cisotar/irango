/**
 * [323] O RASCUNHO do editor de frequência de exibição — módulo puro, testável
 * em `environment: node` (molde `rascunhoCardapio.ts`).
 *
 * Por que um rascunho e não a `Frequencia` direto: os três `Switch` "Só em…"
 * (mockup §2.2) têm estado próprio. Desligar um eixo NÃO apaga o que foi
 * digitado enquanto o editor está aberto — só o eixo ligado vira payload. E o
 * `<input type="time">` vazio precisa virar `null`, não `""`.
 *
 * D13 / RN-8, literal:
 *  - Switch de dias DESLIGADO ⇒ `dias_semana: null` (todo dia);
 *  - Switch LIGADO sem nenhuma pílula ⇒ `dias_semana: []` (NUNCA) — sem erro;
 *  - ao ligar pela primeira vez as pílulas começam VAZIAS (o caso comum é
 *    "só sábado": marcar 1 custa menos que desmarcar 6).
 *
 * Nada aqui é autoridade: `validarRascunhoFrequencia` roda o MESMO
 * `schemaFrequencia` da Server Action, que revalida tudo no servidor.
 */

import type { Frequencia } from "@/lib/utils/frequencia";
import { MSG_HORA_PAR } from "@/lib/validacoes/cardapio";
import {
  normalizarDiasDaFrequencia,
  schemaFrequencia,
  type DadosFrequencia,
} from "@/lib/validacoes/frequencia";

export type RascunhoFrequencia = {
  comDias: boolean;
  /** 0=dom..6=sáb. Com `comDias`, vazio = NUNCA (RN-8). */
  dias: number[];
  comHorario: boolean;
  /** "HH:MM" (value nativo do `<input type="time">`) ou "". */
  hora_inicio: string;
  hora_fim: string;
  comPeriodo: boolean;
  /** "YYYY-MM-DD" (value nativo do `<input type="date">`) ou "". */
  periodo_inicio: string;
  periodo_fim: string;
};

/** O `time` do Postgres chega "HH:MM:SS"; o input e o zod querem "HH:MM". */
function hhmm(hora: string | null): string {
  return hora === null ? "" : hora.slice(0, 5);
}

export function rascunhoDaFrequencia(f: Frequencia): RascunhoFrequencia {
  return {
    comDias: f.dias_semana !== null,
    dias: f.dias_semana === null ? [] : [...f.dias_semana],
    comHorario: f.hora_inicio !== null || f.hora_fim !== null,
    hora_inicio: hhmm(f.hora_inicio),
    hora_fim: hhmm(f.hora_fim),
    comPeriodo: f.periodo_inicio !== null || f.periodo_fim !== null,
    periodo_inicio: f.periodo_inicio ?? "",
    periodo_fim: f.periodo_fim ?? "",
  };
}

const ouNulo = (valor: string): string | null => (valor === "" ? null : valor);

/**
 * O payload das 5 chaves — SEMPRE as 5 (D13: chave ausente é recusada, nunca
 * vira "sem restrição" em silêncio). `dias` vai como está: `[]` continua `[]`.
 */
export function frequenciaDoRascunho(r: RascunhoFrequencia): Frequencia {
  return {
    dias_semana: r.comDias ? [...r.dias] : null,
    hora_inicio: r.comHorario ? ouNulo(r.hora_inicio) : null,
    hora_fim: r.comHorario ? ouNulo(r.hora_fim) : null,
    periodo_inicio: r.comPeriodo ? ouNulo(r.periodo_inicio) : null,
    periodo_fim: r.comPeriodo ? ouNulo(r.periodo_fim) : null,
  };
}

export type ErrosFrequencia = { horario: string | null; periodo: string | null };

export type ValidacaoFrequencia =
  | { ok: true; frequencia: DadosFrequencia }
  | { ok: false; erros: ErrosFrequencia };

/**
 * Gate de UX com o MESMO zod do servidor. Um caso a mais que o zod não vê:
 * "Só em um horário do dia" ligado com os DOIS campos vazios seria gravado
 * como "o dia todo" — o lojista ligou o switch, então pede o par.
 */
export function validarRascunhoFrequencia(r: RascunhoFrequencia): ValidacaoFrequencia {
  const erros: ErrosFrequencia = { horario: null, periodo: null };
  if (r.comHorario && r.hora_inicio === "" && r.hora_fim === "") {
    erros.horario = MSG_HORA_PAR;
  }

  const parsed = schemaFrequencia.safeParse(frequenciaDoRascunho(r));
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const campo = String(issue.path[0] ?? "");
      if (campo.startsWith("hora")) erros.horario ??= issue.message;
      else if (campo.startsWith("periodo")) erros.periodo ??= issue.message;
    }
  }

  if (erros.horario !== null || erros.periodo !== null) return { ok: false, erros };
  if (!parsed.success) return { ok: false, erros: { horario: null, periodo: null } };
  return { ok: true, frequencia: parsed.data };
}

/** Mesma frequência depois de normalizar (dias ordenados/7 ⇒ null; hora "HH:MM"). */
export function mesmaFrequencia(a: Frequencia, b: Frequencia): boolean {
  const da = normalizarDiasDaFrequencia(a.dias_semana);
  const db = normalizarDiasDaFrequencia(b.dias_semana);
  const mesmosDias =
    da === null || db === null ? da === db : da.length === db.length && da.every((d, i) => d === db[i]);
  return (
    mesmosDias &&
    hhmm(a.hora_inicio) === hhmm(b.hora_inicio) &&
    hhmm(a.hora_fim) === hhmm(b.hora_fim) &&
    a.periodo_inicio === b.periodo_inicio &&
    a.periodo_fim === b.periodo_fim
  );
}

/**
 * Seleção múltipla (mockup §2.3): todos com a MESMA frequência ⇒ ela abre no
 * editor; divergem ⇒ `null` (o editor abre permanente, com a nota de que
 * salvar SUBSTITUI a de todos). Lista vazia ⇒ `null`.
 */
export function frequenciaComum(lista: readonly Frequencia[]): Frequencia | null {
  if (lista.length === 0) return null;
  const [primeira, ...resto] = lista;
  return resto.every((f) => mesmaFrequencia(primeira, f)) ? primeira : null;
}
