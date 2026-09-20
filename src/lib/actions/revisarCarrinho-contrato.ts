// STUB TDD (issue 228) — CONTRATO da revisão de carrinho. Só tipos: nenhuma
// regra mora aqui. A implementação é da fase GREEN (`executar`).
//
// Módulo NEUTRO de propósito: `'use server'` não pode exportar `type` nem
// função síncrona (mesmo motivo de `cupom-erros.ts` / `logo-contrato.ts`).
//
// Autoridade: specs/desconto-por-produto-e-pratos-promocionais.md
//   RN-09-a (base por componente) · RN-10-e (os três estados) · RN-11 (paridade
//   preview ↔ autoritativo) · RN-12 (os preços do banco NAQUELE instante).
//
// 🛑 Nenhum campo monetário entra por aqui: do cliente vêm SÓ ids e quantidades
//    (seguranca.md §10). Todo número abaixo é PRODUZIDO pelo servidor.

/** O que o cliente pode enviar por linha do carrinho: ids e quantidades. */
export interface ItemRevisao {
  produto_id: string;
  quantidade: number;
  opcionais?: { opcional_id: string; quantidade: number }[];
}

/** O payload inteiro. `.strict()` no schema zod — ver `revisarCarrinho.ts`. */
export interface EntradaRevisarCarrinho {
  loja_id: string;
  codigo?: string;
  itens: ItemRevisao[];
}

/**
 * Os três estados de RN-10-e, JÁ DECIDIDOS NO SERVIDOR. União discriminada de
 * propósito: o componente ramifica, nunca compara `baseElegivel` com `subtotal`
 * (comparar no browser seria reimplementar a regra monetária lá — D5-b).
 */
export type EstadoCupom =
  | { estado: "cheio"; codigo: string; desconto: number }
  | {
      estado: "parcial";
      codigo: string;
      desconto: number;
      baseElegivel: number;
      baseProdutos: number;
      baseOpcionais: number;
    }
  | { estado: "zero"; codigo: string };

/** O veredito do cupom. `valido: false` é o caminho que JÁ existe (pedido
 *  mínimo, inexistente, inativo, esgotado) — NÃO é um quarto estado. */
export type VereditoCupom =
  | { valido: false; mensagem: string }
  | { valido: true; estadoCupom: EstadoCupom };

/** Preços do banco NAQUELE instante (RN-12): é com eles que a tela detecta o
 *  que mudou entre o carrinho e a revisão. */
export interface LinhaRevisada {
  produto_id: string;
  quantidade: number;
  /** preço de TABELA (`produtos.preco`). */
  preco: number;
  /** preço efetivo AGORA (`precoEfetivo`). */
  precoEfetivo: number;
  temDesconto: boolean;
}

export type ResultadoRevisarCarrinho =
  | { ok: false; mensagem: string }
  | {
      ok: true;
      subtotal: number;
      /** Σ (preco − precoEfetivo) × qtd — pronto. NUNCA calculado no cliente. */
      economiaProdutos: number;
      itens: LinhaRevisada[];
      /** null ⟺ o cliente não enviou código nenhum. */
      cupom: VereditoCupom | null;
    };
