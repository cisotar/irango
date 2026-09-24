# Spec: Remoção de cardápio com produtos exclusivos — manter, arquivar ou remover em cascata

**Versão:** 0.1.0 | **Atualizado:** 2026-09-21
**Plano de origem:** `plan/loop-remocao-de-cardapio-com-exclusivos.md` (§0, §5 passo 2)
**Spec-mãe:** `specs/arquivo/cardapio-sazonal.md` (D14 · RN-13, RN-14)

## Visão Geral

Hoje, remover um cardápio sazonal que tem **produtos exclusivos** (`produtos.visibilidade = 'cardapio'`
sem nenhum outro vínculo) é **recusado**: `removerCardapio` (`src/lib/actions/cardapio.ts:440`) lê
`buscarProdutosQueFicariamOrfaos` (`src/lib/supabase/queries/cardapios.ts:316`) e devolve
`mensagemExclusivos(n)`. A única saída oferecida é `converterExclusivosParaMenu`
(`src/lib/actions/cardapio.ts:504`) — ou seja, **só existe a opção "manter"**.

Não é bug, é lacuna de design: quando a temporada acaba, o lojista frequentemente **não quer** o prato
de Natal de volta ao menu o ano inteiro. Faltam as outras duas saídas.

Esta feature dá **três** escolhas no mesmo `AlertDialog` de remoção, quando há N exclusivos:

| Modo | O que faz com os N produtos | Efeito na vitrine | Reversível? |
|---|---|---|---|
| `manter` | nada — o lojista clica em "Converter para o menu" (comportamento de hoje, **inalterado**) | passam a aparecer o ano inteiro | — |
| `arquivar` | `oculto = true` **e** `visibilidade = 'menu'` | somem da vitrine; a categoria/seção some sozinha se ficar sem produto visível | sim (um clique em `alternarOculto`) |
| `cascata` | **apaga** os N produtos | somem da vitrine; histórico de pedido preservado | **não** |

**Mundo:** painel do lojista (`/painel/cardapios`) e hub admin (`/admin/assinantes/[lojaId]/cardapios`).
Nenhuma mudança na vitrine pública. Nenhum valor monetário entra nesta fatia; o ativo protegido é
**produto de outra loja** e a **remoção permanente**.

### Ressalva de vocabulário (decidida, não negociável na implementação)

No projeto, "indisponível/invisível na vitrine" é `oculto = true` (`alternarOculto`, `produto.ts:251`).
`disponivel = false` é **"esgotado"**, que **continua visível**, só marcado. Portanto **"arquivar"
mapeia para `oculto = true`, nunca para `disponivel = false`** (RN-05).

E como o trigger de RN-14 exige vínculo para `visibilidade = 'cardapio'`, arquivar tem de gravar
`visibilidade = 'menu'` **junto** com `oculto = true`, no mesmo UPDATE — senão o produto vira exclusivo
órfão e o COMMIT do request seguinte é recusado.

## Atores Envolvidos

- **Lojista** — escolhe um dos três modos no diálogo de `/painel/cardapios`. É dele a declaração de
  `visibilidade`: o sistema nunca a muda por conta própria (§Atores da spec-mãe).
- **iRango (admin SaaS)** — pode fazer o mesmo na loja-alvo pelo hub, sob `service_role`, com
  `registrarAcessoAdmin` em `admin_acessos`. Paridade byte a byte de validação e de mensagem com o
  lojista — R5 registrado, não mitigado por gate: o clique é de outra pessoa, e o rastro é o log.
- **Cliente final** — não participa. Só observa o efeito na vitrine, que já funciona hoje (RN-11).

---

## Decisão D1 (a que o plano deixou em aberto): **sequência de dois requests, SEM RPC**

**Confirmo a recomendação do `orquestrar`. Não há RPC, não há migration, não há `npx supabase db push`.**

A dúvida era se `arquivar` e `cascata` precisam de uma RPC `security definer` (travas T1–T7,
`seguranca.md` §2) para escrever produtos e cardápio na **mesma transação**. Precisariam **se** alguma
ordem de escrita violasse o constraint trigger deferido. Nenhuma viola. Evidência literal, do código e
dos testes que já estão no repo — não de suposição:

1. **O trigger da ponta 1 nem dispara no `arquivar`.**
   `supabase/migrations/20260920131000_produtos_exclusivo_trigger.sql:115-120`:
   ```sql
   create constraint trigger produtos_exclusivo_tem_cardapio
     after insert or update of visibilidade on public.produtos
     deferrable initially deferred
     for each row
     when (new.visibilidade = 'cardapio')
   ```
   O `when` recusa o disparo quando o UPDATE grava `'menu'`. Request 1 do `arquivar`
   (`visibilidade = 'menu'` + `oculto = true`) **passa sem avaliar nada**. No request 2, a cascata de
   `cardapios` apaga os vínculos e a ponta 2 dispara — mas o `exists (... visibilidade = 'cardapio')`
   da função (`:90-96`) já é **falso** para esses produtos. Nenhum órfão.

2. **Apagar o próprio produto é caso EXPLICITAMENTE permitido.**
   Cabeçalho da mesma migration, `:57-59`: *"O QUE NÃO É RECUSADO (…) apagar o PRÓPRIO produto
   (cascade leva o vínculo; no COMMIT o produto não existe → EXISTS falso)"*. E há teste verde no
   repo hoje: `tests/migrations/produtos_exclusivo_trigger_e_vitrine_visibilidade.test.ts:475` —
   `[d/<role>] apagar o PRÓPRIO produto passa (não há invariante a defender)`, rodado **tanto
   `asUser` quanto `asService`** (o `describe` parametrizado de `:389`). Request 1 do `cascata`
   (DELETE dos N) passa; request 2 (DELETE do cardápio) encontra só vínculos de produtos `menu` ou de
   exclusivos pendurados em outro cardápio — e é justamente o caso `[c]` (`:445`) que só recusa quando
   **sobra** exclusivo órfão.

3. **A ordem errada é que quebraria** — e é por isso que ela é normativa (RN-06): apagar o cardápio
   primeiro derruba a transação com `23000` + `produto exclusivo sem cardapio` (teste `[c]`, `:445`,
   com as três tabelas voltando ao que eram). O trigger é fail-closed; o custo de errar a ordem é um
   erro, nunca um órfão.

4. **Falha entre os dois requests deixa estado reconciliável, não corrompido.** Produtos já
   arquivados/apagados + cardápio ainda existente, **agora sem exclusivos**, removível numa segunda
   tentativa (que agora cai no caminho `manter`, sem órfãos). É **exatamente** o grau de atomicidade
   do par `converterExclusivosParaMenu` → `removerCardapio` que já está em produção desde a issue 255.
   Uma RPC não removeria a janela: ela só a moveria para dentro de um request que o usuário pode
   abandonar do mesmo jeito.

5. **Uma RPC teria custo real e nenhum ganho de invariante.** Migration nova + `db push` autorizado no
   cloud (irreversível), superfície `security definer` nova a ser revogada de `anon` (T7,
   `seguranca.md` §2), e a autoridade teria de ser **reconstruída no corpo** (T2 `coalesce(auth.role(), '')`
   fail-closed) porque `definer` nunca avalia RLS. O que protege esta fatia — recálculo dos órfãos no
   servidor, escopo por `loja_id`, RLS do lojista, trigger sob `BYPASSRLS` — já está inteiro nas duas
   Server Actions.

**Consequência para o `tdd`:** nenhum cenário novo em `tests/migrations/`. O comportamento do trigger
nos dois caminhos já está coberto por `[c]` e `[d]`, nas duas roles. Os testes novos são de Server
Action (`src/lib/actions/`) e de paridade (`src/app/admin/assinantes/actions/`).

**Backstop mantido:** o par `ehErroDeExclusivoOrfao` + `MSG_EXCLUSIVOS_SEM_NUMERO`
(`cardapio-contrato.ts:110-131`) continua envolvendo o DELETE do cardápio nos três modos. Se alguém
vincular um novo exclusivo entre o request 1 e o request 2 (TOCTOU real, não teórico), o COMMIT recusa
e o lojista recebe a frase acionável — nunca o `23000` cru (RN-09).

---

## Páginas e Rotas

### Cardápios do lojista — `/painel/cardapios`
**Mundo:** painel (auth obrigatório)
**Descrição:** lista de cardápios. O gesto "Remover" abre o `AlertDialog` destrutivo já existente
(`CardapiosClient.tsx:307-401`). Quando a remoção é recusada por exclusivos, o bloco `role="alert"`
âmbar (`:346-368`) passa a oferecer **três** botões em vez de um.

**Componentes:** (tudo reuso — nada novo)
- `AlertDialog` do shadcn (`components/ui/alert-dialog`) — já montado no arquivo, não editar `components/ui/`
- `Button` `variant="outline"` (converter, arquivar) e `variant="destructive"` (remover produtos)
- `frasesDoImpacto` / `rotuloConverter` — `src/components/painel/frasesCardapio.ts` (módulo puro,
  afirmável sem DOM); os rótulos novos entram **nele**, não no `.tsx`
- `AcoesCardapios` — contrato de injeção declarado em `CardapiosClient.tsx:63-82`, o mesmo consumido
  pelo `CardapiosAdminClient.tsx:46`

**Behaviors:**
- [x] Abrir o diálogo de remoção e confirmar — chama `acoes.remover(id, "manter")`. Garantido em: Server Action + RLS.
- [x] Ler a recusa com o número N de exclusivos — **preview de UX** no cliente; o N exibido vem de
      `resultado.exclusivos`, **calculado no servidor** na mesma resposta. Nenhuma decisão do servidor
      depende dele.
- [x] Clicar "Converter os N produtos para o menu" — `acoes.converter(id)`, inalterado. Garantido em: Server Action + RLS.
- [x] Clicar "Arquivar os N produtos" — `acoes.remover(id, "arquivar")`. Sem segunda confirmação
      (gesto reversível). Garantido em: Server Action + RLS.
- [x] Clicar "Remover os N produtos" (botão destrutivo, o terceiro) — **não executa nada ainda**:
      troca o bloco de alerta para o estado de segunda confirmação, com
      `FRASE_CASCATA_PERMANENTE(N)` e os botões "Cancelar" / "Apagar N produtos e remover o cardápio".
      Garantido em: cliente (UX). A segunda confirmação é ergonomia, **não** é a proteção.
- [x] Confirmar a segunda vez — `acoes.remover(id, "cascata")`. Garantido em: Server Action + RLS.
      A lista de produtos apagados é **recalculada no servidor** (RN-02); o cliente manda só o modo.
- [x] Cancelar/fechar em qualquer ponto — nada é escrito. Garantido em: cliente (UX).

### Cardápios da loja-alvo no hub admin — `/admin/assinantes/[lojaId]/cardapios`
**Mundo:** painel admin (auth obrigatório + `verificarAdminSaaS`)
**Descrição:** o **mesmo** `CardapiosClient`, com `acoes` injetadas por
`CardapiosAdminClient.tsx`. Nenhum JSX novo, nenhuma frase redeclarada.

**Componentes:** os mesmos (o client é compartilhado por construção).

**Behaviors:** idênticos aos do lojista, com `acoes.remover: (id, modo) => removerCardapioAdmin(lojaId, id, modo)`.
- [x] Executar qualquer dos três modos na loja-alvo — Garantido em: Server Action + `verificarAdminSaaS`
      (fail-closed, antes de elevar) + escopo por `lojaId` da URL validado. **RLS não protege aqui**
      (`service_role` tem `BYPASSRLS`): o que protege é o escopo explícito, as FKs compostas e o trigger.
- [x] Cada uma das três escritas grava `admin_acessos` (`cardapio.remover` com
      `metadados: { modo, produtos: N }`). Garantido em: Server Action (fire-and-forget, nunca derruba a action).

---

## Regras de Negócio

| # | Regra | Camada que garante |
|---|---|---|
| **RN-01** | O modo é um dos três literais `"manter" \| "arquivar" \| "cascata"`. Qualquer outro valor (ausente, `null`, string arbitrária, objeto) **não** cai em ramo destrutivo: parse falha e a action devolve `MSG_INVALIDO` sem nenhum I/O. O `default` do `switch` é `MSG_INVALIDO`, nunca um dos modos. | **zod** (`schemaModoRemocao` em `lib/validacoes/cardapio.ts`, isomórfico entre os dois mundos) + `switch` exaustivo em TS |
| **RN-02** | **A lista de produtos a arquivar ou apagar é SEMPRE recalculada no servidor** por `buscarProdutosQueFicariamOrfaos(client, lojaId, cardapioId)`. Nenhuma action aceita ids de produto do cliente nesta fatia — o payload é `(id do cardápio, modo)` e nada mais. Mandato 1 do projeto. | **Server Action** (assinatura sem lista) + **RLS** (lojista) / escopo `loja_id` (admin) |
| **RN-03** | Toda escrita é escopada por `loja_id`: do dono da sessão (`buscarLojaDoDono`) no lojista, do `lojaId` da URL validado (`validarLojaIdAdmin` → `prepararContextoAdmin`) no admin. **Nunca do payload.** Os UPDATEs/DELETEs de produto carregam `.eq("loja_id", …)` explícito **além** da RLS, e `.eq("visibilidade", "cardapio")` como segundo cinto. | **Server Action** + **RLS** `produtos_escrita_propria` (lojista) + **FKs compostas** `(produto_id, loja_id)` de `20260920129000` |
| **RN-04** | Antes de ler os órfãos nos modos `arquivar` e `cascata`, a posse do cardápio é provada por `cardapioPertenceALoja` (precedente 274·D8, já aplicado em `converterExclusivosParaMenu`). Sem isso, sob `service_role` um `cardapioId` alheio faria a leitura rodar sobre **outro tenant** e o log gravaria `entidade_id` que não é da loja-alvo. Cardápio alheio e inexistente devolvem **a mesma frase** (`MSG_REMOVER`) — a recusa não vira oráculo de existência (`seguranca.md` §14). O modo `manter` **não** ganha esse gate (preservação byte a byte — RN-10). | **Server Action** |
| **RN-05** | `arquivar` grava **exatamente dois campos**: `oculto = true` **e** `visibilidade = 'menu'`, no **mesmo** UPDATE. **Nunca** toca `disponivel` (isso é "esgotado", que continua visível), `preco`, `nome`, `categoria_id` ou `loja_id`. | **Server Action** (UPDATE com objeto literal de duas chaves) + **trigger** RN-14 (um `visibilidade` que continuasse `'cardapio'` seria recusado no COMMIT) |
| **RN-06** | **Ordem normativa das escritas nos dois modos novos: produtos PRIMEIRO, cardápio DEPOIS.** A ordem inversa derruba a transação com `23000`. | **Server Action** (ordem do código) + **trigger** deferido (fail-closed se a ordem for violada) |
| **RN-07** | `cascata` apaga **só** os órfãos recalculados: exclusivo pendurado em **outro** cardápio não é apagado, produto do **menu** vinculado não é apagado, produto de **outra loja** não é tocado. O DELETE é `.eq("loja_id", …).eq("visibilidade", "cardapio").in("id", orfaos)`. | **Server Action** + **RLS** / escopo admin |
| **RN-08** | Apagar produto **não** corrompe histórico: `itens_pedido.produto_id` é `on delete set null` com snapshot de nome e preço (spec-mãe). Nenhum pedido antigo muda de valor. | **FK** `on delete set null` |
| **RN-09** | Se o DELETE do cardápio falhar com `23000` + fragmento `produto exclusivo sem cardapio` (corrida entre os dois requests), o usuário recebe `MSG_EXCLUSIVOS_SEM_NUMERO`; qualquer outro erro vira `MSG_REMOVER`. O texto cru do Postgres vai para `console.error`, nunca para a tela. | **Server Action** (`ehErroDeExclusivoOrfao`, já existente) + `seguranca.md` §14 |
| **RN-10** | `modo = "manter"` (e a ausência do parâmetro) preserva o comportamento atual **byte a byte**: mesma leitura, mesma recusa `mensagemExclusivos(n)`, mesmo `exclusivos: n`, mesmo `MSG_EXCLUSIVOS_SEM_NUMERO`, mesmo `count === 0 → MSG_REMOVER`, mesma sequência de chamadas. **Nenhum teste existente de `removerCardapio` / `removerCardapioAdmin` pode mudar de expectativa.** | **Server Action** + a suíte atual (`cardapio.crud.test.ts`, `admin-cardapios.paridade.test.ts`) como trava de regressão |
| **RN-11** | **Nenhuma regra nova de vitrine.** Categoria sem produto visível já é descartada (`queries/produtos.ts:172`), seção de cardápio sem item também (`utils/catalogoVitrine.ts:374`), e a view `vitrine_produtos` já filtra `p.oculto = false`. A premissa do usuário foi conferida e está **correta**. | **já existente** — nada a implementar |
| **RN-12** | Paridade lojista ↔ admin: mesma validação, mesma ordem de escritas e **as mesmas frases**, importadas do módulo neutro `cardapio-contrato.ts`. Nenhuma string é redeclarada no arquivo admin. | **Server Action** + `admin-cardapios.paridade.test.ts` |
| **RN-13** | No admin, as três escritas registram `admin_acessos` com `acao: "cardapio.remover"` e `metadados: { modo, produtos: N }`. Falha de log **nunca** derruba a action (fire-and-forget). | **Server Action** (`registrarAcessoAdmin`) |

## Contrato das actions

Tipo do modo, no **módulo neutro** (arquivo `'use server'` só exporta função async):

```ts
// src/lib/actions/cardapio-contrato.ts
export type ModoRemocaoExclusivos = "manter" | "arquivar" | "cascata";
```

```ts
// src/lib/actions/cardapio.ts
export async function removerCardapio(
  id: string,
  modo?: ModoRemocaoExclusivos,   // ausente ⇒ "manter" (RN-10)
): Promise<ResultadoRemocao>;

// src/app/admin/assinantes/actions/admin-cardapios.ts
export async function removerCardapioAdmin(
  lojaId: string,
  id: string,
  modo?: ModoRemocaoExclusivos,
): Promise<ResultadoRemocao>;
```

`ResultadoRemocao` **não muda**: `{ ok: true } | { ok: false; erro: string; exclusivos: number }`.
Ampliar o sucesso com contagem tentaria o cliente a confiar num número que não precisa; a contagem
autoritativa que a UI usa é a que veio na **recusa** anterior.

Fluxo interno dos modos novos (idêntico nos dois mundos, só trocando client e origem do `loja_id`):

1. parse do `id` (`schemaIdCardapio`) e do `modo` (`schemaModoRemocao`) — **antes de qualquer I/O**;
2. resolver `loja_id` (sessão / URL validada);
3. `cardapioPertenceALoja` (RN-04) → falso ⇒ `MSG_REMOVER`;
4. `orfaos = buscarProdutosQueFicariamOrfaos(...)` (RN-02);
5. se `orfaos.length > 0`, **request 1** (RN-06):
   - `arquivar`: `update({ oculto: true, visibilidade: "menu" }).eq("loja_id").eq("visibilidade","cardapio").in("id", orfaos)`
   - `cascata`: `delete().eq("loja_id").eq("visibilidade","cardapio").in("id", orfaos)`
   - erro ⇒ `MSG_REMOVER`, **sem** seguir para o passo 6 (o cardápio continua existindo — reconciliável);
6. **request 2**: o DELETE do cardápio **exatamente como está hoje**, com o mesmo tratamento de erro,
   o mesmo backstop e o mesmo `count === 0`;
7. `revalidarCaminhosDoCardapio(loja.slug)` / `revalidarLojaAdmin(lojaId)`; no admin,
   `registrarAcessoAdmin` (RN-13).

**Divergência consciente do plano §3:** os passos de escrita **não** chamam `removerProduto` /
`alternarOculto` (`produto.ts:183`, `:251`) N vezes. Aquelas actions são de **um id**: N chamadas
seriam N `buscarLojaDoDono`, N round trips, N `revalidatePath` e uma falha parcial no meio do laço.
O que se reusa é o **padrão de escrita em lote já validado** em `converterExclusivosParaMenu`
(`cardapio.ts:530-540`): um único statement `.in("id", orfaos)` escopado por `loja_id`, que é atômico
por si e é a forma que o projeto já audita. Nada novo é inventado.

## Mensagens

`mensagemExclusivos(n)` (`cardapio-contrato.ts:136`) e `MSG_EXCLUSIVOS_SEM_NUMERO` (`:131`) ficam
**intocados** — RN-10 exige preservação byte a byte, e dois testes já afirmam o literal
(`cardapio.crud.test.ts:336`, `admin-cardapios.paridade.test.ts:52`). As frases novas são **aditivas**,
em `src/components/painel/frasesCardapio.ts`, ao lado de `rotuloConverter` (`:47`), com teste literal
no módulo puro ao lado:

```ts
/** Rótulo do 2º botão da recusa — gesto reversível, sem segunda confirmação. */
export function rotuloArquivar(n: number): string {
  return n === 1
    ? "Arquivar 1 produto"
    : `Arquivar os ${n} produtos`;
}

/** Rótulo do 3º botão (destrutivo). Não executa: abre a 2ª confirmação. */
export function rotuloRemoverProdutos(n: number): string {
  return n === 1 ? "Remover 1 produto" : `Remover os ${n} produtos`;
}

/** O que "arquivar" faz, dito sem jargão — some da vitrine, não é apagado. */
export function fraseArquivar(n: number): string {
  return n === 1
    ? "O produto fica guardado e some da vitrine. Você pode exibi-lo de novo quando quiser."
    : `Os ${n} produtos ficam guardados e somem da vitrine. Você pode exibi-los de novo quando quiser.`;
}

/** A 2ª confirmação da cascata. Literal, curta, sem eufemismo. */
export function fraseCascataPermanente(n: number): string {
  return n === 1
    ? "1 produto será apagado permanentemente e não poderá ser recuperado."
    : `${n} produtos serão apagados permanentemente e não poderão ser recuperados.`;
}

/** Rótulo do botão que confirma a cascata de verdade. */
export function rotuloConfirmarCascata(n: number): string {
  return n === 1
    ? "Apagar 1 produto e remover o cardápio"
    : `Apagar ${n} produtos e remover o cardápio`;
}
```

Toasts de sucesso: `"Produtos arquivados e cardápio removido."` e
`"Produtos apagados e cardápio removido."` — no `.tsx`, como os de hoje.

**Ponto de copy deixado deliberadamente de fora:** a recusa continua dizendo *"Converta esses produtos
para o menu antes de remover o cardápio"*, que agora prescreve só uma das três saídas. Reescrevê-la
quebraria RN-10 e a linha de base do `tdd`. Vira issue de `/polir` **depois** do merge, não aqui.

## Modelos de Dados

**Nenhuma migration. Nenhuma coluna nova. Nenhuma tabela nova. Nenhuma política RLS nova.**
Tudo o que a feature precisa já existe:

| Objeto | Onde | Papel nesta fatia |
|---|---|---|
| `produtos.visibilidade` (`'menu' \| 'cardapio'`) | `20260920130000` | define quem é exclusivo |
| `produtos.oculto` (bool) | `20260621099000` | é o "arquivado" (RN-05) |
| `cardapio_produtos` (`on delete cascade` nas duas pontas) | `20260920129000` | os vínculos que somem com o cardápio |
| FKs compostas `(cardapio_id, loja_id)` / `(produto_id, loja_id)` | `20260920129000` | valem sob qualquer role, inclusive `service_role` |
| trigger `produtos_exclusivo_tem_cardapio` + `cardapio_produtos_exclusivo_tem_cardapio` | `20260920131000` | backstop `security definer`, vale sob `BYPASSRLS` |
| `itens_pedido.produto_id on delete set null` + snapshot | spec-mãe | RN-08 |
| RLS `produtos_escrita_propria`, `cardapios_escrita_propria` | existentes | escopo do lojista |

## Segurança (obrigatório)

- **Dado sensível que entra:** nenhum PII, nenhuma chave Pix, nenhum cupom. O payload é
  `(uuid do cardápio, modo)` — e no admin, `lojaId` da URL.
- **Valor monetário:** nenhum. O análogo do mandato 1 aqui é a **lista de produtos**: ela é
  recalculada no servidor (RN-02) e **nunca** aceita do cliente. O vetor clássico desta fatia é o
  IDOR de lote — apagar a lista que o cliente mandou em vez da que o servidor derivou —, que vazaria
  entre lojas e é **irreversível**. A assinatura da action é a trava: não há onde pendurar ids.
- **Tabela nova:** nenhuma → nenhuma política RLS nova a escrever.
- **API externa com key:** nenhuma.
- **`service_role` no admin:** `BYPASSRLS` desliga a RLS, **não** o trigger nem as FKs compostas. O
  que protege o caminho admin é, nesta ordem: `verificarAdminSaaS()` antes de elevar (fail-closed,
  exceção propaga), `loja_id` do `lojaId` da URL validado, `.eq("loja_id")` explícito em toda escrita,
  `cardapioPertenceALoja` antes da leitura (RN-04), FKs compostas, trigger.
- **Oráculo de existência:** cardápio alheio, cardápio inexistente e falha de banco devolvem os
  **mesmos bytes** (`MSG_REMOVER`). Nenhuma contagem de "ignorados" vaza (`seguranca.md` §14).
- **Erro interno:** `console.error` no servidor; na tela, só `MSG_INVALIDO`, `MSG_LOJA`, `MSG_REMOVER`
  ou `MSG_EXCLUSIVOS_SEM_NUMERO`.
- **Segunda confirmação é UX, não segurança.** Ela vive no cliente e pode ser pulada por quem chamar a
  Server Action direto. A ação continua sendo autorizada e escopada no servidor de qualquer forma.

## Critérios de Aceite (mecânicos — a lista do `tdd`)

Nos dois mundos, em paridade (lojista em `src/lib/actions/`, admin em
`admin-cardapios.paridade.test.ts`):

1. **`manter` (regressão):** `removerCardapio(id)` e `removerCardapio(id, "manter")` produzem a
   **mesma** sequência de chamadas e a **mesma** resposta de hoje, com o literal de
   `mensagemExclusivos(1)`. Nenhuma escrita em `produtos`.
2. **`arquivar`:** com 2 órfãos, ocorre **um** UPDATE em `produtos` com **exatamente**
   `{ oculto: true, visibilidade: "menu" }` — a asserção afirma o objeto inteiro, provando que
   `disponivel` **não** está lá — filtrado por `loja_id`, `visibilidade = 'cardapio'` e `in(ids)`;
   **depois** o DELETE em `cardapios`. Ordem afirmada (RN-06).
3. **`cascata`:** um DELETE em `produtos` `in(orfaos)` escopado por `loja_id`, **depois** o DELETE em
   `cardapios`. Ordem afirmada.
4. **Lista do servidor, nunca do cliente:** a action não tem parâmetro de ids; o teste afirma que o
   `in(...)` recebeu **exatamente** o retorno de `buscarProdutosQueFicariamOrfaos` (mockado com um
   conjunto diferente do "esperado ingênuo" — inclui um exclusivo com **outro** vínculo, que **não**
   pode aparecer no `in`).
5. **Isolamento entre lojas:** produto de **outra loja** com nome parecido não é tocado — todo
   `update`/`delete` de produto carrega `.eq("loja_id", <loja da sessão / lojaId da URL>)`, afirmado
   literalmente. No admin, `lojaId` de outra loja no payload **não** altera o escopo.
6. **Posse do cardápio (RN-04):** `cardapioPertenceALoja` falso nos modos novos ⇒ `MSG_REMOVER`,
   **zero** escritas em `produtos` e **zero** `registrarAcessoAdmin` com `entidade_id` alheio.
7. **Modo inválido:** `"apagar"`, `""`, `undefined` explícito com cast, objeto ⇒ `MSG_INVALIDO`,
   **sem nenhum I/O** (nem `buscarLojaDoDono`).
8. **Falha no request 1 não segue para o 2:** erro no UPDATE/DELETE de produtos ⇒ `MSG_REMOVER` e
   **nenhum** DELETE em `cardapios`.
9. **Backstop na corrida:** DELETE do cardápio devolvendo `{ code: "23000", message: "... produto
   exclusivo sem cardapio ..." }` ⇒ `MSG_EXCLUSIVOS_SEM_NUMERO` nos três modos.
10. **Frases puras:** `fraseCascataPermanente`, `rotuloArquivar`, `rotuloRemoverProdutos`,
    `rotuloConfirmarCascata`, `fraseArquivar` afirmadas byte a byte em singular e plural
    (`frasesCardapio.test.ts`).
11. **Paridade:** as frases do admin são as **importadas**, não redeclaradas; mesma resposta byte a
    byte para os mesmos cenários nos dois mundos.
12. **Sem cenário novo em `tests/migrations/`** — D1 resolveu sem RPC, e `[c]`/`[d]` de
    `produtos_exclusivo_trigger_e_vitrine_visibilidade.test.ts` já cobrem o trigger nas duas roles.
    (Se, e só se, a decisão for revertida para RPC, entram T1–T7 e o cenário de trigger em pglite.)

## Fora do Escopo (v1)

- **Qualquer mudança na vitrine.** `src/lib/utils/catalogoVitrine.ts`, `src/lib/supabase/queries/produtos.ts`
  e a view `vitrine_produtos` **não são tocados** — RN-11, premissa do usuário conferida e correta.
- **RPC `security definer` e migration.** D1 decidiu pela sequência de dois requests; nenhum
  `npx supabase db push` entra neste trabalho.
- **Desfazer a cascata / lixeira de produtos.** Apagado é apagado (a frase da 2ª confirmação promete
  exatamente isso). Quem quer reversível usa `arquivar`.
- **Arquivar/apagar em lote fora do diálogo de remoção** (ex.: uma tela de "produtos de temporada
  encerrada"). Fase posterior, se o uso pedir.
- **Modo padrão configurável por loja** ("sempre arquivar ao remover cardápio"). Preferência
  persistida é fase 2 — e escolher por conta própria contradiz §Atores da spec-mãe: `visibilidade`
  é declaração do lojista, gesto a gesto.
- **Reescrever a recusa `mensagemExclusivos`** para mencionar as três saídas — `/polir` depois do merge.
- **Aviso na vitrine de que um produto sumiu.** Não existe e não passa a existir.
