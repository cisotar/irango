// Função PURA e ÚNICA fonte de "desconto de produto vira preço" (issue 223).
// Quatro consumidores (SSR da vitrine, preview do carrinho, recálculo
// autoritativo do pedido e prévia do painel) usam ESTA implementação — nunca
// uma segunda fórmula. O valor monetário nasce no servidor a partir de
// `produtos.preco` + colunas de desconto (219); o cliente recebe pronto.
//
// `agora` entra SEMPRE por parâmetro: a vigência é avaliada por request e o
// teste é determinístico. Nenhuma leitura de relógio aqui.
//
// `timestamptz` é instante absoluto: a comparação é instante ↔ instante, sem
// nenhuma aritmética de fuso (RN-03) — introduzir fuso aqui seria criar um bug.
import type { Tables } from "@/lib/database.types";
import { arredondar } from "./arredondar";
import { formatarMoeda } from "./formatarMoeda";

/**
 * Subconjunto de `produtos` que decide preço: o preço de tabela mais as cinco
 * colunas de desconto (issue 219). `desconto_inicio`/`desconto_fim` chegam como
 * ISO-8601 (`timestamptz` serializado pelo PostgREST), exatamente como a linha
 * do banco — instante absoluto, sem aritmética de fuso (RN-03).
 */
export type ProdutoComDesconto = Pick<
  Tables<"produtos">,
  | "preco"
  | "desconto_ativo"
  | "desconto_valor"
  | "desconto_tipo"
  | "desconto_inicio"
  | "desconto_fim"
>;

export interface ResultadoPrecoEfetivo {
  /** Preço que o cliente paga AGORA. Sem desconto vigente ⇒ === preco. Nunca < 0. */
  precoEfetivo: number;
  /** true ⟺ existe desconto vigente NESTE instante. */
  temDesconto: boolean;
  /** Rótulo pronto do selo ("-20%" | "-R$ 10,00"); null quando !temDesconto. */
  seloDesconto: string | null;
}

/** Percentual do selo em pt-BR: 20 ⇒ "20", 20.5 ⇒ "20,5" (sem casas inúteis). */
const formatadorPercentual = new Intl.NumberFormat("pt-BR", {
  maximumFractionDigits: 2,
});

/**
 * RN-03: início INCLUSIVO (`desconto_inicio <= agora`) e fim EXCLUSIVO
 * (`agora < desconto_fim`) — a mesma convenção de `lojaAberta` e de
 * `validarUsoCupom`, onde o instante final já esgota a janela.
 */
function dentroDaVigencia(
  inicio: string | null,
  fim: string | null,
  agora: Date,
): boolean {
  const instante = agora.getTime();
  // Data ilegível fecha a janela, não abre. Toda comparação com NaN é false, e
  // as duas guardas abaixo são negativas: sem esta conversão, um `desconto_fim`
  // inválido cairia no `return true` e tornaria vigente uma promoção que
  // terminou. O banco não guarda lixo em timestamptz, mas a função também roda
  // no preview do formulário, onde as datas vêm do que o lojista digitou.
  if (inicio != null) {
    const t = new Date(inicio).getTime();
    if (!Number.isFinite(t) || t > instante) return false;
  }
  if (fim != null) {
    const t = new Date(fim).getTime();
    if (!Number.isFinite(t) || t <= instante) return false;
  }
  return true;
}

export function precoEfetivo(
  produto: ProdutoComDesconto,
  agora: Date,
): ResultadoPrecoEfetivo {
  const semDesconto: ResultadoPrecoEfetivo = {
    precoEfetivo: produto.preco,
    temDesconto: false,
    seloDesconto: null,
  };

  // Preço inválido é bug de dado, não estado de negócio, e devolver 0 seria o
  // pior default possível numa fatia monetária: `null - (null * 20) / 100` dá
  // zero, e o produto apareceria de graça COM selo de promoção. `produtos.preco`
  // é NOT NULL, mas o tipo da view é todo nullable e a ponte é um cast.
  if (!Number.isFinite(produto.preco)) {
    throw new Error("precoEfetivo: preco invalido");
  }

  // Instante de referência ilegível também fecha tudo: sem isto, `agora`
  // inválido tornaria vigente toda promoção configurada, inclusive a agendada
  // para daqui a anos.
  if (!Number.isFinite(agora.getTime())) return semDesconto;

  // RN-07: a chave desliga a promoção mesmo com prazo vigente.
  if (!produto.desconto_ativo) return semDesconto;

  // Linha incoerente (produtos_desconto_coerente_check a recusa no banco): sem
  // tipo ou sem valor não há desconto — jamais NaN escapando para a vitrine.
  const { desconto_tipo: tipo, desconto_valor: valor } = produto;
  if (valor == null || !Number.isFinite(valor)) return semDesconto;
  if (tipo !== "percentual" && tipo !== "fixo") return semDesconto;

  if (!dentroDaVigencia(produto.desconto_inicio, produto.desconto_fim, agora)) {
    return semDesconto;
  }

  // RN-02. Piso em zero: TERCEIRA camada de RN-04/RN-05 — nem uma linha
  // impossível que escape de todos os CHECKs produz preço negativo.
  const bruto =
    tipo === "percentual"
      ? produto.preco - (produto.preco * valor) / 100
      : produto.preco - valor;

  // Teto simétrico ao piso: desconto nunca SOBE o preço. Terceira camada de
  // `produtos_desconto_fixo_check`, que já trava o valor em (0, preco].
  if (!Number.isFinite(bruto)) return semDesconto;

  return {
    precoEfetivo: Math.min(produto.preco, Math.max(0, arredondar(bruto))),
    temDesconto: true,
    seloDesconto:
      tipo === "percentual"
        ? `-${formatadorPercentual.format(valor)}%`
        : `-${formatarMoeda(valor)}`,
  };
}
