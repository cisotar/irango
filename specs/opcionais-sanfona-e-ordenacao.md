# Spec: Opcionais em sanfona e ordenação das categorias de opcional

**Versão:** 0.1.0 | **Atualizado:** 2026-09-16

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
   reusando exatamente o mesmo mecanismo já entregue para categorias de produto
   (issue 175 — `ReordenarCategorias` + `moverPorDeslocamento` + RPC de escrita em lote).
   A ordem escolhida pelo lojista é a ordem em que os grupos aparecem na sanfona da vitrine.

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
| **Lojista** | arrasta as categorias de opcional para definir a ordem em que o cliente as vê. É o único que escreve `opcionais_categorias.ordem` da própria loja. |
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
  **sem mudança de assinatura nem query nova** (a query já ordena os grupos por
  `opcionais_categorias.ordem` e os itens por `opcionais.ordem`).

**Behaviors:**

- [ ] **Ver os grupos de opcional na ordem definida pelo lojista** — a sequência dos grupos é
      lida do banco por `buscarOpcionaisPorCategoria` (`.order` em `opcionais_categorias.ordem`).
      Garantido em: **Server Component + RLS** (`opc_cat_leitura_publica` via
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
**Descrição:** na seção "Biblioteca de opcionais" o lojista ganha um botão **"Reordenar
categorias"** que troca a listagem normal por uma lista arrastável, exatamente como já
acontece em `/painel/produtos` para categorias de produto.

**Componentes:**

- `OpcionaisClient` — `src/app/(painel)/painel/(bloqueavel)/produtos/opcionais/OpcionaisClient.tsx`.
  **Modificado**: novo estado "modo reordenar" + nova chave obrigatória em
  `OpcionaisClientAcoes` (`reordenarCategoriasOpcional`), seguindo a regra da issue 160
  (sem default — omitir quebra o build em vez de cair na action do lojista).
- `ReordenarCategoriasOpcional` — **novo**, `src/components/painel/ReordenarCategoriasOpcional.tsx`.
  Irmão de `ReordenarCategorias.tsx`, **não** uma segunda implementação: reusa
  `DndContext`/`SortableContext`/`PointerSensor`/`KeyboardSensor` do `@dnd-kit` (já em
  `package.json`), `moverPorDeslocamento` + `mensagemPosicao` de `src/lib/utils/reordenar.ts`,
  `criarSalvamentoCoalescido` de `src/lib/utils/salvamento-coalescido.ts` (debounce 500ms,
  fila, flush) e o handle imperativo `finalizar()` que o pai aguarda antes do `router.refresh()`.
  **Antes de criar o arquivo, avaliar extrair o miolo genérico de `ReordenarCategorias`**
  (lista + dnd + coalescência) para um componente parametrizado por rótulo/linha — duplicar
  ~380 linhas de acessibilidade em pt-BR é o cenário que o mandato "não reinventar a roda"
  existe para evitar. A decisão fica para o `planejar`.
- `LinhaCategoriaReordenavel` — `src/components/painel/LinhaCategoriaReordenavel.tsx`.
  **Reuso** (já é genérico: `useSortable`, alça `GripVertical` de 44×44 com
  `touchAction: none`). Se hoje tipar `Categoria` de produto, generalizar o prop para
  `{ id, nome, detalhe? }`.
- `Card`, `CardContent`, `Button`, `Badge`, `Separator` — primitivos existentes.
- `toast` (sonner) — feedback de falha, como em `ReordenarCategorias`.

**Behaviors:**

- [ ] **Entrar no modo "Reordenar categorias"** — troca a listagem pela lista arrastável,
      com **todas** as categorias de opcional da loja (inclusive as vazias, pelo mesmo
      motivo documentado na issue 175: normalizar sobre subconjunto reintroduz empate de
      `ordem`). Garantido em: cliente (UX) — a lista já veio filtrada por RLS no SSR.
- [ ] **Arrastar uma categoria para outra posição** — a lista local reordena antes da rede
      (**preview otimista**), via `moverPorDeslocamento` (deslocamento, não troca de pares).
      Garantido em: cliente (UX). **A ordem só é verdade depois do servidor gravar.**
- [ ] **Mover categoria por teclado (espaço + setas)** — `KeyboardSensor` +
      `sortableKeyboardCoordinates`, com anúncio em pt-BR ("Molhos movida para a posição 2 de 4"
      — `mensagemPosicao`). Garantido em: cliente (UX / WCAG AA).
- [ ] **Persistir a nova ordem** — cada movimento agenda um salvamento coalescido que envia a
      **sequência completa de ids** (nunca um delta) para a Server Action
      `reordenarCategoriasOpcional`. Garantido em: **Server Action + RPC
      `reordenar_categorias_opcional` (SECURITY INVOKER) + RLS `opc_cat_escrita_propria`**.
      `loja_id` vem de `buscarLojaDoDono(auth.uid())`, **nunca do payload**; `ordem` é derivada
      de `ordinality - 1` no servidor — o cliente nunca manda número de ordem.
- [ ] **Ver falha de salvamento sem perder o estado** — id alheio, lista incompleta ou erro de
      banco derrubam a transação inteira (nada gravado em nenhuma loja) e retornam **uma única**
      mensagem genérica "Não foi possível salvar a ordem." Garantido em: **Server Action**
      (`seguranca.md` §14 — mensagem distinta viraria oráculo de existência de id).
- [ ] **Sair do modo (Concluir / ESC) sem perder o último movimento** — o pai chama
      `finalizar()` pelo `ref`, **aguarda o flush** e só então desmonta e faz `router.refresh()`.
      Garantido em: cliente (UX) + Server Action (a escrita é quem confirma).
- [ ] **Ver a nova ordem refletida na vitrine** — a action chama
      `revalidatePath("/painel/produtos/opcionais")` e `revalidatePath("/loja/" + loja.slug)`
      (slug da própria loja, **nunca** a forma coringa `("/loja/[slug]", "page")`, que
      invalidaria o Router Cache de todas as lojas). Garantido em: **Server Action**.

---

### Opcionais da loja assinante (hub admin) — `/admin/assinantes/[lojaId]/produtos/opcionais`

**Mundo:** painel admin (auth obrigatório + gate de dono do SaaS)
**Descrição:** paridade. O `OpcionaisAdminClient` injeta a variante escopada por `lojaId`
da nova action, como já faz com as 8 existentes.

**Componentes:**

- `OpcionaisAdminClient` — `src/app/admin/assinantes/[lojaId]/produtos/opcionais/OpcionaisAdminClient.tsx`,
  **modificado** para injetar `reordenarCategoriasOpcional`.
- `reordenarCategoriasOpcionalAdmin` — **nova** em
  `src/app/admin/assinantes/actions/admin-opcionais.ts`, no padrão de
  `reordenarCategoriasAdmin` (`validarLojaIdAdmin` → `prepararContextoAdmin` → escrita
  carregando o escopo da loja-alvo → `registrarAcessoAdmin` → `revalidarLojaAdmin`).

**Behaviors:**

- [ ] **Reordenar as categorias de opcional de uma loja assinante em suporte** —
      Garantido em: **Server Action admin** (gate de dono do SaaS + `validarLojaIdAdmin` +
      escopo explícito por `lojaId` no wrapper de escrita). **Não** reusa a RPC do lojista
      sob `service_role`: a RPC é `SECURITY INVOKER` e a RLS do lojista não vale para o admin.
- [ ] **Registrar o acesso admin** — `registrarAcessoAdmin(svc, { lojaId, acao:
      "reordenar_categorias_opcional" })`. Garantido em: **Server Action admin** (trilha de
      auditoria, `seguranca.md`).

---

## Modelos de Dados

Referência: `references/schema.md` + migration `20260614007500_opcionais.sql`.

| Tabela | Uso nesta feature | Migration nova? |
|--------|-------------------|-----------------|
| `opcionais_categorias` | `ordem int not null default 0` **já existe**, com índice `(loja_id, ordem)`. É a coluna que o drag & drop escreve. | **Não** |
| `opcionais` | `ordem` já existe e já ordena os itens dentro do grupo. Sem mudança. | Não |
| `categoria_produto_opcionais` | define **quais** grupos aparecem em cada categoria de produto. Sem mudança. | Não |
| `itens_pedido_opcionais` | snapshot do pedido. Sem mudança. | Não |

**Nenhuma coluna nova. Nenhuma tabela nova. Nenhuma política RLS nova.** As políticas de
`opcionais_categorias` já cobrem exatamente o que a feature precisa:
`opc_cat_leitura_publica` (vitrine, via `loja_esta_ativa`) e `opc_cat_escrita_propria`
(`for all`, `using` **e** `with check` em `lojas.dono_id = auth.uid()`).

### Migration nova: RPC de escrita em lote

`supabase/migrations/<ts>_rpc_reordenar_categorias_opcional.sql` —
`public.reordenar_categorias_opcional(p_loja_id uuid, p_ids uuid[]) returns integer`,
espelho fiel de `reordenar_categorias` (`20260908120000` + `20260908130000`):

- `language plpgsql`, **`security invoker`** (carga estrutural, não estilo: sob `DEFINER`,
  `p_loja_id` é escolhido pelo chamador e um lojista reescreveria a ordem de outra loja —
  `seguranca.md` §2 "RPC de escrita em lote do lojista");
- `set search_path = public`;
- exige que `p_ids` seja a **permutação completa** de `opcionais_categorias where loja_id =
  p_loja_id` — subconjunto reintroduziria empate de `ordem`;
- **`cardinality(p_ids)`**, nunca `array_length(p_ids, 1)` (achado corrigido em
  `20260908130000`: array multidimensional burlaria a checagem e corromperia a `ordinality`);
- `update ... from unnest(p_ids) with ordinality` com `set ordem = e.pos - 1` e
  `and oc.loja_id = p_loja_id` (escopo explícito **além** da RLS);
- confere `row_count` e levanta exceção se divergir → transação inteira derrubada;
- `revoke all on function ... from public, anon;` + `grant execute ... to authenticated,
  service_role;` (o Postgres concede EXECUTE a PUBLIC por padrão e o projeto não tem
  `alter default privileges ... on functions`).

Após a migration: `npx supabase gen types typescript > src/lib/database.types.ts`.
**Deploy no cloud (`npx supabase db push`) exige autorização explícita do usuário.**

### Validação

`src/lib/validacoes/opcional.ts` — **adicionar** `schemaReordenacaoCategoriasOpcional`,
espelhando `schemaReordenacaoCategorias` de `validacoes/produto.ts`:
`z.array(z.guid()).min(2).max(200)` + `.refine` de ids únicos. O parse devolve **array novo**,
então propriedade hostil pendurada pelo cliente (ex.: `loja_id`) não chega aos args da RPC.

---

## Regras de Negócio

| # | Regra | Camada que garante |
|---|-------|--------------------|
| RN-1 | Com **2 ou mais** grupos de opcional, cada grupo é uma sanfona; com **1**, lista plana sem cabeçalho de sanfona; com **0**, a seção "Opcionais" não existe (como hoje). | cliente (UX) — decisão de render sobre `grupos.length` |
| RN-2 | A ordem dos grupos na vitrine é **sempre** `opcionais_categorias.ordem` ascendente. Empate resolvido por `nome` para render determinístico (SSR/hidratação). | **Server Component** (`buscarOpcionaisPorCategoria`) + índice `(loja_id, ordem)` |
| RN-3 | A ordem é dado **autoritativo do servidor**. O drag & drop é preview otimista; um recarregamento mostra a ordem do banco, não a da tela. | **Server Action + RPC + RLS** |
| RN-4 | O cliente da reordenação envia **sequência de ids**, nunca valores de `ordem`. `ordem` = `ordinality - 1`, derivada no servidor. | **RPC** |
| RN-5 | `p_loja_id` vem de `buscarLojaDoDono(auth.uid())`, nunca do payload. | **Server Action** |
| RN-6 | A lista enviada tem que ser a permutação completa das categorias de opcional da loja; id alheio, duplicado ou inexistente derruba a transação e **não grava nada em nenhuma loja**. | **RPC** (contagem + `row_count`) + **RLS** |
| RN-7 | Reordenar é operação **do lojista dono** (ou do admin, pela via escopada). `anon` não executa a RPC. | **`revoke ... from public, anon` + RLS** |
| RN-8 | Preço de opcional, subtotal e total continuam **preview** na vitrine. O pedido é recalculado de `opcionais.preco` no banco. Esta feature **não toca** nesse caminho. | **Server Action `criarPedido` + `buscarOpcionaisPorIds`** (`seguranca.md` §10) |
| RN-9 | Recolher uma sanfona **não** limpa as quantidades já escolhidas daquele grupo; o contador no cabeçalho preserva a visibilidade da escolha. | cliente (UX) |
| RN-10 | A ordem é **por loja**, não por produto: um mesmo grupo associado a duas categorias de produto aparece na mesma posição relativa nas duas. Ver *Perguntas em aberto*. | **banco** (`opcionais_categorias.ordem` é coluna da categoria, não da associação) |
| RN-11 | A feature **não adiciona query nem payload** à vitrine: `buscarOpcionaisPorCategoria` já é chamada e já traz `ordem`. A paralelização e o `cache()` por request da issue 207 seguem intactos. | revisão de `acelerar` |

---

## Segurança (obrigatório)

**Dado sensível que entra/sai:** nenhum PII novo. O payload da reordenação é uma lista de
UUIDs de categorias de opcional da própria loja. A vitrine não expõe nada que já não expusesse
— `opcionais` continua filtrado por `ativo = true` + `loja_esta_ativa` pela RLS.

**Valor monetário:** a feature **não cria** caminho novo de dinheiro. O preço do opcional
exibido no modal segue sendo **preview de UX**; o valor autoritativo é recalculado na Server
Action de criação do pedido a partir de `opcionais.preco` no banco (`buscarOpcionaisPorIds`,
`seguranca.md` §10). **Requisito de regressão:** a mudança de layout não pode alterar
`opcionaisEscolhidos` nem `calcularSubtotal` — os opcionais de um grupo **fechado** mas com
quantidade > 0 **continuam entrando** no carrinho (o achatamento é sobre `grupos`, não sobre
o que está visível na tela).

**Tabela nova:** não. **Política RLS nova:** não — `opc_cat_leitura_publica` e
`opc_cat_escrita_propria` já cobrem leitura pública e escrita do dono.

**Função nova:** sim, `public.reordenar_categorias_opcional`. Checklist obrigatório
(`seguranca.md` §2, "RPC de escrita em lote do lojista"):

- [ ] `security invoker` (nunca `definer`)
- [ ] `set search_path = public`
- [ ] `revoke all on function ... from public, anon`
- [ ] `grant execute ... to authenticated, service_role`
- [ ] `cardinality()` para validar o array do cliente
- [ ] `where loja_id = p_loja_id` como segunda camada além da RLS
- [ ] permutação completa + conferência de `row_count`, com exceção derrubando a transação

**Testes críticos (TDD red-first — dinheiro/RLS/autorização):**

- [ ] pglite/`asUser`: lojista A chama a RPC com um id de categoria de opcional da loja B →
      **erro, zero linhas escritas nas duas lojas** (a loja de teste autorizada no cloud é
      "Lanches base"; no CI isso roda em `tests/migrations/` com `createTestDb()`).
- [ ] pglite/`asAnon`: `anon` não tem EXECUTE na RPC.
- [ ] pglite: lista incompleta (subconjunto) → exceção, `ordem` intacta.
- [ ] pglite: array multidimensional → barrado por `cardinality()`.
- [ ] node: `schemaReordenacaoCategoriasOpcional` rejeita duplicata, não-UUID e propriedade extra.
- [ ] node: `moverPorDeslocamento` já tem cobertura (`reordenar.test.ts`) — reuso, não reteste.
- [ ] node (`renderToStaticMarkup`, sem jsdom): com 2+ grupos renderiza cabeçalhos de sanfona
      na ordem recebida; com 1 grupo renderiza lista plana; opcional de grupo fechado com
      qtd > 0 continua contabilizado no subtotal preview.

**API externa com key:** nenhuma.

---

## Perguntas em aberto (decidir antes de `quebrar`)

1. **Ordem global por loja vs. por categoria de produto.** A associação vive em
   `categoria_produto_opcionais`, mas `ordem` é coluna de `opcionais_categorias` — logo a
   ordem é **por loja**. Ordem diferente do mesmo grupo em produtos diferentes exigiria uma
   coluna `ordem` na tabela de associação (migration + backfill + mudança no agrupamento da
   query). **Proposta v1: ordem global por loja** (zero migration de coluna, cobre o caso
   real de "molhos antes de bebidas"). Confirmar com o usuário.
2. **Estado inicial da sanfona.** Proposta: primeiro grupo aberto, demais fechados, múltiplos
   abertos permitidos. Alternativa: todos fechados (menos rolagem, mais um toque). Confirmar.
3. **Limiar da sanfona.** A descrição diz "mais de uma categoria". Proposta: `> 1` literal.
   Se o lojista tiver 2 grupos de 2 itens cada, a sanfona pode ser pior que a lista plana —
   avaliar com `desenhar` se vale um limiar por **total de itens** em vez de por nº de grupos.

---

## Fora do Escopo (v1)

- **Exibir opcionais no card da grade do catálogo** (`CardProduto` / `ItemProdutoLista`).
  Custa payload e render na superfície que a issue 207 acabou de otimizar, e o modal já é o
  lugar da escolha. Se virar demanda, é spec própria com auditoria do `acelerar`.
- **Reordenar os opcionais (itens) dentro de um grupo por drag & drop.** `opcionais.ordem` já
  existe e já ordena; o CRUD de hoje edita `ordem` por formulário. Drag & drop de item é o
  próximo passo natural — fica para v2, reusando o mesmo componente.
- **Ordem por categoria de produto** (ver Pergunta 1) — precisaria de coluna nova na
  associação; fase 2.
- **Regras de seleção por grupo** (mínimo/máximo obrigatório, "escolha 1 de 3", grupo
  obrigatório antes de adicionar ao carrinho). É feature de modelagem de opcional, não de
  apresentação, e muda o gate `podeConfirmar` e o recálculo do servidor. Fase 2/3.
- **Reordenar categorias de opcional arrastando direto na vitrine** (edição inline pelo
  lojista logado na vitrine) — a vitrine é pública e sem estado de auth por decisão de
  arquitetura.
- **Busca/filtro de opcionais dentro do modal.**
- **Persistir a sanfona aberta entre aberturas do modal** (localStorage / URL). O estado morre
  com o modal, como `qtdOpcionais` hoje.
