# [332] Botões de envio do aviso do WhatsApp viram link declarativo (corrige troca de aba no clique)

**crítica:** SIM (TDD red-first)
**Mundo:** vitrine pública
**Depende de:** 331
**Spec:** specs/aviso-whatsapp-contagem-nova-aba.md

> Por que crítica: invariante de segurança §15/§15-A (reverse tabnabbing via `rel`, destino
> aprovado pelo guard e nunca o `href` cru da prop). O teste atual "retorno `null`
> (bloqueador) ⇒ `window.location.href`" trava o bug latente como se fosse correto, e tem de
> ser reescrito com RED antes da troca.

## Objetivo

"Enviar agora" (passo 1) e "Enviar mensagem" (passo 2) abrem o WhatsApp em aba nova por link
declarativo e fecham o modal, sem trocar a aba da confirmação (D3, RN-AN4). Isso elimina o bug
latente: `window.open(..., "noopener")` sempre devolve `null`, então todo clique hoje também
faz `location.href = destino`.

## Escopo

- [ ] Os dois botões de envio viram `<Button asChild className="min-h-11 w-full"><a
  href={contagem.destino} target="_blank" rel="noopener noreferrer">…</a></Button>`.
  `target` e `rel` **literais**. Alvo de toque ≥44px mantido.
- [ ] O `href` do `<a>` vem de `destino` da contagem (issue 331), guardado em estado/ref depois
  da montagem, **nunca** da prop `href`. Destino `null` ⇒ `<a>` sem `href` (o modal nem abre
  nesse caso, por `decidirAvisoWhatsapp`, mas o fallback não pode quebrar).
- [ ] `onClick` do link: `contagemRef.current?.parar()` + `setAberto(false)`, **sem
  `preventDefault`**. Nenhum `window.open` e nenhum `location.href` no caminho do gesto.
- [ ] Remover `enviarAgora` de `ContagemAviso` e `abrirNovaAba` de `DepsContagemAviso` em
  `avisoWhatsapp.ts`, e o `abrirNovaAba` com fallback `location.href` do componente.
- [ ] `avisoWhatsapp.test.ts`: o bloco "[287] envio por gesto" é reescrito como invariantes do
  que sobra no módulo (clique ⇒ `parar()` e nenhum tick posterior abre/navega; `destino`
  continua exposto depois de `parar()`, para o botão do passo 2). O bloco "[287] guard §15"
  perde o ramo do `enviarAgora` e mantém o da contagem.
- [ ] `ModalAvisoWhatsapp.test.tsx`: o bloco "[287] gesto com popup bloqueado — fallback para
  navegação top-level" é substituído por travas de fonte: `target="_blank"` e
  `rel="noopener noreferrer"` literais; `window.open(` aparece **exatamente 1 vez** (dentro de
  `tentarAbrirNovaAba`); nenhuma string `"noopener"` como argumento de `window.open`;
  `window.location.href` só dentro de `navegarTopLevel`; nenhum identificador `href` solto
  (prop) no atributo do `<a>`; sem `preventDefault` nos handlers de envio.

## Fora de escopo

- Fiação da contagem esgotada (`tentarAbrirNovaAba`, `aoEsgotar`, passo 1 em todo dispositivo)
  → **issue 331**.
- Botão manual "Avisar a loja no WhatsApp" (spec 3) e `montarLinkWhatsappPedido`.
- Documentação (§15-A, RN-A7) → **issue 333**.

## Reuso esperado

- `Button` de `components/ui/button` com `asChild` (shadcn, **não editar** o arquivo).
- `contagem.destino` exposto pela issue 331: não recalcular nem importar `urlHttpsSegura` no
  componente.
- Mesmo padrão declarativo do botão manual da spec 3 (conferir como ele renderiza o `<a>` antes
  de escrever; não duplicar lógica de link).

## Segurança

- §15-A: caso declarativo, `rel="noopener noreferrer"` já é o padrão aceito; `noreferrer` segura
  o `?token=` do pedido além do `Referrer-Policy` do `next.config.ts`.
- §15: `href` do `<a>` só com destino aprovado pelo guard.
- PII: o `href` passa a ficar no DOM do cliente depois da montagem (mesmo nível do botão manual
  da spec 3, aceito na spec). O HTML do SSR continua sem `href` (modal começa fechado): o teste
  de SSR vazio fica **sem mudança** e verde.
- Sem valor monetário, sem RLS, sem Server Action.

## Critério de aceite

- [ ] Teste vermelho (travas de fonte novas) com `FAIL` capturado antes da troca, depois verde.
- [ ] Clicar em "Enviar agora" durante a contagem abre aba nova, fecha o modal e não troca a
  aba da confirmação (confirmado no smoke da issue 333, item 3).
- [ ] Nenhum `window.location.href` alcançável a partir de clique.
- [ ] `npx tsc --noEmit`, `npm run lint`, `npm test` e `npm run build` verdes.
