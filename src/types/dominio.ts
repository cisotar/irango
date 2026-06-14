// Tipos de domínio do iRango usados na camada de UX (client).
// Valores monetários aqui são PREVIEW — o servidor recalcula tudo (seguranca.md §10).

/** Item no carrinho — estado de UX no client. `preco` é preview, não autoritativo. */
export type ItemCarrinho = {
  produtoId: string;
  nome: string;
  preco: number; // numeric preview — servidor recalcula
  quantidade: number;
  fotoUrl?: string;
};
