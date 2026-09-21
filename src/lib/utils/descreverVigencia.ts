/**
 * [254] Vigência em português — UMA redação para as três superfícies (M6).
 *
 * O painel descreve a janela que o lojista está configurando, a vitrine diz
 * "quando volta" no selo do produto fora da janela e o cabeçalho da seção de
 * destaque diz até quando aquilo fica no ar. Se essas frases nascerem em três
 * componentes, elas divergem — o lojista configura "sáb e dom" e o cliente lê
 * outra coisa, e nenhum teste deste repo pegaria (seriam três strings em três
 * `.tsx`). Aqui são três funções puras sobre a MESMA tabela de nomes de dia.
 *
 * Fontes: Spec B RN-02, RN-07, RN-13, RN-15 · design §4.3, §9.5, §13.1.
 *
 * Toda aritmética de fuso vem de `./fusoLoja` e toda decisão de janela vem de
 * `./vigenciaCardapio` (mandato 2): nenhum `Intl`, nenhum parse de "HH:MM" e
 * nenhuma regra de dia reescritos aqui.
 *
 * Nada neste módulo decide SE o produto é comprável — só QUAL frase verdadeira
 * é exibida. A permissão de compra é de `avaliarVigenciaDoProduto` (246) e a
 * autoridade é o recálculo do pedido (RN-08).
 */

import { diaNoFuso, horaLocalNoFuso, instanteNoFuso, partesNoFusoCompletas } from "./fusoLoja";
import {
  cardapioAberto,
  type CardapioVigencia,
  type VinculoVigencia,
} from "./vigenciaCardapio";

/**
 * Fallback de render, e SÓ isso: por RN-13 todo produto que chega marcado à
 * vitrine tem uma volta a anunciar. Na revisão do carrinho (design §13.7) é
 * caso real de negócio — o item da temporada encerrada não tem data a prometer.
 */
export const ROTULO_SEM_VOLTA = "Indisponível no momento";

/** Teto do selo da vitrine (design §4.3): acima disso a pílula cobre o prato. */
const MAX_ROTULO = 32;
/** Teto do rótulo de janela ao lado do nome do cardápio (design §13.1). */
const MAX_ROTULO_DESTAQUE = 20;

/** RN-07: a varredura adiante do recorrente cobre `dias_mes = [31]` com folga. */
const LIMITE_DIAS = 400;
const DIA_MS = 24 * 60 * 60 * 1000;

const DIAS_LONGOS = [
  "domingo",
  "segunda",
  "terça",
  "quarta",
  "quinta",
  "sexta",
  "sábado",
] as const;
const DIAS_PLURAIS = [
  "domingos",
  "segundas",
  "terças",
  "quartas",
  "quintas",
  "sextas",
  "sábados",
] as const;
const DIAS_CURTOS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"] as const;

// ───────────────────────────────────────────────────────────────────────────
// Quando volta — o número que RN-07 e RN-13 consomem
// ───────────────────────────────────────────────────────────────────────────

/**
 * RN-07 — o primeiro instante, a partir de `agora`, em que este cardápio está
 * aberto. `null` = não há volta prevista.
 *
 * - inativo ⇒ `null` (RN-03: desligado não abre, não fecha e não restringe);
 * - aberto AGORA ⇒ `agora` (a abertura é esta);
 * - prazo fixo: `agora < inicio` ⇒ `inicio`; `agora >= fim` ⇒ `null`;
 * - recorrente: varredura adiante de até 400 dias CIVIS da loja, devolvendo o
 *   primeiro dia que casa a regra no `hora_inicio`; nada em 400 dias ⇒ `null`.
 *
 * A varredura NÃO reimplementa a regra de dia: ela pergunta a `cardapioAberto`
 * no instante candidato. Assim `dias_semana`, `dias_mes` e o `OU` entre eles
 * têm um dono só (246), e o dia 31 sai de graça — o candidato é construído a
 * partir de um dia que EXISTE no calendário, então nunca há 31/02.
 *
 * Custo: memoize por cardápio por request (RN-07), nunca por produto.
 */
export function proximaAbertura(
  cardapio: CardapioVigencia,
  agora: Date,
  timezone: string,
): Date | null {
  if (!cardapio.ativo) return null;
  if (cardapioAberto(cardapio, agora, timezone)) return agora;

  if (cardapio.modo === "prazo_fixo") {
    if (cardapio.prazo_inicio === null) return null;
    const inicio = new Date(cardapio.prazo_inicio);
    return agora.getTime() < inicio.getTime() ? inicio : null;
  }

  // Âncora ao MEIO-DIA local: somar 24h a partir do meio-dia nunca troca o dia
  // civil, nem em fuso com horário de verão. O dia civil sai de `diaNoFuso`.
  const meioDia = Date.parse(
    instanteNoFuso(`${diaNoFuso(agora, timezone)}T12:00`, timezone),
  );
  const hora = (cardapio.hora_inicio ?? "00:00").slice(0, 5);

  for (let d = 0; d <= LIMITE_DIAS; d++) {
    const dia = diaNoFuso(new Date(meioDia + d * DIA_MS), timezone);
    const abertura = new Date(instanteNoFuso(`${dia}T${hora}`, timezone));
    if (abertura.getTime() < agora.getTime()) continue;
    if (cardapioAberto(cardapio, abertura, timezone)) return abertura;
  }
  return null;
}

/**
 * RN-07 — de N cardápios fechados, o dono da frase é o que ABRE MAIS CEDO.
 *
 * A escada determinística, na ordem: `proximaAbertura` crescente, `null` por
 * último, empate por `nome` (`localeCompare` pt-BR) e depois por `id`. É a
 * MESMA escada da ordem das seções de destaque (RN-15) — duas ordenações
 * diferentes de cardápio é como nasce bug de "a frase mudou sozinha".
 *
 * [273/RN-09] Devolve o VÍNCULO, não o cardápio: é o `dias_semana` do item que
 * a frase lê. A escada continua sendo `proximaAbertura` DO CARDÁPIO — duas
 * ordenações de cardápio é como nasce bug de "a frase mudou sozinha".
 *
 * Se o melhor candidato não tem volta (`null`), NÃO há frase a escolher: o
 * caller usa `ROTULO_SEM_VOLTA` e, por RN-13, esse produto normalmente nem
 * chega à vitrine.
 *
 * `proxima` entra por parâmetro para que a memoização de RN-07 (uma vez por
 * cardápio por request) more no caller, e não num cache global escondido aqui.
 */
export function escolherVinculoParaRotulo<C extends CardapioVigencia>(
  vinculos: VinculoVigencia<C>[],
  proxima: (cardapio: C) => Date | null,
): VinculoVigencia<C> | null {
  const candidatos = vinculos
    .filter((v) => v.cardapio.ativo)
    .map((v) => ({ vinculo: v, cardapio: v.cardapio, abertura: proxima(v.cardapio) }));
  if (candidatos.length === 0) return null;

  candidatos.sort((a, b) => {
    if (a.abertura !== null && b.abertura !== null) {
      const delta = a.abertura.getTime() - b.abertura.getTime();
      if (delta !== 0) return delta;
    } else if (a.abertura === null && b.abertura !== null) {
      return 1;
    } else if (a.abertura !== null && b.abertura === null) {
      return -1;
    }
    const porNome = a.cardapio.nome.localeCompare(b.cardapio.nome, "pt-BR");
    if (porNome !== 0) return porNome;
    return a.cardapio.id.localeCompare(b.cardapio.id);
  });

  const escolhido = candidatos[0];
  return escolhido.abertura === null ? null : escolhido.vinculo;
}

// ───────────────────────────────────────────────────────────────────────────
// As três redações
// ───────────────────────────────────────────────────────────────────────────

/**
 * A frase LONGA da prévia do painel (design §9.5), no fuso da loja.
 *
 * `agora` é OPCIONAL de propósito: enquanto o lojista edita, a prévia descreve
 * a configuração sem afirmar nada sobre o presente (design §9.4, a linha
 * "Agora:" só existe para o que está salvo). Com `agora`, o prazo fixo ganha as
 * três leituras da tabela (futuro, em curso, encerrado).
 */
export function descreverVigencia(
  cardapio: CardapioVigencia,
  timezone: string,
  agora?: Date,
): string {
  if (cardapio.modo === "prazo_fixo") {
    return descreverPrazoFixo(cardapio, timezone, agora);
  }

  const semana = ordenarSemana(cardapio.dias_semana);
  const mes = ordenarMes(cardapio.dias_mes);
  const temTrinta = mes.includes(31);
  const partes: string[] = [];

  if (semana.length > 0) partes.push(descreverDiasDaSemana(semana, "longa"));

  if (mes.length > 0) {
    const listaDeDias = `todo ${enumerar(mes.map((d) => `dia ${d}`))}`;
    // A conjunção "e também" é OBRIGATÓRIA quando os dois eixos coexistem: é a
    // leitura `OU` de RN-02 dita em português (4 dias no ano contra ~120).
    partes.push(
      semana.length > 0
        ? `e também ${listaDeDias}`
        : // "do mês" só quando o dia do mês é o único eixo — e a nota do dia 31
          // toma o lugar dele, como na tabela do design §9.5.
          temTrinta
          ? listaDeDias
          : `${listaDeDias} do mês`,
    );
  }

  if (partes.length === 0) partes.push("todo dia");

  const nota = temTrinta ? " — nos meses de 30 dias, não aparece" : "";
  return `Aparece ${partes.join(", ")}${faixaDeHoras(cardapio)}${nota}.`;
}

/**
 * O selo CURTO da vitrine (design §4.3), no máximo 32 caracteres — o corte é
 * aplicado AQUI, na função pura, nunca no CSS: assim ele é afirmável byte a
 * byte sem DOM.
 *
 * Pré-condição do caller: este vínculo foi escolhido por
 * `escolherVinculoParaRotulo`, ou seja, o cardápio está FECHADO e TEM volta, ou
 * está ABERTO e é o ITEM que não é do dia (273/RN-08). Por isso o
 * prazo fixo aqui só tem uma leitura ("A partir de dd/MM") — prazo encerrado
 * não produz selo porque não produz card (RN-13).
 */
export function rotuloVoltaQuando(
  vinculo: VinculoVigencia,
  agora: Date,
  timezone: string,
): string {
  // [273/RN-08] A PRECEDÊNCIA mora aqui, numa casa só: cardápio fechado vence
  // item fora do dia. Espalhar a escolha pelos callers seria a lista de guards
  // em N caminhos que o mandato 2 proíbe.
  const texto = cardapioAberto(vinculo.cardapio, agora, timezone)
    ? textoDoSeloDoItem(vinculo, timezone)
    : textoDoSelo(vinculo.cardapio, timezone);
  return cortar(texto, MAX_ROTULO);
}

/**
 * O rótulo de janela do cabeçalho da seção de destaque (design §13.1), no
 * máximo 20 caracteres — `Até domingo` · `Hoje, até as 15:00` · `Hoje`.
 *
 * Só é chamado para cardápio ABERTO agora (a seção só existe assim, RN-15).
 */
export function rotuloJanelaDestaque(
  cardapio: CardapioVigencia,
  agora: Date,
  timezone: string,
): string {
  return cortar(textoDoDestaque(cardapio, agora, timezone), MAX_ROTULO_DESTAQUE);
}

// ───────────────────────────────────────────────────────────────────────────
// Montagem das frases
// ───────────────────────────────────────────────────────────────────────────

function descreverPrazoFixo(
  cardapio: CardapioVigencia,
  timezone: string,
  agora?: Date,
): string {
  const { prazo_inicio: inicio, prazo_fim: fim } = cardapio;
  // Estado impossível pelo CHECK `cardapios_prazo_obrigatorio` (o par é
  // obrigatório). Defensivo, sem inventar uma redação de calendário.
  if (inicio === null || fim === null) return "Aparece por tempo determinado.";

  const abre = partesLocais(inicio, timezone);
  const fecha = partesLocais(fim, timezone);
  const instante = agora?.getTime();

  if (instante !== undefined && instante >= Date.parse(fim)) {
    return `Terminou em ${fecha.data}. Este cardápio não aparece mais.`;
  }
  if (instante !== undefined && instante >= Date.parse(inicio)) {
    return `Está aparecendo desde ${abre.data} e some em ${fecha.data}, às ${fecha.hora}.`;
  }
  return `Aparece de ${abre.data}, ${abre.hora} até ${fecha.data}, ${fecha.hora}.`;
}

function textoDoSelo(cardapio: CardapioVigencia, timezone: string): string {
  if (cardapio.modo === "prazo_fixo") {
    if (cardapio.prazo_inicio === null) return ROTULO_SEM_VOLTA;
    return `A partir de ${partesLocais(cardapio.prazo_inicio, timezone).data}`;
  }

  const semana = ordenarSemana(cardapio.dias_semana);
  const mes = ordenarMes(cardapio.dias_mes);
  const horas = faixaCurta(cardapio);

  if (semana.length > 0 && mes.length > 0) {
    // Os dois eixos SOMAM (RN-02 é OU), e a forma curta usa a abreviação.
    const itens = [...semana.map((d) => DIAS_CURTOS[d]), ...mes.map((d) => `dia ${d}`)];
    return `${maiuscula(enumerar(itens))}${horas}`;
  }

  if (semana.length > 0) {
    if (horas === "") return fraseSoNosDias(semana);
    return `${maiuscula(descreverDiasDaSemana(semana, "curta"))}${horas}`;
  }

  if (mes.length > 0) {
    if (horas === "") {
      return mes.length === 1
        ? `Só no dia ${mes[0]}`
        : `Só nos dias ${enumerar(mes.map(String))}`;
    }
    return `${maiuscula(enumerar(mes.map((d) => `dia ${d}`)))}${horas}`;
  }

  const { hora_inicio: inicio, hora_fim: fim } = cardapio;
  if (inicio !== null && fim !== null) {
    return `Só das ${hhmm(inicio)} às ${hhmm(fim)}`;
  }
  // Sem nenhum eixo: recusado pelo CHECK `cardapios_recorrente_tem_eixo`.
  return ROTULO_SEM_VOLTA;
}

/**
 * [273/RN-08] O selo do ITEM fora do dia, num cardápio ABERTO: os dias vêm do
 * VÍNCULO e a faixa de horas continua vindo do CARDÁPIO (o item não tem
 * horário próprio). Mesma tabela de nomes de dia, mesma enumeração.
 *
 * Vínculo sem dias num cardápio aberto não produz selo (o item está à venda);
 * o fallback defensivo devolve a frase do cardápio em vez de inventar uma.
 */
function textoDoSeloDoItem(vinculo: VinculoVigencia, timezone: string): string {
  const semana = ordenarSemana(vinculo.dias_semana);
  if (semana.length === 0) return textoDoSelo(vinculo.cardapio, timezone);

  const horas = faixaCurta(vinculo.cardapio);
  if (horas === "") return fraseSoNosDias(semana);
  return `${maiuscula(descreverDiasDaSemana(semana, "curta"))}${horas}`;
}

function textoDoDestaque(
  cardapio: CardapioVigencia,
  agora: Date,
  timezone: string,
): string {
  if (cardapio.modo === "recorrente") {
    return cardapio.hora_fim === null ? "Hoje" : `Hoje, até as ${hhmm(cardapio.hora_fim)}`;
  }

  const fim = cardapio.prazo_fim;
  if (fim === null) return "Hoje";

  const fecha = partesLocais(fim, timezone);
  const faltam = Date.parse(fim) - agora.getTime();
  // Dentro da semana, o dia da semana é mais legível que a data; além dela,
  // "até sábado" seria ambíguo (qual sábado?), então vai a data.
  if (faltam > 0 && faltam <= 7 * DIA_MS) {
    const { diaIndex } = partesNoFusoCompletas(new Date(fim), timezone);
    return `Até ${DIAS_LONGOS[diaIndex]}`;
  }
  return `Até ${fecha.data}`;
}

// ───────────────────────────────────────────────────────────────────────────
// Peças de texto
// ───────────────────────────────────────────────────────────────────────────

/** Semana ordenada COMEÇANDO NA SEGUNDA: {sáb, dom} lê "sábado e domingo". */
function ordenarSemana(dias: number[] | null): number[] {
  return [...new Set(dias ?? [])]
    .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
    .sort((a, b) => rank(a) - rank(b));
}

function ordenarMes(dias: number[] | null): number[] {
  return [...new Set(dias ?? [])]
    .filter((d) => Number.isInteger(d) && d >= 1 && d <= 31)
    .sort((a, b) => a - b);
}

/** 0=dom vira o ÚLTIMO da semana; seg=0 .. dom=6. */
function rank(dia: number): number {
  return (dia + 6) % 7;
}

/**
 * Três ou mais dias CONSECUTIVOS viram "de X a Y" ("de segunda a sexta"). Com
 * dois, a lista é mais curta e mais clara ("sábado e domingo").
 */
function corridaDaSemana(
  semana: number[],
): { primeiro: number; ultimo: number } | null {
  if (semana.length < 3) return null;
  for (let i = 1; i < semana.length; i++) {
    if (rank(semana[i]) !== rank(semana[i - 1]) + 1) return null;
  }
  return { primeiro: semana[0], ultimo: semana[semana.length - 1] };
}

/**
 * [273/RN-07] Os dias da semana em português, na forma LONGA da prévia do
 * painel ou na CURTA do selo — uma casa só para as duas redações.
 *
 * O curto-circuito dos 7 dias vem ANTES de `corridaDaSemana`: o lojista que
 * clicou "Todos os dias" lê "todos os dias", não "de segunda a domingo".
 */
function descreverDiasDaSemana(semana: number[], forma: "longa" | "curta"): string {
  if (semana.length === 7) return "todos os dias";

  const corrida = corridaDaSemana(semana);
  if (forma === "longa") {
    return corrida
      ? `de ${DIAS_LONGOS[corrida.primeiro]} a ${DIAS_LONGOS[corrida.ultimo]}`
      : `todo ${enumerar(semana.map((d) => DIAS_LONGOS[d]))}`;
  }
  return corrida
    ? `${DIAS_CURTOS[corrida.primeiro]} a ${DIAS_CURTOS[corrida.ultimo]}`
    : enumerar(semana.map((d) => DIAS_CURTOS[d]));
}

/**
 * [273/D4] "Só de segunda a sexta" · "Só às quartas e sábados" · "Só aos
 * sábados e domingos" — a forma sem faixa de horas, do cardápio E do item.
 */
function fraseSoNosDias(semana: number[]): string {
  if (semana.length === 7) return maiuscula(descreverDiasDaSemana(semana, "longa"));

  if (corridaDaSemana(semana)) return `Só ${descreverDiasDaSemana(semana, "longa")}`;
  const plurais = enumerar(semana.map((d) => DIAS_PLURAIS[d]));
  return `Só ${preposicaoPlural(semana[0])} ${plurais}`;
}

/**
 * [273/D4] A preposição concorda com o PRIMEIRO dia enumerado (ordem
 * seg-first): domingo e sábado são masculinos ("aos"), o resto é feminino
 * ("às"). Uma regra, as duas redações — nunca "Só aos quartas".
 */
function preposicaoPlural(dia: number): string {
  return dia === 0 || dia === 6 ? "aos" : "às";
}

/** "a" · "a e b" · "a, b e c" — o "e" antes do último, sempre. */
function enumerar(itens: string[]): string {
  if (itens.length <= 1) return itens[0] ?? "";
  return `${itens.slice(0, -1).join(", ")} e ${itens[itens.length - 1]}`;
}

/** ", das 11:00 às 15:00" — vazio quando o cardápio não restringe horário. */
function faixaDeHoras(cardapio: CardapioVigencia): string {
  const { hora_inicio: inicio, hora_fim: fim } = cardapio;
  if (inicio === null || fim === null) return "";
  return `, das ${hhmm(inicio)} às ${hhmm(fim)}`;
}

/** ", 11:00–15:00" — a forma curta do selo (design §4.3). */
function faixaCurta(cardapio: CardapioVigencia): string {
  const { hora_inicio: inicio, hora_fim: fim } = cardapio;
  if (inicio === null || fim === null) return "";
  return `, ${hhmm(inicio)}–${hhmm(fim)}`;
}

/** O `time` do Postgres chega "HH:MM:SS"; a frase diz "HH:MM". */
function hhmm(hora: string): string {
  return hora.slice(0, 5);
}

/** Data "dd/MM" e hora "HH:MM" de um `timestamptz`, no fuso da LOJA. */
function partesLocais(iso: string, timezone: string): { data: string; hora: string } {
  const [data, hora] = horaLocalNoFuso(iso, timezone).split("T");
  const [, mes, dia] = data.split("-");
  return { data: `${dia}/${mes}`, hora };
}

function maiuscula(texto: string): string {
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

/** O corte mora na função pura (design §4.3), com reticências visíveis. */
function cortar(texto: string, maximo: number): string {
  if (texto.length <= maximo) return texto;
  return `${texto.slice(0, maximo - 1).trimEnd()}…`;
}

// ───────────────────────────────────────────────────────────────────────────
// Rótulos do PAINEL (256, 259) — a terceira e a quarta superfície de M6
// ───────────────────────────────────────────────────────────────────────────

/**
 * [256] O rótulo do badge de cardápio FECHADO que ainda tem volta:
 * `Abre hoje às 11:00` · `Abre sábado às 11:00` · `Abre em 23/12 às 11:00`.
 *
 * Mora AQUI e não no `.tsx` pelo mesmo motivo de M6: a tabela de nomes de dia
 * tem um dono só. Dentro da semana o nome do dia é mais legível; além dela
 * "sábado" seria ambíguo (qual sábado?), então vai a data — a mesma escada de
 * `textoDoDestaque`.
 *
 * `abertura` vem de `proximaAbertura` (RN-07) e `agora` é injetado: nenhum
 * relógio é lido aqui dentro.
 */
export function rotuloAbreQuando(
  abertura: Date,
  agora: Date,
  timezone: string,
): string {
  const { data, hora } = partesLocais(abertura.toISOString(), timezone);

  if (diaNoFuso(abertura, timezone) === diaNoFuso(agora, timezone)) {
    return `Abre hoje às ${hora}`;
  }

  const faltam = abertura.getTime() - agora.getTime();
  if (faltam > 0 && faltam <= 7 * DIA_MS) {
    const { diaIndex } = partesNoFusoCompletas(abertura, timezone);
    return `Abre ${DIAS_LONGOS[diaIndex]} às ${hora}`;
  }
  return `Abre em ${data} às ${hora}`;
}

/**
 * [259] A linha "Agora:" da prévia (design §9.4), no fuso da LOJA:
 * `Agora (sáb, 19/09, 13:04): APARECENDO`.
 *
 * `aparecendo` é o veredito de `cardapioAberto` calculado NO SERVIDOR. Esta
 * função não decide nada — só escreve a frase. Por design §9.4 item 3, a linha
 * só existe para a configuração SALVA: derivá-la do relógio do browser diria
 * ao lojista algo que o cliente não vê.
 */
export function rotuloAgora(
  agora: Date,
  timezone: string,
  aparecendo: boolean,
): string {
  const { diaIndex } = partesNoFusoCompletas(agora, timezone);
  const { data, hora } = partesLocais(agora.toISOString(), timezone);
  const veredito = aparecendo ? "APARECENDO" : "NÃO APARECE";
  return `Agora (${DIAS_CURTOS[diaIndex]}, ${data}, ${hora}): ${veredito}`;
}
