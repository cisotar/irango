/**
 * Aritmética de fuso da loja — fonte única do projeto.
 *
 * Extraído de `lojaAberta.ts` (issue 222) para que prazo de promoção e
 * "dia de hoje na loja" usem o MESMO primitivo, sem uma segunda cópia.
 * Nada de aritmética de fuso escrita à mão: usa `Intl`.
 */

/** Partes de um instante já convertidas para o fuso da loja. */
export type PartesNoFuso = {
  /** Dia da semana local: 0=dom .. 6=sab. */
  diaIndex: number;
  /** Minutos desde a meia-noite local. */
  minutos: number;
};

// Mapa do weekday "short" en-US do Intl para o índice 0=dom..6=sab.
const MAPA_DIA: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

/**
 * Quebra o instante UTC `agora` no fuso `timezone`, devolvendo o índice do
 * dia-da-semana (0=dom..6=sab) e os minutos desde a meia-noite local.
 * Usa Intl para não depender do fuso do runtime — função PURA: o instante
 * vem exclusivamente de `agora`.
 */
export function partesNoFuso(agora: Date, timezone: string): PartesNoFuso {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const partes = fmt.formatToParts(agora);
  const get = (tipo: string) => partes.find((p) => p.type === tipo)?.value ?? "";

  const diaIndex = MAPA_DIA[get("weekday")] ?? 0;

  let hora = Number(get("hour"));
  // Intl com hour12:false pode emitir "24" para meia-noite em alguns runtimes.
  if (hora === 24) hora = 0;
  const minuto = Number(get("minute"));

  return { diaIndex, minutos: hora * 60 + minuto };
}

/** Converte "HH:MM" em minutos desde a meia-noite. */
export function paraMinutos(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}
