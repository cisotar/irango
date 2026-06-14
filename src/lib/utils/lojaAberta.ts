// STUB TDD (fase RED) — a implementação real é da fase GREEN (executar).
// Apenas a ASSINATURA e os TIPOS existem aqui, para o type-check compilar e os
// testes falharem na ASSERÇÃO (não no import). NÃO implementar a lógica aqui.

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

/**
 * Quebra o instante UTC `agora` no fuso `timezone`, devolvendo o índice do
 * dia-da-semana (0=dom..6=sab) e os minutos desde a meia-noite local.
 * Usa Intl para não depender do fuso do runtime — função PURA: o instante
 * vem exclusivamente de `agora`.
 */
function partesNoFuso(agora: Date, timezone: string): { diaIndex: number; minutos: number } {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const partes = fmt.formatToParts(agora);
  const get = (tipo: string) => partes.find((p) => p.type === tipo)?.value ?? "";

  const mapaDia: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  const diaIndex = mapaDia[get("weekday")] ?? 0;

  let hora = Number(get("hour"));
  // Intl com hour12:false pode emitir "24" para meia-noite em alguns runtimes.
  if (hora === 24) hora = 0;
  const minuto = Number(get("minute"));

  return { diaIndex, minutos: hora * 60 + minuto };
}

/** Converte "HH:MM" em minutos desde a meia-noite. */
function paraMinutos(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

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
