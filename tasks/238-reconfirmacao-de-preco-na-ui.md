# [238] Reconfirmação de preço na UI: `copiaRevisaoPreco.ts`, o gate em `podeConfirmar` e a faixa de "preço caiu"

**crítica:** NÃO
**Mundo:** vitrine pública
**Depende de:** [229] (`tasks/229-criarpedido-snapshot-de-preco-e-a-trava-de-reconfirmacao.md`) e [237] (`tasks/237-tres-estados-do-cupom-no-checkout.md`)
**Spec:** specs/desconto-por-produto-e-pratos-promocionais.md
**Decisões:** D11 · RN-12, RN-12-a · design §7

## Objetivo

Dar cara aos dois sentidos de D11: preço **subiu** ⇒ diálogo com de/para, novo total e segundo
clique explícito; preço **caiu** ⇒ faixa de aviso e o pedido segue. A autoridade continua sendo a
issue 229 (o servidor recusa); esta issue é a tela que torna a recusa recuperável.

## Escopo

- [ ] `src/lib/utils/copiaRevisaoPreco.ts` — **puro** (M5), `textosRevisao({ direcao, itens,
      novoTotal }): { titulo, corpo, rotuloCta: string | null }`, com teste próprio;
- [ ] 🔴 **nenhuma linguagem de erro** nos dois sentidos: sem "erro", "falha", "desculpe", "não foi
      possível", sem ícone de alerta, sem vermelho, sem `role="alert"`. A promoção acabou porque o
      lojista marcou uma data — não é culpa do cliente e não é defeito do sistema. Precedente:
      `ModalFreteIndisponivel.textos()`;
- [ ] **preço subiu** — `Dialog` do shadcn, tokens neutros (`border-borda-nav`, `bg-cinza-claro`,
      `text-texto`); lista `<ul>` de de/para por item, cada um com `sr-only` explicando o par
      (`<s>` sozinho não comunica); "Novo total estimado" em `--cor-destaque`; CTA primário com o
      **número dentro do rótulo** (`Confirmar e enviar — R$ 150,00`, 52px) + "Voltar ao carrinho"
      (44px). ESC e ✕ **não enviam nada**;
- [ ] **M9, trava 1:** enquanto a reconfirmação está aberta o CTA de envio do wizard é **removido
      do DOM**, não `disabled` — botão desabilitado depende de um booleano que um `setState` fora
      de ordem reabilita;
- [ ] **M9, trava 2:** a condição nova `revisaoConfirmada` entra em `podeConfirmar`
      (`src/components/vitrine/checkout/estado.ts`), **uma vez**, cobrindo wizard e desktop —
      nunca reimplementada no componente (`design-system.md` §9);
- [ ] o segundo clique envia `promocaoExibida: false`, que é o que faz o pedido passar (RN-12-a);
- [ ] **preço caiu** — sem modal e sem botão: faixa no topo do resumo, `role="status"
      aria-live="polite"`, tokens `--promo-fundo/--promo-texto/--promo-borda`, persistente até o
      envio (**não é toast**: 4 segundos somem antes de ser lidos).

## Fora de escopo

A comparação servidor × cliente e a recusa (issue 229) — **a autoridade é lá**; esta tela só
torna a recusa recuperável. Nenhum token de revisão assinado (`revisaoId`): o objetivo foi aceito,
o mecanismo foi recusado. Nada de trancar preço por N minutos. A segunda janela (segundos entre
revisão e INSERT) **não é fechada aqui**: a confirmação do pedido é a tela autoritativa, sem
pop-up de desculpa.

## Reuso esperado

- `src/components/ui/dialog.tsx` — foco preso, ESC, clique-fora.
- `src/components/vitrine/checkout/estado.ts` (`podeConfirmar`) — **função pura já testada**; a
  condição entra lá, não no componente.
- `ModalFreteIndisponivel.textos()` — a forma do módulo de textos sem culpar o cliente.
- `revisarCarrinhoAction` (issue 228) — de onde vêm os itens mudados e o novo total.
- `formatarMoeda`, tokens de promoção (issue 232).

## Segurança

- **A garantia é de servidor, não de componente** (RN-12-a): a UI pode esquecer o segundo clique e
  o pedido não passa mesmo assim. As travas de UI existem para o cliente não ser levado a um pedido
  mais caro por um clique que ele deu achando outra coisa.
- `promocaoExibida` **não é campo monetário**: é booleano de exibição, assimétrico — só sabe
  recusar, nunca baratear. O payload continua `.strict()` e sem nenhum campo de dinheiro.
- Preço **caiu** nunca bloqueia: travar um pedido para confirmar um desconto que o cliente não
  pediu é atrito sem contrapartida (D11).

## Critério de aceite

- [ ] `copiaRevisaoPreco.test.ts` afirma que **nenhuma** das strings contém "erro", "falha",
      "desculpe" ou "não foi possível", nos dois sentidos;
- [ ] `podeConfirmar` tem teste novo: com `revisaoConfirmada: false` e revisão pendente ⇒ `false`;
- [ ] `grep -rn "disabled" src/components/vitrine/checkout/` não mostra o CTA de envio apenas
      desabilitado durante a reconfirmação — ele **sai do DOM**;
- [ ] recusa do servidor ⇒ `revisarCarrinhoAction` ⇒ diálogo ⇒ segundo clique ⇒ pedido criado pelo
      preço do banco, ponta a ponta;
- [ ] `npx tsc --noEmit` → `npm run lint` → `npm test` → `npm run build`.
