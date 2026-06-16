# [008] `salvarPerfil`: allowlist de endereço + geocoding na escrita das coords

**crítica:** SIM (TDD red-first)
**Mundo:** painel (Server Action de escrita)
**Depende de:** 001, 003, 004
**Spec:** specs/zonas-entrega-raio-km.md

## Objetivo
Estender `salvarPerfil` (`lib/actions/loja.ts`): adicionar `endereco_*` à allowlist explícita do patch; após validar e salvar o endereço, geocodificar via Nominatim no servidor e persistir `latitude`/`longitude` (par tudo-ou-nada) — nunca aceitando coords do payload. Retornar sinal de geocoding falho para o cliente avisar (não-bloqueante).

## Escopo
- [ ] Estender a allowlist do patch com `endereco_cep/rua/numero/bairro/cidade/estado` (a partir do dado já validado pelo `schemaPerfil`, issue 004).
- [ ] Após o UPDATE do endereço: chamar `geocodificarEndereco(...)` no servidor.
  - Sucesso → patch separado escreve `latitude` + `longitude` juntos (par).
  - Falha (`null`) → endereço fica salvo **sem coords** (ambos NULL); não bloqueia o salvamento.
- [ ] Tipo de retorno estendido para sinalizar `{ ok: true; geocodificado: boolean }` (ou equivalente) → o cliente mostra toast quando `geocodificado: false`.
- [ ] Coords escritas via client autenticado sob RLS (`lojas_update_proprio`), escopado por `.eq("id", loja.id)` (padrão atual da action).
- [ ] Quando endereço fica incompleto (sem dados suficientes p/ geocodificar), zerar coords para NULL (par) — não deixar coords antigas órfãs de um endereço novo divergente. Avaliar na implementação.

## Fora de escopo
- UI do formulário e o toast em si (issue 009) — aqui só o sinal de retorno.
- Cálculo de frete (issues 006/007).
- Adicionar coords ao `schemaPerfil` (proibido — issue 004 garante a rejeição).

## Reuso esperado
- `geocodificarEndereco.ts` (issue 003) — não chamar Nominatim direto.
- Padrão de allowlist explícita já presente em `salvarPerfil` (RN-A5) — estender a allowlist existente.
- `verificarRateLimit("salvarPerfil", ip)` já no topo da action — mantém.

## Segurança
- RN-1: coords derivadas no servidor; `.strict()` (issue 004) + allowlist explícita rejeitam injeção de `latitude`/`longitude` do cliente. Dupla barreira.
- RN-2: escrita tudo-ou-nada — `(lat,lng)` ambos ou ambos NULL (reforçado pelo CHECK da issue 001).
- §14: falha de geocoding → log genérico; nunca stack trace ao cliente.
- Bug aqui (aceitar coords do payload) → lojista forja localização e vaza/falseia atendimento → crítica.

## Critério de aceite
- [ ] (teste vermelho primeiro) Testes da action com `geocodificarEndereco` mockado:
  - Endereço válido + geocoding ok → coords persistidas (par); retorno `geocodificado: true`.
  - Geocoding `null` → endereço salvo, coords NULL (par); retorno `geocodificado: false`.
  - Payload com `latitude`/`longitude` → rejeitado (não chega ao patch).
  - Dono A não consegue gravar coords da loja do dono B (RLS).
- [ ] `next build` sem erro; `pnpm test` verde.

---

## Plano Técnico

### Diagnóstico

**Causa raiz:** hoje `salvarPerfil` persiste apenas `nome/slug/telefone/whatsapp`. Os campos `endereco_*` já existem no schema zod (issue 004, `schemaPerfil`) e no banco (`lojas`), mas a action **não os escreve** e **não deriva coordenadas**. Sem coordenadas persistidas, toda a feature de zonas por raio_km (specs/zonas-entrega-raio-km) fica inerte. A coordenada é um **dado derivado autoritativo do servidor** — não pode existir nenhum caminho em que o cliente influencie seu valor; a única fonte legítima é o geocoding server-side do endereço que o próprio servidor acabou de validar e gravar.

**Por que é complexo (multi-camada + contrato + invariante de segurança):**
1. **Muda o contrato de retorno** (`ResultadoSalvar` → variante com `geocodificado: boolean`) — consumido pelo `PerfilClient.tsx` e por 1 teste que faz `toEqual({ ok: true })` (igualdade estrita quebra).
2. **Invariante de segurança de derivação** (RN-1): coords nunca vêm do cliente. Dupla barreira (`.strict()` no schema + allowlist na action) precisa ser provada por teste de ataque.
3. **Invariante de par tudo-ou-nada** (RN-2): `(latitude, longitude)` ambos preenchidos ou ambos NULL — espalhado por 3 caminhos (sucesso, falha de geocoding, endereço incompleto). A verdade tem que estar em UM ponto de montagem do par, não em guards repetidos.
4. **I/O externo com política fail-closed anti-ban** (issue 003) intercalado no meio de uma escrita de banco, sem poder bloquear o salvamento do endereço.
5. **Toca RLS** indiretamente: a escrita de coords roda no client autenticado sob `lojas_update_proprio` — isolamento multitenant precisa ser provado.

### Mapa de Impacto

Árvore de chamadas (estado-alvo):

```
PerfilClient.tsx (cliente, 'use client')
  └─ chama → salvarPerfil(payload)   [Server Action — AUTORITATIVO]
       ├─ verificarRateLimit("salvarPerfil", ip)        [trava abuso — mantém]
       ├─ schemaPerfil.safeParse(payload)               [.strict() — BARREIRA 1: rejeita latitude/longitude]
       ├─ buscarLojaDoDono(supabase)                    [RLS lojas_leitura_propria → loja.id, loja.slug]
       ├─ slugExiste(service, slug, exceto=loja.id)     [só se slug mudou]
       ├─ patch de perfil+endereço (ALLOWLIST explícita) [BARREIRA 2: só colunas permitidas]
       │    └─ supabase.from("lojas").update(patch).eq("id", loja.id)
       │         → lojas (RLS lojas_update_proprio: auth.uid()=dono_id)  [AUTORITATIVO]
       ├─ montarConsultaGeocoding(dados)                 [util puro — string ou null]
       │    └─ se null (endereço incompleto) → coords = {lat:null, lng:null}
       │    └─ se string → geocodificarEndereco(consulta) [I/O Nominatim, fail-closed, server-only]
       │         → ok  → coords = {lat, lng}             [par derivado no SERVIDOR]
       │         → null→ coords = {lat:null, lng:null}   [par NULL]
       ├─ supabase.from("lojas").update(coords).eq("id", loja.id)  [2º UPDATE, par tudo-ou-nada]
       │         → lojas (mesma RLS lojas_update_proprio)
       ├─ revalidarVitrine(...)
       └─ return { ok:true, geocodificado: boolean }    [CONTRATO ESTENDIDO]

Invariante "coords só do servidor" garantida em:
  ├── schemaPerfil (.strict(), issue 004)       — BARREIRA 1: payload com lat/lng → safeParse falha
  ├── allowlist do patch em salvarPerfil        — BARREIRA 2: chave fora da lista nunca entra no UPDATE
  ├── geocodificarEndereco (server-only)        — FONTE ÚNICA do valor das coords
  └── CHECK lojas_coords_par_check (issue 001)  — REDE FINAL no banco: rejeita par quebrado

Invariante "par tudo-ou-nada" garantida em:
  ├── 1 ponto de montagem do par `coords` na action (objeto único {latitude, longitude})
  └── CHECK lojas_coords_par_check (issue 001)  — (latitude IS NULL) = (longitude IS NULL)
```

### Análise do Codebase

| Arquivo | Papel atual | O que muda |
|---|---|---|
| `src/lib/actions/loja.ts` | `salvarPerfil` monta allowlist de `nome/slug/telefone/whatsapp`, faz 1 UPDATE, retorna `ResultadoSalvar`. | Estende allowlist com 6 `endereco_*`; adiciona montagem de consulta + chamada a `geocodificarEndereco`; 2º UPDATE do par de coords; retorno estendido. Tipo `ResultadoSalvar` ganha o campo `geocodificado` **só** na variante de `salvarPerfil` (ver Decisão D1). |
| `src/lib/utils/geocodificarEndereco.ts` | Util server-only `geocodificarEndereco(consulta: string): Promise<Coordenadas \| null>`. Caller monta a query. | **Não muda.** Reusado como está. |
| `src/lib/validacoes/loja.ts` | `schemaPerfil` `.strict()` já inclui `endereco_*` opcionais; `endereco_estado` transformado p/ uppercase; **não** inclui lat/lng (proibido). | **Não muda.** Issue 004 já entregou. |
| `src/lib/actions/loja.test.ts` | Cobre `salvarPerfil`/`salvarHorarios`/`salvarTema`/`definirPublicacao`. Mock do client autenticado captura `updatePatch`/`updateEq`. | **Modificar** (fase RED): novos casos de geocoding/coords; **corrigir bug** do set `COLUNAS_PERMITIDAS` (ver Decisão D4); ajustar mock do client autenticado p/ suportar 2 UPDATEs; ajustar asserções `toEqual({ ok: true })` p/ o novo retorno. |
| `src/app/(painel)/painel/configuracoes/perfil/PerfilClient.tsx` | Consome `salvarPerfil`; em `r.ok` mostra `toast.success("Perfil salvo!")`. | **Não tocar nesta issue** (UI/toast de geocoding falho = issue 009). O contrato estendido é retrocompatível com o uso atual (`if (!resultado.ok)` continua válido; `r.ok===true` continua válido). Ver "NÃO tocar". |
| `src/lib/database.types.ts` | Já tem `latitude/longitude: number\|null` em `lojas` Row/Insert/Update (issue 001 aplicada). | **Não muda** (nada de novo no schema nesta issue). |
| `supabase/migrations/20260616194631_lojas_coordenadas.sql` | Colunas + 3 CHECKs (par, range lat, range lng). | **Não muda** (issue 001). É a rede final do par. |

Detalhe crítico de nomenclatura (achado): a coluna real do banco e do `schemaPerfil` é **`endereco_estado`** (confirmado em `schema_inicial.sql`, `database.types.ts`, `loja.ts`). O set `COLUNAS_PERMITIDAS` do teste atual lista `endereco_uf` — **nome errado**. A fase RED deve corrigir para `endereco_estado` (Decisão D4).

### Decisões de Design

**D1 — Forma do retorno estendido.**
- Opção A — campo opcional na união existente: `type ResultadoSalvar = { ok: true; geocodificado?: boolean } | { ok: false; erro: string }`. Prós: zero ruptura nos outros callers (`salvarHorarios/Tema/definirPublicacao` continuam retornando `{ ok: true }`). Contras: `geocodificado` vira opcional em actions onde não faz sentido; teste `toEqual({ ok: true })` dessas outras actions continua passando.
- Opção B — tipo dedicado para `salvarPerfil`: `type ResultadoPerfil = { ok: true; geocodificado: boolean } | { ok: false; erro: string }` e `salvarPerfil(): Promise<ResultadoPerfil>`; as demais actions mantêm `ResultadoSalvar`. Prós: contrato preciso — `geocodificado` é **obrigatório** no único lugar onde existe; nenhuma outra action é afetada; o cliente sabe que sempre recebe o booleano. Contras: novo tipo exportado (+1 símbolo).
- **Escolhida: B.** A invariante "sucesso de perfil sempre carrega o sinal de geocoding" deve ser garantida pelo tipo, não opcional. Isola a mudança de contrato a `salvarPerfil`, sem mexer no retorno das outras três actions (que `toEqual({ ok: true })` exato — Opção A as deixaria iguais, mas B nem as toca). `PerfilClient` segue compatível: `if (!resultado.ok)` discrimina, e no ramo `ok` o campo extra é ignorado até issue 009.

**D2 — Dois UPDATEs separados vs. um UPDATE único (endereço+coords).**
- Opção A — UPDATE único: montar perfil+endereço, geocodificar, e só então um único `update({...perfil, ...endereco, latitude, longitude})`. Prós: 1 ida ao banco; atomicidade natural. Contras: o salvamento do endereço fica **refém** do geocoding (I/O externo de até 5s + trava 1req/s). Se o util demora/falha, o lojista espera por algo não-essencial. Pior: dificulta a garantia "endereço salvo mesmo com geocoding falho" — qualquer exceção no caminho do geocoding abortaria o salvamento do endereço.
- Opção B — dois UPDATEs: (1) perfil+endereço (essencial, rápido); (2) par de coords (derivado, best-effort). Prós: o endereço é persistido **antes** de qualquer I/O externo; o 2º UPDATE só carrega o par e nunca bloqueia o resultado (`geocodificado:false` em falha). Casa com o princípio do `revalidarVitrine` (best-effort que não rebaixa sucesso). Contras: 2 idas ao banco; janela minúscula em que o endereço está salvo e as coords ainda não (irrelevante — coords são nullable e a feature trata loja sem coords como "raio ignorado", RN-3).
- **Escolhida: B.** O endereço é o dado primário; as coords são derivadas e não-bloqueantes. A separação torna a invariante "salvamento não falha por geocoding" estrutural, não dependente de try/catch fino. O 2º UPDATE também roda sob a mesma RLS (`lojas_update_proprio`, `.eq("id", loja.id)`), preservando o isolamento.

**D3 — Montagem da `consulta` para o Nominatim + endereço incompleto.**
- A `consulta` é montada por um helper local **puro** `montarConsultaGeocoding(dados)` que retorna `string | null`.
- **Regra de completude (gate):** geocodificar só faz sentido com âncora geográfica suficiente. Exigir **`endereco_cidade` E `endereco_estado`** como mínimo (cidade+UF resolvem para um ponto; sem eles o Nominatim retorna lixo ou nada). `endereco_cep`, `endereco_rua`, `endereco_numero`, `endereco_bairro` refinam quando presentes. Se faltar o mínimo → retorna `null` → caller grava o par NULL (resolve o ponto "endereço incompleto" do escopo).
- **Formato da string (mais específico → menos específico, separado por vírgula):** `"<rua>, <numero> - <bairro>, <cidade> - <estado>, <cep>, Brasil"`, omitindo partes ausentes e o "Brasil" fixo no fim para ancorar o país. Ex.: `"Av. Paulista, 1000 - Bela Vista, São Paulo - SP, 01310-100, Brasil"`. O CEP entra **sem hífen obrigatório** (o schema aceita as duas formas; manter como veio). `geocodificarEndereco` já faz `encodeURIComponent`.
  - Opção alternativa rejeitada: geocodificar **só pelo CEP**. Contras: CEP brasileiro no Nominatim/OSM tem cobertura irregular (muitos CEPs retornam centroide de cidade ou nada); endereço completo dá ponto melhor. Decisão: usar string rica; CEP é um reforço, não a chave única.
- **Decisão sobre coords órfãs (ponto explícito do escopo):** sempre que o endereço muda, o par de coords é **recomputado do zero** e reescrito (sucesso → novo par; `null`/incompleto → NULL). Nunca preservar coords antigas — coords antigas + endereço novo divergente = dado mentiroso. Como o 2º UPDATE sempre escreve `{latitude, longitude}` (com valores ou com NULL), as coords nunca ficam órfãs. **Sem branch de "manter coords antigas".**

**D4 — Correção do bug `endereco_uf` no teste.** O set `COLUNAS_PERMITIDAS` em `loja.test.ts` lista `endereco_uf`, que não é coluna real (é `endereco_estado`). A fase RED corrige o set para refletir as 6 colunas reais (`endereco_cep/rua/numero/bairro/cidade/estado`) **+ `latitude` + `longitude`** (agora a action escreve coords, então o assert "toda chave do patch ∈ permitidas" precisa aceitar lat/lng no patch do 2º UPDATE). Sem essa correção o teste de allowlist daria falso-verde/falso-vermelho.

**D5 — `latitude`/`longitude` no schema de ataque.** O teste de ataque deve provar que `salvarPerfil({...PERFIL_OK, latitude: 0, longitude: 0})` é rejeitado por `.strict()` antes de qualquer I/O (nenhum UPDATE, nenhum geocoding). Isto valida a Barreira 1. A Barreira 2 (allowlist) é validada porque o patch de endereço é montado coluna-a-coluna e nunca lê `dados.latitude`.

### Cenários

**Caminho feliz (endereço completo + geocoding ok):** payload válido com `endereco_cidade`/`endereco_estado` (e demais) → schema passa → UPDATE perfil+endereço → `montarConsultaGeocoding` retorna string → `geocodificarEndereco` retorna `{lat,lng}` → 2º UPDATE `{latitude,longitude}` → `{ ok:true, geocodificado:true }`.

**Bordas:**
- **Geocoding `null` (Nominatim fora do ar / timeout / sem UA / sem credenciais Upstash / limite 1req/s excedido):** o util retorna `null` por qualquer um desses (ver portões em `geocodificarEndereco.ts`). Endereço fica salvo; 2º UPDATE grava `{latitude:null, longitude:null}` → `{ ok:true, geocodificado:false }`. **Não bloqueia.**
- **Endereço incompleto (sem cidade+UF):** `montarConsultaGeocoding` retorna `null`; **não chama o Nominatim** (economiza a trava global); 2º UPDATE grava o par NULL → `{ ok:true, geocodificado:false }`.
- **Endereço removido (lojista apaga campos):** mesmo caminho do incompleto — par zerado para NULL (sem coords órfãs).
- **Sem nenhum campo de endereço no payload (só nome/slug):** allowlist não adiciona `endereco_*` ao patch (campos `undefined` não entram, padrão atual com `if (… !== undefined)`); `montarConsultaGeocoding` recebe tudo `undefined` → `null` → 2º UPDATE grava par NULL. Decisão: **sempre** rodar o 2º UPDATE para manter a invariante "coords coerentes com o endereço atual" (se o lojista tinha coords e removeu o endereço, zera). Aceitável: 1 UPDATE extra barato.
- **Slug ocupado por outra loja:** rejeitado antes de qualquer UPDATE (comportamento atual) → `{ ok:false, erro }`. Nenhum geocoding.
- **Sem loja do dono:** `{ ok:false, erro: ERRO_SEM_LOJA }`. Nenhum geocoding.
- **Race de duplo submit:** dois `salvarPerfil` concorrentes do mesmo dono — cada um faz seu par de UPDATEs sob RLS na própria linha; o último a escrever vence (last-write-wins). Sem corrupção: o par é sempre coerente com o endereço daquela chamada (CHECK garante o par). `verificarRateLimit("salvarPerfil")` (10/min) atenua spam.
- **Sessão expirada:** `buscarLojaDoDono` (RLS) retorna `null` → `{ ok:false, erro: ERRO_SEM_LOJA }`.
- **RLS (dono A × loja do dono B):** o 2º UPDATE roda no client autenticado com `.eq("id", loja.id)`, onde `loja` veio de `buscarLojaDoDono` (escopo `auth.uid()=dono_id`). Dono A nunca obtém o `id` da loja de B por essa via; mesmo se forjasse, `lojas_update_proprio` (`WITH CHECK auth.uid()=dono_id`) recusa a escrita.

**Tratamento de erro (§14):** qualquer exceção no fluxo de banco cai no `catch` existente → `console.error("salvarPerfil:", e)` (log no servidor) + `{ ok:false, erro: ERRO_GENERICO }`. Falha de geocoding **não é exceção** (o util engole tudo e retorna `null`), então nunca chega ao catch nem rebaixa o salvamento; vira apenas `geocodificado:false`. Nenhum stack trace, par de coords ou detalhe interno vaza ao cliente.

### Contratos de Dados

Sem mudança de schema nesta issue. Reusa o que a issue 001 entregou:

- Tabela `lojas`: `latitude float8 NULL`, `longitude float8 NULL`.
- CHECKs (rede final, issue 001): `lojas_coords_par_check` `((latitude is null) = (longitude is null))`; `lojas_latitude_range_check` `(-90..90)`; `lojas_longitude_range_check` `(-180..180)`.
- RLS reusada (sem alteração): `lojas_update_proprio` `USING/WITH CHECK (auth.uid() = dono_id)`.
- Tipos gerados: `database.types.ts` já contém `latitude/longitude: number | null` em `lojas` (Row/Insert/Update) e na view `vitrine_lojas` Row (que **não** projeta coords — confirmado; coords não vão à vitrine). **Não rodar `supabase gen types`** nesta issue (nada novo no banco).

### Recálculo no Servidor (derivação autoritativa)

Não há dinheiro, mas há **dado derivado autoritativo** — mesma classe de invariante:

| Campo | Cliente envia? | Servidor faz |
|---|---|---|
| `endereco_cep/rua/numero/bairro/cidade/estado` | ✅ (via `schemaPerfil`, validados por regex/trim) | grava na allowlist, coluna-a-coluna |
| `latitude` / `longitude` | ❌ **proibido** | **deriva do zero** via `geocodificarEndereco` a partir do endereço já gravado; cliente nunca influencia o valor. `.strict()` + allowlist rejeitam se enviados. |

### Arquivos a Criar / Modificar / NÃO tocar

**Modificar:**
- `src/lib/actions/loja.ts`
  - Novo tipo exportado `ResultadoPerfil = { ok: true; geocodificado: boolean } | { ok: false; erro: string }` (D1).
  - Helper local puro (nível módulo, sem `'use server'` exportado — é função interna, não exportada): `montarConsultaGeocoding(dados: { endereco_cidade?; endereco_estado?; endereco_cep?; endereco_rua?; endereco_numero?; endereco_bairro? }): string | null` (D3). Não exportar (Server Action só pode exportar funções async — ver MEMORY use-server-export-constraint).
  - `salvarPerfil`: assinatura passa a `Promise<ResultadoPerfil>`; estende a allowlist do `patch` com os 6 `endereco_*` (mesmo padrão `if (dados.X !== undefined) patch.X = dados.X`); após o 1º UPDATE, monta `consulta`, chama `geocodificarEndereco` quando `consulta !== null`, monta o par `coords` ({lat,lng} ou {null,null}); 2º `supabase.from("lojas").update(coords).eq("id", loja.id)` (propaga erro ao catch); retorna `{ ok:true, geocodificado }`.
  - `import { geocodificarEndereco } from "@/lib/utils/geocodificarEndereco";`.
- `src/lib/actions/loja.test.ts` (fase RED — escrita pelo `tdd` antes da implementação):
  - Mock de `@/lib/utils/geocodificarEndereco` (`vi.fn`, controlável por teste: resolve `{latitude,longitude}` ou `null`).
  - Ajustar o mock do `authedClient` para suportar **dois** UPDATEs encadeados (`.update().eq()` chamado 2×) e capturar ambos os patches (ex.: registrar todas as chamadas de `updatePatch`).
  - Corrigir `COLUNAS_PERMITIDAS`: trocar `endereco_uf` por `endereco_estado`; adicionar `latitude` e `longitude` (D4).
  - Ajustar asserções `expect(r).toEqual({ ok: true })` de `salvarPerfil` para `toEqual({ ok: true, geocodificado: ... })` (ou `toMatchObject`).
  - Novos casos (ver "Casos de teste" abaixo).

**Criar:** nenhum arquivo novo (reuso total — `montarConsultaGeocoding` é helper interno < 30 linhas, não justifica módulo próprio; é específico desta action).

**NÃO tocar (com motivo):**
- `src/lib/validacoes/loja.ts` — `schemaPerfil` já entregue pela issue 004; adicionar coords aqui é **proibido** (quebraria a Barreira 1).
- `src/lib/utils/geocodificarEndereco.ts` — assinatura `(consulta: string) => Promise<Coordenadas|null>` já é exatamente o necessário (issue 003).
- `supabase/migrations/*lojas_coordenadas.sql` — colunas/CHECKs já existem (issue 001).
- `src/app/(painel)/painel/configuracoes/perfil/PerfilClient.tsx` e `page.tsx` — UI/toast de geocoding falho + binding dos campos de endereço = issue 009. O contrato estendido é retrocompatível com o uso atual.
- `src/lib/database.types.ts` — nada novo no schema.

### Dependências Externas

Nenhuma nova. Reusa transitivamente (via `geocodificarEndereco.ts`, já instaladas pela issue 003): `@upstash/ratelimit`, `@upstash/redis`, `server-only`, e o env `NOMINATIM_USER_AGENT` + `UPSTASH_REDIS_REST_URL/TOKEN`. Docs: Nominatim usage policy (1 req/s, UA obrigatório) — https://operations.osmfoundation.org/policies/nominatim/.

### Ordem de Implementação

1. **Fase RED (`tdd`)** — escrever/estender `src/lib/actions/loja.test.ts`:
   - mock de `geocodificarEndereco`; mock do client autenticado com 2 UPDATEs; correção do set de colunas (D4).
   - casos novos (abaixo). Confirmar **vermelho real** rodando `pnpm test src/lib/actions/loja.test.ts` (a action ainda retorna `{ ok:true }` sem `geocodificado` e sem 2º UPDATE → falha).
   - Justificativa: crítica (RN-1/RN-2 + RLS) exige red-first; o teste de ataque (`latitude`/`longitude` no payload) precisa existir antes do código.
2. **Fase GREEN (`executar`)** — implementar em `loja.ts`: tipo `ResultadoPerfil`, `montarConsultaGeocoding`, allowlist estendida, 2º UPDATE, retorno. Mínimo para verde.
   - Depende de (1): sem o teste vermelho não há alvo.
3. **`next build`** — obrigatório: `salvarPerfil` é `'use server'`; exportar `const`/tipo errado quebra **só** no build (não em tsc/vitest) — ver MEMORY use-server-export-constraint. `ResultadoPerfil` deve ser `export type` (tipo, ok) e `montarConsultaGeocoding` **não** exportado.

### Checklist de Validação Pós-Implementação
- [ ] `pnpm build` (next build) sem warnings novos — valida a restrição `'use server'`.
- [ ] `pnpm test src/lib/actions/loja.test.ts` verde.
- [ ] RLS testada (mock): 2º UPDATE escopado por `.eq("id", loja.id)` com `loja` de `buscarLojaDoDono` (RLS) — dono A não alcança loja de B.
- [ ] Ataque RN-1: payload com `latitude`/`longitude` → `safeParse` falha → nenhum UPDATE, nenhum geocoding (`{ ok:false }`).
- [ ] Par tudo-ou-nada: geocoding ok → `{latitude:n, longitude:n}`; geocoding null / incompleto → `{latitude:null, longitude:null}` no patch do 2º UPDATE.
- [ ] Geocoding null não rebaixa salvamento: endereço persiste, retorno `{ ok:true, geocodificado:false }`.
- [ ] Nenhum secret no client; falha de geocoding não vaza detalhe (util engole; catch genérico).

### Casos de teste (fase RED)
1. **Geocoding ok → par + `geocodificado:true`:** payload com endereço completo (`endereco_cidade`/`endereco_estado` etc.); mock `geocodificarEndereco` → `{latitude:-23.56, longitude:-46.65}`. Assert: 2 UPDATEs; 2º patch == `{latitude:-23.56, longitude:-46.65}`; retorno `{ ok:true, geocodificado:true }`; `geocodificarEndereco` chamado com string contendo cidade e UF.
2. **Geocoding null → par NULL + `geocodificado:false`:** mesmo payload; mock → `null`. Assert: 2º patch == `{latitude:null, longitude:null}`; retorno `{ ok:true, geocodificado:false }`; endereço (1º UPDATE) persistido normalmente.
3. **Endereço incompleto (sem cidade/UF) → não chama Nominatim, par NULL:** payload só com `nome/slug` (ou só `endereco_rua`). Assert: `geocodificarEndereco` **não** chamado; 2º patch == `{latitude:null, longitude:null}`; `{ ok:true, geocodificado:false }`.
4. **Ataque payload com `latitude`/`longitude` → rejeitado (Barreira 1):** `salvarPerfil({...PERFIL_OK, endereco_cidade:"São Paulo", endereco_estado:"SP", latitude:0, longitude:0})`. Assert: `{ ok:false }`; nenhum `updatePatch`; `geocodificarEndereco` não chamado.
5. **Allowlist (Barreira 2):** payload válido com endereço; assert que todo `updatePatch` (ambos) só contém chaves ∈ `COLUNAS_PERMITIDAS` (corrigido p/ `endereco_estado` + `latitude` + `longitude`) e nenhuma ∈ `COLUNAS_PROIBIDAS`.
6. **RLS dono A ≠ loja dono B:** `buscarLojaDoDono` resolve `{id: LOJA_ID, dono_id: USER_ID}`; assert que **ambos** os UPDATEs encadeiam `.eq("id", LOJA_ID)` (nunca um id de terceiro) — o escopo da escrita vem da loja resolvida sob RLS, não do payload.
7. **Regressão de contrato:** `salvarHorarios`/`salvarTema`/`definirPublicacao` continuam `toEqual({ ok: true })` (não afetados por D1).
