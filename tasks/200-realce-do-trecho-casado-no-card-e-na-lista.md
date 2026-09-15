# [200] Realce do trecho casado no card e na lista

**crítica:** NÃO
**Mundo:** vitrine pública
**Depende de:** 199
**Spec:** specs/busca-e-navegacao-categorias-vitrine.md

## Objetivo

Fazer `CardProduto` e `ItemProdutoLista` aceitarem um `termo` opcional e
envolverem o trecho casado em `<mark>`, para o cliente ver por que aquele
produto apareceu no resultado.

## Escopo

- [ ] Prop opcional `termo?: string` em `CardProduto` e `ItemProdutoLista`.
      Ausente ou vazio → renderização de hoje, byte a byte.
- [ ] `CardProduto`: realce em nome **e** descrição. `ItemProdutoLista`: realce no nome.
- [ ] Realce montado com `partirPorTermo` (199) mapeado para nós React
      (`<mark>` / fragmento de texto). **Nunca** `dangerouslySetInnerHTML`, nunca
      concatenação de HTML (RN-9).
- [ ] `SecaoCatalogo` repassa `termo` (opcional) aos dois componentes.
- [ ] Estilo do `<mark>`: tokens existentes (`--cor-destaque` / `--cinza-claro`),
      contraste AA sobre o fundo do card. Zero token novo.
- [ ] Teste de render estático (`renderToStaticMarkup`, padrão de `SecaoCatalogo.test.tsx`):
      com `termo` o HTML tem `<mark>` no trecho certo com acento preservado; sem `termo`,
      nenhum `<mark>`.

## Fora de escopo

O campo de busca e o estado do termo (202). Truncamento, ellipsis ou mudança de
layout do card.

## Reuso esperado
- `lib/utils/buscarProdutos.ts` (`partirPorTermo`) — **reusar, não recriar** o casamento.
- `components/vitrine/CardProduto.tsx`, `ItemProdutoLista.tsx` — estender, não duplicar.
- `components/ui/` é gerado pelo shadcn CLI: não editar à mão.

## Segurança
- Nome e descrição vêm do banco (preenchidos por lojista) e o termo vem do cliente:
  ambos são entrada não confiável renderizada só por JSX (escape do React) e por nós
  React no realce (`seguranca.md` §15). Nenhum valor monetário tocado — preço segue
  preview, recalculado no checkout (RN-8).

## Critério de aceite
- [ ] Sem `termo`, a vitrine renderiza exatamente como antes (teste de regressão verde).
- [ ] Com `termo="pao"`, "Pão francês" sai como `<mark>Pão</mark> francês` — o trecho realçado mantém o acento da string original.
- [ ] `grep -rn "dangerouslySetInnerHTML" src/components/vitrine/` sem novos casos.
