# [218] CAMADA 4: amarrar a RPC admin ao `export` e sair de `assinantes/`

**crítica:** NÃO
**origem:** auditoria de segurança da issue 215 (achados 4 e 5), commit `54821b8`.
**depende de:** nada — a CAMADA 4 já existe e funciona.

## Problema

A CAMADA 4 do guard de escopo admin
(`src/app/admin/assinantes/enforcement-escopo-admin.test.ts`) nasceu na 215 para
ver escrita admin via `svc.rpc(...)`, que as camadas 2 e 3 não enxergavam. Ela
funciona e não é vacuosa ([215-C1] exige ≥2 chamadas descobertas, [215-C4] planta
formas hostis contra o mesmo analisador). Mas a auditoria achou duas folgas:

**1. Aceita `p_loja_id: lojaId` cru sem exigir `validarLojaIdAdmin` no mesmo corpo.**
`ORIGEM_DERIVADA` (`:368`) casa `lojaId`, que é **argumento de Server Action** —
portanto controlado pelo cliente. O laço de `[215-C3]` (`:415`) itera sobre as
chamadas do **módulo**, não do bloco de cada `export`, então não há como amarrar
a chamada ao guard que deveria precedê-la.
Impacto hoje: nulo. O chamador é sempre o admin do SaaS (`verificarAdminSaaS`
compara com `SAAS_ADMIN_USER_ID`) e o tipo `uuid` recusa lixo.

**2. A descoberta só varre `src/app/admin/assinantes/**`** (`:65-83`). Um
`svc.rpc(...)` escrito em `src/lib/actions/*.ts` — e `admin-loja.ts` já cria o
`svc` — é invisível às camadas 2, 3 **e** 4. Limitação pré-existente das camadas
2/3, agora herdada pela 4 num contexto mais caro, porque a 215 introduziu RPC
`security definer` que escapa da RLS por construção.

## Escopo

- iterar por bloco de `exportsAsync` em vez de por módulo, e exigir
  `validarLojaIdAdmin` no mesmo bloco quando o valor de tenant for `lojaId` cru;
- estender a descoberta para todo `src/` onde `createServiceClient` apareça, não
  só `src/app/admin/assinantes/**`.

## Fora de escopo

Afrouxar `ORIGEM_DERIVADA`. Se o guard reprovar código novo, corrige-se o código
— origem nova de tenant exige revisão humana na constante, nunca regex mais
larga.

## Critério de aceite

- [ ] um `svc.rpc` de escrita em `src/lib/actions/` sem tenant explícito é pego;
- [ ] `p_loja_id: lojaId` sem `validarLojaIdAdmin` no mesmo bloco é pego;
- [ ] sanidade anti-vacuidade preservada e teste de letalidade estendido;
- [ ] nenhuma das chamadas legítimas de hoje passa a ser reprovada;
- [ ] `npx tsc --noEmit` → `npm run lint` → `npm test` → `npm run build`.
