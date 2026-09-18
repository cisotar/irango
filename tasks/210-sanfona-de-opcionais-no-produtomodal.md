# [210] Sanfona de opcionais no `ProdutoModal` + ordenação por categoria de produto

**crítica:** NÃO
**Mundo:** vitrine pública
**Depende de:** [208]
**Spec:** specs/opcionais-sanfona-e-ordenacao.md (v0.2.0)

## Objetivo

Na vitrine, quando o produto tem **mais de uma** categoria de opcional, cada categoria vira
um item de sanfona no `ProdutoModal`; e os grupos passam a sair na ordem que o lojista
definiu (`categoria_produto_opcionais.ordem`), não mais em `opcionais_categorias.ordem`.

Não é crítica: o preço no modal já era e continua **preview de UX**; o valor autoritativo é
recalculado em `criarPedido`. Mas há um **requisito de regressão de valor** no critério de
aceite — grupo fechado com quantidade > 0 continua entrando no carrinho.

## Escopo

### Leitura (RN-2, RN-11)

`src/lib/supabase/queries/produtos.ts`:

- [ ] `buscarOpcionaisPorCategoria` e `buscarOpcionaisPorCategorias` passam a **selecionar
      `ordem` da própria linha de `categoria_produto_opcionais`** — hoje o `select` traz
      `"categoria_id, opcionais_categorias(id, nome, ordem, opcionais(...))"` e a `ordem`
      lida é a do grupo, não a da associação.
- [ ] O agrupamento em memória passa a ordenar os grupos por **essa** `ordem`, com desempate
      por `opcionais_categorias.nome` (render determinístico entre SSR e hidratação).
      Os itens dentro do grupo seguem por `opcionais.ordem` — **sem mudança**.
- [ ] **As duas funções de agrupamento** do arquivo (a de `buscarOpcionaisPorCategoria` e a
      de `buscarOpcionaisPorCategorias`) precisam da mesma chave. Se a lógica ficar
      duplicada, **extrair uma função pura única** e usá-la nas duas — não duplicar o
      critério de ordenação.
- [ ] **Nenhuma query nova, nenhum round-trip novo, nenhum campo removido.** A paralelização
      e o `cache()` por request da issue 207 seguem intactos.

### Sanfona (RN-1, D-2, D-3)

`src/components/vitrine/ProdutoModal.tsx` — **modificado, não recriado**:

- [ ] O `grupos.map(...)` atual ramifica entre "lista plana" (1 grupo, exatamente como hoje,
      sem cabeçalho) e "sanfona" (2+ grupos). Limiar é `grupos.length > 1` **literal**
      (Decisão D-3). Com 0 grupos, a seção "Opcionais" não existe, como hoje.
- [ ] `Accordion` em **modo múltiplo**: o 1º grupo nasce aberto, os demais fechados, vários
      podem ficar abertos ao mesmo tempo (Decisão D-2).
- [ ] `Badge` no cabeçalho do grupo com a **soma das quantidades** daquele grupo, para o
      cliente não perder a escolha ao recolher (RN-9 — recolher **não** limpa quantidade).
- [ ] Cabeçalho é `button` com `aria-expanded` e rótulo em pt-BR nomeando a categoria
      (ex.: "Molhos, 2 escolhidos") — WCAG AA, `design-system.md` §5.
- [ ] Estado de aberto/fechado é **local do modal** e morre ao fechar, como `qtdOpcionais`
      hoje. Nada de localStorage nem URL.
- [ ] `opcionaisSecaoRef` + `getBoundingClientRect`: o scroll até a seção "Opcionais" ao sair
      de quantidade 0 continua funcionando, e o `ref` continua **no container da seção**, não
      no primeiro grupo.
- [ ] O mini-stepper de cada opcional, o cálculo de `opcionaisEscolhidos` e
      `calcularSubtotal` **não mudam**.

## Fora de escopo

- Migration, RPC, actions → issue **208**.
- UI de reordenação no painel → issue **209**.
- Exibir opcionais no card da grade (`CardProduto`, `ItemProdutoLista`) — custa payload na
  superfície que a 207 acabou de otimizar; spec própria se virar demanda.
- Regras de seleção por grupo (mín./máx., "escolha 1 de 3", grupo obrigatório) — fase 2/3,
  muda `podeConfirmar` e o recálculo do servidor.
- Busca/filtro dentro do modal; persistir sanfona aberta entre aberturas.

## Reuso esperado

- `src/components/ui/accordion.tsx` — primitivo base-ui já gerado pelo shadcn CLI, já usado
  em `ProdutosClient.tsx` e `NavPainel.tsx`. **Reuso direto, sem editar `components/ui/`.**
- `src/components/ui/badge.tsx`, `src/components/ui/button.tsx` (`variant="ghost"`,
  `size="icon"` nos steppers `Minus`/`Plus`, como hoje)
- `src/lib/utils/formatarMoeda.ts`
- `GrupoOpcional` / `buscarOpcionaisPorCategoria` — tipo e query existentes

## Segurança

- **Valor monetário:** a feature **não cria** caminho novo de dinheiro. Preço de opcional no
  modal é preview; o autoritativo vem de `opcionais.preco` no banco via
  `buscarOpcionaisPorIds` dentro de `criarPedido` (`seguranca.md` §10). Este caminho **não é
  tocado**.
- **Requisito de regressão (o risco real desta issue):** o achatamento é sobre `grupos`, não
  sobre o que está **visível na tela**. Opcional de grupo **fechado** com quantidade > 0
  continua entrando em `opcionaisEscolhidos`, no `calcularSubtotal` e no carrinho.
- Sem RLS nova. A vitrine não expõe nada que já não expusesse: `opcionais` continua filtrado
  por `ativo = true` + `loja_esta_ativa`.

## Critério de aceite

- [ ] Teste de render sem jsdom (`renderToStaticMarkup`): com 2+ grupos renderiza cabeçalhos
      de sanfona **na ordem recebida**; com 1 grupo renderiza lista plana sem cabeçalho
- [ ] Teste: opcional de grupo **fechado** com qtd > 0 continua contabilizado no subtotal
      preview e no payload de `onAdicionar`
- [ ] Teste da query/agrupamento: grupos saem por `categoria_produto_opcionais.ordem`, com
      desempate por nome; itens seguem por `opcionais.ordem`
- [ ] `git diff` de `src/lib/supabase/queries/produtos.ts` prova a RN-11: **nenhuma query
      nova**, nenhum round-trip novo, `cache()` por request da 207 intacto
- [ ] Scroll até a seção "Opcionais" ao sair de quantidade 0 continua funcionando
- [ ] `npx tsc --noEmit`, `npm run lint`, `npm test`, `npm run build` verdes
- [ ] Checkpoint humano (sem browser automatizado nesta máquina): abrir a vitrine de
      "Lanches base" no celular, ver a sanfona e a ordem definida no painel
