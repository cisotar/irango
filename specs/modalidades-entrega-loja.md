# Spec: Modalidades de entrega por loja + frete a combinar

**Versão:** 0.1.0 | **Atualizado:** 2026-09-24

Plano de execução: `plan/loop-modalidades-entrega-loja.md`. Specs vizinhas, sem
sobreposição: `specs/retirada-endereco-da-loja.md` (lado do comprador na retirada)
e `specs/paridade-hub-admin-painel.md` (toda ação do lojista tem par no hub admin).

**Crítico (TDD red-first):** valor monetário no checkout e nova escrita do total do
pedido pelo lojista.

---

## Pedido do dono do produto (2026-09-24)

A loja escolhe se aceita retirada, entrega ou as duas. Com entrega, escolhe se o
frete é calculado pelo sistema (automático, a lógica de hoje) ou combinado com o
cliente pelo WhatsApp (a combinar). No modo a combinar, o lojista registra depois o
valor combinado no pedido. Pedido de retirada aparece como RETIRADA em destaque em
todas as superfícies do lojista.

O texto integral do pedido está em `## Pedido` do plano de execução.

---

## Decisões

- **D1 — O frete registrado trava no primeiro registro.** Depois de registrar, o
  valor não é editável. Corrigir exigiria uma coluna marcadora nova (sem ela, a
  mesma ação deixaria o lojista mudar o frete de um pedido calculado pelo
  sistema). Se o lojista errar, o caminho é cancelar e refazer o pedido, ou
  pedir uma evolução desta spec.
- **D2 — O registro vale em qualquer status, exceto `cancelado`.**
- **D3 — Teto de sanidade do valor registrado: R$ 1.000,00**, com centavos
  (`multipleOf(0.01)`). Evita o typo "800" no lugar de "8,00".
- **D4 — Entrega ligada em modo automático, sem zona ativa e sem
  `taxa_entrega_fora_zona`, fica indisponível na vitrine** (regra de hoje). Se a
  retirada também estiver desligada, a vitrine manda o cliente falar com a loja no
  WhatsApp e a página de Entregas do painel mostra um aviso. Salvar não é
  bloqueado.
- **D5 — "A combinar por configuração da loja" é um veredito novo** no union
  `VereditoFrete` já existente (`src/lib/utils/freteDegradado.ts`), sem o modal de
  retry do CEP não localizado.

---

## Modelo de dados

Tabela `lojas`, colunas novas (migration só expand):

| coluna | tipo | default |
|---|---|---|
| `aceita_retirada` | `boolean not null` | `true` |
| `aceita_entrega` | `boolean not null` | `true` |
| `modo_frete` | `text not null`, CHECK `in ('automatico','a_combinar')` | `'automatico'` |

CHECK `lojas_ao_menos_uma_modalidade (aceita_retirada or aceita_entrega)`.

A view `vitrine_lojas` projeta as três colunas novas, sem perder nenhuma coluna
anterior nem o `grant select`.

`pedidos` não muda: o par `frete_a_combinar` + `taxa_entrega IS NULL`
(`chk_pedidos_frete_a_combinar`) já existe e é reusado.

---

## Behaviors

### Configuração (painel e hub admin)

- [ ] Loja que já existe fica com retirada e entrega ligadas e frete automático.
- [ ] O banco recusa uma loja com retirada e entrega desligadas (CHECK
      `lojas_ao_menos_uma_modalidade`).
- [ ] O banco recusa `modo_frete` fora de `automatico` / `a_combinar`.
- [ ] A view `vitrine_lojas` expõe `aceita_retirada`, `aceita_entrega` e
      `modo_frete` e mantém todas as colunas anteriores.
- [ ] O lojista liga e desliga retirada e entrega e escolhe o modo do frete na
      página de Entregas do painel.
- [ ] O zod recusa retirada e entrega desligadas antes de qualquer I/O.
- [ ] O salvar grava só as três colunas de modalidade, na loja do dono logado.
- [ ] O admin edita as mesmas configurações pelo hub, escopado pela loja
      selecionada, com as mesmas travas.
- [ ] Zonas de entrega continuam salvas quando a entrega é desligada ou o modo
      muda para a combinar.

### Vitrine e checkout

- [ ] A vitrine esconde a modalidade desligada.
- [ ] Com uma só modalidade ligada, ela já vem selecionada.
- [ ] O servidor recusa um pedido com modalidade desligada, mesmo que o cliente a
      envie (carrinho aberto antes da mudança). A RPC não é chamada.
- [ ] Modo a combinar: o pedido nasce com `frete_a_combinar = true` e
      `taxa_entrega = null`.
- [ ] Modo a combinar: o cupom sobre os produtos vale (R$ 50,00 com 10% → total
      R$ 45,00).
- [ ] Modo a combinar: o frete grátis por pedido mínimo não é aplicado.
- [ ] Modo a combinar: sem verificação de zona, ViaCEP ou distância. O endereço
      continua obrigatório e é gravado.
- [ ] Modo a combinar: o checkout e a confirmação dizem "A loja vai te chamar no
      WhatsApp para combinar o frete".
- [ ] O preview do frete e a gravação do pedido concordam no modo a combinar.
- [ ] Modo automático, fora de todas as zonas, sem `taxa_entrega_fora_zona`: o
      servidor recusa o pedido.
- [ ] A vitrine mostra "Este endereço fica fora da área de entrega. Escolha
      retirada na loja ou fale com a loja no WhatsApp." com link wa.me. Sem
      retirada, a frase perde "Escolha retirada na loja". Sem WhatsApp, sem link.

### Pedido no painel

- [ ] Pedido de retirada mostra RETIRADA em destaque na lista, no detalhe, na
      comanda e no recibo, no lugar de "Sem endereço de entrega.".
- [ ] Frete a combinar aparece como "A combinar", nunca "Grátis" nem "R$ 0,00".
- [ ] O lojista registra o frete combinado no detalhe do pedido.
- [ ] O registro recalcula `total = subtotal − desconto + taxa` com subtotal e
      desconto lidos do banco, e grava `frete_a_combinar = false`.
- [ ] O registro recusa payload com campo extra (`desconto`, `total`).
- [ ] O registro recusa valor negativo e acima de R$ 1.000,00. Zero é aceito
      (frete grátis concedido).
- [ ] O registro recusa pedido de retirada, pedido cancelado e pedido sem frete a
      combinar.
- [ ] O segundo registro no mesmo pedido é recusado (D1).
- [ ] Lojista de outra loja não registra frete (RLS).
- [ ] O admin registra o frete pelo hub, escopado pela loja, com as mesmas travas
      e com log de acesso.
- [ ] Depois do registro, lista, detalhe, comanda e recibo mostram o valor
      registrado (zero aparece como valor, não como "A combinar").

---

## Débito conhecido (fora de escopo)

- `lojas.taxa_entrega_fora_zona` não tem editor no painel nem no hub admin. Esta
  spec usa a coluna como está e não cria o editor.
