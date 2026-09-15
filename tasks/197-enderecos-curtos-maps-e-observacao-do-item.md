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
