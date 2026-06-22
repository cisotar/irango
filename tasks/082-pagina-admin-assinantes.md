# [082] Página `/admin/assinantes` (lista + toggles) protegida por `SAAS_ADMIN_USER_ID`

**crítica:** SIM (TDD red-first)
**Mundo:** painel
**Depende de:** [080]
**Spec:** specs/cobranca-assinatura-propria.md

## Objetivo
Tela exclusiva do dono do SaaS para listar todos os assinantes e operar cortesia/suspensão/reativação. A rota inteira é protegida server-side: qualquer identidade que não seja `SAAS_ADMIN_USER_ID` é redirecionada.

## Escopo
- [ ] Guard da rota `/admin/*` (layout ou no Server Component): `auth.uid() === process.env.SAAS_ADMIN_USER_ID`, senão `redirect('/painel')` (RN-13).
- [ ] `page.tsx` Server Component que lê `lojas` + `planos` via `service_role` (sem RLS de dono — admin vê todas).
- [ ] Componentes em `src/components/painel/` (ou `admin/`):
  - `TabelaAssinantes` (`Table`): nome, email do dono, status (`Badge`), plano, `fim_periodo`, `billing_provider`, toggle de cortesia, botão suspender/reativar.
  - `ToggleCortesia` (`Switch`): ON concede, OFF revoga; **desabilitado quando loja `suspensa`** (RN-15).
  - `BotaoSuspender`/`BotaoReativar` (`Button` destructive/primário) com `AlertDialog` de confirmação; `BotaoSuspender` NÃO aparece para loja `cortesia` (RN-15).
  - Filtros: status (`Select`) e busca por nome/email (`Input`).
- [ ] Cada ação chama a Server Action correspondente (080) + `revalidatePath` + toast.

## Fora de escopo
As Server Actions em si (080). Edição de planos (fora do v1).

## Reuso esperado
- Server Actions de admin (080) e `verificarAdminSaaS()`.
- `createServiceClient()` para a leitura admin.
- shadcn/ui (`Table`, `Badge`, `Switch`, `Button`, `AlertDialog`, `Select`, `Input`), `formatarMoeda`, `sonner`.

## Segurança
- A rota expõe dados de TODAS as lojas (email do dono = PII, status de billing) via `service_role`. Se o guard `SAAS_ADMIN_USER_ID` falhar, qualquer lojista autenticado lê/age sobre todas as lojas → vazamento massivo entre tenants + bypass de autorização. Por isso é crítica, mesmo sendo "tela". A precedência de UI (RN-15) evita ações incoerentes.

## Critério de aceite
- [ ] Teste RED: acesso por usuário `uid !== SAAS_ADMIN_USER_ID` (lojista autenticado incluso) → redirect, sem renderizar dados de outras lojas; admin vê a lista completa.
- [ ] `ToggleCortesia` desabilitado em loja `suspensa`; `BotaoSuspender` ausente em loja `cortesia`; confirmação via `AlertDialog` antes de suspender.
- [ ] `next build` passa.
