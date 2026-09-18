# Spec: Opcionais em sanfona e ordenação das categorias de opcional

**Versão:** 0.2.0 | **Atualizado:** 2026-09-17

## Visão Geral

Hoje, quando o cliente abre um produto na vitrine, **todos** os grupos de opcional aparecem
empilhados e expandidos dentro de um único card "Opcionais" (`ProdutoModal.tsx` §"Seção
Opcionais"). Com duas ou mais categorias de opcional associadas à categoria do produto
(ex.: "Molhos", "Adicionais", "Bebida"), a seção vira uma parede de itens: o cliente rola
muito no celular, perde o contexto de qual grupo está preenchendo e o CTA de subtotal some
da vista.

Esta feature faz duas coisas:

1. **Vitrine:** quando o produto tem **mais de uma** categoria de opcional, cada categoria
   vira um item de **sanfona** (accordion) — cabeçalho clicável, corpo colapsável, contador
   de itens escolhidos no cabeçalho. Com **uma só** categoria, o comportamento atual
   (lista plana, sem cabeçalho de sanfona) é preservado.
2. **Painel:** o lojista passa a **ordenar as categorias de opcional por drag & drop**,
   reusando o mesmo mecanismo já entregue para categorias de produto (issue 175 —
   `moverPorDeslocamento` + `criarSalvamentoCoalescido` + RPC de escrita em lote).
   A ordem escolhida pelo lojista é a ordem em que os grupos aparecem na sanfona da vitrine.
   **A ordem é por categoria de produto** (Decisão D-1), não global por loja: o mesmo grupo
   *Molhos* pode aparecer em 1º em *Lanches* e em 3º em *Porções*. Por isso o arrasto vive
   **dentro do cartão de cada categoria de produto**, na seção "Opcionais por categoria de
   produto" — não na "Biblioteca de opcionais", que não tem contexto de categoria.

**Mundos:** vitrine pública (`/loja/[slug]`, sem login) para a sanfona; painel do lojista
(`/painel/produtos/opcionais`, auth obrigatório) para a reordenação; hub admin
(`/admin/assinantes/[lojaId]/produtos/opcionais`) por paridade (issue 160).

### Onde os opcionais são realmente visíveis (correção de premissa)

A descrição fala em "cards de produtos". No código, `CardProduto.tsx` e `ItemProdutoLista.tsx`
(a grade/lista do catálogo) **não renderizam opcional nenhum** — eles só levam ao
`ProdutoModal`, que é onde a seção "Opcionais" existe (`src/components/vitrine/ProdutoModal.tsx`,
alimentada por `produto.gruposOpcionais: GrupoOpcional[]`). Portanto **a superfície desta
spec é o `ProdutoModal`**, aberto a partir do card. Exibir um resumo de opcionais no card da
grade é decisão diferente (custo de payload na vitrine, que acabou de ser otimizada na
issue 207) e está em **Fora do Escopo**.

---

## Atores Envolvidos

| Ator | Faz o quê nesta feature |
|------|-------------------------|
| **iRango (SaaS)** | entrega o componente de sanfona e a RPC de reordenação; garante o isolamento por loja (RLS + `SECURITY INVOKER`). Via hub admin, pode reordenar as categorias de opcional de uma loja assinante em suporte, com registro de acesso. |
| **Lojista** | arrasta os grupos de opcional dentro de cada categoria de produto para definir a ordem em que o cliente os vê. É o único que escreve `categoria_produto_opcionais.ordem` da própria loja. |
| **Cliente** | abre/fecha as sanfonas e escolhe os opcionais. Nunca escreve ordem; nunca define preço. |

---

## Páginas e Rotas

### Detalhe do produto (modal da vitrine) — `/loja/[slug]` (`ProdutoModal`)

**Mundo:** vitrine pública (sem auth)
**Descrição:** o cliente toca no card do produto, o modal abre, escolhe a quantidade e a
seção "Opcionais" aparece. Com 2+ categorias de opcional, cada uma é uma sanfona; com 1,
nada muda em relação a hoje.

**Componentes:**

- `ProdutoModal` — `src/components/vitrine/ProdutoModal.tsx`. **Modificado**, não recriado:
  o `grupos.map(...)` atual passa a ramificar entre "lista plana" (1 grupo) e "sanfona"
  (2+ grupos). O mini-stepper de cada opcional, o cálculo de `opcionaisEscolhidos` e o
  subtotal via `calcularSubtotal` **não mudam**.
- `Accordion` / `AccordionItem` / `AccordionTrigger` / `AccordionPanel` —
  `src/components/ui/accordion.tsx` (primitivo base-ui já gerado pelo shadcn CLI, já usado em
  `ProdutosClient.tsx` e `NavPainel.tsx`). **Reuso direto**, sem editar `components/ui/`.
- `Badge` — `src/components/ui/badge.tsx`, para o contador "2 escolhidos" no cabeçalho do grupo.
- `Button` (`variant="ghost"`, `size="icon"`) — steppers `Minus`/`Plus`, como hoje.
- `formatarMoeda` — `src/lib/utils/formatarMoeda.ts`, reuso.
- `GrupoOpcional` / `buscarOpcionaisPorCategoria` — `src/lib/supabase/queries/produtos.ts`,
  **sem query nova e sem round-trip novo**: ganha `ordem` no `select` da linha de
  `categoria_produto_opcionais` que já busca, e `agruparOpcionais` passa a ordenar os grupos
  por esse campo (desempate por `opcionais_categorias.nome`). Os itens seguem por
  `opcionais.ordem`.

**Behaviors:**

- [ ] **Ver os grupos de opcional na ordem definida pelo lojista** — a sequência dos grupos é
      lida do banco por `buscarOpcionaisPorCategoria`, ordenada por
      `categoria_produto_opcionais.ordem` **da categoria de produto daquele produto**.
      Garantido em: **Server Component + RLS** (`cat_prod_opc_leitura_publica` via
      `loja_esta_ativa`). O cliente não reordena nada em runtime.
- [ ] **Ver lista plana quando o produto tem exatamente 1 categoria de opcional** — sem
      cabeçalho de sanfona, sem clique extra. Garantido em: cliente (UX).
- [ ] **Expandir / recolher uma categoria de opcional** — toque no `AccordionTrigger`.
      Estado local do modal, some ao fechar (como `qtdOpcionais` hoje). Garantido em: cliente (UX).
- [ ] **Ver o 1º grupo já aberto ao revelar a seção** — os demais nascem fechados; múltiplos
      podem ficar abertos ao mesmo tempo (`Accordion` em modo múltiplo). Garantido em: cliente (UX).
- [ ] **Ver o contador de escolhidos no cabeçalho do grupo fechado** — `Badge` com a soma das
      quantidades daquele grupo, para o cliente não perder a escolha ao recolher. Garantido em:
      cliente (UX — preview; o servidor revalida os opcionais no checkout).
- [ ] **Ajustar a quantidade de um opcional (+/−)** — inalterado. O preço exibido é
      **preview**; `calcularSubtotal` é estético. Garantido em: **Server Action
      `criarPedido` + `buscarOpcionaisPorIds`** (recálculo autoritativo, `seguranca.md` §10).
- [ ] **Adicionar ao carrinho com os opcionais escolhidos** — inalterado (`onAdicionar`
      recebe `OpcionalCarrinho[]`, o carrinho guarda id + quantidade). Garantido em:
      **Server Action + RLS** — o preço final vem de `opcionais.preco` no banco, nunca do payload.
- [ ] **Navegar a sanfona por teclado e leitor de tela** — cabeçalho é `button` com
      `aria-expanded`, rótulo em pt-BR nomeando a categoria (ex.: "Molhos, 2 escolhidos").
      Garantido em: cliente (UX / WCAG AA — `design-system.md` §5).
- [ ] **Rolar até a seção "Opcionais" ao sair de quantidade 0** — comportamento atual
      (`opcionaisSecaoRef` + `getBoundingClientRect`) preservado: a sanfona não pode quebrar
      esse scroll, e o `ref` continua no container da seção, não no primeiro grupo.
      Garantido em: cliente (UX).

---

### Opcionais do lojista — `/painel/produtos/opcionais`

**Mundo:** painel (auth obrigatório, dentro de `(bloqueavel)`)
**Descrição:** na seção **"Opcionais por categoria de produto"** (`AssociacaoOpcionais` →
`CartaoAssociacao`), cada cartão de categoria de produto ganha um botão **"Reordenar"** que
troca a grade de checkboxes pela lista arrastável dos grupos **já marcados** naquela categoria.
A "Biblioteca de opcionais" **não muda** — ela não tem contexto de categoria de produto e
portanto não tem ordem a definir (Decisão D-1).

**Componentes:**

- `CartaoAssociacao` — dentro de
  `src/app/(painel)/painel/(bloqueavel)/produtos/opcionais/OpcionaisClient.tsx`.
  **Modificado**: novo estado "modo reordenar" por cartão. Fora do modo, a grade de checkboxes
  de hoje; dentro do modo, a lista arrastável só dos selecionados. O botão fica desabilitado
  com menos de 2 grupos marcados (nada a ordenar).
- `OpcionaisClient` — **modificado**: nova chave obrigatória em `OpcionaisClientAcoes`
  (`reordenarOpcionaisDaCategoria`), seguindo a regra da issue 160 (sem default — omitir
  quebra o build em vez de cair na action do lojista).
- `ReordenarOpcionaisDaCategoria` — **novo**, `src/components/painel/`.
  Reusa `DndContext`/`SortableContext`/`PointerSensor`/`KeyboardSensor` do `@dnd-kit` (já em
  `package.json`), `moverPorDeslocamento` + `mensagemPosicao` de `src/lib/utils/reordenar.ts`,
  `criarSalvamentoCoalescido` de `src/lib/utils/salvamento-coalescido.ts` (debounce 500ms,
  fila, flush) e o handle imperativo `finalizar()` que o pai aguarda antes do `router.refresh()`.
  **Antes de criar o arquivo, avaliar extrair o miolo genérico de `ReordenarCategorias.tsx`**
  (393 linhas) para um componente parametrizado por rótulo/linha — duplicar ~380 linhas de
  acessibilidade em pt-BR é o cenário que o mandato "não reinventar a roda" existe para evitar.
  A decisão fica para o `planejar`.
- `LinhaCategoriaReordenavel` — `src/components/painel/LinhaCategoriaReordenavel.tsx`.
  **Reuso** (já é genérico: `useSortable`, alça `GripVertical` de 44×44 com
  `touchAction: none`). Se hoje tipar `Categoria` de produto, generalizar o prop para
  `{ id, nome, detalhe? }`.
- `Card`, `CardContent`, `Button`, `Badge`, `Separator` — primitivos existentes.
- `toast` (sonner) — feedback de falha, como em `ReordenarCategorias`.

**Behaviors:**

- [ ] **Entrar no modo "Reordenar" dentro de um cartão de categoria de produto** — troca a
      grade de checkboxes pela lista arrastável **dos grupos marcados naquela categoria**.
      Com 0 ou 1 grupo marcado o botão fica desabilitado. Garantido em: cliente (UX) — a
      lista já veio filtrada por RLS no SSR.
- [ ] **Arrastar um grupo para outra posição** — a lista local reordena antes da rede
      (**preview otimista**), via `moverPorDeslocamento` (deslocamento, não troca de pares).
      Garantido em: cliente (UX). **A ordem só é verdade depois do servidor gravar.**
- [ ] **Mover grupo por teclado (espaço + setas)** — `KeyboardSensor` +
      `sortableKeyboardCoordinates`, com anúncio em pt-BR ("Molhos movida para a posição 2 de 4"
      — `mensagemPosicao`). Garantido em: cliente (UX / WCAG AA).
- [ ] **Persistir a nova ordem** — cada movimento agenda um salvamento coalescido que envia
      `categoria_id` + a **sequência completa de ids de grupo daquela categoria** (nunca um
      delta) para a Server Action `reordenarOpcionaisDaCategoria`. Garantido em: **Server
      Action + RPC `reordenar_opcionais_da_categoria` (SECURITY INVOKER) + RLS
      `cat_prod_opc_escrita_propria`**. `loja_id` vem de `buscarLojaDoDono(auth.uid())`,
      **nunca do payload**; `ordem` é derivada de `ordinality - 1` no servidor — o cliente
      nunca manda número de ordem. `categoria_id` **vem do payload** e por isso é validado
      como pertencente à loja (ver RN-5b).
- [ ] **Ver falha de salvamento sem perder o estado** — id alheio, lista incompleta,
      `categoria_id` de outra loja ou erro de banco derrubam a transação inteira (nada gravado
      em nenhuma loja) e retornam **uma única** mensagem genérica "Não foi possível salvar a
      ordem." Garantido em: **Server Action** (`seguranca.md` §14 — mensagem distinta viraria
      oráculo de existência de id).
- [ ] **Sair do modo (Concluir / ESC) sem perder o último movimento** — o pai chama
      `finalizar()` pelo `ref`, **aguarda o flush** e só então desmonta e faz `router.refresh()`.
      Garantido em: cliente (UX) + Server Action (a escrita é quem confirma).
- [ ] **Marcar/desmarcar um grupo sem perder a ordem dos demais** — salvar a associação
      (checkbox) **não pode** zerar a ordem. Ver RN-12: `salvarAssociacaoOpcionais` hoje faz
      `delete` + `insert` do conjunto inteiro da categoria, o que com a coluna nova apagaria a
      ordem a cada clique. Garantido em: **Server Action** (`salvarAssociacaoOpcionais`
      modificada — preserva a `ordem` dos que permanecem e anexa os novos no fim).
- [ ] **Ver a nova ordem refletida na vitrine** — a action chama
      `revalidatePath("/painel/produtos/opcionais")` e `revalidatePath("/loja/" + loja.slug)`
      (slug da própria loja, **nunca** a forma coringa `("/loja/[slug]", "page")`, que
      invalidaria o Router Cache de todas as lojas). Garantido em: **Server Action**.

### Opcionais da loja assinante (hub admin) — `/admin/assinantes/[lojaId]/produtos/opcionais`

**Mundo:** painel admin (auth obrigatório + gate de dono do SaaS)
**Descrição:** paridade. O `OpcionaisAdminClient` injeta a variante escopada por `lojaId`
da nova action, como já faz com as 8 existentes.

**Componentes:**

- `OpcionaisAdminClient` — `src/app/admin/assinantes/[lojaId]/produtos/opcionais/OpcionaisAdminClient.tsx`,
  **modificado** para injetar `reordenarOpcionaisDaCategoria`.
- `reordenarOpcionaisDaCategoriaAdmin` — **nova** em
  `src/app/admin/assinantes/actions/admin-opcionais.ts`, no padrão de
  `reordenarCategoriasAdmin` (`validarLojaIdAdmin` → `prepararContextoAdmin` → escrita
  carregando o escopo da loja-alvo → `registrarAcessoAdmin` → `revalidarLojaAdmin`).
  A `categoria_id` do payload é validada contra a **loja-alvo**, não contra a do dono do SaaS.

**Behaviors:**

- [ ] **Reordenar os opcionais de uma categoria de produto de uma loja assinante** —
      Garantido em: **Server Action admin** (gate de dono do SaaS + `validarLojaIdAdmin` +
      escopo explícito por `lojaId` no wrapper de escrita). **Não** reusa a RPC do lojista
      sob `service_role`: a RPC é `SECURITY INVOKER` e a RLS do lojista não vale para o admin.
- [ ] **Registrar o acesso admin** — `registrarAcessoAdmin(svc, { lojaId, acao:
      "reordenar_opcionais_da_categoria" })`. Garantido em: **Server Action admin** (trilha de
      auditoria, `seguranca.md`).

---

## Modelos de Dados

Referência: `references/schema.md` + migration `20260614007500_opcionais.sql`.

| Tabela | Uso nesta feature | Migration nova? |
|--------|-------------------|-----------------|
| `categoria_produto_opcionais` | ganha **`ordem int not null default 0`**. É a coluna que o drag & drop escreve, e a que passa a ordenar os grupos na vitrine. Hoje tem índice `(loja_id, categoria_id)`. | **Sim — coluna + backfill + índice** |
| `opcionais_categorias` | `ordem` **continua existindo** e segue sendo a ordem de exibição da Biblioteca no painel. **Deixa de ser** a ordem da vitrine. Não é removida (ver Débito D-2). | Não |
| `opcionais` | `ordem` já existe e já ordena os itens dentro do grupo. Sem mudança. | Não |
| `itens_pedido_opcionais` | snapshot do pedido. Sem mudança. | Não |

**Política RLS nova: não.** `cat_prod_opc_leitura_publica` (vitrine, via `loja_esta_ativa`) e
`cat_prod_opc_escrita_propria` (`for all`, `using` **e** `with check` em `lojas.dono_id =
auth.uid()`, mais as duas checagens de mesma-loja das pontas) já cobrem exatamente o que a
feature precisa. A coluna nova entra numa tabela que já é escrita pelo dono.

### Migration 1 — coluna `ordem` na associação

`supabase/migrations/<ts>_ordem_em_categoria_produto_opcionais.sql`:

- `alter table public.categoria_produto_opcionais add column ordem int not null default 0;`
- **Backfill preservando o comportamento atual**: `ordem` recebe a posição do grupo dentro da
  categoria de produto **seguindo a ordem que a vitrine usa hoje** (`opcionais_categorias.ordem`,
  desempate por `nome`), via `update ... from (select ..., row_number() over (partition by
  loja_id, categoria_id order by oc.ordem, oc.nome) - 1 as pos ...)`. Assim, no instante do
  deploy, **nenhuma loja vê a ordem mudar** — a feature nasce neutra e só muda quando o lojista
  arrasta.
- `create index on public.categoria_produto_opcionais (loja_id, categoria_id, ordem);`
- Tabela com dados no cloud → sequência `expand → backfill` numa migration só (sem `contract`:
  nada é removido). Rollback: `drop column ordem` volta ao estado anterior sem perda, porque
  `opcionais_categorias.ordem` continua intacta.

### Migration 2 — RPC de escrita em lote

`supabase/migrations/<ts>_rpc_reordenar_opcionais_da_categoria.sql` —
`public.reordenar_opcionais_da_categoria(p_loja_id uuid, p_categoria_id uuid, p_ids uuid[])
returns integer`, espelho fiel de `reordenar_categorias` (`20260908120000` + `20260908130000`):

- `language plpgsql`, **`security invoker`** (carga estrutural, não estilo: sob `DEFINER`,
  `p_loja_id` é escolhido pelo chamador e um lojista reescreveria a ordem de outra loja —
  `seguranca.md` §2 "RPC de escrita em lote do lojista");
- `set search_path = public`;
- exige que `p_ids` seja a **permutação completa** de `categoria_produto_opcionais where
  loja_id = p_loja_id and categoria_id = p_categoria_id` — subconjunto reintroduziria empate
  de `ordem`. **O escopo da permutação é o par (loja, categoria de produto)**, não a loja
  inteira: é essa a diferença estrutural para `reordenar_categorias`;
- **`cardinality(p_ids)`**, nunca `array_length(p_ids, 1)` (achado corrigido em
  `20260908130000`: array multidimensional burlaria a checagem e corromperia a `ordinality`);
- `update ... from unnest(p_ids) with ordinality` com `set ordem = e.pos - 1`, casando por
  `categoria_opcional_id`, e `and cpo.loja_id = p_loja_id and cpo.categoria_id = p_categoria_id`
  (escopo explícito **além** da RLS);
- confere `row_count` e levanta exceção se divergir → transação inteira derrubada;
- `revoke all on function ... from public, anon;` + `grant execute ... to authenticated,
  service_role;` (o Postgres concede EXECUTE a PUBLIC por padrão e o projeto não tem
  `alter default privileges ... on functions`).

Após as migrations: `npx supabase gen types typescript > src/lib/database.types.ts`.
**Deploy no cloud (`npx supabase db push`) exige autorização explícita do usuário.**

### Leitura da vitrine

`buscarOpcionaisPorCategoria` e `buscarOpcionaisPorCategorias`
(`src/lib/supabase/queries/produtos.ts`) passam a **selecionar `ordem` da própria linha de
`categoria_produto_opcionais`** e a ordenar os grupos por ela (desempate por
`opcionais_categorias.nome`). **Nenhuma query nova, nenhum round-trip novo** — é um campo a
mais no `select` que já existe e uma troca da chave de ordenação no agrupamento em memória
(`agruparOpcionais`). A paralelização e o `cache()` por request da issue 207 seguem intactos
(RN-11).

### Validação

`src/lib/validacoes/opcional.ts` — **adicionar** `schemaReordenacaoOpcionaisDaCategoria`:
`{ categoria_id: z.guid(), categoria_opcional_id: z.array(z.guid()).min(2).max(200) }` +
`.refine` de ids únicos, espelhando `schemaReordenacaoCategorias` de `validacoes/produto.ts`.
O parse devolve **objeto novo**, então propriedade hostil pendurada pelo cliente (ex.:
`loja_id`) não chega aos args da RPC.

## Regras de Negócio

| # | Regra | Camada que garante |
|---|-------|--------------------|
| RN-1 | Com **2 ou mais** grupos de opcional, cada grupo é uma sanfona; com **1**, lista plana sem cabeçalho de sanfona; com **0**, a seção "Opcionais" não existe (como hoje). Limiar é `grupos.length > 1` literal (Decisão D-3). | cliente (UX) |
| RN-2 | A ordem dos grupos na vitrine é **sempre** `categoria_produto_opcionais.ordem` ascendente, **dentro da categoria de produto do produto aberto**. Empate resolvido por `opcionais_categorias.nome` para render determinístico (SSR/hidratação). | **Server Component** (`buscarOpcionaisPorCategoria`) + índice `(loja_id, categoria_id, ordem)` |
| RN-3 | A ordem é dado **autoritativo do servidor**. O drag & drop é preview otimista; um recarregamento mostra a ordem do banco, não a da tela. | **Server Action + RPC + RLS** |
| RN-4 | O cliente da reordenação envia **sequência de ids de categoria de opcional**, nunca valores de `ordem`. `ordem` = `ordinality - 1`, derivada no servidor. | **RPC** |
| RN-5 | `p_loja_id` vem de `buscarLojaDoDono(auth.uid())`, nunca do payload. | **Server Action** |
| RN-5b | `p_categoria_id` **vem do payload** (é a categoria de produto que o lojista está editando) e por isso é validada como pertencente à loja antes da RPC, com `categoriaProdutoPertenceALoja` — o mesmo guard que `salvarAssociacaoOpcionais` já usa. A RPC ainda assim filtra por `categoria_id` no `update`, como segunda camada. | **Server Action + RPC + RLS** |
| RN-6 | A lista enviada tem que ser a permutação completa das associações **daquele par (loja, categoria de produto)**; id alheio, duplicado, inexistente ou de outra categoria derruba a transação e **não grava nada em nenhuma loja**. | **RPC** (contagem + `row_count`) + **RLS** |
| RN-7 | Reordenar é operação **do lojista dono** (ou do admin, pela via escopada). `anon` não executa a RPC. | **`revoke ... from public, anon` + RLS** |
| RN-8 | Preço de opcional, subtotal e total continuam **preview** na vitrine. O pedido é recalculado de `opcionais.preco` no banco. Esta feature **não toca** nesse caminho. | **Server Action `criarPedido` + `buscarOpcionaisPorIds`** (`seguranca.md` §10) |
| RN-9 | Recolher uma sanfona **não** limpa as quantidades já escolhidas daquele grupo; o contador no cabeçalho preserva a visibilidade da escolha. | cliente (UX) |
| RN-10 | A ordem é **por categoria de produto** (Decisão D-1): o mesmo grupo associado a duas categorias de produto pode ter posição diferente em cada uma. | **banco** (`ordem` é coluna da associação) |
| RN-11 | A feature **não adiciona query nem round-trip** à vitrine: `buscarOpcionaisPorCategoria` já é chamada e passa a trazer um campo a mais no `select` que já existe. A paralelização e o `cache()` por request da issue 207 seguem intactos. | revisão por `git diff` no `revisar` |
| RN-12 | Salvar a **associação** (checkbox) não pode zerar a ordem. `salvarAssociacaoOpcionais` hoje faz `delete` + `insert` do conjunto inteiro da categoria; com a coluna nova isso apagaria a ordem a cada clique. A action passa a **preservar a `ordem` dos grupos que permanecem** e anexar os recém-marcados no fim (`max(ordem) + 1` em diante). | **Server Action** |
| RN-13 | O backfill da migration reproduz a ordem que a vitrine já exibe hoje (`opcionais_categorias.ordem`, desempate por `nome`). **Nenhuma loja existente vê a ordem mudar no deploy.** | **migration** |

## Segurança (obrigatório)

**Dado sensível que entra/sai:** nenhum PII novo. O payload da reordenação é uma
`categoria_id` mais uma lista de UUIDs de categorias de opcional da própria loja. A vitrine
não expõe nada que já não expusesse — `opcionais` continua filtrado por `ativo = true` +
`loja_esta_ativa` pela RLS.

**Valor monetário:** a feature **não cria** caminho novo de dinheiro. O preço do opcional
exibido no modal segue sendo **preview de UX**; o valor autoritativo é recalculado na Server
Action de criação do pedido a partir de `opcionais.preco` no banco (`buscarOpcionaisPorIds`,
`seguranca.md` §10). **Requisito de regressão:** a mudança de layout não pode alterar
`opcionaisEscolhidos` nem `calcularSubtotal` — os opcionais de um grupo **fechado** mas com
quantidade > 0 **continuam entrando** no carrinho (o achatamento é sobre `grupos`, não sobre
o que está visível na tela).

**Tabela nova:** não. **Coluna nova:** sim — `categoria_produto_opcionais.ordem` (int, not
null, default 0), em tabela com dados no cloud. **Política RLS nova:** não —
`cat_prod_opc_leitura_publica` e `cat_prod_opc_escrita_propria` já cobrem leitura pública e
escrita do dono, e a coluna entra numa tabela que o dono já escreve.

**Superfície de autorização nova:** a Server Action recebe `categoria_id` **do cliente**
(RN-5b). É o único parâmetro de escopo que não vem de `auth.uid()`, e portanto o ponto que a
auditoria tem que provar: `categoriaProdutoPertenceALoja` antes da RPC, filtro por
`categoria_id` dentro da RPC, e RLS como terceira camada.

**Função nova:** sim, `public.reordenar_opcionais_da_categoria`. Checklist obrigatório
(`seguranca.md` §2, "RPC de escrita em lote do lojista"):

- [ ] `security invoker` (nunca `definer`)
- [ ] `set search_path = public`
- [ ] `revoke all on function ... from public, anon`
- [ ] `grant execute ... to authenticated, service_role`
- [ ] `cardinality()` para validar o array do cliente
- [ ] `where loja_id = p_loja_id and categoria_id = p_categoria_id` como segunda camada além da RLS
- [ ] permutação completa **do par (loja, categoria)** + conferência de `row_count`, com exceção derrubando a transação

**Testes críticos (TDD red-first — RLS/autorização):**

- [ ] pglite/`asUser`: lojista A chama a RPC com `p_categoria_id` da loja B →
      **erro, zero linhas escritas nas duas lojas** (a loja de teste autorizada no cloud é
      "Lanches base"; no CI isso roda em `tests/migrations/` via `createTestDb()`).
- [ ] pglite/`asUser`: lojista A passa uma `categoria_opcional_id` da loja B dentro de `p_ids`
      → erro, `ordem` intacta nas duas lojas.
- [ ] pglite/`asUser`: ids válidos da própria loja mas de **outra categoria de produto** →
      erro (a permutação é do par, não da loja).
- [ ] pglite/`asAnon`: `anon` não tem EXECUTE na RPC.
- [ ] pglite: lista incompleta (subconjunto) → exceção, `ordem` intacta.
- [ ] pglite: array multidimensional → barrado por `cardinality()`.
- [ ] pglite: **backfill** — categoria com 3 grupos recebe `ordem` 0,1,2 na ordem de
      `opcionais_categorias.ordem`; duas categorias de produto compartilhando um grupo recebem
      numeração independente (RN-13).
- [ ] pglite: **RN-12** — reordenar, depois salvar a associação marcando um grupo novo →
      a ordem dos antigos é preservada e o novo entra no fim.
- [ ] node: `schemaReordenacaoOpcionaisDaCategoria` rejeita duplicata, não-UUID,
      `categoria_id` ausente e propriedade extra.
- [ ] node: `moverPorDeslocamento` já tem cobertura (`reordenar.test.ts`) — reuso, não reteste.
- [ ] node (`renderToStaticMarkup`, sem jsdom): com 2+ grupos renderiza cabeçalhos de sanfona
      na ordem recebida; com 1 grupo renderiza lista plana; opcional de grupo fechado com
      qtd > 0 continua contabilizado no subtotal preview.

**API externa com key:** nenhuma.

## Decisões (v0.2.0 — respondidas pelo usuário em 2026-09-17)

**D-1 — Escopo da ordem: por categoria de produto.** Arrastar *Molhos* para antes de *Bebidas*
em *Lanches* muda a ordem **só em *Lanches***; em *Porções* a ordem anterior permanece. Isso
exige a coluna `ordem` em `categoria_produto_opcionais` (migration 1) e move o drag & drop da
"Biblioteca de opcionais" para dentro do cartão de cada categoria de produto, na seção
"Opcionais por categoria de produto". *(A v0.1.0 propunha ordem global por loja; foi rejeitada.)*

**D-2 — Estado inicial da sanfona: primeiro grupo aberto.** Os demais nascem fechados,
múltiplos podem ficar abertos ao mesmo tempo (`Accordion` em modo múltiplo).

**D-3 — Limiar da sanfona: `grupos.length > 1` literal.** Sem limiar composto por total de
itens: uma condição só, previsível, e que o lojista entende olhando quantos grupos associou.

### Débitos que estas decisões abrem

- **D-2 (débito)** — `opcionais_categorias.ordem` passa a ter um papel só: ordenar a Biblioteca
  no painel. Não é removida nesta feature (removê-la exigiria mexer no CRUD de hoje), mas vira
  candidata a limpeza. Registrar em `architecture.md` §10.
- **Divergência painel × vitrine** — a Biblioteca lista os grupos por
  `opcionais_categorias.ordem`, e a vitrine por `categoria_produto_opcionais.ordem`. São
  ordens legitimamente diferentes, mas o lojista pode estranhar. Mitigação na v1: o texto de
  apoio da Biblioteca deixa claro que a ordem que o cliente vê é definida por categoria de
  produto, logo abaixo.

## Fora do Escopo (v1)

- **Exibir opcionais no card da grade do catálogo** (`CardProduto` / `ItemProdutoLista`).
  Custa payload e render na superfície que a issue 207 acabou de otimizar, e o modal já é o
  lugar da escolha. Se virar demanda, é spec própria com auditoria do `acelerar`.
- **Reordenar os opcionais (itens) dentro de um grupo por drag & drop.** `opcionais.ordem` já
  existe e já ordena; o CRUD de hoje edita `ordem` por formulário. Drag & drop de item é o
  próximo passo natural — fica para v2, reusando o mesmo componente.
- **Ordem global por loja como fallback configurável** ("usar a mesma ordem em todas as
  categorias de produto"). A v1 é sempre por categoria; um atalho de copiar ordem de uma
  categoria para outra é candidato a v2.
- **Regras de seleção por grupo** (mínimo/máximo obrigatório, "escolha 1 de 3", grupo
  obrigatório antes de adicionar ao carrinho). É feature de modelagem de opcional, não de
  apresentação, e muda o gate `podeConfirmar` e o recálculo do servidor. Fase 2/3.
- **Reordenar categorias de opcional arrastando direto na vitrine** (edição inline pelo
  lojista logado na vitrine) — a vitrine é pública e sem estado de auth por decisão de
  arquitetura.
- **Busca/filtro de opcionais dentro do modal.**
- **Persistir a sanfona aberta entre aberturas do modal** (localStorage / URL). O estado morre
  com o modal, como `qtdOpcionais` hoje.
