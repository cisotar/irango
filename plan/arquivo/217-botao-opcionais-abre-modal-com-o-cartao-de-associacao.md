## Plano técnico

> **ok: true.** Sem migration, sem RLS nova, sem superfície de servidor nova.
> Duas divergências do enunciado da issue, ambas com evidência abaixo e ambas
> tornam o plano MENOR, não maior: (a) faltam **duas** queries em
> `produtos/page.tsx`, não uma; (b) o container certo é **um** `Dialog` com
> classes responsivas (precedente `ProdutoModal.tsx:271`), não um fork por
> `useMediaQuery`. Um bloqueio de CSS no critério do `sticky` foi achado e está
> em §7.

### Análise do codebase

**O que já existe e será reusado — nada disso se recria:**

| Arquivo | O que é | Como entra |
|---|---|---|
| `src/components/painel/CartaoAssociacaoOpcionais.tsx` | cartão da 214+216, pronto | renderizado dentro do modal, sem mudança de comportamento |
| `src/components/vitrine/ProdutoModal.tsx:265-271` | **precedente do container**: UM `Dialog`, `h-dvh w-screen rounded-none` no mobile → `md:` restaura o box centralizado | é o padrão a copiar (ver §1) |
| `src/components/ui/dialog.tsx:56-62` | `DialogContent` já é `flex flex-col overflow-hidden max-h-[calc(100dvh-2rem)]` — "corpo rolável definido pelo consumidor" está no comentário do próprio primitivo | dá o corpo rolável de graça |
| `src/hooks/useMediaQuery.ts` | fork SSR-safe | **não** será usado aqui (§1) |
| `src/lib/supabase/queries/opcionais.ts:51,77` | `buscarOpcionaisDoLojista`, `buscarAssociacoesOpcional` | já existem, já ordenadas com desempate estável; só passam a ser chamadas em mais uma page |
| `src/app/admin/assinantes/[lojaId]/carga-opcionais.ts:70-89` | agregado admin **já devolve `opcionais` e `associacoes`** | via admin não ganha **nenhuma** query nova — só passa a desestruturar o que já carrega |
| `src/app/admin/assinantes/actions/admin-opcionais.ts` | as 10 actions admin escopadas por `lojaId` | injetadas no `CardapioAdminClient`, copiando o bloco do `OpcionaisAdminClient.tsx:55-79` |
| `src/app/admin/assinantes/enforcement-props-action-admin.test.ts` | guard AST que resolve alias importado **e interseção** (cabeçalho, linha 40) | é ele que transforma "esqueci uma action no admin" em suíte vermelha |
| `src/lib/utils/alcance-do-grupo.ts` | copy do alcance | já consumido dentro do cartão; nada a fazer |
| `src/components/painel/ModoReordenar.tsx:454` | `role="status" aria-live` **dentro** da árvore do cartão | é o que salva o anúncio de grupo dentro do modal (§9) |

**O que precisa ser criado, e por que não dá para reusar:**

1. `src/components/painel/contrato-opcionais.ts` — módulo neutro para `CategoriaProduto`, `Associacao` e `OpcionaisClientAcoes` (§6). Não existe módulo neutro para isso hoje; o precedente de `.ts` puro dentro de `components/painel/` é `payloadZona.ts` / `rotulosAssinatura.ts`.
2. `src/lib/utils/derivar-associacao-opcionais.ts` — as 5 derivações puras hoje inline em `OpcionaisClient.tsx:979-1060`. É a única criação discutível; a justificativa está em §3.

Nada mais é criado. Sem lib externa nova, sem componente `ui/` novo, sem action nova, sem query nova.

---

### 1. A troca de container em `ProdutosClient.tsx`

**Hoje:** `Sheet` em `ProdutosClient.tsx:699-736`, com `SeletorOpcionaisCategoria` dentro (grade de checkbox + botão Salvar). Estado: `categoriaOpcionaisAberta` (`:214-215`), aberto pelo botão em `:486-494` (guardado por `grupo.id != null`, `:485`).

**A divergência.** A issue manda espelhar o `useMediaQuery("(min-width: 768px)")` de `:659-695`. **Recomendo não espelhar**, e usar o padrão do `ProdutoModal`:

- o fork do `FormProduto` existe porque ele troca **dois containers diferentes** (`Dialog` centrado ↔ `Sheet` lateral). Aqui o pedido é "Dialog largo no desktop, tela cheia no mobile" — que é literalmente **o mesmo Dialog** com outra caixa. `ProdutoModal.tsx:271` já resolve isso com uma classe só;
- `useMediaQuery` devolve `false` no primeiro paint e sincroniza no efeito (`useMediaQuery.ts:11-21`). Com duas árvores, no desktop o cartão **monta como mobile e remonta como desktop** na hidratação, e **remonta de novo a cada cruzada de 768px**. O cartão não é apresentação: ele carrega `selecionados`, `grupoAberto`, `togglandoRef`, o handle imperativo `reordenarRef` e um `criarSalvamentoCoalescido` com debounce de 500ms (`CartaoAssociacaoOpcionais.tsx:106-118`). Remontar no meio de um autosave **descarta o movimento pendente em silêncio** — exatamente o bug que `sairDoModoReordenar` (`ProdutosClient.tsx:~300`) foi escrito para evitar;
- uma árvore só também elimina o risco de dois `DndContext` montados ao mesmo tempo.

**Forma:**

```
<Dialog open={categoriaOpcionaisAberta !== null} onOpenChange={...}>
  <DialogContent className="<classes do ProdutoModal:271, md:max-w-3xl>">
    <DialogHeader className="shrink-0">        {/* ou sr-only, ver §7 */}
      <DialogTitle>Opcionais de {categoria.nome}</DialogTitle>
      <DialogDescription>…</DialogDescription>
    </DialogHeader>
    <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">   {/* ← corpo rolável */}
      <Accordion defaultValue={[categoria.id]}>
        <CartaoAssociacaoOpcionais … acoes={acoes} onSalvo={() => router.refresh()} />
      </Accordion>
    </div>
  </DialogContent>
</Dialog>
```

`<Accordion>` é **obrigatório**: o cartão devolve um `AccordionItem` (`CartaoAssociacaoOpcionais.tsx:307`), que sem raiz não renderiza. `key={categoria.id}` no cartão para trocar de categoria zerar o estado interno.

**Código morto após a remoção** (conferido por `grep -c`):
- `SeletorOpcionaisCategoria` inteiro — `ProdutosClient.tsx:778-858`;
- `import { Checkbox }` — `:34`, era o **único** uso (`:844`);
- o alias `salvarAssociacaoOpcionais: salvarAssociacao` na desestruturação de `acoes` — `:197` (o cartão recebe o objeto `acoes` inteiro);
- `type CategoriaOpcional = { id: string; nome: string }` local — `:86`, substituído pelo tipo real de `queries/opcionais`.
- **Continuam vivos, não remover:** `toast` (`:332,335,347,361`), `Loader2` (`:767`), `useTransition` (`:220-222`), `Separator` (`:674,691`), todo o bloco `Sheet*` (o mobile do `FormProduto` em `:678-695`).

---

### 2. `produtos/page.tsx` — o `Promise.all` ganha DOIS ramos, não um

O `Promise.all` de `produtos/page.tsx:46-59` tem 3 ramos; o 2º encadeia `buscarCategorias` → `buscarOpcionaisPorCategoria` em sequência de propósito (os ids). Os novos ramos são independentes e entram **em paralelo**:

```
const [produtos, { categorias, opcionaisPorCategoria }, categoriasOpcional,
       opcionais, associacoes] = await Promise.all([
  …os 3 de hoje, intactos…,
  buscarOpcionaisDoLojista(supabase, loja.id),      // 4º
  buscarAssociacoesOpcional(supabase, loja.id),     // 5º
]);
```

Custo: 2 round-trips que hoje não existem nessa rota, **em paralelo** — a latência da page não sobe, sobe a carga. Ambas já rodam idênticas em `/painel/produtos/opcionais` (`opcionais/page.tsx:41-48`).

**Além disso:** `categoriasOpcional` **para de ser estreitado** para `{id,nome}` (`page.tsx:71-74`) e passa as linhas inteiras — o cartão exige `CategoriaOpcional = Tables<"opcionais_categorias">` (`queries/opcionais.ts:18`).

---

### 3. O que o cartão exige, e de onde vem — o porquê do 5º ramo

O cartão pede 6 props de dados (`CartaoAssociacaoOpcionais.tsx:78-101`). Na 216 as três derivações novas saíram de props que o `OpcionaisClient` **já tinha**. Partindo do que `produtos/page.tsx` carrega hoje, **não sai**:

| Prop | Fonte na 216 | Dá para derivar do que `/painel/produtos` já tem? |
|---|---|---|
| `categoriasOpcional` | prop | **sim**, parando de estreitar para `{id,nome}` |
| `opcionaisPorGrupo: Map<string, Opcional[]>` | `opcionais` | **NÃO.** `opcionaisPorCategoria` traz um sub-select estreito — `opcionais(id, nome, preco, ordem)` (`queries/produtos.ts:237`) — sem `ativo`, `categoria_opcional_id`, `loja_id`, `descricao`. `Opcional` é a linha inteira. → `buscarOpcionaisDoLojista` |
| `totalItensPorGrupo` | `opcionais` | **NÃO** — mesmo motivo, e a contagem tem de ser da BIBLIOTECA (todo item do grupo), não só dos associados |
| `selecionadosIniciais` | `associacoes` | **NÃO** — e é o achado sério: `agruparOpcionaisPorCategoria` faz `if (opcionais.length === 0) continue;` (`queries/produtos.ts:268`) e **descarta grupo associado sem nenhum item**. Correto para a vitrine, fatal aqui: o grupo vazio abriria **desmarcado**, e como `alternar` grava `Array.from(selecionados)` (`CartaoAssociacaoOpcionais.tsx:168-171`), o primeiro toggle de qualquer outro grupo **apagaria a associação do vazio sem avisar**. Grupo recém-criado ainda sem item é o caso comum. → `buscarAssociacoesOpcional` |
| `ordemPorGrupo` | `associacoes` | **NÃO** — mesmo filtro, mesma perda |
| `alcancePorGrupo` | `associacoes` ⋈ `categoriasProduto` | **NÃO** — mesmo filtro; e o alcance errado faz a pergunta de remoção (`perguntaDeRemocao`) mentir sobre o que vai sumir |

Nada disso justifica mexer em `agruparOpcionaisPorCategoria`: o filtro está certo para o consumidor dela. A resposta é ler a fonte de verdade — as mesmas duas queries que a página irmã já lê.

**A extração pura.** Com isso, `ProdutosClient` precisaria dos **mesmos 5 `useMemo`** de `OpcionaisClient.tsx:979-1060`. Copiar significa duas cópias do comparador `a.ordem - b.ordem || a.id.localeCompare(b.id)` e do desempate de `ordem`, que é precisamente o que `queries/produtos.ts:293` documenta como "duplicar o critério é como as duas cópias divergem em silêncio". Extrair para `src/lib/utils/derivar-associacao-opcionais.ts`, funções puras sem React:

- `agruparOpcionaisPorGrupo(opcionais) → Map<string, Opcional[]>`
- `contarItensPorGrupo(porGrupo) → Map<string, number>`
- `selecionadosPorCategoria(associacoes) → Map<string, Set<string>>`
- `ordemPorCategoria(associacoes) → Map<string, Map<string, number>>`
- `alcancePorGrupo(associacoes, categoriasProduto) → Map<string, string[]>`

`OpcionaisClient` passa a chamá-las dentro dos mesmos `useMemo` (o hook fica, o corpo vira uma linha). Testáveis byte a byte em `environment: node`. Alternativa rejeitada: duplicar em `ProdutosClient` — mais barato hoje, e é a origem exata da divergência painel↔vitrine que a 216 gastou uma issue inteira consertando.

---

### 4. Injetar as actions — painel e admin

**Qual é o arquivo admin certo.** Confirmado por `grep`, **não** assumido: o `OpcionaisAdminClient.tsx` da 216 é a via admin do `OpcionaisClient`. Esta issue mexe no `ProdutosClient`, cuja via admin é `src/app/admin/assinantes/[lojaId]/produtos/CardapioAdminClient.tsx:5` (`import { ProdutosClient } from …`) — é esse. O `OpcionaisAdminClient` **não se toca**.

**Forma do contrato.** `AcoesProdutosClient` (`ProdutosClient.tsx:109-124`, 12 chaves, já com `salvarAssociacaoOpcionais`) passa a ser **interseção**:

```
export type AcoesProdutosClient = { …as 11 de produto/categoria/upload… } & OpcionaisClientAcoes;
```

21 chaves distintas (`salvarAssociacaoOpcionais` é comum às duas). Ganho: `<CartaoAssociacaoOpcionais acoes={acoes} />` tipa direto, sem mapear objeto novo. O `enforcement-props-action-admin.test.ts` resolve interseção (cabeçalho, etapa 3 / linha 40) — o guard continua vivo e passa a exigir as 21 no wrapper admin.

**Painel** (`produtos/page.tsx:78-92`): acrescentar as 9 faltantes de `@/lib/actions/opcional` — `criarCategoriaOpcional`, `atualizarCategoriaOpcional`, `removerCategoriaOpcional`, `criarOpcional`, `atualizarOpcional`, `alternarOpcionalAtivo`, `removerOpcional`, `reordenarOpcionaisDaCategoria`, `reordenarItensDoGrupoOpcional`.

**Admin** (`CardapioAdminClient.tsx:65-107`): as mesmas 9 na variante `*Admin(lojaId, …)`, copiando literalmente os closures de `OpcionaisAdminClient.tsx:55-79` (mesmas assinaturas). Props de dados novas (`opcionais`, `associacoes`) e `categoriasOpcional` alargada; `produtos/page.tsx` do admin só **desestrutura mais dois campos** do `carregarOpcionaisAdmin` que já os devolve (`carga-opcionais.ts:70-89`) e mapeia `associacoes` para o shape estreito, como `opcionais/page.tsx:38-42` já faz.

> Omitir qualquer uma **quebra o build** (props obrigatórias sem default, issue 160) — comportamento desejado. Se um dia virar `acoes?`, o mesmo esquecimento vira gravação silenciosa na loja do admin logado.

---

### 5. `revalidatePath` — forma e pontos exatos

`CAMINHO_PAINEL = "/painel/produtos/opcionais"` (`src/lib/actions/opcional.ts:28`) aparece em **10** pontos: linhas **97, 129, 152, 191, 230, 253, 271, 370, 444, 517** (a issue listou 9 com numeração de antes da 216; esta é a contagem atual).

**Forma: helper, não lista solta.**

```
const CAMINHOS_PAINEL = ["/painel/produtos/opcionais", "/painel/produtos"] as const;
function revalidarPainelDeProdutos() { for (const c of CAMINHOS_PAINEL) revalidatePath(c); }
```

Trocar as 10 chamadas por `revalidarPainelDeProdutos()`. Em **444** e **517** o `revalidatePath(\`/loja/${loja.slug}\`)` das linhas 445/518 **continua** — é ele que entrega o critério "a ordem gravada aparece na vitrine". Ponto único de edição quando aparecer o 3º caminho; um array inline repetido 10x é a próxima divergência.

**As 10, não só as de associação:** CRUD de categoria de opcional muda `categoriasOpcional`, CRUD de item muda `opcionaisPorGrupo` **e** os chips por produto de `ProdutosClient.tsx:581-598`. Todas afetam `/painel/produtos`.

**Nuance honesta do sintoma:** `onSalvo` já chama `router.refresh()`, que rebusca a rota **atual** — então dentro do modal a tela atualiza mesmo sem isto. O que `revalidatePath` conserta é a **rota irmã**: editar no modal de `/painel/produtos` e navegar para `/painel/produtos/opcionais` (ou o inverso) servia a entrada velha do Router Cache do cliente. Essa travessia é nova nesta issue — daí a linha.

**Isto é testável aqui**: `src/lib/actions/opcional.test.ts` já mocka `next/cache` (`:113-114`) e assere `toHaveBeenCalledTimes(2)` nas linhas **255** e **481** — vão para **3**. São essas duas asserções que provam o critério em `environment: node`.

---

### 6. Relocar `CategoriaProduto` / `OpcionaisClientAcoes` / `Associacao`

Hoje `components/painel/` importa **de volta** de um arquivo de rota:
- `CartaoAssociacaoOpcionais.tsx:27-30` → `OpcionaisClient`
- `PainelItensDoGrupo.tsx:22` → `OpcionaisClient`
- `CartaoAssociacaoOpcionais.test.tsx:25`, `PainelItensDoGrupo.test.tsx:18` idem

Precedente da mesma inversão já no repo: `DetalhePedido.tsx:26-29`.

**Destino:** `src/components/painel/contrato-opcionais.ts` (módulo `.ts` puro dentro de `components/painel/`, como `payloadZona.ts` e `rotulosAssinatura.ts`). Move-se, sem renomear (renomear só engrossa o diff e o guard AST resolve por alias, não por nome fixo):
- `CategoriaProduto` (`OpcionaisClient.tsx:86`)
- `Associacao` (`OpcionaisClient.tsx:88-92`) — hoje **não exportado**; passa a ser, porque agora são dois clientes
- `OpcionaisClientAcoes` (`OpcionaisClient.tsx:110-121`) — o `import type { typeof … }` de `@/lib/actions/opcional` vem junto; é import **de tipo**, não puxa server action para o bundle

**Direção depois:** `contrato-opcionais.ts` (folha) ← `CartaoAssociacaoOpcionais`, `PainelItensDoGrupo` (componentes) ← `OpcionaisClient`, `ProdutosClient` (rotas) ← `OpcionaisAdminClient`, `CardapioAdminClient` (wrappers admin). Rota → componente, nunca o contrário. `OpcionaisClientProps` **fica** em `OpcionaisClient.tsx` (é o contrato da rota, e `OpcionaisAdminClient.tsx:4` consumi-lo é a direção wrapper→rota, já aceita).

---

### 7. `sticky top-0` — e o bloqueio de CSS que ninguém viu ainda

Onde entra: `CartaoAssociacaoOpcionais.tsx:312`, o `<div className="flex items-center justify-between gap-2 border-b px-4 …">` — irmão do `AccordionContent`, dentro do `<Card>` de `:311`. Ganha `sticky top-0 z-10 bg-card`.

**`sticky top-0` sozinho NÃO vai funcionar.** `Card` tem `overflow-hidden` fixo na classe base (`src/components/ui/card.tsx:15`). `overflow: hidden` cria um scroll container, e o `sticky` gruda no **box do Card** — que não rola. Resultado: pinado em nada, exatamente o CSS morto que a 216 evitou, só que agora silencioso porque *parece* certo no código. Sem browser aqui, isso não aparece em teste nenhum.

**Saída recomendada:** prop opt-in no cartão — `cabecalhoFixo?: boolean` (default `false`) — que quando `true`:
- passa `className="overflow-visible"` no `<Card>` de `:311`;
- acrescenta `sticky top-0 z-10 bg-card` no cabeçalho de `:312`.

Só o modal passa `cabecalhoFixo`. `/painel/produtos/opcionais` fica byte a byte como está — e o comentário de `ModoReordenar.tsx:570` ("sem o portal o `overflow` do Card clipa o item em movimento") continua verdadeiro lá, e irrelevante aqui, porque o `DragOverlay` é portalado nos dois casos.

**Decisão de UX em aberto** (recomendação, não invenção): com `DialogTitle` visível "Opcionais de X" **e** o cabeçalho do cartão com o mesmo nome, o título aparece duas vezes. Recomendo `DialogTitle` em `sr-only` (Base UI precisa dele para o `aria-labelledby`) e deixar o cabeçalho sticky do cartão ser o título visível, com o badge "N incluídos" junto. Se o `desenhar` preferir o contrário, é troca de classe, não de estrutura.

---

### Cenários

**Caminho feliz**
1. `/painel/produtos`, cabeçalho de uma categoria real → clique em "Opcionais" (`ProdutosClient.tsx:486`).
2. Mobile: modal ocupa a tela inteira. Desktop (≥768px): Dialog centrado, `md:max-w-3xl`.
3. Cartão aberto, cabeçalho grudado no topo do corpo rolável.
4. Marcar um grupo em "Disponíveis" → autosave → "Salvo" no rodapé do cartão → `router.refresh()`.
5. Abrir a sanfona de um grupo → editar preço de um item inline → salva → alcance avisa quantas categorias de produto são afetadas.
6. Arrastar um grupo → debounce 500ms → RPC atômica.
7. Fechar o modal → os chips de `ProdutosClient.tsx:581-598` refletem a mudança.
8. Ir para `/painel/produtos/opcionais` → mesma verdade (é o `revalidatePath` novo).
9. Vitrine `/loja/[slug]` → ordem gravada (é o `revalidatePath` do slug, já existente).

**Casos de borda**
- **Loja sem nenhuma categoria de opcional** → o cartão já trata: "Crie categorias de opcional para poder associá-las" (`CartaoAssociacaoOpcionais.tsx:326-329`). O modal não fica vazio.
- **Grupo associado com ZERO itens** → com `buscarAssociacoesOpcional` abre **marcado**, `0 itens`, sanfona vazia. Sem ele, apaga a associação em silêncio (§3). É o caso de borda que decide o 5º ramo.
- **Grupo "Sem categoria"** (`grupo.id == null`) → botão nem existe (`:485`). Guarda preservada.
- **Categoria sem nenhum grupo marcado** → "Nenhum grupo incluído ainda" (`:334-346`).
- **Redimensionar a janela cruzando 768px com autosave em voo** → com uma árvore só, nada remonta, nada se perde. É o argumento de §1.
- **`Escape` com a confirmação inline de remoção aberta** → `stopPropagation()` em `LinhaItemOpcional.tsx:178` e `:352` fecha a confirmação, não o modal. Preparado pela 216; **é aqui que passa a ser exercido de verdade.**
- **`Escape` durante arrasto por teclado** → risco aberto, ver §Riscos.
- **Falha de rede no toggle / no reorder / no CRUD de item** → cada um já reverte e mostra `toast.error` com mensagem genérica; nada muda com o container.
- **Sem permissão / loja de outro dono** → RLS derruba no servidor; a UI mostra o erro genérico.
- **Item inativo** → aparece na sanfona (a RPC da 215 exige a permutação completa); comportamento da 216, intocado.

**Tratamento de erros:** nada muda. `lib/actions/opcional.ts` devolve mensagem genérica (`ERRO_ORDEM`, `:36`) e loga o detalhe no servidor (`seguranca.md` §14); o cliente faz `console.error("[alternarAssociacao]", e)` (`CartaoAssociacaoOpcionais.tsx:177`) e `toast.error`. Nenhum `e.message` de banco chega à tela.

### Schema de banco

**Nenhum.** Sem migration, sem coluna, sem índice, sem RLS nova. As 3 migrations da 215 já estão no cloud.

### Validação (zod)

**Nenhum schema novo.** Todo payload que sai do modal passa pelos schemas de `src/lib/validacoes/opcional.ts` já existentes (`schemaAssociacaoCategoriaOpcional`, `schemaOpcional`, `schemaReordenacaoOpcionaisDaCategoria`, `schemaReordenacaoItensDoGrupo`), nas Server Actions — inclusive o `preco`, cujo `.omit` foi fechado no `d5fd26e` da 216.

### Recálculo no servidor / camada de garantia

Esta issue **não cria superfície de servidor**. Mapa mesmo assim:

| Invariante | Onde é garantida — inalterada por esta issue |
|---|---|
| Ler opcionais/associações do lojista | RLS de SELECT (`opcionais_leitura_propria`, `opcionais_categorias_*`, `categoria_produto_opcionais_*`). `loja.id` vem de `buscarLojaDoDono`, **nunca** do cliente (`produtos/page.tsx:39`) |
| Gravar associação / ordem / item | Server Action em `lib/actions/opcional.ts` com client autenticado + RLS de INSERT/UPDATE; `loja_id` derivado, FKs cross-tenant re-provadas (`categoriaOpcionalPertenceALoja`, `:44-57`) |
| `preco` do opcional | `schemaOpcional` na Server Action; o preço do pedido é recalculado no checkout a partir do banco (`seguranca.md` §10) — nada aqui toca isso |
| Ordem dos itens do grupo | RPC atômica da 215, `SECURITY INVOKER`, confere `row_count` — permutação incompleta derruba a transação |
| Via admin | `validarLojaIdAdmin` → `verificarAdminSaaS` → **só então** `createServiceClient`, com `.eq("loja_id")` em toda query (`carga-opcionais.ts:57-66`). O `lojaId` do closure no client é **montagem de chamada, não barreira** |
| Service role | só em `carga-opcionais.ts` (server-only) e nas actions admin. Nenhum `'use client'` novo chega perto |

O modal é 100% cliente e **não decide nada**: toda escrita continua atravessando a mesma Server Action que já atravessava em `/painel/produtos/opcionais`.

### Dependências externas

**Nenhuma nova.** Nada de `npm install`. Sem chamada de API paga, sem quota, sem custo variável — `@base-ui/react@^1.5.0` e `@dnd-kit/*` já estão em `package.json` e já são usados nas duas telas. Não há o que estourar.

### Arquivos

**Criar (2)**
- `src/components/painel/contrato-opcionais.ts` — módulo neutro (§6)
- `src/lib/utils/derivar-associacao-opcionais.ts` + `.test.ts` — 5 derivações puras (§3)

**Modificar (12)**
- `src/app/(painel)/painel/(bloqueavel)/produtos/ProdutosClient.tsx` — Dialog responsivo no lugar da `Sheet`; remove `SeletorOpcionaisCategoria` (`:778-858`) e o import morto de `Checkbox` (`:34`); props novas; `AcoesProdutosClient` vira interseção
- `src/app/(painel)/painel/(bloqueavel)/produtos/page.tsx` — 4º e 5º ramos; `categoriasOpcional` inteira; +9 actions
- `src/app/(painel)/painel/(bloqueavel)/produtos/opcionais/OpcionaisClient.tsx` — tipos saem para o módulo neutro; os 5 `useMemo` passam a chamar o util
- `src/components/painel/CartaoAssociacaoOpcionais.tsx` — import corrigido (`:27-30`); prop `cabecalhoFixo` + `sticky` (`:311-312`)
- `src/components/painel/PainelItensDoGrupo.tsx` — import corrigido (`:22`)
- `src/lib/actions/opcional.ts` — `CAMINHOS_PAINEL` + helper, 10 pontos
- `src/app/admin/assinantes/[lojaId]/produtos/CardapioAdminClient.tsx` — +9 actions admin, props novas
- `src/app/admin/assinantes/[lojaId]/produtos/page.tsx` — desestrutura `opcionais`/`associacoes` (já carregados) e repassa
- Testes a ajustar: `src/lib/actions/opcional.test.ts` (`:255`, `:481` → 3); `CardapioAdminClient.test.tsx` (10 → 21 chaves + props novas); `ProdutosClient.test.tsx` (`acoesBase()` → 21 chaves, props novas nos 3 pontos de render); `CartaoAssociacaoOpcionais.test.tsx:25` e `PainelItensDoGrupo.test.tsx:18` (import)

**NÃO tocar**
- `src/components/ui/**` — gerado pelo shadcn CLI. O `overflow-hidden` do `Card` e o box do `DialogContent` se resolvem por `className` no consumidor, nunca editando o primitivo
- `src/app/admin/assinantes/[lojaId]/produtos/opcionais/OpcionaisAdminClient.tsx` — é a via admin do `OpcionaisClient`, não do `ProdutosClient` (§4)
- `src/app/admin/assinantes/[lojaId]/carga-opcionais.ts` — já devolve tudo; só a page passa a usar
- `src/lib/supabase/queries/produtos.ts` — o filtro de `:268` está certo para a vitrine; a resposta é ler `associacoes`, não afrouxá-lo
- `src/lib/supabase/queries/opcionais.ts`, `src/lib/validacoes/opcional.ts`, `supabase/migrations/**`, `src/app/admin/assinantes/enforcement-props-action-admin.test.ts` (o guard tem de continuar verde **sem** ser editado — se precisar de ajuste, o contrato é que está errado)
- Comportamento do cartão — chega pronto da 216

### Ordem de implementação

Issue **não crítica**, sem migration e sem RLS: **não há fase RED obrigatória**. A ordem é por dependência de compilação, e cada passo termina com `npx tsc --noEmit` verde.

1. **`contrato-opcionais.ts`** — mover os 3 tipos, corrigir os 4 imports + `OpcionaisClient`. Refactor puro, sem mudança de comportamento; a suíte já existente é a rede. *Primeiro porque todo o resto importa daqui.*
2. **`derivar-associacao-opcionais.ts` + teste** — extrair as 5 derivações, plugar em `OpcionaisClient`, rodar `npx vitest run src/lib/utils/derivar-associacao-opcionais.test.ts` e a suíte do `OpcionaisClient`. *Antes do consumidor novo: garante que a extração não moveu a agulha na página que já funciona.*
3. **`lib/actions/opcional.ts`** — `CAMINHOS_PAINEL` + helper nos 10 pontos; ajustar `opcional.test.ts:255,481`. *Isolado, e é a única parte do critério que a suíte prova sozinha.*
4. **`cabecalhoFixo` no cartão** — `overflow-visible` + `sticky`, default `false`. *Antes do modal, para o modal já poder passar a prop.*
5. **`produtos/page.tsx` (painel)** — 4º/5º ramos, `categoriasOpcional` inteira, +9 actions. *Fornece os dados antes de o cliente pedi-los.*
6. **`ProdutosClient.tsx`** — props novas, `AcoesProdutosClient` interseção, `Dialog` responsivo, remoção do `SeletorOpcionaisCategoria` e do código morto. *O build quebra até o passo 7 — é o guard fazendo o trabalho dele.*
7. **Admin** — `CardapioAdminClient` (+9 actions, props) e `produtos/page.tsx` admin (desestruturar). *Fecha o build; o `enforcement-props-action-admin.test.ts` valida sem ser editado.*
8. **Gate** — `npx tsc --noEmit` → `npm run lint` → `npm test` → `npm run build`. O `build` não é opcional: `const` exportada em `'use server'` só quebra ali.
9. **`verificar` manual** — a lista de §"O que só o olho pega".

### Riscos

| Risco | Gravidade | Mitigação |
|---|---|---|
| **`sticky` inerte** por `overflow-hidden` do `Card` (`ui/card.tsx:15`) | **alta** — passa em todo teste e falha na tela | `cabecalhoFixo` também põe `overflow-visible` no `<Card>` (§7). Verificação **só** no browser |
| **`Escape` durante arrasto por teclado** fecha o modal | média | O `KeyboardSensor` do dnd-kit cancela o arrasto no `Escape`, mas não há garantia de `stopPropagation` até o `onOpenChange` do Dialog. A 216 blindou o `Escape` da confirmação inline (`LinhaItemOpcional.tsx:178,352`), **não** o do arrasto. Se o `verificar` confirmar, o fix é um `onKeyDownCapture` no corpo do modal enquanto `arrastando` — pequeno, mas **não é presumível daqui** |
| **Região viva do dnd-kit silenciada** | média (a11y) | O `DndContext` portala a própria live region para `document.body`; Base UI marca o resto do body como inerte/`aria-hidden` quando o Dialog é modal → os anúncios em pt-BR do arrasto (`ModoReordenar.tsx:528-550`) podem não sair. **Amortecido**: o cartão tem live region própria **dentro** da árvore (`ModoReordenar.tsx:454`) para marcar/desmarcar/mover/abrir, e `PainelItensDoGrupo` tem a dele. Só o anúncio *durante* o arrasto está em risco. Leitor de tela real, no `verificar` |
| **`DragOverlay` sob o backdrop** | baixa | Portal para `document.body` (`ModoReordenar.tsx:575-588`); `DialogContent` é `z-50` e o `DragOverlay` do dnd-kit sobe acima disso por padrão. Provável não-problema, mas é olho no `verificar` |
| **Perder associação de grupo vazio** | **alta**, silenciosa | Resolvida por construção com `buscarAssociacoesOpcional` (§3). Ao testar, **criar um grupo sem item e associá-lo** — é o caso que o filtro de `queries/produtos.ts:268` apaga |
| Foco ao fechar o modal | baixa | O focus-trap do Base UI devolve o foco ao gatilho. Confirmar que volta ao botão "Opcionais" **daquela** categoria |
| Regressão em `/painel/produtos/opcionais` pelo refactor dos passos 1-2 | média | Refactor puro; `OpcionaisClient.test.tsx` + `CartaoAssociacaoOpcionais.test.tsx` + `PainelItensDoGrupo.test.tsx` já cobrem, e os passos 1 e 2 fecham **antes** de qualquer código novo |
| Latência da page do painel | baixa | +2 queries **em paralelo** no `Promise.all`; nenhuma sequencializa. Mesmo par que `/painel/produtos/opcionais` já dispara |
| Escopo: a extração pura do passo 2 | baixa | Contido a 5 funções e um arquivo de teste. Alternativa (duplicar) foi rejeitada em §3 com o precedente da própria 216 |

### O que é testável AQUI vs. o que só o `verificar` pega

Sem Playwright e sem MCP de browser (issue 176), `environment: node`, sem jsdom.

**Prova automatizada (vale a pena escrever):**
- `derivar-associacao-opcionais.test.ts` — as 5 derivações, incluindo **grupo associado com zero itens continua marcado**. É o teste que trava o bug de §3
- `opcional.test.ts` — `revalidatePath` passa a ser chamado com `/painel/produtos`; `toHaveBeenCalledTimes` 2→3 nas linhas 255 e 481
- `CardapioAdminClient.test.tsx` — as 21 chaves injetadas e nenhuma caindo em fallback do lojista; o `enforcement-props-action-admin.test.ts` cobre a fronteira de graça
- `ProdutosClient.test.tsx` via `renderToStaticMarkup` — o modal fechado não renderiza o cartão; o botão "Opcionais" continua ausente no grupo "Sem categoria"; `SeletorOpcionaisCategoria` sumiu do markup
- `tsc` — a interseção de `AcoesProdutosClient` e a direção dos imports do módulo neutro

**Só o `verificar` humano, no browser (nenhum destes tem prova aqui):**
1. tela cheia no mobile e Dialog largo no desktop, **sem** faixa de scroll horizontal em 360px;
2. **o `sticky top-0` realmente grudando** — o item nº 1 da lista, pelo motivo de §7;
3. `Escape` em três estados: com a confirmação inline aberta, durante um arrasto por teclado, e parado;
4. arrasto por toque real dentro do modal (gesto de toque não é testável neste ambiente — memória de ferramentas);
5. anúncios de leitor de tela durante o arrasto;
6. foco voltando ao botão "Opcionais" ao fechar;
7. a travessia `/painel/produtos` → `/painel/produtos/opcionais` sem recarregar à mão;
8. a ordem gravada aparecendo em `/loja/[slug]`.

Loja-alvo autorizada para o teste: **"Lanches base"**.
