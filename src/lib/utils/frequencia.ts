/**
 * Frequência de exibição — avaliador PURO produto ∩ categoria, no fuso da loja.
 *
 * Fonte ÚNICA da decisão "este produto pode ser comprado agora?" para os três
 * caminhos: vitrine SSR (`projetarCatalogoVitrine`), `revisarCarrinhoAction` e
 * `criarPedido` (autoritativo, `seguranca.md` §10). Substitui a vigência de
 * cardápio (`vigenciaCardapio.ts`, que fica como função morta).
 *
 * Spec: specs/frequencia-exibicao.md (RN-1, RN-2, RN-3, RN-7, RN-8).
 * Plano: plan/tecnico-frequencia-exibicao.md (C2, D8, D12, D13).
 *
 * Eixos (S1–S3): dias da semana (0=dom..6=sáb), faixa de horário (início
 * INCLUSIVO, fim EXCLUSIVO, sem virar a meia-noite) e período de datas
 * (`YYYY-MM-DD`, inclusivo nas duas pontas). Eixo NULL = sem restrição.
 * `dias_semana = []` é NUNCA (RN-8) — distinto de NULL em todo lugar: aqui só
 * se testa `=== null` e `length === 0`, nunca `!dias`/`dias?.length`.
 *
 * Nenhum formatter de data aqui: o calendário local vem de `fusoLoja.ts`. Ignora
 * `produtos.visibilidade` (S5).
 *
 * FAIL-CLOSED (espelho de `paraCardapioVigencia`): estado que os CHECKs tornam
 * impossível (hora sem par, hora ou data malformada) ⇒ indisponível. Decide
 * compra — na dúvida, não vende.
 */

import { diaNoFuso, paraMinutos, partesNoFusoCompletas } from "./fusoLoja";

export type Frequencia = {
  /** 0=dom..6=sáb; NULL = todo dia; [] = NUNCA (RN-8). */
  dias_semana: number[] | null;
  /** "HH:MM" ou "HH:MM:SS" (time do PG); INCLUSIVO. */
  hora_inicio: string | null;
  /** EXCLUSIVO; par com hora_inicio. */
  hora_fim: string | null;
  /** "YYYY-MM-DD"; INCLUSIVO. */
  periodo_inicio: string | null;
  /** "YYYY-MM-DD"; INCLUSIVO; depois dele = encerrado (RN-7). */
  periodo_fim: string | null;
};

export type CategoriaFrequencia = Frequencia & { oculta: boolean };

export const FREQUENCIA_PERMANENTE: Frequencia = Object.freeze({
  dias_semana: null,
  hora_inicio: null,
  hora_fim: null,
  periodo_inicio: null,
  periodo_fim: null,
}) as Frequencia;

export type MotivoIndisponivel = "categoria_oculta" | "encerrado" | "fora_da_frequencia";

export type AvaliacaoFrequencia =
  | { disponivel: true; motivo: null }
  | { disponivel: false; motivo: MotivoIndisponivel };

/**
 * Interseção de duas frequências. Discriminada (e não `Frequencia | null`)
 * porque `null` ao lado de campos que também usam `null` ("sem restrição")
 * seria a confusão que D13 proíbe.
 */
export type Combinacao = { vazia: true } | { vazia: false; frequencia: Frequencia };

const DISPONIVEL: AvaliacaoFrequencia = { disponivel: true, motivo: null };
const indisponivel = (motivo: MotivoIndisponivel): AvaliacaoFrequencia => ({
  disponivel: false,
  motivo,
});

const RE_DATA = /^\d{4}-\d{2}-\d{2}$/;
const RE_HORA = /^\d{2}:\d{2}(:\d{2})?$/;

/** Minutos desde a meia-noite, ou `null` se a hora está malformada. */
function minutosDe(hora: string): number | null {
  if (!RE_HORA.test(hora)) return null;
  const m = paraMinutos(hora);
  return Number.isFinite(m) ? m : null;
}

/** Copia só os 5 eixos (a linha do banco traz outras colunas). */
export function frequenciaDe(row: Frequencia): Frequencia {
  return {
    dias_semana: row.dias_semana,
    hora_inicio: row.hora_inicio,
    hora_fim: row.hora_fim,
    periodo_inicio: row.periodo_inicio,
    periodo_fim: row.periodo_fim,
  };
}

/**
 * RN-7: o dia civil da loja já passou de `periodo_fim`. `periodo_fim`
 * malformado ⇒ true (fail-closed: some e não vende).
 */
export function periodoEncerrado(f: Frequencia, agora: Date, timezone: string): boolean {
  if (f.periodo_fim === null) return false;
  if (!RE_DATA.test(f.periodo_fim)) return true;
  return diaNoFuso(agora, timezone) > f.periodo_fim;
}

/** Os três eixos juntos (AND), no fuso da loja. */
export function dentroDaFrequencia(f: Frequencia, agora: Date, timezone: string): boolean {
  // Período: comparação de strings YYYY-MM-DD no dia civil da loja.
  if (f.periodo_inicio !== null || f.periodo_fim !== null) {
    if (f.periodo_inicio !== null && !RE_DATA.test(f.periodo_inicio)) return false;
    if (f.periodo_fim !== null && !RE_DATA.test(f.periodo_fim)) return false;
    const hoje = diaNoFuso(agora, timezone);
    if (f.periodo_inicio !== null && hoje < f.periodo_inicio) return false;
    if (f.periodo_fim !== null && hoje > f.periodo_fim) return false;
  }

  const temDia = f.dias_semana !== null;
  const temHora = f.hora_inicio !== null || f.hora_fim !== null;
  if (!temDia && !temHora) return true;

  // Par de hora incompleto é impossível pelo CHECK: fail-closed.
  if ((f.hora_inicio === null) !== (f.hora_fim === null)) return false;

  const { diaIndex, minutos } = partesNoFusoCompletas(agora, timezone);

  if (f.dias_semana !== null) {
    if (f.dias_semana.length === 0) return false; // RN-8: nunca (semântica, não defeito)
    if (!f.dias_semana.includes(diaIndex)) return false;
  }

  if (f.hora_inicio !== null && f.hora_fim !== null) {
    const ini = minutosDe(f.hora_inicio);
    const fim = minutosDe(f.hora_fim);
    if (ini === null || fim === null) return false;
    if (!(minutos >= ini && minutos < fim)) return false;
  }

  return true;
}

/**
 * Produto ∩ categoria (RN-1). Precedência (D8):
 * `categoria_oculta` > `encerrado` > `fora_da_frequencia`.
 * Antes de `periodo_inicio` é `fora_da_frequencia` (visível e indisponível).
 */
export function avaliarFrequencia(
  produto: Frequencia,
  categoria: CategoriaFrequencia | null,
  agora: Date,
  timezone: string,
): AvaliacaoFrequencia {
  if (categoria !== null && categoria.oculta) return indisponivel("categoria_oculta");
  if (
    (categoria !== null && periodoEncerrado(categoria, agora, timezone)) ||
    periodoEncerrado(produto, agora, timezone)
  ) {
    return indisponivel("encerrado");
  }
  if (categoria !== null && !dentroDaFrequencia(categoria, agora, timezone)) {
    return indisponivel("fora_da_frequencia");
  }
  if (!dentroDaFrequencia(produto, agora, timezone)) return indisponivel("fora_da_frequencia");
  return DISPONIVEL;
}

/**
 * Resolve a categoria do produto pelo mapa da loja. Id ausente do mapa ⇒
 * `categoria_oculta` (fail-closed: categoria de outra loja, removida ou
 * escondida pela RLS).
 */
export function avaliarFrequenciaNaLoja(
  produto: Frequencia & { categoria_id: string | null },
  categoriasPorId: ReadonlyMap<string, CategoriaFrequencia>,
  agora: Date,
  timezone: string,
): AvaliacaoFrequencia {
  if (produto.categoria_id === null) return avaliarFrequencia(produto, null, agora, timezone);
  const categoria = categoriasPorId.get(produto.categoria_id);
  if (categoria === undefined) return indisponivel("categoria_oculta");
  return avaliarFrequencia(produto, categoria, agora, timezone);
}

/** A MESMA regra que a vitrine usa para `categoriasVisiveis` (RN-2, RN-7). */
export function categoriaVisivel(c: CategoriaFrequencia, agora: Date, timezone: string): boolean {
  return !c.oculta && !periodoEncerrado(c, agora, timezone);
}

function maior(a: string | null, b: string | null): string | null {
  if (a === null) return b;
  if (b === null) return a;
  return a > b ? a : b;
}

function menor(a: string | null, b: string | null): string | null {
  if (a === null) return b;
  if (b === null) return a;
  return a < b ? a : b;
}

/**
 * Interseção eixo a eixo. Dias: NULL × X = X; X × Y = X ∩ Y (vazio ⇒ vazia).
 * Hora: maior início, menor fim (início >= fim ⇒ vazia). Período: maior início,
 * menor fim (fim < início ⇒ vazia).
 */
export function combinarFrequencias(a: Frequencia, b: Frequencia | null): Combinacao {
  if (b === null) return { vazia: false, frequencia: frequenciaDe(a) };

  let dias: number[] | null;
  if (a.dias_semana === null) dias = b.dias_semana === null ? null : [...b.dias_semana];
  else if (b.dias_semana === null) dias = [...a.dias_semana];
  else {
    const outro = b.dias_semana;
    dias = a.dias_semana.filter((d) => outro.includes(d));
  }
  if (dias !== null && dias.length === 0) return { vazia: true };
  if (dias !== null) dias = [...new Set(dias)].sort((x, y) => x - y);

  let horaInicio: string | null = a.hora_inicio;
  let horaFim: string | null = a.hora_fim;
  if (b.hora_inicio !== null || b.hora_fim !== null) {
    if (a.hora_inicio === null && a.hora_fim === null) {
      horaInicio = b.hora_inicio;
      horaFim = b.hora_fim;
    } else {
      const ai = a.hora_inicio === null ? null : minutosDe(a.hora_inicio);
      const af = a.hora_fim === null ? null : minutosDe(a.hora_fim);
      const bi = b.hora_inicio === null ? null : minutosDe(b.hora_inicio);
      const bf = b.hora_fim === null ? null : minutosDe(b.hora_fim);
      if (ai === null || af === null || bi === null || bf === null) return { vazia: true };
      horaInicio = ai >= bi ? a.hora_inicio : b.hora_inicio;
      horaFim = af <= bf ? a.hora_fim : b.hora_fim;
      if (Math.max(ai, bi) >= Math.min(af, bf)) return { vazia: true };
    }
  }

  const periodoInicio = maior(a.periodo_inicio, b.periodo_inicio);
  const periodoFim = menor(a.periodo_fim, b.periodo_fim);
  if (periodoInicio !== null && periodoFim !== null && periodoFim < periodoInicio) {
    return { vazia: true };
  }

  return {
    vazia: false,
    frequencia: {
      dias_semana: dias,
      hora_inicio: horaInicio,
      hora_fim: horaFim,
      periodo_inicio: periodoInicio,
      periodo_fim: periodoFim,
    },
  };
}

const MS_DIA = 86_400_000;

/** Dia da semana (0=dom) de uma data civil `YYYY-MM-DD` — aritmética de data, não de fuso. */
function diaDaSemanaDe(data: string): number {
  const [ano, mes, dia] = data.split("-").map(Number);
  return new Date(Date.UTC(ano, mes - 1, dia)).getUTCDay();
}

/**
 * RN-1/RN-8 (preview do painel): a combinação produto ∩ categoria nunca abre.
 * Não olha `agora` — "já encerrou" é outro aviso.
 */
export function frequenciaNuncaAbre(produto: Frequencia, categoria: Frequencia | null): boolean {
  if (produto.dias_semana !== null && produto.dias_semana.length === 0) return true;
  if (categoria !== null && categoria.dias_semana !== null && categoria.dias_semana.length === 0) {
    return true;
  }

  const combinacao = combinarFrequencias(produto, categoria);
  if (combinacao.vazia) return true;

  const f = combinacao.frequencia;
  if (
    f.dias_semana !== null &&
    f.periodo_inicio !== null &&
    f.periodo_fim !== null &&
    RE_DATA.test(f.periodo_inicio) &&
    RE_DATA.test(f.periodo_fim)
  ) {
    const [ai, mi, di] = f.periodo_inicio.split("-").map(Number);
    const [af, mf, df] = f.periodo_fim.split("-").map(Number);
    const dias = Math.round((Date.UTC(af, mf - 1, df) - Date.UTC(ai, mi - 1, di)) / MS_DIA) + 1;
    if (dias >= 1 && dias <= 7) {
      const primeiro = diaDaSemanaDe(f.periodo_inicio);
      const marcados = f.dias_semana;
      const algumMarcado = Array.from({ length: dias }, (_, i) => (primeiro + i) % 7).some((d) =>
        marcados.includes(d),
      );
      if (!algumMarcado) return true;
    }
  }

  return false;
}
