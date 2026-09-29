# Spec: Aviso do WhatsApp com contagem que abre em nova aba

**Versão:** 0.1.1 | **Atualizado:** 2026-09-29

> Revisa **RN-A7** de `specs/5-whatsapp-envio-automatico-toggle.md` (issue 287) e a
> correção `d8d2a00` ("no PC, aviso do WhatsApp não navega sozinho na mesma aba").
> Escopo: só `ModalAvisoWhatsapp` e o módulo puro `avisoWhatsapp.ts`. O botão manual
> "Avisar a loja no WhatsApp" (spec 3) e `montarLinkWhatsappPedido` ficam como estão.

## Visão Geral

**Mundo:** vitrine pública (sem auth), página de confirmação do pedido.

Quando a loja deixa o envio automático ligado, a confirmação abre `ModalAvisoWhatsapp`:
passo 1 com spinner e contagem de 5s, e ao fim da contagem o WhatsApp abre sozinho.
A contagem esgotada sempre abriu o WhatsApp **na mesma aba**
(`window.location.href = destino`). No celular isso funciona: o app intercepta o `wa.me`
e a aba da confirmação continua lá. No computador, `wa.me` vira `web.whatsapp.com` **no
lugar da confirmação**, e o cliente perde a tela onde acompanha o status do pedido.

O `d8d2a00` resolveu isso desligando o passo 1 inteiro no computador
(`ehComputadorComMouse()` manda direto para o passo 2). Com isso sumiram também o spinner
e a contagem, que estavam certos. O problema era só abrir na mesma aba.

Esta spec:

1. **Volta com o passo 1 (spinner + contagem) em qualquer dispositivo.**
2. **Contagem esgotada sem interação → tenta abrir o WhatsApp em NOVA aba.** No computador,
   nunca troca a aba da confirmação.
3. **Aba nova aberta → o modal fecha sozinho.** O cliente fica na confirmação, sem nada por
   cima, vendo o `StatusPedidoLive`.

### Restrição de plataforma (entra na decisão, não é detalhe de implementação)

Todo navegador atual só deixa `window.open` passar pelo bloqueador de popup se houver
**ativação transitória do usuário** (um clique/toque recente). Um `setTimeout` de contagem
não é gesto. O clique em "Confirmar pedido" que trouxe o cliente até aqui já perdeu a
validade: passou pelo round-trip de `criarPedido`, pela renderização da confirmação e pelos
5s da contagem, e a janela de ativação é curta (cerca de 5s no Chromium, menos no Safari).
Então **no padrão de fábrica a abertura automática em nova aba vai ser bloqueada na maioria
dos navegadores**. O requisito 1 é *best-effort*. O que a spec garante de verdade é o
contrário: **no computador, a aba da confirmação nunca é trocada sem gesto**.

Comportamento esperado de `window.open(destino, "_blank")` chamado fora de gesto. É o padrão
de fábrica de cada navegador e **precisa ser conferido no smoke manual (§ Aceite)**, porque o
repo não tem Playwright (issue 176):

| Navegador | Resultado esperado sem gesto | Retorno | O que o usuário vê do navegador |
|---|---|---|---|
| Chrome / Edge desktop | bloqueado | `null` | ícone "pop-up bloqueado" na barra de endereço, com "sempre permitir neste site" |
| Firefox desktop | bloqueado | `null` | barra "Firefox impediu este site de abrir uma janela pop-up", com "Permitir" |
| Safari macOS | bloqueado (padrão "Bloquear e notificar") | `null` | ícone na barra de endereço |
| Chrome Android | bloqueado | `null` | infobar "Pop-up bloqueado" |
| Safari iOS | bloqueado (Ajustes › Safari › Bloquear pop-ups, ligado por padrão) | `null` | nada (bloqueio silencioso) |
| Navegador embutido (Instagram, Facebook, WebViews) | **imprevisível** | pode ser `null`, pode ser um handle que não abre nada | varia |
| Site com pop-ups liberados pelo usuário | abre | handle | aba nova |

Duas consequências boas: (a) no desktop, o próprio navegador mostra "pop-up bloqueado" com a
opção de liberar o site, e **quem libera passa a ter a abertura automática em nova aba nos
próximos pedidos**; (b) um handle falso-positivo (WebView) fecha o modal sem abrir nada, mas
o cliente não fica sem saída, porque o botão manual "Avisar a loja no WhatsApp" (spec 3,
RN-A3) continua na página.

### Bug latente encontrado: o clique também troca a aba hoje

`ModalAvisoWhatsapp.tsx` abre por gesto com:

```ts
const aba = window.open(destino, "_blank", "noopener");
if (aba == null) {
  window.location.href = destino;
}
```

Pelo algoritmo *window open steps* do WHATWG HTML, **`window.open` com `noopener` (ou
`noreferrer`) devolve `null` sempre**, tenha aberto ou não. Então o `if` sempre entra: todo
clique em "Enviar agora"/"Enviar mensagem" abre a aba nova **e também** troca a aba da
confirmação por `wa.me`. No computador é o mesmo sintoma que o `d8d2a00` tentou corrigir, só
que pelo caminho do clique. O teste `ModalAvisoWhatsapp.test.tsx` (§6, "retorno `null`
(bloqueador)") trava esse código como se fosse correto, porque roda sem browser e não tem
como notar. **Esta spec corrige o bug (D3).** Não é algo à parte: é o mesmo "abre na mesma
aba" que o usuário relatou.

## Atores Envolvidos

- **Cliente (comprador, anônimo):** vê o aviso, espera a contagem ou age antes dela.
- **Lojista:** nada muda. O toggle `lojas.whatsapp_envio_automatico` continua decidindo se o
  aviso aparece (RN-A2, decisão no SSR).
- **iRango (SaaS):** nenhuma mudança de servidor, schema ou Server Action.

## Decisões

| # | Decisão | Por quê |
|---|---|---|
| D1 | O passo 1 volta para todos os dispositivos. `ehComputadorComMouse()` deixa de decidir **se** a contagem é armada. Só `persistiu` (gate de storage) decide, como antes do `d8d2a00`. | Pedido literal do usuário. O que atrapalhava no desktop era a navegação top-level, e ela sai do desktop (D2). |
| D2 | Contagem esgotada: **primeiro tenta aba nova** (`window.open(destino, "_blank")` **sem** feature string, e na mesma tarefa síncrona `aba.opener = null`). Handle não nulo → `"aberta"`. `null` → `"bloqueada"`. | É o único jeito de saber se a aba abriu. Com `noopener` o retorno é sempre `null` (ver bug latente). Precisamos do handle para fechar o modal (requisito 3) e para escolher o fallback. |
| D2.1 | `"bloqueada"` **no computador com mouse** → **passo 2**, sem navegar. `"bloqueada"` **em tela de toque** → `window.location.href = destino` (navegação top-level, igual a hoje no celular). | No desktop, trocar a aba é justamente o que não pode acontecer. O passo 2 já existe e tem a copy literal certa ("Envie a mensagem no WhatsApp e acelere seu pedido."), então o cliente fica a um clique de abrir. No celular a abertura automática em aba nova quase sempre vai ser bloqueada (tabela acima). Sem o fallback top-level, o celular **perderia** a abertura automática que hoje funciona. `ehComputadorComMouse()` fica, mas passa a escolher **só o fallback do bloqueio**. |
| D3 | Os botões de gesto ("Enviar agora" no passo 1, "Enviar mensagem" no passo 2) viram **link declarativo**: `<Button nativeButton={false} render={<a href={destinoAprovado} target="_blank" rel="noopener noreferrer" />}>`. O `Button` do repo é **Base UI** (`@base-ui/react/button`), não Radix: **não existe `asChild`**; o molde já usado é `Carrinho.tsx` (`nativeButton={false}` + `render={<Link …/>}`). Sai o `type="button"` (inválido em `<a>`). O clique para a contagem e fecha o modal, **sem `preventDefault`**. Nenhum `window.open` e nenhum fallback `location.href` no caminho do gesto. | Link `target="_blank"` ativado por clique real não passa pelo bloqueador de popup, então não precisa de fallback. `rel="noopener noreferrer"` é o caso declarativo que `seguranca.md` §15-A já considera resolvido. Isso elimina o bug latente pela raiz em vez de trocar um `if` por outro. |
| D4 | Com aba aberta (D2 `"aberta"` ou clique D3), **o modal fecha** (`setAberto(false)`). A contagem já está encerrada. No fallback do toque (`"navegou-top-level"`) o modal **também fecha**, na mesma chamada, antes de a navegação acontecer. | Requisito 3 do usuário. No celular o app do WhatsApp intercepta o `wa.me` e o cliente volta para a confirmação (ou para ela restaurada do bfcache): hoje ele reencontra o modal parado em "Abrindo o WhatsApp em 0s…". Fechar antes elimina esse resto e é o que o smoke 4 espera ("sem o modal"). Só `"bloqueada-sem-navegar"` mantém o modal aberto (passo 2). |
| D5 | O gate "uma vez por pedido" e a regra "storage não persistiu → passo 2 direto, sem contagem" ficam **iguais**. | No toque ainda existe fallback top-level (D2.1), e sem o gate isso vira laço de redirecionamento. No desktop, reabrir o aviso e tentar pop-up a cada revisita seria ruído. |
| D6 | A duração (5s, `SEGUNDOS_AVISO_WHATSAPP`), a copy dos dois passos e a trava de copy de RN-A7 ficam iguais. | Não foi pedido. A trava de copy é decisão de produto. |

## Páginas e Rotas

### Confirmação do pedido — `/loja/[slug]/confirmacao?pedido=<id>&token=<token>`

**Mundo:** vitrine pública (sem auth). A leitura é escopada por `token_acesso` e não muda.

**Descrição:** o pedido já está gravado quando a página abre (RN-W4). Se `avisoHabilitado`
(SSR) e o gate de sessão deixar, o modal abre no passo 1 **em qualquer dispositivo**, com
spinner e contagem de 5s. Na contagem esgotada:

```
tentarAbrirNovaAba(destino)
 ├─ "aberta"    → modal fecha; cliente fica na confirmação (StatusPedidoLive)
 └─ "bloqueada"
     ├─ computador com mouse → passo 2 (sem navegar; só gesto abre)
     └─ tela de toque        → window.location.href = destino (comportamento de hoje)
```

"Enviar agora" ou "Enviar mensagem": link `target="_blank"`, abre o WhatsApp em aba nova e o
modal fecha. "Agora não" e "Sair mesmo assim" funcionam como hoje.

**Componentes (reuso, nenhum componente novo):**
- `Dialog`, `DialogContent`, `DialogHeader`, `DialogTitle`, `DialogDescription`,
  `DialogFooter` de `components/ui/dialog` (shadcn, **não editar**).
- `Button` de `components/ui/button` (Base UI, **não editar**) com **`nativeButton={false}` +
  `render={<a … />}`** nos dois botões de envio (D3), mesmo molde de `Carrinho.tsx`, mantendo
  `className="min-h-11 w-full"` (alvo de toque ≥44px) e as variantes atuais (default no
  "Enviar", `outline` nas saídas). Sem `asChild` (não existe nesse `Button`) e sem
  `type="button"` no link.
- `Loader2` (lucide), que já está no passo 1.
- `ModalAvisoWhatsapp.tsx`: só muda a fiação (efeito de montagem, handlers, botões de envio).
- `avisoWhatsapp.ts` → `criarContagemAviso`: a política de "o que fazer na contagem esgotada"
  continua **no módulo puro**, com efeitos injetados (padrão do módulo, testável em
  `environment: node`). O guard `urlHttpsSegura` continua aplicado **uma vez**, na criação.

**Contrato proposto para `criarContagemAviso`** (o `planejar` pode ajustar nomes, não a
semântica):

```ts
type ResultadoAbertura = "aberta" | "bloqueada";

type DepsContagemAviso = {
  href: string | null;
  timer: TimerAviso;
  /** Contagem esgotada: tenta aba nova e diz se abriu. */
  tentarAbrirNovaAba: (destino: string) => ResultadoAbertura;
  /** Só chamado com "bloqueada" E podeNavegarTopLevel === true. */
  navegarTopLevel: (destino: string) => void;
  /** false no computador com mouse. Nunca navega top-level sem gesto nesse caso. */
  podeNavegarTopLevel: boolean;
  /** Desfecho da contagem esgotada, para a UI: "bloqueada-sem-navegar" ⇒ passo 2;
   *  "aberta" e "navegou-top-level" ⇒ fechar o modal (D4). Chamado 1 vez. */
  aoEsgotar: (desfecho: "aberta" | "bloqueada-sem-navegar" | "navegou-top-level") => void;
  aoContar?: (restante: number) => void;
  segundos?: number;
  intervaloMs?: number;
};

type ContagemAviso = {
  /** Destino já aprovado pelo guard §15 (ou null). É o href do <a> dos botões (D3). */
  readonly destino: string | null;
  iniciar(): void;
  parar(): void; // saída, clique no link, desmontagem
};
```

`abrirNovaAba`/`enviarAgora` saem do contrato: o gesto agora é o próprio `<a>` (D3). No
componente, `tentarAbrirNovaAba` é:

```ts
(destino) => {
  const aba = window.open(destino, "_blank");
  if (aba == null) return "bloqueada";
  aba.opener = null; // §15-A: desapossa na MESMA tarefa, antes do cross-origin carregar
  return "aberta";
}
```

**Behaviors:**
- [ ] **Ver o passo 1 (spinner + contagem de 5s) em qualquer dispositivo**, inclusive no
  computador com mouse, quando o aviso está habilitado e o gate de sessão persistiu. Garantido
  em: decisão de exibir no **servidor** (`avisoHabilitado`, `href` no SSR). Armar a contagem é
  do **cliente** (`persistiu` → `contagem.iniciar()`, sem a condição `!ehComputadorComMouse()`).
  Teste: `ModalAvisoWhatsapp.test.tsx` (trava de texto-fonte: `if (persistiu) { contagem.iniciar() }`).
- [ ] **Esperar a contagem acabar sem mexer em nada → o WhatsApp tenta abrir em aba nova.**
  Garantido em: módulo puro `avisoWhatsapp.ts`: o último tick chama `tentarAbrirNovaAba(destino)`
  **antes** de qualquer outra navegação, uma vez só, e só com destino aprovado pelo guard §15.
  Teste: `avisoWhatsapp.test.ts` com fake injetado.
- [ ] **Aba nova abriu → o modal fecha sozinho** e o cliente continua na confirmação.
  Garantido em: módulo (`aoEsgotar("aberta")`) + componente (`setAberto(false)`). Nenhuma
  navegação top-level nesse caminho. Teste: módulo (desfecho `"aberta"` ⇒ `navegarTopLevel`
  não chamado) + trava de fonte no componente.
- [ ] **Popup bloqueado no computador → o modal vai para o passo 2 e a aba da confirmação fica
  onde está.** Garantido em: módulo (`podeNavegarTopLevel === false` ⇒ `navegarTopLevel`
  **nunca** chamado, desfecho `"bloqueada-sem-navegar"`) + componente (`setPasso(2)`).
  Teste: módulo, tabela `podeNavegarTopLevel × resultado`.
- [ ] **Popup bloqueado → o passo 2 EXPLICA o bloqueio e chama o gesto** (RN-AN5). O componente
  entra no passo 2 com `bloqueado === true` só nesse desfecho e troca a copy: título
  `COPY_POPUP_BLOQUEADO_TITULO` ("Clique em "Enviar mensagem"…") e descrição
  `COPY_POPUP_BLOQUEADO_DESC` (explicita o bloqueio, reafirma que o pedido já está gravado e
  oferece liberar pop-ups). Os outros caminhos do passo 2 ("Agora não", gate de storage não
  persistido) mantêm `COPY_ACELERE_PEDIDO`. Teste: trava de fonte (`bloqueado ? … : …` no passo
  2, `setBloqueado(true)` só no desfecho `"bloqueada-sem-navegar"`, literais das constantes).
- [ ] **Popup bloqueado em tela de toque → abre o WhatsApp na mesma aba (`location.href`)**,
  como hoje, e o modal fecha (D4). Garantido em: módulo (`"bloqueada"` +
  `podeNavegarTopLevel === true` ⇒ `navegarTopLevel(destino)` uma vez, desfecho
  `"navegou-top-level"`) + componente (`setAberto(false)`). Teste: módulo.
- [ ] **Tocar/clicar em "Enviar agora" (passo 1) ou "Enviar mensagem" (passo 2) → o WhatsApp
  abre em aba nova e o modal fecha, sem trocar a aba da confirmação.** Garantido em: **cliente**,
  com `<a href={contagem.destino} target="_blank" rel="noopener noreferrer" />` no `render`
  do `Button` (`nativeButton={false}`). O `onClick` chama `contagemRef.current?.parar()` e `setAberto(false)`,
  **sem `preventDefault`**. O arquivo não tem mais nenhum `window.location.href` alcançável a
  partir de clique. Teste: trava de fonte (`rel="noopener noreferrer"` e `target="_blank"`
  **literais**; `window.open(` aparece exatamente 1 vez, dentro de `tentarAbrirNovaAba`;
  nenhuma string `"noopener"` passada como feature de `window.open`).

**Invariantes que não podem regredir** (sem checkbox novo: são behaviors de RN-A7 já
existentes, e a suíte atual continua cobrindo, adaptada ao contrato novo):
- "Agora não" **para** a contagem, que nunca volta a correr (WCAG 2.2.1), e leva ao passo 2.
- "Sair mesmo assim", Esc e clique fora fecham sem navegar. Nada é desfeito, o pedido segue
  gravado.
- Gate de storage que não persistiu → passo 2 direto, contagem **não** armada, em qualquer
  dispositivo (D5).
- Voltar do WhatsApp para a confirmação não reabre o aviso (gate `aviso-wpp:<pedidoId>`).
- SSR vazio: o HTML do servidor não tem `href` nenhum (PII), porque `aberto` começa `false`.
  Com D3 o `href` passa a ir para o DOM **do cliente** dentro do `<a>`, e só depois da
  montagem. O teste de SSR vazio continua valendo sem mudança.
- Destino reprovado pelo guard §15: o modal nem abre (`decidirAvisoWhatsapp`), e se abrisse,
  `contagem.destino === null` ⇒ o `<a>` não recebe `href` e `tentarAbrirNovaAba` nunca é
  chamado.
- Desmontagem com timer pendente: o cleanup chama `parar()`, e nenhum tick navega depois.
- Um único `useEffect` de deps `[]`, decisão memoizada por instância
  (`decidirEMarcarAvisoUmaVez`).

---

## Modelos de Dados

Nenhuma alteração. Sem migration e sem RLS nova. Os dados lidos são os mesmos de hoje, todos
no SSR da confirmação: `lojas.whatsapp_envio_automatico` e `lojas.whatsapp` (via
`buscarLojaParaPedido`) e o `href` de `montarLinkWhatsappPedido`. Estado de cliente:
`sessionStorage["aviso-wpp:<pedidoId>"]`, igual a hoje.

## Regras de Negócio

**RN-AN1 — Contagem esgotada nunca troca a aba da confirmação no computador.** Com
`podeNavegarTopLevel === false` (computador com mouse, `(hover: hover) and (pointer: fine)`),
a contagem esgotada só pode resultar em aba nova (`"aberta"`) ou no passo 2. Camada: módulo
puro `avisoWhatsapp.ts` (a política) + componente (injeta `podeNavegarTopLevel =
!ehComputadorComMouse()`, avaliado **uma vez** na montagem). A detecção de dispositivo é
heurística de UX, não segurança: um notebook com touch que casar como "toque" cai no fallback
de hoje. Aceito.

**RN-AN2 — Abertura automática é best-effort; a garantia é o fallback.** A spec **não**
promete que a aba nova abre sozinha, porque a plataforma bloqueia (tabela da Visão Geral). O
que ela promete: (a) desktop → aba nova **ou** passo 2, nunca troca de aba; (b) toque → aba
nova **ou** o comportamento de hoje. Camada: módulo puro.

**RN-AN3 — Modal fecha só quando a aba nova realmente foi pedida ao navegador.** Pela
contagem, fecha quando `window.open` devolve handle. Pelo clique, fecha no próprio clique do
`<a target="_blank">`, que não passa pelo bloqueador. Com `"bloqueada"` no desktop o modal
**fica aberto** (passo 2). Handle falso-positivo (WebView) é risco aceito: o botão manual da
spec 3 continua na página. Camada: cliente.

**RN-AN4 — Gesto nunca usa `window.open` nem `location.href`.** Os botões de envio são link
declarativo (D3). Camada: cliente, travado por teste de texto-fonte.

**RN-AN5 — No bloqueio de popup, o passo 2 explica o bloqueio (decisão de produto).** O que a
v1 do spec deixou fora ("copy nova exige decisão de produto") foi decidido: quando o desfecho é
`"bloqueada-sem-navegar"`, o passo 2 mostra copy própria (`COPY_POPUP_BLOQUEADO_TITULO` /
`COPY_POPUP_BLOQUEADO_DESC`) que nomeia o bloqueio, mantém o verbo no imperativo (o cliente
clica para abrir) e pode citar liberar pop-ups. Os demais caminhos do passo 2 seguem com
`COPY_ACELERE_PEDIDO`. A copy não sugere que o pedido não foi feito (RN-W4). Camada: cliente
(`bloqueado`), travada por teste de texto-fonte e pelos literais exportados.

**RN-A7 (spec 5): o que muda.** Deixam de valer "Contador esgotado sem interação →
`window.location.href = destino`" e "`window.open(destino, "_blank", "noopener")`; se o
navegador bloquear o popup (retorno `null`), cai para `window.location.href`". O resto de
RN-A7 (copy, trava de copy, uma vez por pedido, guard §15, gate de storage fechado) continua
igual. **A PR que implementar esta spec atualiza o texto de RN-A7 e os behaviors
correspondentes da spec 5** (linhas "Contagem esgotada sem interação leva ao WhatsApp
automaticamente (`window.location.href`)" e "'Enviar agora'/'Enviar mensagem' abre o WhatsApp
numa aba nova…"), apontando para esta spec. Na mesma passada, os outros trechos da spec 5
que descrevem o mecanismo antigo: a **Descrição [rev v0.3.0]** da confirmação ("navega para o
WhatsApp automaticamente ao fim da contagem (`window.location.href`…)" e "`window.open(...,
"noopener")`, mantém a confirmação aberta"), o fim de **RN-A5** ("a navegação por gesto real
usa `window.open(destino, "_blank", "noopener")`") e o item **"[rev v0.3.0] Anti
reverse-tabnabbing"** da Segurança da spec 5 (hoje diz que o caminho sem gesto nunca abre
segunda aba, o que deixa de ser verdade com D2).

## Segurança (obrigatório)

- **Valor monetário:** nenhum. O modal não calcula, não exibe e não envia valor. O total que
  aparece na mensagem vem do pedido autoritativo, montado no servidor por
  `montarLinkWhatsappPedido` (RN-A6), e isso não muda. Sem recálculo novo.
- **Permissão / RLS:** nenhuma tabela nova, nenhuma escrita. A decisão de exibir continua no
  **servidor** (SSR: `avisoHabilitado` + `href`). O cliente só reage.
- **PII na query string do `href`** (nome, telefone, endereço do comprador):
  - continua **nunca logada** (precedente [161]; o teste "nunca loga href/destino" continua);
  - continua **fora do HTML do SSR** (modal começa fechado);
  - **novo:** depois da montagem passa a ficar no atributo `href` de um `<a>` no DOM do
    cliente (D3). É o mesmo nível de exposição do botão manual da spec 3, que já renderiza o
    link, e está só no navegador do próprio comprador. Aceito.
- **Guard §15 (`urlHttpsSegura`):** continua sendo a fonte única, aplicado uma vez em
  `criarContagemAviso`. O `<a>` usa **`contagem.destino`** (aprovado), **nunca** a prop `href`
  crua. Teste de fonte: nenhum identificador solto `href` no atributo do `<a>`, e o componente
  continua sem importar `urlHttpsSegura`.
- **Reverse tabnabbing (§15-A):**
  - gesto → `rel="noopener noreferrer"` **literal** no `<a>` (caso declarativo, já coberto
    pela §15-A);
  - contagem → `window.open(destino, "_blank")` **sem** `noopener`, seguido de
    `aba.opener = null` **na mesma tarefa síncrona**. A aba nova nasce em `about:blank` e o
    documento cross-origin (`wa.me`) só carrega depois que a tarefa atual termina, então o
    `opener` já está nulo quando o terceiro poderia lê-lo. É **exceção à regra da §15-A**
    ("`noopener` real sempre que o destino é conhecido antes do gesto"), e o motivo é novo:
    precisamos do handle para **detectar o bloqueio**, porque com `noopener` o retorno é sempre
    `null`. **A PR atualiza `references/seguranca.md` §15-A** (via `escriba`) para registrar
    essa segunda justificativa da exceção e corrigir o "Padrão atual", que hoje descreve o
    `window.open(..., "noopener")` do gesto e o `navegarTopLevel` da contagem.
- **Referrer:** o URL da confirmação carrega `?token=` (token do pedido). Cross-origin, o
  `Referrer-Policy: strict-origin-when-cross-origin` (`next.config.ts`) só manda a origem, não
  o path nem a query, e isso vale para o `window.open` sem `noreferrer`. O `<a>` do gesto ainda
  leva `noreferrer`. Nenhum vazamento novo de token.
- **Chave de API externa:** nenhuma.
- **TDD:** não é dinheiro, RLS, cupom nem token, então não é crítico pelo mandato 3. Mesmo
  assim, **recomendo red-first nos testes do módulo** (`avisoWhatsapp.test.ts`), porque a
  suíte atual trava explicitamente o comportamento contrário ("contagem esgotada usa navegação
  TOP-LEVEL, nunca aba nova"; "retorno `null` ⇒ `window.location.href`"). Esses testes têm que
  ser **reescritos de propósito**, não apagados, e o RED prova que a troca foi intencional.

## Aceite

Unitário (Vitest, `environment: node`, sem jsdom):
- `avisoWhatsapp.test.ts`: tabela `podeNavegarTopLevel ∈ {true,false} × tentarAbrirNovaAba ∈
  {"aberta","bloqueada"}` → desfecho e chamadas esperadas; `tentarAbrirNovaAba` chamado
  exatamente 1 vez, só no último tick, nunca depois de `parar()`, nunca com destino reprovado;
  `destino` exposto igual a `urlHttpsSegura(href)`.
- `ModalAvisoWhatsapp.test.tsx`: travas de texto-fonte atualizadas (sem
  `!ehComputadorComMouse()` na condição de `iniciar`; `window.open(destino, "_blank")` sem
  terceiro argumento, seguido de `.opener = null`; nenhum `window.location.href` fora de
  `navegarTopLevel`; `<a` com `target="_blank"` e `rel="noopener noreferrer"` literais; `href`
  do `<a>` vindo de `destino` da contagem; `nativeButton={false}` nos dois botões de envio).
  SSR vazio continua igual. Travas de **contagem** que mudam de número e precisam ser
  reescritas junto (não afrouxadas para `>=`): `setPasso(2)` passa de 2 ocorrências (`aoAdiar`
  + fallback do gate) para 3 (+ desfecho `"bloqueada-sem-navegar"`), e
  `contagemRef.current?.parar()` passa de 2 para 3 se o clique do link tiver handler próprio.
  Se o `onClick` do link reusar `aoFechar` (que já faz `parar()` + `setAberto(false)`), a
  contagem fica em 2, e o comentário de `aoFechar` passa a dizer "fecha o aviso; quem navega,
  se for o caso, é o próprio link". O `planejar` escolhe; a spec só exige que a trava reflita a
  escolha. O describe §6 inteiro ("gesto com popup bloqueado — fallback para navegação
  top-level") é **substituído** pelas travas do link declarativo, não mantido ao lado.

Smoke manual obrigatório antes do merge (sem Playwright, issue 176), registrado no corpo da PR:
1. Chrome desktop, padrão de fábrica: passo 1 aparece → contagem acaba → ícone de pop-up
   bloqueado → modal no **passo 2**, aba da confirmação intacta → "Enviar mensagem" abre aba
   nova, modal fecha, confirmação intacta.
2. Chrome desktop com pop-ups liberados para o site: contagem acaba → aba nova abre → modal
   fecha sozinho.
3. Chrome desktop, clique em "Enviar agora" durante a contagem: aba nova, modal fecha,
   **a aba da confirmação não troca** (é a regressão do bug latente).
4. Celular (Android Chrome e iOS Safari): contagem acaba → WhatsApp abre (app) → voltar ao
   navegador mostra a confirmação, sem o modal.
5. Firefox desktop: igual ao 1.

Os behaviors podem ser marcados `[x]` com a suíte verde + smoke manual registrado na PR. Se o
smoke não for feito, ficam `[ ]` com a nota "clique real pendente, issue 176", o mesmo
critério da spec 5.

## Fora do Escopo (v1)

- O botão manual "Avisar a loja no WhatsApp" (spec 3) e qualquer outro uso de `wa.me` ou de
  `montarLinkWhatsappPedido` fora deste modal.
- Mudar a duração da contagem, a copy do passo 1 ou a trava de copy de RN-A7.
- Detectar falso-positivo de WebView/extensão (handle devolvido sem aba real, `aba.closed`
  logo depois). Risco aceito, e a rede de segurança é o botão manual.
- Tentar preservar a ativação transitória do clique de "Confirmar pedido" até o fim da
  contagem (mecânica da RN-A5 aposentada). Não funciona com 5s de contagem e reabriria o
  problema que a issue 287 fechou.
- Playwright/MCP de browser para automatizar o smoke (issue 176).
- Web Push / aviso com a aba fechada (roadmap, `status-pedido-clicavel-e-latencia.md`).
