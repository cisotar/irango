## Plano Técnico

> Autor: `planejar` · Data: 2026-09-07 · Issue: `tasks/168-observacao-na-chave-de-dedup-do-carrinho.md`
> Contexto de loop: `plan/loop-observacoes-por-item-pedido.md` §5 passo 5 · Spec: `specs/observacoes-por-item-pedido.md` §Regras de Negócio

### Análise do Codebase

**Contagem real de chamadas — a issue está desatualizada.** `grep -rn "linhaCarrinhoId" src/` devolve **1 declaração + 8 chamadas em 3 arquivos + 2 comentários de doc**, não "6 chamadas em 3 arquivos":

| Local | Linha | Papel |
|---|---|---|
| `src/hooks/useCarrinho.ts` | 18 | **declaração** — assinatura a estender |
| `src/hooks/useCarrinho.ts` | 33 | comentário de doc do `incrementar` (fala da retrocompat) |
| `src/hooks/useCarrinho.ts` | 105 | `adicionarItem` — chave do item que chega |
| `src/hooks/useCarrinho.ts` | 107 | `adicionarItem` — `some` (linha já existe?) |
| `src/hooks/useCarrinho.ts` | 112 | `adicionarItem` — `map` que soma a quantidade |
| `src/hooks/useCarrinho.ts` | 125 | `incrementarItem` |
| `src/hooks/useCarrinho.ts` | 136 | `decrementarItem` |
| `src/hooks/useCarrinho.ts` | 145 | `removerItem` |
| `src/components/vitrine/Carrinho.tsx` | 62 | `linhaId` do drawer (React `key` + handlers) |
| `src/components/vitrine/checkout/EtapaItens.tsx` | 36 | comentário de doc do prop `onIncrementar` |
| `src/components/vitrine/checkout/EtapaItens.tsx` | 111 | `linhaId` da lista do checkout |

São **6 chamadas dentro do hook** (105/107/112/125/136/145) — daí o número da issue — **mais 2 fora dele**. Total a atualizar: 8 chamadas + 1 declaração + 2 comentários.

**Dois arquivos que a issue NÃO lista e sem os quais a feature não funciona ponta a ponta:**

- `src/components/vitrine/checkout/CheckoutWizard.tsx:125` — `itensPayload = useMemo<ItemPayload[]>(...)` constrói o `ItemPayload` a partir do `ItemCarrinho` copiando **só** `produtoId`, `quantidade` e `opcionais`. É o **único** produtor de `ItemPayload` em produção (`useEnviarPedido.ts:24` só o consome). Sem propagar `observacao` aqui, `montarPayloadPedido` recebe itens sem o campo: o teste unitário de `estado.ts` passa e o checkout real **nunca envia a observação**. Este é o furo mais provável desta issue.
- `src/components/vitrine/SecaoCatalogo.tsx:93-109` — `confirmarAdicao` é o único callback ligado a `ProdutoModal.onAdicionar` (l.170) e o único chamador de `adicionar(...)` na vitrine (l.99). Mudar a assinatura de `onAdicionar` sem mudar `confirmarAdicao` deixa a observação parada no modal.

**O que já existe e será reusado (nada de novo arquivo):**

- `src/lib/constants/pedido.ts` — `LIMITE_OBSERVACAO = 200` (issue 167). Arquivo deliberadamente **sem imports** para ser seguro em `'use client'`. Usar sempre a constante, nunca o literal `200`.
- `src/lib/utils/normalizarObservacao.ts` — `normalizarObservacao(texto)`, função pura, sem zod/`server-only`, **importável no cliente**. Invariante documentada: cada passo só encurta ou mantém.
- `src/lib/validacoes/pedido.ts:26-30` — `schemaObservacao = z.string().max(LIMITE*8).transform(normalizarObservacao).pipe(z.string().max(LIMITE))`. **O servidor normaliza com a mesma função e só depois mede o teto.** Já declarado em `schemaItemPedido.observacao` (l.43) sob `.strict()`.
- `src/lib/actions/pedido.ts:133,191` — `itensSnapshot.observacao` já propaga o campo para a RPC, e `itensCalculo` (l.136-140) é estruturalmente cego a ele: o recálculo de valor não enxerga observação. **Nada a fazer no servidor nesta issue.**
- `src/hooks/useCarrinho.ts:18` — `linhaCarrinhoId`, a estender. **Proibido criar uma segunda função de chave.**
- `src/lib/utils/calcularTotal.ts` (`calcularSubtotal`) — inalterado; a observação não entra em preview de valor.

**O que precisa ser criado:** uma única função, `canonizarObservacao`, **dentro de `src/lib/utils/normalizarObservacao.ts`** (módulo existente, não arquivo novo) — justificativa na seção "Forma da chave" abaixo. Nenhum componente, hook, tipo ou util novo.

### Forma exata da chave

```ts
export function linhaCarrinhoId(
  produtoId: string,
  opcionais?: OpcionalCarrinho[],
  observacao?: string,
): string {
  const assinatura = (opcionais ?? [])
    .filter((o) => o.quantidade > 0)
    .map((o) => `${o.opcionalId}:${o.quantidade}`)
    .sort()
    .join(",");
  const obs = canonizarObservacao(observacao ?? "");
  if (!obs) return assinatura ? `${produtoId}|${assinatura}` : produtoId;
  return `${produtoId}|${assinatura}|${obs}`;
}
```

Três formas, escolhidas nesta ordem:

| Caso | Chave | Muda? |
|---|---|---|
| sem opcionais, sem observação | `produtoId` | **não** (retrocompat) |
| com opcionais, sem observação | `produtoId\|assinatura` | **não** (retrocompat) |
| com observação (com ou sem opcionais) | `produtoId\|assinatura\|obs` (`assinatura` pode ser `""`) | forma nova |

**Prova de injetividade (é o que impede fusão/multiplicação errada de linha):** `produtoId` é uuid e `assinatura` é `uuid:int` separado por vírgula — **nenhum dos dois contém `|`**. Só `obs` é texto livre e pode conter `|`. Como `obs` é o **último** segmento e vem sempre após exatamente dois `|`, a leitura da esquerda para a direita é inequívoca. Chave da forma 2 tem exatamente um `|`; chave da forma 3 tem **no mínimo dois** (`obs` é não-vazia por construção). Logo as três formas não colidem entre si nem internamente: chaves iguais ⟺ `(produtoId, assinatura, obs)` iguais.

**Decisão: a chave usa o texto CANÔNICO (normalizado), não o cru.** Justificativa em três níveis:

1. **Paridade cliente↔banco.** `schemaObservacao` (`pedido.ts:26-30`) aplica `normalizarObservacao` **antes** de medir e é o texto normalizado que a RPC grava. Com chave crua, `"sem  cebola"` e `"sem cebola"` viram **duas linhas no carrinho** que se tornam **dois itens idênticos** em `itens_pedido` — o cliente vê duas linhas iguais na comanda, no recibo e na mensagem do WhatsApp, sem entender por quê. Com chave canônica, a identidade da linha no cliente é exatamente a identidade que o servidor vai persistir.
2. **Anti-padding.** Texto cru na chave deixa qualquer sequência de espaços/`\n`/ZWSP/NBSP gerar linhas "distintas" indefinidamente — 50 linhas iguais dentro do teto de `itens: z.array(...).max(50)`, cada uma consumindo uma vaga do payload.
3. **Custo zero de acoplamento.** `normalizarObservacao` é pura, sem `zod` e sem `server-only` (comentário no topo do próprio módulo diz isso explicitamente) — importá-la no `useCarrinho` (`'use client'`) não arrasta nada para o bundle público, ao contrário do que aconteceria com `pedido.ts` (issue 163).

**Por que `canonizarObservacao` e não `normalizarObservacao` direto:**

```ts
// em src/lib/utils/normalizarObservacao.ts, junto da função que já existe
export function canonizarObservacao(texto: string): string {
  const n = normalizarObservacao(texto);
  if (n.length <= LIMITE_OBSERVACAO) return n;
  let corte = n.slice(0, LIMITE_OBSERVACAO);
  const ultimo = corte.charCodeAt(corte.length - 1);
  // Não deixar metade de par substituto: `zod .max()` conta unidades UTF-16
  // (então o corte precisa ser por unidade), mas um high surrogate solto é
  // UTF-8 inválido e o Postgres recusa o INSERT.
  if (ultimo >= 0xd800 && ultimo <= 0xdbff) corte = corte.slice(0, -1);
  return normalizarObservacao(corte);
}
```

- É **idempotente** e **só encurta** — herda a invariante de `normalizarObservacao`. Idempotência é obrigatória: a chave é recalculada a cada render a partir do valor já guardado, então `canonizar(canonizar(x)) === canonizar(x)` é o que garante que a linha não "muda de identidade" entre dois renders.
- O corte em `LIMITE_OBSERVACAO` só dispara com carrinho adulterado (o `maxLength={200}` da issue 169 + a invariante "só encurta" já garantem ≤200 no caminho normal). Sem ele, um `sessionStorage` editado no DevTools derruba o **checkout inteiro** com erro genérico (`schemaObservacao` **rejeita**, não trunca) e o cliente não tem como descobrir o motivo. É defesa de UX, não de segurança — a segurança já está no zod.
- Mora no módulo que já existe. **Não** criar `src/lib/utils/canonizarObservacao.ts`.

**Invariante de fronteira:** `adicionarItem` guarda o valor **já canonizado** (`""` → campo omitido) e `linhaCarrinhoId` canoniza de novo (barato, idempotente, protege contra item restaurado do `sessionStorage` de uma versão anterior). Assim, para todo item no estado, `chave(item) === chave(canonizar(item))`.

### Estratégia de retrocompat

**Há persistência: `sessionStorage`, chave `irango:carrinho`** (`useCarrinho.ts:9`, escrita em `emitir()` l.71, leitura em `lerStorage()` l.52). **Não** é `localStorage` — o carrinho morre ao fechar a aba, o que reduz muito a janela de exposição. `src/components/vitrine/checkout/estado.ts` persiste em `irango:checkout`, mas **só o wizard** (`EstadoWizard` não tem itens) — nada a migrar lá.

**O que é persistido é o array de `ItemCarrinho`, nunca a chave.** As chaves são derivadas no render (`Carrinho.tsx:62`, `EtapaItens.tsx:111`) e passadas na hora para `incrementar`/`decrementar`/`remover`. Consequências:

1. **Nenhuma migração de dado é necessária e nenhum bump de `CHAVE_STORAGE` é permitido.** Um item antigo desserializa sem a propriedade `observacao` → `undefined` → `canonizarObservacao("")` → `""` → cai na forma 1 ou 2, **byte a byte a chave de hoje**. A retrocompat é estrutural, não uma janela de tolerância.
2. `JSON.parse` + `Array.isArray` (l.55) já degrada para `[]` em lixo; a propriedade nova é opcional, então nenhum item antigo vira inválido.
3. O `storage` listener entre abas (l.82-87) relê e **rederiva** as chaves — não há chave velha em trânsito.
4. **Janela transitória real (aceitar e documentar, não tratar):** uma aba com o bundle antigo aberta enquanto outra aba com o bundle novo grava itens com observação. A aba velha ignora o campo e funde as duas linhas na sua própria visão. É `sessionStorage` (escopo por aba, não compartilhado entre abas independentes na maioria dos navegadores) e some no primeiro reload. Não justifica versionamento de payload.

**A retrocompat que precisa de teste explícito** é a da tabela acima: o formato das formas 1 e 2 **não pode mudar**, porque o comentário de `useCarrinho.ts:33` promete que `incrementar`/`decrementar`/`remover` aceitam `produtoId` puro e há código de produção apoiado nisso.

### Cenários

**Caminho feliz**
1. Cliente abre `ProdutoModal` do produto A, escolhe qtd 1, digita `"sem cebola"`, confirma.
2. `ProdutoModal.confirmar()` (l.145-149) chama `onAdicionar(produto.id, quantidade, opcionaisEscolhidos, observacao)`.
3. `SecaoCatalogo.confirmarAdicao` (l.93) monta o `ItemCarrinho` com `observacao` canonizada (omitida se vazia) e chama `adicionar(...)`.
4. `adicionarItem` calcula `chave = A||sem cebola`, não acha linha igual → nova linha, qtd 1.
5. Cliente reabre o mesmo produto, digita `"sem tomate"`, confirma → chave `A||sem tomate` ≠ anterior → **segunda linha**, qtd 1. `totalItens` = 2, `subtotal` = 2×preço.
6. No checkout, `CheckoutWizard.itensPayload` produz dois `ItemPayload`, cada um com sua `observacao`.
7. `montarPayloadPedido` emite `itens: [{produto_id, quantidade: 1, observacao: "sem cebola"}, {produto_id, quantidade: 1, observacao: "sem tomate"}]` — **nenhum campo monetário**.
8. `schemaPayloadPedido.safeParse` (`.strict()`) aceita; `criarPedido` recalcula preço do banco e grava os dois snapshots.

**Casos de borda**
- **Observação vazia / só espaço / só `\n`** → `canonizarObservacao` devolve `""` → campo omitido no `ItemCarrinho` e chave na forma 1/2. Item com `observacao: ""` e item sem o campo são **a mesma linha** (fundem e somam).
- **Uma linha com observação, outra sem, mesmo produto** → 2 linhas (`A` vs `A||sem cebola`).
- **Mesma observação, adições separadas** → 1 linha, quantidades somadas.
- **Mesmo texto com espaçamento diferente** (`"sem  cebola"` vs `"sem cebola"`, NBSP, CRLF vs LF) → **1 linha** (canonização) — é a decisão desta issue.
- **Observação com `|` ou `,`** (`"sem cebola | sem tomate"`) → não colide com nenhuma outra linha (ver prova de injetividade).
- **Observação com `\n`** → permitida, faz parte da chave (`"a\nb"` ≠ `"a b"` após canonização? `\n` é preservado pelo passo 2 da normalização e não colapsa em espaço → sim, linhas distintas). Coerente com o que o servidor grava.
- **Observação > 200** (só por adulteração do `sessionStorage`) → cortada em `LIMITE_OBSERVACAO` sem partir par substituto; checkout segue funcionando.
- **`sessionStorage` indisponível** (modo privado/cota) → `emitir` já degrada para memória (l.72-75); a chave não depende de storage.
- **Item antigo sem `observacao` no storage** → chave idêntica à de hoje (retrocompat).
- **Produto indisponível / loja fechada / falha de rede** → inalterados: são gates de `criarPedido` e de `useEnviarPedido`; esta issue não toca nenhum deles.

**Tratamento de erros**
Nada aqui produz erro visível: são funções puras de cliente. O único caminho de falha — observação que o servidor recusaria — é neutralizado pela canonização antes de virar payload. Se ainda assim `criarPedido` recusar, o comportamento existente vale: mensagem genérica na UI, detalhe só no log do servidor (`seguranca.md` §14). **Não** acrescentar mensagem específica de observação na vitrine.

### Schema de Banco
**Nenhuma mudança.** A coluna `itens_pedido.observacao`, o CHECK ≤200 e a RPC são da issue 166; as políticas RLS de `itens_pedido` (leitura só do dono via `itens_pedido_lojista`, escrita só pela RPC sob `service_role`) já cobrem a coluna. Nenhuma tabela nova, nenhuma policy nova.

### Validação (zod)
**Nenhum schema novo, nenhum schema alterado.** `schemaItemPedido.observacao = schemaObservacao.optional()` já existe (`pedido.ts:43`, issue 167) e é o **gate autoritativo**. Esta issue só faz o payload chegar até ele com o campo preenchido. O cliente reusa `normalizarObservacao` — a **mesma função** que o `.transform()` do zod usa — o que dá paridade exata entre preview e autoridade sem duplicar regra.

### Recálculo no Servidor
**Nada muda no recálculo, e é isso que precisa ficar provado.**
- Cliente envia: `produto_id`, `quantidade`, `opcionais[].opcional_id`, `opcionais[].quantidade`, `observacao`.
- Servidor recalcula do banco: `preco` do produto, `preco` de cada opcional, subtotal, frete, desconto, total (`actions/pedido.ts` — `itensCalculo` l.136-140 e l.194-198).
- `observacao` entra **só** em `itensSnapshot` (l.133/191) — a estrutura de cálculo não tem o campo. A observação é **estruturalmente incapaz** de mexer em valor.
- **O vetor de segurança desta issue é a QUANTIDADE**, não o texto: a chave de dedup decide quantas linhas e com que `quantidade` cada `ItemPayload` sai. Uma fusão indevida some com uma linha (cliente paga menos do que pediu); uma cisão indevida multiplica linhas (cliente paga a mais). Em ambos os casos o servidor recalcula **em cima da quantidade errada** — o recálculo é fiel ao payload, não à intenção. Por isso todo teste desta issue precisa asseverar **contagem de linhas E `quantidade` por linha**, não só a presença do texto.

### Arquivos a Criar / Modificar / NÃO tocar

**Criar**
- Nenhum arquivo de produção.
- `src/hooks/useCarrinho.test.ts` — **não existe teste para o hook hoje** (`ls src/hooks/*.test.ts` vazio). É o arquivo do RED. `vitest.config.ts` é `environment: node`, sem jsdom: testar `linhaCarrinhoId` (pura, exportada) e os mutadores via a API pública do módulo, **sem renderizar componente** (`useSyncExternalStore` não é testável sem DOM; o `sessionStorage` precisa de stub em `globalThis.window` ou de guardas `typeof window === "undefined"`, que o módulo já tem — nesse caso a store roda em memória, que é exatamente o que o teste quer).

**Modificar**
- `src/lib/utils/normalizarObservacao.ts` — acrescentar `canonizarObservacao` (importa `LIMITE_OBSERVACAO`; manter o módulo livre de `zod`/`server-only`).
- `src/lib/utils/normalizarObservacao.test.ts` — casos de `canonizarObservacao` (idempotência, corte, par substituto).
- `src/types/dominio.ts` — `ItemCarrinho.observacao?: string` (com comentário: preview canônico, servidor é a autoridade).
- `src/hooks/useCarrinho.ts` — assinatura de `linhaCarrinhoId` (l.18); as 6 chamadas (105/107/112/125/136/145) passam `i.observacao`; `adicionarItem` canoniza antes de guardar; comentários das l.11-17 e l.33 atualizados.
- `src/components/vitrine/Carrinho.tsx:62` — passar `item.observacao`.
- `src/components/vitrine/checkout/EtapaItens.tsx:111` + comentário l.36 — passar `item.observacao`.
- `src/components/vitrine/checkout/estado.ts` — `ItemPayload.observacao?: string`; `montarPayloadPedido` emite `...(i.observacao ? { observacao: i.observacao } : {})` (mesmo padrão condicional dos `opcionais`, para o campo ficar **ausente** e não `undefined`).
- `src/components/vitrine/checkout/CheckoutWizard.tsx:125-140` — `itensPayload` propaga `observacao` (**sem isto a feature não sai do cliente**).
- `src/components/vitrine/ProdutoModal.tsx` — 4º parâmetro `observacao?: string` em `onAdicionar` (l.45-49) e na chamada de `confirmar()` (l.147). **Só o contrato**; o `<textarea>` é a issue 169, então por ora passa `undefined`/estado ainda inexistente.
- `src/components/vitrine/SecaoCatalogo.tsx:93-109` — `confirmarAdicao` recebe e repassa `observacao` para `adicionar`.
- `src/components/vitrine/checkout/estado.test.ts` — casos de `observacao` no payload.

**NÃO tocar**
- `src/lib/validacoes/pedido.ts` — o gate já está pronto (167). Mexer aqui é escopo da 167.
- `src/lib/actions/pedido.ts` — snapshot e recálculo já corretos (167).
- `src/lib/utils/calcularTotal.ts` — a observação não entra em valor.
- `supabase/migrations/**` e a RPC — issue 166.
- `src/components/ui/**` — gerado pelo shadcn CLI.
- `src/lib/database.types.ts` — gerado.
- Qualquer render da observação (drawer, `EtapaItens`, WhatsApp, painel) — issues 169/170/171. Esta issue **não** mostra o texto em lugar nenhum.

### Dependências Externas
**Nenhuma.** Nenhum pacote novo, nenhuma API externa, nenhuma chamada de rede. Custo por chamada: R$ 0. Quota consumida: nenhuma (sem Upstash, sem Nominatim, sem Sentry adicional, sem função serverless nova). Impacto de bundle: `normalizarObservacao` é um módulo de ~7 regex sem dependências, já elegível ao bundle público por construção (o comentário do próprio arquivo declara isso) — acréscimo em `/loja/[slug]` na casa de centenas de bytes, sem risco de repetir a regressão da issue 163 (63,8 KB de zod). Nenhum comportamento novo em caso de falha de serviço porque não há serviço.

### Cenários de teste para o `tdd` (fase RED)

`src/hooks/useCarrinho.test.ts` — chave e quantidade:
1. `linhaCarrinhoId("A")` === `"A"` (**retrocompat**, forma 1).
2. `linhaCarrinhoId("A", [{opcionalId:"x",quantidade:1,...}])` === `"A|x:1"` (**retrocompat**, forma 2) — e continua estável se a ordem dos opcionais inverter.
3. `linhaCarrinhoId("A", undefined, "sem cebola")` ≠ `linhaCarrinhoId("A")` e ≠ `linhaCarrinhoId("A", undefined, "sem tomate")`.
4. `linhaCarrinhoId("A", undefined, "")`, `" "`, `"\n"`, `undefined` → todos `"A"`.
5. `linhaCarrinhoId("A", undefined, "sem  cebola")` === `linhaCarrinhoId("A", undefined, " sem cebola ")` (canonização).
6. Injetividade sob texto adverso: obs `"x:1"`, `"|"`, `"a|b"`, `","` não colidem com nenhuma chave de forma 1/2 do mesmo produto nem entre si.
7. `adicionar` × 2, mesmo produto, mesmos opcionais, **observações diferentes** → `itens.length === 2`, cada uma `quantidade === 1`, cada uma com sua `observacao`.
8. `adicionar` × 2, mesmo produto, **mesma** observação → `itens.length === 1`, `quantidade === 2`.
9. `adicionar` com observação e depois sem → 2 linhas.
10. `incrementar` / `decrementar` / `remover` com a chave de forma 3 afetam **só** a linha certa e não tocam a linha de mesmo produto com outra observação.
11. `incrementar`/`remover` com `produtoId` puro continuam funcionando na linha sem opcionais e sem observação (**retrocompat de comportamento**, não só de formato).
12. Item restaurado do estado sem a propriedade `observacao` (simula `sessionStorage` de versão anterior) → mesma chave de hoje e `incrementar` funciona.
13. `decrementar` até 0 remove só aquela linha.

`src/lib/utils/normalizarObservacao.test.ts` — `canonizarObservacao`:
14. Idempotência: `canonizar(canonizar(x)) === canonizar(x)` para entradas adversas (200+ chars, NBSP, `\r\n`, ZWSP, RLO).
15. Nunca expande: `canonizar(x).length <= x.length`.
16. `>LIMITE_OBSERVACAO` → resultado com `length <= LIMITE_OBSERVACAO` (constante importada, **nunca** o literal 200).
17. Corte no meio de par substituto não deixa high surrogate solto (`/[\uD800-\uDBFF]$/` não casa).

`src/components/vitrine/checkout/estado.test.ts` — payload:
18. `montarPayloadPedido` com item com observação → `itens[0].observacao` presente com o texto.
19. Item **sem** observação → a chave `observacao` **não existe** no objeto (`"observacao" in item === false`), não `undefined`.
20. O payload continua sem qualquer campo monetário (estender a asserção que já existe no arquivo, não criar outra).
21. O payload com observação **passa** por `schemaPayloadPedido.safeParse` (`.strict()`) — prova de que o contrato do cliente casa com o gate do servidor da 167.
22. Uma observação de exatamente `LIMITE_OBSERVACAO` caracteres canônicos sobrevive ao `safeParse` (o cliente nunca produz payload que o servidor recusa por tamanho).

Gate mecânico do RED: `npx vitest run src/hooks/useCarrinho.test.ts src/components/vitrine/checkout/estado.test.ts src/lib/utils/normalizarObservacao.test.ts` com `FAIL` capturado **antes** de qualquer linha de produção.

### Ordem de Implementação

1. **RED (`tdd`)** — escrever os 22 casos acima e capturar o `FAIL`. Obrigatório: `crítica: SIM`, e o defeito que a issue previne (fusão silenciosa de linha) é invisível sem teste.
2. `canonizarObservacao` em `src/lib/utils/normalizarObservacao.ts` — base de tudo; casos 14-17 viram verdes primeiro e provam a idempotência de que a chave depende.
3. `ItemCarrinho.observacao` em `src/types/dominio.ts` — o tipo destrava o resto sem quebrar nada (campo opcional).
4. `linhaCarrinhoId` + as 6 chamadas do hook + canonização no `adicionarItem` + comentários das l.11-17 e l.33 — casos 1-13.
5. As 2 chamadas fora do hook (`Carrinho.tsx:62`, `EtapaItens.tsx:111` + comentário l.36) — o TypeScript não obriga (parâmetro opcional), então é o ponto onde um esquecimento passa batido pelo build: conferir com `grep -rn "linhaCarrinhoId(" src/`.
6. `ItemPayload` + `montarPayloadPedido` em `estado.ts` — casos 18-22.
7. `CheckoutWizard.itensPayload` — depende de 3 e 6; **sem este passo os testes ficam verdes e o app não envia a observação**.
8. `ProdutoModal.onAdicionar` (contrato) → `SecaoCatalogo.confirmarAdicao` (repasse) — fecha a ponta de entrada para a issue 169 plugar o `<textarea>` sem tocar em contrato.
9. Gates: `npx vitest run` dos 3 arquivos → `grep -rn "linhaCarrinhoId(" src/` (todas as 8 chamadas na assinatura nova) → `grep -rn "200" src/hooks/useCarrinho.ts src/lib/utils/normalizarObservacao.ts` (só a constante importada, zero literal) → `npm run build` → `npm test`.
10. `revisar` ‖ `testar`. **Sem `auditar`** (decisão do `plan/loop-...` §5 passo 5: é estado de cliente e a autoridade de tamanho/valor foi auditada na 167) — mas se o `revisar` apontar qualquer divergência entre a canonização do cliente e a do `schemaObservacao`, escalar para `auditar`.

### Riscos residuais
- **Alto:** esquecer `CheckoutWizard.tsx:125`. Teste unitário não pega. Mitigação: passo 7 explícito + `verificar` ponta a ponta no fim do loop da spec.
- **Médio:** parâmetro novo é **opcional**, então uma chamada esquecida compila e roda — só produz fusão silenciosa. Mitigação: gate de `grep` no passo 9 e casos 7-10.
- **Baixo:** divergência futura se alguém mudar `normalizarObservacao` sem lembrar que agora ela também define identidade de linha no carrinho. Mitigação: comentário no topo da função registrando os dois consumidores.
