# [142] Route group `(bloqueavel)`: layout aninhado do gate + mover páginas + enxugar layout pai

**crítica:** SIM (TDD red-first)
**Mundo:** painel
**Depende de:** [140], [141]
**Spec:** specs/desacoplar-authz-assinatura-route-group.md

## Objetivo
Mover o gate de assinatura do layout pai para um novo layout aninhado
`(bloqueavel)/layout.tsx` que envolve **apenas** as telas gated, tornando a isenção
do paywall posicional (estrutura de filesystem), e eliminando `rota`/`x-pathname`/
`ROTAS_EXCECAO_ASSINATURA` da decisão de authz. Nenhuma URL muda.

## Escopo
- [ ] Criar `src/app/(painel)/painel/(bloqueavel)/layout.tsx` (NOVO): refaz I/O mínimo
  (`createClient` → `getUser` → `buscarLojaDoDono`, fail-closed try/catch → `/login?erro=sessao`),
  roda `decidirAssinatura(loja, agora)` e, se `assinatura-bloqueada`, `redirect("/painel/assinatura-bloqueada")`.
  Retorna `children` **cru** (chrome vem do pai). Envolve `buscarLojaDoDono` em `React.cache()`
  para deduplicar o I/O de loja no request (pai também busca).
- [ ] Mover para dentro de `(bloqueavel)/`: `page.tsx` (dashboard), `produtos/` (+`produtos/opcionais/`),
  `pedidos/` (+`pedidos/[id]/`), `cupons/`, e `configuracoes/{pagamentos,entregas,horarios,perfil,tema}/`.
- [ ] Manter FORA de `(bloqueavel)/` (não mover): `assinatura-bloqueada/` e `configuracoes/assinatura/`.
- [ ] Editar `src/app/(painel)/painel/layout.tsx`: remover `headers()`/leitura de `x-pathname` e o
  gate de assinatura; passar a aplicar só `decidirAcessoBase(user, loja)` + auto-cura de loja órfã;
  envolver `children` no chrome (Sidebar/Topbar).
- [ ] Deletar `decidirAcessoPainel`, o parâmetro `rota` e `ROTAS_EXCECAO_ASSINATURA` de `acessoPainel.ts`
  (último consumidor migrou); ajustar `acessoPainel.test.ts` removendo os blocos que testavam `rota`/exceção.

## Fora de escopo
- Mudar `<Link>`/`href`/`redirect` de rota, `NavPainel.tsx` ou qualquer URL (route group `()` não altera URL).
- Remover `x-pathname` do middleware (é a [143] — aqui o layout pai só **para de ler**).
- Schema/migration/RLS.

## Reuso esperado
- `decidirAcessoBase` e `decidirAssinatura` (funções puras da [140]) — não reimplementar authz.
- `createClient` (`@/lib/supabase/server`), `buscarLojaDoDono`/`garantirLojaDoDono`
  (`@/lib/supabase/queries/lojas`), `createServiceClient`, `VERSAO_TERMOS`, `SidebarPainel`/`TopbarPainel` — reuso.
- `React.cache` para dedup do I/O de loja no request.

## Segurança
- O gate de assinatura passa a ser **posicional**: só o que está sob `(bloqueavel)/` é gated —
  imune a `x-pathname` forjado (mitigação estrutural da classe CVE-2025-29927).
- Fail-closed em ambos os layouts: todo I/O de sessão/loja em try/catch → `/login?erro=sessao`;
  detalhe só em `console.error`, nunca ao cliente (seguranca.md §14).
- Authz permanece 100% server-side nos Server Components de layout; nada migra para o middleware.
- Nenhuma tabela/RLS nova; `lojas` continua sob RLS `auth.uid() = dono_id`.

## Critério de aceite
- [ ] (RED-first) Testes cobrindo o caminho **bloqueado** (redirect p/ `/painel/assinatura-bloqueada`)
  e o **liberado** (children cru) do `(bloqueavel)/layout.tsx` escritos vermelhos antes, depois verdes.
- [ ] `grep -rn "ROTAS_EXCECAO_ASSINATURA" src/` → zero.
- [ ] Guard estrutural da [141] continua verde após o move.
- [ ] `npx next build` → sem colisão de rota, sem warning novo; toda URL `/painel/...` idêntica.
- [ ] Comportamento observável idêntico: assinatura vencida bloqueia tudo sob `(bloqueavel)` e libera
  `/painel/assinatura-bloqueada` e `/painel/configuracoes/assinatura`.
