# [209] Modo "Reordenar" dos opcionais dentro do cartão de categoria de produto

**crítica:** NÃO
**Mundo:** painel + hub admin
**Depende de:** [208]
**Spec:** specs/opcionais-sanfona-e-ordenacao.md (v0.2.0)

## Objetivo

Dar ao lojista o drag & drop dos grupos de opcional **dentro do cartão de cada categoria de
produto**, na seção "Opcionais por categoria de produto", chamando a Server Action entregue
na 208. Paridade no hub admin pela variante escopada por `lojaId`.

Não é crítica: nenhuma decisão de valor nem de permissão mora aqui. A ordem só é verdade
depois do servidor gravar (RN-3) — a lista já vem filtrada por RLS no SSR, e a autorização
foi provada na 208.

## Escopo

- [ ] `CartaoAssociacao` (dentro de
      `src/app/(painel)/painel/(bloqueavel)/produtos/opcionais/OpcionaisClient.tsx`):
      estado "modo reordenar" **por cartão**. Fora do modo, a grade de checkboxes de hoje;
      dentro do modo, a lista arrastável **só dos grupos marcados naquela categoria**.
      Botão "Reordenar" **desabilitado com menos de 2 grupos marcados** (nada a ordenar).
- [ ] `OpcionaisClientAcoes` (`OpcionaisClient.tsx:55`) ganha a chave
      **obrigatória** `reordenarOpcionaisDaCategoria` — **sem default**, padrão da issue 160:
      omitir tem que quebrar o build, não cair silenciosamente na action do lojista.
- [ ] `OpcionaisAdminClient.tsx`
      (`src/app/admin/assinantes/[lojaId]/produtos/opcionais/`) injeta
      `(payload) => reordenarOpcionaisDaCategoriaAdmin(lojaId, payload)`, como já faz com as
      8 actions existentes.
- [ ] Componente de reordenação em `src/components/painel/`:
      - envia sempre `categoria_id` + a **sequência completa de ids de grupo daquela
        categoria**, nunca um delta e **nunca número de `ordem`** (RN-4)
      - preview otimista via `moverPorDeslocamento` (deslocamento, não troca de pares)
      - teclado: `KeyboardSensor` + `sortableKeyboardCoordinates`, anúncio em pt-BR por
        `mensagemPosicao` ("Molhos movida para a posição 2 de 4")
      - salvamento coalescido (`criarSalvamentoCoalescido`, debounce 500 ms, fila, flush)
      - handle imperativo `finalizar()` (`useImperativeHandle`, como
        `ManipuladorReordenarCategorias` em `ReordenarCategorias.tsx:97`): sair do modo
        (Concluir / ESC) **aguarda o flush** antes de desmontar e de `router.refresh()`
      - falha → `toast` (sonner) com a mensagem genérica da action, **sem perder o estado
        local**
- [ ] **Decisão de arquitetura que esta issue tem que fechar antes de escrever o arquivo**
      (delegada pelo spec ao `planejar`): extrair o miolo genérico de
      `src/components/painel/ReordenarCategorias.tsx` (393 linhas) para um componente
      parametrizado por rótulo/linha, **ou** criar um irmão.
      Critério: se a duplicação passar de ~150 linhas de a11y/coalescência, **extrai**; se a
      extração exigir mexer no comportamento já entregue e testado da 175
      (`ReordenarCategorias.test.tsx`), **não extrai e registra o débito** em
      `architecture.md` §10. Duplicar ~380 linhas de acessibilidade em pt-BR é exatamente o
      que o mandato "não reinventar a roda" existe para evitar.
- [ ] `LinhaCategoriaReordenavel.tsx`: generalizar o prop para `{ id, nome, detalhe? }` se
      hoje tipar `Categoria` de produto. **Preservar as duas travas de a11y documentadas no
      cabeçalho do arquivo**: limites com `aria-disabled` + `onClick` no-op (nunca
      `disabled` real) e alvos de 44px literais.

## Fora de escopo

- Migration, RPC, schema zod, Server Actions, RN-12 → issue **208**.
- Sanfona do `ProdutoModal` e ordenação da vitrine → issue **210**.
- **A "Biblioteca de opcionais" não muda** — não tem contexto de categoria de produto e
  portanto não tem ordem a definir (Decisão D-1). O texto de apoio que explica a
  divergência painel × vitrine é mitigação registrada no spec, não escopo desta issue.
- Drag & drop dos itens dentro de um grupo — v2.

## Reuso esperado

- `src/lib/utils/reordenar.ts` — `moverPorDeslocamento`, `mensagemPosicao`. **Já coberto por
  `reordenar.test.ts`: reusar, não recriar e não reteste.**
- `src/lib/utils/salvamento-coalescido.ts` — `criarSalvamentoCoalescido`
- `src/components/painel/ReordenarCategorias.tsx` — padrão a espelhar ou a extrair
- `src/components/painel/LinhaCategoriaReordenavel.tsx` — reuso, generalizado
- `@dnd-kit` (`DndContext`, `SortableContext`, `PointerSensor`, `KeyboardSensor`) — já em
  `package.json`
- `Card`, `CardContent`, `Button`, `Badge`, `Separator`, `toast` (sonner) — primitivos
  existentes. **`components/ui/` é gerado pelo shadcn CLI: não editar à mão.**

## Segurança

- Sem valor monetário e sem tabela nova. Nenhuma política RLS tocada.
- O cliente manda **ids**, nunca `ordem`; o escopo (`loja_id`) é derivado no servidor. Se
  esta issue precisar mandar qualquer outra coisa para a action, é sinal de erro de desenho
  — a action da 208 não deve mudar.
- Falha de salvamento mostra **uma** mensagem genérica na UI; detalhe fica no log do
  servidor.

## Critério de aceite

- [ ] Com 2+ grupos marcados numa categoria de produto, o botão "Reordenar" troca a grade de
      checkboxes pela lista arrastável dos marcados; com 0 ou 1, fica desabilitado
- [ ] Arrastar reordena a lista local imediatamente e agenda um salvamento coalescido com a
      sequência completa de ids
- [ ] Mover por teclado (espaço + setas) funciona e anuncia a posição em pt-BR
- [ ] Sair do modo (Concluir / ESC) aguarda o flush antes do `router.refresh()` — o último
      movimento não se perde
- [ ] Erro da action → toast genérico, estado local preservado
- [ ] Omitir `reordenarOpcionaisDaCategoria` em `OpcionaisClientAcoes` **quebra o build**
- [ ] Teste de render sem jsdom (`renderToStaticMarkup`) do cartão nos dois modos
- [ ] `npx tsc --noEmit`, `npm run lint`, `npm test`, `npm run build` verdes
- [ ] Checkpoint humano (não há Playwright nem MCP de browser nesta máquina): arrastar por
      toque no celular em "Lanches base", recarregar e ver a ordem mantida

## Plano Técnico

### Decisão de arquitetura — EXTRAIR (com prova mecânica)

**Contagem real, não estimativa** (`awk` sobre `src/components/painel/ReordenarCategorias.tsx`,
393 linhas, 366 não-vazias):

| Bloco | Linhas não-vazias | Genérico? |
|---|---|---|
| imports (1–43) | 41 | ~35 genéricas |
| doc-comment do modo (45–82) | 38 | reescrito, não duplicado |
| lógica (84–291) | 190 | 176 genéricas (−10 props `contagemPorCategoria`/`temSemCategoria`, −4 da mensagem inicial) |
| JSX (293–391) | 95 | 73 genéricas (−21 do bloco "Sem categoria", −1 do `totalProdutos`) |

**Duplicação se eu criar um irmão: 249 linhas** de acessibilidade/coalescência
(176 + 73), ou ~284 contando imports. O critério da issue é ~150. **249 > 150 → extrai.**

O que é exatamente essa duplicação, por bloco: `INSTRUCOES_LEITOR` (8), tipo do handle (8),
estado + `ordemRef` sincronizado por efeito (13), máquina `criarSalvamentoCoalescido` com
`aoFalhar`/revert para a confirmada (33), `useImperativeHandle` (4), flush de último recurso na
desmontagem (8), `mover` com o no-op por identidade de referência (39), sensores (8),
`posicaoDe`/`nomeDe` (8), `anuncios` pt-BR do dnd-kit (26), handlers de arrasto (14),
região viva `sr-only` fora do `<ol>` (9), `DndContext`/`SortableContext`/`<ol>` (27),
`DragOverlay` em portal com guard de SSR (21), linha de status agregado (10).

**Segundo critério — a extração NÃO mexe no comportamento entregue da 175.**
`src/components/painel/ReordenarCategorias.test.tsx` tem **13 casos** (contados: `grep -c "it("`
= 13) e trava:

1. `[C10]` categoria vazia aparece com "0 produtos" (4/0 produtos)
2. singular "1 produto"
3. posição visível (`1.`, `2.`, `3.`)
4. `[C8]` ↑ da primeira e ↓ da última usam `aria-disabled`, **nunca** `disabled` real
5. `[C8]` no meio da lista as duas setas ficam `aria-disabled="false"`
6. `aria-label` não carrega a posição (evita re-anúncio)
7. `[C5]` "Sem categoria" no fim, sem alça e sem setas
8. `[C5]` sem produtos soltos, "Sem categoria" não renderiza
9. região viva única, `sr-only`, fora do `<ol>` (exatamente um `aria-live="polite"`)
10. "Modo reordenar ativado. 3 categorias."
11. alvos de toque 44px **literais** (`min-h-[44px]`, e nunca `min-h-11`)
12. alça nomeada por categoria (`aria-label="Reordenar Pizzas"`)
13. kebab por categoria (`aria-haspopup="menu"`)

Os 13 são asserções sobre **markup**, e o desenho abaixo mantém o markup **byte-idêntico**:
`ReordenarCategorias` continua exportado, com a mesma assinatura de props, e vira uma casca
que injeta `itens`, `mensagemInicial` e um `rodape` no genérico. Nada em `ProdutosClient.tsx`
muda. **Portanto o arquivo de teste não é editado** — e isso é o *gate* da extração (ver Ordem
de Implementação, passo 0/2): se qualquer um dos 13 pedir edição, **aborta a extração**, cai no
irmão `ReordenarOpcionaisDaCategoria` e registra o débito em `architecture.md` §10.

### Análise do Codebase — o que já existe e será reusado

- `src/lib/utils/reordenar.ts` — `moverPorDeslocamento` (no-op por identidade de referência) e
  `mensagemPosicao`. **Coberto por `reordenar.test.ts`: reusar, não recriar, não reteste.**
  Nota de idioma: `mensagemPosicao` fixa "movida". Para grupo de opcional o certo seria
  "movido", mas o spec §Opcionais do lojista já grafa "Molhos movida para a posição 2 de 4" —
  **manter como está**; mudar a função quebraria 175 por ganho nulo.
- `src/lib/utils/salvamento-coalescido.ts` — `criarSalvamentoCoalescido` (debounce 500 ms, fila
  de profundidade 1, serialização, `finalizar()`, revert para a última ordem confirmada,
  `ERRO_GENERICO` = "Não foi possível salvar a ordem."). Reuso direto, zero mudança.
- `src/components/painel/LinhaCategoriaReordenavel.tsx` (188 linhas) — `useSortable`, alça
  44×44 com `touchAction: none`, setas com `aria-disabled` + `onClick` no-op, kebab
  topo/fim. Único importador hoje é `ReordenarCategorias.tsx`. Generalizar o prop
  `totalProdutos: number` → `detalhe?: string`.
- `src/components/painel/ReordenarCategorias.tsx` — vira casca do genérico extraído.
- `src/lib/actions/opcional.ts:396` `reordenarOpcionaisDaCategoria(payload)` e
  `src/app/admin/assinantes/actions/admin-opcionais.ts:445`
  `reordenarOpcionaisDaCategoriaAdmin(lojaId, payload)` — **entregues na 208, não tocar.**
- `src/lib/validacoes/opcional.ts:58` `schemaReordenacaoOpcionaisDaCategoria` —
  `categoria_id` guid + `categoria_opcional_id` array de guid `.min(2).max(200)` sem
  duplicata, `.strict()`. **Não tocar.** O `.min(2)` é a contraparte servidor do botão
  desabilitado com <2 marcados.
- `src/lib/supabase/queries/opcionais.ts` `buscarAssociacoesOpcional` — já faz `select("*")`,
  então `ordem` (coluna da 208) **já vem do banco**; falta ordenar e falta propagar (ver abaixo).
- `@dnd-kit/core` + `@dnd-kit/sortable` + `@dnd-kit/utilities`, `sonner`, `Card`,
  `CardContent`, `Button`, `Checkbox` — já em uso no arquivo/`package.json`.
- Padrão de saída do modo: `ProdutosClient.tsx:274-303` (`sairDoModoReordenar` com guard de
  reentrância `saindoDoModoRef`, `await finalizar()` → desmonta → `router.refresh()`, e o
  listener de ESC). **Espelhar, não inventar.**

O que precisa ser criado e por quê:
- `ModoReordenar.tsx` — porque as 249 linhas acima não têm hoje um lugar compartilhado.
- `ReordenarOpcionaisDaCategoria.tsx` — casca de ~45 linhas que fixa `categoria_id` no payload;
  não dá para reusar `ReordenarCategorias` direto porque a action tem outra forma de payload
  (`{ categoria_id, categoria_opcional_id }` vs. `string[]`).

### Buraco de dados que a issue não previu (bloqueante)

A `ordem` da 208 **não chega ao cliente**. As duas pages estreitam a associação para
`{ categoria_id, categoria_opcional_id }`, descartando `ordem`:

- `src/app/(painel)/painel/(bloqueavel)/produtos/opcionais/page.tsx` (map de `associacoes`)
- `src/app/admin/assinantes/[lojaId]/produtos/opcionais/page.tsx` (mesmo map)
- `OpcionaisClient.tsx:44` `type Associacao = { categoria_id; categoria_opcional_id }`

Sem `ordem`, a lista do modo reordenar abriria numa ordem arbitrária e o primeiro arrasto
gravaria uma permutação que o lojista não pediu. Correção mínima:

1. `buscarAssociacoesOpcional` ganha `.order("ordem", { ascending: true })` seguido de
   `.order("categoria_opcional_id", { ascending: true })` (desempate determinístico — as linhas
   pré-208 nasceram todas com `ordem = 0` e sem o desempate o SSR e o cliente poderiam divergir
   entre requisições). É a mesma convenção de `buscarCategoriasOpcional`.
2. `type Associacao` vira `{ categoria_id: string; categoria_opcional_id: string; ordem: number }`
   e as duas pages passam `ordem: a.ordem` no map.

Nenhum dos dois toca RLS, schema ou action.

### Cenários

**Caminho feliz**
1. O lojista abre `/painel/produtos/opcionais` e vê o cartão de uma categoria de produto com a
   grade de checkboxes de hoje e, na barra de ações do cartão, "Salvar" + "Reordenar".
2. Com ≥2 grupos marcados **e já salvos**, "Reordenar" está ativo. Clica.
3. A grade some; entra a lista `<ol>` **só dos grupos marcados**, na ordem vinda do servidor
   (`ordem` asc), com alça, número da posição, setas ↑/↓ e kebab topo/fim. A barra passa a
   mostrar "Concluir".
4. Arrasta (ou usa ↑/↓/kebab/teclado): `moverPorDeslocamento` reordena o estado local na hora,
   a região viva anuncia "Molhos movida para a posição 2 de 4." e `agendar` marca o salvamento.
5. 500 ms depois, uma única chamada leva `{ categoria_id, categoria_opcional_id: [ids na ordem] }`.
   Status agregado mostra "Salvando ordem…" → "Ordem salva".
6. "Concluir" (ou ESC): `await finalizar()` → sai do modo → `router.refresh()`. A grade volta e a
   nova ordem já é a do servidor.

**Casos de borda**
- **0 ou 1 grupo marcado** → "Reordenar" desabilitado (`aria-disabled` não; aqui `disabled` real
  é correto, pois o botão não está numa lista com foco a preservar) e o motivo dito na tela, não
  escondido. Contraparte servidor: `.min(2)` do zod.
- **Nenhuma categoria de opcional na loja** → o ramo "Crie categorias de opcional…" de hoje
  continua, e o botão nem aparece.
- **Seleção com alteração não salva** (marcou/desmarcou e não clicou em "Salvar") →
  "Reordenar" **desabilitado**, com o texto "Salve a associação antes de reordenar.". Motivo
  duro: um grupo recém-marcado ainda **não tem linha** em `categoria_produto_opcionais`; mandá-lo
  no payload faria a RPC da 208 (que exige a permutação COMPLETA e confere `row_count`) derrubar
  a transação e devolver erro genérico — atrito sem causa visível. A comparação é de conjunto:
  `selecionados` × ids persistidos vindos das props.
- **Falha de rede / erro da action** → `aoFalhar` reverte para a última ordem **confirmada**
  (não para o passo anterior), a região viva diz "A lista voltou à ordem anterior." e um `toast.error`
  mostra a mensagem genérica. O modo **não** desmonta e o estado local não some.
- **ESC repetido / duplo clique em "Concluir"** → guard de reentrância por `useRef`, como em
  `ProdutosClient.tsx:284`.
- **Sair do modo antes dos 500 ms** → `finalizar()` dispara o pendente e só então o
  `router.refresh()` roda; sem isso, o refresh traria a ordem velha por cima.
- **Dois cartões em modo reordenar ao mesmo tempo** → permitido; cada cartão tem seu próprio
  estado, sua própria máquina de salvamento e seu próprio listener de ESC (registrado só enquanto
  aquele cartão está no modo). Os payloads são disjuntos por `categoria_id`.
- **Grupo removido por outra aba enquanto o modo está aberto** → a RPC derruba a transação por
  `row_count`, cai no revert + toast genérico; o `router.refresh()` da saída reconcilia.

**Tratamento de erros** — uma única mensagem genérica na UI
("Não foi possível salvar a ordem.", já constante da action e do `salvamento-coalescido`).
Detalhe fica no `console.error` do servidor (`seguranca.md` §14): mensagem distinta por causa
viraria oráculo de existência de id.

### Convivência entre o modo checkbox e o modo reordenar (RN-12)

A pergunta é o que acontece com a lista local quando o lojista **sai do modo, marca um grupo novo
e volta**. O desenho resolve isso em três travas, não em sincronização de estado:

1. **Os dois modos nunca coexistem no mesmo cartão.** Dentro do modo reordenar a grade de
   checkboxes não é renderizada, então não há como alterar a associação durante um arrasto.
2. **A lista do modo é derivada, não persistida.** `ReordenarOpcionaisDaCategoria` é **montado ao
   entrar no modo e desmontado ao sair** (mesmo desenho de `ReordenarCategorias`: não existe
   `useState` de ligado/desligado dentro dele). No mount ele captura
   `grupos = categoriasOpcional.filter(marcado).sort(por ordem do servidor)`. Não há lista local
   sobrevivendo entre as entradas no modo — logo não há o que atropelar.
3. **A ordem do servidor é a única fonte.** `selecionados` é estado local do cartão; `ordem` vem
   sempre das props (memo derivado de `associacoes`), nunca de estado. Sair do modo faz
   `router.refresh()`, as props chegam com a `ordem` recém-gravada e o próximo mount lê a verdade.

Com isso, o roteiro do enunciado fica:

- sai do modo → `finalizar()` grava a ordem → `refresh()` → props trazem `ordem` 0..n−1;
  `selecionados` (estado) não é resetado pelo refresh, e não precisa ser — a associação não mudou;
- marca um grupo novo → só `selecionados` muda; nada foi gravado. "Reordenar" fica **desabilitado**
  (borda "alteração não salva"), o que impede exatamente a chamada que a RPC rejeitaria;
- clica "Salvar" → `salvarAssociacaoOpcionais` faz o **delta** da 208
  (`planejarAssociacaoOpcionais`): quem permanece **não é tocado e mantém a `ordem`**; o novo é
  inserido com `ordem` no fim. `onSalvo()` → `router.refresh()`;
- volta ao modo → o mount lê as props novas: os antigos na mesma ordem, o novo **por último**.
  Exatamente o que a RN-12 promete, sem nenhuma reconciliação no cliente.

### Schema de Banco

**Nada.** A coluna `categoria_produto_opcionais.ordem`, a RPC `reordenar_opcionais_da_categoria`
e as políticas RLS `cat_prod_opc_*` foram entregues e aplicadas no cloud pela 208. Esta issue
não cria migration nem toca política.

### Validação (zod)

Nenhum schema novo. `schemaReordenacaoOpcionaisDaCategoria` (`lib/validacoes/opcional.ts:58`)
já é o schema único: o cliente não valida nada além do gate de UX (≥2 marcados e sem alteração
pendente); a autoridade é o `safeParse` dentro das duas Server Actions, que devolve um objeto
novo e descarta propriedade hostil pendurada no payload.

### Recálculo no Servidor / camada que garante cada invariante

Nenhum valor monetário nesta issue. As invariantes de permissão e integridade continuam todas no
servidor, entregues pela 208 — esta issue **não pode** introduzir nenhuma nova:

| Invariante | Onde é garantida |
|---|---|
| Só reordenar grupos da própria loja | RLS `cat_prod_opc_escrita_propria` + RPC `security invoker` |
| `loja_id` do payload é ignorado | `buscarLojaDoDono(auth.uid())` na action; `.strict()` no zod |
| `categoria_id` (único parâmetro de escopo vindo do cliente) é da loja | `categoriaProdutoPertenceALoja` antes da RPC (RN-5b) |
| `ordem` nunca vem do cliente | derivada de `ordinality - 1` dentro da RPC |
| Permutação completa, sem id alheio/duplicado | conferência de `row_count` dentro da transação da RPC |
| Mínimo de 2 ids | `.min(2)` no zod (o botão desabilitado é só UX) |
| Via admin | `validarLojaIdAdmin` + `verificarAdminSaaS` antes de elevar a `service_role` |

Tudo o que esta issue escreve roda com `'use client'`; a única escrita sai pelas actions da 208.

### Arquivos a Criar

- `src/components/painel/ModoReordenar.tsx` — o miolo genérico extraído. Assinatura:
  ```ts
  export type ItemReordenavel = { id: string; nome: string; detalhe?: string };
  export type ManipuladorModoReordenar = { finalizar: () => Promise<void> };
  export type ModoReordenarProps = {
    /** Itens na ordem atual, já filtrados pelo pai. */
    itens: readonly ItemReordenavel[];
    /** Recebe a SEQUÊNCIA COMPLETA de ids. Quem monta o payload da action é o chamador. */
    onReordenar: (ids: string[]) => Promise<ResultadoSalvamento>;
    /** Primeira frase da região viva, ex.: "Modo reordenar ativado. 3 categorias. …" */
    mensagemInicial: string;
    /** Linha fixa NÃO ordenável no fim do <ol> (hoje só o "Sem categoria" de produtos). */
    rodape?: ReactNode;
    ref?: Ref<ManipuladorModoReordenar>;
  };
  ```
  `ResultadoSalvamento` já existe em `lib/utils/salvamento-coalescido.ts` e é estrutural
  (`{ ok: true } | { ok: false; erro: string }`) — as duas actions do lojista e as duas admin são
  atribuíveis a ele sem cast. **Confirmar isso no `tsc` do passo 2; se não for, a correção é
  alargar o tipo do parâmetro, nunca fazer cast.**
- `src/components/painel/ReordenarOpcionaisDaCategoria.tsx` (~45 linhas) — casca que fixa
  `categoria_id`:
  ```ts
  export type ReordenarOpcionaisDaCategoriaProps = {
    categoriaProdutoId: string;
    grupos: readonly { id: string; nome: string; totalItens: number }[];
    onReordenar: typeof reordenarOpcionaisDaCategoriaLojista;   // sem default (160)
    ref?: Ref<ManipuladorModoReordenar>;
  };
  ```
  Monta `itens` com `detalhe` = `"N itens"` / `"1 item"`, `mensagemInicial` =
  `` `Modo reordenar ativado. ${n} grupos de opcional. Use os botões mover para cima e mover para baixo.` ``,
  sem `rodape`, e `onReordenar={(ids) => onReordenar({ categoria_id: categoriaProdutoId, categoria_opcional_id: ids })}`.
- `src/components/painel/ReordenarOpcionaisDaCategoria.test.tsx` — `renderToStaticMarkup`, sem
  jsdom. Cobre: uma `<li>` por grupo com posição visível; região viva única e fora do `<ol>`;
  `aria-disabled` nos limites e nenhum `disabled` real; alvos `min-h-[44px]`; alça
  `aria-label="Reordenar Molhos"`; `detalhe` com "1 item"/"3 itens"; a mensagem de entrada com
  o total de grupos.

### Arquivos a Modificar

- `src/components/painel/ReordenarCategorias.tsx` — **393 → ~70 linhas.** Vira casca:
  mantém os mesmos exports (`ReordenarCategorias`, `ReordenarCategoriasProps` e
  `ManipuladorReordenarCategorias`, este último como alias de `ManipuladorModoReordenar` para não
  tocar `ProdutosClient.tsx`), o mesmo doc-comment sobre "de onde a lista vem", e delega ao
  `ModoReordenar` passando `itens` (com `detalhe` = `"N produtos"`/`"1 produto"`),
  `mensagemInicial` **string idêntica à de hoje** e `rodape` = o `<li>` "Sem categoria" movido
  verbatim. Markup resultante byte-idêntico.
- `src/components/painel/LinhaCategoriaReordenavel.tsx` — `totalProdutos: number` →
  `detalhe?: string`, renderizado no mesmo `<span className="text-xs text-muted-foreground">`
  (omitido quando ausente). **Preservar as duas travas do cabeçalho**: `aria-disabled` +
  `onClick` no-op (nunca `disabled` real) e `ALVO_TOQUE` com 44px literais. Renomear arquivo e
  componente para `LinhaReordenavel` é opcional e fica **fora** desta issue (churn sem ganho de
  comportamento; o único importador hoje é o `ModoReordenar`).
- `src/app/(painel)/painel/(bloqueavel)/produtos/opcionais/OpcionaisClient.tsx`:
  - `OpcionaisClientAcoes` ganha a 9ª chave **obrigatória, sem default**:
    `reordenarOpcionaisDaCategoria: typeof reordenarOpcionaisDaCategoria` (import `type` de
    `@/lib/actions/opcional`, como as outras 8).
  - `type Associacao` ganha `ordem: number`.
  - `AssociacaoOpcionais`: além do `inicialPorProduto`, um memo
    `ordemPorProduto: Map<categoria_id, Map<categoria_opcional_id, ordem>>` repassado ao cartão.
  - `CartaoAssociacao`: estado `modoReordenar`, `reordenarRef`, `saindoDoModoRef`, `sairDoModo`
    (`await finalizar()` → `setModoReordenar(false)` → `onSalvo()`), listener de ESC guardado por
    `modoReordenar` — tudo espelhando `ProdutosClient.tsx:274-303`. Renderiza a grade **ou** a
    lista. Botões: "Salvar" + "Reordenar"/"Concluir". Gate do "Reordenar":
    `selecionados.size >= 2 && !temAlteracaoNaoSalva`.
- `src/app/admin/assinantes/[lojaId]/produtos/opcionais/OpcionaisAdminClient.tsx` — injeta a 9ª:
  `reordenarOpcionaisDaCategoria: (payload) => reordenarOpcionaisDaCategoriaAdmin(lojaId, payload)`.
- `src/app/(painel)/painel/(bloqueavel)/produtos/opcionais/page.tsx` — passa a 9ª action do
  lojista e `ordem: a.ordem` no map de `associacoes`.
- `src/app/admin/assinantes/[lojaId]/produtos/opcionais/page.tsx` — `ordem: a.ordem` no map.
- `src/lib/supabase/queries/opcionais.ts` — `buscarAssociacoesOpcional` ganha
  `.order("ordem").order("categoria_opcional_id")`.
- `src/app/(painel)/painel/(bloqueavel)/produtos/opcionais/OpcionaisClient.test.tsx` — **edição
  obrigatória e esperada**: os dois objetos `acoes` do teste têm 8 chaves; sem a 9ª o arquivo não
  compila. Isso é a *prova* do critério "omitir quebra o build". O teste de igualdade byte-a-byte
  entre a injeção lojista e a admin continua válido (o cartão renderiza fora do modo no SSR).
- `src/app/admin/assinantes/[lojaId]/carga-opcionais.test.ts` — conferir se alguma asserção fixa a
  ausência de `.order` em `categoria_produto_opcionais`; ajustar só se quebrar.

### Arquivos a NÃO tocar

- `src/components/painel/ReordenarCategorias.test.tsx` — **gate da extração.** Roda sem edição.
- `src/lib/utils/reordenar.ts` e `salvamento-coalescido.ts` (+ seus testes) — já cobertos.
- `src/lib/actions/opcional.ts`, `src/app/admin/assinantes/actions/admin-opcionais.ts`,
  `src/lib/validacoes/opcional.ts` — contrato da 208 congelado. Precisar mudar aqui = erro de
  desenho desta issue.
- `supabase/migrations/**`, `src/lib/database.types.ts` — nada de schema nesta issue.
- `src/components/ui/**` — gerado pelo shadcn CLI.
- `src/app/(painel)/painel/(bloqueavel)/produtos/ProdutosClient.tsx` — a casca preserva os
  exports; se este arquivo precisar mudar, a extração vazou.
- A "Biblioteca de opcionais" (`BibliotecaOpcionais`, `FormCategoriaOpcional`, `FormOpcional`) —
  Decisão D-1.

### Dependências Externas

**Nenhuma nova.** `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities`, `sonner`, `lucide-react`
e `@base-ui/react` já estão no `package.json` e já são usados por `ReordenarCategorias`/
`LinhaCategoriaReordenavel`. Sem chamada de API externa, sem quota, sem custo variável: a única
escrita é a RPC no Supabase já contabilizada pela 208, e o debounce de 500 ms com fila de
profundidade 1 é justamente o que impede uma rajada de escritas por arrasto.

### Limites do ambiente (dizer no PR, não simular com teste que não roda)

Vitest roda com `environment: node`, sem jsdom, sem Playwright e sem MCP de browser nesta
máquina. Portanto **não são testáveis aqui** e vão para o checkpoint humano:
o **gesto de arrasto por toque** (pointer events, `DragOverlay`, detecção de colisão, o
`touch-action: none` da alça), a **temporização do debounce dentro do componente** (a regra em si
já está coberta por `salvamento-coalescido.test.ts` com timers falsos), o **anúncio real em leitor
de tela**, o **movimento de foco** pós-reordenação e a **abertura do kebab** (o popup do Base UI só
monta com DOM real). O que os testes provam é derivação de estado → HTML.

Checkpoint humano: em "Lanches base", marcar 3 grupos numa categoria, salvar, reordenar por toque
no celular, recarregar e ver a ordem mantida — e conferir a mesma ordem na vitrine.

### Ordem de Implementação

Issue **não crítica** (nenhuma decisão de valor ou de permissão mora no cliente; a autorização foi
provada na 208), então **não há fase RED obrigatória**. A ordem abaixo é ditada por dependência e
pelo gate da extração.

0. **Baseline.** `npx vitest run src/components/painel/ReordenarCategorias.test.tsx` — 13 verdes
   **antes** de qualquer edição. Guardar o output.
1. **Dados primeiro** (tudo depois depende da `ordem` chegar ao cliente): `.order` em
   `buscarAssociacoesOpcional`, `Associacao` com `ordem`, os dois maps das pages.
2. **Extração pura, sem feature nova**: criar `ModoReordenar.tsx`, generalizar
   `LinhaCategoriaReordenavel` para `detalhe`, reduzir `ReordenarCategorias` a casca.
   **Gate:** rodar o mesmo comando do passo 0 **sem tocar no arquivo de teste** — 13 verdes.
   Se algum exigir edição, **reverter a extração**, criar o irmão
   `ReordenarOpcionaisDaCategoria` autocontido e registrar o débito em `architecture.md` §10.
3. `ReordenarOpcionaisDaCategoria.tsx` + seu teste de markup.
4. 9ª chave em `OpcionaisClientAcoes` (sem default) e as duas injeções (page do painel,
   `OpcionaisAdminClient`) — **fazer a chave antes das injeções** para ver o build quebrar e
   confirmar o critério de aceite da issue 160.
5. `CartaoAssociacao`: modo, gate do botão, saída com `finalizar()` + ESC.
6. Ajustar `OpcionaisClient.test.tsx` (9ª chave) e conferir `carga-opcionais.test.ts`.
7. Gates: `npx tsc --noEmit` → `npm run lint` → `npm test` → `npm run build`
   (o `build` é o único que pega export inválido em módulo `'use server'`).
8. Checkpoint humano no celular.
