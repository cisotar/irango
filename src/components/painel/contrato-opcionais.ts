import type {
  criarCategoriaOpcional,
  atualizarCategoriaOpcional,
  removerCategoriaOpcional,
  criarOpcional,
  atualizarOpcional,
  alternarOpcionalAtivo,
  removerOpcional,
  salvarAssociacaoOpcionais,
  reordenarOpcionaisDaCategoria,
  reordenarItensDoGrupoOpcional,
} from "@/lib/actions/opcional";

/**
 * Contrato COMPARTILHADO da UI de associação de opcionais (issue 217).
 *
 * Módulo `.ts` puro dentro de `components/painel/` — mesmo precedente de
 * `payloadZona.ts` e `rotulosAssinatura.ts`. Existe porque os tipos abaixo
 * nasceram em `produtos/opcionais/OpcionaisClient.tsx` (arquivo de ROTA) e
 * `CartaoAssociacaoOpcionais` / `PainelItensDoGrupo` os importavam DE VOLTA:
 * componente compartilhado dependendo de uma rota — e, a partir da 217, de uma
 * rota que nem é a dele, já que `/painel/produtos` passa a montar o mesmo cartão
 * dentro de um modal.
 *
 * Direção correta, e que este módulo estabelece: `contrato-opcionais.ts` (folha)
 * ← componentes ← rotas ← wrappers admin. Rota importa de componente, nunca o
 * contrário. Mesma inversão já resolvida em `DetalhePedido.tsx`.
 *
 * Os `typeof` de `@/lib/actions/opcional` são import de TIPO: não puxam Server
 * Action nenhuma para o bundle do cliente.
 */

/** Categoria de PRODUTO, no shape estreito que a UI de associação consome. */
export type CategoriaProduto = { id: string; nome: string };

/**
 * Linha de `categoria_produto_opcionais` no shape estreito da UI.
 * `ordem` (coluna da 208) é o que abre a lista na sequência da vitrine.
 */
export type Associacao = {
  categoria_id: string;
  categoria_opcional_id: string;
  ordem: number;
};

/**
 * Actions injetadas das 10 operações de opcionais. Todas OBRIGATÓRIAS (issue
 * 160): as pages do painel passam as 10 do lojista, as vias admin (137/143)
 * passam as 10 variantes escopadas por `lojaId`. Sem default — omitir uma chave
 * aqui quebra o build em vez de cair na action do lojista (que resolve a loja
 * por `auth.uid()`) e gravar na loja errada. Tipadas via `typeof`
 * (single-source, espelha `ProdutosClient`).
 *
 * A 9ª (`reordenarOpcionaisDaCategoria`, issues 208/209) e a 10ª
 * (`reordenarItensDoGrupoOpcional`, issues 215/216) seguem a mesma regra: são
 * escrita de ordem escopada por loja, e um default aqui seria exatamente o bug
 * que a 160 existe para impedir.
 */
export type OpcionaisClientAcoes = {
  criarCategoriaOpcional: typeof criarCategoriaOpcional;
  atualizarCategoriaOpcional: typeof atualizarCategoriaOpcional;
  removerCategoriaOpcional: typeof removerCategoriaOpcional;
  criarOpcional: typeof criarOpcional;
  atualizarOpcional: typeof atualizarOpcional;
  alternarOpcionalAtivo: typeof alternarOpcionalAtivo;
  removerOpcional: typeof removerOpcional;
  salvarAssociacaoOpcionais: typeof salvarAssociacaoOpcionais;
  reordenarOpcionaisDaCategoria: typeof reordenarOpcionaisDaCategoria;
  reordenarItensDoGrupoOpcional: typeof reordenarItensDoGrupoOpcional;
};
