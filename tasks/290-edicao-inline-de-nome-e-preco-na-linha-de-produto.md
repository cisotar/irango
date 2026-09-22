# [290] Edição inline de nome e preço na linha de produto

**crítica: SIM** — toca preço, que é valor monetário (mandato 3). TDD red-first obrigatório:
teste vermelho antes de qualquer código de produção, com output `FAIL` capturado e colado.

**Depende de:** nada. Roda depois do reposicionamento visual (escopo 1 deste mesmo PR), no
mesmo `ProdutosClient.tsx`.

## Origem

Pedido direto do usuário, refinado por duas rodadas do agente `desenhar` e conferido pelo
agente `orquestrar`. Plano completo em `plan/loop-refat-linha-de-produto.md` (fatia A, passos
3-4), incluindo o diagnóstico arquivo:linha citado abaixo.

## O problema

Hoje, mudar o nome ou o preço de um produto custa 3 toques (kebab → Editar → abre
`FormProduto.tsx`, formulário de 764 linhas com foto, desconto e vigência) mesmo quando só o
nome ou o preço mudou. Queremos edição inline: um novo item no kebab ("Editar nome e preço")
abre um modo de edição **na própria linha**, com dois campos empilhados e Salvar/Cancelar.

**Nome é barato.** `nome: z.string().trim().min(1).max(200)`
(`src/lib/validacoes/produto.ts`), sem regra cruzada. O padrão de UI já existe em
`src/components/painel/GerenciarCategorias.tsx:185-215` (estado `editandoId`, Enter salva, Esc
cancela) — mas os botões Salvar/Cancelar de lá usam `size="icon-sm"` (33,6px na base 120%),
abaixo do mínimo de 44px de `references/design-system.md` §5. **Não copiar esse defeito.**

**Preço não é barato, e o motivo não é UI:**

1. `atualizarProduto` (`src/lib/actions/produto.ts:119-181`) é **UPDATE TOTAL**, não patch.
   Parseia `schemaProdutoUpdate` (`validacoes/produto.ts:206-208`), que exige `visibilidade`,
   `disponivel`, `oculto`, `ordem`, `foto_url` e o bloco de desconto inteiro. Mandar
   `{nome, preco}` por ali não passa; e "resolver" enchendo o payload no cliente **apagaria em
   silêncio** a promoção, a foto e a visibilidade do produto. A action nova precisa ser um
   **patch estreito**, não um clone do update total.
2. **D10 vale mesmo com a promoção desligada.** `refinarDesconto`
   (`validacoes/produto.ts:158-171`) recusa `desconto_tipo === "fixo"` com
   `desconto_valor > preco`, via `mensagemDescontoMaiorQuePreco` (`:277-295`), que nomeia os
   dois números na mensagem. O comentário de `:146-148` é explícito: a faixa por tipo é
   "INDEPENDENTE de `desconto_ativo`". A action nova precisa **reler `desconto_tipo` e
   `desconto_valor` do banco** (nunca confiar no cliente) e reaplicar D10 antes de gravar —
   inclusive quando a promoção está desligada. Só `desconto_tipo === "fixo"` dispara a regra;
   `percentual` não tem regra cruzada com preço.
3. **O banco já protege o dado, não a mensagem.**
   `supabase/migrations/20260920120000_produtos_desconto_colunas_e_checks.sql:118` tem
   `check (desconto_tipo is distinct from 'fixo' or desconto_valor <= preco)`. Esse CHECK não é
   contornado por `service_role`, então o estado proibido é fisicamente impossível de gravar —
   uma action sem D10 falharia com `23514` (mensagem genérica de Postgres), não corromperia
   dado. Isso rebaixa a gravidade, mas **não dispensa o TDD**: a mensagem literal de D10 já é
   contrato testado em `admin-produtos.paridade.test.ts:155,164`, e a UX de erro genérico é
   regressão.
4. **Paridade admin obrigatória.** O caminho admin usa `service_role` (BYPASSRLS) — nenhuma
   regra que more só na RLS protege ali. A action nova precisa de uma gêmea admin
   (`atualizarNomeEPrecoAdmin`) e um bloco novo em `admin-produtos.paridade.test.ts` afirmando a
   **mesma mensagem de D10, byte a byte**, e o **mesmo patch estreito** (só `nome`/`preco`) nos
   dois caminhos.

## Decisões de escopo (declaradas, não abertas a reinterpretação)

- **Uma única Server Action** `atualizarNomeEPreco(id, { nome, preco })` para os dois campos —
  não duas.
- **Gatilho = item novo no kebab** ("Editar nome e preço"), não clique no nome/preço. Preserva o
  mockup byte a byte (ele não tem lápis) e evita o conflito, no mobile, entre
  toque-para-editar e toque-para-abrir.
- **Modo de edição empilha**: `Input` de nome em cima, de preço embaixo, Salvar/Cancelar com
  **44px literal** (`min-h-[44px] min-w-[44px]`) — nunca `size="icon-sm"`, nunca `min-h-11`
  (52,8px). Em 360px os dois campos não cabem lado a lado.
- **Coerção de dinheiro:** reusar o padrão de `FormProduto.tsx:216`
  (`Number(preco.replace(",", "."))` com `inputMode="decimal"`) — não inventar máscara nova.
- O contrato `AcoesProdutosClient` (declarado em `ProdutosClient.tsx:210`, consumido em `:199`)
  ganha uma chave nova nas **duas** variantes (lojista e admin), sem default — `CardapioAdminClient.tsx`
  é tocado obrigatoriamente.
- O mockup (`mockups/produtos-linha.md`) **não muda**: o modo de edição substitui a faixa de
  texto da linha, não acrescenta elemento à linha em repouso.

## Plano de teste (RED antes de qualquer código de produção)

1. **Função pura** `validarPrecoContraDesconto(preco, tipo, valor)` (reusa
   `mensagemDescontoMaiorQuePreco`): `fixo` 15,00 com preço 10,00 → mensagem contendo
   `"o preço novo (R$ 10,00)"` **e** `"R$ 15,00"` (fragmento literal, números distintos);
   `percentual` 50 com preço 10 → `null`; `fixo` igual ao preço → `null`;
   `desconto_ativo = false` não muda o resultado.
2. **Action do lojista** (`atualizarNomeEPreco`): preço abaixo do desconto fixo **lido do
   banco** é recusado com a mensagem literal de D10 e **sem nenhum `.update()`**; o patch
   enviado ao banco tem **exatamente** as chaves `nome` e `preco` (asserção sobre
   `Object.keys`); escopo duplo `.eq("id")` **e** `.eq("loja_id", <loja do dono>)`, com
   `loja_id` hostil no payload ignorado; `id` não-UUID, nome vazio e nome de 201 caracteres
   recusados **antes** de qualquer I/O.
3. **Paridade admin**: `atualizarNomeEPrecoAdmin` recusa com a mesma mensagem literal, monta
   patch com as mesmas duas chaves, recusa `lojaId` não-UUID sem tocar no banco.

Gate: `npx vitest run` nos três arquivos com `FAIL` colado, e `git diff --stat` mostrando só
arquivos de teste antes de qualquer GREEN.
