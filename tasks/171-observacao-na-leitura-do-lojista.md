# [171] Leitura do lojista: observação no detalhe, na comanda e no recibo

**crítica:** NÃO
**Mundo:** painel
**Depende de:** 166 (tipo regenerado com `observacao`)
**Spec:** specs/observacoes-por-item-pedido.md

## Objetivo

Mostrar a observação de cada item onde o lojista lê o pedido: detalhe (painel e hub
admin), comanda de cozinha e recibo do cliente. Render condicional — item sem
observação não mostra rótulo vazio.

## Escopo

- [ ] `src/components/painel/DetalhePedido.tsx`: no `<li>` de cada item, após
      `ListaOpcionaisItem` (~l.216), renderizar a observação quando presente, com
      estilo discreto (texto menor/muted).
- [ ] `src/components/painel/ComandaCozinha.tsx`: exibir a observação por item — é
      a informação mais útil para quem produz o pedido.
- [ ] `src/components/painel/ReciboCliente.tsx`: exibir a observação por item.
- [ ] Confirmar que `SELECT_PEDIDO_COM_ITENS` em
      `src/lib/supabase/queries/pedidos.ts` já traz a coluna (usa `*`) — **não**
      alterar a query, só depender do tipo regenerado.

## Fora de escopo

- Editar ou remover a observação (nem lojista nem cliente) — snapshot imutável.
- Busca/filtro de pedidos por conteúdo da observação.
- Qualquer mudança de query, policy ou índice.

## Reuso esperado

- `SELECT_PEDIDO_COM_ITENS` (`src/lib/supabase/queries/pedidos.ts`) — já cobre; os
  tipos `ItemPedido`/`ItemPedidoComOpcionais` herdam o campo automaticamente.
- Os três componentes existentes (Server Components, sem `'use client'`) — só
  acrescentar o bloco condicional; não criar componente novo de observação a menos
  que o mesmo markup se repita nos três, caso em que ele vira um componente único
  compartilhado.

## Segurança

- Texto de cliente renderizado para o lojista: o JSX de React **auto-escapa** por
  padrão. **Proibido `dangerouslySetInnerHTML` com este campo** (`seguranca.md` §15).
- Nenhuma policy RLS nova: a leitura acontece sob `itens_pedido_lojista` (só o dono
  da loja) e, no hub admin, sob `verificarAdminSaaS()` + escopo por `lojaId`. A
  coluna herda essas políticas.
- Nenhum valor monetário.

## Critério de aceite

- [ ] Item com observação exibe o texto abaixo do nome/opcionais nas três telas.
- [ ] Item com `observacao` `null` não renderiza rótulo, separador nem espaço vazio.
- [ ] Observação com `\n` não quebra o layout da comanda nem do recibo impressos.
- [ ] Uma observação contendo `<script>alert(1)</script>` aparece como **texto
      literal** na tela, sem execução.
- [ ] `grep -rn "dangerouslySetInnerHTML" src/components/painel/` sem resultado.
- [ ] `npm run build` verde.
