# [197] Endereços curtos + link do Maps na confirmação + observação do item visível

**crítica:** NÃO — não toca dinheiro, RLS, cupom, token nem autorização.
Mesmo assim **`tdd` antes e `auditar` depois**: o diff encosta em
`whatsappPedido.ts` (consumido pelo caminho que grava o pedido), muda qual PII do
comprador aparece e em quais telas, e acrescenta um link externo numa página cuja
URL carrega o `token_acesso`.
**Mundo:** vitrine pública (`/loja/[slug]/pedido`, `/loja/[slug]/confirmacao`),
sem login.
**Depende de:** nada (bloqueio duro). Adjacente a `tasks/193` — loja publicada sem
endereço já existe hoje; o fallback (RN-R5) cobre isso.
**Origem:** pedido literal do dono do produto, 2026-09-15 (ver
`plan/loop-enderecos-curtos-e-descricao-de-itens.md` §0). Plano gerado pelo
agente `orquestrar` em três revisões.
**Spec:** `specs/retirada-endereco-da-loja.md` v0.3.0 — nomeia arquivo, linha,
regra de negócio e teste de regressão para o bloco A. O bloco B (observação) não
tem spec própria: o dado já existe ponta a ponta (issues 167/168), só falta
renderizar.

## Pedido literal

> "1 - quando comprador seleciona retirar na loja, exibir na tela mensagem com o
> endereço da loja (rua, número e bairro). Na página de confirmação do pedido que
> comprador vê, exibir o endereço no mesmo formato. Na mensagem que vai pelo
> whatsapp, exibir o endereço da loja no mesmo formato.
> 2 - quando comprador seleciona receber em casa, nos endereços que são exibidos
> na confirmação da compra e na mensagem pelo whtsapp, cidade e estado e CEP são
> desnecessários, bastam rua, número e bairro.
> 3 - na sidebar, na descrição de itens do pedido (que mora em finalizar pedido
> /loja/paodociso/pedido), bem como na confirmação do pedido vista pelo
> comprador, a descrição de cada item não aparece. Exiba."

Item 3, esclarecido pelo dono depois de uma leitura errada do plano: é a
**observação livre que o comprador escreve por item** (`itens_pedido.observacao`
— "sem cebola", "ponto da carne"), não a descrição do produto cadastrada pelo
lojista.

Aparece nas **três telas do comprador**: gaveta lateral (`Carrinho.tsx`), lista do
checkout (`EtapaItens.tsx`) e confirmação (`confirmacao/page.tsx`) — decisão do
dono do produto, 2026-09-15.

## Por que uma issue e não três

Bloco A e bloco B editam o mesmo arquivo, `confirmacao/page.tsx` (endereço/link
~240–291, itens ~174–200). Issues separadas significariam vários `executar` e
vários trios de revisão sobre o mesmo arquivo, com risco de conflito e um gate
global que não particiona a culpa entre agentes.

## Bloco A — endereços curtos + link do Google Maps

**Arquivos:**
- `src/lib/utils/enderecoLoja.ts` (novo) + `.test.ts` — formato curto
  `{rua}, {numero} · {bairro}` (RN-R1), adaptador para a loja (`lojas`/
  `vitrine_lojas`) e adaptador para o JSONB `endereco_entrega` do cliente
  (substitui as duas cópias de `formatarEndereco`), e o montador puro do href do
  Maps (reusa `montarConsultaGeocoding` de `patches-loja.ts` — RN-R6, **sem CEP**,
  `null` sem cidade+estado).
- `src/lib/utils/whatsappPedido.ts` + `.test.ts` — consome o util novo; alarga o
  `Pick` do parâmetro `loja` com `Partial<Pick<LojaCompleta, ...endereço>>` (não
  exigir as seis colunas quebra os testes existentes com literais `{nome,
  whatsapp}`); acrescenta `Retirar em: <endereço curto>` em retirada (só com
  endereço); encurta a linha `Endereço:` em entrega (RN-R7). Todo o resto da
  mensagem **byte a byte igual**, travado por teste antes da edição.
- `src/components/vitrine/confirmacao/LinkMapsLoja.tsx` (novo) + `.test.tsx` —
  apresentacional, `target="_blank" rel="noopener noreferrer"` (copiar
  `StatusAssinatura.test.tsx:266-269`), `href` com origem literal no código e só a
  consulta interpolada via `encodeURIComponent`. Extraído porque
  `confirmacao/page.tsx` é Server Component `async` e não é alcançável por
  `renderToStaticMarkup`.
- `src/app/(publica)/loja/[slug]/confirmacao/page.tsx` — remove a cópia local do
  formatador, usa o util novo, acrescenta o bloco de endereço da loja em retirada
  + `<LinkMapsLoja>`.
- `src/app/(publica)/loja/[slug]/pedido/page.tsx` — deriva `enderecoLoja` de
  `loja` (já carregada por `buscarLojaPorSlug`), mesmo padrão de onde
  `preAbrirWhatsapp` é derivado.
- `src/components/vitrine/checkout/CheckoutWizard.tsx` — repassa `enderecoLoja`
  às **duas** instâncias de `EtapaEntrega` (~229 celular, ~292 computador).
- `src/components/vitrine/checkout/EtapaEntrega.tsx` — renderiza o bloco em
  retirada, reusando as classes do aviso já existente (~linha 174). **Sem link do
  Maps aqui** — RN-R6 proíbe link externo no checkout.

**Proibidos (gate mecânico — se aparecerem no diff, é escopo vazado):**
`src/lib/actions/pedido.ts`, `src/lib/actions/pedido.test.ts` (roda como
regressão `[071]`, não se edita), `src/lib/actions/patches-loja.ts` (consumido,
não alterado), `src/components/painel/**`, `supabase/migrations/**`,
`src/lib/supabase/queries/**`, `src/lib/validacoes/**`.

## Bloco B — observação do comprador, visível nas três telas

**Arquivos:**
- `src/components/vitrine/ObservacaoItem.tsx` (novo) + `.test.tsx` — espelha
  `ListaOpcionaisItem` (mesmo padrão: apresentacional, `null`/vazia/só-espaços →
  `return null`, `whitespace-pre-line`, texto do cliente via JSX — auto-escapado,
  nunca `dangerouslySetInnerHTML`).
- `src/components/vitrine/Carrinho.tsx` — plugar `<ObservacaoItem>` logo abaixo
  de `<ListaOpcionaisItem>` (é a gaveta lateral / `Sheet`).
- `src/components/vitrine/checkout/EtapaItens.tsx` — mesma inserção (hoje só lê
  `item.observacao` para a chave de dedup, nunca renderiza).
- `src/app/(publica)/loja/[slug]/confirmacao/page.tsx` — mesma inserção no `map`
  de `ped.itens_pedido` (~linha 174).

Nada a fazer em `whatsappPedido.ts` para este bloco — a observação **já sai** na
mensagem (`whatsappPedido.ts:91`).

## Gates (rodar entre os blocos e no fim)

- `npx tsc --noEmit` → 0 erros
- `npm run lint` → 0 erros
- `npx vitest run` nos alvos **+ `src/lib/actions/pedido.test.ts`** (regressão
  `[071]`: `p_taxa_entrega=0` e `p_endereco_entrega: null` em retirada — D4,
  intocável) **+ `patches-loja.test.ts`** (regressão de `montarConsultaGeocoding`,
  que passa a ter um segundo caller)
- `npm run build` → sucesso
- `git diff --name-only` ⊆ arquivos listados acima, **sem** `src/components/painel/`

## Pauta do `auditar`

1. `[071]` de `pedido.test.ts` verdes e **não editados**.
2. Observação e endereço renderizados como filho de JSX, nunca
   `dangerouslySetInnerHTML`, nunca em `href`/`src`/atributo.
3. Texto do **lojista** (`endereco_rua` etc.) no corpo da mensagem de WhatsApp —
   consegue forjar linha de sistema? Comparar com `citarTextoCliente`, que hoje
   protege só o texto do cliente.
4. 🔴 `token_acesso`: nenhum parâmetro de `searchParams` chega à URL do Maps; o
   teste do `rel="noreferrer"` está presente e nomeia o motivo (impede o
   `Referer` de entregar a URL da confirmação, com o token, ao Google).
5. 🔴 `href` do Maps: esquema e domínio são literais no código; só a consulta é
   interpolada, sempre por `encodeURIComponent`; nenhum valor de banco ocupa a
   posição de esquema/domínio.
6. A redução de exibição não removeu **coleta** nem **gravação** de
   cidade/estado/CEP (o frete depende do CEP).
7. O endereço da loja segue exibição pura: não entra em `montarPayloadPedido`,
   não é persistido, não influencia frete, cupom ou total; nenhuma
   `latitude`/`longitude` exposta.

## Verificação (`/loja/paodociso`, duas larguras)

1. "Retirada no local" → bloco com `rua, número · bairro`, sem link no checkout.
2. Pedido de retirada confirmado → confirmação mostra endereço **e** link do
   Maps; clicar de verdade abre em nova aba no endereço certo.
3. Pedido de entrega → confirmação e WhatsApp sem cidade/estado/CEP; mensagem de
   retirada traz `Retirar em: ...`.
4. Item **com observação** → aparece na gaveta, na lista do checkout e na
   confirmação.
5. Pré-checagem: "Pão do Ciso" precisa ter endereço **com cidade e estado** — sem
   isso aparece o fallback sem link (preencher pelo painel, nunca escrita direta
   no banco).

## Fora do escopo desta issue

Tudo que `specs/retirada-endereco-da-loja.md` v0.3.0 lista em "Fora do escopo":
mapa embutido, coordenadas, geocoding pelo iRango, link no checkout, distância
estimada, endereço obrigatório para publicar, endereço na vitrine pública,
personalizar texto da mensagem, horário de retirada.


## RED — output real

Fase RED executada em 2026-09-15 na branch `feat/enderecos-curtos-maps-e-observacao`.
**Nenhum código de produção foi escrito** — nem os três arquivos novos, nem a
edição de `whatsappPedido.ts`.

### Arquivos de teste criados / editados

- `src/lib/utils/enderecoLoja.test.ts` (novo) — RN-R1 (loja + cliente) e RN-R5/RN-R6 (href do Maps)
- `src/lib/utils/whatsappPedido.test.ts` (editado, só APPEND ao final) — trava de
  regressão byte a byte (RN-R7) + comportamento novo
- `src/components/vitrine/confirmacao/LinkMapsLoja.test.tsx` (novo)
- `src/components/vitrine/ObservacaoItem.test.tsx` (novo)

### Leitura do vermelho

`Test Files 4 failed (4)` — `Tests 5 failed | 18 passed (23)`.

- **3 suítes inteiras vermelhas por `ERR_MODULE_NOT_FOUND`**: `enderecoLoja.ts`,
  `LinkMapsLoja.tsx` e `ObservacaoItem.tsx` ainda não existem. Não foi criado stub
  (instrução explícita da sessão: zero código de produção nesta fase).
- **5 asserções vermelhas em `whatsappPedido.test.ts`** — o comportamento novo da RN-R7.
- **As 2 travas de regressão byte a byte estão VERDES e devem continuar verdes** depois
  do GREEN: são o alarme do "todo o resto da mensagem permanece idêntico".
  Os 18 testes pré-existentes do arquivo (observação por item, anti-injeção `[180-B]`)
  seguem verdes — nenhuma falha pré-existente na suíte.
- `npx tsc --noEmit` acusa **exatamente** os 3 `TS2307` dos módulos ausentes e nada mais
  (a `loja` de teste é passada como variável, não literal inline — evita excess property
  check antes do GREEN alargar o `Pick`).

### Output (`npx vitest run` nos 4 arquivos, `--reporter=verbose`)

```

 RUN  v4.1.9 /home/lenovo/github/irango

 ✓ src/lib/utils/whatsappPedido.test.ts > montarLinkWhatsappPedido — observação por item > retorna null quando a loja não tem WhatsApp 2ms
 ✓ src/lib/utils/whatsappPedido.test.ts > montarLinkWhatsappPedido — observação por item > acrescenta a linha obs depois do item e dos opcionais 1ms
 ✓ src/lib/utils/whatsappPedido.test.ts > montarLinkWhatsappPedido — observação por item > item com observacao null não gera linha nem rótulo vazio 0ms
 ✓ src/lib/utils/whatsappPedido.test.ts > montarLinkWhatsappPedido — observação por item > totais são idênticos com e sem observação 1ms
 ✓ src/lib/utils/whatsappPedido.test.ts > montarLinkWhatsappPedido — observação por item > observação com caracteres especiais gera href válido 1ms
 ✓ src/lib/utils/whatsappPedido.test.ts > montarLinkWhatsappPedido — anti-injeção de rótulo > não deixa o cliente forjar uma linha Total: pela observação do pedido 0ms
 ✓ src/lib/utils/whatsappPedido.test.ts > montarLinkWhatsappPedido — anti-injeção de rótulo > não deixa o cliente forjar uma linha Pagamento: pela observação do item 0ms
 ✓ src/lib/utils/whatsappPedido.test.ts > montarLinkWhatsappPedido — anti-injeção de rótulo > cita todas as linhas do texto do cliente 0ms
 ✓ src/lib/utils/whatsappPedido.test.ts > [180-B] montarLinkWhatsappPedido — frete a combinar não é 'R$ 0,00' nem 'Grátis' > frete_a_combinar=true + taxa_entrega=null (entrega) → linha 'Entrega: A combinar', nunca R$ 0,00 1ms
 ✓ src/lib/utils/whatsappPedido.test.ts > [180-B] montarLinkWhatsappPedido — frete a combinar não é 'R$ 0,00' nem 'Grátis' > retirada com frete_a_combinar=false + taxa_entrega=0 continua dizendo 'Grátis' (não regride para 'A combinar') 0ms
 ✓ src/lib/utils/whatsappPedido.test.ts > [180-B] montarLinkWhatsappPedido — frete a combinar não é 'R$ 0,00' nem 'Grátis' > entrega com frete conhecido (frete_a_combinar=false, taxa 8) continua mostrando o valor formatado 0ms
 ✓ src/lib/utils/whatsappPedido.test.ts > [197] RN-R7 regressão — o resto da mensagem é byte a byte igual > retirada, loja SEM endereço: mensagem inteira idêntica ao formato de hoje 0ms
 ✓ src/lib/utils/whatsappPedido.test.ts > [197] RN-R7 regressão — o resto da mensagem é byte a byte igual > entrega: tudo menos a linha `Endereço:` é idêntico ao formato de hoje 0ms
 ✓ src/lib/utils/whatsappPedido.test.ts > [197] RN-R7 regressão — o resto da mensagem é byte a byte igual > acrescentar o endereço da loja não muda nenhuma outra linha da retirada 1ms
 × src/lib/utils/whatsappPedido.test.ts > [197] RN-R7 retirada — linha `Retirar em:` com o endereço curto da loja > loja COM endereço → linha `Retirar em: rua, numero · bairro` 5ms
   → expected [ 'Novo pedido iRango', …(21) ] to include 'Retirar em: Rua da Padaria, 45 · Vila…'
 × src/lib/utils/whatsappPedido.test.ts > [197] RN-R7 retirada — linha `Retirar em:` com o endereço curto da loja > a linha vem logo DEPOIS de `Entrega: Retirada no local` (RN-R7) 3ms
   → expected 'Cliente: Cliente Teste — (11) 98888-7…' to be 'Retirar em: Rua da Padaria, 45 · Vila…' // Object.is equality
 × src/lib/utils/whatsappPedido.test.ts > [197] RN-R7 retirada — linha `Retirar em:` com o endereço curto da loja > o endereço da loja sai no formato CURTO — sem cidade, estado nem CEP (RN-R1) 1ms
   → expected undefined to be defined
 ✓ src/lib/utils/whatsappPedido.test.ts > [197] RN-R7 retirada — linha `Retirar em:` com o endereço curto da loja > loja SEM endereço → NENHUMA linha `Retirar em:` (RN-R5: nunca '—', nunca linha vazia) 0ms
 ✓ src/lib/utils/whatsappPedido.test.ts > [197] RN-R7 retirada — linha `Retirar em:` com o endereço curto da loja > loja com endereço só de espaços → NENHUMA linha `Retirar em:` 0ms
 ✓ src/lib/utils/whatsappPedido.test.ts > [197] RN-R7 retirada — linha `Retirar em:` com o endereço curto da loja > em ENTREGA nunca aparece `Retirar em:`, mesmo com a loja tendo endereço (RN-R3) 0ms
 × src/lib/utils/whatsappPedido.test.ts > [197] RN-R7 entrega — endereço do cliente encurta (sem cidade/estado/CEP) > linha `Endereço:` no formato curto `rua, numero · bairro` 1ms
   → expected [ 'Novo pedido iRango', …(22) ] to include 'Endereço: Rua das Flores, 100 · Centro'
 × src/lib/utils/whatsappPedido.test.ts > [197] RN-R7 entrega — endereço do cliente encurta (sem cidade/estado/CEP) > a linha `Endereço:` não traz cidade, estado nem CEP (pedido literal, item 2) 1ms
   → expected 'Endereço: Rua das Flores, 100 · Centr…' not to contain 'Campinas'
 ✓ src/lib/utils/whatsappPedido.test.ts > [197] RN-R7 entrega — endereço do cliente encurta (sem cidade/estado/CEP) > endereço parcial (sem bairro) → sem separador '·' órfão 1ms

 Test Files  4 failed (4)
      Tests  5 failed | 18 passed (23)
   Start at  09:14:39
   Duration  341ms (transform 220ms, setup 0ms, import 134ms, tests 23ms, environment 0ms)
```

### Contrato para a fase GREEN (`executar`)

**1. `src/lib/utils/enderecoLoja.ts` (criar)**

```ts
export function formatarEnderecoLoja(loja: {
  endereco_rua?: string | null; endereco_numero?: string | null;
  endereco_bairro?: string | null; endereco_cidade?: string | null;
  endereco_estado?: string | null; endereco_cep?: string | null;
}): string | null

/** Adaptador do JSONB `pedidos.endereco_entrega` — chaves rua/numero/bairro/cidade/estado/cep. */
export function formatarEnderecoCliente(endereco: unknown): string | null

/** `https://www.google.com/maps/search/?api=1&query=` + encodeURIComponent(montarConsultaGeocoding(loja)). */
export function montarHrefMapsLoja(loja: /* mesmas colunas */): string | null
```

- Formato: `{rua}, {numero} · {bairro}`; `trim()` por parte; separador só entre
  partes presentes; tudo vazio → `null` (nunca `"—"`, nunca `""`).
- `montarHrefMapsLoja` **reusa** `montarConsultaGeocoding` de
  `src/lib/actions/patches-loja.ts` (não reimplementar, não editar aquele arquivo):
  ela já exclui o CEP e devolve `null` sem cidade **e** estado.
- Origem do href **literal no código**; só a consulta é interpolada, sempre por
  `encodeURIComponent`. A função só pode ler chaves `endereco_*` — nada de
  `searchParams`.

**2. `src/lib/utils/whatsappPedido.ts` (editar)**

- Alargar o 2º parâmetro para
  `Pick<LojaCompleta, "nome" | "whatsapp"> & Partial<Pick<LojaCompleta, "endereco_rua" | "endereco_numero" | "endereco_bairro" | "endereco_cidade" | "endereco_estado" | "endereco_cep">>`.
- Em `retirada`: se `formatarEnderecoLoja(loja)` !== null, empurrar
  `` `Retirar em: ${...}` `` **imediatamente após** `Entrega: Retirada no local`.
  Se `null`, **nenhuma linha**.
- Em `entrega`: a linha `Endereço:` passa a usar `formatarEnderecoCliente`.
- Remover a `formatarEndereco` local (linha 33) — a mesma consolidação vale para
  `confirmacao/page.tsx:60`.
- Tudo o mais **intocado** — as duas travas de regressão quebram se algo mais mudar.

**3. `src/components/vitrine/confirmacao/LinkMapsLoja.tsx` (criar)**

```tsx
export function LinkMapsLoja({ loja }: { loja: /* colunas endereco_* */ | null })
```
`target="_blank"`, `rel="noopener noreferrer"`, texto com "nova aba" para leitor de
tela, `href` de `montarHrefMapsLoja`; `null` (nada no DOM) quando o href é `null`
ou `loja` é `null`.

**4. `src/components/vitrine/ObservacaoItem.tsx` (criar)**

```tsx
export function ObservacaoItem({ observacao, className }: {
  observacao: string | null | undefined; className?: string;
})
```
Rótulo `Obs` (mesmo do painel), `whitespace-pre-line`, texto como filho de JSX
(auto-escapado), `return null` para `null`/`undefined`/vazia/só-espaços/só-quebras.

### Casos descobertos durante o RED

1. **`formatarMoeda` usa NBSP (U+00A0) entre `R$` e o valor.** As duas travas de
   regressão só fecham byte a byte com `"R$\u00A023,00"`. Quem editar
   `whatsappPedido.ts` não pode normalizar espaço na mensagem — quebraria a trava.
2. **A trava de retirada usa uma loja SEM endereço de propósito.** Assim ela
   congela a mensagem de hoje e continua válida depois do GREEN (RN-R5: sem
   endereço, nenhuma linha nova). A trava de entrega compara a mensagem inteira
   **menos** a linha `Endereço:`, a única que a RN-R7 autoriza mudar.
3. **`formatarEnderecoLoja` e `formatarEnderecoCliente` têm paridade testada**
   (mesmo endereço nos dois shapes → mesma string). É o teste anti-drift da
   RN-R2 entre a exibição da loja e a do cliente.
4. **Consulta ≠ exibição (RN-R6) fica explícita nos testes**: a tela mostra
   `Rua da Padaria, 45 · Vila Nova`; a consulta do Maps é
   `Rua da Padaria, 45, Vila Nova, Campinas - SP, Brasil`. Não é contradição —
   está asserido nos dois lados.
5. **Nenhum stub foi criado.** As 3 suítes falham por resolução de módulo, não por
   asserção. Assim que o GREEN criar os arquivos, o vermelho vira asserção real.

## GREEN

Fase GREEN executada em 2026-09-15 na branch `feat/enderecos-curtos-maps-e-observacao`,
sobre o vermelho do commit `35b6666`. Nenhum commit feito — a sessão principal revisa.

### Arquivos tocados

**Criados**
- `src/lib/utils/enderecoLoja.ts` — `formatarEnderecoLoja`, `formatarEnderecoCliente`,
  `montarHrefMapsLoja` (+ tipo `EnderecoColunasLoja`). Origem do Maps literal na
  constante `ORIGEM_MAPS`; consulta 100% delegada a `montarConsultaGeocoding`.
- `src/components/vitrine/confirmacao/LinkMapsLoja.tsx` — recebe `loja`, monta o href
  internamente, `target="_blank" rel="noopener noreferrer"`, `sr-only` "(abre em nova aba)".
- `src/components/vitrine/ObservacaoItem.tsx` — rótulo `Obs:`, `whitespace-pre-line`,
  texto como filho de JSX, `return null` para vazio/só-espaços.

**Modificados**
- `src/lib/utils/whatsappPedido.ts` — `Pick` alargado com
  `Partial<Pick<LojaCompleta, endereco_*>>`; linha `Retirar em:` em retirada (só com
  endereço); `Endereço:` do cliente passa a usar `formatarEnderecoCliente` (fallback `—`
  preservado); `formatarEndereco` local REMOVIDA.
- `src/app/(publica)/loja/[slug]/confirmacao/page.tsx` — cópia local de `formatarEndereco`
  REMOVIDA; bloco "Endereço para retirada" + `<LinkMapsLoja>`; `<ObservacaoItem>` no map de itens.
- `src/app/(publica)/loja/[slug]/pedido/page.tsx` — deriva `enderecoLoja` de `loja`.
- `src/components/vitrine/checkout/CheckoutWizard.tsx` — prop `enderecoLoja` nas DUAS
  instâncias de `EtapaEntrega` (celular e computador).
- `src/components/vitrine/checkout/EtapaEntrega.tsx` — bloco de retirada reusando as classes
  do aviso existente, com `MapPin`. Sem link do Maps (RN-R6).
- `src/components/vitrine/Carrinho.tsx`, `src/components/vitrine/checkout/EtapaItens.tsx` —
  `<ObservacaoItem>` plugado. Em `EtapaItens` fica FORA do bloco `opcionais.length > 0`:
  item sem opcional também pode ter observação.
- ⚠️ `src/components/vitrine/ObservacaoItem.test.tsx` — **uma** asserção corrigida (ver abaixo).

### Correção de um teste do RED (única edição de teste)

`"<img onerror> não vira elemento no DOM"` pedia `expect(html).not.toContain("onerror=")`.
Nenhuma renderização FIEL do texto do cliente satisfaz isso: o React escapa `<`, `>` e `"`,
não o `=`, então o literal `onerror=` sobrevive dentro do nó de TEXTO. A asserção foi
trocada por `not.toContain('<img src=x onerror="')` + `toContain("onerror=&quot;alert(1)&quot;&gt;")`,
que provam o que o título do teste diz (não abre elemento; payload escapado) sem exigir
mutilar o texto do comprador. As demais 12 asserções do arquivo ficaram intactas.

### Gates

```
npx tsc --noEmit   → 0 erros
npm run lint       → ✖ 1 problem (0 errors, 1 warning)
                     (warning pré-existente em admin/assinantes/nova/FormNovaLoja.tsx,
                      react-hooks/incompatible-library — não tocado por esta issue)
npx vitest run     → Test Files 217 passed (217) | Tests 3487 passed (3487)
npm run build      → exit code 0 (build succeeded)
```

Alvos individuais (Bloco A, antes do Bloco B): `enderecoLoja.test.ts` +
`whatsappPedido.test.ts` + `LinkMapsLoja.test.tsx` + `pedido.test.ts` +
`patches-loja.test.ts` → **5 arquivos, 232 testes, todos PASS**. `pedido.test.ts` NÃO
foi editado (`git diff --name-only` confirma).

`git diff --name-only` ⊆ lista permitida; nenhum arquivo proibido
(`pedido.ts`, `pedido.test.ts`, `patches-loja.ts`, `components/painel/**`,
`supabase/migrations/**`, `queries/**`, `validacoes/**`).

### Mandatos

- **Nunca confiar no cliente:** nenhum valor monetário tocado. O endereço da loja é
  exibição pura — não entra em payload, frete, cupom nem total, e nunca em `podeAvancar`/
  `podeConfirmar`. `[071]` verde e intocado.
- **RLS / PII:** nenhuma query, view ou policy alterada. Nada novo exposto ao `anon`
  (endereço da loja já vive em `vitrine_lojas`). A exibição do endereço do cliente
  ENCURTOU (menos PII na tela); coleta e gravação inalteradas.
- **Não reinventar:** `montarConsultaGeocoding` reusado (CEP fora + gate cidade/estado);
  duas cópias de `formatarEndereco` consolidadas em um único util.
- **XSS / URL:** esquema e domínio do Maps literais; só a consulta interpolada por
  `encodeURIComponent`; nenhum `searchParams` (nem `token_acesso`) alcança o href.
