# Plano Técnico — [287] dias no lote + [288] refatoração do detalhe do cardápio

Branch `feat/refat-detalhe-cardapio`, a partir de `c73ce40`. Um `executar` só, **duas
fases com gate entre elas**. Fase 1 (287) é crítica e só começa depois do RED do `tdd`;
fase 2 (288) é UI e não tem RED obrigatório.

**Nenhuma migration.** A coluna `cardapio_produtos.dias_semana` já existe
(`supabase/migrations/20260921130000_cardapio_produtos_dias_semana.sql`), com
`cardapio_produtos_dias_semana_dominio` como backstop e `NULL` = "todos os dias do
cardápio".

---

## 0. Análise do codebase — o que já existe e será reusado

### Validação e normalização
| Arquivo | O que faz | Como entra aqui |
|---|---|---|
| `src/lib/validacoes/cardapio.ts` | `schemaLoteDeProdutos`, `schemaLoteDeCategoria`, `schemaPreviaDeLote`, `schemaDiasDoVinculo`, `normalizarDiasDoVinculo` | ganha **um** schema derivado e **um** validador de array extraído; `normalizarDiasDoVinculo` é reusada sem tocar |
| `src/lib/actions/cardapio-contrato.ts` | `MSG_GENERICA_LOTE`, `MSG_DIAS_DO_VINCULO`, `erroDoLote`, `resumirPrevia`, tipos `Resultado`/`Previa` | reusado inteiro; nenhuma frase nova |
| `src/lib/supabase/queries/cardapios.ts` | `cardapioPertenceALoja`, `buscarLinhasDaPrevia`, `buscarCardapiosComProdutos` | reusadas; a trava de posse já está de pé nos dois mundos |

### Cliente — módulos puros e componentes
| Arquivo | Reuso |
|---|---|
| `src/components/painel/agendaDoVinculo.ts` | `payloadDeDias`, `payloadsDeDiasEmLote`, `podeDefinirDias` — inalterados |
| `src/components/painel/contrato-lote.ts` | `AcoesLote`, `CardapioParaLote`, `PreviaDoLote` — inalterados (as actions tipam `payload: unknown`, então o campo novo **não** muda o contrato) |
| `src/components/painel/useLoteDeProdutos.tsx` | o ciclo prever→confirmar→escrever. Mudança **aditiva** |
| `src/components/painel/PilulasDeDias.tsx` | inline no card e no sheet, modo `compacto` |
| `src/components/painel/FormVigencia.tsx` | **inalterado**, só passa a viver dentro de um `Accordion` |
| `src/components/painel/CabecalhoPagina.tsx` | inalterado; ganha `children` (selo de status) — a prop já existe |
| `src/lib/utils/copiaLotePromocao.ts` | `perguntaLote`, `fraseCategoriaEhFoto`, `fraseOcultos`, `fraseEMais` — a copy do passo de confirmação sai daqui, byte a byte |
| `src/lib/utils/copiaCardapioPainel.ts` | `fraseAgendaDoItem`, `fraseExclusivos`; **ganha** o rótulo de "categoria inteira" |
| `src/lib/utils/descreverVigencia.ts` | `descreverVigencia` (resumo de 1 linha), `rotuloAgora`, `rotuloDiasDoItem`, `avisoAgendaQueNuncaAbre` — todos já chamados nas duas páginas |
| `src/components/ui/{accordion,sheet,card,checkbox,radio-group,menu,alert-dialog,badge,input,label,button}.tsx` | tudo do shadcn CLI. **Nada novo em `components/ui/`, nada editado à mão** |
| `src/components/painel/CartaoAssociacaoOpcionais.tsx` | **precedente**, não é editado: sanfona + `Card` + checkbox na linha + autosave + `min-h-[44px]` no `AccordionTrigger` |

### O que precisa ser criado, e por que não dá para reusar
- **`escolhaDeDias.ts`** — a regra D3 ("todos os dias do cardápio" × "escolher dias") não
  existe em lugar nenhum: `agendaDoVinculo.ts` só sabe montar o payload de **um vínculo já
  existente** (3 chaves, `produto_id` singular). O payload da adição é outro
  (`produto_ids` plural + `dias_semana`). Módulo puro, testável sem jsdom.
- **`DetalheDoCardapio.tsx` + `ItensDoCardapio.tsx` + `SheetAdicionarItens.tsx` +
  `VigenciaRecolhida.tsx`** — são a partição de `SeletorProdutosDoCardapio.tsx`, que hoje
  faz duas tarefas na mesma superfície. Não é componente novo: é o mesmo vocabulário
  redistribuído, e o arquivo antigo **é apagado**.

---

## FASE 1 — backend (issue 287, crítica)

### Validação (zod) — schema único

Em `src/lib/validacoes/cardapio.ts`:

1. Extrair o array de dias que hoje está inline em `schemaDiasDoVinculo` para um const de
   módulo (`const diasDaSemanaDoVinculo = z.array(z.number().int().min(0).max(6)).max(7)`)
   e fazer `schemaDiasDoVinculo` consumi-lo. **Zero mudança de comportamento** — é o que
   impede a segunda declaração da mesma regra de domínio.
2. Criar o schema derivado:

   ```
   export const schemaLoteDeProdutosComDias = schemaLoteDeProdutos
     .extend({ dias_semana: diasDaSemanaDoVinculo.nullish() })
     .strict();
   ```

   **Derivar em vez de mutar `schemaLoteDeProdutos` (desvio deliberado da letra da issue,
   mesmo efeito):** `schemaLoteDeProdutos` também é o schema de `tirarDeCardapio` /
   `tirarDeCardapioAdmin`. Somar o campo lá faria o DELETE aceitar e ignorar em silêncio um
   `dias_semana` — payload confuso que o `.strict()` hoje recusa. Com o derivado, cada
   caminho de escrita recusa exatamente o que não sabe usar, e o critério de aceite "chave
   desconhecida continua barrada pelo `.strict()`" vale nos dois. `.extend()` sobre objeto
   estrito do zod v4 preserva `.strict()`; o `.strict()` explícito é redundância barata.
3. `export type LoteDeProdutosComDias = z.infer<typeof schemaLoteDeProdutosComDias>;`

Nenhuma frase nova, nenhuma normalização nova: `normalizarDiasDoVinculo` já faz dedup,
ordem crescente e `[]`/`null`/`undefined` → `null`.

### Camada onde cada invariante é garantida

| Invariante | Onde é garantida |
|---|---|
| Forma do payload (ids, domínio 0..6, teto 7, chave desconhecida) | `schemaLoteDeProdutosComDias.safeParse` **antes de qualquer I/O**, nos dois mundos |
| Representação única de "sem restrição" | `normalizarDiasDoVinculo` no servidor (`[]` → `null`) |
| Domínio no banco (backstop) | CHECK `cardapio_produtos_dias_semana_dominio` |
| `loja_id` da linha | lojista: `buscarLojaDoDono(supabase)` (auth.uid()); admin: `escopo.inserirVarios` com o `lojaId` da URL validado. **Nunca do payload** |
| Posse do `cardapio_id` | `cardapioPertenceALoja` **antes** do upsert, nos dois mundos (270) |
| Posse dos `produto_ids` | FKs compostas dentro da transação — nenhum pre-check em JS |
| Leitura/escrita do lojista | RLS `cardapio_produtos_escrita_propria`; no admin, `service_role` não tem rede de RLS e quem protege é a **paridade** + o escopo do wrapper |

**Valor monetário:** nenhum. Esta fatia não toca preço, frete, desconto ou total.

### Propagação

`src/lib/actions/cardapio.ts` → `aplicarCardapioEmProdutos`:
- trocar `schemaLoteDeProdutos` por `schemaLoteDeProdutosComDias` (só nesta action);
- `const dias = normalizarDiasDoVinculo(parsed.data.dias_semana);` **depois** do parse e
  **antes** do `try`;
- a linha do `map` passa a ser `{ loja_id: loja.id, cardapio_id, produto_id, dias_semana: dias }`.

`src/app/admin/assinantes/actions/admin-cardapios.ts` → `aplicarCardapioEmProdutosAdmin`:
mesmo schema importado, mesma normalização, e
`produto_ids.map((produto_id) => ({ cardapio_id, produto_id, dias_semana: dias }))`
(`loja_id` continua vindo do `escopo`).

**A chave é sempre escrita, com `null` quando o campo não veio.** No banco é idêntico à
linha de hoje (a coluna é nullable sem default), mas é uma diferença observável para o
teste de paridade, que compara o objeto capturado — o `tdd` afirma
`dias_semana: null` explicitamente.

**`ignoreDuplicates: true` continua:** adicionar um produto que já está no cardápio
**não** reescreve os dias dele. É o comportamento certo (a adição não é edição) e precisa
estar num caso de teste, senão vira surpresa em produção.

`aplicarCardapioEmCategoria` / `...Admin`, `tirarDeCardapio` / `...Admin`,
`preverLoteAction` / `preverLoteAdmin`, `definirDiasDoVinculo` / `...Admin`: **não
tocados**.

### Fora de escopo, com a incoerência resolvida na UI (não em migration)

A RPC `aplicar_cardapio_em_categoria` devolve contagem, não ids: dias ali exigiriam
parâmetro novo → migration. Fica fora, como a issue manda. **Não** haverá fan-out de
`definirDiasDoVinculo` depois da RPC.

A incoerência com a decisão 3 é **resolvida na fase 2, sem migration**: o botão
"categoria inteira" dentro do sheet só é oferecido enquanto o rádio está em "Todos os dias
do cardápio". Com "Escolher dias" marcado ele fica `aria-disabled` com motivo **em texto
perceptível** (mesmo remédio que a issue manda aplicar ao "Definir dias"):
*"Adicionar a categoria inteira entra sempre como todos os dias do cardápio. Para dias
específicos, marque os produtos um a um."* Honesto, sem escrita silenciosa com dias
descartados, sem schema novo. **Ponto a confirmar com o dono do produto — mas não bloqueia
a implementação.**

### Cenários — fase 1

**Caminho feliz:** payload `{cardapio_id, produto_ids:[a,b], dias_semana:[3,1,3]}` → parse
ok → loja derivada → `cardapioPertenceALoja` true → duas linhas com `dias_semana:[1,3]` →
`upsert` → `revalidarCaminhosDoCardapio` → `{ok:true}`.

**Bordas:**
| Entrada | Resultado |
|---|---|
| campo ausente / `null` / `[]` | linha com `dias_semana: null`; idêntico ao de hoje |
| `[7]`, `[-1]`, `[1.5]`, `["1"]` | parse recusa → `MSG_GENERICA_LOTE`, zero I/O |
| 8 elementos que normalizariam para 1 | recusado pelo `.max(7)` **antes** da dedup |
| `dias_semana` + chave desconhecida | `.strict()` recusa |
| `dias_semana` em `tirarDeCardapio` | `.strict()` do schema original recusa |
| cardápio de outra loja / inexistente | `cardapioPertenceALoja` false → `MSG_GENERICA_LOTE` **antes de qualquer escrita**, nenhuma linha no capturado |
| produto de outra loja no lote | FK composta derruba o lote inteiro; nenhuma linha gravada |
| par já existente | descartado por `ignoreDuplicates`; dias antigos preservados |
| erro de banco | `console.error` no servidor + `MSG_GENERICA_LOTE` na tela (`seguranca.md` §14) |

### Contrato de teste do `tdd` (RED) — fase 1

Três arquivos, todos `environment: node`, sem Docker. Nenhuma lógica de produção.

**A. `src/lib/validacoes/cardapio.test.ts` (estender)** — bloco
`[287] schemaLoteDeProdutosComDias`:
1. aceita `{cardapio_id, produto_ids, dias_semana:[0,6]}`;
2. aceita o payload **sem** `dias_semana` e sem `produto_ids` alterado;
3. recusa `7`, `-1`, `1.5`, `"3"`, e lista de 8;
4. recusa chave desconhecida junto com `dias_semana` (`.strict()` preservado pelo `.extend()`);
5. `schemaLoteDeProdutos` (o original) **continua** recusando `dias_semana` — é o que trava
   o DELETE;
6. `normalizarDiasDoVinculo([3,1,3]) === [1,3]`, `([]) === null`, `(undefined) === null`,
   e o array de entrada não é mutado.

**B. `src/lib/actions/cardapio.dias-no-lote.test.ts` (novo)** — mocks só de I/O
(`@/lib/supabase/server`, `@/lib/supabase/queries/lojas`,
`@/lib/supabase/queries/cardapios`, `next/cache`), no molde de `cardapio.test.ts`, com
captura das linhas do `upsert`:
1. com dias → linhas `{loja_id, cardapio_id, produto_id, dias_semana:[1,3]}`, `toEqual`
   estrito (nenhuma quarta chave, nenhum `loja_id` do payload);
2. sem o campo → linhas com `dias_semana: null`;
3. `[]` → `null`;
4. `[3,1,3]` → `[1,3]` (dedup + ordem na linha, não só no schema);
5. **trava de posse:** `cardapioPertenceALoja` mockada `false` → resultado
   `{ok:false, erro:"Não foi possível aplicar o cardápio aos produtos selecionados."}`
   (**fragmento literal afirmado**, conforme a memória do projeto) **e** o array de
   operações capturadas **sem nenhum `upsert`**;
6. `ignoreDuplicates: true` e `onConflict: "cardapio_id,produto_id"` continuam nas opções.

**C. `src/app/admin/assinantes/actions/admin-cardapios.paridade.test.ts` (estender)** —
bloco `[287] paridade de dias no lote`, usando a captura `Op.upsert` que o arquivo já tem:
1. admin com dias → `{cardapio_id, produto_id, dias_semana:[1,3]}` (o `loja_id` entra pelo
   `escopo`, como hoje);
2. admin sem o campo → `dias_semana: null`;
3. mesma recusa de domínio e de chave desconhecida, mesma frase `MSG_GENERICA_LOTE`
   escrita à mão no arquivo;
4. cardápio de outra loja → `MSG_GENERICA_LOTE` com fragmento literal e **zero** `upsert`,
   inclusive antes de `registrarAcessoAdmin`;
5. o `metadados: { produtos: n }` do log admin não passa a carregar dias (não vaza agenda
   para a trilha de auditoria sem decisão).

> RED aceito quando `npx vitest run src/lib/validacoes/cardapio.test.ts src/lib/actions/cardapio.dias-no-lote.test.ts 'src/app/admin/assinantes/actions/admin-cardapios.paridade.test.ts'` imprime `FAIL` com output capturado.

### GATE ENTRE AS FASES — obrigatório

O `executar` **não abre um `.tsx`** antes de:
1. os três arquivos acima em `PASS`;
2. `npx tsc --noEmit` limpo;
3. `npm test` inteiro verde (o campo novo não pode ter quebrado `cardapio.test.ts`,
   `cardapio.crud.test.ts`, `cardapio-posse.enforcement.test.ts` nem
   `lote-contagem-do-servidor.test.ts`);
4. commit próprio da fase 1 (`feat(287): …`), para que um problema na UI não arraste o
   backend já validado.

---

## FASE 2 — UI (issue 288, não crítica)

### Módulos puros novos (é onde a regra fica travada sem jsdom)

**`src/components/painel/escolhaDeDias.ts`** (sem React, ao lado de `agendaDoVinculo.ts`):
```
export type EscolhaDeDias =
  | { modo: "cardapio" }
  | { modo: "dias"; dias: number[] };

export const ESCOLHA_PADRAO: EscolhaDeDias = { modo: "cardapio" };
export const MOTIVO_SEM_DIA = "Marque pelo menos um dia para continuar.";
export const MOTIVO_CATEGORIA_SEM_DIAS =
  "Adicionar a categoria inteira entra sempre como todos os dias do cardápio. Para dias específicos, marque os produtos um a um.";

export function escolhaValida(e: EscolhaDeDias): boolean;   // modo "dias" com [] → false
export function diasDaEscolha(e: EscolhaDeDias): number[];  // "cardapio" → []; "dias" → sort
export function payloadDeAdicao(
  cardapioId: string, produtoIds: string[], e: EscolhaDeDias,
): { cardapio_id: string; produto_ids: string[]; dias_semana: number[] };
```
`[]` vindo daqui é normalizado para `NULL` **no servidor** — o cliente não decide
representação.

**`src/lib/utils/copiaCardapioPainel.ts` (estender)**:
`rotuloCategoriaInteira(faltantes: number, categoria: string): { curto: string; longo: string }`
→ `{ curto: "+ os 6", longo: "Adicionar os 6 produtos de Pratos principais que faltam" }`,
com singular (`"+ o 1"` / `"…o 1 produto…"`). Teste de singular/plural/zero.

### Componentes

| Arquivo | Ação | Conteúdo |
|---|---|---|
| `src/components/painel/VigenciaRecolhida.tsx` | **criar** (`'use client'`) | `Accordion` + `Card` envolvendo `FormVigencia` **sem alterá-lo**. Props: `resumo: string` (do servidor) + as props de `FormVigencia` repassadas. Nasce fechado (`defaultValue={[]}`), `AccordionTrigger` com `min-h-[44px]`, resumo `truncate text-xs`. Os dois mundos montam este |
| `src/components/painel/ItensDoCardapio.tsx` | **criar** (`'use client'`) | um `Card` por item vinculado: nome, preço·categoria, badge "Exclusivo de cardápio", frase de agenda (`id` → `aria-describedby`), `PilulasDeDias compacto` com o autosave otimista **copiado do `SeletorProdutosDoCardapio` atual sem mudar a lógica** (`agendas`/`emVoo`/`anuncios`), aviso âmbar `role="status"`, kebab (`Menu`) com Editar produto (href **injetado**, pode ser `null`) · Voltar a todos os dias do cardápio · Tirar do cardápio (`AlertDialog`, D8). Estado vazio: card centrado com CTA |
| `src/components/painel/SheetAdicionarItens.tsx` | **criar** (`'use client'`) | `Sheet` com `showCloseButton={false}` + `SheetClose` próprio de `min-h-[44px] min-w-[44px]`; busca (`Input type="search"` + `Label sr-only`, filtro puro sobre `grupos`); `Accordion` de categorias **fechado**; linha = `label` + `Checkbox` de 44px; vinculado = `div` sem checkbox, `opacity-70`, "Já está neste cardápio"; `SheetFooter` com `RadioGroup` de D3 + `PilulasDeDias` revelado + contagem `aria-live` + CTA; **passo de confirmação dentro do sheet** (D7), com a copy de `copiaLotePromocao.ts` |
| `src/components/painel/DetalheDoCardapio.tsx` | **criar** (`'use client'`) | a superfície única que a página monta: `useLoteDeProdutos` + estado de abertura do sheet + `ItensDoCardapio` + `SheetAdicionarItens`. Recebe `cardapio`, `grupos`, `acoes`, `hrefProdutos`/`hrefEditarProduto` **injetados** |
| `src/components/painel/useLoteDeProdutos.tsx` | **modificar (aditivo)** | ver abaixo |
| `src/components/painel/SeletorProdutosDoCardapio.tsx` | **apagar** | únicos consumidores são as duas páginas de detalhe, ambas migradas. `git grep SeletorProdutosDoCardapio` tem de voltar vazio |
| `src/components/painel/SeletorProdutosDoCardapio.test.tsx` | **apagar** | substituído por `ItensDoCardapio.test.tsx` + `SheetAdicionarItens.test.tsx`, que herdam os casos (pílulas, frase, `aria-describedby`, aviso âmbar, `aria-live`, badge) |

**Mudança aditiva no `useLoteDeProdutos`** (não quebra `/painel/produtos`):
1. `abrirCardapio(acao, cardapio, escopo, dias?: number[])` — `dias` guardado no `Pedido`;
   no `confirmar`, o ramo `adicionar` monta
   `{cardapio_id, produto_ids, dias_semana}` **só quando `dias` foi passado** (ausente =
   payload de hoje, byte a byte, e a barra de `/painel/produtos` não muda);
2. expor `pedido` (`{alvo, previa}`), `confirmar` e `cancelar` no retorno, para o sheet
   renderizar o passo de confirmação com a mesma prévia do servidor. `dialogo` continua
   exportado e continua sendo o que `ProdutosClient` usa — `DialogoLoteCardapio.tsx` **não
   é tocado**;
3. o `DetalheDoCardapio` **não** renderiza `loteUI.dialogo` (senão volta o overlay sobre
   overlay que §6 proíbe).

### Páginas

| Arquivo | Ação |
|---|---|
| `src/app/(painel)/painel/(bloqueavel)/cardapios/[cardapioId]/page.tsx` | **modificar**: monta `VigenciaRecolhida` (com `resumo={descreverVigencia(...)}`, que já é chamada ali) e `DetalheDoCardapio`; `CabecalhoPagina` ganha o selo de `rotuloAgora` como `children`. A projeção de `grupos` **não muda** — só ganha `preco` e `categoriaNome` por item, para o card |
| `src/app/admin/assinantes/[lojaId]/cardapios/[cardapioId]/page.tsx` | **modificar**: espelho exato, com `rotaCardapiosAdmin(lojaId)` |
| `src/app/admin/assinantes/[lojaId]/cardapios/[cardapioId]/CardapioDetalheAdminClient.tsx` | **modificar**: troca `FormVigencia`+`SeletorProdutosDoCardapio` por `VigenciaRecolhida`+`DetalheDoCardapio`, mantendo as **sete** actions injetadas sem default |

### NÃO tocar
`src/components/ui/**` (shadcn CLI — o close de 44px sai por `showCloseButton={false}` no
consumidor) · `FormVigencia.tsx` · `PilulasDeDias.tsx` · `CabecalhoPagina.tsx` ·
`DialogoLoteCardapio.tsx` · `BarraSelecaoLote.tsx` (é de `/painel/produtos`) ·
`agendaDoVinculo.ts` · `contrato-lote.ts` · `ProdutosClient.tsx` ·
`src/lib/utils/copiaLotePromocao.ts` (nenhuma frase nova de lote) ·
`supabase/migrations/**` · `src/lib/database.types.ts`.

### Paridade e travas mecânicas
- `src/components/painel/rotaCardapiosInjetada.test.tsx` já varre **`components/painel/**`
  inteiro** e a pasta `cardapios/` do lojista: os quatro componentes novos entram na trava
  automaticamente. Nada a mudar ali; o gate `git grep '"/painel/'` nesses arquivos vem de
  graça, desde que todo href seja prop.
- Nenhum componente compartilhado importa `ROTA_CARDAPIOS_LOJISTA` nem `rotaCardapiosAdmin`.

### Cenários — fase 2

**Caminho feliz:** detalhe abre com vigência fechada e resumo de uma linha → itens em cards
com pílulas inline → "Adicionar item" abre o sheet → busca filtra → sanfona abre →
marca 3 produtos → rádio fica em "Todos os dias do cardápio" → CTA → prévia do servidor →
passo de confirmação dentro do sheet → escrita → toast → `router.refresh()` → os 3 aparecem
como cards.

**Bordas:**
| Situação | Comportamento |
|---|---|
| cardápio sem item | card centrado + CTA, nunca lista vazia |
| loja sem produto | sheet abre com "Você ainda não tem produtos" + href injetado |
| busca sem resultado | "Nenhum produto com esse nome." |
| "Escolher dias" com zero dia | CTA `aria-disabled` + `MOTIVO_SEM_DIA` em **texto perceptível** com `aria-describedby` (nunca `title`) |
| "Escolher dias" + categoria inteira | botão da categoria `aria-disabled` + `MOTIVO_CATEGORIA_SEM_DIAS` visível |
| produto já vinculado | linha esmaecida, sem checkbox (D4) |
| seleção acima de `TETO_LOTE` | `MSG_TETO` do hook, inalterada |
| prévia recusada | `toast.error` com a frase da action; sheet volta ao passo de seleção **com a seleção intacta** |
| prévia com total 0 | passo de confirmação com CTA desabilitado (comportamento atual) |
| escrita de dias em voo no card | `aria-busy`, pílulas `disabled`, `aria-live` "Salvando…" → "Dias salvos." |
| agenda que nunca abre | aviso âmbar `role="status"` — avisa, não bloqueia |
| falha de rede | `toast.error` genérico; detalhe só no log do servidor |

**Erros:** nenhuma frase nova redigida no cliente. Toda mensagem vem da Server Action ou de
`copiaLotePromocao.ts`/`copiaCardapioPainel.ts`.

### Testes da fase 2 (do `executar`/`testar`, sem RED obrigatório)
1. `src/components/painel/escolhaDeDias.test.ts` — puro: `{modo:"cardapio"}` → `dias_semana: []`;
   `{modo:"dias",dias:[6,1]}` → `[1,6]`; `{modo:"dias",dias:[]}` → `escolhaValida === false`;
   `payloadDeAdicao` devolve **exatamente** 3 chaves.
2. `src/lib/utils/copiaCardapioPainel.test.ts` — `rotuloCategoriaInteira` singular/plural/zero.
3. `src/components/painel/ItensDoCardapio.test.tsx` — `renderToStaticMarkup`: badge, frase,
   `aria-label` do grupo, `aria-describedby`, aviso âmbar, `aria-live`, 7 pílulas
   compactas, item não vinculado ausente da lista.
4. `src/components/painel/SheetAdicionarItens.test.tsx` — `renderToStaticMarkup`:
   `aria-expanded="false"` nas sanfonas, linha de vinculado sem `checkbox` e com
   "Já está neste cardápio", rádio padrão marcado, motivo em texto (e **nenhum `title=`**),
   botão de fechar com `min-h-[44px]`, ausência de `size="icon-sm"`.
5. `src/components/painel/VigenciaRecolhida.test.tsx` — `aria-expanded="false"` e o resumo
   do servidor presentes no SSR.
6. `rotaCardapiosInjetada.test.tsx` roda sem alteração e passa a cobrir os arquivos novos.

---

## Ordem de implementação

**Fase 1 (287) — não começa sem RED do `tdd`:**
1. `tdd`: os três arquivos de teste da §"Contrato de teste" → `FAIL` capturado.
2. `src/lib/validacoes/cardapio.ts` (extrair `diasDaSemanaDoVinculo`, criar o derivado).
3. `src/lib/actions/cardapio.ts` (`aplicarCardapioEmProdutos`).
4. `src/app/admin/assinantes/actions/admin-cardapios.ts` (`aplicarCardapioEmProdutosAdmin`).
5. **GATE**: os três em PASS + `tsc` + `npm test` + commit da fase 1.

**Fase 2 (288) — só depois do gate:**
6. `escolhaDeDias.ts` + `rotuloCategoriaInteira` e seus testes (puros, antes de qualquer JSX).
7. `useLoteDeProdutos.tsx` (aditivo) — `npm test` verde prova que `/painel/produtos` não mudou.
8. `VigenciaRecolhida.tsx` + teste.
9. `ItensDoCardapio.tsx` + teste.
10. `SheetAdicionarItens.tsx` + teste (é o maior; depende de 6 e 7).
11. `DetalheDoCardapio.tsx`.
12. Página do lojista → página + client do admin (nesta ordem: o admin é espelho).
13. Apagar `SeletorProdutosDoCardapio.tsx` e seu teste; `git grep` dos dois nomes vazio.
14. `npx tsc --noEmit` → `npm run lint` → `npm test` → `npm run build`.

## Dependências externas
**Nenhuma.** Nada novo em `package.json`, nenhuma API externa, nenhum custo variável,
nenhuma quota. `@base-ui/react ^1.5.0` (já instalado) fornece `Accordion`, `Sheet`,
`RadioGroup` e `Menu` pelos wrappers do shadcn que já estão em `components/ui/`.

## Conflitos entre o mockup e o código real
1. **API da sanfona.** O mockup escreve `Accordion type="single" collapsible` (API do
   Radix). O `components/ui/accordion.tsx` deste repo é **Base UI**: as props reais são
   `multiple`, `defaultValue={[]}` e `keepMounted` no `AccordionContent`. Vigência usa
   `defaultValue={[]}`; as categorias do sheet, `multiple` com `defaultValue={[]}`.
   `keepMounted` é necessário onde o conteúdo precisa existir no SSR para ser afirmável.
2. **`SheetContent` com `side` duas vezes.** O mockup escreve
   `side="bottom" className="h-[90dvh] sm:h-full" side="right"`, que é inválido em JSX.
   `side` é uma prop só: usar `side="bottom"` com `className` responsiva, ou trocar por
   `sm` via `useMediaQuery` (já existe em `src/hooks/useMediaQuery.ts`, e é o que
   `DialogoLoteCardapio` faz).
3. **"Categoria inteira" sem dias.** O mockup §4 recomenda migration na RPC; a issue 287 a
   proíbe. Resolvido na UI (rádio + motivo perceptível), sem migration — ver fase 1.
4. **`preco` e `categoriaNome` no card.** O mockup mostra "R$ 48,90 · Pratos principais",
   que `ProdutoDoSeletor` **não** carrega hoje. As duas páginas já têm o dado
   (`buscarProdutosDoLojista` e `buscarCategorias`): é projeção nova no Server Component,
   **não** leitura nova, e `formatarMoeda` já existe em `src/lib/utils/formatarMoeda.ts`.
5. **Shell `bg-muted/40` (D1 do mockup).** Já foi resolvido de outra forma pelo PR #149
   (`.superficie-painel` + `ring` no `Card`, `design-system.md` §10). **Não aplicar** o
   `bg-muted/40` do mockup: seria uma segunda regra de superfície competindo com a §10.

## Riscos
| Risco | Mitigação |
|---|---|
| Regressão silenciosa em `/painel/produtos` ao mexer no hook | mudança estritamente aditiva; `ProdutosClient.test.tsx` e `lote-contagem-do-servidor.test.ts` no gate |
| Apagar `SeletorProdutosDoCardapio` perdendo um caso já travado | os casos do teste antigo são **portados um a um** para os dois testes novos antes de apagar |
| `dias_semana: null` explícito quebrar teste de paridade existente | previsto; o `tdd` afirma a chave desde o RED |
| Adicionar produto já vinculado não reescrever dias virar surpresa | caso de teste B6 + frase no sheet ("já está neste cardápio") |
| Fase 2 estourar e arrastar a fase 1 | commit separado no gate |
| Sem jsdom, o clique não é observável | toda regra de D3 vive em `escolhaDeDias.ts` (puro); o resto é markup afirmável |
