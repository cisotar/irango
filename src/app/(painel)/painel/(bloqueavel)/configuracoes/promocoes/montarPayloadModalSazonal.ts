/**
 * Montagem do payload do FORM do modal sazonal (issue 302).
 *
 * Função PURA extraída do `PromocoesClient` para ser testável sem DOM (o projeto
 * não tem jsdom): os campos entram como argumento e o componente só passa o
 * estado. Molde: `montarPayloadPerfil`.
 *
 * A saída é entrada de `schemaModalSazonal.safeParse` (o MESMO schema do
 * servidor, issue 301) — o `.strict()` de lá reprova qualquer chave extra e o
 * `.refine` reprova janela invertida e seleção vazia. Aqui é só UX: a autoridade
 * é a Server Action.
 *
 * As datas vêm de um `<input type="datetime-local">` (sem fuso). Como no
 * `FormCupom`, `new Date(local).toISOString()` resolve para o offset local do
 * navegador e produz um ISO com `Z` que o schema aceita (`.datetime({ offset:
 * true })`). Vazio vira string vazia — o schema reprova, o form nem envia.
 */

/** Campos do form como o lojista digitou/marcou. */
export type CamposModalSazonal = {
  titulo: string;
  /** Valor cru de um `<input type="datetime-local">` (`"YYYY-MM-DDTHH:MM"` ou ""). */
  exibicaoInicio: string;
  exibicaoFim: string;
  categorias: string[];
  cardapios: string[];
  mostrarPromocoesJunto: boolean;
};

/** Payload cru (chaves em snake_case) entregue a `schemaModalSazonal.safeParse`. */
export type PayloadModalSazonal = {
  titulo: string;
  exibicao_inicio: string;
  exibicao_fim: string;
  categorias: string[];
  cardapios: string[];
  mostrar_promocoes_junto: boolean;
};

/** Converte o valor de um `datetime-local` para ISO com offset; "" fica "". */
function localParaIso(local: string): string {
  if (!local) return "";
  const d = new Date(local);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString();
}

/**
 * Monta o payload enviado à Server Action do modal sazonal.
 *
 * `mostrar_promocoes_junto` é SEMPRE presente (nunca spread condicional): com
 * `...(x ? … : {})` o `false` seria omitido e o lojista jamais conseguiria
 * DESLIGAR a exibição das promoções junto — a chave ausente faz o patch
 * preservar o valor gravado.
 */
export function montarPayloadModalSazonal(
  campos: CamposModalSazonal,
): PayloadModalSazonal {
  return {
    titulo: campos.titulo.trim(),
    exibicao_inicio: localParaIso(campos.exibicaoInicio),
    exibicao_fim: localParaIso(campos.exibicaoFim),
    categorias: campos.categorias,
    cardapios: campos.cardapios,
    mostrar_promocoes_junto: campos.mostrarPromocoesJunto,
  };
}
