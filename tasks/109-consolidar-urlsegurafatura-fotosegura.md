# 109 — Consolidar urlSeguraFatura no util fotoSegura (ou renomear)

crítica: NÃO (qualidade/DRY, anti-XSS já garantido)
origem: débito da revisão/auditoria da issue 104

## Contexto

A issue 104 centralizou a invariante anti-XSS §15 (só `https://` vira src/href) no util
`src/lib/utils/fotoSegura.ts` e migrou 4 callsites de imagem (CardProduto, SecaoCatalogo,
ProdutoModal, HeaderLoja) + 1 barreira de render (EtapaItens).

Restou 1 cópia da mesma fórmula com semântica diferente:
- `src/components/painel/TabelaFaturas.tsx` — `urlSeguraFatura` valida o **href** de uma
  fatura de provider externo (não é `src` de imagem). Predicado idêntico
  (`url && url.startsWith("https://") ? url : null`), mas o nome `fotoSegura` não cabe
  semanticamente num link de fatura.

## Escopo (escolher 1)
- **Opção A:** renomear o util pra `urlHttpsSegura` (nome neutro) e fazer TabelaFaturas +
  os 5 callsites de imagem importarem; ou
- **Opção B:** manter `fotoSegura` pros casos de imagem e deixar `urlSeguraFatura` delegar
  internamente a um helper compartilhado pra fórmula viver num só lugar.

## Critérios
- [ ] Fórmula da invariante §15 num único lugar
- [ ] `grep "startsWith(\"https://\")"` não retorna cópia solta da fórmula
- [ ] build + testes verdes
