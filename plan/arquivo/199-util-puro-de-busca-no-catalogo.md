## Plano Técnico

### Análise do Codebase

**O que já existe e será reusado:**

- `src/components/vitrine/SecaoCatalogo.tsx:18-41` — exporta `ProdutoCatalogo` e `CategoriaComProdutos`. **Importar via `import type`**, não redeclarar. `CategoriaComProdutos` tem `id: string | null`, `nome`, `exibir_imagens?: boolean`, `produtos: ProdutoCatalogo[]`; `ProdutoCatalogo` tem `nome: string` e `descricao: string | null` (o corpus da busca). `import type` é apagado na emissão (`isolatedModules` + `verbatimModuleSyntax` ausente), então importar de um módulo `'use client'` dentro de `lib/utils/` **não** arrasta runtime nem diretiva.
- `vitest.config.ts` — `environment: node`, `globals: true`, `include: ["src/**/*.{test,spec}.{ts,tsx}"]`. Teste ao lado do módulo já é o padrão (79 arquivos em `src/lib/utils/`). Nada a configurar.
- `src/lib/utils/fotoSegura.test.ts` — modelo de estilo de teste: `import { describe, expect, it } from "vitest"`, import relativo `./modulo`, `describe` nomeando o contrato, comentário no topo dizendo o que o arquivo trava.
- `tsconfig.json` — `target: ES2017`, mas `/\p{Diacritic}/gu` já é usado em produção em `src/lib/utils/calcularFrete.ts:60` e passa no `tsc --noEmit`. Sem risco de sintaxe.

**Normalizações já existentes — inventariadas e NÃO reusadas, com justificativa:**

| Existente | Por que não serve |
|---|---|
| `normalizarBairro` (`src/lib/utils/calcularFrete.ts:57`) — `trim → NFD → strip diacrítico → lowercase → colapsa espaços internos` | Semanticamente é 90% do que a busca precisa, **mas**: (a) colapsa espaço interno, o que quebra o alinhamento de índice exigido por `partirPorTermo` (ver "Armadilha central"); (b) RN-2 do spec define a sequência **sem** colapso; (c) importar `calcularFrete.ts` a partir de um util consumido pela vitrine acopla o bundle público ao módulo de frete por uma função de 6 linhas. **Decisão: duplicar as 4 linhas com comentário cruzado nos dois arquivos.** Não extrair um `normalizarTexto` compartilhado agora — o terceiro caso de uso é que justifica a extração, não o segundo. |
| `sanitizarSlug` (`src/lib/validacoes/loja.ts:94`) | Gera slug: troca não-alfanumérico por hífen e colapsa hífens. Destrói o texto. Confirmado no spec §Modelos de Dados. Não tentar reusar nem mover. |
| `normalizarObservacao` / `canonizarObservacao` (`src/lib/utils/normalizarObservacao.ts`) | Higiene Unicode de texto livre do comprador (controles C0/C1, bidi, Trojan Source) para render **fora** do React (`seguranca.md` §15-B). Escopo e invariantes diferentes. Não aplicável aqui — ver §Segurança. |

**Nenhuma lib nova.** Não existe `fuse.js`, `match-sorter` nem `remove-accents` em `package.json`, e o spec descarta fuzzy explicitamente (Fora do Escopo v1). `String.prototype.normalize` + `indexOf` cobrem o requisito inteiro. Instalar dependência aqui seria o oposto do mandato 2.

---

### Armadilha central: NFD desalinha o índice (o motivo de este módulo existir)

O escopo da issue diz "offsets calculados sobre a string normalizada mas aplicados à original". **Isso só é seguro se a normalização preservar o comprimento — e ela não preserva.** Verificado em `node`:

```
"Pão"        (NFC, 3 chars) -> "pao"  (3)  OK
"Pão"  (NFD, 4 chars) -> "pao"  (3)  DESALINHA
```

Nome de produto digitado pelo lojista num teclado macOS/iOS chega frequentemente em **NFD** do banco. Uma implementação ingênua (`normalizada.indexOf(termo)` + `original.slice(i, i + termo.length)`) corta no lugar errado e o `<mark>` da issue 200 aparece deslocado — bug silencioso, invisível em teste com string ASCII. `toLowerCase()` também pode expandir (`İ` → `i̇`).

**Solução obrigatória:** normalizar **code point a code point**, construindo um mapa `índice normalizado → índice original`.

```ts
// interno, não exportado
function normalizarComMapa(texto: string): { alvo: string; mapa: number[] } {
  let alvo = "";
  const mapa: number[] = [];
  for (const cp of texto) {                  // itera por code point, não por UTF-16 unit
    const n = normalizarBusca(cp);           // NFD → strip → lower (sem trim relevante em 1 cp)
    for (let k = 0; k < n.length; k++) { alvo += n[k]; mapa.push(indiceOriginal); }
    indiceOriginal += cp.length;
  }
  mapa.push(texto.length);                   // sentinela: fecha o último fatiamento
  return { alvo, mapa };
}
```

Um match em `alvo[a..b)` vira `texto.slice(mapa[a], mapa[b])`. Code point que normaliza para string vazia (combinante solto em texto já NFD) simplesmente não entra no `alvo`, e é absorvido pela fatia do caractere anterior — que é o comportamento correto.

**Invariante testável e barata de verificar:** `partirPorTermo(t, q).map(p => p.texto).join("") === t` para qualquer `t` e `q`. Isso trava reconstrução exata e proíbe perda ou duplicação de caractere.

---

### Contrato do módulo

`src/lib/utils/buscarProdutos.ts` — sem `'use client'`, sem `server-only`. Puro, isomórfico, zero import de runtime.

```ts
import type { CategoriaComProdutos, ProdutoCatalogo } from "@/components/vitrine/SecaoCatalogo";

/** RN-2: trim → NFD → remove diacrítico → lowercase. Sem colapso de espaço interno. */
export function normalizarBusca(s: string): string;

/** RN-3. Termo normalizado vazio → devolve `categorias` (MESMA referência). */
export function filtrarCatalogo(
  categorias: CategoriaComProdutos[],
  termo: string,
): CategoriaComProdutos[];

/** Pedaços da string ORIGINAL (acento preservado) marcando os que casaram. */
export function partirPorTermo(
  texto: string,
  termo: string,
): { texto: string; casa: boolean }[];
```

**Decisões de contrato:**

- `normalizarBusca` **não** colapsa espaço interno. Divergência deliberada de `normalizarBairro`, exigida pelo alinhamento de índice e pela RN-2.
- `filtrarCatalogo` com termo vazio/só-espaços devolve **a mesma referência** de entrada. Mais barato que cópia rasa e deixa o `useMemo` da issue 202 comparar por identidade.
- `filtrarCatalogo` **nunca muta** a entrada: cria `{ ...categoria, produtos: filtrados }`. Preserva `id`, `nome` e `exibir_imagens` por spread — se um campo novo entrar em `CategoriaComProdutos` amanhã, ele viaja sozinho.
- Ordem de categorias e de produtos **preservada** (a ordem é do SSR; RN-1).
- `partirPorTermo` com termo vazio → `[{ texto, casa: false }]`; com `texto` vazio → `[]`. Nunca emite segmento de texto vazio.
- `partirPorTermo` marca **todas** as ocorrências, não-sobrepostas, varrendo com `indexOf` a partir de `b`.
- `descricao: null` → tratado como `""` na comparação; `partirPorTermo` nunca é chamado com `null` (a 200 guarda antes).
- **Nada de memoização dentro do util.** Ele é puro e chamado a cada tecla; o `useMemo(…, [categorias, termo])` é responsabilidade de `CatalogoVitrine` (issue 202), conforme §Performance do spec.

---

### Cenários

**Caminho feliz:**
1. Cliente digita `pao` em `BuscaProdutos` (issue 202).
2. `CatalogoVitrine` chama `filtrarCatalogo(categorias, "pao")`.
3. `normalizarBusca("pao")` → `"pao"`; não vazio, então filtra.
4. Para cada produto, `normalizarComMapa(nome + " " + descricao)` — na prática dois testes independentes, nome e descrição — e `alvo.includes("pao")`.
5. "Pão de queijo" casa; sua categoria sobrevive com só os produtos que casaram; categorias sem nenhum match saem.
6. A 200 chama `partirPorTermo("Pão de queijo", "pao")` → `[{texto:"Pão",casa:true},{texto:" de queijo",casa:false}]` e monta `<mark>` com nós React.

**Casos de borda:**

| Borda | Comportamento exigido |
|---|---|
| Termo `""` | `filtrarCatalogo` devolve a mesma referência; `partirPorTermo` devolve 1 segmento `casa:false` |
| Termo `"   "` | Idêntico ao vazio (o `trim` de `normalizarBusca` zera) |
| Termo só com acento (`"´"`) | Normaliza para `""` → tratado como vazio, não filtra tudo fora |
| `descricao: null` | Não lança; produto só casa por `nome` |
| Categoria com `produtos: []` | Sai do resultado (0 matches) |
| Catálogo `[]` | Devolve `[]` |
| Nenhum produto casa | Devolve `[]` — a 202 renderiza o estado vazio, **nunca** tela em branco |
| Nome em NFD (`"Pão"`) | Casa com `pao` **e** `partirPorTermo` devolve `"Pão"` inteiro, acento intacto |
| Termo com maiúscula e acento (`"CAFÉ"`, `"CAFE"`) | Ambos casam "Café" |
| Termo com metacaractere de regex (`".*"`, `"a|b"`, `"("`) | Tratado como texto literal; **zero match**, sem `SyntaxError`, sem ReDoS |
| Termo gigante colado (50 KB) | `indexOf` não casa e sai em O(n); sem travar o frame. Cap de comprimento é UX da 202, não deste módulo |
| Múltiplas ocorrências (`"a"` em `"Batata assada"`) | Todas marcadas, segmentos alternados corretos |
| Termo maior que o texto | Sem match, 1 segmento `casa:false` |

**Tratamento de erros:** o módulo é total — não lança, não tem caminho de falha, não faz I/O, não loga. Não há mensagem ao usuário a proteger aqui (`seguranca.md` §14 não tem superfície neste arquivo). Entrada `null`/`undefined` em `termo` é impossível pelo tipo; se o chamador burlar, `normalizarBusca` lançaria — aceitável e desejável (erro de programação, não de runtime do usuário).

---

### Schema de Banco

**Nenhum.** Zero migration, zero tabela, zero coluna, zero política RLS. O spec (§Modelos de Dados) confirma: a busca opera sobre o payload RSC que o SSR já enviava — `buscarCategorias` + `buscarCatalogoPublico` inalterados.

---

### Validação (zod)

**Nenhum schema zod.** Não há borda de confiança aqui: o termo não é persistido, não vira payload de Server Action, não vai para a URL, não vira chave de identidade. Adicionar zod a um util puro de comparação de string seria cerimônia sem invariante a proteger. A tipagem `termo: string` é o contrato.

---

### Regra cliente ↔ servidor (mapeamento obrigatório)

| Invariante | Onde é garantida | Nota |
|---|---|---|
| RN-1 — o conjunto filtrável é exatamente o que o servidor entregou | **Servidor**: RLS + view `vitrine_lojas` + gate de assinatura em `src/app/(publica)/loja/[slug]/page.tsx`. Caminho **existente e não tocado** por esta issue | `filtrarCatalogo` é estritamente **subtrativo** — é impossível ele fazer aparecer produto que não estava no array de entrada. Um cliente que adultere o JS no máximo vê o catálogo inteiro que já estava no payload |
| RN-2 / RN-3 — casamento e poda de categoria | Cliente (`filtrarCatalogo`), travado por **teste unitário** | UX pura, sem consequência de permissão ou valor |
| RN-8 — valor monetário | **Server Action de checkout**, recálculo a partir do banco (`seguranca.md` §10) | Este módulo **não toca preço**: não lê, não soma, não ordena por `preco`. Nenhuma função aqui recebe ou devolve valor monetário. Nada nesta issue altera o caminho de recálculo |
| RN-9 — XSS no realce | Cliente (issue 200) | `partirPorTermo` devolve **`string`**, nunca HTML. O contorno `<mark>` é montado como nó React pelo consumidor (`seguranca.md` §15). Este módulo torna o caminho seguro o caminho fácil: quem consumir a saída não tem HTML na mão para concatenar |

**Não há regra de valor nem de permissão nesta issue.** Ela é 100% cliente por natureza e isso está correto — a única invariante de segurança real (quem pode ver o quê) já é garantida por RLS no SSR, antes deste código existir.

---

### Segurança

- **Proibido `new RegExp(termo)`** e `String.replace` com regex derivada do termo — ReDoS e metacaractere (`(`, `*`, `[`) viram `SyntaxError` ou catástrofe de backtracking. Usar **só** `indexOf` / `includes`. O `/\p{Diacritic}/gu` é literal fixo e está liberado.
- **§15-B não se aplica.** O termo é texto livre do cliente, mas (a) não vira chave de dedup e (b) nunca é concatenado fora do React — só compara string e é renderizado via JSX. Não chamar `normalizarObservacao` aqui: é higiene para comanda/WhatsApp, com invariantes de encurtamento que quebrariam o alinhamento de índice.
- Zero dado sensível, zero PII, zero token, zero secret, zero log.

---

### Recálculo no Servidor

**Não aplicável — não há valor monetário neste módulo.** Registrado para o checklist: `ProdutoCatalogo.preco` trafega no tipo importado, mas nenhuma função deste arquivo o lê, escreve, compara ou ordena. Grep de aceite: `grep -n "preco" src/lib/utils/buscarProdutos.ts` deve retornar vazio.

---

### Arquivos a Criar / Modificar / NÃO tocar

**Criar:**

| Arquivo | Conteúdo |
|---|---|
| `src/lib/utils/buscarProdutos.ts` | `normalizarBusca`, `filtrarCatalogo`, `partirPorTermo` (exportadas) + `normalizarComMapa` (interna). ~90 linhas com JSDoc. Sem `'use client'`, sem `server-only` |
| `src/lib/utils/buscarProdutos.test.ts` | Vitest, `environment: node`. Fixture local de `CategoriaComProdutos[]` no topo — sem nome/telefone/email real (`CLAUDE.md` §Higiene) |

**Modificar:**

| Arquivo | Mudança | Por quê |
|---|---|---|
| `src/lib/utils/calcularFrete.ts:49-56` | **Só o comentário** de `normalizarBairro`: acrescentar "Prima de `normalizarBusca` (`buscarProdutos.ts`), que NÃO colapsa espaço interno por causa do alinhamento de índice. Duplicação deliberada — não unificar sem um terceiro caso" | Duplicação sem nota vira dívida invisível; o próximo agente unificaria as duas e quebraria o realce. Zero mudança de comportamento, `calcularFrete.test.ts` intocado |

**NÃO tocar:**

| Arquivo | Por quê |
|---|---|
| `src/components/vitrine/SecaoCatalogo.tsx` | Só `import type` daqui. Exportar `ancora` e trocar `scroll-mt-24` é **escopo da issue 201** — mexer aqui gera conflito na mesma branch |
| `src/components/vitrine/CardProduto.tsx`, `ItemProdutoLista.tsx` | Prop `termo` + `<mark>` é **issue 200** |
| `src/app/(publica)/loja/[slug]/page.tsx` | Trocar `SecaoCatalogo` por `CatalogoVitrine` é **issue 202** |
| `src/lib/validacoes/loja.ts` | `sanitizarSlug` é de slug. Não reusar, não mover, não "generalizar" |
| `src/lib/supabase/queries/*` | Nenhuma query nova. Busca é 100% em memória sobre o payload do SSR |
| `supabase/migrations/` | Zero migration |
| `src/components/ui/` | Gerado pelo shadcn CLI. Nada a fazer aqui nesta issue |
| `package.json` | Nenhuma dependência nova |

---

### Dependências Externas

**Nenhuma.** Nenhum pacote npm novo, nenhuma API de rede, nenhuma chamada externa — nem no cliente nem no servidor.

**Custo e quota (`architecture.md` §9 nº1):** **R$ 0,00 e sem quota.** Não cobra por chamada; não consome Upstash, Nominatim, ViaCEP, Sentry nem invocação de função Vercel. Não há quota a estourar, logo não há decisão fail-closed vs. degradar a tomar. O único custo é **bundle da vitrine**: ~1 KB minificado de JS puro, sem transitiva. Orçamento do spec ("sem lib nova, sem dependência nova") respeitado por construção. A auditoria de bundle formal é a issue 204, com o agente `acelerar`.

APIs de plataforma usadas, todas nativas e sem polyfill: `String.prototype.normalize` (ES2015), `String.prototype.indexOf`, iteração por code point via `for…of`, `RegExp` com property escape `\p{Diacritic}` (ES2018 — precedente em produção: `calcularFrete.ts:60`, verde no `tsc` com `target: ES2017`).

---

### Ordem de Implementação

Issue **não crítica** (zero dinheiro, zero RLS, zero Server Action de valor, zero auth) — não exige o agente `tdd` red-first. Mas a armadilha de alinhamento NFD é exatamente o tipo de bug que passa despercebido, então **escreva os dois testes de alinhamento antes da implementação** e veja-os falhar. Custo marginal, retorno alto.

1. **`buscarProdutos.test.ts` primeiro, com dois casos apenas:** nome em NFD (`"Pão"`) casando `pao`, e a invariante de reconstrução `join("") === texto`. Rodar `npx vitest run src/lib/utils/buscarProdutos.test.ts` e capturar o `FAIL` (módulo inexistente). É a trava contra a implementação ingênua.
2. **`normalizarBusca`** — 4 linhas, independente de tudo.
3. **`normalizarComMapa`** (interna) — depende de (2). É aqui que a falha de (1) vira verde.
4. **`partirPorTermo`** — depende de (3). Os dois testes de (1) passam.
5. **`filtrarCatalogo`** — depende de (2); pode usar o `alvo` de (3) ou só `normalizarBusca` + `includes`. Última porque é a mais trivial e a de contrato mais estável.
6. **Completar a suíte** até os 8+ casos do critério de aceite, mais as bordas da tabela acima (metacaractere de regex, termo só com acento, múltiplas ocorrências, categoria vazia).
7. **Comentário cruzado** em `calcularFrete.ts`.
8. **Gate:** `npx tsc --noEmit` → `npm run lint` → `npx vitest run src/lib/utils/buscarProdutos.test.ts` → `npm run build`. Mais o grep de aceite: `grep -rn 'normalize("NFD")' src/` deve mostrar **exatamente três** ocorrências — `calcularFrete.ts`, `validacoes/loja.ts` e `buscarProdutos.ts` — e nenhuma outra. Se a 200/202 tiverem adicionado uma quarta, elas reimplementaram e devem passar a importar daqui.
