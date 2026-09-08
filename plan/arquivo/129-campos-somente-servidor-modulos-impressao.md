## Plano Técnico

### Análise do Codebase

O que já existe e será reusado (nada de código novo além de 2 linhas na constante):

- `src/lib/actions/admin-loja.ts:50-64` — `CAMPOS_LOJA_SOMENTE_SERVIDOR`: array
  `as const satisfies readonly (keyof Tabelas["lojas"]["Update"])[]`, hoje com **13**
  entradas. É a **fonte única**. O `satisfies` garante em build que todo nome exista como
  coluna de `lojas.Update` (renomear/remover quebra a compilação aqui).
- `src/lib/actions/admin-loja.ts:66-69` — `PatchLojaAdmin = Omit<Tabelas["lojas"]["Update"],
  (typeof CAMPOS_LOJA_SOMENTE_SERVIDOR)[number]>`. **Consome a constante por tipo**: acrescentar
  as 2 chaves ao array as remove automaticamente do tipo aceito por `atualizarLoja`.
- `src/lib/actions/admin-loja.ts:135-143` — `atualizarLoja(patch)`: filtro de runtime
  `const bloqueadas = CAMPOS_LOJA_SOMENTE_SERVIDOR as readonly string[]` +
  `Object.entries(patch).filter(([k]) => !bloqueadas.includes(k))`. **Consome a MESMA
  constante em runtime**: acrescentar as 2 chaves estende o filtro sem tocar nesta função.
- `src/lib/database.types.ts:436-437` — bloco `Update` de `lojas` já contém
  `modulo_impressao_a4?: boolean` e `modulo_impressao_termica?: boolean` (migration 127).
  Prova que o `satisfies` compilará com as 2 novas entradas.

Conclusão: **basta adicionar 2 strings ao array (13 → 15)**. `PatchLojaAdmin` (tipo) e o
filtro de runtime derivam da constante — zero função/arquivo novo.

Por que o filtro de código é necessário (a RLS/trigger 128 não basta): `svc` roda como
`service_role`, que **BYPASSA** o trigger `lojas_protege_billing` (o próprio trigger tem
`if current_user = 'service_role' ... return new`). E o guard de tipo `PatchLojaAdmin` é
derrotável por cast — `src/app/admin/assinantes/actions/admin-perfil.ts:98` faz
`montarPatchPerfil(dados) as TablesUpdate<"lojas">` antes de `escopo.atualizarLoja(patch)`.
Logo, o **filtro de runtime é a autoridade real** para o caminho admin. Sem estas 2 entradas,
um patch admin poderia ligar `modulo_impressao_*` (módulo pago) → burla de billing (RN-M3).

### Cenários

**Caminho Feliz:** action admin monta patch legítimo (ex.: `{ nome, tema }`) →
`escopo.atualizarLoja` filtra (nenhuma chave bloqueada) → UPDATE aplica normalmente. Sem
regressão para as 13 colunas já bloqueadas nem para as legítimas.

**Casos de Borda:**
- Patch admin hostil com `modulo_impressao_a4: true` (via `as never`/cast) → filtro descarta
  a chave antes do UPDATE. Idem `modulo_impressao_termica`.
- Patch só com chaves bloqueadas → UPDATE com objeto vazio (comportamento já coberto em
  `admin-loja.test.ts:222-237`), não lança.
- Lojista (`salvarPerfil`/`salvarHorarios`/`salvarTema`): patch montado por allowlist de
  construção (ver abaixo) — as flags nunca entram, **sem mudança**.
- Renomear/remover a coluna no schema → `satisfies` quebra o build (tripwire de tipo).

**Tratamento de Erros:** inalterado. As actions admin já logam detalhe no servidor e
devolvem mensagem genérica (`seguranca.md` §14). O filtro é silencioso por design (descarta,
não erra) — coerente com a defesa em profundidade.

### Schema de Banco

Não toca schema. As colunas (127) e o trigger de banco (128, backstop independente) já
existem. Esta issue é **só a camada de código** complementar ao trigger.

### Validação (zod)

Não há schema zod novo. A defesa aqui é a constante-allowlist (`CAMPOS_LOJA_SOMENTE_SERVIDOR`),
não validação de input do usuário.

### Regra cliente ↔ servidor (onde a invariante é garantida)

Invariante: "flags de módulo pago (`modulo_impressao_*`) só o servidor de billing pode ligar".

| Vetor | Camada que garante |
|-------|--------------------|
| Lojista via client autenticado (PostgREST direto / `salvar*`) | Trigger `lojas_protege_billing` (BEFORE INSERT/UPDATE, migration 128) + allowlist de construção nas actions lojista |
| Admin via `escopo.atualizarLoja` (roda como `service_role`, BYPASSA o trigger) | **Filtro de runtime desta issue** (`CAMPOS_LOJA_SOMENTE_SERVIDOR`) + guard de tipo `PatchLojaAdmin` |

Enforcement server-side confirmado nas duas pontas — sem nenhuma dependência de cliente.

### Prova de que as actions do lojista já ficam de fora (fora de escopo, sem mudança)

- `src/lib/actions/patches-loja.ts:30-46` — `montarPatchPerfil` monta o patch **coluna a
  coluna** a partir do dado validado; sem spread do payload. `modulo_impressao_*` não está
  na allowlist → nunca entra.
- `src/lib/actions/loja.ts:207` — `salvarHorarios`: `const patch = { horarios }` (única chave).
- `src/lib/actions/loja.ts:232` — `salvarTema`: `const patch = { tema }` (única chave).

### Teste a estender (TDD RED-first)

Arquivo: **`src/lib/actions/admin-loja.test.ts`** (não o `.binding.test.ts`, que cobre o
binding de `this.rest` do client real, não a blocklist).

- Já existe o padrão do vetor hostil sob cast: `admin-loja.test.ts:171-179`
  (`atualizarLoja({ dono_id: "atacante", nome: "ok" } as never)` → payload sem `dono_id`).
- Já existe teste de completude com blocklist **hardcoded** (13 colunas): `:186-217`. O
  comentário `:181-185` explica que a lista é hardcoded **de propósito** (não importa a
  constante do módulo sob teste — importar esconderia regressão). O RED deve estender **esta
  lista para 15** (adicionar `modulo_impressao_a4`, `modulo_impressao_termica`).
- RED novo (do critério de aceite): 2 vetores específicos —
  `escopo.atualizarLoja({ ...perfilLegitimo, modulo_impressao_a4: true } as never)` →
  `expect(payload).not.toHaveProperty("modulo_impressao_a4")` e `payload.nome` preservado;
  idem `modulo_impressao_termica`. **Confirmado que dá RED real**: antes da mudança a chave
  não está em `bloqueadas`, passa o filtro e a asserção falha.
- (Recomendado) guard de tipo: teste com `// @ts-expect-error` provando que
  `atualizarLoja({ modulo_impressao_a4: true })` (sem cast) **não compila** após a mudança —
  cobre o critério "compila só sem elas".

### Arquivos a Criar / Modificar / NÃO tocar

**Modificar (GREEN):**
- `src/lib/actions/admin-loja.ts:50-64` — adicionar `"modulo_impressao_a4"` e
  `"modulo_impressao_termica"` ao array (13 → 15). Único arquivo de produção.

**Modificar (RED, antes do GREEN):**
- `src/lib/actions/admin-loja.test.ts` — 2 vetores hostis + estender a blocklist hardcoded
  para 15 + (opcional) o `@ts-expect-error` do guard de tipo.

**NÃO tocar:**
- `src/lib/actions/loja.ts` e `src/lib/actions/patches-loja.ts` — lojista já protegido por
  allowlist de construção (fora de escopo).
- `src/app/admin/assinantes/actions/admin-perfil.ts` — o cast `as TablesUpdate` é justamente
  o vetor que o filtro de runtime cobre; não é bug a corrigir aqui.
- Migrations 127/128 — schema e trigger já entregues.
- `src/lib/database.types.ts` — gerado; as colunas já existem.

### Dependências Externas

Nenhuma. Sem novo pacote/API.

### Ordem de Implementação

1. **RED (`/tdd`)** — estender `admin-loja.test.ts` com os 2 vetores hostis
   (`modulo_impressao_*` via `as never`) + blocklist hardcoded 13→15; rodar
   `vitest run admin-loja` e **confirmar vermelho** (as chaves passam pelo filtro hoje).
2. **GREEN (`/execute`)** — adicionar as 2 entradas à constante em `admin-loja.ts`; rodar a
   suíte → verde.
3. **Verificação** — `next build` (o `satisfies` e o guard de tipo são checados em build;
   memória do projeto: rodar build antes de fechar issue que mexe em Server Action/tipos).

### Riscos

- **Drift trigger ↔ constante** (`seguranca.md` §1094 item 4): não há acoplamento automático
  entre `lojas_protege_billing` (banco) e `CAMPOS_LOJA_SOMENTE_SERVIDOR` (TS) — o espelho é
  manual. Esta issue fecha o lado do código para as flags de módulo; o risco de uma **futura**
  coluna de billing entrar no trigger sem entrar na constante permanece. Mitigação recomendada
  pela auditoria da 128: comentário cruzado migration 128 ↔ `admin-loja.ts` e o teste de
  completude hardcoded como tripwire (já existe; mantê-lo em 15).
- **Blocklist do teste desatualizada:** se o GREEN atualizar a constante mas o RED não
  atualizar a lista hardcoded do teste de completude, o teste continua verde sem cobrir as 2
  novas colunas (falso-OK). Por isso a lista hardcoded do teste deve ir a 15 no passo RED.
- **Baixo risco de regressão:** mudança aditiva de 2 strings numa allowlist; as 13 colunas
  originais e os caminhos legítimos (patch admin/lojista sem flags) seguem idênticos.
