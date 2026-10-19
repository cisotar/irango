# 364 — `EscopoLoja.inserirVarios`: upsert com `id` de outra loja move a linha de tenant

crítica: SIM (primitivo de escrita sob `service_role`, escopo multitenant) · Spec: nenhum

Severidade da auditoria: **BAIXA** (latente, sem caminho a partir do cliente hoje).

## Origem

Achado do `auditar` na issue 282 (branch `fix/282-escopoloja-strip-runtime`, base `466d269`). A 282
fechou o strip em runtime de `atualizar`/`atualizarPorChave`; `inserirVarios` ficou fora do escopo
dela e tem um vetor da mesma classe que dispensa cast.

## O problema

`inserirVarios` (`src/lib/actions/admin-loja.ts`, l. ~156) recebe linhas tipadas como
`Omit<Insert, "loja_id">[]`. O tipo aceita `id`, e o parâmetro `opcoes` é opcional.

Quando `opcoes` falta, ou vem com `ignoreDuplicates: false`, o postgrest-js manda
`Prefer: resolution=merge-duplicates` (`node_modules/@supabase/postgrest-js/dist/index.mjs:4434`).
No banco isso vira `ON CONFLICT (id) DO UPDATE SET ..., loja_id = <loja-alvo>`. Uma linha
`{ id: <id de linha de outra loja>, ... }` sobrescreve a linha alheia e a traz para a loja-alvo, sob
`service_role` (BYPASSRLS).

Diferente da 282, o caller não precisa de cast: basta passar `id` na linha e omitir `opcoes`, que é
código TypeScript válido.

## Por que é BAIXA hoje

Os dois callers atuais montam as linhas no servidor, sem `id`, e passam `ignoreDuplicates: true`:

- `src/app/admin/assinantes/actions/admin-cardapios.ts:474`
- `src/app/admin/assinantes/actions/admin-opcionais.ts:591`

O risco é um caller futuro escrever código normal e abrir o vetor.

## Correção proposta

Tornar o vetor impossível pelo desenho, nas duas pontas:

```ts
inserirVarios<T extends TabelaComLojaId>(
  tabela: T,
  linhas: Omit<Tabelas[T]["Insert"], "loja_id" | "id">[],
  opcoes: { onConflict: string; ignoreDuplicates: true },
) {
  return from(tabela).upsert(
    linhas.map((l) => ({ ...semChaves(l, CHAVES_DE_ESCOPO), loja_id: lojaId })),
    opcoes,
  );
},
```

- `opcoes` obrigatório com `ignoreDuplicates: true` literal: o merge deixa de ser alcançável pelo tipo.
- `id` sai do tipo e é removido em runtime por `semChaves` (backstop contra cast, mesmo padrão da 282).
- Conferir que os dois callers compilam sem mudança.

## Critério de aceite

- [ ] RED em `src/lib/actions/admin-loja.test.ts`: linha com `id` via cast ⇒ `id` some do payload de
      cada linha; `loja_id` continua o do wrapper.
- [ ] RED com espião: o upsert sai sempre com `ignoreDuplicates: true`.
- [ ] Teste pglite: upsert com o `id` de uma linha de outra loja não muda o `loja_id` dela.
- [ ] Não duplicar cobertura que já existe nos testes `[269]` de `inserirVarios`.
- [ ] `references/seguranca.md` atualizado se descrever `inserirVarios`.
- [ ] `npx tsc --noEmit` → `npm run lint` → `npm test` → `npm run build`.
