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

/**
 * Converte o horário LOCAL digitado pelo lojista (`"YYYY-MM-DDTHH:MM"`, o valor
 * nativo de um `<input type="datetime-local">`) no instante absoluto
 * correspondente **no fuso da loja**, devolvido como ISO-8601 UTC.
 *
 * É um dos dois únicos lugares de borda onde o fuso entra (RN-03); a comparação
 * de vigência continua instante ↔ instante, sem fuso nenhum.
 *
 * Sem offset fixo e sem tabela própria: o deslocamento do fuso é medido pelo
 * PRÓPRIO Intl, na data em questão (então horário de verão, se o fuso tiver,
 * sai de graça). Duas passadas porque o deslocamento depende do instante que
 * estamos justamente procurando — a segunda corrige a borda em que o palpite
 * cai do outro lado de uma virada de offset.
 */
export function instanteNoFuso(local: string, timezone: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (m == null) {
    throw new Error("Horário local fora do formato YYYY-MM-DDTHH:MM");
  }
  const [ano, mes, dia, hora, minuto] = m.slice(1).map(Number);

  // Palpite: lê o horário local COMO SE fosse UTC.
  const palpite = Date.UTC(ano, mes - 1, dia, hora, minuto);
  let ts = palpite - deslocamentoMs(palpite, timezone);
  ts = palpite - deslocamentoMs(ts, timezone);
  return new Date(ts).toISOString();
}

// Deslocamento do fuso (hora local − UTC), em ms, NO instante `ts`.
function deslocamentoMs(ts: number, timezone: string): number {
  const partes = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(new Date(ts));
  const get = (tipo: string) =>
    Number(partes.find((p) => p.type === tipo)?.value ?? "0");

  let hora = get("hour");
  // Mesma defesa de partesNoFuso: alguns runtimes emitem "24" na meia-noite.
  if (hora === 24) hora = 0;

  const comoUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    hora,
    get("minute"),
    get("second"),
  );
  return comoUtc - ts;
}

/**
 * Dia civil da loja no formato ISO `"YYYY-MM-DD"`, no fuso `timezone`.
 *
 * É o "hoje" que o modal de promoções compara com a última visualização
 * gravada no dispositivo (RN-16): o cliente que vira a meia-noite no PRÓPRIO
 * fuso não deve reabrir o modal de uma loja onde ainda é o mesmo dia — por isso
 * o dia sai daqui, no servidor, e nunca do relógio do navegador.
 *
 * `en-CA` porque é o locale cujo formato numérico já é `AAAA-MM-DD` (mesmo
 * truque de `metricasPedidos.chaveDia`, que é fixo em São Paulo e por isso não
 * serve a uma loja com fuso próprio). O formatter é criado por chamada: o fuso
 * é parâmetro, não constante.
 */
export function diaNoFuso(agora: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(agora);
}
