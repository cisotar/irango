/**
 * [257][258][259] O RASCUNHO do form de vigência — módulo puro, testável em
 * `environment: node`, sem uma linha de JSX.
 *
 * Por que o rascunho é um tipo próprio e não o payload do banco:
 *
 *  - design §9.1: **trocar de modo não apaga o que foi digitado** enquanto o
 *    form está aberto. Os dois conjuntos de campos convivem no rascunho; só o
 *    modo selecionado vira payload. A disjunção de RN-01 continua garantida
 *    por `.strict()` no zod e pelos CHECKs `cardapios_*_exclusivo` — nunca por
 *    apagar campo na digitação;
 *  - `<input type="date">` e `<input type="time">` têm `value` separado
 *    (design §9.3, mesma decisão de §8.1), então o rascunho guarda os quatro
 *    pedaços e é AQUI que eles viram o `"YYYY-MM-DDTHH:MM"` que
 *    `schemaCardapio` espera.
 *
 * Nada aqui é autoridade. `validarRascunho` é a MESMA validação da Server
 * Action (um zod, dois consumidores — nenhum schema paralelo), e o "Termina
 * em" exibido sai da MESMA `calcularFimDoPreset` que o servidor roda: o que o
 * cliente mandar em `prazo_fim` sob preset é descartado (RN-04).
 */

import {
  schemaCardapio,
  type DadosCardapio,
} from "@/lib/validacoes/cardapio";
import { calcularFimDoPreset } from "@/lib/utils/calcularFimDoPreset";
import { horaLocalNoFuso, instanteNoFuso } from "@/lib/utils/fusoLoja";
import { descreverVigencia } from "@/lib/utils/descreverVigencia";
import type { CardapioVigencia } from "@/lib/utils/vigenciaCardapio";

export type ModoVigencia = "recorrente" | "prazo_fixo";
export type PresetDeDuracao = "diario" | "semanal" | "mensal" | "customizado";

export type RascunhoCardapio = {
  nome: string;
  modo: ModoVigencia;
  // ── modo A, "Repete sempre" ──────────────────────────────────────────────
  /** 0=dom..6=sab. Vazio = SEM RESTRIÇÃO por este eixo (RN-02). */
  dias_semana: number[];
  /** 1..31. Vazio = SEM RESTRIÇÃO por este eixo. */
  dias_mes: number[];
  /** O `Switch` "Só em um horário do dia" (design §9.2). */
  comHorario: boolean;
  hora_inicio: string;
  hora_fim: string;
  // ── modo B, "Período com data de fim" ────────────────────────────────────
  prazo_preset: PresetDeDuracao;
  inicio_data: string;
  inicio_hora: string;
  fim_data: string;
  fim_hora: string;
};

/** Os quatro chips de duração, um para um com os quatro `prazo_preset`. */
export const PRESETS: readonly { valor: PresetDeDuracao; rotulo: string }[] = [
  { valor: "diario", rotulo: "1 dia" },
  { valor: "semanal", rotulo: "7 dias" },
  { valor: "mensal", rotulo: "1 mês" },
  { valor: "customizado", rotulo: "Escolher as datas" },
];

/** Vocabulário de LOJISTA (design §9.1) — nunca "recorrente"/"prazo fixo". */
export const MODOS: readonly {
  valor: ModoVigencia;
  titulo: string;
  descricao: string;
}[] = [
  {
    valor: "recorrente",
    titulo: "Repete sempre",
    descricao: "Volta toda semana ou todo mês, até você desligar.",
  },
  {
    valor: "prazo_fixo",
    titulo: "Período com data de fim",
    descricao: "Aparece uma vez, de uma data até outra, e some sozinho no fim.",
  },
];

export const DIAS_DA_SEMANA: readonly { valor: number; rotulo: string }[] = [
  { valor: 0, rotulo: "Dom" },
  { valor: 1, rotulo: "Seg" },
  { valor: 2, rotulo: "Ter" },
  { valor: 3, rotulo: "Qua" },
  { valor: 4, rotulo: "Qui" },
  { valor: 5, rotulo: "Sex" },
  { valor: 6, rotulo: "Sáb" },
];

/**
 * [275] Os 7 dias, DERIVADOS da tabela acima — nunca um literal
 * `[0,1,2,3,4,5,6]` escrito à mão. É o que torna "Todos os dias ⇒ `dias_semana`
 * com os 7 valores" afirmável sem jsdom, e o que impede a tabela de dias de
 * ganhar uma segunda casa.
 */
export function todosOsDias(): number[] {
  return DIAS_DA_SEMANA.map((dia) => dia.valor);
}

/** "HH:MM:SS" do Postgres ou "HH:MM" do input — a UI só fala "HH:MM". */
function hhmm(hora: string | null, padrao: string): string {
  return hora === null || hora === "" ? padrao : hora.slice(0, 5);
}

/**
 * Rascunho inicial. Sem cardápio salvo (criação), o modo nasce "Repete
 * sempre", sem nenhum dia marcado — e a nota "Nenhum dia marcado = todos os
 * dias" + o erro de RN-02 no submit são o que impede o lojista de gravar um
 * cardápio que não é sazonal.
 *
 * `agoraLocal` é `"YYYY-MM-DDTHH:MM"` no fuso da LOJA, montado no servidor:
 * nenhum `new Date()` aqui dentro.
 */
export function rascunhoInicial(
  cardapio: CardapioVigencia | null,
  timezone: string,
  agoraLocal: string,
): RascunhoCardapio {
  const [hojeData, hojeHora] = agoraLocal.split("T");
  const base: RascunhoCardapio = {
    nome: cardapio?.nome ?? "",
    modo: cardapio?.modo ?? "recorrente",
    dias_semana: cardapio?.dias_semana ?? [],
    dias_mes: cardapio?.dias_mes ?? [],
    comHorario: (cardapio?.hora_inicio ?? null) !== null,
    hora_inicio: hhmm(cardapio?.hora_inicio ?? null, "11:00"),
    hora_fim: hhmm(cardapio?.hora_fim ?? null, "15:00"),
    prazo_preset: "semanal",
    inicio_data: hojeData,
    inicio_hora: hojeHora,
    fim_data: hojeData,
    fim_hora: hojeHora,
  };

  if (cardapio?.prazo_inicio != null) {
    const [data, hora] = horaLocalNoFuso(cardapio.prazo_inicio, timezone).split(
      "T",
    );
    base.inicio_data = data;
    base.inicio_hora = hora;
  }
  if (cardapio?.prazo_fim != null) {
    const [data, hora] = horaLocalNoFuso(cardapio.prazo_fim, timezone).split(
      "T",
    );
    base.fim_data = data;
    base.fim_hora = hora;
  }
  return base;
}

/** `"YYYY-MM-DDTHH:MM"` — o formato que `schemaCardapio` valida. */
function local(data: string, hora: string): string {
  return `${data}T${hora}`;
}

/**
 * O payload do modo SELECIONADO, e só dele. O outro modo fica no rascunho para
 * o lojista poder voltar, mas não viaja: `.strict()` no zod recusaria, e o
 * banco guarda um modo só.
 */
export function payloadDoRascunho(r: RascunhoCardapio): unknown {
  if (r.modo === "recorrente") {
    return {
      nome: r.nome,
      modo: "recorrente",
      dias_semana: r.dias_semana.length > 0 ? r.dias_semana : null,
      dias_mes: r.dias_mes.length > 0 ? r.dias_mes : null,
      hora_inicio: r.comHorario ? r.hora_inicio : null,
      hora_fim: r.comHorario ? r.hora_fim : null,
    };
  }
  return {
    nome: r.nome,
    modo: "prazo_fixo",
    prazo_inicio: local(r.inicio_data, r.inicio_hora),
    // RN-04: sob preset o servidor RECALCULA o fim e descarta este campo. Ele
    // só é preenchido em `customizado`, o único caminho que abre o campo.
    prazo_fim:
      r.prazo_preset === "customizado" ? local(r.fim_data, r.fim_hora) : null,
    prazo_preset: r.prazo_preset,
  };
}

export type ResultadoValidacao =
  | { ok: true; payload: unknown; dados: DadosCardapio }
  | { ok: false; payload: unknown; erros: Record<string, string> };

/**
 * A MESMA validação da Server Action, rodada antes do envio para dar mensagem
 * legível (design §9.6). Ela é a primeira barreira, não a autoridade: o zod do
 * servidor e os CHECKs do banco continuam valendo, e um `23514` vira mensagem
 * genérica com o detalhe no log.
 */
export function validarRascunho(r: RascunhoCardapio): ResultadoValidacao {
  const payload = payloadDoRascunho(r);
  const parsed = schemaCardapio.safeParse(payload);
  if (parsed.success) return { ok: true, payload, dados: parsed.data };

  const erros: Record<string, string> = {};
  for (const issue of parsed.error.issues) {
    const campo = issue.path.length > 0 ? String(issue.path[0]) : "form";
    erros[campo] ??= issue.message;
  }
  return { ok: false, payload, erros };
}

/**
 * O "Termina em" do modo B. Com preset é LEITURA (design §9.3) e vem de
 * `calcularFimDoPreset` — a MESMA função do servidor, com o clamp de fim de
 * mês incluso (`31/01 + 1 mês` é `28/02`, nunca `03/03`). Nunca uma segunda
 * fórmula no browser.
 *
 * `null` no modo `customizado`: ali o fim é campo, não leitura.
 */
export function fimDoPresetExibido(
  r: RascunhoCardapio,
  timezone: string,
): string | null {
  if (r.modo !== "prazo_fixo" || r.prazo_preset === "customizado") return null;

  const inicio = new Date(instanteNoFuso(local(r.inicio_data, r.inicio_hora), timezone));
  if (!Number.isFinite(inicio.getTime())) return null;

  const fim = calcularFimDoPreset(inicio, r.prazo_preset, timezone);
  const [data, hora] = horaLocalNoFuso(fim.toISOString(), timezone).split("T");
  const [ano, mes, dia] = data.split("-");
  return `${dia}/${mes}/${ano}, ${hora}`;
}

/**
 * O rascunho lido como vigência, para `descreverVigencia`. É aqui que a hora
 * LOCAL vira instante (`instanteNoFuso`), e é por isso que `PreviewVigencia`
 * não precisa importar `fusoLoja` nem `Date`: ele recebe a frase pronta.
 */
export function vigenciaDoRascunho(
  r: RascunhoCardapio,
  timezone: string,
): CardapioVigencia {
  const comum = {
    id: "rascunho",
    nome: r.nome,
    ativo: true,
    dias_semana: null,
    dias_mes: null,
    hora_inicio: null,
    hora_fim: null,
    prazo_inicio: null,
    prazo_fim: null,
  };

  if (r.modo === "recorrente") {
    return {
      ...comum,
      modo: "recorrente",
      dias_semana: r.dias_semana.length > 0 ? [...r.dias_semana] : null,
      dias_mes: r.dias_mes.length > 0 ? [...r.dias_mes] : null,
      hora_inicio: r.comHorario ? r.hora_inicio : null,
      hora_fim: r.comHorario ? r.hora_fim : null,
    };
  }

  const inicioIso = instanteNoFuso(local(r.inicio_data, r.inicio_hora), timezone);
  const fimIso =
    r.prazo_preset === "customizado"
      ? instanteNoFuso(local(r.fim_data, r.fim_hora), timezone)
      : calcularFimDoPreset(
          new Date(inicioIso),
          r.prazo_preset,
          timezone,
        ).toISOString();

  return { ...comum, modo: "prazo_fixo", prazo_inicio: inicioIso, prazo_fim: fimIso };
}

/**
 * A frase da prévia (design §9.4). `agora` NÃO entra: a prévia do rascunho
 * descreve a configuração sem afirmar nada sobre o presente — a linha "Agora:"
 * é do servidor e só vale para o que está salvo.
 */
export function fraseDoRascunho(
  r: RascunhoCardapio,
  timezone: string,
): string {
  try {
    return descreverVigencia(vigenciaDoRascunho(r, timezone), timezone);
  } catch {
    // Data pela metade durante a digitação não derruba a tela.
    return "Preencha as datas para ver a prévia.";
  }
}
