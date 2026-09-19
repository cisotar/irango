## Plano técnico

> Produzido pelo agente `planejar` em 2026-09-18, sobre o `## Desenho` acima.
> As decisões de UX do desenho são FECHADAS: este plano só diz **como** implementá-las.
> Toda afirmação abaixo foi conferida por `grep`/`cat` no código real, com `arquivo:linha`.

### Análise do codebase — o que já existe e será REUSADO

**Componentes (nenhum reescrito):**

- `src/components/painel/ModoReordenar.tsx` (440 linhas) — otimismo, coalescência
  (`criarSalvamentoCoalescido`), região viva ÚNICA (`:409-411`), handle imperativo
  `finalizar()`/`anunciar()` (`:216-223`), `mover()` como caminho único de escrita
  (`:242-272`). Ganha **2 props opt-in** (§ Mudanças em `ModoReordenar`).
- `src/components/painel/LinhaCategoriaReordenavel.tsx` (259 linhas) — alça,
  numeração visível, setas com `aria-disabled` (`:179`, `:189`), kebab com
  topo/fim, `compacta` (`:177`, `:187`, `:216`). Ganha **2 props opt-in**.
- `src/components/painel/ReordenarOpcionaisDaCategoria.tsx` (115 linhas) — é o
  ESPELHO literal da casca nova. Ganha só um pass-through.
- `src/components/painel/CartaoAssociacaoOpcionais.tsx` (379 linhas) — `chaveDaLista`
  (`:232`), remontagem por `key` (`:277`), status agregado (`:218-223`), o padrão
  "flush antes de mutar" (`:133`).
- `src/lib/utils/reordenar.ts` — `moverPorDeslocamento` (no-op por identidade) e
  `mensagemPosicao`. Zero mudança.
- `src/lib/utils/salvamento-coalescido.ts` — debounce/fila/reversão. Zero mudança.
- `src/lib/utils/formatarMoeda.ts` — `+R$ 4,00` da linha em leitura. Zero mudança.
- `src/components/ui/{badge,button,input,menu,card,accordion}` — shadcn, **não se
  edita à mão**. `Badge variant="outline"` é o mesmo de `OpcionaisClient.tsx:608`.

**Server Actions — TODAS já existem, nenhuma nova:**

| Ação | Arquivo:linha (lojista) | Variante admin |
|---|---|---|
| `criarOpcional(payload)` | `src/lib/actions/opcional.ts:162` | `criarOpcionalAdmin` |
| `atualizarOpcional(id, payload)` | `src/lib/actions/opcional.ts:199` | `atualizarOpcionalAdmin` |
| `alternarOpcionalAtivo(id, ativo)` | `src/lib/actions/opcional.ts:238` | `alternarOpcionalAtivoAdmin` |
| `removerOpcional(id)` | `src/lib/actions/opcional.ts:261` | `removerOpcionalAdmin` |
| `reordenarItensDoGrupoOpcional(payload)` | `src/lib/actions/opcional.ts:473` | `reordenarItensDoGrupoOpcionalAdmin` (`src/app/admin/assinantes/actions/admin-opcionais.ts:513`) |

**Validação — schema já existe, nenhum novo:** `schemaOpcional`
(`src/lib/validacoes/opcional.ts:24-33`) e `schemaReordenacaoItensDoGrupo` (`:84-92`).

**RPC e RLS — já aplicadas no cloud (215):**
`supabase/migrations/20260918120000_rpc_reordenar_itens_do_grupo_opcional.sql`.
Travas relevantes para a UI: **T4 exige a permutação COMPLETA do par (loja, grupo),
INCLUINDO `ativo = false`** (`:16-19`, `:81-88`) — é por isso que a sanfona lista
inativos; **T5 deriva `ordem` de `ordinality - 1` e escreve SÓ `ordem`** (`:92-98`).

**O que precisa ser CRIADO, e por quê não dá para reusar:**

| Novo | Por que não reusar |
|---|---|
| `LinhaItemOpcional.tsx` | A linha do item tem 3 estados que trocam o `<li>` INTEIRO (mockup `:127`, `:147`, `:163`): em `confirmando` somem nº, setas e kebab. Isso não é "slot" dentro de `LinhaCategoriaReordenavel` — seria gutá-la. O desenho §8 já autoriza a irmã. Além disso ela **não chama `useSortable`** (não há arrasto), o que elimina o `DndContext` aninhado. |
| `PainelItensDoGrupo.tsx` | Dono da máquina "no máximo UMA linha fora de `leitura`" (desenho §2), da frase de alcance, do botão adicionar e da fiação das 5 actions. Nada disso existe. |
| `ReordenarItensDoGrupo.tsx` | Casca do payload `{ categoria_opcional_id, opcional_id }` — forma DIFERENTE da `ReordenarOpcionaisDaCategoria` (`{ categoria_id, categoria_opcional_id }`). É a mesma razão pela qual aquela existe (ver o cabeçalho dela, `:36-42`). |
| `src/lib/utils/alcance-do-grupo.ts` | `rotuloAlcance(nomes)` — nomear até 2, contar a partir de 3 (desenho §6). Função pura, testável sem jsdom. Não existe nada equivalente em `src/lib/utils/` (varrido: 46 módulos, nenhum de alcance/pluralização de nomes). |

**Libs maduras:** nada de máscara/moeda artesanal. Preço em reais com vírgula usa o
mesmo `Number(v.replace(",", "."))` do `FormOpcional`
(`src/app/(painel)/painel/(bloqueavel)/produtos/opcionais/OpcionaisClient.tsx:863`)
e `formatarMoeda` na exibição. Nenhuma dependência nova.

---

### De onde vêm `opcionaisPorGrupo` e `alcancePorGrupo` — **nenhuma query nova**

Achado que muda o escopo da issue para menos: os dois mapas são **derivados de props
que `OpcionaisClient` já recebe**.

- `opcionais: Opcional[]` — já é prop (`OpcionaisClient.tsx:122`), já traz
  `id, nome, preco, ativo, ordem, categoria_opcional_id` (`Tables<"opcionais">`), já
  inclui **inativos** (RLS `opcionais_leitura_propria`, comentário em
  `src/lib/supabase/queries/opcionais.ts:41-43`).
- `associacoes: Associacao[]` e `categoriasProduto: CategoriaProduto[]` — já são props
  (`:123-124`).

Logo, em `AssociacaoOpcionais`
(`OpcionaisClient.tsx:960-1011`), ao lado do `totalItensPorGrupo` que já mora ali
(`:1002-1011`), entram dois `useMemo`:

```
opcionaisPorGrupo: Map<string, Opcional[]>   // agrupa `opcionais` por categoria_opcional_id
alcancePorGrupo:   Map<string, string[]>     // categoria_opcional_id → nomes das categorias de PRODUTO
                                             // (de `associacoes` ⋈ `categoriasProduto`)
```

**Consequências, e são todas negativas (nada a fazer):**

- `src/app/(painel)/painel/(bloqueavel)/produtos/opcionais/page.tsx:41-47` —
  o `Promise.all` **não muda**: as 4 queries já trazem tudo.
- `src/app/admin/assinantes/[lojaId]/carga-opcionais.ts:78` — **não muda** pelo mesmo
  motivo (já chama `buscarOpcionaisDoLojista`).
- Nenhum round-trip novo, nenhum N+1, nada para o `acelerar` medir.
- `totalItensPorGrupo` (`:1002`) passa a poder derivar de `opcionaisPorGrupo`
  (`.length`) — opcional, e só se não custar nada.

A página que renderiza o cartão hoje continua sendo **`/painel/produtos/opcionais`,
aba "por categoria"**; a troca para `/painel/produtos` é da 217 e **não entra aqui**.

---

### Pré-requisito de ordenação — desempate estável (não é enfeite)

`opcionais.ordem` é `int not null default 0`
(`supabase/migrations/20260614007500_opcionais.sql:49`): **toda linha existente hoje
vale 0**. Sem segundo critério, o Postgres pode devolver ordens diferentes entre
requisições → SSR e cliente divergem → o primeiro reordenar grava uma permutação que
o lojista não pediu. `buscarAssociacoesOpcional`
(`src/lib/supabase/queries/opcionais.ts:69-81`) já documenta e resolve isso para os
grupos; **copiar o padrão**, em dois pontos:

1. `src/lib/supabase/queries/opcionais.ts:52` — `buscarOpcionaisDoLojista` ganha
   `.order("id", { ascending: true })` depois do `.order("ordem")`, com o mesmo
   comentário de porquê (não "ordena por id", e sim "desempate estável para linhas
   pré-215 todas com `ordem = 0`").
2. `src/lib/supabase/queries/produtos.ts:260` — o `sort` de itens em
   `agruparOpcionaisPorCategoria` vira
   `(a, b) => a.ordem - b.ordem || a.id.localeCompare(b.id)`. Uma correção só cobre
   **as duas** entradas (`buscarOpcionaisPorCategoria` e
   `buscarOpcionaisPorCategoriaDaLoja`), porque ambas passam por essa função.

**Critério escolhido: `id`, não `nome`.** É o que `buscarAssociacoesOpcional` usa
(`categoria_opcional_id`, `:78`) e o que `CartaoAssociacaoOpcionais.tsx:195` já usa no
cliente — painel e vitrine passam a concordar byte a byte para as linhas legadas.
`compararGruposOpcionais` (`produtos.ts`, desempate de GRUPOS por nome) fica como
está: é outra lista, e mexer nela é fora de escopo.

3. No cliente, ao montar `opcionaisPorGrupo`, aplicar o **mesmo** comparador
   (`ordem || id.localeCompare`), espelhando `CartaoAssociacaoOpcionais.tsx:192-196`.
   Não é redundância: o mapa é reagrupado no cliente e um `Array.prototype.sort`
   estável sobre uma ordem já correta é barato e protege a lista de uma futura
   mudança na query.

Este passo é o **primeiro** da ordem de implementação e fecha verde sozinho.

---

### Mudanças em `ModoReordenar` — exatamente duas props, ambas opt-in

`src/components/painel/ModoReordenar.tsx`.

**1. `semArrasto?: boolean` (default `false`)**

Não confundir com `arrastoBloqueado` (`:144`), que desce como `bloqueado={...}`
(`:363`) e deixa **alça E setas** inertes — não serve.

`semArrasto` faz **três** coisas, e nenhuma delas toca o caminho de escrita:

a. **Não monta `DndContext`/`SortableContext`/`DragOverlay`.** O `<ol>` (`:351-375`)
   é renderizado direto. Motivo: é o que mata de verdade o `DndContext` dentro de
   `DndContext` que a issue rejeitou (§ "Por que sem arrasto"), e é o que **elimina
   o `screenReaderInstructions`** — conferido em
   `node_modules/@dnd-kit/core/dist/core.cjs.development.js:3360`, onde `DndContext`
   renderiza `<Accessibility>` **incondicionalmente**, com um `HiddenText` (as
   instruções, `:172`) e uma `LiveRegion` própria (`:175`). Sem `DndContext` não há
   nem a frase "Pressione espaço para começar a arrastar" (`ModoReordenar.tsx:90-94`)
   nem uma **terceira** `aria-live` na tela — o que mantém a "regra das duas regiões
   vivas" do desenho §3.3e.
b. **Não cria os `sensores` nem os `anuncios`** (só custo morto sem contexto).
c. **Nada mais.** `mensagemInicial` **já é prop do chamador** (`:130`) — "suprimir a
   `mensagemInicial` que fala em arrastar" é a casca nova passar a frase certa, não
   código dentro do `ModoReordenar`. (Confirmado: nem
   `ReordenarOpcionaisDaCategoria.tsx:103-106` nem `ReordenarCategorias.tsx:81-84`
   mencionam arrastar hoje.)

**2. `renderLinha?: (ctx) => ReactNode` (default: a `LinhaCategoriaReordenavel` atual)**

```
ctx = { item: ItemReordenavel; indice: number; total: number;
        bloqueado: boolean; onMover: (de: number, para: number) => void }
```

Necessária porque a lista de ITENS não renderiza `LinhaCategoriaReordenavel` (ver
tabela de "o que precisa ser criado"). O `map` (`:352-368`) passa a ser
`<Fragment key={item.id}>{renderLinha(ctx)}</Fragment>` — `Fragment` com `key` **não
emite markup**, então o HTML dos dois consumidores atuais não muda um byte.
O default é o JSX de hoje, `compacta={item.prefixo != null}` incluído (`:362`).

**`ItemReordenavel` (`:97-103`) NÃO muda.** Quem precisa de conteúdo custom por item
o resolve dentro do próprio `renderLinha`, olhando `item.id` nos seus mapas.

**Prova de não-regressão exigida:** `ReordenarCategorias.test.tsx` e
`ReordenarOpcionaisDaCategoria.test.tsx` passam **sem uma linha alterada**. Se
precisarem de edição, a mudança regrediu — é a trava do critério de aceite.

---

### Mudanças em `LinhaCategoriaReordenavel` — duas props opt-in

`src/components/painel/LinhaCategoriaReordenavel.tsx`. Elas servem à linha do
**GRUPO** (o disclosure e o painel), não à do item.

- **`conteudo?: ReactNode`** — substitui o bloco nome/detalhe (`:163-170`). É por
  aqui que o gatilho do disclosure entra: `<button aria-expanded aria-controls>`
  com chevron, envolvendo "Bordas / 4 itens" (mockup `:106-112`). Ausente = markup
  de hoje, idêntico.
- **`painel?: ReactNode`** — bloco renderizado DEPOIS da row, **dentro do mesmo
  `<li>`**, para o `<ol>` e a numeração continuarem válidos.

A estrutura do `<li>` muda **só quando `painel != null`**, exatamente como o mockup
desenhou (`mockups/sanfona-itens-opcionais.html:197` fechado vs. `:211` aberto):

- `painel == null` → `<li className={classesDeHoje}>{row}</li>` — **zero byte de
  diferença** para `ReordenarCategorias` e `ReordenarOpcionaisDaCategoria`.
- `painel != null` → `<li className="border-b border-border px-2 py-2 …">`
  (sem `flex items-center gap-2`) com `<div className="flex items-center gap-2">{row}</div>`
  seguido de `{painel}`.

Duas ramificações num `return`; é feio e é honesto — a alternativa (wrapper sempre)
mudaria o markup de duas telas já entregues que ninguém pediu para mudar.

`ReordenarOpcionaisDaCategoria.tsx` ganha **só um pass-through** de `renderLinha`
(prop opcional, repassada ao `ModoReordenar`) — é o cartão quem sabe o que é um
disclosure de grupo.

---

### O painel de itens

**`src/components/painel/PainelItensDoGrupo.tsx`** — o dono do estado e da fiação.

Props:

```
grupoId: string; grupoNome: string;
itens: Opcional[];            // TODOS do grupo, ativos e inativos, já ordenados
alcance: string[];            // nomes das categorias de PRODUTO que usam o grupo
acoes: OpcionaisClientAcoes;  // as 5 usadas: criar/atualizar/alternar/remover/reordenarItens
onSalvo: () => void;          // = router.refresh() do cartão
```

Estrutura (espelha o mockup `:117-181`):

1. `<p className="text-xs text-muted-foreground">` com a frase de alcance — **só
   quando `alcance.length >= 2`** (desenho §3.2, critério de UI nº 2).
2. `<ReordenarItensDoGrupo>` — que já emite a região viva e o `<ol>`.
3. Botão `+ Adicionar opcional`, FORA do `<ol>` e dentro do painel (mockup `:177`).
   Não usa o `rodape` do `ModoReordenar` (`:130`), que injeta **dentro** do `<ol>`.

Estado local: `linhaAberta: { id: string; modo: "editando" | "confirmando" } | null`
— **uma só** fora de `leitura` por cartão (desenho §2). O botão "Adicionar" abre uma
linha extra em `editando` sem id (item novo, inline, sem `Sheet`).

Refs: `botaoAdicionarRef` (alvo de foco pós-remoção bem-sucedida, desenho §3.3d) e
`itensRef: Ref<ManipuladorModoReordenar>` (flush + anúncios).

**Anúncios:** todo evento de ITEM vai por `itensRef.current?.anunciar(...)`, nunca por
uma `aria-live` nova — é o mesmo contrato que `CartaoAssociacaoOpcionais.tsx:145-151`
já usa para os eventos de GRUPO. Frases literais na tabela do desenho §5.

**`src/components/painel/LinhaItemOpcional.tsx`** — a linha, sem `useSortable`.
Props: `item: Opcional`, `indice`, `total`, `modo: "leitura"|"editando"|"confirmando"`,
`emVoo: boolean`, `alcance: string[]`, `onMover`, e os callbacks de cada ação.
Regras não-negociáveis (desenho §2, §3, §7):

- `aria-disabled`, **nunca** `disabled`, em `Salvar`/`Cancelar`/`Remover` durante
  `salvando`/`removendo`; o handler guarda com `if (emVoo) return;`. Mesma armadilha
  documentada em `LinhaCategoriaReordenavel.tsx:37-42`.
- `min-h-[44px]` **literal** em todo alvo; nunca `size="icon-sm"` (33,6px) nem
  `min-h-11` (52,8px na base de 120%).
- `hidden sm:inline-flex` nas setas ↑↓ + os mesmos comandos como `MenuItem` no kebab
  (a régua de `compacta`, `LinhaCategoriaReordenavel.tsx:177`/`:216`).
- Confirmação: `<div role="group" aria-labelledby={idPergunta}>`, **não**
  `role="alertdialog"`; `autoFocus` no `Cancelar`; `<li>` NÃO desmonta.
- Inativo: `<Badge variant="outline">Inativo</Badge>`; **nada** de `opacity-`,
  `line-through` ou linha acinzentada.
- Kebab: `Editar` · `Ativar na vitrine`/`Desativar na vitrine` · `Remover`
  (`text-destructive`), mais `Mover para cima/baixo` abaixo de `sm`.

**`src/components/painel/ReordenarItensDoGrupo.tsx`** — casca fina, espelhando
`ReordenarOpcionaisDaCategoria.tsx` (115 linhas):

```
<ModoReordenar
  ref={ref} itens={itens} semCartao ocultarStatus semArrasto
  renderLinha={(ctx) => <LinhaItemOpcional … />}
  mensagemInicial={`${n} opcionais no grupo ${grupoNome}, na ordem da vitrine. Use os botões mover para cima e mover para baixo.`}
  onReordenar={(ids) => onReordenar({ categoria_opcional_id: grupoId, opcional_id: ids })}
/>
```

`onReordenar: typeof reordenarItensDoGrupoOpcional` — **obrigatória, sem default**
(regra da issue 160, igual a `ReordenarOpcionaisDaCategoria.tsx:57-62`).

Com 1 item no grupo não há movimento possível na tela, e a autoridade continua sendo
o `.min(2)` do `schemaReordenacaoItensDoGrupo` (`src/lib/validacoes/opcional.ts:87`).

---

### Onde mora "qual grupo está aberto" — no CARTÃO

`src/components/painel/CartaoAssociacaoOpcionais.tsx` ganha:

```
const [grupoAberto, setGrupoAberto] = useState<string | null>(null);
const gatilhosRef = useRef(new Map<string, HTMLButtonElement | null>());
```

**Tem que ser aqui, e não na linha**, porque o cartão REMONTA a lista de grupos por
`key={chaveDaLista}` (`:232`, aplicado em `:277`) a cada toggle de checkbox. Se o
estado do disclosure morasse na linha, **desmarcar outro grupo fecharia o painel
aberto** e jogaria o foco no `<body>`. Guardado por `categoria_opcional_id`, ele
sobrevive à remontagem; depois dela, o foco volta ao gatilho pelo `gatilhosRef`.

O cartão passa `renderLinha` para `ReordenarOpcionaisDaCategoria` (`:276-286`),
montando por grupo: `conteudo` = o botão de disclosure, e `painel` =
`grupoAberto === g.id ? <PainelItensDoGrupo … /> : null`.

**Um grupo aberto por cartão** (desenho §1): abrir B fecha A, com o anúncio
"A fechado. B aberto, N opcionais." na região viva dos GRUPOS
(`reordenarRef.current.anunciar`, o caminho que já existe em `:145-151`).

**Arrastar um grupo fecha o painel antes** (desenho §3.4 nº 7): o cartão zera
`grupoAberto` quando `arrastoBloqueado`/o arrasto começa — senão um fantasma de
400px sob o dedo, e `isDragging` já aplica `[&>*]:opacity-0`
(`LinhaCategoriaReordenavel.tsx:132`).

Props novas do cartão: `opcionaisPorGrupo: Map<string, Opcional[]>` e
`alcancePorGrupo: Map<string, string[]>` — obrigatórias, vindas de
`AssociacaoOpcionais`.

---

### O `Escape` com `stopPropagation()` — onde exatamente

Dois lugares, ambos **dentro de `LinhaItemOpcional.tsx`**, no `onKeyDown` do
**container** de cada estado (nunca em `window`, senão roubaria `Escape` em `leitura`):

- `<div role="group">` da confirmação (mockup `:164`);
- o `<div>` que envolve os dois inputs da edição (mockup `:148`).

```
if (e.key === "Escape") { e.stopPropagation(); cancelar(); }
```

Na 217 este cartão vai para dentro de um modal. **Sem o `stopPropagation`, o `Escape`
sobe e fecha o modal inteiro** em vez de cancelar a confirmação — exatamente a
armadilha de `Escape` que motivou a recusa ao `AlertDialog` aninhado. A hierarquia da
tabela do desenho §3.3c é **critério de aceite**, e o `Enter` dentro dos inputs leva
`preventDefault()` (salva, não submete formulário de fora).

---

### Regra cliente ↔ servidor — onde cada invariante é garantida

Esta issue **não cria nenhuma superfície de escrita nova**: ela é o primeiro
consumidor de UI de actions já validadas e testadas. Mapa explícito:

| Invariante | Camada que garante | Onde |
|---|---|---|
| Ler opcionais da própria loja (inclui inativos) | **RLS** `opcionais_leitura_propria` | migration 080; `buscarOpcionaisDoLojista` só passa `client` + `lojaId` |
| Criar/editar/remover opcional | **RLS** `opcionais_escrita_propria` + prova de posse do grupo em `categoriaOpcionalPertenceALoja` | `actions/opcional.ts:178-183`, `:213-220`, `:264-266` |
| `preco` (valor monetário de CADASTRO) | **Server Action**: `schemaOpcional` (`validacoes/opcional.ts:9-15`, `.finite().min(0)` + ≤2 casas) + CHECK `preco >= 0` e `numeric(10,2)` no banco (`…_opcionais.sql:47`) | o cliente envia o campo; o servidor é quem aceita ou recusa |
| `preco` em PEDIDO | **Intocado por esta issue.** O total do pedido continua recalculado no servidor a partir do banco (`seguranca.md` §10) e o item de pedido guarda snapshot (`itens_pedido_opcionais`, RN-O6). **Nenhuma tela desta issue calcula subtotal, frete, desconto ou total.** | — |
| `ordem` dos itens | **RPC**: derivada de `ordinality - 1` dentro da transação; o cliente manda **só a sequência de ids** | migration `…_rpc_reordenar_itens_do_grupo_opcional.sql:92-98` |
| Escopo `loja_id` da reordenação | **Server Action**: `p_loja_id` vem de `buscarLojaDoDono` (`auth.uid()`), nunca do payload; trava T2 na RPC | `actions/opcional.ts:486-508` |
| Grupo alvo da reordenação (único parâmetro de escopo vindo do cliente) | **Server Action** `categoriaOpcionalPertenceALoja` + trava T3 na RPC | `actions/opcional.ts:494-501` |
| Permutação completa / id alheio / duplicado | **RPC**, `row_count` dentro da transação (T4/T6) | migration `:81-107` |
| Via admin | **Server Action admin** (`validarLojaIdAdmin` → `verificarAdminSaaS` → `service_role`) | `admin-opcionais.ts:513-552` |
| `alcance` (nomes das categorias de produto) | Derivado de `associacoes`, que já é dado **RLS-escopado** da própria loja | sem leitura nova, sem vetor cross-tenant |

**Nenhuma política RLS nova, nenhuma tabela nova, nenhuma migration.** Se o
`executar` sentir vontade de escrever uma, o plano está sendo descumprido.

---

### O caso de escrita que PRECISA de cuidado: `ordem` no `atualizarOpcional`

Único ponto onde a UI nova pode corromper dado — e o `revisar`/`auditar` devem cobrar:

`atualizarOpcional` faz `update({ ...parsed.data })` (`actions/opcional.ts:221-225`) e
`schemaOpcional` é `.strict()` **exigindo `ordem`** (`validacoes/opcional.ts:31`).
Logo, salvar a edição inline **escreve `ordem` junto**. Cenário de corrupção:

> A(0) B(1) C(2). O lojista move C para o topo → a RPC grava C=0, A=1, B=2. As props
> ainda dizem C=2 (reordenar **não** faz `router.refresh()`, por desenho —
> `CartaoAssociacaoOpcionais.tsx:225-231`). Editar o nome de C agora mandaria
> `ordem: 2` e **C voltaria para o fim** na cara do lojista.

Regra obrigatória para toda mutação disparada de dentro do painel de itens:

1. `await itensRef.current?.finalizar()` **antes** de chamar a action — mesmo padrão
   do toggle do cartão (`CartaoAssociacaoOpcionais.tsx:133`), pelo mesmo motivo
   (`:54-60`).
2. O payload leva **`ordem: indice`** (o índice 0-based que o `renderLinha` entrega,
   já pós-flush), não `item.ordem` das props. É order-preserving por construção:
   após a RPC, `ordem == índice`; e nas linhas legadas (todas `ordem = 0`) o índice
   já vem do desempate por `id`, então escrever o índice não move nada de lugar.
3. `nome` e `preco` do formulário; **`categoria_opcional_id` e `ativo` das props** —
   a sanfona não move item entre grupos nem alterna `ativo` por esse caminho
   (quem alterna é `alternarOpcionalAtivo`, que escreve só `ativo`,
   `actions/opcional.ts:245-248`).
4. Item novo: `ativo: true`, `ordem: itens.length` (desenho §8). Colisão com linhas
   legadas em `ordem = 0` é inofensiva — o desempate por `id` mantém o render
   determinístico, e o primeiro reordenar normaliza tudo para 0..n-1.

`alternarOpcionalAtivo` e `removerOpcional` **não** tocam `ordem`. Remoção deixa buraco
(0,1,3) — irrelevante, porque a leitura é por `ordem` ascendente e a RPC reescreve a
faixa inteira no próximo movimento (é o que o comentário `:16-19` da migration diz).

---

### Cenários

**Caminho feliz**

1. `/painel/produtos/opcionais` → aba "Opcionais por categoria de produto".
2. O cartão "Pizzas" mostra os grupos marcados na ordem gravada (SSR).
3. Toque no nome "Bordas" → `aria-expanded="true"`, painel abre, região viva dos
   grupos anuncia *"Bordas aberto. 4 opcionais, na ordem da vitrine."*
4. Painel lista os 4 itens (inativos incluídos), numerados, com preço formatado.
   Cabeçalho com a frase de alcance **se** `alcance >= 2`.
5. Toque no bloco nome/preço → `editando`, foco no input **nome**,
   `aria-describedby` apontando para a frase de alcance.
6. `Salvar` → flush do reorder pendente → `atualizarOpcional(id, payload)` →
   toast + anúncio → `router.refresh()`.
7. `↑`/`↓` → otimismo imediato, anúncio `mensagemPosicao`, debounce de 500ms,
   uma ida à RPC com a sequência completa de ids.
8. `⋮ → Remover` → linha vira pergunta com alcance, foco no `Cancelar`.
   `Remover` → `removerOpcional` → foco vai para "+ Adicionar opcional".

**Casos de borda**

| Caso | Comportamento exigido |
|---|---|
| Grupo sem nenhum item | `Nenhum opcional neste grupo ainda.` + botão adicionar; **não** monta `ReordenarItensDoGrupo` (espelha `CartaoAssociacaoOpcionais.tsx:260` para a lista vazia) |
| Grupo com 1 item | Lista normal; setas inertes por `aria-disabled` (`moverPorDeslocamento` devolve a mesma referência); **nenhuma** chamada à action |
| Grupo só com inativos | Aviso `Nenhum opcional ativo — o cliente não vê nenhuma opção aqui.` |
| `alcance` 0 ou 1 | **Nenhum** texto de alcance, em lugar nenhum |
| Alcance 2 | `Ele sai de {A} e {B}.` · Alcance ≥3 → contagem |
| Último item do grupo | A pergunta acrescenta `É o último opcional de {grupo}.` |
| Nome vazio / preço inválido | `schemaOpcional` recusa no cliente (UX) **e** na action (segurança); `aria-invalid` + `aria-describedby` no campo |
| Preço com vírgula, `1.234,56`, negativo, 3 casas | `Number(replace)` + `.min(0)` + refine de 2 casas; negativo e 3 casas são recusados |
| Seta no limite | No-op silencioso + anúncio "já está na primeira/última posição" (`ModoReordenar.tsx:252-261`) |
| Falha de rede no reordenar | A lista volta à última ordem **confirmada** e anuncia (`ModoReordenar.tsx:204-211`) |
| Falha na remoção | A confirmação **NÃO fecha**, foco permanece no `Remover`, retry custa um `Enter` |
| Toggle de checkbox com edição aberta | O toggle já aguarda o `finalizar()`; a remontagem por `chaveDaLista` fecha a linha aberta — aceitável e consistente com o que a 213 já faz |
| Desmarcar OUTRO grupo | O painel aberto **continua aberto** (estado no cartão) e o foco volta ao gatilho |
| Grupo removido na Biblioteca por outra aba | `router.refresh()` traz props sem ele; `grupoAberto` aponta para id inexistente → o cartão trata como fechado |
| Loja bloqueada / sem entitlement | Inalterado: o guard é do layout `(bloqueavel)`, não desta UI |

**Tratamento de erros (`seguranca.md` §14)**

Toda action já devolve `{ ok: false, erro: <mensagem genérica> }` com o detalhe em
`console.error` no servidor (`actions/opcional.ts:188-189`, `:226-228`, `:267-269`,
`:510-512`). A UI **repassa `r.erro` como está** — nunca `String(e)`, nunca stack, nunca
código do Postgres. O erro vai ao `toast.error` **e** à região viva dos itens (o foco
está no `Salvar`/`Remover` naquele instante, não no campo).

---

### Schema de banco

**Nada.** Nenhuma tabela, coluna, índice, CHECK, RPC ou política RLS nova. As
migrations da 215 já estão aplicadas no cloud (`npx supabase migration list` com
`Remote` preenchido para `20260918120000`, `20260918121000`, `20260918130000`).

### Validação (zod)

Schemas existentes, reusados **sem alteração** e **iguais no form e na Server Action**:

- `schemaOpcional` (`src/lib/validacoes/opcional.ts:24-33`) — criar e editar inline.
  O cliente valida para UX (`safeParse` antes do envio, como
  `OpcionaisClient.tsx:871-875` já faz) e a action revalida por segurança
  (`actions/opcional.ts:170`, `:203`).
- `schemaReordenacaoItensDoGrupo` (`:84-92`) — só na action; o cliente manda ids.

### Recálculo no servidor

Não há total, subtotal, frete nem desconto nesta superfície. O único valor monetário é
`opcionais.preco`, que é **cadastro**, não cálculo: o cliente envia `nome`, `preco`,
`categoria_opcional_id`, `ativo`, `ordem`; o servidor recusa o que não passa por
`schemaOpcional` + posse do grupo + RLS + CHECK do banco, e a `ordem` efetiva de
reordenação é **derivada no servidor** (`ordinality - 1`), nunca aceita do cliente.
O preço que entra num pedido continua vindo do banco no momento do pedido
(`seguranca.md` §10) — esta issue não abre caminho novo para ele.

---

### Arquivos a Criar / Modificar / NÃO tocar

**Criar**

| Arquivo | Motivo |
|---|---|
| `src/components/painel/LinhaItemOpcional.tsx` | Linha do item, 3 estados, sem `useSortable` |
| `src/components/painel/LinhaItemOpcional.test.tsx` | Markup dos 3 estados |
| `src/components/painel/PainelItensDoGrupo.tsx` | Painel: alcance, máquina de 1 linha aberta, add, fiação das actions |
| `src/components/painel/PainelItensDoGrupo.test.tsx` | Alcance ≥2, empty state, "só inativos" |
| `src/components/painel/ReordenarItensDoGrupo.tsx` | Casca do payload `{categoria_opcional_id, opcional_id}` |
| `src/components/painel/ReordenarItensDoGrupo.test.tsx` | `semArrasto`, `mensagemInicial`, setas |
| `src/lib/utils/alcance-do-grupo.ts` | `rotuloAlcance(nomes)` pura |
| `src/lib/utils/alcance-do-grupo.test.ts` | 0/1/2/3+ nomes |
| `src/lib/supabase/queries/opcionais.test.ts` | Prova do desempate (padrão de `categorias.test.ts:29-60`) |

**Modificar**

| Arquivo | O quê |
|---|---|
| `src/lib/supabase/queries/opcionais.ts:52` | `.order("id")` de desempate |
| `src/lib/supabase/queries/produtos.ts:260` | `|| a.id.localeCompare(b.id)` no sort de itens |
| `src/components/painel/ModoReordenar.tsx` | `semArrasto` + `renderLinha` |
| `src/components/painel/LinhaCategoriaReordenavel.tsx` | `conteudo` + `painel` |
| `src/components/painel/ReordenarOpcionaisDaCategoria.tsx` | pass-through de `renderLinha` |
| `src/components/painel/CartaoAssociacaoOpcionais.tsx` | `grupoAberto`, `gatilhosRef`, props `opcionaisPorGrupo`/`alcancePorGrupo`, `renderLinha` do grupo, colapso no `onDragStart` |
| `…/produtos/opcionais/OpcionaisClient.tsx` | 10ª chave em `OpcionaisClientAcoes` (`:108-118`); `opcionaisPorGrupo`/`alcancePorGrupo` em `AssociacaoOpcionais` (`:1001-1011`) e repasse ao cartão (`:1043-1052`) |
| `…/produtos/opcionais/page.tsx:66-76` | injeta `reordenarItensDoGrupoOpcional` |
| `src/app/admin/assinantes/[lojaId]/produtos/opcionais/OpcionaisAdminClient.tsx:53-70` | injeta `reordenarItensDoGrupoOpcional: (p) => reordenarItensDoGrupoOpcionalAdmin(lojaId, p)` |
| `src/components/painel/CartaoAssociacaoOpcionais.test.tsx:43-55` e `…/OpcionaisClient.test.tsx` | 10ª chave no `acoesBase()` (senão `tsc` quebra — e **é para quebrar**) |

**NÃO tocar**

- `src/components/ui/*` — gerado pelo shadcn CLI.
- `src/lib/actions/opcional.ts` e `src/app/admin/assinantes/actions/admin-opcionais.ts`
  — as 5 actions já existem, testadas e tipadas. A UI é consumidora.
- `src/lib/validacoes/opcional.ts` — os schemas cobrem tudo.
- `supabase/migrations/*` — nada de schema nesta issue.
- `src/components/painel/ReordenarCategorias.tsx` — só o `ModoReordenar` abaixo dele
  muda, e por props opt-in; **o arquivo e o teste dele ficam intactos**.
- `src/app/(painel)/painel/(bloqueavel)/produtos/page.tsx` — a troca de container é
  da **217**.
- `src/app/admin/assinantes/[lojaId]/carga-opcionais.ts` — já carrega tudo.

### Dependências externas

**Nenhuma.** Zero pacote novo, zero API externa, zero chamada paga. `@dnd-kit/core`
`^6.3.1`, `@dnd-kit/sortable` `^10.0.0`, `lucide-react` `^1.18.0`, `sonner` `^2.0.7`
e `zod` `^4.4.3` já estão em `package.json` e continuam nas mesmas versões.
Custo por chamada: **R$ 0**. Quota: nenhuma (Upstash, Nominatim, Sentry e Vercel não
são tocados — a feature não faz I/O além das Server Actions já existentes, que rodam
contra o Supabase da própria loja). Nada a degradar, nada que possa estourar.

---

### Ordem de implementação

Issue **não crítica** (`crítica: NÃO`): sem fase RED obrigatória do `tdd`. Mas ela
**escreve preço por uma superfície nova**, então `auditar` é obrigatório no fim.

1. **Desempate nas duas leituras** (`queries/opcionais.ts:52`, `queries/produtos.ts:260`)
   + `queries/opcionais.test.ts`. Isolado, fecha verde sozinho, e é **pré-requisito**
   da reordenação de itens funcionar como o lojista espera.
2. **`rotuloAlcance`** + teste puro. Sem dependência de nada; destrava a copy.
3. **`ModoReordenar` (`semArrasto`, `renderLinha`) e `LinhaCategoriaReordenavel`
   (`conteudo`, `painel`).** Gate: `npx vitest run src/components/painel/ReordenarCategorias.test.tsx src/components/painel/ReordenarOpcionaisDaCategoria.test.tsx` verde **sem editar nenhum dos dois**.
4. **`LinhaItemOpcional` → `ReordenarItensDoGrupo` → `PainelItensDoGrupo`**, nesta
   ordem (a de baixo para cima nas dependências), cada um com seu teste de markup.
5. **Fiação das actions:** 10ª chave em `OpcionaisClientAcoes` → `page.tsx` do lojista
   → `OpcionaisAdminClient.tsx` → `acoesBase()` dos testes. O build **fica vermelho
   entre o 1º e o último passo, e é o comportamento desejado** (issue 160 +
   `enforcement-props-action-admin.test.ts`, que lê o contrato pelo AST e cobra a
   chave nova automaticamente).
6. **`CartaoAssociacaoOpcionais`**: `grupoAberto` no cartão, mapas novos,
   `renderLinha` do grupo, colapso ao arrastar; e `AssociacaoOpcionais` derivando
   `opcionaisPorGrupo`/`alcancePorGrupo`.
7. **Gates:** `npx tsc --noEmit` → `npm run lint` → `npm test` → `npm run build`.
8. **`auditar`** (superfície nova que escreve preço), depois `revisar` ‖ `testar`,
   e `verificar` no cloud com a loja "Lanches base".

---

### Cenários de teste para o `testar`

Ambiente: Vitest `environment: node`, **sem jsdom, sem Playwright, sem MCP de browser**
(issue 176). Vale o mesmo disclaimer do cabeçalho de
`ReordenarOpcionaisDaCategoria.test.tsx:10-16`.

**Testável (é o que tem que estar coberto):**

1. `rotuloAlcance`: 0 nomes, 1 nome, 2 nomes (`{A} e {B}`), 3+ (contagem). Função pura.
2. `buscarOpcionaisDoLojista` chama `.order("ordem")` **e** `.order("id")`, nessa ordem.
3. `agruparOpcionaisPorCategoria` com dois itens de `ordem = 0`: a saída é a mesma
   independentemente da ordem de entrada (prova o desempate).
4. `semArrasto`: o markup **não** contém `Reordenar {nome}` (alça) nem
   `Pressione espaço para começar a arrastar` (desenho §9 nº 6).
5. Não-regressão: com `semArrasto` ausente, a alça e a instrução **continuam** lá.
6. `mensagemInicial` dos itens cita "mover para cima"/"mover para baixo" e **não**
   cita arrastar (§9 nº 7).
7. Linha de item inativo contém `Inativo` e **não** contém `opacity-` nem
   `line-through` (§9 nº 1).
8. Painel imprime a frase de alcance **só** com `alcance >= 2` (§9 nº 2).
9. Linha em `editando` tem `aria-describedby` apontando para o id da frase (§9 nº 3).
10. Botões da confirmação usam `aria-disabled` e **nunca** `disabled` — filtrando o
    `class` antes do match, como `ReordenarOpcionaisDaCategoria.test.tsx:67-71` já faz
    (as classes shadcn contêm `disabled:pointer-events-none` e dariam falso positivo).
11. Setas ↑↓ da linha de item levam `hidden sm:inline-flex` e os mesmos comandos
    existem como `MenuItem` (§9 nº 8).
12. Todo alvo novo tem `min-h-[44px]`; nenhum usa `size="icon-sm"` (§9 nº 9).
13. Empty state (`Nenhum opcional neste grupo ainda.`) e aviso "só inativos".
14. `renderLinha` default: o HTML de `ReordenarCategorias` e
    `ReordenarOpcionaisDaCategoria` é **idêntico** ao de antes da mudança.

**NÃO testável nesta máquina — o PR precisa dizer isto, em vez de "validado no mobile":**
gesto de toque e arrasto, abertura do kebab (popup do Base UI só monta com DOM real),
movimento real de foco (`autoFocus`, retorno ao kebab, ida ao "Adicionar"),
`Escape` e o `stopPropagation` (exige evento real), a temporização do debounce dentro
do componente e o anúncio em leitor de tela. Verificação manual em iOS Safari e Chrome
Android, e `verificar` no cloud.

---

### Riscos

| Risco | Mitigação |
|---|---|
| **`atualizarOpcional` reverter a ordem recém-gravada** (`ordem` vai no payload `.strict()`) | Flush do reorder + `ordem: indice` pós-flush. É o achado mais importante deste plano |
| Regressão de markup em `ReordenarCategorias`/`ReordenarOpcionaisDaCategoria` | Toda prop nova é opt-in com default idêntico ao de hoje; os dois testes existentes são o gate e **não podem ser editados** |
| Terceira `aria-live` na tela (a do dnd-kit) | `semArrasto` **não monta** `DndContext`, logo não monta `<Accessibility>` |
| Duas regiões vivas (grupos e itens) brigando | Divisão rígida: evento de GRUPO → região dos grupos; evento de ITEM → região dos itens. Nenhum evento em duas |
| `LinhaCategoriaReordenavel` virar canivete suíço | Só 2 props, ambas para a linha do grupo; a linha do ITEM é arquivo separado |
| `<li>` do grupo mudar de estrutura | Só quando `painel != null` — dois ramos de `return`, conferido contra o mockup (`:197` vs `:211`) |
| Esquecer a via admin | `tsc` + `enforcement-props-action-admin.test.ts` quebram sozinhos. **Corrigir o arquivo certo: `OpcionaisAdminClient.tsx`, não `CardapioAdminClient.tsx`** (este último não renderiza o `OpcionaisClient`) |
| Crescimento do `CartaoAssociacaoOpcionais` (379 → ~460 linhas) | O painel de itens é arquivo próprio; o cartão só ganha o estado do disclosure e o `renderLinha` |
| A 217 herdar um `Escape` quebrado | `stopPropagation()` nos dois containers é critério de aceite, não detalhe |
