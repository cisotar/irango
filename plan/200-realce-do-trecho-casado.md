## Plano Técnico

### Análise do Codebase

**O que já existe e será reusado (nada disto se recria):**

- `src/lib/utils/buscarProdutos.ts` — `partirPorTermo(texto, termo)` (199, commits `29d4e9f`/`20f7ea8`) já resolve 100% do casamento: normaliza NFD → sem diacrítico → lowercase, mapeia índice-normalizado → índice-original e devolve `{ texto, casa }[]` da string **original** (acento preservado), com a invariante `partes.map(p => p.texto).join("") === texto`. **Esta issue não escreve uma linha de casamento de string**: só mapeia essas partes para nós React. Nunca construir `RegExp` a partir do termo (ReDoS/metacaractere — já documentado no topo do módulo).
- `src/lib/utils/buscarProdutos.test.ts` — já cobre acento, caixa, múltiplas ocorrências, combinante solto, termo vazio. O teste desta issue **não** re-testa casamento; testa só a projeção em DOM.
- `src/components/vitrine/CardProduto.tsx` — estender com prop opcional. Hoje renderiza `nome` em `<h3 className="line-clamp-2 ...">`; `descricao` está no contrato mas **não é renderizada** (ver "Divergência resolvida" abaixo). `alt` da `<Image>` e `aria-label` do botão usam `nome` como **string** — continuam string crua.
- `src/components/vitrine/ItemProdutoLista.tsx` — estender com prop opcional. `nome` em `<span className="max-w-[60%] ... truncate">`; `aria-label` da linha usa `nome` como string crua.
- `src/components/vitrine/SecaoCatalogo.tsx` — repassa `termo` aos dois filhos. `abrirModal` continua passando `produto.nome`/`produto.descricao` crus ao `ProdutoModal` (sem realce, fora de escopo).
- `src/components/vitrine/SecaoCatalogo.test.tsx` — padrão de teste já estabelecido: `renderToStaticMarkup` de `react-dom/server`, `environment: node`, sem jsdom. Os três `describe` existentes (086, toggle-imagens, 201) são a rede de regressão de "renderiza como antes".
- `src/app/globals.css` — tokens `--cinza-medio`, `--cor-destaque`, `--texto` já mapeados em `@theme inline` (`bg-cinza-medio`, `text-texto`, `var(--cor-destaque)`). **Zero token novo.**
- `src/components/ui/` (shadcn) — não se toca. Nada aqui precisa de primitivo shadcn: `<mark>` é HTML nativo.

**O que precisa ser criado e por quê:**

- `src/components/vitrine/TextoRealcado.tsx` — componente de apresentação puro (`texto`, `termo?`) que faz a projeção `partirPorTermo → nós React`. Justificativa de não reusar: não existe nada equivalente (`grep -rn "mark>\|realce\|highlight" src/` só acha `data-highlighted` do shadcn `menu.tsx` e os comentários de 199). Justificativa de não inlinar nos dois componentes: seriam duas cópias do mesmo `map` + das mesmas classes do `<mark>`; a segunda cópia diverge na primeira mudança de estilo. Um módulo, dois consumidores, um teste.

### Divergência resolvida: realce na descrição do `CardProduto`

O escopo da issue pede "realce em nome **e** descrição" no `CardProduto`, mas **o card não renderiza descrição** — `descricao` é prop morta desde sempre (`CardProduto.tsx:11`: *"Mantido no contrato; o design-claude não exibe descrição no card"*), e o mesmo arquivo declara "Truncamento, ellipsis ou mudança de layout do card" fora de escopo. Não se realça o que não está na tela.

**Decisão (A, adotada):** o realce cobre **`nome` no `CardProduto` e `nome` no `ItemProdutoLista`**. O escopo da issue é aparado para isto, com a justificativa registrada no próprio arquivo da issue.

**Rejeitado (B):** renderizar um `<p>` de descrição no card só quando o match veio dela. Introduz altura variável dentro de uma grade `grid-cols-2/3/4/6` (cards da mesma linha passam a ter alturas diferentes conforme o termo), muda o mockup aprovado e é exatamente a "mudança de layout do card" que a issue exclui.

**Consequência aceita e registrada:** produto que casou **só** pela descrição aparece no resultado sem `<mark>` visível. A perda é pequena — o produto continua no resultado e o cliente vê a descrição inteira ao abrir o `ProdutoModal`. Realce dentro do `ProdutoModal` é candidato a issue de follow-up (`specs/busca-e-navegacao-categorias-vitrine.md`, behavior "Ver por que o produto apareceu"), **não** parte desta.

### Cenários

**Caminho feliz**
1. `CatalogoVitrine` (202) tem `termo = "pao"` no estado e passa a `SecaoCatalogo`.
2. `SecaoCatalogo` já recebeu as categorias filtradas por `filtrarCatalogo` e repassa `termo` a cada `CardProduto`/`ItemProdutoLista`.
3. Cada componente monta `<TextoRealcado texto={nome} termo={termo} />` no elemento visível de nome.
4. `TextoRealcado` chama `partirPorTermo("Pão francês", "pao")` → `[{texto:"Pão",casa:true},{texto:" francês",casa:false}]`.
5. Render: `<mark class="...">Pão</mark>` + texto ` francês`. Acento preservado porque as fatias vêm da string **original**.

**Casos de borda**
- `termo` ausente / `""` / só espaços / só acento (`"´"` → normaliza para vazio): `TextoRealcado` retorna `texto` cru, sem `<mark>` e **sem fragmento** — a árvore React tem de ser idêntica à de hoje, não só o texto (em SSR real, `renderToString` insere `<!-- -->` entre text nodes irmãos; um `<>{partes.map(...)}</>` mudaria o HTML mesmo sem match). Early-return obrigatório.
- `termo` presente mas **sem match** no nome (casou pela descrição, ou o produto veio filtrado por descrição): `partirPorTermo` devolve um único segmento `casa:false` → mesmo early-return, texto cru, zero `<mark>`.
- `nome` vazio (`""`): `partirPorTermo` devolve `[]` → renderiza nada, sem quebrar (`h3`/`span` vazio, como hoje).
- `descricao: null`: não é tocada nesta issue.
- Múltiplas ocorrências ("pão de queijo com pão"): `partirPorTermo` já marca todas, não-sobrepostas, da esquerda para a direita — o `map` só reflete.
- Nome com `<`, `&`, aspas ou payload de XSS cadastrado pelo lojista (`<img src=x onerror=alert(1)>`): cada segmento é filho **texto** de JSX → escape automático do React. Nenhum caminho de `innerHTML`.
- Nome longo: o `<mark>` é `inline`; `line-clamp-2` (card) e `truncate` (lista) continuam funcionando porque nada vira `block` nem ganha `margin`.
- `<mark>` dentro do `truncate` da lista pode ser cortado pela ellipsis: comportamento aceito (é o comportamento de hoje para o nome inteiro).
- Termo que casa dentro da grade renderizada no servidor (RSC/SSR) e depois hidratada: `partirPorTermo` é puro e isomórfico (sem `Date`, sem `Math.random`, sem `window`) → mesma saída nos dois lados, sem hydration mismatch.

**Tratamento de erros**
Não há I/O, rede, banco nem `try/catch` novo nesta issue — não existe erro de runtime a mascarar. A regra de `seguranca.md` §14 (mensagem genérica na UI, detalhe só no log do servidor) segue valendo para o resto da vitrine, mas não gera código aqui. Um `throw` dentro do render seria bug de programação, não estado de erro de usuário: nenhum `ErrorBoundary` novo.

### Schema de Banco
**Nenhuma mudança.** Zero migration, zero tabela, zero política RLS nova. Confirmado em `specs/busca-e-navegacao-categorias-vitrine.md` ("Modelos de Dados") e por `references/schema.md`: `produtos.nome`/`produtos.descricao` já chegam à vitrine pelo caminho SSR existente (`buscarCatalogoPublico` sob role `anon`, escopado pela view `vitrine_lojas`). Nenhum campo novo trafega para o cliente.

### Validação (zod)
**Nenhum schema zod.** Não há formulário, nem Server Action, nem payload atravessando fronteira cliente→servidor nesta issue. `termo` é estado efêmero de UI (nasce na 202, morre no unmount): não é persistido, não vai para a URL, não é logado, não é enviado a lugar nenhum. Criar um schema zod aqui seria cerimônia sem invariante a proteger.

### Recálculo no Servidor
**Nenhum valor monetário é tocado.** `preco` continua exibido por `formatarMoeda` como **preview de UX** (RN-8) e continua recalculado a partir do banco pela Server Action de checkout (`seguranca.md` §10) — caminho intocado por esta issue. O realce não altera carrinho, cupom, frete nem total.

### Regra cliente ↔ servidor — onde cada invariante é garantida

| Invariante | Camada que garante | Nota |
|---|---|---|
| O cliente só pode realçar produto que o servidor mandou | **Servidor**: RLS + view `vitrine_lojas` + gate de assinatura em `page.tsx` (RN-1, já existentes) | O realce é estritamente cosmético sobre o payload SSR; manipular o JS no máximo pinta de amarelo o que já estava na tela |
| Nome/descrição (conteúdo de lojista, não confiável) não executam script | **Cliente, por construção**: só nós React, escape automático do JSX. `partirPorTermo` devolve `string`, nunca HTML (RN-9 / `seguranca.md` §15) | Reforçado por teste com payload de XSS e pelo `grep` do critério de aceite |
| Termo do cliente não vira seletor CSS, regex, URL nem `innerHTML` | **Cliente, por construção**: o termo só entra em `String.prototype.indexOf` dentro de `partirPorTermo` | Já garantido em 199; esta issue não amplia a superfície |
| Valor cobrado | **Server Action de checkout** (`seguranca.md` §10) | Não tocado |

Nenhuma regra de valor ou de permissão nasce nesta issue — é a única razão pela qual um plano 100% client-side está completo aqui.

### Estilo do `<mark>` (AA, zero token novo)

**Cuidado obrigatório:** o Preflight do Tailwind **não** reseta `<mark>`; sem classes explícitas o navegador aplica amarelo `#ff0`/preto, que não pertence à paleta e ignora o tema da loja. O `<mark>` precisa de `background` e `color` explícitos.

Classe proposta (uma só, dentro de `TextoRealcado`):
`rounded-[3px] bg-cinza-medio px-0.5 text-inherit underline decoration-2 underline-offset-2 decoration-[var(--cor-destaque)]`

- Fundo `--cinza-medio` (#eeeeee) e cor de texto **herdada** (`#111111` no card, `--texto` na lista) → contraste ≥ 11:1, **independente do tema da loja**. Isto respeita `design-system.md` §4/§5: texto **nunca** fica sobre cor derivada do tema, porque o lojista pode escolher uma `destaque` quase branca ou quase preta.
- O tema entra só como cor do **sublinhado** (decoração, não portadora de texto) → satisfaz WCAG 1.4.1 (a distinção não é só cor: há fundo + sublinhado) sem risco de contraste.
- `px-0.5` + `rounded-[3px]` e nenhuma mudança de `font-weight`/`display`: não desloca o texto, não quebra `line-clamp-2` nem `truncate`.
- Atenção ao `hover:bg-cinza-claro` da linha da lista: `--cinza-claro` (#f9f9f9) é mais claro que o `--cinza-medio` do mark, então o realce continua visível no hover. Por isso o mark usa `cinza-medio`, **não** `cinza-claro`.

### Arquivos a Criar / Modificar / NÃO tocar

**Criar**
- `src/components/vitrine/TextoRealcado.tsx` — `{ texto: string; termo?: string }`. Chama `partirPorTermo`, early-return do texto cru quando não há segmento com `casa: true`, e mapeia os segmentos para `<mark>`/texto. Key posicional (`indice`) é correta aqui: os segmentos são posicionais e a lista inteira é recriada a cada termo. Sem `'use client'` próprio (herda do consumidor; segue puro e isomórfico como `buscarProdutos.ts`).
- `src/components/vitrine/TextoRealcado.test.tsx` — `renderToStaticMarkup`: (a) `"Pão francês"` + `"pao"` → contém `<mark` e `Pão` dentro dele, com acento; (b) sem `termo` → HTML **idêntico** ao de `<>{texto}</>` renderizado cru, zero `<mark>`; (c) `termo` sem match → zero `<mark>`; (d) múltiplas ocorrências → dois `<mark>`; (e) texto `"<img src=x onerror=alert(1)>"` com `termo="img"` → saída contém `&lt;img` escapado e **nenhum** `<img` real; (f) invariante de conteúdo: remover todas as tags `<mark>`/`</mark>` do HTML devolve o texto original escapado.

**Modificar**
- `src/components/vitrine/CardProduto.tsx` — adiciona `termo?: string`; troca `{nome}` no `<h3>` por `<TextoRealcado texto={nome} termo={termo} />`. `alt={nome}` e `aria-label` do botão **continuam strings cruas** (atributo não aceita nó; e "Adicionar Pão francês ao carrinho" é o que o leitor de tela deve ouvir). Atualizar o comentário da prop `descricao` registrando que o realce de descrição ficou fora (decisão A).
- `src/components/vitrine/ItemProdutoLista.tsx` — adiciona `termo?: string`; troca `{nome}` no `<span>` por `<TextoRealcado ... />`. `aria-label="Ver detalhes de ..."` continua string crua.
- `src/components/vitrine/SecaoCatalogo.tsx` — adiciona `termo?: string` em `SecaoCatalogoProps` e repassa aos dois filhos nos dois ramos (grid e lista). Nada mais muda: `ancoraCategoria`, `ESTILO_ANCORA_CATEGORIA`, `abrirModal` e `confirmarAdicao` ficam como estão.
- `src/components/vitrine/SecaoCatalogo.test.tsx` — novo `describe("200 ...")`: (1) **regressão byte a byte** — `renderToStaticMarkup(<SecaoCatalogo categorias={fx} />)` deve ser **exatamente igual** a `renderToStaticMarkup(<SecaoCatalogo categorias={fx} termo="" />)` e nenhum dos dois pode conter `<mark`; (2) com `termo="pao"` e um produto "Pão na chapa" o HTML tem `<mark` com `Pão` dentro; (3) o ramo de lista (`exibir_imagens: false`) também realça; (4) os `aria-label`/`alt` seguem sem `<mark>` dentro.
- `tasks/200-realce-do-trecho-casado-no-card-e-na-lista.md` — escopo aparado (decisão A) + este plano.

**NÃO tocar**
- `src/lib/utils/buscarProdutos.ts` — o casamento está resolvido e testado na 199. Qualquer edição aqui é sinal de que o realce foi reimplementado.
- `src/components/ui/*` — gerado pelo shadcn CLI.
- `src/components/vitrine/ProdutoModal.tsx`, `CatalogoVitrine.tsx`, `medicaoBarraVitrine.ts`, `layoutVitrine.ts`, `HeaderLoja.tsx` — o estado do termo e a barra são 201/202/203.
- `src/app/(publica)/loja/[slug]/page.tsx` e qualquer query/Server Action — zero mudança de dado.
- `src/app/globals.css` — zero token novo.

### Dependências Externas
**Nenhuma.** Zero pacote npm novo, zero API externa, zero chamada de rede (cliente ou servidor), zero chave. Logo: **custo marginal R$ 0,00, nenhuma quota consumida** (Upstash, Nominatim/Google, Sentry, Vercel — nada é tocado; não há caminho de fail-closed a desenhar). `<mark>` é HTML nativo; `react-dom/server` já é dependência de teste. Impacto de bundle: um componente de ~30 linhas sem import novo além de `partirPorTermo`, que a 202 já puxa para a vitrine — orçamento do spec ("sem lib nova, sem dependência nova") respeitado.

### Ordem de Implementação
Issue **não-crítica** pelos três mandatos (zero dinheiro, zero RLS, zero Server Action de valor, zero auth) → **não** exige fase RED do `tdd`. O agente `executar` implementa e o `testar` fecha a cobertura.

1. `TextoRealcado.tsx` + `TextoRealcado.test.tsx` — a unidade isolada, sem depender de nenhum consumidor. Escrever o teste junto (não é RED formal, mas é barato e é onde o escape de XSS é provado).
2. `CardProduto.tsx` — consumidor mais simples, um único ponto de troca.
3. `ItemProdutoLista.tsx` — mesmo movimento no ramo de lista.
4. `SecaoCatalogo.tsx` — só depois de 2 e 3 existirem, senão o repasse não compila.
5. `SecaoCatalogo.test.tsx` — o teste de regressão byte a byte só faz sentido com a cadeia inteira fechada.
6. Gate local, na ordem do CI: `npx tsc --noEmit` → `npm run lint` → `npm test` → `npm run build`.
7. `grep -rn "dangerouslySetInnerHTML" src/components/vitrine/` → tem de sair vazio (critério de aceite).

A 202 consome `termo`; esta issue só o **aceita**. Entregue isolada, a vitrine renderiza exatamente como hoje (nenhum chamador passa `termo` ainda) — é o que o teste 1 do item 5 prova.
