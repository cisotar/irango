// Tipos de domínio do iRango usados na camada de UX (client).
// Valores monetários aqui são PREVIEW — o servidor recalcula tudo (seguranca.md §10).

/**
 * Opcional escolhido para um item do carrinho — estado de UX no client.
 * `preco` aqui é PREVIEW (só p/ exibir o subtotal estimado); o servidor recalcula
 * o acréscimo a partir do banco no checkout (seguranca.md §10, RN-O1/RN-O2). Ao
 * enviar o pedido o cliente manda APENAS `opcionalId` + `quantidade`.
 */
export type OpcionalCarrinho = {
  opcionalId: string;
  nome: string;
  preco: number; // numeric preview — servidor recalcula
  quantidade: number;
};

/** Item no carrinho — estado de UX no client. `preco` é preview, não autoritativo. */
export type ItemCarrinho = {
  produtoId: string;
  nome: string;
  preco: number; // numeric preview — servidor recalcula
  quantidade: number;
  fotoUrl?: string;
  /** Opcionais escolhidos (preview). Ausente/[] = item sem opcionais. */
  opcionais?: OpcionalCarrinho[];
  /**
   * Observação livre do cliente para ESTA linha (issue 168). Guardada já
   * CANONIZADA (`canonizarObservacao`) e ausente quando vazia — entra na chave
   * de dedup de `linhaCarrinhoId`, então mesmo produto + mesmos opcionais +
   * observações diferentes = linhas distintas. Preview: o servidor é a
   * autoridade (schemaObservacao normaliza e mede o teto de novo).
   */
  observacao?: string;
  /**
   * (238/RN-12-a) O que a VITRINE MOSTROU nesta linha: `true` quando o produto
   * foi adicionado exibindo selo e par "de/por". Não é campo monetário — o
   * carrinho continua guardando só o preço EFETIVO (RN-12) — e é a única fonte
   * de `promocaoExibida` no payload do pedido. Ausente ⇒ tratado como `false`
   * (carrinho de sessão anterior nunca cai na recusa).
   */
  temDesconto?: boolean;
};
