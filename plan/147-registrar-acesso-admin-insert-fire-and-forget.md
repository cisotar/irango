## Plano Técnico

### Análise do Codebase

**O que já existe e será reusado (NÃO recriar):**

- `src/lib/actions/admin-loja.ts:36` — `type Svc = ReturnType<typeof createServiceClient>` **já declarado** (local). Troca direta de `_svc: unknown` por `svc: Svc`. Nada a criar.
- `src/lib/actions/admin-loja.ts:192-198` — `type AcessoAdmin` **já existe**. Reusar como está (mandato da issue: não redefinir).
- `src/lib/auth/admin.ts:9` — `obterAdminUserId(): string`, síncrono, fail-closed (lança se `SAAS_ADMIN_USER_ID` ausente/vazio). É a **fonte única** do id do dono do SaaS. Não reler `process.env` à mão nem reimplementar lookup.
- `src/lib/database.types.ts:52-60` — `Database["public"]["Tables"]["admin_acessos"]["Insert"]` já gerado: `{ acao, admin_user_id, loja_id, criado_em?, entidade_id?, id?, metadados? }`. `id`/`criado_em` têm default no banco → omitidos no INSERT.
- `src/lib/database.types.ts:1-7` — `type Json` (exportado). Precedente de cast jsonb no projeto: `admin-pagamento.ts:93` / `pagamento.ts:44` usam `... as Json`. Aplicar o mesmo em `metadados`.
- Padrão best-effort try/catch + `console.error("[tag] ... (best-effort)", e)` já consolidado: `reconciliarPosConfirmacao.ts:41`, `geocodificarEndereco.ts:109` ("engole: gravação é best-effort"). `seguranca.md §14`: mensagem genérica ao usuário, detalhe só no `console.error` do servidor.
- Migration da tabela: `supabase/migrations/20260707122000_admin_acessos.sql` (issue 146, já deployada). RLS habilitada **sem policy** = deny-all; só `service_role` (BYPASSRLS) escreve. Sem FK em `loja_id` (audit sobrevive ao hard-delete).
- 13 call sites já passam `(svc, acesso)` — **nenhum muda** (ex.: `admin-categorias.ts:52`, `admin-status.ts:107` com `metadados: { de, para }`).

**Fato decisivo p/ `next build`:** `admin-loja.ts` é módulo **NEUTRO** (linha 1 é `import { z }`, **sem `'use server'`** — confirmado). Logo pode exportar função síncrona livremente. `registrarAcessoAdmin` **já é** `function` declaration (não `const`) — manter assim (memória `use-server-export-constraint`); zero mudança no estilo de declaração.

### Cenários

**Caminho feliz:**
1. Caller (ex.: `criarCategoriaAdmin`) faz o INSERT da loja com sucesso.
2. Chama `registrarAcessoAdmin(svc, { lojaId, acao, entidadeId?, metadados? })` — **sem await**.
3. Dentro, resolve `admin_user_id = acesso.adminId ?? obterAdminUserId()` (id autoritativo do dono do SaaS — a prova `verificarAdminSaaS` já rodou em `prepararContextoAdmin` antes de qualquer caller).
4. Dispara `svc.from("admin_acessos").insert({...})` fire-and-forget; a função retorna `void` **síncrono** e o caller segue para `revalidarLojaAdmin` + `return { ok: true }`.
5. A Promise do insert resolve em microtask; se `error` vier setado, só loga.

**Casos de borda (todos best-effort — NUNCA propagam):**
- `SAAS_ADMIN_USER_ID` ausente → `obterAdminUserId()` **lança síncrono** → capturado dentro do try do IIFE → loga, **não insere**, caller intacto.
- INSERT rejeita (rede/fetch falha) → `await` lança dentro do IIFE → capturado → loga, caller intacto, **sem unhandled-rejection**.
- INSERT resolve com `{ error }` (erro Postgres: tabela indisponível, violação) → ramo `if (error)` loga, caller intacto.
- `entidadeId`/`metadados` ausentes → normalizados para `null` no payload (coluna é nullable).
- Caller que NÃO passa `adminId` (o caso real dos 13 sites) → fallback `obterAdminUserId()`.

**Tratamento de erros:** nenhum erro chega ao usuário (o caller já respondeu ao usuário; log é acessório). Detalhe só em `console.error("[registrarAcessoAdmin] ...", e)` no servidor (`seguranca.md §14`). Best-effort: log quebrado nunca derruba action de billing/PII (a invariante crítica desta issue).

### Schema de Banco

Nada a mudar — tabela `admin_acessos` já criada+deployada (issue 146). Esta issue **só escreve** nela.
- Colunas: `id` (uuid, default), `admin_user_id` (uuid, not null), `loja_id` (uuid, not null), `acao` (text, not null), `entidade_id` (uuid, null), `metadados` (jsonb, null), `criado_em` (timestamptz, default now()).
- **RLS já existente:** deny-all (RLS on, sem policy) — só `service_role` escreve. Nenhuma policy nova.

### Validação (zod)

Não se aplica. `acao`/`entidadeId`/`metadados` vêm do **código das actions**, nunca do request (`seguranca.md`: sem dado do client). `lojaId` já foi validado por `validarLojaIdAdmin` no caller. Sem novo schema.

### Recálculo no Servidor

Sem valor monetário. Porém a garantia server-side crítica é a **robustez fire-and-forget**: `admin_user_id` é resolvido no servidor via `obterAdminUserId()` (nunca do client), o INSERT usa `service_role`, e falha de log é isolada por try/catch para não afetar a action de billing.

### Regra cliente ↔ servidor (mapeamento de camada)

| Invariante | Onde é garantida |
|-----------|------------------|
| INSERT em `admin_acessos` (tabela deny-all) | `service_role` via `createServiceClient` — Server Action only. Nunca no client. |
| `admin_user_id` autoritativo | `obterAdminUserId()` no servidor (env server-only, sem `NEXT_PUBLIC_`); prova de admin (`verificarAdminSaaS`) já feita antes do caller. |
| Log quebrado não derruba action de valor | try/catch único no IIFE dentro de `registrarAcessoAdmin` (server). |

### Esqueleto EXATO da função (a substituir em `admin-loja.ts:207-214`)

Padrão recomendado: **IIFE async com um único try/catch interno + `void`**. Motivo: unifica num só `catch` (a) o throw síncrono de `obterAdminUserId`, (b) a rejeição da Promise do insert (rede) e (c) — via `if (error)` — o erro Postgres. A IIFE **sempre resolve** (o catch engole tudo), então `void`-á-la é livre de unhandled-rejection. Superior ao `try { ... } catch` sync + `.then(undefined, onErro)`, que espalha o tratamento em dois pontos e depende do 2-arg do builder.

```ts
export function registrarAcessoAdmin(svc: Svc, acesso: AcessoAdmin): void {
  // Fire-and-forget: o caller NUNCA dá await. `void` marca a intenção e satisfaz
  // no-floating-promises. A IIFE async colapsa o throw síncrono de obterAdminUserId
  // e a rejeição do insert num único try/catch; a promise sempre resolve → zero
  // unhandled-rejection. Log quebrado (env ausente, rede, tabela indisponível)
  // NUNCA propaga para a action de billing/PII que chamou (seguranca.md §14).
  void (async () => {
    try {
      const admin_user_id = acesso.adminId ?? obterAdminUserId(); // fail-closed: pode lançar
      const { error } = await svc.from("admin_acessos").insert({
        admin_user_id,
        loja_id: acesso.lojaId,
        acao: acesso.acao,
        entidade_id: acesso.entidadeId ?? null,
        metadados: (acesso.metadados ?? null) as Json,
      });
      if (error) {
        console.error("[registrarAcessoAdmin] insert falhou (best-effort):", error.message);
      }
    } catch (e) {
      console.error("[registrarAcessoAdmin] falha ao registrar acesso (best-effort)", e);
    }
  })();
}
```

Imports a ajustar em `admin-loja.ts`:
- Linha 3: adicionar `obterAdminUserId` → `import { verificarAdminSaaS, obterAdminUserId } from "@/lib/auth/admin";`
- Linha 5: adicionar `Json` → `import type { Database, Json } from "@/lib/database.types";`
- Remover o comentário do no-op (linhas 200-206 / 208-213) e atualizar o doc-block para "INSERT best-effort".

Notas de tipo:
- `svc.from("admin_acessos").insert(...)` é **totalmente tipado** (table como string literal) — sem os casts `FromSolto` do wrapper `criarEscopoLoja`. Só `metadados` precisa de `as Json` (precedente `admin-pagamento.ts:93`).
- `AcessoAdmin.metadados` é `Record<string, unknown>`; `as Json` segue o padrão do projeto.

### Padrão de teste (RED-first, em `src/lib/actions/admin-loja.test.ts`)

O teste atual mocka `@/lib/auth/admin` retornando **só** `verificarAdminSaaS` (linhas 40-42) — precisa **adicionar `obterAdminUserId`** ao mock, senão o novo código o veria como `undefined` (throw capturado → insert nunca roda → happy path falha por motivo errado). Evoluir o bloco `describe("registrarAcessoAdmin — no-op...")` (linhas 268-289) para o comportamento real.

Ajustes no topo do arquivo:
```ts
const ADMIN_USER_ID = "99999999-9999-9999-9999-999999999999";
const obterAdminUserId = vi.fn<() => string>(() => ADMIN_USER_ID);
vi.mock("@/lib/auth/admin", () => ({
  verificarAdminSaaS: () => verificarAdminSaaS(),
  obterAdminUserId: () => obterAdminUserId(),   // ← ADICIONAR
}));
// no beforeEach: obterAdminUserId.mockReturnValue(ADMIN_USER_ID);
```

Bloco novo (RED contra o no-op atual — `capturas` fica vazio → happy path vermelho):
```ts
describe("registrarAcessoAdmin — INSERT best-effort fire-and-forget", () => {
  // svc espião: insert em admin_acessos captura o payload e resolve/rejeita por cenário.
  function svcComInsert(cenario: "ok" | "erroPg" | "rejeita") {
    const capturas: { t: string; payload: unknown }[] = [];
    const svc = {
      from: (t: string) => ({
        insert: (payload: unknown) => {
          capturas.push({ t, payload });        // capturado SÍNCRONO (antes do await)
          return {
            then: (res: (v: { error: unknown }) => unknown, rej: (e: unknown) => unknown) =>
              cenario === "rejeita"
                ? Promise.reject(new Error("network")).then(res, rej)
                : Promise.resolve({ error: cenario === "erroPg" ? { message: "dup" } : null }).then(res, rej),
          };
        },
      }),
    };
    return { svc, capturas };
  }

  it("happy path: INSERT recebe admin_user_id resolvido + loja_id/acao/entidade_id/metadados", async () => {
    const { svc, capturas } = svcComInsert("ok");
    registrarAcessoAdmin(svc as never, {
      lojaId: LOJA_ID, acao: "alternar_modulo",
      entidadeId: "prod-1", metadados: { modulo: "a4", ativo: true },
    });
    expect(capturas).toEqual([{
      t: "admin_acessos",
      payload: {
        admin_user_id: ADMIN_USER_ID, loja_id: LOJA_ID, acao: "alternar_modulo",
        entidade_id: "prod-1", metadados: { modulo: "a4", ativo: true },
      },
    }]);
    await Promise.resolve(); // flush do microtask do insert
  });

  it("entidadeId/metadados ausentes → payload normaliza para null", async () => {
    const { svc, capturas } = svcComInsert("ok");
    registrarAcessoAdmin(svc as never, { lojaId: LOJA_ID, acao: "criar_categoria" });
    const p = capturas[0].payload as Record<string, unknown>;
    expect(p.entidade_id).toBeNull();
    expect(p.metadados).toBeNull();
    await Promise.resolve();
  });

  it("INSERT rejeita (rede) → NÃO lança, caller segue, sem unhandled-rejection", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { svc } = svcComInsert("rejeita");
    expect(() => registrarAcessoAdmin(svc as never, { lojaId: LOJA_ID, acao: "x" })).not.toThrow();
    await Promise.resolve(); await Promise.resolve(); // flush: rejeição engolida (teste falharia c/ unhandled)
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("SAAS_ADMIN_USER_ID ausente (obterAdminUserId lança) → NÃO lança e NÃO insere", async () => {
    obterAdminUserId.mockImplementationOnce(() => { throw new Error("SAAS_ADMIN_USER_ID não configurado"); });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { svc, capturas } = svcComInsert("ok");
    expect(() => registrarAcessoAdmin(svc as never, { lojaId: LOJA_ID, acao: "x" })).not.toThrow();
    expect(capturas).toHaveLength(0); // resolução falhou ANTES do insert
    await Promise.resolve();
    spy.mockRestore();
  });

  it("ainda retorna void síncrono", () => {
    const { svc } = svcComInsert("ok");
    expect(registrarAcessoAdmin(svc as never, { lojaId: LOJA_ID, acao: "x" })).toBeUndefined();
  });
});
```

Por que é RED de verdade: contra o no-op atual, `svc.from` nunca é chamado → `capturas` vazio → o happy path (`toEqual([...])`) e o "ausentes → null" falham. Confirmar vermelho com output real antes de escrever o corpo.

Nota — `.insert()` roda **síncrono** dentro do IIFE (async roda até o 1º `await`; `from()`/`insert()` vêm antes dele), por isso `capturas` é populado antes de `registrarAcessoAdmin` retornar; o `await Promise.resolve()` só drena a microtask pendente entre testes.

### Impacto nos outros testes (verificar, provavelmente intacto)

- `admin-publicar.test.ts:78` e `isolamento-admin.test.ts:98` **mockam** `registrarAcessoAdmin: vi.fn()` → totalmente isolados. Intactos.
- `admin-categorias/logo/cupom/produtos/opcionais/pagamento/entrega.test.ts` usam o **real** `admin-loja.ts` mas mockam `@/lib/auth/admin` e `@/lib/supabase/service`. Como o novo corpo é 100% try/catch fire-and-forget, mesmo que esses mocks não exponham `obterAdminUserId` ou não tratem `.from("admin_acessos")`, o pior caso é `console.error` — a action segue `{ ok: true }` e as asserts (sobre `escopo.*`) passam. **Verificar** no GREEN se surge ruído de `console.error`; se sim, esses mocks podem receber `obterAdminUserId` (opcional, não bloqueante). Nenhuma asserção desses arquivos depende do audit insert.

### Arquivos a Criar / Modificar / NÃO tocar

**Modificar:**
- `src/lib/actions/admin-loja.ts` — corpo de `registrarAcessoAdmin` (linhas 207-214) + 2 imports (linhas 3 e 5) + doc-block. `type Svc`/`type AcessoAdmin` reusados como estão.
- `src/lib/actions/admin-loja.test.ts` — adicionar mock de `obterAdminUserId`; substituir o bloco `describe("registrarAcessoAdmin — no-op...")` pelos testes reais (RED-first).

**Criar:** nenhum arquivo novo (reuso total: `Svc`, `AcessoAdmin`, `obterAdminUserId`, `Json`, harness de teste).

**NÃO tocar:**
- Os 13 call sites (mandato explícito da issue).
- `supabase/migrations/` — tabela já existe (issue 146).
- `src/lib/auth/admin.ts`, `src/lib/supabase/service.ts` — reusados sem mudança.
- Demais `*.test.ts` de actions admin (ver seção acima) — a menos que o GREEN mostre ruído.

### Dependências Externas

Nenhuma nova. `@supabase/supabase-js` (já instalado) — o builder do `.insert()` é `PromiseLike`; o padrão `void (async () => { await builder })()` é a forma recomendada de disparar sem await tratando ambos os canais de erro (`{ error }` do PostgREST + rejeição do fetch). Doc: supabase-js PostgREST filter builder retorna `{ data, error }` (não rejeita em erro de banco; rejeita só em falha de transporte).

### Ordem de Implementação (issue CRÍTICA → RED-first)

1. **RED (`/tdd`)** — evoluir `admin-loja.test.ts`: adicionar mock de `obterAdminUserId`, substituir bloco no-op pelos 5 testes reais. Rodar `vitest run admin-loja` e **confirmar vermelho com output real** (happy path e "ausentes→null" falham; os de não-lançar já passam trivialmente contra o no-op — o RED que conta é a captura do payload).
2. **GREEN (`/execute`)** — trocar `_svc: unknown`→`svc: Svc`, adicionar imports (`obterAdminUserId`, `Json`), escrever o corpo IIFE. Verde no `admin-loja.test.ts`.
3. **Regressão** — `vitest run` completo (garantir `isolamento-admin.test.ts` e as suítes de action intactas; tratar ruído de `console.error` se aparecer).
4. **`next build`** — confirmar verde (memória `use-server-export-constraint`: `registrarAcessoAdmin` permanece `function`; `admin-loja.ts` é neutro, então export síncrono é válido).
