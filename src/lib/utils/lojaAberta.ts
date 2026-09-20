// STUB TDD (fase RED) — a implementação real é da fase GREEN (executar).
// Apenas a ASSINATURA e os TIPOS existem aqui, para o type-check compilar e os
// testes falharem na ASSERÇÃO (não no import). NÃO implementar a lógica aqui.

import { paraMinutos, partesNoFuso } from "./fusoLoja";

/** Janela de um dia: HH:MM de abertura/fechamento e se o dia está ativo. */
export type DiaHorario = {
  abre: string; // "HH:MM"
  fecha: string; // "HH:MM"
  ativo: boolean;
};

/** Horários por dia da semana, conforme lojas.horarios (jsonb). */
export type Horarios = {
  seg: DiaHorario;
  ter: DiaHorario;
  qua: DiaHorario;
  qui: DiaHorario;
  sex: DiaHorario;
  sab: DiaHorario;
  dom: DiaHorario;
};

export type ResultadoLojaAberta = {
  aberta: boolean;
  reabreEm?: string; // "HH:MM" da próxima abertura, quando fechada
};

// Ordem dos dias da semana usada para varrer adiante a partir de qualquer dia.
const DIAS: (keyof Horarios)[] = ["dom", "seg", "ter", "qua", "qui", "sex", "sab"];

export function lojaAberta(
  horarios: Horarios,
  agora: Date,
  timezone: string,
): ResultadoLojaAberta {
  const { diaIndex, minutos } = partesNoFuso(agora, timezone);

  const dia = horarios[DIAS[diaIndex]];
  const dentroDaJanela =
    dia.ativo && minutos >= paraMinutos(dia.abre) && minutos < paraMinutos(dia.fecha);

  if (dentroDaJanela) {
    return { aberta: true };
  }

  // Fechada: calcular a próxima abertura varrendo adiante.
  // Hoje ainda conta se o dia está ativo e ainda não chegamos na abertura.
  if (dia.ativo && minutos < paraMinutos(dia.abre)) {
    return { aberta: false, reabreEm: dia.abre };
  }

  // Varre os próximos 7 dias procurando o primeiro dia ativo.
  for (let i = 1; i <= 7; i++) {
    const proximo = horarios[DIAS[(diaIndex + i) % 7]];
    if (proximo.ativo) {
      return { aberta: false, reabreEm: proximo.abre };
    }
  }

  // Nenhum dia ativo na semana.
  return { aberta: false };
}
