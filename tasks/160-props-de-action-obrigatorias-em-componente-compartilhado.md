# [160] Props de Server Action obrigatórias em componente painel/admin compartilhado

**crítica:** NÃO (não explorável hoje — é prevenção)
**Mundo:** painel
**Depende de:** —
**Origem:** finding BAIXA 2 da auditoria da issue 123, AMPLIADO pela auditoria
da issue 124 (que mostrou ser padrão sistêmico, não caso isolado).

## Problema

`PerfilClient.tsx` (linhas ~78-79, 87-90) declara as props de Server Action como
OPCIONAIS, com default apontando para a action do LOJISTA:

```ts
onSalvar?: typeof salvarPerfilLojista   // default: salvarPerfilLojista
```

Hoje não é explorável: `PerfilAdminClient` injeta as quatro actions
incondicionalmente. Mas é footgun de manutenção com consequência séria — uma
sub-rota admin futura que esqueça a prop COMPILA sem erro e cai no default do
lojista, gravando na loja do usuário logado em vez da loja-alvo.

O `enforcement-escopo-admin.test.ts` não pega isso: ele descobre módulos por
referência a `createServiceClient`, e `PerfilAdminClient` não tem nenhuma.

## O padrão é SISTÊMICO (auditoria da 124)

Cinco clients compartilhados declaram a injeção como opcional:

- `PerfilClient.tsx` — `onSalvar?` / `onDefinirPublicacao?` (default lojista)
- `HorariosClient.tsx:59,64` — `onSalvar = salvarHorariosLojista`
- `TemaClient.tsx:42,47` — `onSalvar = salvarTemaLojista`
- `EntregasClient.tsx:37`, `PagamentosClient.tsx:38`, `CuponsClient.tsx:37` — `acoes?:`

Os 6 wrappers admin injetam corretamente HOJE, mas só 2 têm teste travando a
injeção: `PerfilAdminClient.test.tsx` (fechado pela issue 124) e
`CuponsAdminClient.test.tsx`. Ficam SEM teste: `EntregasAdminClient`,
`PagamentosAdminClient`, `HorariosAdminClient`, `TemaAdminClient`.

Os `page.test.tsx` provam page->wrapper, não wrapper->client.
`enforcement-escopo-admin.test.ts` não alcança nenhum deles: descobre módulos por
referência a `createServiceClient`, que wrapper `'use client'` nunca tem.

## Escopo (ordem invertida pela auditoria da 124)

> **Correção de dimensionamento (plano `orquestrar`, ver `plan/loop-160-props-action-obrigatorias.md` §0):**
> a varredura completa do repo mostra **9 wrappers admin reusando 8 clients do
> painel**, não 6x5. Os três que faltavam acima:
> - `CardapioAdminClient.tsx` → `produtos/ProdutosClient.tsx` (`acoes?`)
> - `OpcionaisAdminClient.tsx` → `produtos/opcionais/OpcionaisClient.tsx` (`acoes?`, cascata em 3 níveis)
> - `AssinaturaAdminClient.tsx` → `components/painel/GerenciarAssinaturaClient.tsx` (`acoes`)

- [ ] **PRIMÁRIO — teste-guarda estático**: assertar que todo `*AdminClient.tsx`
      sob `assinantes/**` que renderize um componente do painel injeta TODAS as
      props de action. Fecha os 9 wrappers x 8 clients de uma vez, sem tocar
      arquivo de produção.
- [ ] **SECUNDÁRIO** — tornar as props obrigatórias e passar as actions do
      lojista explicitamente nas pages do painel.

Por que essa ordem: tornar o tipo obrigatório só no `PerfilClient` resolveria
1/5 do problema e deixaria a assimetria pior.

## Critério de aceite

- [ ] Omitir uma prop de action num client admin quebra o build.
- [ ] Nenhuma mudança de comportamento em runtime.
