# 323 — Frequência de exibição: vitrine + painel/admin (UI)

Spec: `specs/frequencia-exibicao.md` (§Vitrine + painel, RN-1, RN-2, RN-3)
Plano: `plan/loop-frequencia-exibicao.md` (fatia I4)
Crítica: NÃO (só consome 321/322)

## O que fazer

- `src/lib/utils/catalogoVitrine.ts`, `src/app/(publica)/loja/[slug]/page.tsx`,
  `src/components/vitrine/CatalogoVitrine.tsx`: sem seção de cardápio; categoria oculta
  omitida; categoria fora da frequência com todos os itens `fora_da_janela`; produto
  fora da frequência indisponível com rótulo.
- Painel `/painel/produtos` e admin `/admin/assinantes/[lojaId]/produtos`: editor de
  frequência (produto e categoria), grade produto × dia com "salvar tudo", barra de
  seleção múltipla, ocultar/mostrar categoria, aviso RN-1 (molde
  `avisoAgendaQueNuncaAbre` de `descreverVigencia.ts:399`). Alvos ≥ 44px (291).
- Remover "Cardápios" da navegação do painel e do admin; remover o eixo `cardapios`
  do editor do modal sazonal (S6).

## Prova (tabela Risco, linha I4)

`npm run build` + `npx tsc --noEmit`; `grep -rn "agruparPorCardapio\|buscarCardapiosComProdutos"
src/app src/components src/lib/actions` sem uso em vitrine/pedido/revisão; teste puro de
`projetarCatalogoVitrine` para categoria oculta omitida e categoria fora da frequência
com todos os itens `fora_da_janela`.

Depende de: 321, 322.
