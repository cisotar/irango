# [333] Documentar a exceção da §15-A, revisar RN-A7 e registrar o smoke do aviso em nova aba

**crítica:** NÃO
**Mundo:** infra (documentação + verificação manual)
**Depende de:** 331, 332
**Spec:** specs/aviso-whatsapp-contagem-nova-aba.md

## Objetivo

Fechar a spec no mesmo PR das issues 331 e 332: `references/seguranca.md` §15-A e a RN-A7 da
spec 5 passam a descrever o comportamento novo, o smoke manual obrigatório é feito e registrado
no corpo da PR, e os behaviors da spec são marcados.

## Escopo

- [ ] `references/seguranca.md` §15-A (via `escriba`): corrigir o "Padrão atual" (hoje descreve
  `window.open(..., "noopener")` no gesto e `navegarTopLevel` na contagem). Novo padrão: gesto =
  `<a target="_blank" rel="noopener noreferrer">`; contagem = `window.open(destino, "_blank")`
  sem `noopener` + `aba.opener = null` na mesma tarefa síncrona. Registrar a **segunda
  justificativa** da exceção à regra: precisar do handle para detectar bloqueio de popup (com
  `noopener` o retorno é sempre `null`). Ajustar a "Regra para devs e agentes" para incluir
  esse caso sem abrir a porta para `window.open` sem `noopener` fora dele.
- [ ] `specs/5-whatsapp-envio-automatico-toggle.md`: reescrever em RN-A7 os trechos
  "Contador esgotado sem interação → `window.location.href = destino`" e "`window.open(destino,
  "_blank", "noopener")`; se o navegador bloquear o popup (retorno `null`), cai para
  `window.location.href`", apontando para `specs/aviso-whatsapp-contagem-nova-aba.md`. Mesmo
  ajuste nos behaviors "Contagem esgotada sem interação leva ao WhatsApp automaticamente
  (`window.location.href`)" e "'Enviar agora'/'Enviar mensagem' abre o WhatsApp numa aba nova…",
  e nas menções a `window.location.href` em RN-A5/§ Segurança da spec 5 que ficarem falsas.
  O resto de RN-A7 (copy, trava de copy, uma vez por pedido, guard §15, gate de storage) não muda.
- [ ] Smoke manual (sem Playwright, issue 176), resultado registrado no corpo da PR:
  1. Chrome desktop, padrão de fábrica: passo 1 → contagem acaba → ícone de pop-up bloqueado →
     modal no passo 2, confirmação intacta → "Enviar mensagem" abre aba nova e fecha o modal.
  2. Chrome desktop com pop-ups liberados: contagem acaba → aba nova → modal fecha sozinho.
  3. Chrome desktop, clique em "Enviar agora" durante a contagem: aba nova, modal fecha, a aba
     da confirmação **não** troca (regressão do bug latente).
  4. Android Chrome e iOS Safari: contagem acaba → WhatsApp abre → voltar mostra a confirmação
     sem o modal.
  5. Firefox desktop: igual ao 1.
- [ ] `specs/aviso-whatsapp-contagem-nova-aba.md`: marcar `[x]` os 6 behaviors com suíte verde
  + smoke registrado. Sem smoke, ficam `[ ]` com a nota "clique real pendente, issue 176" (mesmo
  critério da spec 5). Spec 100% `[x]` ⇒ `git mv` para `specs/arquivo/` no mesmo commit.
- [ ] Remover `tasks/331-*`, `tasks/332-*` e `tasks/333-*` no PR que as entrega.

## Fora de escopo

- Qualquer mudança de código de produção (issues 331 e 332).
- Automatizar o smoke (issue 176).
- Reescrever outras seções da §15/§15-A que não mencionam este fluxo.

## Reuso esperado

- Agente `escriba` para `references/`: edição conservadora, só o que ficou falso.
- Critério de marcação "clique real pendente, issue 176" já usado na spec 5: copiar a forma.

## Segurança

- Documento de segurança descreve o padrão real: a exceção precisa ficar estreita e justificada,
  senão vira precedente para `window.open` sem `noopener`.
- Nenhum email, telefone, chave Pix ou CPF real nos prints/relatos do smoke na PR (o `href`
  do `wa.me` tem PII do comprador: usar pedido de teste com dados fictícios).

## Critério de aceite

- [ ] `seguranca.md` §15-A não descreve mais `window.open(..., "noopener")` no gesto nem
  `navegarTopLevel` como único caminho da contagem, e registra a nova justificativa da exceção.
- [ ] RN-A7 e os behaviors da spec 5 apontam para a spec nova, sem contradizê-la.
- [ ] Corpo da PR tem os 5 itens do smoke com resultado, ou os behaviors ficam `[ ]` com a nota
  da issue 176.
