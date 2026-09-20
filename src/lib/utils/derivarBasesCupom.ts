// Base elegível de cupom POR COMPONENTE (issue 227 — D5, D8, D9).
// Função PURA. `ComponentesLinha` é montada SEMPRE no servidor, a partir de
// buscarProdutosPorIds + precoEfetivo + buscarOpcionaisPorIds; do cliente vêm
// só ids e quantidades (seguranca.md §10).
//
// D-2: a aritmética é HERDADA de `totalDaLinha`/`calcularSubtotal` (226) —
// uma soma, uma implementação. Nenhuma segunda cópia de aritmética aqui: é o
// que garante a igualdade EXATA `baseElegivel === subtotal` quando nada está
// em promoção (estado A de RN-10-e) e a regra do opcional (soma uma vez por
// linha, × quantidade DO OPCIONAL).
import { arredondar } from "./arredondar";
import type { BasesDesconto } from "./calcularDesconto";
import {
  calcularSubtotal,
  totalDaLinha,
  type ItemCalculo,
  type OpcionalCalculo,
} from "./calcularTotal";
import type { ResultadoPrecoEfetivo } from "./precoEfetivo";

/** Uma linha do carrinho decomposta em COMPONENTES (D9). Montada sempre no
 *  servidor a partir de buscarProdutosPorIds + precoEfetivo + buscarOpcionaisPorIds. */
export interface ComponentesLinha {
  /** O RESULTADO de `precoEfetivo(produto, agora)`, inteiro — preço e flag são
   *  UM valor, não dois campos soltos. É o que impede aplicar o preço com
   *  desconto e esquecer a flag (o cupom voltaria a acumular sobre a promoção),
   *  ou avaliar cada um com um `agora` diferente. */
  precoProduto: Pick<ResultadoPrecoEfetivo, "precoEfetivo" | "temDesconto">;
  /** quantidade do PRODUTO. */
  quantidade: number;
  /** { preco, quantidade DO OPCIONAL }; `[]` explícito quando não há. */
  opcionais: OpcionalCalculo[];
}

/** As bases do cálculo (`BasesDesconto`) mais a decomposição que as explica.
 *  Estende a marcada: `calcularDesconto` só aceita o que sai daqui. */
export interface BasesCupom extends BasesDesconto {
  /** Σ produtos SEM desconto (× qtd do produto). */
  baseProdutos: number;
  /** Σ TODOS os opcionais (× qtd do OPCIONAL), inclusive de linha promocional. */
  baseOpcionais: number;
}

/** Mapeamento ComponentesLinha → ItemCalculo em UM lugar (D-3). */
function comoItem(linha: ComponentesLinha): ItemCalculo {
  return {
    preco: linha.precoProduto.precoEfetivo,
    quantidade: linha.quantidade,
    opcionais: linha.opcionais,
  };
}

export function derivarBasesCupom(linhas: ComponentesLinha[]): BasesCupom {
  let somaProdutos = 0;
  let somaOpcionais = 0;

  for (const linha of linhas) {
    // Produto: sai da base inteiro quando recebeu desconto próprio (D5).
    somaProdutos += linha.precoProduto.temDesconto
      ? 0
      : totalDaLinha({
          preco: linha.precoProduto.precoEfetivo,
          quantidade: linha.quantidade,
        });
    // Opcional: NUNCA recebeu desconto (D8) ⇒ SEMPRE entra, inclusive numa
    // linha promocional (D9). `preco: 0` isola a parcela dos opcionais sem
    // reescrever a fórmula deles — em especial o × quantidade DO OPCIONAL.
    somaOpcionais += totalDaLinha({
      preco: 0,
      quantidade: linha.quantidade,
      opcionais: linha.opcionais,
    });
  }

  const baseProdutos = arredondar(somaProdutos);
  const baseOpcionais = arredondar(somaOpcionais);

  // O `as` é o ÚNICO ponto do projeto que produz a marca de `BasesDesconto` —
  // é o que faz desta função a única fonte das bases (ver `marcaBases`).
  return {
    // O subtotal NÃO é recalculado aqui: é o mesmo número que o pedido grava.
    subtotal: calcularSubtotal(linhas.map(comoItem)),
    baseElegivel: arredondar(baseProdutos + baseOpcionais),
    baseProdutos,
    baseOpcionais,
  } as BasesCupom;
}
