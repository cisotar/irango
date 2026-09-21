/**
 * Vigência de cardápio — o ÚNICO lugar do projeto onde "este produto pode ser
 * comprado agora?" vira decisão (issue 246, RN-02..RN-05 e RN-13).
 *
 * Função pura: `agora` e `timezone` entram por parâmetro, nunca `new Date()`
 * aqui dentro. O browser nunca decide vigência — quem chama é o SSR da vitrine,
 * a revisão do carrinho e o recálculo autoritativo do pedido, sempre no
 * servidor, com o relógio do servidor e o fuso da LOJA.
 *
 * Toda a aritmética de fuso vem de `./fusoLoja` (mandato 2): nenhum `Intl` e
 * nenhum parse de "HH:MM" escritos aqui.
 */

import { paraMinutos, partesNoFusoCompletas } from "./fusoLoja";

/** Um cardápio reduzido ao que decide vigência (RN-01..RN-04). */
export type CardapioVigencia = {
  id: string;
  nome: string;
  ativo: boolean;
  modo: "recorrente" | "prazo_fixo";
  /** 0=dom..6=sab. NULL ou vazio = sem restrição por este eixo. */
  dias_semana: number[] | null;
  /** 1..31. NULL ou vazio = sem restrição por este eixo. */
  dias_mes: number[] | null;
  /** "HH:MM" ou "HH:MM:SS" (o `time` do Postgres). INCLUSIVO. */
  hora_inicio: string | null;
  /** "HH:MM" ou "HH:MM:SS". EXCLUSIVO. */
  hora_fim: string | null;
  /** ISO-8601 (timestamptz). INCLUSIVO. */
  prazo_inicio: string | null;
  /** ISO-8601 (timestamptz). EXCLUSIVO. */
  prazo_fim: string | null;
};

/** O que da vigência do produto interessa a RN-05/RN-13. */
export type ProdutoVigencia = {
  visibilidade: "menu" | "cardapio";
};

/** O par que RN-05 e RN-13 exigem. */
export type VigenciaDoProduto = {
  dentroDaJanela: boolean;
  visivelNaVitrine: boolean;
};

/**
 * RN-04 — prazo fixo: `prazo_inicio <= agora < prazo_fim`. Comparação de
 * INSTANTE com INSTANTE: o fuso da loja não participa (os dois extremos já são
 * `timestamptz`), então o parâmetro `timezone` não muda o veredito.
 * Início inclusivo, fim exclusivo — a convenção de `lojaAberta` e do prazo de
 * desconto.
 */
function dentroDoPrazo(cardapio: CardapioVigencia, agora: Date): boolean {
  const instante = agora.getTime();

  if (cardapio.prazo_inicio !== null) {
    if (instante < Date.parse(cardapio.prazo_inicio)) return false;
  }
  if (cardapio.prazo_fim !== null) {
    if (instante >= Date.parse(cardapio.prazo_fim)) return false;
  }
  return true;
}

/**
 * RN-02 — recorrente. Regra FECHADA:
 *
 *   diaOk  = (dias_semana vazio E dias_mes vazio) ? true
 *                                                 : contém(diaIndex) OU contém(diaDoMes)
 *   horaOk = hora_inicio === null ? true : minutos >= inicio E minutos < fim
 *   aberto = diaOk E horaOk
 *
 * O `OU` é o que faz quarta-feira dia 15 abrir num cardápio {sáb,dom} + {1,15}.
 * Eixo vazio é SEM RESTRIÇÃO, nunca "nenhum dia" — e array vazio conta como
 * vazio igual a NULL (a Action normaliza, mas dado antigo pode não).
 */
function dentroDaRecorrencia(
  cardapio: CardapioVigencia,
  agora: Date,
  timezone: string,
): boolean {
  const { diaIndex, diaDoMes, minutos } = partesNoFusoCompletas(agora, timezone);

  const diasSemana = cardapio.dias_semana ?? [];
  const diasMes = cardapio.dias_mes ?? [];
  const semRestricaoDeDia = diasSemana.length === 0 && diasMes.length === 0;
  const diaOk =
    semRestricaoDeDia ||
    diasSemana.includes(diaIndex) ||
    diasMes.includes(diaDoMes);

  const { hora_inicio: inicio, hora_fim: fim } = cardapio;
  const horaOk =
    inicio === null || fim === null
      ? true
      : minutos >= paraMinutos(inicio) && minutos < paraMinutos(fim);

  return diaOk && horaOk;
}

/**
 * O cardápio está aberto NESTE instante, no fuso da loja?
 *
 * RN-03: `ativo = false` não participa de nada — não abre, não fecha, não
 * restringe. A regra mora aqui e não na RLS porque o caminho autoritativo do
 * pedido roda sob `service_role` (BYPASSRLS), onde uma policy não existiria.
 */
export function cardapioAberto(
  cardapio: CardapioVigencia,
  agora: Date,
  timezone: string,
): boolean {
  if (!cardapio.ativo) return false;

  return cardapio.modo === "prazo_fixo"
    ? dentroDoPrazo(cardapio, agora)
    : dentroDaRecorrencia(cardapio, agora, timezone);
}

/**
 * Existe alguma abertura FUTURA deste cardápio? Predicado mínimo de RN-13 — o
 * texto de "quando volta" (`proximaAbertura`/`descreverVigencia`) é da issue
 * 254 e não tem segunda implementação aqui: esta função é privada de propósito.
 *
 * Recorrente ativo com faixa de horário não-degenerada repete para sempre;
 * prazo fixo só tem futuro enquanto não expirou. Inativo já foi descartado
 * antes de chegar aqui (RN-03: não conta nem como abertura futura).
 */
function voltaAAbrir(cardapio: CardapioVigencia, agora: Date): boolean {
  if (cardapio.modo === "prazo_fixo") {
    return (
      cardapio.prazo_fim === null ||
      agora.getTime() < Date.parse(cardapio.prazo_fim)
    );
  }

  const { hora_inicio: inicio, hora_fim: fim } = cardapio;
  if (inicio === null || fim === null) return true;
  return paraMinutos(inicio) < paraMinutos(fim);
}

/**
 * RN-05 + RN-13 — o par que a vitrine e o recálculo do pedido consomem.
 *
 * `dentroDaJanela` é a permissão de compra (união entre os cardápios do
 * produto: basta UM aberto). `visivelNaVitrine` é a existência do item para o
 * cliente: produto do menu sempre existe, produto de cardápio existe enquanto
 * estiver aberto ou ainda tiver uma abertura pela frente.
 *
 * RN-05/D14: `visibilidade === 'menu'` curto-circuita ANTES de qualquer acesso
 * à lista de cardápios — o produto do menu não é afetado nem por cardápio
 * expirado nem por cardápio desligado.
 */
export function avaliarVigenciaDoProduto(
  produto: ProdutoVigencia,
  cardapios: CardapioVigencia[],
  agora: Date,
  timezone: string,
): VigenciaDoProduto {
  if (produto.visibilidade === "menu") {
    return { dentroDaJanela: true, visivelNaVitrine: true };
  }

  const ativos = cardapios.filter((c) => c.ativo);
  const dentroDaJanela = ativos.some((c) => cardapioAberto(c, agora, timezone));
  const visivelNaVitrine =
    dentroDaJanela || ativos.some((c) => voltaAAbrir(c, agora));

  return { dentroDaJanela, visivelNaVitrine };
}
