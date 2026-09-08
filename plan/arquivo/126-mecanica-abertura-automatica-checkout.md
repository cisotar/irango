## Plano Técnico

> Escopo desta issue: **mecânica de UI no cliente**. A DECISÃO e o CONTEÚDO do
> link já são do servidor (issue 125, commit `8235522`). Nada aqui altera valor,
> permissão ou dado — só reage ao que `criarPedido` devolveu.

### Análise do Codebase

**Já existe — SERÁ REUSADO (verificado por leitura, não por suposição):**

- `src/lib/actions/pedido.ts:46` — `ResultadoCriarPedido = { pedidoId; token_acesso;
  whatsappHref: string | null } | { erro: string }`. O bloco `(9)` (linhas ~346-368)
  já decide server-side: `loja.whatsapp_envio_automatico === true && loja.whatsapp`
  → relê a linha GRAVADA (`buscarPedidoPorToken`) → `montarLinkWhatsappPedido(...).href`.
  Try/catch próprio (best-effort). **NÃO TOCAR.**
- `src/components/vitrine/checkout/useEnviarPedido.ts` — único lugar que chama
  `criarPedido`; hoje ignora `whatsappHref`. É o ponto de extensão (não duplicar submit).
- `src/components/vitrine/checkout/estado.ts` — precedente de **módulo neutro** da
  pasta (sem `"use client"`/`"use server"`), com guards `typeof window === "undefined"`
  (linhas 178/189) e teste em `estado.test.ts` rodando em `environment: node`.
- `src/components/vitrine/confirmacao/StatusPedidoLive.tsx` + `.test.tsx` —
  **precedente exato do problema de teste desta issue**: mecânica de browser
  extraída para um controlador framework-agnóstico com **deps injetadas**
  (`DepsPolling`), testado sem montar React, e `vi.stubGlobal("window", ...)`
  para o que sobra. Também há precedente em
  `src/components/painel/SeletorImprimirPedido.test.tsx:32` (`vi.stubGlobal("window",
  { print, addEventListener })`).
- `src/lib/utils/urlHttpsSegura.ts` — `urlHttpsSegura(url?): string | null`, fonte
  ÚNICA da invariante anti-XSS §15 (só passa `https://`). **Reusar** como guard do
  `href` antes de atribuir a `janela.location.href` (defesa em profundidade — o
  href vem do servidor, mas §15 manda validar protocolo de toda URL derivada do banco).
  Não escrever `startsWith("https://")` à mão.
- `src/lib/supabase/queries/lojas.ts` → `buscarLojaPorSlug(db, slug)` lê a **VIEW
  `vitrine_lojas`** com `.select("*")` e devolve `LojaPublica = Tables<"vitrine_lojas">`.
  **CONFIRMADO (auditoria da 125 estava certa):** a migration
  `supabase/migrations/20260704120000_lojas_whatsapp_envio_automatico.sql` faz
  `drop view` + `create view` projetando `whatsapp` **e** `whatsapp_envio_automatico`,
  e `src/lib/database.types.ts` (Row de `vitrine_lojas`) já tem
  `whatsapp_envio_automatico: boolean | null` e `whatsapp: string | null`.
  → **Nenhuma mudança de query, nenhuma migration nova.** A coluna já chega ao SSR
  do checkout via `.select("*")`.
- `src/lib/utils/whatsappPedido.ts` → `montarLinkWhatsappPedido` — server-side, já
  usado pela 125 e pela confirmação. **Não importar no cliente. NÃO TOCAR.**
- `src/app/(publica)/loja/[slug]/confirmacao/page.tsx:140,270-287` — RN-A3: o botão
  manual "Avisar a loja no WhatsApp" é renderizado por `linkWhatsapp =
  montarLinkWhatsappPedido(ped, loja)`, que só é `null` quando a loja **não tem
  WhatsApp** (`whatsappPedido.ts`: `numeroLimpo` vazio → `null`). A condição
  **não depende de `whatsapp_envio_automatico`** — logo RN-A3 já está satisfeito
  hoje. **Confirmado por leitura. NÃO TOCAR neste arquivo** (qualquer edição aqui
  seria regressão de RN-A3).

**Precisa ser criado — e por quê (não dá para reusar):**

- `src/components/vitrine/checkout/aberturaWhatsapp.ts` (~35 linhas, módulo neutro)
  — a mecânica `window.open("", "_blank")` / `location.href` / `close()` com
  dependência injetável. Não existe nada equivalente em `src/lib/utils/`
  (`urlHttpsSegura` só valida string; `estado.ts` é estado/payload do wizard —
  misturar mecânica de janela ali polui o módulo e o `estado.test.ts`). É a única
  forma de cobrir a issue com teste no ambiente `node` atual (ver §Como Testar).
- `src/components/vitrine/checkout/aberturaWhatsapp.test.ts` — cobertura.

**Não será criado:** nenhum componente, nenhum hook novo, nenhuma action, nenhuma
migration, nenhuma dependência de `package.json`.

### Cadeia exata de props (resolvido)

O `useEnviarPedido` é chamado em **DOIS** lugares (`grep` confirmou) — esquecer um
deles faz o automático funcionar só no desktop:

1. `CheckoutWizard.tsx:142` — CTA da coluna sticky **desktop**.
2. `EtapaPagamento.tsx:93` — botão "Confirmar pedido" do wizard **mobile**.

Cadeia:

```
vitrine_lojas (view; migration 20260704120000 projeta a coluna)
  └─ buscarLojaPorSlug(db, slug) → LojaPublica            [queries/lojas.ts — inalterado]
       └─ app/(publica)/loja/[slug]/pedido/page.tsx       [MODIFICAR]
            deriva:  const preAbrirWhatsapp =
                       loja.whatsapp_envio_automatico === true &&
                       (loja.whatsapp ?? "").trim() !== "";
            └─ <CheckoutWizard preAbrirWhatsapp={...} />   [MODIFICAR: +1 prop]
                 ├─ useEnviarPedido({ ..., preAbrirWhatsapp })      (desktop)
                 └─ <EtapaPagamento preAbrirWhatsapp={...} />       [MODIFICAR: +1 prop]
                      └─ useEnviarPedido({ ..., preAbrirWhatsapp }) (mobile)
```

Decisões de nomenclatura/forma, fechadas:

- **Uma prop derivada, não duas.** O cliente não precisa do número nem da flag
  crua; precisa só de "devo pré-abrir a aba?". O nome `preAbrirWhatsapp` deixa
  explícito que é **preview de UX**, não a decisão (RN-A2 é do servidor).
- **`=== true` estrito** (fail-closed): na view os tipos gerados são
  `boolean | null` — `null`/`undefined` nunca pré-abre.
- **Prop opcional com default `false`** (`preAbrirWhatsapp?: boolean`) em
  `UsarEnviarPedidoArgs` e `EtapaPagamentoProps`: mantém compatível qualquer
  chamador futuro e é fail-closed por construção.

### Mecânica (RN-A5) — onde cada passo entra em `useEnviarPedido.enviar`

Ordem **importa**: a aba só é aberta depois de TODOS os returns antecipados, senão
um payload inválido deixa uma aba em branco órfã.

```
enviar():
  1. guard forma de pagamento (return)            ← já existe
  2. idempotencyKey                               ← já existe
  3. montarPayloadPedido + schemaPayloadPedido    ← já existe (return em falha)
  4. NOVO, SÍNCRONO (ainda dentro do gesto do clique, ANTES de startEnvio):
       const aba = prepararAbaWhatsapp(preAbrirWhatsapp);
  5. startEnvio(async () => {
       const resultado = await criarPedido(parsed.data);
       if ("erro" in resultado) { aba.concluir(null); toast.error(...); return; }
       onEstadoChange({ idempotencyKey: null });
       aba.concluir(resultado.whatsappHref);        ← NOVO
       router.push(`/loja/${lojaSlug}/confirmacao?...`);  ← inalterado, SEMPRE roda
     });
```

- `prepararAbaWhatsapp` roda **antes** de `startEnvio` (e não dentro do callback)
  para não depender de detalhe de agendamento do `startTransition` — o gesto do
  usuário fica preservado sem ambiguidade (Safari invalida o gesto após `await`).
- `router.push` **nunca** é condicionado ao resultado da aba (RN-A4).
- Nenhum `await` novo é introduzido no caminho do checkout.

Assinatura do módulo novo (`aberturaWhatsapp.ts`):

```ts
export type JanelaWhatsapp = { location: { href: string }; close: () => void };
export type AbrirJanela = () => JanelaWhatsapp | null;
export type AbaWhatsapp = { concluir: (href: string | null) => void };

export function prepararAbaWhatsapp(
  preAbrir: boolean,
  abrir: AbrirJanela = abrirAbaEmBranco,   // injeção p/ teste (padrão DepsPolling)
): AbaWhatsapp;
```

- `abrirAbaEmBranco()`: `typeof window === "undefined"` → `null`; senão
  `window.open("", "_blank")` dentro de try/catch → `null` em falha.
- `preAbrir === false` → nunca chama `abrir`; `concluir` vira no-op (**jamais**
  abrir janela DEPOIS do `await` — seria bloqueado e, pior, um popup inesperado).
- `concluir(href)`: `const destino = urlHttpsSegura(href)`; se não há janela →
  no-op; se `destino` → `janela.location.href = destino`; senão → `janela.close()`.
  Tudo em try/catch (best-effort: `close()`/atribuição podem lançar sob COOP).

### Cenários

**Caminho feliz** (loja com WhatsApp + `whatsapp_envio_automatico = true`):
1. Cliente toca "Confirmar pedido" (mobile ou desktop).
2. Guards passam; `prepararAbaWhatsapp(true)` abre `about:blank` em nova aba —
   dentro do gesto, sem bloqueio.
3. `await criarPedido(payload)` → sucesso com `whatsappHref` (montado da linha
   gravada, RN-A6).
4. `urlHttpsSegura` aprova o `https://api.whatsapp.com/...` → a aba em branco é
   redirecionada para o WhatsApp com o resumo do pedido.
5. A aba original faz `router.push` para `/loja/[slug]/confirmacao?pedido=&token=`,
   onde o botão manual continua visível (RN-A3).

**Casos de borda:**
| Situação | Comportamento esperado |
|---|---|
| `formaPagamento == null` / payload inválido | `return` ANTES do `window.open` — nenhuma aba órfã |
| Popup bloqueado (`window.open` → `null`) | `concluir` é no-op; pedido criado; `router.push` normal (RN-A4) |
| `preAbrirWhatsapp = false` (flag desligada ou loja sem WhatsApp) | Nenhuma aba aberta, mesmo se o servidor mandasse href |
| **Divergência**: flag ligada no SSR, servidor devolve `whatsappHref: null` (lojista desligou entre o load e o clique, ou o `montarLink` falhou) | Aba em branco é **fechada**; nada é enviado; confirmação normal |
| `criarPedido` devolve `{ erro }` (loja fechada, rate limit, cupom) | `aba.concluir(null)` fecha a aba, `toast.error` com a mensagem já genérica; sem `router.push` |
| `href` não-`https:` (defesa §15) | `urlHttpsSegura` → `null` → aba fechada; nada navega |
| SSR / `window` indefinido | `abrirAbaEmBranco` devolve `null` sem lançar |
| `janela.close()` ou atribuição lança | try/catch engole — checkout não quebra |
| Duplo clique | Inalterado: botão `disabled={enviando}` + `idempotencyKey` (063). No máximo uma aba por clique aceito |
| Falha de rede no `await` | O `useTransition` já propaga; a aba fica aberta em branco (aceito e documentado como trade-off do RN-A5) — o pedido não foi criado, nada é enviado |

**Tratamento de erros (`seguranca.md` §14):** nada novo vaza. As mensagens ao
cliente continuam vindo prontas e genéricas de `criarPedido` (`ERRO_GENERICO`).
Falha de janela é **silenciosa por design** (best-effort, RN-A4) — não gerar
`toast` de "não consegui abrir o WhatsApp": o botão manual na confirmação já é o
caminho de recuperação.

### Regra cliente ↔ servidor (mapa de camadas)

| Invariante | Camada que garante | Onde |
|---|---|---|
| **Decidir** se o WhatsApp é disparado | **Server Action** | `criarPedido` §(9): `loja.whatsapp_envio_automatico === true && loja.whatsapp` — issue 125 |
| **Conteúdo** da mensagem (itens/total) | **Server Action** + banco | `buscarPedidoPorToken` relê a linha GRAVADA → `montarLinkWhatsappPedido` |
| Leitura da flag na vitrine | **RLS/view** | `vitrine_lojas` (`security_invoker=false`, `where ativo = true`, SELECT-only p/ anon) |
| Persistência da flag | **Server Action + RLS** | `salvarPerfil`/`atualizarPerfilAdmin` (issues 122/123/124) |
| Pré-abrir a aba | **Cliente (UX apenas)** | `prepararAbaWhatsapp` — se divergir do servidor, a aba é fechada e nada é enviado |
| Valor monetário | **N/A nesta issue** | Nenhum valor trafega; o cliente não envia nem lê valor novo |
| Anti-XSS do destino | **Cliente (§15)** | `urlHttpsSegura` antes de `location.href`; sem `dangerouslySetInnerHTML` |

Não há regra de valor nem de permissão implementada no cliente aqui: o cliente
não pode fazer o WhatsApp abrir com dado que o servidor não emitiu — ele só
recebe (ou não) uma string pronta.

### Schema de Banco

**Nenhuma mudança.** A coluna `lojas.whatsapp_envio_automatico` e a projeção na
view `vitrine_lojas` já foram entregues pela migration
`supabase/migrations/20260704120000_lojas_whatsapp_envio_automatico.sql` (issue 121),
com teste em `tests/migrations/whatsapp_envio_automatico.test.ts`.
**RLS:** nenhuma política nova — a coluna cai sob `lojas_update_proprio` e o
escopo admin existente; a view segue SELECT-only para `anon`/`authenticated`.

### Validação (zod)

**Nenhum schema novo e nenhuma mudança em schema existente.**
`schemaPayloadPedido` (`src/lib/validacoes/pedido.ts`, `.strict()`) permanece
intacto — nada novo é enviado ao servidor. O `whatsappHref` é **saída** do
servidor, não entrada do cliente; sua checagem no cliente é de protocolo
(`urlHttpsSegura`), não de forma.

### Recálculo no Servidor

**Não se aplica** — esta issue não introduz nem transporta valor monetário. O que
o servidor já garante (125): o `href` é montado a partir do **pedido gravado**
relido do banco, nunca do carrinho em memória do cliente (a RPC pode divergir do
que recebeu — trava de cupom perdida numa corrida, replay idempotente). Nada muda.

### Como Testar (decisão fechada e justificada)

**Restrição real do repo:** `vitest.config.ts` usa `environment: "node"`; não há
`jsdom` nem `@testing-library/react` em `package.json`. `window.open` não existe;
não é possível clicar num botão.

**Descartado:** instalar `jsdom` + `@testing-library` só por esta issue — mudança
de infra de testes do projeto inteiro, fora do escopo de uma issue não-crítica
(e o débito de "clique DOM real" já está documentado em
`ProdutosClient.test.tsx` / `PerfilClient.test.tsx`).

**Escolhido — o padrão que o projeto já usa (`StatusPedidoLive`):** extrair a
mecânica para o módulo neutro `aberturaWhatsapp.ts`, com o abridor de janela
**injetado por parâmetro** (default = `window.open`). O teste passa um fake
`() => ({ location: { href: "" }, close: vi.fn() })` e observa o efeito — sem
DOM, sem React, sem mock de `next/navigation` nem de `@/lib/actions/pedido`.
Complemento com `vi.stubGlobal("window", { open })` (precedente
`SeletorImprimirPedido.test.tsx:32`) para cobrir o **default** `abrirAbaEmBranco`
— senão o caminho realmente usado em produção fica sem teste.

`src/components/vitrine/checkout/aberturaWhatsapp.test.ts` — casos:
1. `preAbrir = false` → `abrir` **não** é chamado; `concluir(href)` não abre nada.
2. `preAbrir = true` → `abrir` chamado **1 vez** e **antes** de qualquer
   `concluir` (prova o passo síncrono do RN-A5).
3. Sucesso: `concluir("https://api.whatsapp.com/send?...")` → `janela.location.href`
   recebe exatamente a string; `close` **não** chamado.
4. Divergência: `concluir(null)` → `close()` chamado; `location.href` intacto.
5. Popup bloqueado: `abrir` devolve `null` → `concluir(href)` não lança.
6. Anti-XSS §15: `concluir("javascript:alert(1)")` e `concluir("http://...")` →
   **fecha** a aba, `location.href` intacto.
7. `close()` que lança → `concluir` não propaga a exceção.
8. Default sem `window` (`vi.stubGlobal("window", undefined)`) → não lança.
9. Default com `window.open` stubado → recebe `("", "_blank")`.

**Fiação (opcional, barato):** um teste de captura de props no molde de
`PerfilClient.test.tsx` (stub de `CheckoutWizard`, `renderToStaticMarkup` da page)
provando que `page.tsx` deriva `preAbrirWhatsapp` corretamente para os 4 casos
(flag true/false × whatsapp presente/vazio). Recomendado, pois é justamente onde
um erro silencioso mataria a feature; exige mockar `@/lib/supabase/server` e as
queries — mesmo padrão de `src/app/admin/assinantes/[lojaId]/configuracoes/page.test.tsx`.

**Lacuna que PERMANECE (documentar no cabeçalho do teste):** provar que
`useEnviarPedido` chama `prepararAbaWhatsapp` antes do `await` exige clique DOM
real — infra que o projeto não tem. Mitigação: a ordem é verificável por leitura
(o `prepararAbaWhatsapp` fica fora do `startEnvio`) e por `verificar` manual.

Comandos: `npx vitest run src/components/vitrine/checkout/aberturaWhatsapp.test.ts`
e `npm run build` (checa os tipos das 3 props novas na cadeia).

### Arquivos a Criar / Modificar / NÃO tocar

**Criar:**
- `src/components/vitrine/checkout/aberturaWhatsapp.ts` — mecânica pura + injeção.
- `src/components/vitrine/checkout/aberturaWhatsapp.test.ts` — 9 casos acima.

**Modificar:**
- `src/components/vitrine/checkout/useEnviarPedido.ts` — `preAbrirWhatsapp?: boolean`
  em `UsarEnviarPedidoArgs`; `prepararAbaWhatsapp` antes do `startEnvio`;
  `aba.concluir(...)` nos dois ramos (erro e sucesso).
- `src/components/vitrine/checkout/EtapaPagamento.tsx` — `preAbrirWhatsapp?: boolean`
  em `EtapaPagamentoProps`, repassado ao `useEnviarPedido` (caminho **mobile**).
- `src/components/vitrine/checkout/CheckoutWizard.tsx` — prop nova em
  `CheckoutWizardProps`, repassada ao `useEnviarPedido` (desktop) **e** às duas
  instâncias de `<EtapaPagamento>` (mobile e desktop).
- `src/app/(publica)/loja/[slug]/pedido/page.tsx` — deriva `preAbrirWhatsapp` do
  `loja` já carregado (sem query nova) e passa ao `CheckoutWizard`.

**NÃO tocar (motivo):**
- `src/app/(publica)/loja/[slug]/confirmacao/page.tsx` — RN-A3 já satisfeito;
  editar aqui é regressão.
- `src/lib/actions/pedido.ts` — contrato da 125 fechado.
- `src/lib/utils/whatsappPedido.ts`, `src/lib/validacoes/pedido.ts`,
  `src/lib/supabase/queries/lojas.ts`, `supabase/migrations/**` — nada a fazer.
- `src/components/ui/**` (shadcn) — não se edita à mão.
- **`src/app/(painel)/painel/(bloqueavel)/configuracoes/perfil/*` e
  `src/app/admin/assinantes/[lojaId]/configuracoes/perfil/*`** — issues 123/124
  em andamento em paralelo. **Conflito garantido se tocados.**

### Dependências Externas

**Nenhuma.** Nenhum pacote novo; nenhuma API nova (o link `api.whatsapp.com/send`
continua sendo montado no servidor pela 125). Docs de referência:
- `window.open` e bloqueio de popup por transient activation —
  https://developer.mozilla.org/en-US/docs/Web/API/Window/open
- User activation (por que o `await` invalida o gesto) —
  https://developer.mozilla.org/en-US/docs/Web/Security/User_activation

### Ordem de Implementação

Issue **não crítica** (`crítica: NÃO` — sem dinheiro, sem RLS, sem token), então
não exige fase RED formal do `/tdd`. Mesmo assim o módulo novo nasce com teste
junto, porque é a única cobertura possível da feature.

1. `aberturaWhatsapp.ts` + `aberturaWhatsapp.test.ts` — módulo folha, sem
   dependências no repo além de `urlHttpsSegura`; verde antes de fiar qualquer coisa.
2. `useEnviarPedido.ts` — consome o módulo (depende de 1).
3. `EtapaPagamento.tsx` — repassa a prop (depende de 2; caminho mobile).
4. `CheckoutWizard.tsx` — repassa a prop aos dois consumidores (depende de 2 e 3).
5. `pedido/page.tsx` — deriva a flag do SSR e alimenta a cadeia (depende de 4).
6. `npx vitest run src/components/vitrine/checkout/` + `npm run build`.
7. `verificar` manual: loja com flag ON → aba abre; flag OFF → aba não abre e a
   confirmação mostra o botão manual; bloqueador de popup ligado → checkout
   conclui normalmente.
