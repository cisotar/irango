# [288] Refatoração do detalhe do cardápio: vigência recolhida, itens em cards e sheet de adicionar

**crítica: NÃO** — só UI. A autoridade e o escopo são das actions já existentes e da [287].

**Mundo:** `/painel/cardapios/[cardapioId]`, reusada pelo hub admin com as ações injetadas.
**Depende de:** [287] (os dias precisam viajar no insert).
**Mockup:** `mockups/cardapio-detalhe-refat.html` e `mockups/cardapio-detalhe-refat.md`.
**Design system:** §10 (superfícies do painel) e §5 (alvo de toque de 44px literal).

## Origem

Queixa do dono do produto sobre a tela de hoje: campos sem contraste, elementos soltos,
página longa demais, e mistura a configuração de quando o cardápio aparece com a lista de
todos os produtos da loja.

## Decisões fechadas (não reabrir)

1. Vigência vira seção recolhida no topo, com resumo de uma linha quando fechada.
2. "Adicionar item" abre um `Sheet`. `sheet.tsx` já existe em `components/ui`.
3. Escolha de dias obrigatória no ato de adicionar, com o par "Todos os dias do cardápio"
   (pré-marcado) e "Escolher dias" (revela as pílulas).
4. Inserir um por vez e em lote, os dois caminhos.
5. Lote e "adicionar a categoria inteira" ficam dentro do sheet, o de categoria no cabeçalho
   de cada sanfona.
6. Tirar produto do cardápio é gesto no próprio card, com confirmação curta.
7. Pílulas de dias inline no card de cada item.
8. Produto já vinculado aparece esmaecido no sheet, não some.
9. Busca dentro do sheet entra nesta rodada.
10. Escopo é só o detalhe. A lista `/painel/cardapios` não entra.

## O que não pode sumir

- Agenda por vínculo, com `PilulasDeDias`.
- Aviso âmbar de agenda que nunca abre, redigido no servidor.
- Selo "Exclusivo de cardápio".
- Prévia do lote calculada no servidor, nunca no browser.
- Paridade com o hub admin: mesmo componente, ações injetadas, nenhuma rota `/painel/...`
  fixa dentro de componente compartilhado.

## Acessibilidade obrigatória

- O `showCloseButton` do `sheet.tsx` usa `size="icon-sm"`, que dá 33,6px na base de 120% e
  fica abaixo dos 44px: usar `showCloseButton={false}` e um close próprio.
  **`components/ui/sheet.tsx` não é editado** — é gerado pelo shadcn CLI.
- O motivo de "Definir dias" estar desabilitado sai do `title` para texto perceptível, com
  `aria-describedby`.
- A confirmação do lote é um passo dentro do sheet, não um `AlertDialog` por cima: overlay
  sobre overlay já causou o problema de ESC documentado no design system §6.
- Tudo cabe em 360px sem rolagem horizontal.

## Critério de aceite

- [ ] Vigência recolhida por padrão, com resumo de uma linha vindo do servidor.
- [ ] Itens do cardápio em cards, com pílulas inline, selo, frase de agenda e aviso âmbar.
- [ ] "Adicionar item" abre o sheet com busca e categorias em sanfona fechada; escolher
      produto e dias no mesmo passo; vinculado aparece esmaecido.
- [ ] Remover item pelo card, com confirmação curta.
- [ ] Todo bloco da página é card branco (design system §10.2, regra 4).
- [ ] `git grep '"/painel/'` em componente compartilhado continua vazio.
- [ ] `npx tsc --noEmit` → `npm run lint` → `npm test` → `npm run build`.
