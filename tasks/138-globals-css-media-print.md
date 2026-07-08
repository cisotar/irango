# [138] `globals.css`: bloco `@media print` (fonte única, sub-regras por variante)

**crítica:** NÃO
**Mundo:** infra (apresentação)
**Depende de:** [132], [135]
**Spec:** specs/4-impressao-pedido.md

## Objetivo
Regras `@media print` que mostram **apenas** a variante ativa e ocultam o resto + tudo
`no-print` (RN-P2, RN-P3). Fonte única em `globals.css`, keyed pelo
`data-print-variant` que o seletor seta.

## Escopo
- [ ] Bloco `@media print` em `src/app/globals.css`:
  - `.no-print { display: none }` **quando** há variante ativa (chrome, "Voltar", "Ações",
    seletor, blocos das outras variantes).
  - `html[data-print-variant="a4"]` → mostra `.print-a4`, oculta `.print-cozinha`/`.print-recibo`.
  - `html[data-print-variant="cozinha"]` → mostra `.print-cozinha`, oculta as outras.
  - `html[data-print-variant="recibo"]` → mostra `.print-recibo`, oculta as outras.
  - Variantes térmicas (cozinha/recibo): coluna única, largura fluida (`width:auto`, sem
    `max-width` em px de tela), fonte compacta — cabe em 80mm **sem hardcodar largura** e
    ainda sai legível em A4 (spec §Papel).
- [ ] **Ctrl+P sem variante** (sem `data-print-variant`, ex.: loja sem Módulo A): não aplicar
  o layout formatado — sai a tela crua com chrome (RN-M2 nota do Módulo A). As regras
  `.no-print` só valem quando uma variante está ativa.
- [ ] Papel (A4 × 80mm) é escolhido no diálogo do navegador — não hardcodar tamanho de página.

## Fora de escopo
- Template térmico ESC/POS pixel-perfect (fora de escopo v1).
- Qualquer gate de entitlement — isso é DOM (135), CSS nunca é barreira de segurança (RN-M1).

## Reuso esperado
- Contrato de classes de 133/134/135 (`print-a4`, `print-cozinha`, `print-recibo`, `no-print`)
  e o `data-print-variant` de 132 — não inventar nomes novos.

## Segurança
- **Não é barreira de segurança:** o entitlement é garantido pelo DOM (135) — bloco não
  habilitado não existe. Um bug de CSS = impressão feia, nunca vazamento. Por isso NÃO-crítica.
- `data-print-variant` é union fixo; sem input de usuário no seletor CSS.

## Critério de aceite
- [ ] Print-preview com `data-print-variant="cozinha"` mostra só a comanda; A4/recibo e todo
  `no-print` ocultos.
- [ ] Idem para `"a4"` e `"recibo"`.
- [ ] Sem `data-print-variant` (Ctrl+P cru), a página sai como tela comum (chrome visível).
- [ ] Variantes térmicas em coluna única fluida, sem `max-width` em px; verificação visual no print-preview.
