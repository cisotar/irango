# [169] UI vitrine: textarea de observação no `ProdutoModal` + teto 200 no checkout

**crítica:** NÃO
**Mundo:** vitrine pública
**Depende de:** 167 (constante), 168 (contrato de `onAdicionar`)
**Spec:** specs/observacoes-por-item-pedido.md

## Objetivo

Dar ao cliente o campo onde ele digita a observação do item, com contador visível,
e alinhar o textarea de observação **do pedido** ao mesmo teto de 200.

## Escopo

- [ ] `src/components/vitrine/ProdutoModal.tsx`: novo `<textarea>` no **corpo
      rolável**, dentro de um `.card`, logo **após** o card de Quantidade (~l.361).
      Título de seção "Observações" com `.card-titulo` (uppercase, `--marrom-cafe`),
      mesmo padrão visual das seções Quantidade/Opcionais do mockup
      `design-claude/vitrine/produto-modal.html`.
- [ ] `rows` ~3, `maxLength={LIMITE_OBSERVACAO}`, placeholder
      "Ex: sem cebola, ponto da carne…". Enter insere `\n` (é textarea, não input).
- [ ] Contador `n/200` abaixo do campo em `--texto-muted`, com estado de alerta ao
      aproximar do limite. Acessível: associado ao campo (`aria-describedby`),
      não só visual.
- [ ] Tokens da vitrine (tema da loja): `--cor-destaque` no foco, `--borda-nav` na
      borda, `--texto-muted` no contador/placeholder. **Não inventar estilo.**
- [ ] `confirmar()` passa a observação para `onAdicionar` (contrato da issue 168);
      campo em branco não bloqueia a adição ao carrinho.
- [ ] `src/components/vitrine/checkout/EtapaPagamento.tsx` (~l.159):
      `maxLength={500}` → `maxLength={LIMITE_OBSERVACAO}`.

## Fora de escopo

- Chips/sugestões de observação ("sem cebola", "sem glúten") — fase futura.
- Exibir a observação na prévia do carrinho.
- Qualquer validação autoritativa: o limite real está na issue 167.

## Reuso esperado

- `src/lib/constants/pedido.ts` — `LIMITE_OBSERVACAO` (issue 167). **Nunca** o
  literal `200` nem `500` no JSX.
- `components/ui/Textarea` do shadcn se já existir primitivo (o `EtapaPagamento` já
  usa `<Textarea>`); no `ProdutoModal`, que é tema da loja, `<textarea>` estilizado
  com os tokens da vitrine se o primitivo não couber. `components/ui/` é gerado pelo
  shadcn CLI — não editar à mão.
- `design-claude/vitrine/produto-modal.html` — referência visual do card.
- Não criar componente de dialog novo: o modal já existe.

## Segurança

- Nenhum dado sensível novo, nenhum valor monetário. O `maxLength` é **UX**, não
  garantia — a garantia é o zod da issue 167.
- Nenhuma tabela tocada, nenhuma policy RLS envolvida.

## Critério de aceite

- [ ] Digitar no campo atualiza o contador `n/200` a cada tecla.
- [ ] Digitação trava em 200 caracteres no cliente.
- [ ] Enter dentro do campo insere quebra de linha e não submete o modal.
- [ ] Adicionar ao carrinho com o campo em branco funciona normalmente.
- [ ] Contraste do contador e do placeholder passa WCAG AA; alvo de toque adequado
      no mobile.
- [ ] `grep -rn "maxLength={500}" src/` sem resultado.
- [ ] `grep -rn "maxLength={200}\|>200<\|/200" src/components/vitrine/` não mostra
      literal do limite — só uso de `LIMITE_OBSERVACAO`.
