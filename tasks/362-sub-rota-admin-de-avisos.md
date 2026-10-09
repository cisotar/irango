# 362 — Sub-rota admin de Avisos (modal sazonal) para a loja-alvo

**crítica: SIM** (escrita sob `service_role` na loja de terceiro; escape de escopo
deixaria o admin gravar/ativar/remover modal na loja errada).

## Problema

O dono do SaaS, operando `/admin/assinantes/[lojaId]`, não vê "Avisos" na sidebar.
Não é bug de nav: o item está omitido **de propósito** por
`src/app/admin/assinantes/[lojaId]/layout.tsx:57`
(`rotasAusentes: ["configuracoes/promocoes", "clientes"]`), porque a sub-rota admin
não existe (`src/app/admin/assinantes/[lojaId]/configuracoes/` tem `assinatura`,
`entregas`, `horarios`, `pagamentos`, `perfil`, `tema` — sem `promocoes`).
O contrato de `rotasAusentes` (`NavPainel.tsx:100-112`) é omitir em vez de nascer
quebrado. Remover o sufixo sem criar a rota publica um 404 — a regressão que a
issue 194 já pagou.

Logo: **feature faltando**, não ajuste visual. A rota do lojista existe
(`src/app/(painel)/painel/(bloqueavel)/configuracoes/promocoes/`, page 90 linhas +
`PromocoesClient.tsx` 627 linhas), e o client **já recebe as actions por prop**
(`acoes: AcoesModalSazonal`, obrigatória, sem default — issue 160), preparado para
a injeção admin.

## Achado que define o desenho

As duas RPCs transacionais do modal são `security invoker` e **recusam a via de
serviço**:

- `supabase/migrations/20260927121000_rpc_salvar_modal_sazonal.sql:53` — S1
  `if auth.uid() is null then raise 'modal_sazonal: sem sessao'`; S2 exige
  `lojas.dono_id = auth.uid()`; `grant execute ... to authenticated` (sem
  `service_role`). O cabeçalho diz literalmente "Admin está fora do escopo".
- `supabase/migrations/20260927125000_rpc_ativar_modal_sazonal.sql:41` — mesmo S1,
  e a loja é derivada do modal conferida contra `auth.uid()`.

Sob `service_role` não há `auth.uid()`. Então o admin **não pode** reusar as RPCs
como estão. As duas alternativas e por que uma só sobra:

1. **Admin escreve sem RPC** (3 requests PostgREST = 3 transações): reintroduz
   exatamente os defeitos que as migrations 312 (RN-M15: linha + mensagem + junções
   ou nada) e 319 (RN-M16: nunca zero ativos) foram criadas para corrigir — na loja
   de **outro** lojista. Recusado.
2. **Abrir a via de serviço nas RPCs**, no padrão que o projeto já estabeleceu em
   `supabase/migrations/20260930120000_rpc_salvar_faixas_entrega_ativo.sql:44-83`
   (`v_e_servico` = `auth.role() = 'service_role'` **e** role efetivo de sessão fora
   de `authenticated`/`anon`; T2 vira `if not (v_e_servico or exists(posse))`), com
   `grant execute ... to service_role`. Aditivo, reversível, assinatura preservada,
   caminho do dono byte-idêntico. **Escolhido.**

Não há mudança de schema: nenhuma tabela, coluna, policy ou índice. Só
`create or replace` de função + um overload novo.

## Escopo

### Banco (migration aditiva, sem schema)

- `create or replace public.salvar_modal_sazonal(...)` — mesma assinatura; S1/S2
  ganham o ramo `v_e_servico`; `grant execute ... to authenticated, service_role`.
  S3–S7 intactos.
- **Novo overload** `public.ativar_modal_sazonal(p_modal_id uuid, p_loja_id uuid)` —
  2 argumentos, **sem `default`** (um `default null` tornaria a chamada de 1 arg
  ambígua e quebraria o lojista). Exige `v_e_servico` **e**
  `modais_sazonais.loja_id = p_loja_id`: a loja-alvo é amarrada **no banco**, não
  por pré-checagem em TS (TOCTOU). `grant execute` só a `service_role`.
  O 1-arg do lojista **não é tocado**.
- `desativar`/`remover` não usam RPC: UPDATE/DELETE escopados por `id` +
  `loja_id`, cinto e suspensório igual a `admin-galeria.ts`. Nada de migration.

### Server Actions admin

`src/app/admin/assinantes/actions/admin-modal-sazonal.ts` (módulo `'use server'`,
só exporta async), 5 actions espelhando as do lojista. Molde: `admin-galeria.ts`.
Para cada uma, na ordem inegociável:

1. `validarLojaIdAdmin(lojaId)` — inválido → erro, **antes** de qualquer efeito e
   antes de elevar a `service_role`;
2. `schemaModalSazonal.safeParse` / `z.guid()` no id, antes de I/O;
3. `prepararContextoAdmin(lojaId)` **fora do try** (prova admin antes de elevar; se
   lança, propaga);
4. escrita com `lojaId` **validado** (nunca do payload) — `p_loja_id` da RPC,
   `.eq("loja_id", lojaId)` nos UPDATE/DELETE;
5. `registrarAcessoAdmin` (`acao: "modal_sazonal_*"`) + revalidate de
   `/admin/assinantes/[lojaId]/configuracoes/promocoes` e da vitrine;
6. erro do banco → mensagem genérica na UI, detalhe no log (`seguranca.md` §14).

Sem rate limit (um operador, mesma decisão de `admin-galeria.ts` RN-G13).
Reusa `montarPatchModalSazonal` e `schemaModalSazonal` — **sem segunda allowlist**.

### Rota admin

Molde exato: `src/app/admin/assinantes/[lojaId]/configuracoes/tema/`.

- `configuracoes/promocoes/page.tsx` — Server Component; `carregarLojaAdminBase(lojaId)`
  (a elevação a `service_role` fica **no loader**, nunca na page); reusa
  `listarModaisSazonaisDoDono(svc, lojaId)` (já parametrizada por `lojaId`, com
  `.eq("loja_id", …)` explícito — segura sob `service_role`, ver cabeçalho de
  `queries/modaisSazonais.ts`), `buscarCategorias`, `lerMensagemModal`,
  `estadoDoModalSazonal` com **um único `agora`**; `export const dynamic = "force-dynamic"`
  (o estado do badge é ao vivo).
- `configuracoes/promocoes/PromocoesAdminClient.tsx` — `"use client"`, wrapper fino
  que reusa o `PromocoesClient` do painel e injeta as 5 actions admin com o `lojaId`
  **fixado por closure** (`criar: (p) => criarModalSazonalAdmin(lojaId, p)`).
- `PromocoesClient.tsx` **não é reescrito.** Se a implementação exigir reescrevê-lo,
  o desenho está errado — pare.
- `layout.tsx:57` → `rotasAusentes: ["clientes"]` (sai só `configuracoes/promocoes`).

## Critérios de aceite

- [ ] Sidebar do hub admin mostra "Avisos" sob Configurações e o link abre a rota
      (não 404). Configurações passa a ter **7** subitens no mundo admin.
- [ ] Admin cria, edita, ativa, desativa e remove modal da loja-alvo.
- [ ] Ativar pelo admin continua transacional: nunca dois ativos, nunca zero.
- [ ] Criar/editar pelo admin é tudo-ou-nada (linha + mensagem + junções).
- [ ] **Isolamento por `lojaId`:** nenhuma das 5 actions escreve em loja diferente
      da validada, nem com id de modal de outra loja no payload. O teste afirma o
      **fragmento da mensagem** de erro junto do SQLSTATE (SQLSTATE sozinho passa
      por acidente aritmético).
- [ ] `rotasAusentes` do layout real = `["clientes"]`; os testes que afirmam o array
      real do layout admin viram o novo contrato. O teste de mecanismo genérico de
      `rotasAusentes` (que passa o array como dado de entrada) segue válido.
- [ ] `src/app/admin/assinantes/[lojaId]/vendas/page.test.tsx:99-101` (afirma
      `clientes` presente e `vendas` ausente do array) continua verde — não quebrar.
- [ ] Gates: `npx tsc --noEmit` → `npm run lint` → `npm test` → `npm run build`.

## Fora de escopo

- Mudança de schema (tabela/coluna/policy/índice).
- `npx supabase db push` — a migration viaja no PR; o deploy ao cloud é irreversível
  e exige autorização (CLAUDE.md). **Sem a migration aplicada, a rota admin falha em
  runtime (`PGRST202`/`sem sessao`) mesmo com build e suíte verdes.**
- Item "Clientes" no admin (base escopada por `auth.uid()` do dono — issue 346).
