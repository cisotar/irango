# Plano técnico — [122] Base: validação + allowlist da flag `whatsapp_envio_automatico`

### Análise do Codebase

**Já existe — SERÁ REUSADO (estender, nunca recriar):**

- `src/lib/validacoes/loja.ts` → `schemaPerfil` (zod v4, `.strict()`) — schema
  isomórfico único, usado em 3 pontos: `PerfilClient.tsx:194` (UX), `salvarPerfil`
  (`src/lib/actions/loja.ts:82`) e `salvarPerfilAdmin`
  (`src/app/admin/assinantes/actions/admin-perfil.ts:82`). Ganha 1 campo booleano
  opcional. **Nenhum schema novo.**
- `src/lib/actions/patches-loja.ts` → `DadosPerfil` + `montarPatchPerfil` — módulo
  NEUTRO (sem `'use server'`, funções puras), allowlist RN-7 coluna-a-coluna
  compartilhada painel ↔ admin. Ganha 1 campo no tipo e 1 linha `if (... !== undefined)`.
  **Nenhum builder novo, nenhum spread.**
- `src/app/admin/assinantes/actions/admin-perfil.ts` → `CHAVES_PERFIL` (const local,
  não exportada) — allowlist-pick da via admin, aplicada ANTES do `safeParse`
  (1ª barreira; o `.strict()` é a 2ª e `montarPatchPerfil` a 3ª). Ganha 1 entrada.
  A Server Action chama-se `salvarPerfilAdmin` (o spec 5 a chama erroneamente de
  `atualizarPerfilAdmin`).
- `src/lib/actions/admin-loja.ts` → `CAMPOS_LOJA_SOMENTE_SERVIDOR` +
  `escopo.atualizarLoja` — filtro de runtime que descarta colunas somente-servidor
  do patch admin (backstop real contra `as`/width-subtyping, já que `svc` é
  service_role e BYPASSA o trigger `lojas_protege_billing`). **NÃO tocar:**
  `whatsapp_envio_automatico` é preferência operacional, não billing → fica FORA da
  lista, por design (é o que a permite fluir).
- `supabase/migrations/20260704120000_lojas_whatsapp_envio_automatico.sql` (issue 121)
  — coluna `boolean NOT NULL DEFAULT true` + projeção em `vitrine_lojas`, já aplicada,
  já em `src/lib/database.types.ts` (Row/Insert/Update de `lojas` e `vitrine_lojas`),
  já coberta por `tests/migrations/whatsapp_envio_automatico.test.ts`.
- Testes existentes: `src/lib/actions/patches-loja.test.ts` (trava a lista exata em
  `COLUNAS_PERMITIDAS`), `src/lib/validacoes/loja.test.ts`,
  `src/app/admin/assinantes/actions/admin-perfil.test.ts` (payload hostil + captura
  do patch enviado ao 1º UPDATE).

**Precisa ser criado:** NADA. Zero arquivo novo, zero migration, zero dependência,
zero componente. A issue é puramente a extensão de 3 allowlists já existentes + testes.

### Cenários

**Caminho feliz (lojista):**
1. Cliente (futuro toggle, issue 123) envia `{ nome, slug, ..., whatsapp_envio_automatico: false }`.
2. `salvarPerfil` roda `schemaPerfil.safeParse(payload)` → passa (`z.boolean().optional()`).
3. `montarPatchPerfil(dados)` emite `whatsapp_envio_automatico: false` no patch (chave presente).
4. `supabase.from("lojas").update(patch).eq("id", loja.id)` — client AUTENTICADO;
   RLS `lojas_update_proprio` (`auth.uid() = dono_id`) é quem autoriza a linha.
5. 2º UPDATE de coords segue inalterado.

**Caminho feliz (admin):**
1. Payload chega em `salvarPerfilAdmin(lojaId, payload)`.
2. `CHAVES_PERFIL` filtra: `whatsapp_envio_automatico` agora sobrevive ao pick.
3. `schemaPerfil.safeParse` → `montarPatchPerfil` → `escopo.atualizarLoja(patch)`,
   que injeta `.eq("id", lojaId)` por construção e descarta chaves somente-servidor.
   A flag NÃO está em `CAMPOS_LOJA_SOMENTE_SERVIDOR` → chega ao UPDATE.

**Casos de borda:**
- **Campo ausente** (estado de hoje: `PerfilClient.montarPayload()` não emite a chave,
  e o cliente admin idem) → `undefined` → **não entra no patch** → a coluna no banco é
  PRESERVADA. Invariante crítica: esta issue não pode "resetar" a flag de ninguém
  enquanto a UI da 123 não existir.
- **Valor não-booleano** (`"true"`, `1`, `null`) → `safeParse` reprova → `ERRO_VALIDACAO`
  genérico, zero I/O. `z.boolean()` não coage string.
- **Payload hostil** com `dono_id`/`ativo`/`assinatura_*`/`hotmart_*`/`consentimento_*`/
  `id`/`latitude`/`longitude`: via lojista reprova no `.strict()`; via admin é
  descartado no pick de `CHAVES_PERFIL`; em ambos, `montarPatchPerfil` nunca emitiria.
  Três barreiras intactas.
- **Loja inexistente / sem loja** (lojista) → `ERRO_SEM_LOJA` antes do UPDATE (já existente).
- **Slug ocupado por outra loja** → `ERRO_SLUG_OCUPADO` antes do UPDATE (já existente).
- **Admin não provado** → `verificarAdminSaaS()` lança e PROPAGA (fail-closed, D-4);
  a flag nunca é gravada, o service client nunca é criado.
- **Falha de rede/DB no UPDATE** → `throw error` → catch → `ERRO_GENERICO`.

**Tratamento de erros:** nenhuma mensagem nova. Reusa `ERRO_VALIDACAO` /
`ERRO_GENERICO` das duas actions; detalhe só em `console.error` do servidor
(`seguranca.md` §14). O usuário nunca vê nome de coluna nem issue do zod.

### Schema de Banco

**NADA a fazer.** A coluna `lojas.whatsapp_envio_automatico boolean NOT NULL DEFAULT true`
já existe (migration `20260704120000_...`, issue 121), já está projetada em
`vitrine_lojas` e já está nos tipos gerados. **NÃO criar migration. NÃO regenerar
`database.types.ts`.**

**RLS:** nenhuma política nova — tabela pré-existente. A escrita é coberta pelas
políticas já vigentes de `lojas`:

| Invariante | Onde é garantida (server-side) |
|---|---|
| Lojista só grava a PRÓPRIA loja | **RLS** `lojas_update_proprio` (`auth.uid() = dono_id`) sobre o client autenticado + `.eq("id", loja.id)` com a loja resolvida no servidor por `buscarLojaDoDono` |
| Admin grava só a loja-alvo da rota | **Server Action**: `verificarAdminSaaS()` fail-closed ANTES de elevar a `service_role`, + `escopo.atualizarLoja` injetando `.eq("id", lojaId)` por construção, com `lojaId` vindo da ROTA validada (`validarLojaIdAdmin`), nunca do payload |
| Coluna autoritativa em payload hostil | **Server Action**: pick `CHAVES_PERFIL` → `.strict()` → allowlist de `montarPatchPerfil` → filtro de runtime `CAMPOS_LOJA_SOMENTE_SERVIDOR`; e no banco o trigger `lojas_protege_billing` |
| Operação com service role | Só em `salvarPerfilAdmin` (Server Action) e no `slugExiste` do lojista — nunca no client |

**Regra cliente ↔ servidor:** não há valor monetário nesta issue. O único dado é uma
preferência booleana da própria loja, e o cliente **não escolhe qual loja** é gravada
em nenhuma das duas vias — a linha vem de `dono_id` (RLS) ou do `lojaId` da rota (admin).
A decisão de EMITIR o link de WhatsApp a partir dessa flag é server-side e pertence à
issue 125 (`criarPedido`), não a esta.

### Validação (zod)

Um único ponto, `src/lib/validacoes/loja.ts`, dentro do `z.object` ANTES do `.strict()`:

```ts
// Preferência operacional (issue 122 / spec 5): opcional — payload sem a chave
// PRESERVA o valor no banco (montarPatchPerfil só grava quando !== undefined).
whatsapp_envio_automatico: z.boolean().optional(),
```

Sem `.default(true)`: um default no schema transformaria "campo ausente" em
"gravar true", sobrescrevendo a escolha do lojista em qualquer save de perfil que não
mande o campo. O DEFAULT vive no banco (migration 121), onde já basta.
Mesmo schema no form (UX) e nas duas Server Actions (segurança).

### Recálculo no Servidor

Não se aplica — nenhum valor monetário. O campo é preferência; o servidor não
"recalcula" um booleano de escolha do usuário, apenas o valida, allowlista e escopa
à linha correta.

### Arquivos a Criar / Modificar / NÃO tocar

**Criar:** nenhum.

**Modificar (3 de produção + 3 de teste):**

| Arquivo | Mudança |
|---|---|
| `src/lib/validacoes/loja.ts` | +1 linha em `schemaPerfil`: `whatsapp_envio_automatico: z.boolean().optional()` (antes do `.strict()`) |
| `src/lib/actions/patches-loja.ts` | +1 campo em `DadosPerfil` (`whatsapp_envio_automatico?: boolean`) e +1 linha em `montarPatchPerfil` (`if (d.whatsapp_envio_automatico !== undefined) patch.whatsapp_envio_automatico = d.whatsapp_envio_automatico;`). Atualizar o comentário-cabeçalho da allowlist |
| `src/app/admin/assinantes/actions/admin-perfil.ts` | +1 entrada em `CHAVES_PERFIL` (ver Decisão em aberto) |
| `src/lib/actions/loja.ts` | **provavelmente nenhuma edição** — `salvarPerfil` já repassa `parsed.data` inteiro a `montarPatchPerfil`. Só conferir com `npx tsc --noEmit` que o tipo inferido do schema continua atribuível a `DadosPerfil` |
| `src/lib/validacoes/loja.test.ts` | novos casos do bloco `schemaPerfil` (T1–T4) |
| `src/lib/actions/patches-loja.test.ts` | **atenção:** adicionar `"whatsapp_envio_automatico"` a `COLUNAS_PERMITIDAS` faz o 1º teste (`expect(Object.keys(patch).sort()).toEqual([...COLUNAS_PERMITIDAS].sort())`) quebrar se a flag não for incluída TAMBÉM no payload e no `toEqual` daquele caso. Editar os três juntos |
| `src/app/admin/assinantes/actions/admin-perfil.test.ts` | +casos T7/T8 (via admin ponta a ponta) |

**NÃO tocar:**

- `supabase/migrations/**` — coluna já existe (issue 121). Criar migration aqui seria duplicação.
- `src/lib/database.types.ts` — gerado; a coluna já está lá (linhas 404/442/480, 993+).
- `src/lib/actions/admin-loja.ts` / `CAMPOS_LOJA_SOMENTE_SERVIDOR` — a flag deve
  permanecer FORA da lista (preferência, não billing). Adicioná-la mataria a feature.
- `PerfilClient.tsx`, `ConfiguracaoAdminClient.tsx`, `Switch` — UI é a issue **123**.
- `src/lib/actions/pedido.ts`, `useEnviarPedido.ts` — issues **124/125**.
- `components/ui/**` (shadcn) — nunca editar à mão.

**Higiene opcional (1 linha):** `specs/5-whatsapp-envio-automatico-toggle.md` chama a
Server Action admin de `atualizarPerfilAdmin`; o nome real é `salvarPerfilAdmin`.
Corrigir no spec evita o implementador da 124 procurar símbolo inexistente.

### Decisão em aberto (recomendação do arquiteto)

`CHAVES_PERFIL` é uma cópia manual das chaves de `schemaPerfil` — duplicação que já
existe e que esta issue amplia. Alternativa de 1 linha, sem arquivo novo:

```ts
const CHAVES_PERFIL = Object.keys(schemaPerfil.shape) as (keyof typeof schemaPerfil.shape)[];
```

Em zod v4 `.strict()` preserva `.shape`, e o conjunto derivado é HOJE idêntico à lista
manual (as mesmas 10 chaves) — a troca é comportamentalmente neutra e elimina a classe
inteira de drift schema↔allowlist para 122, 123 e além. **Recomendado.** Se preferir
escopo mínimo, mantenha a lista manual e adicione o teste de paridade (T9) que faz o
drift quebrar vermelho.

### Cenários de teste

`src/lib/validacoes/loja.test.ts`:
- **T1** `schemaPerfil.safeParse({ nome, slug, whatsapp_envio_automatico: true })` → `success: true`
- **T2** idem com `false` → `success: true`
- **T3** ausente (payload válido sem a chave) → `success: true` e `data.whatsapp_envio_automatico === undefined` (prova que NÃO há default no schema)
- **T4** valor não-booleano (`"true"`, `1`, `null`) → `success: false` (sem coerção)

`src/lib/actions/patches-loja.test.ts`:
- **T5** flag presente com `true` **e com `false`** → aparece no patch com o valor exato.
  O caso `false` é o que pega o bug clássico de truthiness em vez de `!== undefined`
- **T5b** atualizar `COLUNAS_PERMITIDAS` + o caso "inclui apenas as colunas allowlisted" (payload e `toEqual`)
- **T6** flag ausente → chave **não** aparece no patch (`"whatsapp_envio_automatico" in patch === false`) — protege o valor já gravado
- **T6b** o caso de payload hostil (colunas autoritativas) continua verde, sem regressão

`src/app/admin/assinantes/actions/admin-perfil.test.ts`:
- **T7** payload admin com `whatsapp_envio_automatico: false` → o patch capturado no
  1º `.update()` contém a chave com `false`, e o UPDATE está escopado por `.eq("id", lojaId)`
- **T8** payload admin hostil com `assinatura_status`/`dono_id`/`latitude` + a flag →
  só a flag (e nome/slug) sobrevive; as autoritativas continuam ausentes
- **T9** (só se `CHAVES_PERFIL` seguir manual) paridade `CHAVES_PERFIL` ↔
  `Object.keys(schemaPerfil.shape)` — exige exportar a const

### Dependências Externas

Nenhuma. `zod ^4.4.3` e `vitest ^4.1.8` já em `package.json`; `z.boolean()` é primitivo.
Docs: https://zod.dev/api?id=booleans

### Ordem de Implementação

Issue **não crítica** (`crítica: NÃO`) — TDD red-first não é obrigatório, mas a ordem
abaixo mantém a rede de segurança da allowlist RN-7 sempre ativa:

1. **Testes primeiro (T1–T6)** — barato e faz a extensão nascer coberta.
   `npx vitest run src/lib/validacoes/loja.test.ts src/lib/actions/patches-loja.test.ts` → VERMELHO.
2. `src/lib/validacoes/loja.ts` — campo no `schemaPerfil` (T1–T4 verdes).
3. `src/lib/actions/patches-loja.ts` — `DadosPerfil` + `montarPatchPerfil`
   (depende do passo 2 para o tipo inferido bater; T5–T6 verdes).
4. `src/app/admin/assinantes/actions/admin-perfil.ts` — `CHAVES_PERFIL`
   (ou a derivação do `shape`); depende de 2 e 3 para a chave ter para onde fluir.
5. T7/T8 no `admin-perfil.test.ts` — via admin ponta a ponta.
6. `npx tsc --noEmit` + suíte completa (`npx vitest run`), incluindo
   `tests/migrations/whatsapp_envio_automatico.test.ts` e `src/lib/actions/loja.test.ts`,
   para provar que nada regrediu nas outras vias de escrita de `lojas`.

**Desbloqueia:** issues 123 (UI do toggle), 124 (wiring admin), 125 (`whatsappHref` em `criarPedido`).
