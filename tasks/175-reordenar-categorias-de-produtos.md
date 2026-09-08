# [175] Reordenar categorias de produtos por arrasto no painel

**crítica:** SIM — **escopo restrito à Server Action `reordenarCategorias`**
(autorização por loja, escrita em lote a partir de ids vindos do cliente). A UI
de sanfona e arrasto **não** é crítica e não exige teste vermelho prévio.
**Mundo:** painel do lojista → com efeito direto na vitrine pública
**Depende de:** PR `chore/higiene-pos-159` (mexe no mesmo `ProdutosClient.tsx`)
**Origem:** pedido do usuário em 2026-09-08. Plano de execução em
`plan/loop-reordenar-categorias-produtos.md`.

## Problema

O lojista não tem como reordenar as categorias do próprio cardápio. Hoje a
ordem é decidida no momento da criação e nunca mais muda: `GerenciarCategorias`
manda `ordem: categorias.length` ao criar
(`src/components/painel/GerenciarCategorias.tsx:95`) e preserva o valor ao
editar (linha 110). Não existe nenhum caminho de UI que troque duas categorias
de lugar.

Isso não é cosmético: `buscarCategorias` ordena por `ordem`
(`src/lib/supabase/queries/categorias.ts:27`) e a vitrine pública herda essa
ordem no cardápio que o cliente final vê. Ou seja, **a ordem de cadastro vira a
ordem de venda**, e o lojista não consegue promover a categoria que quer
destacar.

### Efeito colateral já existente: empate de `ordem`

`ordem: categorias.length` colide depois de uma remoção. Com categorias em
0,1,2, ao remover a do meio sobram 0 e 2; a próxima criada recebe `ordem = 2` e
**empata** com a existente. Não há `UNIQUE` em `ordem` (confirmado em
`supabase/migrations/`), então o desempate fica a critério do Postgres e a
ordem pode variar entre requisições. Normalizar para 0..n−1 a cada
reordenação **corrige isso de graça**.

## O que o usuário pediu

1. Botão no topo de `/painel/produtos`: **"Reordenar categorias"**.
2. Cada categoria vira uma **sanfona**; o botão colapsa todas para facilitar o
   arrasto.
3. Semântica de **deslocamento de índice**, não troca de pares: soltar o card 1
   sobre a posição do card 3 faz 1 assumir a posição 3, e 2 e o antigo 3
   deslocarem para 1 e 2.
4. Vale para **desktop e mobile (toque)**.

## Estado do terreno (verificado)

- ~~**Sem migration.**~~ **REVISADO no Plano Técnico → passa a EXIGIR migration**
  (função Postgres `reordenar_categorias`; o supabase-js não faz update-many com
  valor diferente por linha). O resto do bullet segue válido:
  `categorias.ordem int not null default 0` existe desde
  `supabase/migrations/20260614000129_schema_inicial.sql:64`; índice
  `categorias_loja_ordem` em `20260614010000_indexes.sql:17`; RLS ativa na
  tabela. Nenhum `UNIQUE` em `ordem` → update em lote não colide. **Nenhuma
  tabela, coluna ou índice novo** — só a função.
- **Sem query nova na vitrine.** `buscarCategorias` já ordena por `ordem`; a
  vitrine herda a mudança sem uma linha a mais.
- **Sanfona sem dependência nova.** `@base-ui/react` já está no projeto e traz
  `accordion` → `npx shadcn@latest add accordion`.
- **`schemaCategoria` já exige `ordem`** (`z.number().int().min(0)` em
  `src/lib/validacoes/produto.ts:45`) — a nova action precisa do seu próprio
  schema, de lista.
- **"Sem categoria" é grupo sintético do cliente**, montado em
  `ProdutosClient.tsx:107-125`; não existe linha em `categorias` e portanto
  **não é arrastável** e não entra no payload.

### Bloqueante: categoria vazia não é renderizada hoje

`ProdutosClient.tsx:130` faz `grupos.filter((g) => g.produtos.length > 0)`.
Consequências que o modo reordenar precisa contornar:

1. O lojista não conseguiria posicionar a categoria recém-criada — que nasce
   vazia, e é justamente quando ele quer posicioná-la.
2. Normalizar `0..n−1` sobre um SUBCONJUNTO **reintroduz o empate** que esta
   issue queria corrigir: as vazias mantêm a `ordem` antiga e colidem.
3. `categorias.length ≠ grupos.length`, então o gate do botão e o
   "posição X de N" anunciado por leitor de tela mentiriam.

**Contrato:** o modo reordenar lê da prop `categorias` (todas, já ordenadas por
`buscarCategorias`), **nunca de `grupos`**. Categoria vazia aparece só nesse
modo, rotulada `0 produtos`. O cliente envia **só a sequência de ids** — o tipo
`Categoria` (`src/components/painel/FormProduto.tsx:22-27`) não expõe `ordem` e
não deve passar a expor.

## Risco de segurança que esta issue precisa não repetir

A action nova recebe **uma lista de ids do cliente** e escreve em lote — é
autorização, e é por isso que ela é crítica. O padrão vizinho é frágil:
`atualizarCategoria` (`src/lib/actions/produto.ts:273-276`) faz
`.update({ ...parsed.data, loja_id: loja.id }).eq("id", id)` — busca a loja do
dono mas **não filtra por ela**, confiando só na RLS; pior, escreve `loja_id`,
de forma que uma RLS permissiva reatribuiria categoria alheia para a própria
loja. `removerCategoria` (linha 296) deleta por `.eq("id", id)` sem nem chamar
`buscarLojaDoDono`.

O padrão CERTO já existe no mesmo arquivo e está documentado:
`categoriaPertenceALoja` (`produto.ts:34-47`) explica que a FK só garante que a
categoria existe em ALGUMA loja, e por isso escopa o SELECT com
`.eq("loja_id", lojaId)`. **A nova action segue esse padrão**: filtro explícito
por `loja_id` além da RLS.

> Os defeitos de `atualizarCategoria`/`removerCategoria` são **pré-existentes e
> fora do escopo deste PR** — viram issue própria, não código aqui.

## Escopo

- [ ] Server Action `reordenarCategorias(ids: string[])` em
      `src/lib/actions/produto.ts`, escopada por `loja_id` explícito, gravando
      `ordem` normalizada 0..n−1 numa única ida ao banco por soltar (não um
      save por card). Schema zod próprio para a lista.
- [ ] Função **pura** de reordenação (semântica de deslocamento) extraída e
      exportada, para ser testável sem DOM.
- [ ] Sanfona por categoria em `ProdutosClient.tsx` via `accordion` do shadcn
      (`npx shadcn@latest add accordion` — `@base-ui/react@1.5.0` já traz o
      primitivo; `src/components/ui/accordion.tsx` ainda não existe).
- [ ] Modo "Reordenar categorias": colapsa todas, lê de `categorias`, revela
      alças e setas.
- [ ] **Botões ↑/↓ por categoria** — caminho acessível, WCAG 2.2 SC 2.5.7.
- [ ] **"Mover para o topo" / "Mover para o fim"** no kebab da categoria.
- [ ] **Arrasto por alça** com `@dnd-kit/core` + `@dnd-kit/sortable`.
- [ ] Estado otimista no cliente com **revert em falha** da action.
- [ ] Região `aria-live` única, fora do `<ol>`.

## Cenários

1. **Deslocamento, não troca.** [A,B,C,D], arrastar A para a posição de C →
   [B,C,A,D]. Não [C,B,A,D].
2. **Para trás.** [A,B,C,D], arrastar D para a posição de B → [A,D,B,C].
3. **No lugar.** Soltar sobre a própria posição → nenhuma escrita.
4. **Empate pré-existente.** Duas categorias com a mesma `ordem` → depois de
   uma reordenação qualquer, todas ficam 0..n−1 sem empate.
5. **"Sem categoria"** nunca ganha alça e nunca entra no payload.
6. **Isolamento.** Lojista A manda id de categoria da loja B no array → nada da
   loja B é escrito, e o erro é genérico na UI.
7. **Falha de rede.** Action rejeita → a lista volta visualmente à ordem
   anterior e o toast informa.
8. **Limites da lista.** Na primeira categoria, o ↑ é `aria-disabled` e no-op; o
   foco permanece no botão. Na última, idem para o ↓.
9. **Toques rápidos coalescidos.** Três toques seguidos em ↓ resultam em UMA
   escrita, com a sequência final de ids.
10. **Categoria vazia.** Loja com uma categoria sem produtos: ela não aparece na
    listagem normal, mas **aparece no modo reordenar** com `0 produtos`, e entra
    na normalização.
11. **Gate do botão.** Loja com 1 categoria não renderiza "Reordenar
    categorias"; com 2 renderiza.

## Critério de aceite

- [ ] Teste **vermelho antes** da implementação da action (cenários 6 e 4).
- [ ] Ordem persiste após reload do painel.
- [ ] **A vitrine pública mostra a mesma ordem**, lida como anon.
- [ ] Função pura coberta pelos cenários 1–3.
- [ ] Cenários 8, 10 e 11 provados por `renderToStaticMarkup` (derivação de
      estado → HTML), no padrão de `ProdutosClient.test.tsx`.
- [ ] Alvos de toque ≥ 44px (mesma régua do fix do card em `chore/higiene-pos-159`).
- [ ] Gate do CI verde: `tsc` → `lint` → `test` → `build`.
- [ ] Arrasto verificado à mão em dispositivo real (iOS Safari e Chrome
      Android), com a limitação registrada no PR — ver "Limite conhecido de
      teste".

## Decisões fechadas na Fase 2 (contrato de interação)

Contrato completo em `mockups/reordenar-categorias-painel.md`; preview dos três
estados em `mockups/reordenar-categorias-painel.html`.

- **Os dois caminhos, numa entrega só.** Botões ↑/↓ (caminho acessível,
  obrigatório) **e** arrasto por alça. Decidido pelo usuário em 2026-09-08.
- **Biblioteca:** `@dnd-kit/core` + `@dnd-kit/sortable`. Instalação autorizada
  pelo usuário; confirmar versão e advisories antes do `npm install`.
- **Alça dedicada**, nunca o card inteiro. Arrastar o card exigiria
  `touch-action: none` na área útil da página e mataria o scroll vertical. O
  header já é um `<button>` (o gatilho da sanfona): o mesmo pixel não pode ser
  "expandir" no toque curto e "arrastar" no longo.
- **`GripVertical`, 44×44 literal, `touch-action: none` só na alça.** Com alça,
  `PointerSensor` com `distance: 8` basta — não é preciso `TouchSensor` com
  delay.
- **`aria-live` numa região só**, `sr-only`, `role="status"`,
  `aria-live="polite"`, `aria-atomic="true"`, **fora do `<ol>`** e nunca dentro
  do `<li>` que se move (ele remonta e o anúncio silencia ou duplica).
  Precedente do projeto: `src/components/vitrine/confirmacao/LinhaTempoStatus.tsx:37-39`.
  Toda mensagem nomeia categoria + posição resultante sobre o total:
  `Pizzas movida para a posição 2 de 6.`
- **Traduzir os `announcements` e `screenReaderInstructions` do dnd-kit** — o
  default em inglês vazaria para o leitor de tela do lojista.
- **`DragOverlay` em portal**: sem ele o `overflow` do `Card` clipa o item. O
  slot de origem vira placeholder tracejado de mesma altura, nunca colapsa a
  zero.
- **Entrada/saída do modo:** `[⇅ Reordenar categorias]` (`outline`) colapsa tudo
  e troca a barra por `[Concluir]` (`default`). `ESC` também sai. Sem diálogo de
  confirmação: cada movimento já foi persistido, "Concluir" só restaura a tela.
- **"+ Novo produto" e as ações de produto somem no modo** — não ficam
  `disabled`. Botão desabilitado sai da tabulação e não explica por que está
  inerte.
- **Estado vazio:** gate sobre `categorias.length`. 0 ou 1 categoria → o botão
  não renderiza. `≥ 2` renderiza, inclusive categorias com 0 produtos.
- **"Sem categoria"** aparece no modo, fixo no fim, com `Lock` e "Sempre por
  último" — **sem setas**, nem desabilitadas. Nunca renderizar controle que não
  faz nada.

### Duas armadilhas obrigatórias

- **Limites da lista usam `aria-disabled="true"` + `onClick` no-op, nunca
  `disabled`.** O `disabled` real perde o foco para o `<body>` ao mover um item
  para o topo — é o bug número 1 desse padrão.
- **Coalescer toques rápidos** (debounce ~500ms; payload = sequência completa de
  ids) para cumprir "uma única ida ao banco por operação".
- `size="icon-sm"` é 33,6px na base de 120% do projeto: **proibido aqui**.

## Limite conhecido de teste

O projeto roda vitest com `environment: "node"`, **sem jsdom e sem
@testing-library** (confirmado em `vitest.config.ts` e `package.json`). Testes
de client component usam `renderToStaticMarkup` e provam derivação de estado →
HTML, não clique — ver o cabeçalho de
`src/app/(painel)/painel/(bloqueavel)/produtos/ProdutosClient.test.tsx`.

Logo: a função pura, a action e o **markup do modo reordenar** são testáveis; o
**gesto de arrasto não é**. Ele precisa de verificação manual em dispositivo
real, e o PR deve registrar isso em vez de afirmar "validado em mobile".

## Relacionada

- `plan/loop-reordenar-categorias-produtos.md` — plano de execução.
- Issue a abrir: escopo por `loja_id` em `atualizarCategoria` e
  `removerCategoria` (pré-existente, fora deste PR).

---

## Plano Técnico

### ⚠️ Mudança de escopo: a issue passa a EXIGIR migration

A issue afirma em "Estado do terreno": **"Sem migration."** Isso deixa de valer.

O requisito "gravar `ordem` normalizada 0..n−1 numa única ida ao banco" não tem
solução segura no supabase-js: PostgREST não faz update-many com **valor
diferente por linha**. As três saídas reais foram avaliadas abaixo; a escolhida
é uma **função Postgres** (`public.reordenar_categorias`), e função nova é
migration nova. O resto do terreno verificado na issue continua válido
(`ordem` já existe, índice já existe, RLS já existe, nenhum `UNIQUE` em `ordem`,
vitrine sem query nova).

Consequência operacional: `npx supabase db push` é irreversível e precisa de
autorização explícita do usuário (CLAUDE.md). E precisa acontecer **antes** do
fim da fase GREEN — ver "Ordem de Implementação", passo 6.

---

### Análise do Codebase

#### O que já existe e será REUSADO (nada disso se reescreve)

| Arquivo | O que já faz | Como esta issue usa |
|---|---|---|
| `src/lib/actions/produto.ts:34-47` — `categoriaPertenceALoja` | Documenta o porquê do escopo explícito por `loja_id` além da RLS (a FK só garante que a categoria existe em ALGUMA loja) | **Princípio herdado** pela action nova. Não é chamada diretamente: o equivalente para uma LISTA vira a checagem de permutação completa dentro da RPC, que é atômica e livre de TOCTOU (ver "Recálculo/Autoridade no Servidor") |
| `src/lib/actions/produto.ts` — contrato de action do lojista | `payload: unknown` → `safeParse` antes de qualquer I/O → `createClient()` autenticado (nunca `service_role`) → `buscarLojaDoDono` → escrita → `console.error` + mensagem genérica | `reordenarCategorias` copia esse esqueleto linha a linha |
| `src/lib/supabase/queries/lojas.ts` — `buscarLojaDoDono` | Deriva a loja do `auth.uid()` | Única fonte de `p_loja_id`. O cliente **nunca** manda loja |
| `src/lib/validacoes/produto.ts` | Casa dos schemas de produto/categoria; `z.guid()` é a convenção do projeto para uuid | Recebe `schemaReordenacaoCategorias`. **Arquivo novo em `validacoes/` seria duplicação de domínio** |
| `src/lib/validacoes/pedido.ts:80-82` | Teto de cardinalidade de array com comentário CWE-770 | Precedente literal para o `.max()` do array de ids |
| `src/app/admin/assinantes/actions/admin-categorias.ts` | `count: "exact"` + `count === 0` → "não encontrada" | Precedente de "provar que a escrita atingiu o que devia". Aqui a prova é o `row_count` dentro da RPC |
| `supabase/migrations/20260615011500_garantir_loja_do_dono.sql` | Padrão de função Postgres do projeto: header explicando a decisão, `set search_path = public`, `REVOKE ALL FROM PUBLIC/anon` + `GRANT EXECUTE` ao papel mínimo | Molde da migration nova (com `security invoker` no lugar de `definer` — ver por quê abaixo) |
| `src/lib/supabase/queries/categorias.ts:19-30` — `buscarCategorias` | Já ordena por `ordem`; a vitrine herda | **Zero query nova.** Ganha só um `.order("id")` de desempate (ver "Modificar") |
| `src/lib/actions/admin-loja.ts:187-191` — `revalidarLojaAdmin` | `revalidatePath("/loja/[slug]", "page")` | Precedente para invalidar a vitrine — é o que torna verdadeiro o critério "a vitrine mostra a mesma ordem" |
| `src/lib/actions/produto.test.ts:58-97` — harness de mock | Cadeia thenável por tabela, `respostaPorTabela`, `opEscrita()` | Reusado pelo teste da action; ganha um ramo `rpc` (ver "O que é testável") |
| `tests/helpers/pglite.ts` — `createTestDb`/`asUser`/`asAnon` | Sobe Postgres WASM com todas as migrations + RLS real | Onde os cenários 4 e 6 são de fato provados |
| `src/components/vitrine/confirmacao/LinhaTempoStatus.tsx:37-39` | Região viva única, `sr-only`, nunca aninhada | Precedente autoritativo do `aria-live` (mockup §3.1) |
| `src/components/ui/{button,card,badge,menu,separator}.tsx` | shadcn já gerados | Reusados como estão. **`components/ui/` não se edita à mão** |
| `src/app/(painel)/.../ProdutosClient.tsx:403` | `min-h-[44px] min-w-[44px]` **literal** com o comentário do porquê (`min-h-11` = 52,8px na base de 120%) | Régua de alvo de toque copiada para alça, ↑ e ↓ |

#### O que precisa ser CRIADO, e por que não dá para reusar

| Novo | Por que não existe equivalente |
|---|---|
| RPC `public.reordenar_categorias` | Nenhuma função de banco do projeto escreve `ordem` em lote. As RPCs existentes são de pedido/loja/billing |
| `schemaReordenacaoCategorias` | `schemaCategoria` valida **uma** categoria e exige `nome` + `ordem` — exatamente os dois campos que esta operação **não** pode aceitar do cliente |
| `src/lib/utils/reordenar.ts` | `grep` em `src/lib/utils/` (68 arquivos): nada de reordenação/`arrayMove`. Sobre não usar o `arrayMove` do `@dnd-kit/sortable`, ver a caixa abaixo |
| `ReordenarCategorias.tsx` + `LinhaCategoriaReordenavel.tsx` | `GerenciarCategorias.tsx` é a única lista que enxerga todas as categorias, mas é CRUD dentro de um `Sheet`, sem `<ol>`, sem posição, sem alça. Estendê-lo colidiria com o "fora de escopo" do mockup §8 |
| `src/components/ui/accordion.tsx` | Não existe. **Gerado pelo CLI**, não escrito à mão: `npx shadcn@latest add accordion` (`components.json` → `style: "base-nova"`, `@base-ui/react@^1.5.0` já instalado) |

> **Por que NÃO usar `arrayMove` do `@dnd-kit/sortable` (mandato 2 — justificativa obrigatória).**
> `arrayMove` é `splice(to < 0 ? length + to : to, ...)`: um `to` negativo **dá a
> volta e joga o item no fim**. No caminho ↑/↓ isso é um bug alcançável — `↑` na
> primeira posição chama `para = -1` e a categoria do topo iria para o último
> lugar em vez de virar no-op (cenário 8). Precisamos de clamp + no-op de
> identidade, que `arrayMove` não tem. Como a função teria que existir de
> qualquer jeito, ela não delega — e assim `src/lib/utils/` fica livre de uma
> dependência React de cliente, e o teste unitário roda em `environment: node`
> sem importar nada.

#### Dois achados pré-existentes (registrar, NÃO corrigir aqui)

1. **`CAMINHO_PAINEL = "/painel/cardapio"` não existe como rota.** As rotas do
   painel são `configuracoes`, `cupons`, `pedidos`, `produtos` — não há
   `cardapio` em lugar nenhum de `src/app/`. Logo os 9 `revalidatePath` de
   `produto.ts` e os 8 de `opcional.ts` são **no-op**; a tela só atualiza porque
   o cliente chama `router.refresh()`. Corrigir isso mudaria o comportamento de
   cache de 17 actions → **issue própria**. A action nova **não** usa
   `CAMINHO_PAINEL`: usa os caminhos reais (ver assinatura).
2. Os defeitos de escopo de `atualizarCategoria`/`removerCategoria` já estão
   registrados na issue como fora do PR. Continuam fora.

---

### Cenários

**Caminho feliz**

1. Lojista com ≥2 categorias abre `/painel/produtos`; o botão `[⇅ Reordenar categorias]` aparece.
2. Clica → todas as sanfonas colapsam, a barra de ações troca por `[Concluir]`, a lista passa a ser renderizada a partir de `categorias` (todas, inclusive vazias), o foco vai para o primeiro controle de mover e a região viva anuncia `Modo reordenar ativado. N categorias. …`.
3. Toca `↓` na categoria 1 → `moverPorDeslocamento(ids, 0, 1)` devolve um array novo → o estado local reordena **antes** da rede (otimista), a linha translada 180ms, recebe o realce de pouso e a região viva anuncia `Pizzas movida para a posição 2 de N.`
4. Passados ~500ms sem novo toque, dispara `reordenarCategorias(idsAtuais)` com a **sequência completa**.
5. A action valida o array, deriva `loja.id` de `buscarLojaDoDono` e chama `rpc("reordenar_categorias", { p_loja_id, p_ids })`.
6. A RPC confere que `p_ids` é a permutação **completa** das categorias da loja, escreve `ordem = ordinalidade − 1` num único `UPDATE` e confere o `row_count`. Uma linha por categoria, uma instrução, uma transação.
7. `{ ok: true }` → a barra mostra `Ordem salva` por ~2s. **Sem toast por movimento.**
8. `[Concluir]` → `router.refresh()`, sanfonas voltam a abrir, ordem persistida.
9. A vitrine `/loja/[slug]` mostra a mesma ordem (herdada de `buscarCategorias`, sem query nova).

**Casos de borda**

| Cenário (nº da issue) | Comportamento exigido | Onde é garantido |
|---|---|---|
| 1/2 — deslocamento, não troca | `[A,B,C,D]` A→pos de C = `[B,C,A,D]` | `moverPorDeslocamento` (puro) |
| 3 — soltar no lugar | Zero escrita | `moverPorDeslocamento` devolve a **mesma referência**; o caller compara com `===` |
| 4 — empate pré-existente | Após qualquer reordenação, `ordem` = 0..n−1 sem empate | RPC: `ordinality − 1` sobre a lista **completa** |
| 5 — "Sem categoria" | Sem alça, sem setas (nem desabilitadas), fixo no fim, nunca no payload | `LinhaCategoriaReordenavel` não é usada; é um `<li>` estático fora do `SortableContext` |
| 6 — isolamento entre lojas | Id da loja B no array → **nada** escrito, em nenhuma das duas lojas | RPC: `where loja_id = p_loja_id` (+ RLS) → `row_count` menor → `raise exception` → **rollback da transação inteira** |
| 7 — falha de rede | Lista volta à ordem, toast genérico, anúncio na região viva | Reversão para a **última ordem confirmada pelo servidor**, não a do passo anterior (mockup §6) |
| 8 — limites da lista | `↑` na 1ª e `↓` na última são `aria-disabled="true"` + `onClick` no-op; foco permanece | Clamp da função pura + markup (`disabled` real perderia o foco para o `<body>`) |
| 9 — toques rápidos | 3 toques = 1 escrita, com a sequência final | Debounce ~500ms; payload sempre completo (ver nota de robustez abaixo) |
| 10 — categoria vazia | Não aparece na lista normal; **aparece** no modo com `0 produtos`; entra na normalização | O modo lê de `categorias`, nunca de `grupos` (`ProdutosClient.tsx:130` filtra vazias) |
| 11 — gate do botão | 0 ou 1 categoria → botão não renderiza; ≥2 → renderiza | `categorias.length >= 2` (nunca `grupos.length`) |
| Lista mudou entre abas | Criar/remover categoria noutra aba durante o modo → a permutação fica incompleta → erro genérico + `router.refresh()` | Fail-closed por design: a RPC recusa lista incompleta, porque normalizar um subconjunto **reintroduz o empate** que a issue existe para matar |
| `p_ids` com duplicata | Rejeitado | zod (`Set(ids).size === ids.length`) **e** `row_count` na RPC |
| Payload gigante | Rejeitado antes de tocar o banco | `.max(200)` (CWE-770, precedente `pedido.ts:82`) |
| Sessão expirada | `buscarLojaDoDono` → `null` → "Loja não encontrada." | Guard já existente do padrão |

> **Nota de robustez sobre o cenário 9:** a coalescência é otimização, **não
> invariante de correção**. Como toda chamada leva a sequência completa e a RPC
> é idempotente, N chamadas convergem para a mesma ordem final. O que **é**
> invariante é o guard de resposta obsoleta: um contador em `useRef` incrementa
> a cada disparo e a resposta cujo número não for o mais recente é ignorada —
> sem ele, uma resposta atrasada reverteria a lista para um estado velho.

**Tratamento de erros** (`seguranca.md` §14)

Uma única mensagem para o lojista: **`Não foi possível salvar a ordem.`** — a
mesma para id alheio, lista incompleta, duplicata e erro de banco. Isso é
deliberado: mensagens distintas transformariam a action num oráculo que
diferencia "esse id existe em outra loja" de "esse id não existe". O detalhe
(`code`, `message`, `details` do Postgres) vai só para `console.error("[reordenarCategorias]", …)`.
`erro.message` nunca cruza a fronteira.

---

### Schema de Banco

**Nenhuma tabela nova. Nenhuma coluna nova. Nenhum índice novo.**
`categorias.ordem int not null default 0` já existe
(`20260614000129_schema_inicial.sql:64`) e o índice `categorias_loja_ordem
(loja_id, ordem)` já existe (`20260614010000_indexes.sql:17`).

**Migration nova:** `supabase/migrations/20260908120000_rpc_reordenar_categorias.sql`

```sql
create or replace function public.reordenar_categorias(
  p_loja_id uuid,
  p_ids     uuid[]
) returns integer
language plpgsql
security invoker              -- NÃO definer: a RLS categorias_escrita_propria
set search_path = public      -- continua valendo para quem chama
as $$
declare
  v_enviadas int := coalesce(array_length(p_ids, 1), 0);
  v_na_loja  int;
  v_afetadas int;
begin
  if v_enviadas = 0 then
    raise exception 'reordenar_categorias: lista vazia';
  end if;

  -- A lista tem que ser a PERMUTAÇÃO COMPLETA das categorias da loja.
  -- Normalizar 0..n-1 sobre um SUBCONJUNTO reintroduziria o empate de `ordem`
  -- que esta feature existe para eliminar.
  select count(*) into v_na_loja
    from public.categorias where loja_id = p_loja_id;
  if v_na_loja <> v_enviadas then
    raise exception 'reordenar_categorias: % ids para % categorias', v_enviadas, v_na_loja;
  end if;

  update public.categorias c
     set ordem = e.pos - 1
    from unnest(p_ids) with ordinality as e(id, pos)
   where c.id = e.id
     and c.loja_id = p_loja_id;   -- escopo explícito ALÉM da RLS
  get diagnostics v_afetadas = row_count;

  -- Id de OUTRA loja, inexistente ou duplicado → menos linhas do que ids.
  -- A exceção derruba a transação inteira: escrita parcial é impossível.
  if v_afetadas <> v_enviadas then
    raise exception 'reordenar_categorias: % ids, % linhas afetadas', v_enviadas, v_afetadas;
  end if;

  return v_afetadas;
end;
$$;

revoke all on function public.reordenar_categorias(uuid, uuid[]) from public, anon;
grant execute on function public.reordenar_categorias(uuid, uuid[]) to authenticated, service_role;
```

O `revoke from public` não é decorativo: o Postgres concede `EXECUTE` a `PUBLIC`
por padrão em função nova, e o projeto **não** tem `alter default privileges …
on functions` (só para tables e sequences — `20260702150000` e `20260708140000`).
Sem o revoke, `anon` poderia executar.

**RLS:** nenhuma política nova. `categorias_escrita_propria`
(`20260614002000_rls_catalogo.sql:95`, `for all` com `using` **e** `with check`
em `lojas.dono_id = auth.uid()`) já cobre o UPDATE, e `security invoker` a mantém
ativa dentro da função. O `where loja_id = p_loja_id` é a **segunda** camada, no
espírito de `categoriaPertenceALoja`.

#### Por que RPC e não `upsert` nem N updates

| Opção | Veredito |
|---|---|
| **RPC (escolhida)** | 1 ida, 1 instrução, atômica. Escreve **só** `ordem`. Recusa lista incompleta/alheia com rollback automático. Custo: migration + `db push` autorizado |
| `.upsert(linhas, { onConflict: "id" })` | **Reprovada.** `nome` e `loja_id` são `not null` sem default, então o upsert teria que reescrever a **linha inteira** de cada categoria. Bug concreto, não teórico: `GerenciarCategorias` continua vivo (mockup §8) — o lojista renomeia uma categoria enquanto o salvamento debounced está em voo com o `nome` velho, e **a renomeação é silenciosamente revertida**. Além disso, upsert é `INSERT … ON CONFLICT`: um id que não existe **insere uma categoria fantasma** |
| N `update` sequenciais/paralelos | **Reprovada.** N idas ao banco e, pior, **não atômico**: uma falha no meio deixa a lista com `ordem` duplicada — exatamente o bug que a issue quer matar. O projeto já carrega esse débito (`architecture.md` §10, "DELETE+INSERT não transacional") e não deve criar outro |

> **Se o `db push` não for autorizado:** o fallback é `.upsert` com um SELECT
> prévio de `nome` — 2 idas, janela de perda de renomeação acima, e a defesa
> contra id fantasma passa a depender de código JS com TOCTOU. É pior por
> mérito, não por preguiça. Melhor adiar a issue do que descer para ele.

---

### Validação (zod)

Schema único em `src/lib/validacoes/produto.ts` (mesmo arquivo de
`schemaCategoria` — coesão de domínio), consumido **só** pela Server Action. O
cliente não precisa dele: ele nunca digita nada, só arrasta/clica, e o array de
ids que ele monta vem do próprio `props.categorias`.

```ts
/**
 * Reordenação de categorias (issue 175). O cliente manda APENAS a sequência de
 * ids — nunca valores de `ordem`, que são derivados do índice no servidor, e
 * nunca `nome`/`loja_id`. Por isso NÃO reusa `schemaCategoria`, que exige
 * justamente `nome` e `ordem`.
 *
 * `.min(2)`: lista de 1 não tem ordem (o botão nem renderiza — mockup §5).
 * `.max(200)`: teto de cardinalidade (CWE-770, mesmo motivo do `.max(50)` de
 * `pedido.ts`) — sem ele um array de 100k ids vira amplificação de payload.
 * O refine de unicidade é defesa em profundidade: a RPC também rejeita
 * duplicata pelo `row_count`, mas duplicata nem deve chegar ao banco.
 */
export const schemaReordenacaoCategorias = z
  .array(z.guid())
  .min(2)
  .max(200)
  .refine((ids) => new Set(ids).size === ids.length, {
    message: "Ids repetidos na reordenação",
  });
```

`z.guid()` (não `z.uuid()`) segue a convenção já documentada em
`produto.ts:23-24` e `checkout.ts:10`: valida o formato uuid sem exigir os
nibbles de versão/variante, espelhando o tipo `uuid` do Postgres.

---

### Assinatura e implementação da Server Action

Em `src/lib/actions/produto.ts`, ao lado das demais actions de categoria.

```ts
/**
 * Reordena TODAS as categorias da loja do dono, gravando `ordem` normalizada
 * 0..n-1 numa única instrução atômica (issue 175).
 *
 * Isto é AUTORIZAÇÃO, não CRUD: o payload é uma lista de ids escolhida pelo
 * cliente e a escrita é em lote. Segue o princípio de `categoriaPertenceALoja`
 * (escopo explícito por `loja_id` ALÉM da RLS) e NÃO o de `atualizarCategoria`,
 * que busca a loja do dono mas não filtra por ela.
 *
 * Onde a posse é provada: a RPC exige que `p_ids` seja a PERMUTAÇÃO COMPLETA de
 * `categorias where loja_id = p_loja_id` e confere o `row_count` do UPDATE.
 * Um id de outra loja derruba a transação inteira — nada é escrito em nenhuma
 * das duas lojas. Isso substitui um SELECT de posse prévio em JS de propósito:
 * o pre-check em JS seria TOCTOU (a lista pode mudar entre o SELECT e o UPDATE),
 * a checagem dentro da transação não é.
 *
 * `p_loja_id` vem SEMPRE de `buscarLojaDoDono` (auth.uid()), NUNCA do payload.
 */
export async function reordenarCategorias(
  payload: unknown,
): Promise<ResultadoGestaoCategoria> {
  // 1) Forma ANTES de qualquer I/O: array de uuid, sem duplicata, 2..200.
  const parsed = schemaReordenacaoCategorias.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, erro: "Não foi possível salvar a ordem." };
  }

  try {
    // 2) Client AUTENTICADO — a RLS categorias_escrita_propria isola por dono.
    //    `security invoker` na RPC mantém essa RLS valendo lá dentro.
    const supabase = await createClient();
    // 3) loja_id DERIVADO do auth.uid(), NUNCA do payload.
    const loja = await buscarLojaDoDono(supabase);
    if (loja == null) {
      return { ok: false, erro: "Loja não encontrada." };
    }

    // 4) UMA ida ao banco, UMA instrução, atômica.
    const { error } = await supabase.rpc("reordenar_categorias", {
      p_loja_id: loja.id,
      p_ids: parsed.data,
    });
    if (error) {
      // Mensagem única para id alheio / lista incompleta / erro de banco:
      // mensagens distintas virariam oráculo de existência de id (§14).
      console.error("[reordenarCategorias]", error);
      return { ok: false, erro: "Não foi possível salvar a ordem." };
    }

    // NÃO usa CAMINHO_PAINEL ("/painel/cardapio" não existe como rota — achado
    // pré-existente registrado na Análise do Codebase).
    revalidatePath("/painel/produtos");
    revalidatePath("/loja/[slug]", "page"); // critério "a vitrine mostra a mesma ordem"
    return { ok: true };
  } catch (e) {
    console.error("[reordenarCategorias]", e);
    return { ok: false, erro: "Não foi possível salvar a ordem." };
  }
}
```

**Sobre a assinatura:** a issue escreve `reordenarCategorias(ids: string[])`. O
parâmetro é `payload: unknown`, como em **todas** as outras actions do arquivo.
Motivo: `ids: string[]` é apagado em runtime — a fronteira RSC entrega o que o
cliente mandar, e um parâmetro tipado dá falsa sensação de garantia. O schema é
o único portão real. Da perspectiva de quem chama, o contrato continua sendo
"passe o array de ids".

**Não usa `service_role`.** A escrita do lojista passa pela RLS autenticada,
como o resto de `produto.ts`.

---

### Recálculo no Servidor (regra cliente ↔ servidor)

Não há valor monetário nesta issue, mas há **valor autoritativo**: `ordem`.

| O cliente envia | O servidor deriva do zero |
|---|---|
| A **sequência de ids**, e só ela | `ordem` de cada linha = `ordinality − 1` dentro da RPC |
| — | `loja_id` (de `buscarLojaDoDono`, nunca do payload) |
| — | O conjunto legítimo de ids (a RPC compara com `count(*) where loja_id = p_loja_id`) |

O cliente **nunca** manda `ordem`. O tipo `Categoria` consumido pelo
`ProdutosClient` (`FormProduto.tsx:22-27`) não expõe `ordem` e **não passa a
expor** — o contrato do mockup §0 depende disso.

| Invariante | Camada que garante |
|---|---|
| Leitura das categorias da loja | RLS `categorias_leitura_publica` / `categorias_escrita_propria` (`20260614002000:91,95`) |
| Escrita de `ordem` | RLS `categorias_escrita_propria` (`using` + `with check` em `dono_id = auth.uid()`) **+** `where loja_id = p_loja_id` na RPC **+** `p_loja_id` derivado no servidor |
| Nenhum id de outra loja é escrito (cenário 6) | `row_count <> v_enviadas` → `raise exception` → rollback atômico |
| `ordem` sem empate (cenário 4) | Exigência de permutação completa + `ordinality − 1` na mesma instrução |
| Gate do botão (`≥ 2` categorias) | **UX apenas.** Não é permissão — a RPC recusa lista com <2 ids de qualquer forma |
| Alvo de toque 44px, `aria-disabled`, região viva | Cliente apenas (a11y, não segurança) |
| Ordem exibida na vitrine | Servidor: `buscarCategorias` com `.order("ordem")` sob RLS anon |

Nenhuma regra de valor ou de permissão desta issue mora só no cliente.

---

### A função pura de reordenação

**Arquivo:** `src/lib/utils/reordenar.ts` — puro, sem React, sem DOM, sem
dependência externa. Testável em `environment: node` sem importar nada.

```ts
/**
 * Move o item de `de` para `para` DESLOCANDO os intermediários — não é troca de
 * pares. [A,B,C,D] com (0,2) → [B,C,A,D], nunca [C,B,A,D].
 *
 * Devolve a MESMA REFERÊNCIA quando o movimento é no-op (índices iguais, fora do
 * intervalo ou não inteiros). O caller decide "não escrever no banco" com
 * `proxima === atual` (cenário 3) e "seta inerte no limite" com o mesmo teste
 * (cenário 8) — uma regra só, sem `if` espalhado pela UI.
 *
 * Genérica de propósito: o mesmo contrato serve para reordenar produtos dentro
 * da categoria depois (mockup §8), sem reescrever nada.
 *
 * NÃO delega para `arrayMove` do @dnd-kit/sortable: lá, `para` negativo dá a
 * volta e joga o item no FIM (`splice(to < 0 ? length + to : to, …)`), então
 * `↑` na primeira posição moveria a categoria do topo para o último lugar.
 */
export function moverPorDeslocamento<T>(
  itens: readonly T[],
  de: number,
  para: number,
): readonly T[] {
  if (!Number.isInteger(de) || !Number.isInteger(para)) return itens;
  if (de < 0 || de >= itens.length) return itens;
  if (para < 0 || para >= itens.length) return itens;
  if (de === para) return itens;
  const proximo = itens.slice();
  const [movido] = proximo.splice(de, 1);
  proximo.splice(para, 0, movido);
  return proximo;
}

/** `Pizzas movida para a posição 2 de 6.` — mockup §3.2 (nome + posição sobre o total). */
export function mensagemPosicao(nome: string, indice: number, total: number): string {
  return `${nome} movida para a posição ${indice + 1} de ${total}.`;
}
```

**Como as quatro operações convergem** — todas viram um par (origem, destino):

| Operação | Chamada | No limite |
|---|---|---|
| `↑` na posição `i` | `moverPorDeslocamento(ids, i, i - 1)` | `i = 0` → `para = -1` → **mesma referência**, no-op |
| `↓` na posição `i` | `moverPorDeslocamento(ids, i, i + 1)` | `i = n-1` → `para = n` → **mesma referência**, no-op |
| Mover para o topo | `moverPorDeslocamento(ids, i, 0)` | já no topo → `de === para` → no-op |
| Mover para o fim | `moverPorDeslocamento(ids, i, ids.length - 1)` | já no fim → no-op |
| Soltar arrasto (`onDragEnd`) | `moverPorDeslocamento(ids, ids.indexOf(active.id), ids.indexOf(over.id))` | soltar sobre si → `de === para` → no-op |

É isso que torna o arrasto uma camada de **apresentação**: o dnd-kit não
introduz nenhuma regra de negócio nova, nenhum caminho de escrita novo e nenhum
teste novo de lógica. Só traduz um gesto no mesmo par de índices que a seta
produz.

---

### Arquivos a Criar / Modificar / NÃO tocar

#### Criar

| Arquivo | Conteúdo |
|---|---|
| `supabase/migrations/20260908120000_rpc_reordenar_categorias.sql` | A função acima + revoke/grant |
| `src/lib/utils/reordenar.ts` | `moverPorDeslocamento` + `mensagemPosicao` |
| `src/lib/utils/reordenar.test.ts` | Cenários 1, 2, 3, 8 + bordas de índice |
| `tests/migrations/rpc_reordenar_categorias.test.ts` | **RED.** Cenários 4 e 6 sob RLS real (pglite) |
| `src/components/ui/accordion.tsx` | **Gerado por `npx shadcn@latest add accordion`.** Não editar à mão |
| `src/components/painel/ReordenarCategorias.tsx` | `'use client'`. O modo inteiro: `<ol>`, região viva, estado otimista, debounce, revert, `DndContext`/`SortableContext`, `DragOverlay` em portal, `announcements` pt-BR |
| `src/components/painel/LinhaCategoriaReordenavel.tsx` | `'use client'`. Um `<li>`: alça (`useSortable` precisa morar no item), posição visível, nome, contagem, `↑`/`↓`, kebab topo/fim |
| `src/components/painel/ReordenarCategorias.test.tsx` | `renderToStaticMarkup`: cenários 5, 8, 10 + região viva fora do `<ol>` + 44px literal |

#### Modificar

| Arquivo | Mudança | Motivo |
|---|---|---|
| `src/lib/validacoes/produto.ts` | `+ schemaReordenacaoCategorias` | Schema de lista; `schemaCategoria` exige `nome`/`ordem`, que esta operação não aceita |
| `src/lib/actions/produto.ts` | `+ reordenarCategorias` | A action |
| `src/lib/actions/produto.test.ts` | `+ describe("reordenarCategorias")` e um ramo `rpc` no harness de mock | Contrato da action |
| `src/lib/database.types.ts` | **Regenerado** (`npx supabase gen types typescript`) | Sem isso `supabase.rpc("reordenar_categorias", …)` não compila |
| `src/lib/supabase/queries/categorias.ts` | `+ .order("id", { ascending: true })` após o `.order("ordem")` | Desempate determinístico. Sem ele, loja que nunca reordenou tem ordem variável entre requisições — o problema que a issue descreve em "Efeito colateral já existente". 1 linha, sem risco |
| `src/app/(painel)/.../produtos/ProdutosClient.tsx` | Estado `modoReordenar`; botão `[⇅ Reordenar categorias]` com gate `categorias.length >= 2`; troca da barra de ações por `[Concluir]`; `contagemPorCategoria` via `useMemo`; sanfona na lista normal | Ponto de entrada. **É o arquivo em conflito com `chore/higiene-pos-159`** |
| `src/app/(painel)/.../produtos/ProdutosClient.test.tsx` | `+` cenário 11 (gate do botão) | Único cenário que depende do componente-pai |

#### NÃO tocar

| Arquivo | Por quê |
|---|---|
| `src/components/ui/*` | Gerado pelo shadcn CLI (`components.json`). `accordion.tsx` entra pelo CLI, não à mão |
| `src/components/painel/GerenciarCategorias.tsx` | Mockup §8, fora de escopo. Continua criando/renomeando/removendo. (A nota "aponte para /painel/produtos" é issue própria) |
| `src/lib/actions/produto.ts` → `atualizarCategoria` / `removerCategoria` | Defeitos de escopo pré-existentes, já registrados como issue própria |
| `CAMINHO_PAINEL` e os 17 `revalidatePath` de `produto.ts`/`opcional.ts` | Achado pré-existente ("/painel/cardapio" não existe). Corrigir muda o cache de 17 actions → issue própria |
| `src/app/.../opcionais/OpcionaisClient.tsx` | Terceira variante de ordem (campo numérico digitado). Consolidar depois, mockup §8 |
| `src/app/admin/assinantes/**` | A via admin não ganha reordenação nesta issue |
| `supabase/migrations/*` existentes | Migration é append-only |

#### Ponto que precisa de confirmação antes do GREEN

O mockup §4.2 desenha um `⌄` (gatilho da sanfona) nas linhas do **modo
reordenar**, e §5 diz "expandir durante o modo é permitido". Levar a sanfona
para dentro de `ReordenarCategorias` obriga a passar todos os produtos para lá e
a reconciliar `grupos` (que esconde categorias vazias, `ProdutosClient.tsx:130`)
com `categorias` (que não) — exatamente o descasamento que o §0 do mockup
identificou como bloqueante.

**Recomendação:** a sanfona vive na lista **normal**; o modo reordenar renderiza
só linhas colapsadas (posição, nome, contagem, controles), como o próprio §4.2
desenha no corpo das linhas, e "expandir" se resolve saindo do modo com
`[Concluir]`. Isso mantém a decisão fechada (a sanfona entra, via
`npx shadcn@latest add accordion`) e só evita aninhá-la dentro do modo.
**Confirmar com o usuário antes do passo 9.**

---

### Dependências Externas

| Pacote | Versão | Doc |
|---|---|---|
| `@dnd-kit/core` | `6.3.1` (publicado 2024-12-05) | https://docs.dndkit.com |
| `@dnd-kit/sortable` | `10.0.0` — peer `@dnd-kit/core: ^6.3.0`, `react: >=16.8.0` | https://docs.dndkit.com/presets/sortable |
| `@dnd-kit/utilities` | `3.2.2` — dependência direta se `CSS.Transform` for importado | idem |

```bash
npm install @dnd-kit/core@^6.3.1 @dnd-kit/sortable@^10.0.0 @dnd-kit/utilities@^3.2.2
```

**npm, nunca pnpm** (lockfile é `package-lock.json`).

**Advisories:** OSV.dev consultado hoje (2026-09-08) para `@dnd-kit/core` e
`@dnd-kit/sortable` — **zero vulnerabilidades conhecidas**. Rodar
`npm audit --omit=dev` após o install para confirmar contra a árvore real.

**Peer React:** `react: >=16.8.0` — satisfeito por `react@19.2.4`.

**Por que a linha v6 e não `@dnd-kit/react`:** o sucessor está em `0.5.0`
(pré-1.0, publicado 2026-09-05). Não se adota API instável para o único caminho
de interação que o CI do projeto **não consegue testar**.

**Custo e quota (`architecture.md` §9 nº1):** biblioteca de cliente, 100%
client-side. **Zero chamada de rede, zero quota, zero custo variável** — não
toca Upstash, Nominatim, Sentry, nem o Postgres. Não há "estourar a quota" a
mapear. O custo é **bundle**: ~13–15 KB gz para core+sortable, e ele cai
**exclusivamente na rota `/painel/produtos`**, autenticada, atrás do guard do
layout do painel. A vitrine pública mobile-first (`/loja/[slug]`) — a rota com
orçamento de performance — **não carrega uma linha disso**. Registrar esse limite
no PR para o `acelerar`.

**Migration:** custo zero. Supabase Pro é $25 fixo; uma função a mais não move
nada. Nenhum índice novo (o `categorias_loja_ordem` existente já serve o
`where loja_id`), nenhuma tabela, nenhum storage.

**Sanfona:** `npx shadcn@latest add accordion`. **Zero dependência de runtime
nova** — `@base-ui/react@^1.5.0` já está no `package.json` e traz o primitivo; o
CLI só escreve `src/components/ui/accordion.tsx` no estilo `base-nova` já
configurado em `components.json`.

---

### O que é testável, e como

O projeto roda vitest com `environment: "node"`, **sem jsdom e sem
@testing-library** (`vitest.config.ts`). Testes de client component usam
`renderToStaticMarkup` e provam **derivação de estado → HTML**, não clique — ver
o cabeçalho de `ProdutosClient.test.tsx:1-22`.

| Camada | Como | Cobre |
|---|---|---|
| `moverPorDeslocamento` | Unitário puro, zero mock, zero import | Cenários 1, 2, 3, 8 |
| RPC + RLS | **pglite** (`createTestDb`/`asUser`/`asAnon`), SQL e políticas reais | **Cenários 4 e 6** — a garantia de verdade |
| Action | Mock de `produto.test.ts` estendido com `rpc` | Validação antes de I/O, `p_loja_id` derivado, sem `service_role`, erro genérico |
| Markup do modo | `renderToStaticMarkup(<ReordenarCategorias …/>)` | Cenários 5, 8 (markup), 10; região viva fora do `<ol>`; 44px literal |
| Gate do botão | `renderToStaticMarkup(<ProdutosClient …/>)` | Cenário 11 |
| Vitrine herda a ordem | `queries/categorias.test.ts` + verificação manual como anon | Critério de aceite |

**Extensão necessária no harness de `produto.test.ts`.** O `makeChain()` atual
(`produto.test.ts:58-97`) só simula `.from(tabela)`. Precisa de um irmão:

```ts
// no client raiz, junto de `from`:
rpc: (nome: string, args: Record<string, unknown>) => {
  chamadasRpc.push({ nome, args });
  return Promise.resolve(respostaRpc);
},
```

Isso não altera nenhum teste existente (nenhum toca `rpc` hoje) e é o que
permite afirmar `p_loja_id === LOJA_DONO` e "nenhuma rpc quando o payload é
inválido".

**Vantagem de projeto que o `ReordenarCategorias` extraído compra:** ele está
**sempre** em modo reordenar, então `renderToStaticMarkup` o renderiza direto,
sem precisar simular o clique que liga o modo — o que seria impossível sem
jsdom. Se o modo morasse dentro de `ProdutosClient` atrás de um `useState`,
metade dos cenários testáveis viraria não-testável.

**Não testável, e o PR deve dizer isso em vez de "validado em mobile":**

- O **gesto de arrasto** — pointer events reais, `DragOverlay`, colisão, o
  `touch-action: none` da alça. Verificação manual obrigatória em **iOS Safari
  e Chrome Android**, em dispositivo real.
- A **temporização** do debounce. Mitigada por projeto, não por teste: toda
  chamada carrega a sequência completa, então mesmo N chamadas convergem para a
  ordem certa (ver "Nota de robustez").
- O **movimento de foco** após reordenar (`ref` por id + refoco no efeito) —
  exige DOM real. Verificar por teclado no desktop e com VoiceOver/TalkBack.

---

### O teste vermelho (fase RED — `tdd`)

A issue é **crítica com escopo restrito à Server Action**. O RED cobre a action
e a RPC. A UI de sanfona/arrasto **não** entra no RED.

São **dois arquivos**, e o primeiro é o que importa:

#### 1. `tests/migrations/rpc_reordenar_categorias.test.ts` — pglite, RLS real

É aqui que os cenários 6 e 4 são de fato provados. Um mock **não consegue** provar
"nada da loja B foi escrito": ele não tem linhas.

Casos:

| # | Caso | Asserção |
|---|---|---|
| R1 | **Cenário 6 — isolamento.** Loja A com `[a1,a2,a3]`, loja B com `[b1,b2]`. Dono A chama `reordenar_categorias(lojaA, [a1, b1, a3])` | A chamada **lança**; e — em bloco separado — `ordem` de `a1,a2,a3` **e** de `b1,b2` está exatamente como antes |
| R2 | **Cenário 6b — loja alheia no parâmetro.** Dono A chama `reordenar_categorias(lojaB, [b1,b2])` | Lança (0 linhas afetadas sob a RLS de escrita); nenhuma linha de B muda |
| R3 | **Cenário 4 — empate.** Loja A com `ordem = (2, 2, 0)`. Dono A envia a permutação completa `[a2,a3,a1]` | `ordem` vira `0,1,2`, **sem empate**, e o mapeamento id→ordem casa com a sequência enviada |
| R4 | **Lista incompleta.** Dono A com 3 categorias envia `[a1,a2]` | Lança; **nenhuma** das 3 muda (é o que impede a normalização parcial de recriar o empate) |
| R5 | **Duplicata.** `[a1,a1,a3]` | Lança; nada muda |
| R6 | **Caminho feliz.** `[a3,a1,a2]` | Retorna `3`; `ordem` = 0,1,2 na sequência enviada |
| R7 | **anon não executa.** `asAnon` chama a função | Lança permissão negada (o `revoke ... from public, anon` está fazendo efeito) |

> **Armadilha do harness que o `tdd` precisa saber:** `withRole` em
> `tests/helpers/pglite.ts:127-146` abre `begin` e faz **`rollback` quando o
> callback lança**. Então a asserção de "nada mudou" (R1, R2, R4, R5) **tem que
> ficar num bloco `asUser`/`asService` separado, depois** do bloco que lança —
> se ficar no mesmo bloco, o teste passa por causa do rollback do harness, não
> por causa da função. Isso é um falso-verde esperando para acontecer.

**Falha esperada hoje:** `function public.reordenar_categorias(uuid, uuid[])
does not exist` (SQLSTATE 42883) em todos os casos.

#### 2. `src/lib/actions/produto.test.ts` — `describe("reordenarCategorias")` (append)

| # | Caso | Asserção |
|---|---|---|
| A1 | Caminho feliz | `{ ok: true }`; **uma** chamada `rpc("reordenar_categorias", …)` |
| A2 | `p_loja_id` é derivado | `args.p_loja_id === LOJA_DONO`; `buscarLojaDoDono` chamada com o client autenticado |
| A3 | **ATAQUE:** payload traz `loja_id` de outra loja | `p_loja_id` continua `LOJA_DONO`; a chave hostil não chega em lugar nenhum |
| A4 | Payload não é array (`{}`, `"abc"`, `null`) | `{ ok: false }` e **zero** chamadas de rpc |
| A5 | Id fora do formato uuid | `{ ok: false }`, zero rpc |
| A6 | Ids duplicados | `{ ok: false }`, zero rpc |
| A7 | Array com 1 id | `{ ok: false }`, zero rpc |
| A8 | Array acima do teto (201 ids) | `{ ok: false }`, zero rpc |
| A9 | Não usa `service_role` | `createServiceClient` não chamada |
| A10 | Erro de banco não vaza | rpc devolve `error.message = "senha postgres XYZ"` → `JSON.stringify(r)` não contém `"senha"` |
| A11 | `buscarLojaDoDono` → `null` | `{ ok: false, erro: "Loja não encontrada." }`, zero rpc |

**Falha esperada hoje:** `reordenarCategorias` não é exportada de `./produto` →
erro de import/tipo em todos os casos.

O `tdd` deve rodar `npx vitest run tests/migrations/rpc_reordenar_categorias.test.ts src/lib/actions/produto.test.ts`
e **colar o output `FAIL`** antes de qualquer linha de produção.

---

### Ordem de Implementação

Justificada por dependência. A regra que a ordena: **tudo que o CI consegue
provar entra e fica verde antes do código que o CI não consegue provar.**

| # | Passo | Depende de / por quê |
|---|---|---|
| 0 | Branch de `main` **depois** do merge de `chore/higiene-pos-159` | Aquele PR mexe no mesmo `ProdutosClient.tsx`. Ramificar antes garante conflito |
| 1 | `npm install @dnd-kit/core@^6.3.1 @dnd-kit/sortable@^10.0.0 @dnd-kit/utilities@^3.2.2` + `npm audit --omit=dev` | Instalar cedo para o audit falhar cedo, se for falhar |
| 2 | `npx shadcn@latest add accordion` | Gera `ui/accordion.tsx`. Isolado num commit próprio (arquivo de CLI, não revisar como código escrito) |
| 3 | **RED** — os dois arquivos de teste acima. Capturar o `FAIL` | Issue crítica: mandato 3. Nada de produção antes disso |
| 4 | Migration `20260908120000_rpc_reordenar_categorias.sql` | O teste pglite lê `supabase/migrations/` do disco → **R1..R7 ficam verdes sem tocar a nuvem** |
| 5 | `schemaReordenacaoCategorias` em `validacoes/produto.ts` | Pré-requisito da action |
| 6 | **`npx supabase db push` (PEDIR AUTORIZAÇÃO)** → `npx supabase gen types typescript > src/lib/database.types.ts` | **Trava dura.** Sem o push, `gen types` não vê a função e `supabase.rpc("reordenar_categorias", …)` não compila; e, mesmo com o build verde, o runtime cai em `PGRST202` (function not found) contra o cloud. Conferir com `npx supabase migration list` (coluna Remote preenchida) |
| 7 | `reordenarCategorias` em `actions/produto.ts` | A1..A11 ficam verdes |
| 8 | `src/lib/utils/reordenar.ts` + `reordenar.test.ts` | Puro, independente — poderia vir antes, mas fecha o backend primeiro |
| 9 | `ReordenarCategorias.tsx` + `LinhaCategoriaReordenavel.tsx` **só com ↑/↓ e topo/fim**, sem dnd-kit + `ReordenarCategorias.test.tsx` | Confirmar antes o ponto da sanfona (acima). Cenários 5, 8, 10 verdes |
| 10 | Ligar em `ProdutosClient.tsx`: modo, gate `>= 2`, troca da barra, `contagemPorCategoria` | Cenário 11 verde. **Feature completa e 100% coberta pelo CI a partir daqui** |
| 11 | Sanfona na lista normal (`Accordion` `type="multiple"`, tudo aberto por padrão) | Maior superfície de conflito com o 159 → o mais tarde possível, para o rebase ser barato |
| 12 | Camada de arrasto: `DndContext`, `SortableContext`, `PointerSensor { distance: 8 }`, alça `GripVertical` 44×44 com `touch-action: none` **só nela**, `DragOverlay` em portal, `announcements` + `screenReaderInstructions` em **pt-BR** | Zero mudança na função pura, na action e na migration. Última porque é a única parte que o CI não protege |
| 13 | Guard `prefers-reduced-motion: reduce` (transições → 0ms; realce sem animação) | Obrigação nova do mockup §3.4 — o projeto ainda não tem esse guard |
| 14 | Gate: `npx tsc --noEmit` → `npm run lint` → `npm test` → `npm run build` | `npm run build` é obrigatório: `const` exportada em módulo `'use server'` só quebra ali |
| 15 | Verificação manual do arrasto em iOS Safari + Chrome Android; conferir a ordem na vitrine como anon; **registrar a limitação no corpo do PR** | Critério de aceite explícito |
