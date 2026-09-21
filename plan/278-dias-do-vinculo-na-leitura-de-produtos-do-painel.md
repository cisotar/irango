## Plano Técnico

### Análise do Codebase

**Correção de nomes na issue:** os tipos chamados aqui de `CardapioDoProduto` / `CardapiosPorProduto` são, no código real, `VinculoDoProduto` (`{ id, nome, abertoAgora }`) e `VinculosPorProduto` (`Record<string, VinculoDoProduto[]>`), ambos em `src/components/painel/contrato-lote.ts`. É esse par que muda.

O que já existe e será **reusado**:

- `src/components/painel/contrato-lote.ts` — `VinculoDoProduto` / `VinculosPorProduto`. Vive **fora** de `LoteDeProdutos` de propósito: é LEITURA, existe nos dois mundos, e o `FormProduto` decide por ela se afirma "não está em nenhum cardápio".
- `src/lib/utils/descreverVigencia.ts` — `DIAS_CURTOS`, `ordenarSemana` (ordem seg-first), `enumerar`, `descreverDiasDaSemana`. A frase "qua e sáb" já é produzida por essas peças; o que falta é um ponto de entrada público para o **item**.
- `src/app/(painel)/painel/(bloqueavel)/produtos/page.tsx:138-148` e `src/app/admin/assinantes/[lojaId]/produtos/page.tsx:76-84` — os **dois** pontos onde `VinculosPorProduto` é montado, ambos já iterando `v.cardapio` com `agora` e `loja.timezone` do servidor. É aqui que o rótulo entra: **nenhuma query nova, nenhuma ida a mais ao banco** (`COLUNAS_CARDAPIO_VIGENCIA` já traz `dias_semana` desde [273]).
- `src/components/painel/FormProduto.tsx:742-746` — a linha "Está em: …", `text-xs text-muted-foreground`, `join(", ")`.
- `src/app/(painel)/painel/(bloqueavel)/produtos/ProdutosClient.tsx:944-960` — o chip `Badge variant="outline" className="font-normal"` com o sufixo `· fora da janela agora`.
- `src/lib/utils/copiaCardapioPainel.ts` — o módulo de copy do painel que já existe, com teste puro ao lado.

O que **precisa ser criado**:

- `rotuloDiasDoItem(dias)` em `descreverVigencia.ts` — export novo, **sobre as tabelas existentes**. Não é um módulo novo nem uma tabela nova.
- `fraseEstaEm(vinculos)` em `copiaCardapioPainel.ts` — a linha inteira do `FormProduto` como string pura. Sem jsdom, uma frase montada com `join` dentro do JSX não é afirmável; foi por isso que a copy do painel já mora fora do `.tsx`.

**Divergência deliberada da letra da issue:** o escopo pede `dias: number[] | null` no tipo. Este plano envia **`rotuloDias: string | null` já redigido no servidor**. Motivo: M6 e o mandato 1 — *o browser nunca redige janela de vigência*. Mandar o array obrigaria o `.tsx` a escolher preposição, ordem seg-first e abreviação, que é exatamente a segunda redação que `descreverVigencia.ts` existe para impedir. O campo é um só, e continua sendo "um campo a mais no tipo", como a issue pede.

### Cenários

**Caminho feliz**
1. `/painel/produtos` renderiza no SSR. Para cada vínculo, `rotuloDias: rotuloDiasDoItem(v.dias_semana)`.
2. Chip da Feijoada lê **`Especiais do Dia · qua e sáb`**. Ordem dos trechos fixada: `nome · dias · fora da janela agora` — dias antes do estado, porque o estado é consequência.
3. Abrindo o `FormProduto` dela: **`Está em: Especiais do Dia (qua e sáb), Cardápio de Inverno.`**

**Casos de borda**
- **Vínculo sem dias (`null`/`[]`):** `rotuloDias === null` e **nada** é anexado — nunca "(todos os dias)", que viraria ruído em toda loja que não usa a feature (e hoje são 100% das linhas).
- **7 dias marcados:** o curto-circuito de `descreverDiasDaSemana` produz "todos os dias"; como isso é indistinguível de não restringir, `rotuloDiasDoItem` devolve **`null`** também nesse caso. Um dado, uma leitura.
- **Dias fora de 0..6 vindos de dado velho:** `ordenarSemana` já filtra; sobrando vazio ⇒ `null`.
- **Produto em nenhum cardápio:** nenhuma `ul` de chips; o aviso âmbar de RN-14 do `FormProduto` continua como está.
- **Produto em 3 cardápios, 2 com dias:** três chips, dois com o trecho de dias. Em 360px a `ul` já é `flex-wrap`; o `Badge` ganha `whitespace-normal` para quebrar em duas linhas em vez de esticar a linha do produto.
- **Cardápio fora da janela E com dias de item:** o chip acumula os três trechos — `Especiais do Dia · qua e sáb · fora da janela agora`. Os dias curtos mantêm o trecho curto por construção.
- **Hub admin:** idêntico. Mesma prop, mesma derivação, mesmo fuso da **loja-alvo**.

**Tratamento de erros:** não há caminho de erro. Zero I/O novo, zero escrita, zero action. Se o dado faltar, o campo é `null` e a tela omite o trecho.

### Schema de Banco

**Nenhuma mudança.** A coluna é de [272] e a query que a traz é de [273].

### Validação (zod)

**Nenhum schema novo.** A issue proíbe campo novo em `schemaProduto`, e este plano não o cria: não há escrita nem controle de edição aqui. A agenda é editada onde vive — o detalhe do cardápio ([276]).

### Recálculo no Servidor

Sem valor monetário e sem permissão nova. A única invariante relevante é **quem redige**: a frase é derivada **no Server Component**, com o relógio do servidor e o fuso da loja, e desce pronta como string. O cliente recebe texto, não regra. `abertoAgora` já segue esse padrão desde [261]; `rotuloDias` entra no mesmo lugar, no mesmo `.map`.

### Arquivos a Criar / Modificar / NÃO tocar

**Modificar**
- `src/lib/utils/descreverVigencia.ts` — export `rotuloDiasDoItem(dias: number[] | null): string | null`.
- `src/lib/utils/descreverVigencia.test.ts` — `[3,6]` ⇒ `"qua e sáb"`; `[1,2,3,4,5]` ⇒ a forma de corrida; `null`/`[]`/7 dias ⇒ `null`.
- `src/components/painel/contrato-lote.ts` — `VinculoDoProduto` ganha `rotuloDias: string | null`. **Obrigatório**, não opcional: o ponto fraco desta feature é um dos dois mundos esquecer de derivar, e campo opcional deixaria o admin renderizar mudo sem quebrar nada.
- `src/lib/utils/copiaCardapioPainel.ts` — `fraseEstaEm(vinculos: readonly {nome, rotuloDias}[]): string`.
- `src/lib/utils/copiaCardapioPainel.test.ts` — com e sem dias, um e vários cardápios, pontuação final.
- `src/components/painel/FormProduto.tsx:742` — a linha passa a chamar `fraseEstaEm`; `cardapiosDoProduto` aceita o campo novo.
- `src/app/(painel)/painel/(bloqueavel)/produtos/ProdutosClient.tsx` — o chip ganha o trecho `· {rotuloDias}` antes do sufixo existente, e `whitespace-normal` no `Badge`.
- `src/app/(painel)/painel/(bloqueavel)/produtos/page.tsx` e `src/app/admin/assinantes/[lojaId]/produtos/page.tsx` — `rotuloDias: rotuloDiasDoItem(v.dias_semana)` no `.map` que já existe.
- `src/app/(painel)/painel/(bloqueavel)/produtos/ProdutosClient.test.tsx` — chip com e sem dias, e a ordem dos três trechos.
- `src/components/painel/rotaCardapiosInjetada.test.tsx` — só o `renderFormAdmin` acompanha o tipo novo (o campo é obrigatório); nenhuma asserção muda.

**NÃO tocar**
- `src/lib/validacoes/produto.ts` (`schemaProduto`) — fora de escopo por decisão da issue.
- `src/lib/supabase/queries/cardapios.ts` / `carga-cardapios.ts` — o dado já vem; nenhuma coluna nova, nenhum round trip novo.
- Qualquer Server Action — esta issue é **somente leitura**.
- `src/components/ui/**`.

### Dependências Externas

**Nenhuma.** Custo variável: zero. Payload RSC cresce em ~10 bytes por vínculo com agenda; nenhum round trip novo.

### Ordem de Implementação

1. `rotuloDiasDoItem` + teste puro.
2. `fraseEstaEm` + teste puro.
3. `contrato-lote.ts` ganha o campo obrigatório — **`tsc` vermelho nos dois `page.tsx`**, que é a trava de paridade lojista↔admin.
4. As duas pages derivam o rótulo; `tsc` volta a verde.
5. `FormProduto` e `ProdutosClient` renderizam; asserções de render por último.

Issue **não** crítica (leitura derivada, nenhuma decisão depende dela): não exige fase `tdd`. Os passos 1 e 2 já entregam a regra sob teste antes de qualquer `.tsx`.

**Gate mecânico:**
`npx vitest run "src/app/(painel)/painel/(bloqueavel)/produtos/ProdutosClient.test.tsx" src/lib/utils/descreverVigencia.test.ts src/lib/utils/copiaCardapioPainel.test.ts src/components/painel/rotaCardapiosInjetada.test.tsx` · `npx tsc --noEmit` = 0 · `npm run lint` = 0
