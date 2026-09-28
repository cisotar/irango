# [331] Contagem do aviso do WhatsApp tenta aba nova, com fallback por dispositivo

**crítica:** SIM (TDD red-first)
**Mundo:** vitrine pública
**Depende de:** —
**Spec:** specs/aviso-whatsapp-contagem-nova-aba.md

> Por que crítica: não é dinheiro/RLS/cupom/token, mas mexe em invariante de segurança
> (§15 `urlHttpsSegura` como fonte única do destino e §15-A reverse tabnabbing, com uma
> exceção nova à regra de `noopener`). E a suíte atual trava de propósito o comportamento
> CONTRÁRIO ("contagem esgotada usa navegação TOP-LEVEL, nunca aba nova"; "no PC a contagem
> não é armada"). Esses testes são **reescritos**, não apagados, e o RED com `FAIL` capturado
> prova que a troca foi intencional (recomendação explícita da spec, § Segurança > TDD).

## Objetivo

A contagem de 5s do `ModalAvisoWhatsapp` volta a aparecer em qualquer dispositivo (D1) e, ao
esgotar, primeiro tenta abrir o WhatsApp em aba nova. Com aba aberta o modal fecha; com popup
bloqueado, o computador vai ao passo 2 sem trocar a aba e a tela de toque navega na mesma aba
como hoje (D2, D2.1, D4, RN-AN1..AN3).

## Escopo

Módulo puro `src/components/vitrine/confirmacao/avisoWhatsapp.ts` (`criarContagemAviso`):
- [ ] `DepsContagemAviso` ganha `tentarAbrirNovaAba(destino): "aberta" | "bloqueada"`,
  `podeNavegarTopLevel: boolean` e `aoEsgotar(desfecho)`, com
  `desfecho ∈ "aberta" | "bloqueada-sem-navegar" | "navegou-top-level"` (nomes ajustáveis
  pelo `planejar`, semântica não).
- [ ] `ContagemAviso` expõe `readonly destino: string | null` (= `urlHttpsSegura(href)`,
  calculado uma vez na criação). É o que a issue 332 vai pôr no `href` do `<a>`.
- [ ] Último tick: `parar()`, depois `tentarAbrirNovaAba(destino)` **uma vez**, antes de
  qualquer navegação. `"aberta"` ⇒ `aoEsgotar("aberta")`, sem `navegarTopLevel`.
  `"bloqueada"` + `podeNavegarTopLevel === false` ⇒ `aoEsgotar("bloqueada-sem-navegar")`,
  `navegarTopLevel` **nunca**. `"bloqueada"` + `true` ⇒ `navegarTopLevel(destino)` uma vez e
  `aoEsgotar("navegou-top-level")`.
- [ ] Destino reprovado pelo guard ⇒ `tentarAbrirNovaAba`, `navegarTopLevel` e `aoEsgotar`
  nunca chamados (e `iniciar()` continua sem agendar tick).
- [ ] `enviarAgora`/`abrirNovaAba` **ficam como estão nesta issue** (caminho do gesto, sai na
  332). Assim `tsc` segue verde entre os commits das duas issues.

Componente `src/components/vitrine/confirmacao/ModalAvisoWhatsapp.tsx` (só a fiação da contagem):
- [ ] Condição de arme volta a ser só `if (persistiu) { contagem.iniciar() }`, sem
  `!ehComputadorComMouse()` (D1). Gate que não persistiu continua indo direto ao passo 2 (D5).
- [ ] `ehComputadorComMouse()` avaliado **uma vez** na montagem e injetado como
  `podeNavegarTopLevel = !ehComputadorComMouse()`. Atualizar o comentário da função: ela passa
  a escolher só o fallback do bloqueio.
- [ ] `tentarAbrirNovaAba` = `window.open(destino, "_blank")` **sem terceiro argumento**; `null`
  ⇒ `"bloqueada"`; senão `aba.opener = null` na mesma tarefa síncrona e `"aberta"`.
- [ ] `navegarTopLevel` continua sendo o único `window.location.href = destino` do caminho da
  contagem.
- [ ] `aoEsgotar`: `"aberta"` ⇒ `setAberto(false)`; `"bloqueada-sem-navegar"` ⇒ `setPasso(2)`;
  `"navegou-top-level"` ⇒ nada (a aba está saindo).

Testes (RED primeiro, com `FAIL` capturado):
- [ ] `avisoWhatsapp.test.ts`: reescrever "contagem esgotada usa navegação TOP-LEVEL, nunca aba
  nova" e "só o Nº tick navega" para o contrato novo; tabela
  `podeNavegarTopLevel ∈ {true,false} × tentarAbrirNovaAba ∈ {"aberta","bloqueada"}` ⇒ desfecho
  e chamadas; `tentarAbrirNovaAba` exatamente 1 vez, só no último tick, nunca depois de
  `parar()`, nunca com destino reprovado; `contagem.destino === urlHttpsSegura(href)` em toda a
  tabela de destinos que o teste de `decidirAvisoWhatsapp` já usa.
- [ ] `ModalAvisoWhatsapp.test.tsx`: reescrever "REGRESSÃO: no PC (mouse), a contagem também
  não é armada" como trava do oposto (`if (persistiu)` sem `ehComputadorComMouse` na condição);
  trava de fonte para `window.open(destino, "_blank")` sem terceiro argumento seguido de
  `.opener = null`; `setAberto(false)` no desfecho `"aberta"` e `setPasso(2)` no
  `"bloqueada-sem-navegar"`.

## Fora de escopo

- Botões "Enviar agora"/"Enviar mensagem" viram `<a target="_blank">` e remoção de
  `enviarAgora`/`abrirNovaAba` e do fallback `location.href` do gesto → **issue 332**.
- `references/seguranca.md` §15-A e RN-A7 da spec 5 → **issue 333**.
- Duração, copy dos passos, trava de copy (D6). Detectar falso-positivo de WebView
  (`aba.closed`). Instruir o cliente a liberar pop-ups.

## Reuso esperado

- `urlHttpsSegura` (`src/lib/utils/urlHttpsSegura.ts`): continua aplicado **uma vez**, em
  `criarContagemAviso`. O componente continua sem importá-lo.
- `TimerAviso` fake e helpers já existentes em `avisoWhatsapp.test.ts`: estender, não recriar.
- `decidirEMarcarAvisoUmaVez`, `SEGUNDOS_AVISO_WHATSAPP`, `ehComputadorComMouse`: manter.
- Nenhum componente novo; `components/ui/` não é tocado.

## Segurança

- Valor monetário: nenhum. Sem migration, sem RLS, sem Server Action.
- §15: nenhum caminho abre ou navega para destino reprovado; o destino exposto é o aprovado.
- §15-A: `window.open` sem `noopener` é exceção deliberada (precisamos do handle para detectar
  bloqueio); `aba.opener = null` na mesma tarefa, antes do `wa.me` carregar.
- PII: `href`/`destino` continuam nunca logados (o teste do precedente [161] segue verde).
- RN-AN1: com `podeNavegarTopLevel === false`, a contagem nunca troca a aba da confirmação.

## Critério de aceite

- [ ] Teste vermelho escrito primeiro, com output `FAIL` capturado, e depois verde.
- [ ] Tabela 2×2 do módulo verde; nenhum teste da suíte antiga apagado sem substituto
  equivalente no contrato novo.
- [ ] Invariantes de RN-A7 continuam verdes: "Agora não" para e não religa; saída/Esc fecham
  sem navegar; gate de storage; SSR vazio; cleanup chama `parar()`; um único `useEffect([])`.
- [ ] `npx tsc --noEmit`, `npm run lint`, `npm test` e `npm run build` verdes.
