/**
 * [256] O estado AO VIVO do cardápio no painel — os cinco rótulos de
 * `design §13.3`, derivados por função pura.
 *
 * Por que um módulo e não um `if` no `.tsx`:
 *
 *  - o estado é SSR, recalculado a cada render (design §13.3 regra 3). Nenhum
 *    `setInterval`, nenhuma coluna "expirado" mantida em dia, nenhum job — e
 *    nenhum relógio do browser, que diria a hora do dispositivo e não a da
 *    loja;
 *  - `agora` e `timezone` entram por PARÂMETRO, como em `calcularFrete` e em
 *    todo o resto da vigência (mandato 2);
 *  - a decisão de janela é de `cardapioAberto`/`proximaAbertura` (246/254) e a
 *    redação de "quando abre" é de `rotuloAbreQuando` (M6). Aqui só mora a
 *    ESCADA de precedência entre os cinco estados, que é a única coisa nova.
 *
 * Nada aqui decide permissão: é preview de UX para o lojista. A autoridade da
 * janela é a função pura no servidor (RN-06).
 */

import { horaLocalNoFuso } from "./fusoLoja";
import { cardapioAberto, type CardapioVigencia } from "./vigenciaCardapio";
import { proximaAbertura, rotuloAbreQuando } from "./descreverVigencia";

/**
 * Cor de SISTEMA (design-system §8), nunca cor do tema da loja. O VERMELHO
 * fica de fora de propósito (§13.3): cardápio de temporada encerrada não é
 * falha, e vermelho aqui ensina o lojista a ignorar vermelho.
 */
export type TomDeEstado = "verde" | "ambar" | "neutro";

export type EstadoCardapio = {
  tom: TomDeEstado;
  /** O texto do badge. Carrega a informação inteira — cor nunca é o dado. */
  rotulo: string;
  /** `aria-label` completo quando o rótulo é abreviado; `null` quando não é. */
  rotuloAcessivel: string | null;
  /**
   * O cardápio está aparecendo na vitrine NESTE instante. É o que habilita a
   * frase de efeito de D16 ("aparecendo como seção no topo da sua loja") —
   * inclusive no estado âmbar, que também está no ar, só que acabando.
   */
  abertoAgora: boolean;
};

const DIA_MS = 24 * 60 * 60 * 1000;

/** Design §13.3: o âmbar começa a 7 dias do fim, não antes. */
const JANELA_DE_EXPIRACAO_MS = 7 * DIA_MS;

function partesLocais(
  iso: string,
  timezone: string,
): { data: string; hora: string } {
  const [data, hora] = horaLocalNoFuso(iso, timezone).split("T");
  const [, mes, dia] = data.split("-");
  return { data: `${dia}/${mes}`, hora };
}

/**
 * A escada, na ordem em que os estados se excluem:
 *
 *  1. desligado — RN-03: não abre, não fecha e não restringe. Vem primeiro
 *     porque um cardápio desligado dentro da janela NÃO está aparecendo;
 *  2. aberto agora e terminando em ≤7 dias — `Expira em N dias` / `Expira hoje
 *     às HH:MM` (âmbar: requer ação do lojista, mesma semântica de `pendente`
 *     em design-system §8.2);
 *  3. aberto agora — `Aberto agora`, a MESMA palavra do status da loja;
 *  4. fechado com volta prevista — `Abre sábado às 11:00`;
 *  5. fechado sem volta — `Expirado`. Cobre o prazo fixo já encerrado (sem
 *     volta, por definição) e o recorrente sem ocorrência em 400 dias.
 */
export function estadoDoCardapio(
  cardapio: CardapioVigencia,
  agora: Date,
  timezone: string,
): EstadoCardapio {
  if (!cardapio.ativo) {
    return {
      tom: "neutro",
      rotulo: "Desligado",
      rotuloAcessivel: null,
      abertoAgora: false,
    };
  }

  const aberto = cardapioAberto(cardapio, agora, timezone);

  if (aberto) {
    const expiracao = rotuloDeExpiracao(cardapio, agora, timezone);
    if (expiracao !== null) return { ...expiracao, abertoAgora: true };
    return {
      tom: "verde",
      rotulo: "Aberto agora",
      rotuloAcessivel: null,
      abertoAgora: true,
    };
  }

  const abertura = proximaAbertura(cardapio, agora, timezone);
  if (abertura !== null) {
    return {
      tom: "neutro",
      rotulo: rotuloAbreQuando(abertura, agora, timezone),
      rotuloAcessivel: null,
      abertoAgora: false,
    };
  }

  return {
    tom: "neutro",
    rotulo: "Expirado",
    rotuloAcessivel: null,
    abertoAgora: false,
  };
}

/**
 * `null` quando o cardápio não está na reta final: só prazo fixo com `fim`
 * dentro dos próximos 7 dias produz âmbar. Recorrente nunca expira — ele volta.
 */
function rotuloDeExpiracao(
  cardapio: CardapioVigencia,
  agora: Date,
  timezone: string,
): Omit<EstadoCardapio, "abertoAgora"> | null {
  if (cardapio.modo !== "prazo_fixo" || cardapio.prazo_fim === null) {
    return null;
  }

  const faltam = Date.parse(cardapio.prazo_fim) - agora.getTime();
  if (faltam <= 0 || faltam > JANELA_DE_EXPIRACAO_MS) return null;

  const { data, hora } = partesLocais(cardapio.prazo_fim, timezone);

  // Abaixo de 24h o número de dias some e o horário entra: "em 0 dias" não
  // diz nada, e é justamente aqui que a hora importa.
  if (faltam < DIA_MS) {
    return {
      tom: "ambar",
      rotulo: `Expira hoje às ${hora}`,
      rotuloAcessivel: null,
    };
  }

  const dias = Math.ceil(faltam / DIA_MS);
  const rotulo = `Expira em ${dias} ${dias === 1 ? "dia" : "dias"}`;
  return {
    tom: "ambar",
    rotulo,
    // Design §13.3 regra 4: o rótulo é abreviado, então o leitor de tela
    // recebe a data por extenso.
    rotuloAcessivel: `${rotulo}, em ${data} às ${hora}`,
  };
}
