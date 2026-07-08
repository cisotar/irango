# [139] Verificação end-to-end + regressão de isolamento do entitlement de impressão

**crítica:** SIM (TDD red-first)
**Mundo:** painel
**Depende de:** [136], [137], [138]
**Spec:** specs/4-impressao-pedido.md

## Objetivo
Fechar a feature com um teste de regressão que amarra banco → util → componente → page
(loja A não enxerga variante de loja B; loja sem módulo não recebe seletor) e uma
verificação visual dos três impressos no print-preview.

## Escopo
- [ ] Teste de isolamento/entitlement (mesmo espírito de `isolamento-admin.test.ts`):
  - Loja A com só térmica e loja B com só A4: o detalhe de A oferece `["cozinha","recibo"]`
    e o de B `["a4"]` — nunca cruzado.
  - Loja sem módulo: `DetalhePedido` sem seletor e sem blocos de variante no DOM.
  - Dono/admin não consegue habilitar módulo via patch (regressão apontando para 128/129).
- [ ] Verificação visual (`verificar`): abrir `/painel/pedidos/[id]` de uma loja com ambos
  os módulos e conferir no print-preview cada variante (A4 completo; cozinha sem preços,
  observações em destaque; recibo com total + aviso não-fiscal), o `no-print` (chrome/Ações/
  Voltar/seletor fora) e que Ctrl+P sem escolher sai como tela crua.
- [ ] Conferir os behaviors da seção "Páginas e Rotas" do spec como checklist.

## Fora de escopo
- Novas features — só amarra e verifica o que 127–138 entregaram.
- Calibração térmica 80mm pixel-perfect (fora de escopo v1).

## Reuso esperado
- Harness pglite (`tests/helpers/pglite.ts`) e o padrão `isolamento-admin.test.ts`.
- Os testes red-first já escritos em 130/135/136/137 — este consolida o caminho completo.

## Segurança
- Cobre as invariantes-chave do spec de uma ponta a outra: fail-closed (sem módulo → nada),
  isolamento entre lojas, e não-auto-habilitação (RN-M1/M3). Motivo da criticidade.

## Critério de aceite
- [ ] (RED-first) Teste de isolamento cruzado (A não vê variante de B) escrito e vermelho antes,
  depois verde.
- [ ] Loja sem módulo: sem seletor e sem bloco de variante no DOM (regressão RN-M1).
- [ ] Verificação visual dos 3 impressos + `no-print` + Ctrl+P cru concluída.
- [ ] Suíte completa + `next build` verdes.
