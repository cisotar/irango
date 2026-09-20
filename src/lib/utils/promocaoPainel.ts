/**
 * Apresentação de promoção NO PAINEL — funções PURAS, sem relógio próprio e
 * sem fórmula monetária própria (issues 235/223).
 *
 * Dois consumidores, duas metades:
 *
 *   1. `projetarPromocaoDoPainel` roda no SERVER COMPONENT de
 *      `/painel/produtos` (e na página irmã do hub admin). É ele quem decide
 *      "está vigente agora" e o rótulo do chip — nunca o `ProdutosClient`:
 *      derivar vigência no browser duplicaria RN-03 e usaria o relógio do
 *      dispositivo, que a loja não controla (design §8.4).
 *   2. `juntarPrazoLocal` / `separarPrazoLocal` / `previaNaVitrine` servem ao
 *      `FormProduto`. Nenhuma delas converte fuso: os prazos já chegam e saem
 *      em hora LOCAL da loja (`"YYYY-MM-DDTHH:MM"`), e quem faz a travessia
 *      para instante absoluto é `comPrazosNoFuso`, na Server Action.
 *
 * A vigência e o preço saem de `precoEfetivo` — a MESMA função pura do
 * servidor, nunca uma segunda fórmula.
 */

import { precoEfetivo, type ProdutoComDesconto } from "./precoEfetivo";
import { rotuloPrecoAcessivel } from "./rotuloPrecoAcessivel";
import { horaLocalNoFuso } from "./fusoLoja";

/** Tipo de desconto como o form o manipula: `null` = nunca configurado. */
export type TipoDesconto = "percentual" | "fixo" | null;

/** O que o Server Component projeta por produto para a lista e para o form. */
export type PromocaoDoPainel = {
  /** Há desconto valendo NESTE instante (RN-03, avaliado no servidor). */
  vigente: boolean;
  /** Chip da lista: `-20% até 30/09`, `-20%`, ou `null` quando não vigente. */
  rotulo: string | null;
  /** `desconto_inicio` em hora local da loja, pronto para o form. */
  inicioLocal: string | null;
  /** `desconto_fim` em hora local da loja, pronto para o form. */
  fimLocal: string | null;
};

/** `30/09` no fuso da loja — o lojista lê o prazo no horário dele. */
function diaEMes(instanteIso: string, timezone: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: timezone,
    day: "2-digit",
    month: "2-digit",
  }).format(new Date(instanteIso));
}

export function projetarPromocaoDoPainel(
  produto: ProdutoComDesconto,
  agora: Date,
  timezone: string,
): PromocaoDoPainel {
  const { temDesconto, seloDesconto } = precoEfetivo(produto, agora);

  // O prazo volta ao form SEMPRE que existe na linha — inclusive com a
  // promoção desligada ou fora da janela. RN-07: desligar preserva prazo, e
  // um form que esquecesse o prazo apagaria a configuração no próximo salvar.
  const inicioLocal =
    produto.desconto_inicio != null
      ? horaLocalNoFuso(produto.desconto_inicio, timezone)
      : null;
  const fimLocal =
    produto.desconto_fim != null
      ? horaLocalNoFuso(produto.desconto_fim, timezone)
      : null;

  if (!temDesconto || seloDesconto == null) {
    return { vigente: false, rotulo: null, inicioLocal, fimLocal };
  }

  // "ainda está valendo?" é a pergunta que o lojista traz ao abrir a tela: o
  // fim entra no rótulo quando existe, e some quando a promoção não tem prazo.
  const rotulo =
    produto.desconto_fim != null
      ? `${seloDesconto} até ${diaEMes(produto.desconto_fim, timezone)}`
      : seloDesconto;

  return { vigente: true, rotulo, inicioLocal, fimLocal };
}

const FORMATO_DATA = /^\d{4}-\d{2}-\d{2}$/;
const FORMATO_HORA = /^\d{2}:\d{2}$/;

/**
 * `<input type="date">` + `<input type="time">` → o `"YYYY-MM-DDTHH:MM"` que o
 * `schemaProduto` espera. Campos separados são decisão de desenho (§8.1): o
 * `datetime-local` se apresenta como horário DO DISPOSITIVO e não deixa espaço
 * para a linha "no fuso da loja".
 *
 * Qualquer metade vazia/malformada ⇒ `null` (sem prazo). Nada de hora
 * inventada: prazo pela metade não é prazo.
 */
export function juntarPrazoLocal(data: string, hora: string): string | null {
  if (!FORMATO_DATA.test(data) || !FORMATO_HORA.test(hora)) return null;
  return `${data}T${hora}`;
}

/** Inverso de `juntarPrazoLocal`, para preencher os dois inputs. */
export function separarPrazoLocal(local: string | null | undefined): {
  data: string;
  hora: string;
} {
  if (local == null) return { data: "", hora: "" };
  const [data = "", hora = ""] = local.split("T");
  return FORMATO_DATA.test(data) && FORMATO_HORA.test(hora)
    ? { data, hora }
    : { data: "", hora: "" };
}

/**
 * Instante de referência da PRÉVIA. A prévia responde "quanto o desconto tira
 * do preço", não "está vigente agora" — por isso ela avalia o par tipo+valor
 * com a janela aberta, e assim NÃO lê o relógio do dispositivo em lugar nenhum
 * (quem decide vigência é o servidor, RN-03).
 */
const INSTANTE_NEUTRO = new Date(0);

/**
 * Linha `De R$ 100,00 por R$ 90,00` da prévia do form, via `precoEfetivo` +
 * `rotuloPrecoAcessivel` — as mesmas funções da vitrine.
 *
 * `null` quando o preço ainda não é um número (campo vazio/em digitação): a
 * prévia some em vez de mostrar `R$ NaN`.
 */
export function previaNaVitrine(entrada: {
  preco: number;
  ativo: boolean;
  tipo: TipoDesconto;
  valor: number | null;
}): string | null {
  if (!Number.isFinite(entrada.preco) || entrada.preco < 0) return null;

  const { precoEfetivo: efetivo, temDesconto } = precoEfetivo(
    {
      preco: entrada.preco,
      desconto_ativo: entrada.ativo,
      desconto_tipo: entrada.tipo,
      desconto_valor: entrada.valor,
      desconto_inicio: null,
      desconto_fim: null,
    },
    INSTANTE_NEUTRO,
  );

  return rotuloPrecoAcessivel({
    preco: entrada.preco,
    precoEfetivo: efetivo,
    temDesconto,
  });
}
