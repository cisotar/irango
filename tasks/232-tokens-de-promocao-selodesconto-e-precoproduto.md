# [232] Tokens de sistema + `SeloDesconto` + `PrecoProduto` + `rotuloPrecoAcessivel`

**crítica:** NÃO
**Mundo:** vitrine pública
**Depende de:** [224] (`tasks/224-contrato-de-catalogo-produtovitrine-e-projecao.md`)
**Spec:** specs/desconto-por-produto-e-pratos-promocionais.md
**Decisões:** D1 · RN-14 (apresentação) · design §2 e §3.1

## Objetivo

Criar os **três primitivos de apresentação** que as quatro superfícies da vitrine vão consumir,
para que selo e preço riscado existam em **um** lugar e não em quatro cópias divergentes (M1).

## Escopo

- [ ] `src/app/globals.css`: cinco tokens de **sistema** no `:root` + `@theme inline`
      (`--promo-fundo #dcfce7`, `--promo-texto #166534`, `--promo-borda #86efac`,
      `--indisponivel-fundo #111111`, `--indisponivel-texto #ffffff`). **Nenhuma cor nova** — são
      promoções a token de hex que já estão no repo (`BadgeStatus`, `ResumoValores`, `CardProduto`);
- [ ] `src/components/vitrine/SeloDesconto.tsx` — props `rotulo: string | null` (texto **pronto**,
      do servidor) e `ancoragem: "foto" | "inline"` **obrigatória**; `rotulo === null` ⇒ o próprio
      componente devolve `null` (M3: uma decisão, um lugar). Não é interativo: sem botão, sem
      `title`, sem tooltip;
- [ ] `src/components/vitrine/PrecoProduto.tsx` — recebe o objeto (`Pick<ProdutoVitrine,
      "preco" | "precoEfetivo" | "temDesconto">`) e `tamanho: "card" | "lista" | "modal"`
      **obrigatório**; par visual `aria-hidden` + `sr-only` com a frase acessível;
- [ ] `src/lib/utils/rotuloPrecoAcessivel.ts` — **pura**, `De R$ 100,00 por R$ 80,00` /
      `R$ 80,00`, com teste próprio ao lado;
- [ ] o `#8B4513` do selo "Esgotado" de `ProdutoModal.tsx:342` **sai**, trocado pelos tokens
      `--indisponivel-*`.

## Fora de escopo

Trocar as props das quatro superfícies (issue 225, já entregue) e plugar os componentes nelas
(issue 233). O selo de indisponibilidade **não vira componente**: continua sendo a pílula que o
`CardProduto` já imprime — o que esta issue unifica ali é o **hex**, não o markup. Nada de
`fora_da_janela` (Spec B). Nenhuma cor de tema da loja no selo.

## Reuso esperado

- `src/components/ui/badge.tsx` + o princípio de `BadgeStatus` (`design-system.md` §8) —
  cor de **sistema**, nunca cor do tema da loja, e **cor + texto**, nunca cor sozinha.
- `src/lib/utils/formatarMoeda.ts` — único formatador de dinheiro.
- `src/lib/utils/catalogoVitrine.ts` (issue 224) — de onde vêm `seloDesconto`, `preco`,
  `precoEfetivo` e `temDesconto`, já decididos no servidor.

## Segurança

- Nada monetário é calculado aqui: `seloDesconto` chega **pronto** do servidor e o componente só
  formata (regra 6 do contrato de catálogo). Nenhuma coluna crua de desconto trafega.
- O selo pinta fundo opaco próprio + borda de 1,5px: o par de contraste é sempre
  (texto do selo × fundo do selo), nunca × foto nem × cor escolhida pelo lojista
  (`design-system.md` §4, "Contraste do tema custom — risco conhecido").

## Critério de aceite

- [ ] `rotuloPrecoAcessivel` tem teste próprio afirmando as duas saídas byte a byte;
- [ ] `grep -rn "cor-primaria\|cor-destaque\|cor-fundo" src/components/vitrine/SeloDesconto.tsx`
      **não devolve nada**;
- [ ] `grep -rn "8B4513" src/` **não devolve nada**;
- [ ] `SeloDesconto` com `rotulo={null}` não renderiza nenhum DOM;
- [ ] `npx tsc --noEmit` → `npm run lint` → `npm test` → `npm run build`.
