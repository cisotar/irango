# [314] Server Actions via RPC única, queries com `mensagem` e vitrine (abertura RN-M01, supressão RN-M07)

**crítica:** SIM (GREEN de 309, 311 na camada Action; fecha 307/308/310 na vitrine)
**Mundo:** vitrine pública + painel (servidor)
**Depende de:** 312, 313
**Spec:** specs/modal-sazonal-mensagem-formatada.md (§Vitrine; §Como esta extensão reusa; RN-M01, RN-M04, RN-M06, RN-M07, RN-M10, RN-M11, RN-M15)

## Objetivo
Ligar a escrita à RPC atômica, trazer `mensagem` na leitura sempre por `lerMensagemModal`, e abrir o modal na vitrine só por ativo + janela.

## Arquivos
- **Modificar** `src/lib/actions/modalSazonal.ts`:
  - `criarModalSazonal`/`editarModalSazonal` fazem **uma** chamada `rpc("salvar_modal_sazonal", { ...montarPatchModalSazonal(dados), p_loja_id: loja.id, p_modal_id })`; **apagar** `regravarSelecao`;
  - `z.guid().safeParse(id)` antes de rate-limit/client/query em `editar`, `ativar`, `desativar`, `remover` (RN-M10);
  - `ClientModal` ganha `rpc(nome: string, args: Record<string, unknown>): PromiseLike<RespostaModal>` (a `database.types.ts` não tem `modais_sazonais`; manter a fronteira, não regenerar tipos);
  - erro da RPC → `ERRO_GENERICO` com `console.error` do detalhe, nunca conteúdo nem URL.
- **Modificar** `src/lib/actions/patches-modal-sazonal.ts`: monta args nomeados `p_titulo`, `p_exibicao_inicio`, `p_exibicao_fim`, `p_mensagem`, `p_mostrar_promocoes_junto` (ausente → `null` = preservar), `p_categorias`, `p_cardapios`; coluna a coluna, nunca spread; nunca `p_loja_id`/`p_modal_id`.
- **Modificar** `src/lib/actions/modalSazonal.test.ts`: adaptar os testes existentes ao caminho RPC (não afrouxar asserção de posse).
- **Modificar** `src/lib/supabase/queries/modaisSazonais.ts`: `mensagem` em `COLUNAS_MODAL` **e** em `hidratar`; tipo `ModalSazonal.mensagem: unknown`; atualizar o comentário que diz que a 300 não está no cloud.
- **Modificar** `src/components/vitrine/ModalSazonal.tsx`: prop `mensagem: MensagemModalValidada | null`, `temModalSazonal: true`, trava 7 só para `titulo.trim() === ""`, estado `linkPendente`, `AvisoSaidaLink` no lugar do corpo (mesmo dialog), `fechar()` zera `linkPendente`, lista e contagem só com `produtos.length > 0`, `DialogDescription` conforme §Vitrine, área da mensagem com `max-h-*` + `overflow-y-auto` e CTAs/✕ fora dela (RN-M06). Se preciso para o teste A13 em node, extrair o corpo para componente puro no mesmo diretório.
- **Modificar** `src/components/vitrine/VitrineClient.tsx`: `ModalSazonalDados.mensagem`. Repasse puro.
- **Criar** `src/app/(publica)/loja/[slug]/montarModalSazonal.ts` (+ `montarModalSazonal.test.ts` ao lado, node): função pura que recebe `{ modalNaJanela, mensagemLida, produtos }` e devolve `{ modalSazonal, suprimirPromocoes }`; RN-M01 (sem `produtos.length > 0`) e RN-M07 (`suprimirPromocoes = modalSazonal !== null && !modalNaJanela.mostrar_promocoes_junto`). Teste cobre as 4 linhas da tabela de RN-M01 e afirma a **invariante** "`suprimirPromocoes` implica `modalSazonal !== null`" para todas as combinações.
- **Modificar** `src/app/(publica)/loja/[slug]/page.tsx` (linhas ~337–345 hoje): `lerMensagemModal(modal.mensagem, { lojaId, modalId })` e delega a `montarModalSazonal`.
- **Não tocar:** `decisaoModalSazonal.ts` (não muda), `components/ui/`, `database.types.ts`, `src/types/supabase.ts`, `ativar`/`desativar`/`remover` além do guard de `id`.

## Reuso
`buscarLojaDoDono`, rate-limit e `revalidar` já existentes na action; `dentroDaJanelaExibicao`, `derivarProdutosDoModalSazonal`, `decidirModalSazonal`; `MensagemFormatada`/`AvisoSaidaLink`/`lerMensagemModal` da 313.

## Suítes que ficam verdes (vetor fecha quando a suíte está 100% verde)
- V6 (309): A8 leitura, A9 Action, A11, A12 → V6 inteira.
- V8 (311): A31 → V8 inteira.
- V7 (310): A13 → V7 inteira. V4 (307) e V5 (308) inteiras (camadas de banco da 312 + zod da 313).
- `montarModalSazonal.test.ts`, `modalSazonal.test.ts`, `decisaoModalSazonal.test.ts` verdes.

## Behaviors do spec que esta issue fecha (marcar `[x]` no mesmo PR)
Vitrine:
- "Ver o modal só com o título quando o lojista não escreveu mensagem e não há prato selecionado à venda agora."
- "Ver o modal com título e mensagem, sem lista de pratos, quando não há prato selecionado à venda agora."
- "Ver título, mensagem e pratos juntos quando o modal tem os dois."
- "Ver o modal com título e pratos, como hoje, quando não há mensagem."
- "Tocar num link e ver o aviso de saída com o domínio de destino antes de sair da vitrine."
- "Voltar do aviso para a mensagem sem sair da loja, ou fechar o modal inteiro pelo ✕/ESC."
- "Nunca executar script, carregar recurso externo (fonte, imagem, CSS), seguir link sem aviso ou herdar estilo livre vindo da mensagem, mesmo que o banco contenha lixo hostil."
- "Ver o modal sem a mensagem, e não uma vitrine quebrada, quando a mensagem gravada é inválida."
- "Fechar o modal mesmo com uma mensagem de tamanho máximo: ✕ e CTAs sempre visíveis, e a mensagem rola por dentro."
- "Ter o `ModalPromocoes` suprimido só quando o sazonal de fato é enviado para abrir."
- "Nunca ver mensagem de outra loja nem rascunho."
Painel (servidor):
- "Ver o modal exatamente como estava antes quando uma edição falha no meio."
- "Não conseguir gravar nada fora do contrato, nem com payload forjado na Server Action."
- "Não conseguir ler nem editar a mensagem do modal de outra loja, nem por `id` forjado, nem chamando a RPC com `p_loja_id`/`p_modal_id` alheios."
- "Ter o título com caracteres invisíveis/bidi removidos antes de salvar."

## Critério de aceite
- [ ] `npx vitest run tests/seguranca/modal-sazonal/` : V1–V8 100% verdes.
- [ ] `grep -n "regravarSelecao\|from(\"modal_sazonal_" src/lib/actions/modalSazonal.ts` vazio.
- [ ] `grep -n "produtosDoModalSazonal.length > 0" "src/app/(publica)/loja/[slug]/page.tsx"` vazio.
- [ ] `npx tsc --noEmit`, `npm run lint`, `npm test`, `npm run build` verdes.
