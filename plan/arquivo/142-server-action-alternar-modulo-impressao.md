## Plano Técnico

### Análise do Codebase

**O que já existe e será reusado (nada disto se recria):**

- `src/lib/actions/admin-loja.ts` — helpers neutros (sem `'use server'`), fonte única do início de toda action admin:
  - `validarLojaIdAdmin(lojaId): { ok:true; lojaId } | { ok:false }` — `z.guid()` server-side. **Passo 1** (antes de qualquer efeito).
  - `prepararContextoAdmin(lojaId): Promise<{ svc, escopo }>` — chama `verificarAdminSaaS()` **e depois** `createServiceClient()`. Se o guard lança, **propaga** (fail-closed, D-4) e o service client nunca nasce. Usar **fora do `try`**. Reusa aqui só o `svc` (não o `escopo` — ver abaixo).
  - `revalidarLojaAdmin(lojaId)` — invalida `/admin/assinantes`, `/admin/assinantes/${lojaId}` e `/loja/[slug]`. Reuso direto (RN-5).
  - `registrarAcessoAdmin(svc, { lojaId, acao, metadados })` — no-op hoje (débito issue 146). Cabear o evento `"alternar_modulo_impressao"`.
- `@/lib/auth/admin` → `verificarAdminSaaS()` — chamado **dentro** de `prepararContextoAdmin`, não diretamente.
- `@/lib/supabase/service` → `createServiceClient()` — idem, via `prepararContextoAdmin`. `import "server-only"`.
- `src/app/admin/assinantes/actions/admin-publicar.ts` (`publicarLojaAdmin`) — **espelho de forma** mais próximo: mesma ordem, mesmo `Resultado`, mesmo `catch` neutro. **Divergência crítica:** ele usa `escopo.atualizarLoja({ ativo })` porque `ativo` é coluna editável; **nós NÃO podemos** (ver abaixo).
- `src/app/admin/assinantes/actions.ts` → `concederCortesia`/`suspenderLoja` (leem `linhasAfetadas` para "Loja não encontrada.") e `desvincularBilling` (**espelho da escrita crua** `svc.from("lojas").update(...).eq("id", lojaId)` em coluna somente-servidor, fora do wrapper). É este o padrão de escrita a espelhar, não o de `publicarLojaAdmin`.
- `src/lib/database.types.ts` — **os tipos já têm** `modulo_impressao_a4`/`modulo_impressao_termica` como `boolean` em `Row` e `boolean?` em `Update` (linhas ~360/398/436). **Diferente de `desvincularBilling`** (cujas colunas estavam defasadas nos tipos): aqui a coluna existe no tipo gerado → o patch pode ser **totalmente tipado sem cast**.

**Por que NÃO reusar `escopo.atualizarLoja` (decisão firme, RN-1):** `modulo_impressao_a4`/`modulo_impressao_termica` estão em `CAMPOS_LOJA_SOMENTE_SERVIDOR` (`admin-loja.ts`, linhas 64-67). `escopo.atualizarLoja` **descarta em runtime** toda chave dessa constante antes do UPDATE — passar o patch por ele viraria **no-op silencioso**. A escrita das flags é a exceção legítima documentada (mesma classe de `aplicarStatusAdmin`/`persistirAssinaturaLoja`/`desvincularBilling`): **UPDATE cru** `svc.from("lojas").update(...).eq("id", lojaId)`.

**O que precisa ser criado:**

- `src/app/admin/assinantes/actions/admin-modulos-impressao.ts` — módulo `'use server'` novo, exporta só `alternarModuloImpressao`. Não há reuso possível: é uma nova capability (única via legítima de ligar/desligar o entitlement); a lógica de mapeamento módulo→coluna e o vetor de injeção de coluna são específicos desta action.
- Constante server-side não-exportada `COLUNA_POR_MODULO` e `entradaSchema` (zod) **dentro** do arquivo (não em `lib/validacoes/` — é um enum de 2 literais de uso único, sem form compartilhado; a UI 143 valida via `onCheckedChange` booleano, não reusa este schema).

### Regra cliente ↔ servidor (onde cada invariante é garantida)

| Invariante | Camada que garante |
|-----------|--------------------|
| Escrita da flag de módulo (dado de loja) | **Server Action:** `verificarAdminSaaS()` (via `prepararContextoAdmin`, fora do `try`) **antes** de elevar a `service_role` + `.eq("id", lojaId)`. RLS **não** é a defesa (service_role bypassa). |
| Backstop no banco | Trigger `lojas_protege_billing()` v3 — só `service_role`/`postgres`/`supabase_admin` mudam as flags; lojista forjado recebe `EXCEPTION`. Confirmado: bypass por early-return em `current_user IN ('service_role','postgres','supabase_admin')` (migration `20260707121000`). A action roda sob `service_role` → passa. |
| Valor monetário | **N/A** — não há valor calculado. A flag é booleana server-set. O análogo do "recálculo no servidor" (`seguranca.md` §10) aqui é a **decisão de permissão ser server-autoritativa**: o cliente manda `ativo`, o servidor grava **após** provar admin; o cliente nunca decide entitlement. |
| Injeção de nome de coluna (vetor específico) | **Server Action:** `modulo` validado contra union fixo `z.enum(["a4","termica"])` e mapeado por constante `COLUNA_POR_MODULO`. **Nunca** interpolar a string do cliente como identificador — cliente escolhe entre **dois alvos pré-aprovados**. Fora do union → `{ ok:false }` **sem tocar o banco**. |
| Escopo cross-tenant | `lojaId` validado como UUID (`validarLojaIdAdmin`) + `.eq("id", lojaId)` escopa a escrita só à loja-alvo. |

### Cenários

**Caminho Feliz:**
1. `alternarModuloImpressao(lojaId, "a4", true)`.
2. `validarLojaIdAdmin(lojaId)` → `{ ok:true, lojaId }`.
3. `entradaSchema.safeParse({ modulo, ativo })` → `{ modulo:"a4", ativo:true }`; `coluna = COLUNA_POR_MODULO["a4"] = "modulo_impressao_a4"`.
4. `prepararContextoAdmin(lojaId)` (fora do `try`) → prova admin, eleva a `service_role`.
5. `svc.from("lojas").update({ modulo_impressao_a4: true }, { count:"exact" }).eq("id", lojaId)` → `count === 1`.
6. `registrarAcessoAdmin(svc, { acao:"alternar_modulo_impressao", metadados:{ modulo, ativo } })` → `revalidarLojaAdmin(lojaId)` → `{ ok:true }`.
7. `"termica"` percorre o mesmo fluxo mapeando para `modulo_impressao_termica` — **só** essa coluna.

**Casos de Borda:**
- `modulo` fora do union (`"dono_id"`, `"'; drop"`, `""`, número, `undefined`) → `entradaSchema` falha → `{ ok:false, erro:"Módulo inválido." }` **antes** de `prepararContextoAdmin` (admin/service/banco intocados).
- `lojaId` não-UUID → `{ ok:false, erro:"Loja inválida." }` sem tocar admin/service.
- `ativo` não-booleano → `entradaSchema` falha → `{ ok:false }` sem banco.
- Loja inexistente (`count === 0`) → `{ ok:false, erro:"Loja não encontrada." }` (espelha `linhasAfetadas === 0` de `concederCortesia`).
- Admin não provado (`verificarAdminSaaS` lança) → exceção **propaga** (não vira `{ ok:false }`); `createServiceClient` e UPDATE nunca rodam.
- Idempotência (RN-5): ligar módulo já ligado → `count === 1` → `{ ok:true }`, sem efeito colateral.
- Falha de rede/banco no UPDATE (`error` != null) → `{ ok:false, erro:"Não foi possível alterar o módulo." }`, detalhe só no log.

**Tratamento de Erros (`seguranca.md` §14):** mensagens genéricas ao usuário (`"Loja inválida." / "Módulo inválido." / "Loja não encontrada." / "Não foi possível alterar o módulo."`); detalhe do erro só em `console.error("[alternarModuloImpressao]", …)`. Nenhum PII no payload/log.

### Schema de Banco

**Nenhuma migration, coluna, índice ou política RLS nova.** Reusa integralmente o que a spec 4 pôs em produção:
- Colunas `lojas.modulo_impressao_a4` / `lojas.modulo_impressao_termica` (`boolean not null default false`) — migration `20260707120000`.
- Trigger `lojas_protege_billing()` v3 — migration `20260707121000`. Backstop; `service_role` bypassa.
- RLS de `lojas` — inalterada. Não é a defesa aqui (service_role bypassa).

### Validação (zod)

Schema **local ao arquivo** da action (uso único, sem form compartilhado — a UI 143 usa `Switch`/`onCheckedChange` booleano, não este schema):

```ts
const entradaSchema = z.object({
  modulo: z.enum(["a4", "termica"]),
  ativo: z.boolean(),
});
const COLUNA_POR_MODULO = {
  a4: "modulo_impressao_a4",
  termica: "modulo_impressao_termica",
} as const;
```

`lojaId` continua validado por `validarLojaIdAdmin` (`z.guid()`, reuso).

### Recálculo no Servidor

**Sem valor monetário** — nada a recalcular. O cliente envia `{ lojaId, modulo, ativo }`; o servidor:
- **valida** `lojaId` (UUID) e `modulo` (union fixo) — descarta qualquer valor fora do contrato;
- **resolve** o nome real da coluna por constante server-side (o cliente nunca escolhe coluna arbitrária);
- **prova permissão** (`verificarAdminSaaS`) antes de gravar — o entitlement é decisão do servidor, não do cliente;
- grava `ativo` tal-e-qual **após** a prova (booleano, não "quanto paga").

### Esqueleto da Action (contrato que o GREEN satisfaz)

```ts
"use server";

import { z } from "zod";
import type { Database } from "@/lib/database.types";
import {
  validarLojaIdAdmin,
  prepararContextoAdmin,
  revalidarLojaAdmin,
  registrarAcessoAdmin,
} from "@/lib/actions/admin-loja";

type Resultado = { ok: true } | { ok: false; erro: string };
type LojaUpdate = Database["public"]["Tables"]["lojas"]["Update"];

const entradaSchema = z.object({
  modulo: z.enum(["a4", "termica"]),
  ativo: z.boolean(),
});
const COLUNA_POR_MODULO = {
  a4: "modulo_impressao_a4",
  termica: "modulo_impressao_termica",
} as const;

export async function alternarModuloImpressao(
  lojaId: string,
  modulo: string,
  ativo: boolean,
): Promise<Resultado> {
  const loja = validarLojaIdAdmin(lojaId);
  if (!loja.ok) return { ok: false, erro: "Loja inválida." };

  const parsed = entradaSchema.safeParse({ modulo, ativo });
  if (!parsed.success) return { ok: false, erro: "Módulo inválido." };
  const { modulo: mod, ativo: valor } = parsed.data;

  // Fail-closed (D-4): prova de admin FORA do try → propaga; service só depois.
  const { svc } = await prepararContextoAdmin(loja.lojaId);

  try {
    // Patch TOTALMENTE TIPADO (colunas já existem em database.types) — sem cast.
    // NÃO usar escopo.atualizarLoja: descartaria modulo_* (CAMPOS_LOJA_SOMENTE_SERVIDOR).
    // Ternário = o "mapa server-side" materializado; nome de coluna nunca vem do cliente.
    const patch: LojaUpdate =
      mod === "a4" ? { modulo_impressao_a4: valor } : { modulo_impressao_termica: valor };

    // UPDATE cru com .eq no MESMO statement → satisfaz enforcement camada 3.
    const { error, count } = await svc
      .from("lojas")
      .update(patch, { count: "exact" })
      .eq("id", loja.lojaId);

    if (error) {
      console.error("[alternarModuloImpressao]", error);
      return { ok: false, erro: "Não foi possível alterar o módulo." };
    }
    if (count === 0) return { ok: false, erro: "Loja não encontrada." };

    registrarAcessoAdmin(svc, {
      lojaId: loja.lojaId,
      acao: "alternar_modulo_impressao",
      metadados: { modulo: mod, ativo: valor, coluna: COLUNA_POR_MODULO[mod] },
    });
    revalidarLojaAdmin(loja.lojaId);
    return { ok: true };
  } catch (e) {
    console.error("[alternarModuloImpressao]", e);
    return { ok: false, erro: "Não foi possível alterar o módulo." };
  }
}
```

> **Nota de tipagem (decisão para o executor):** como as colunas já estão nos tipos gerados, o **ternário** acima é totalmente tipado e **dispensa cast** — preferir a ele. Só **se** um `next build` reclamar (ex.: opção de chave computada `{ [coluna]: valor }`, que TS alarga para `{ [x:string]: boolean }`), recorrer ao **cast localizado tipado** de `desvincularBilling` (`actions.ts`), nunca `any`. `entradaSchema`/`COLUNA_POR_MODULO`/`type Resultado`/`type LojaUpdate` **não são exportados** — regra `'use server'` (só função async exporta; const exportada quebra só no `next build`).

### Conformidade com `enforcement-escopo-admin.test.ts` (não editar a suíte)

Auto-descoberta por `readdirSync(ACTIONS_DIR)` filtra `*.ts` sem `.test.ts` → o arquivo novo entra sozinho. A action passa nas duas camadas:
- **Camada 2 (GUARD):** o corpo de `export async function alternarModuloImpressao` referencia `prepararContextoAdmin(` → regex `\b(prepararContextoAdmin|verificarAdminSaaS)\s*\(` casa. ✅
- **Camada 3 (ESCOPO):** o statement (delimitado por `;`) `…svc.from("lojas").update(patch,{count:"exact"}).eq("id", loja.lojaId)` casa `ESCRITA` (`.from("lojas") … .update(`) **e** `TEM_EQ` (`.eq(`) → não entra na lista de "escrita sem escopo". ✅ (por isso o `.eq` fica no mesmo statement, não quebrado por `;`.)
- **Sanidade da descoberta:** `≥ 9 módulos` e `≥ 20 exports async` — adicionar 1 export mantém ambos satisfeitos. ✅

### Esqueleto do teste RED (o `tdd` reusa — espelha `admin-publicar.test.ts`)

Mock mais simples do projeto (não precisa do chain thenável de `admin-status.test.ts`, pois só há UMA operação: um UPDATE). Adaptar `admin-publicar.test.ts` para capturar `{count:"exact"}` e devolver `count`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const LOJA_ID = "11111111-1111-1111-1111-111111111111";

// next/cache
const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => revalidatePath(...a) }));

// prova de admin: default passa; negação via mockRejectedValueOnce
const verificarAdminSaaS = vi.fn(async () => undefined);
vi.mock("@/lib/auth/admin", () => ({ verificarAdminSaaS: () => verificarAdminSaaS() }));

// service_role mock: captura patch + opts + escopo .eq; devolve { error, count }
type UpdateCall = { tabela: string; patch: Record<string, unknown>; opts: unknown; eqCol: string; eqVal: unknown };
const updateCalls: UpdateCall[] = [];
let updateError: unknown = null;
let updateCount: number | null = 1;
const clientServico = {
  from: (tabela: string) => ({
    update: (patch: Record<string, unknown>, opts?: unknown) => ({
      eq: async (eqCol: string, eqVal: unknown) => {
        updateCalls.push({ tabela, patch, opts, eqCol, eqVal });
        return { error: updateError, count: updateCount };
      },
    }),
  }),
};
const createServiceClient = vi.fn(() => clientServico);
vi.mock("@/lib/supabase/service", () => ({ createServiceClient: () => createServiceClient() }));

// admin-loja REAL (validarLojaIdAdmin/prepararContextoAdmin/revalidarLojaAdmin), só espiona o no-op
vi.mock("@/lib/actions/admin-loja", async (orig) => {
  const real = (await orig()) as Record<string, unknown>;
  return { ...real, registrarAcessoAdmin: vi.fn() };
});

import { alternarModuloImpressao } from "./admin-modulos-impressao"; // STUB throw "TODO: GREEN" → RED por asserção

beforeEach(() => {
  vi.clearAllMocks();
  updateCalls.length = 0;
  updateError = null;
  updateCount = 1;
  verificarAdminSaaS.mockResolvedValue(undefined);
});
```

**Casos (todos os critérios de aceite RED-first):**
1. `modulo` fora do union (`"dono_id"`, `"'; drop"`, `""`, `123 as any`) → `{ ok:false }`; `updateCalls` vazio **e** `createServiceClient`/`verificarAdminSaaS` **não** chamados (validação vem antes de `prepararContextoAdmin`).
2. `lojaId` não-UUID → `{ ok:false, erro:"Loja inválida." }`; admin/service intocados.
3. `("a4", true)` → `{ ok:true }`; `updateCalls[0].patch` **igual** a `{ modulo_impressao_a4: true }`; `eqCol==="id"`, `eqVal===LOJA_ID`; `opts` inclui `{count:"exact"}`. `("termica", true)` → `{ modulo_impressao_termica: true }` — e **nunca** a outra coluna (`expect(patch).not.toHaveProperty("modulo_impressao_a4")`).
4. `updateCount = 0` → `{ ok:false, erro:"Loja não encontrada." }`.
5. `verificarAdminSaaS.mockRejectedValueOnce(...)` → `await expect(...).rejects.toThrow(...)`; `createServiceClient` não chamado; `updateCalls` vazio.
6. (extra) `updateError = { message:"boom" }` → `{ ok:false }`, detalhe só no log.

> **RED de verdade:** a fase `tdd` cria o teste **e** o stub `alternarModuloImpressao` que `throw new Error("TODO: GREEN")` — o import compila (`tsc`/`next build` passam), mas as asserções de comportamento **falham**. O GREEN (`/execute`) substitui o corpo do stub pelo esqueleto acima.

### Arquivos a Criar / Modificar / NÃO tocar

**Criar:**
- `src/app/admin/assinantes/actions/admin-modulos-impressao.ts` — a Server Action (GREEN).
- `src/app/admin/assinantes/actions/admin-modulos-impressao.test.ts` — RED (fase `tdd`, antes do GREEN).

**Modificar:** nenhum. (UI 143/144, `page.tsx` e `ModulosImpressaoAdmin` são issues separadas.)

**NÃO tocar:**
- `src/app/admin/assinantes/enforcement-escopo-admin.test.ts` — auto-descobre a action; só satisfazer as duas convenções.
- `src/lib/actions/admin-loja.ts` — reusar helpers **como estão**; **não** afrouxar `CAMPOS_LOJA_SOMENTE_SERVIDOR` nem `escopo.atualizarLoja` (o filtro dessas flags é intencional — a action escreve por caminho cru dedicado).
- `supabase/migrations/*` — nenhuma migration nova (spec 4 já entregou colunas + trigger + RLS).
- `src/lib/database.types.ts` — já contém as colunas; não regerar.
- `src/components/ui/switch.tsx` (base-ui) — reuso pela UI 143, sem edição manual.

### Dependências Externas

Nenhuma nova. `zod` (`z.enum`/`z.boolean`/`z.guid`) e `@supabase/*` já no `package.json`. Docs: zod https://zod.dev , Supabase SSR https://supabase.com/docs/guides/auth/server-side/nextjs .

### Ordem de Implementação (issue crítica → RED-first)

1. **RED (`/tdd`)** — escrever `admin-modulos-impressao.test.ts` + stub `admin-modulos-impressao.ts` (`throw "TODO: GREEN"`). Rodar `vitest run` e **anexar o output vermelho** à issue. Justificativa: crítica (`crítica: SIM`), escreve entitlement pago via `service_role` com vetor de injeção de coluna — o teste precede o código.
2. **GREEN (`/execute`)** — implementar o esqueleto acima (mínimo para passar). Confirmar verde do arquivo novo **e** de `enforcement-escopo-admin.test.ts`.
3. **`next build`** — obrigatório: valida a regra `'use server'` (só função async exportada) e a tipagem do patch (ternário sem cast, ou cast localizado se reclamar).
4. **`isolamento-admin.test.ts`** — permanece verde (não exige a nova action na lista manual; a cobertura estática do enforcement já cobre).

### Riscos

- **R1 — usar `escopo.atualizarLoja` por hábito** (é o que `publicarLojaAdmin` faz): viraria **no-op silencioso** (flags descartadas por `CAMPOS_LOJA_SOMENTE_SERVIDOR`). Mitigação: escrita crua `svc.from("lojas").update(...).eq("id")`, espelhando `desvincularBilling`, não `publicarLojaAdmin`.
- **R2 — quebrar o statement do UPDATE com `;`** (ex.: `.eq` numa linha separada com ponto-e-vírgula antes): a camada 3 do enforcement isola statements por `;` → `.eq` cairia fora e o CI acusaria "escrita sem escopo". Mitigação: manter `.update(...).eq(...)` no mesmo statement.
- **R3 — injeção de nome de coluna:** interpolar `modulo` cru (`{ [modulo]: ativo }` ou `.update({ ["modulo_impressao_"+modulo]: ... })`) permitiria alvo arbitrário. Mitigação: union fixo `z.enum` + mapa/ternário server-side; fora do union → sem banco.
- **R4 — tipagem do patch:** chave computada alarga para índice de string e pode falhar só no `next build` (não no `tsc`/`vitest`). Mitigação: ternário totalmente tipado (recomendado) ou cast localizado de `desvincularBilling`; rodar `next build` antes de fechar.
- **R5 — exportar const/schema no arquivo `'use server'`:** quebra só no `next build`. Mitigação: manter `entradaSchema`/`COLUNA_POR_MODULO`/tipos **não-exportados**.
</content>
</invoke>
