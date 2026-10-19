# Plano técnico · formas de frete (325) + gravação com versão (328) + remoção do código de zona (327)
gerado: arquitetar · 2026-10-18 · loop: `plan/loop-formas-de-frete.md` (P1) · branch: `feat/325-327-328-formas-de-frete`

Decisões do Pedido (fechadas, não reabertas aqui): uma forma por loja; trocar de forma substitui as zonas da
forma anterior; faixas de km (`raio_km`) é a forma marcada por padrão (loja sem zonas ou com tipos
misturados); nada é apagado até a primeira gravação; 325-backend + 328 + remoção das actions por zona são um
vetor só; as telas CEP/bairro não reaproveitam as actions por zona; migration expand-only (a assinatura de 3
argumentos de `salvar_faixas_entrega` continua existindo neste PR).

---

## 0. Diagnóstico

**Causa raiz.** A escrita das zonas de entrega de uma loja não tem dono único nem estado de referência.
Hoje há dois caminhos de escrita com contratos incompatíveis: a RPC em lote `salvar_faixas_entrega`, que
apaga TODAS as zonas da loja e regrava só `raio_km`
(`supabase/migrations/20260930120000_rpc_salvar_faixas_entrega_ativo.sql:124-150`), e as actions por zona
(`src/lib/actions/entrega.ts:113-309`, `src/app/admin/assinantes/actions/admin-entrega.ts:132-310`), que
gravam zona a zona sem atomicidade. Nenhum dos dois sabe o que o gravador viu antes de gravar. A invariante
violada é esta: **toda gravação do conjunto de zonas de uma loja substitui o conjunto inteiro, numa forma só,
e só se o conjunto no banco ainda é o que o gravador leu.** Sem ela, (a) a 325 não tem como voltar CEP/bairro
sem que uma gravação de km apague o resto calada, e (b) a 328 acontece: a última aba a gravar desfaz a outra.

**Por que é complexo.**
- Contrato compartilhado por dois mundos: lojista (client autenticado, RLS) e admin (`service_role`, sem RLS).
  O escopo por loja do admin depende só do filtro `loja_id = p_loja_id` dentro da RPC
  (`references/seguranca.md:485-505`).
- Valor de frete: o que é gravado é o que a vitrine cobra. `calcularFrete` escolhe a MENOR taxa entre
  candidatas `bairro`/`faixa_cep` (`src/lib/utils/calcularFrete.ts:168-174`), então zona esquecida, bairro
  repetido ou faixa de CEP sobreposta barateia o frete sem aviso.
- Concorrência: o salvamento automático por blur (`src/components/painel/TabelaFaixasEntrega.tsx:383-400`)
  multiplica gravações; a proteção precisa ser no banco (compare-and-set), não no cliente.
- Expand/contract: a produção atual chama a assinatura de 3 argumentos até o deploy.

**O que seria remendo (rejeitado).** (a) Reaproveitar `criarZona`/`atualizarZona` para CEP/bairro: não são
atômicas, não carregam versão e não apagam a forma anterior; uma faixa km esquecida segue ativa e
`calcularFrete.ts:168-174` cobra a menor taxa. (b) Três RPCs com o mesmo bloco de posse + versão + delete
copiado: o mesmo invariante em três lugares. (c) Comparar versão no cliente: contornável e sujeito a corrida
entre ler e gravar.

---

## 1. RPC nova: uma só, `public.salvar_zonas_entrega`, com `p_forma`

### Assinatura

```sql
create function public.salvar_zonas_entrega(
  p_loja_id uuid,    -- da Server Action (buscarLojaDoDono / lojaId admin validado), NUNCA do payload
  p_versao  bigint,  -- versão lida junto das zonas (§2); compare-and-set
  p_forma   text,    -- 'raio_km' | 'faixa_cep' | 'bairro'
  p_dados   jsonb    -- objeto; shape por forma (abaixo)
) returns bigint     -- a versão NOVA (p_versao + 1)
language plpgsql
security invoker
set search_path = public, pg_temp
```

`revoke all on function public.salvar_zonas_entrega(uuid, bigint, text, jsonb) from public, anon;`
`grant execute on function public.salvar_zonas_entrega(uuid, bigint, text, jsonb) to authenticated, service_role;`
(mesmo par de `20260930120000_rpc_salvar_faixas_entrega_ativo.sql:159-160`).

### Por que uma RPC com `p_forma`, e não três

| | (a) três RPCs (`..._km`, `..._cep`, `..._bairro`) | (b) uma RPC com `p_forma` (escolhida) |
|---|---|---|
| T2 posse, T4 versão, delete escopado | copiados 3× (~40 linhas de trava cada) | um bloco só |
| Exclusividade de forma | depende de cada RPC lembrar de apagar os outros tipos | o `delete ... where loja_id = p_loja_id` é um só e roda para qualquer forma |
| Auditoria | três superfícies | uma superfície |
| Custo | T1/T3 sem `case` | T1/T3 com `case p_forma`; função maior (~230 linhas) |
| Tipos gerados | três `Args` | um `Args`, `p_dados: Json` |

O que pesa é o invariante da §0: posse, versão e exclusividade valem para toda gravação de zonas. Em (a) essas
travas ficam repetidas em N caminhos, o sinal de remendo da seção "Causa raiz". Nome novo, não uma sobrecarga
de `salvar_faixas_entrega`: PostgREST resolve sobrecarga pelos nomes dos argumentos, e `supabase gen types`
gera união de `Args`. Um nome novo deixa o contract (§9) como um `drop function` limpo.

### Shape de `p_dados` por forma (o cliente manda só isto; o resto o servidor deriva)

```jsonc
// raio_km — idêntico ao p_incremento/p_faixas de hoje
{ "incremento": 1 | 2, "faixas": [ { "taxa": 4, "pedido_minimo_gratis": null, "ativo": true } ] }
// faixa_cep — CEP como inteiro de 8 dígitos (01000-000 → 1000000), igual a taxas_entrega.cep_*
{ "faixas": [ { "cep_inicio": 1000000, "cep_fim": 1999999, "taxa": 5, "pedido_minimo_gratis": null, "ativo": true } ] }
// bairro — um grupo = uma zona tipo 'bairro' com N bairros e um preço
{ "grupos": [ { "bairros": ["Centro", "Vila Nova"], "taxa": 6, "pedido_minimo_gratis": 80, "ativo": true } ] }
```

Chaves extras dentro de `p_dados` ou dos itens (`nome`, `tipo`, `loja_id`, `raio_max_km`, `id`) são
**ignoradas** pela RPC. O precedente é a D2 da 326 (`20260930120000_...:17-18`). A recusa de chave extra é
do zod `.strict()` na action (§5). A RPC deriva `tipo` de `p_forma`, `loja_id` de `p_loja_id` e o `nome` como
abaixo.

### Ordem das travas (cada uma antes de qualquer escrita)

1. **T1 · forma do pedido.**
   - `p_forma` fora de `('raio_km','faixa_cep','bairro')` ⇒ `forma invalida`.
   - `p_versao is null or p_versao < 0` ⇒ `versao invalida`.
   - `p_dados is null or jsonb_typeof(p_dados) <> 'object'` ⇒ `dados invalidos`.
   - raio_km: `incremento` ∉ {1,2} ⇒ `incremento invalido`; `faixas` não é array ⇒ `faixas invalidas`;
     mais de 30 ⇒ `lista acima do teto`.
   - faixa_cep: `faixas` não é array ⇒ `faixas invalidas`; mais de 50 ⇒ `lista acima do teto`.
   - bairro: `grupos` não é array ⇒ `grupos invalidos`; mais de 30 grupos, grupo com mais de 100 bairros ou
     mais de 300 bairros no total ⇒ `lista acima do teto`.
2. **T2 · posse**, copiada de `20260930120000_...:43-47` e `:73-82`. Via de serviço pelos dois sinais em
   conjunção (`coalesce(auth.role(),'') = 'service_role'` E `current_setting('role', true)` fora de
   `authenticated`/`anon`) OU `exists (select 1 from lojas where id = p_loja_id and dono_id = auth.uid())`.
   Senão ⇒ `sem posse`. Roda antes de T3 e T4: um `p_loja_id` alheio recebe `sem posse` e nunca descobre se a
   versão bate.
3. **T3 · valor por item**, sobre TODOS os itens antes da primeira escrita (regras na §4).
4. **T4 · versão (compare-and-set)**, a primeira escrita:
   ```sql
   update public.lojas
      set versao_zonas_entrega = versao_zonas_entrega + 1
    where id = p_loja_id
      and versao_zonas_entrega = p_versao
   returning versao_zonas_entrega into v_nova;
   if not found then
     raise exception 'salvar_zonas_entrega: versao desatualizada';
   end if;
   ```
   Isto é correto sob concorrência real. O `UPDATE` trava a linha de `lojas`. Uma segunda transação com a
   mesma `p_versao` espera o commit da primeira. Em READ COMMITTED o Postgres então reavalia o `WHERE` na
   versão nova da linha, acha 0 linhas e cai em `versao desatualizada`. A trava de linha também serializa o
   delete+insert de duas gravações da mesma loja. A exceção desfaz a transação inteira (zonas e versão).
5. **Escrita.** `delete from public.zonas_entrega where loja_id = p_loja_id;` remove todos os tipos, com
   cascata em `taxas_entrega`/`bairros_zona`. Isso é a exclusividade de forma. O delete vem com escopo
   explícito além da RLS, como em `20260930120000_...:125-126`. Depois insere só o `tipo = p_forma`:
   - raio_km: corpo de `20260930120000_...:128-150` (teto = posição × incremento, nome `'%s–%s km'`, `ativo`
     recebido).
   - faixa_cep: itens em ordem de `cep_inicio`. Zona `nome = format('CEP %s a %s', m(ini), m(fim))`, com
     `m(x) = substr(lpad(x::text,8,'0'),1,5) || '-' || substr(lpad(x::text,8,'0'),6,3)`. Taxa com
     `cep_inicio`/`cep_fim`, `raio_max_km = null`.
   - bairro: uma zona por grupo, na ordem recebida. `nome` = primeiro bairro (aparado, espaços colapsados) +
     `format(' e mais %s', n-1)` se n > 1. Taxa com raio/cep `null`. Uma linha `bairros_zona` por bairro, com o
     nome aparado e espaços internos colapsados: é o nome de exibição, não o normalizado.
6. `return v_nova;`

### Mensagens de erro estáveis (P0001, prefixo `salvar_zonas_entrega: `)

`forma invalida` · `versao invalida` · `dados invalidos` · `incremento invalido` · `faixas invalidas` ·
`grupos invalidos` · `lista acima do teto` · `sem posse` · `taxa invalida` · `gratis invalido` ·
`ativo invalido` · `faixa ativa depois de desligada` · `cep invalido` · `faixa de cep invertida` ·
`faixas de cep sobrepostas` · `bairro invalido` · `grupo sem bairro` · `bairro repetido` ·
`versao desatualizada`.
Os testes afirmam SQLSTATE **e** fragmento da mensagem (memória "SQLSTATE não basta em teste de escopo").

### Migration

`supabase/migrations/20261018120000_zonas_entrega_versao_e_formas.sql`. O último arquivo é
`20261008120000_rpc_modal_sazonal_via_servico.sql`. Conteúdo, nesta ordem: (1) coluna da §2 + `comment on
column`; (2) `create function public.salvar_zonas_entrega` (`create`, não `create or replace`: o nome é novo);
(3) revoke/grant. **Não toca** `salvar_faixas_entrega(uuid, integer, jsonb)` nem `criar_pedido` (gate F6).
Cabeçalho no padrão de `20260930120000_...:1-31`, com ROLLBACK manual:
`drop function public.salvar_zonas_entrega(uuid,bigint,text,jsonb); alter table public.lojas drop column versao_zonas_entrega;`.
O rollback só vale antes de algum deploy que dependa da função.

---

## 2. Onde mora a versão: `lojas.versao_zonas_entrega`

```sql
alter table public.lojas
  add column versao_zonas_entrega bigint not null default 0
  constraint lojas_versao_zonas_entrega_nao_negativa check (versao_zonas_entrega >= 0);
comment on column public.lojas.versao_zonas_entrega is
  'Controle otimista das zonas de entrega (issue 328). Incrementada SÓ por salvar_zonas_entrega (compare-and-set). Não é billing nem PII: fora do trigger lojas_protege_billing.';
```
`add column` com default constante não reescreve a tabela (PG ≥ 11). Loja existente e loja nova nascem em 0.

**Alternativas.**
- (a) Contador em `lojas` (escolhida): uma linha por loja, a própria linha serve de trava (T4), leitura vem
  junto das zonas num select só (abaixo).
- (b) Maior `atualizado_em` das zonas: `zonas_entrega` não tem a coluna (`references/schema.md:270-277`), e
  lista vazia não tem data. Não serve.
- (c) Tabela `versoes_zonas_entrega`: a RPC INVOKER do lojista precisaria de política de escrita nela, o que
  não traz ganho sobre (a) e custa uma tabela e uma RLS a mais.

**Trigger `lojas_protege_billing` não bloqueia.** O `UPDATE` da RPC roda como `authenticated` (INVOKER) para o
lojista. O trigger só recusa quando muda alguma das colunas listadas em
`20260708120000_lojas_protege_billing_v4_consentimento.sql:76-93`, e `versao_zonas_entrega` não está entre
elas. Para `service_role` o trigger retorna cedo (`:41-45`). Os outros triggers de `lojas` são `update of
dono_id` / `update of logo_url` e não disparam com um `SET` só desta coluna. A política
`lojas_update_proprio` (`20260614001000_rls_lojas.sql:35-38`) permite o UPDATE do dono.

**Nenhuma escrita de `lojas` sobrescreve a coluna.** Todas usam allowlist:
- `loja.ts:92` usa `montarPatchPerfil`; `:217` grava `{ horarios }`; `:242` grava `{ tema }`.
- `entrega.ts:54` usa `montarPatchModalidades`.
- `vendas.ts:36` usa `montarPatchCiclo`.
- `logo.ts:104,132` gravam só `logo_url`.
- Os webhooks gravam patches próprios.
- O admin passa por `escopo.atualizarLoja`, que só remove `CAMPOS_LOJA_SOMENTE_SERVIDOR`
  (`src/lib/actions/admin-loja.ts:205-213`).

O P3 inclui `"versao_zonas_entrega"` em `CAMPOS_LOJA_SOMENTE_SERVIDOR` (`admin-loja.ts:51-71`) e na lista
fixa de `src/lib/actions/admin-loja.test.ts:292-308`. Isso barra por tipo e em runtime qualquer patch admin
futuro que tente escrever a coluna.

**Escrita direta pelo dono (PATCH PostgREST com o próprio JWT): aceita, sem trigger.** Um trigger não
distingue o `UPDATE` da RPC INVOKER (também `authenticated`) de um PATCH direto sem uma flag de sessão. Essa
flag teria de ser forjável só por `set_config`, o que acrescenta complexidade sem ganho. O efeito fica na
própria loja e só desliga a proteção contra o próprio dono, que já pode regravar as próprias zonas quando
quiser. Não cruza loja e não muda valor. O P8 registra isso em `seguranca.md` como risco aceito.

**Leitura atômica de versão + zonas.** A versão precisa ser lida **no mesmo snapshot** das zonas, ou antes
delas. Se as zonas forem lidas antes da versão, uma gravação no meio deixa a tela com zonas velhas e versão
nova, e a próxima gravação passa por cima. A admin page hoje usa `Promise.all`
(`src/app/admin/assinantes/[lojaId]/configuracoes/entregas/page.tsx:22-26`), sem ordem garantida. A solução
é uma consulta só, nova em `src/lib/supabase/queries/entregaPagamento.ts`:

```ts
export type ZonasEdicao = { versao: number; zonas: ZonaVitrine[] };
export async function listarZonasParaEdicao(client: Client, lojaId: string): Promise<ZonasEdicao>
// client.from("lojas")
//   .select("versao_zonas_entrega, zonas:zonas_entrega(id, nome, tipo, ativo, taxa:taxas_entrega(taxa, pedido_minimo_gratis, raio_max_km, cep_inicio, cep_fim), bairros:bairros_zona(nome))")
//   .eq("id", lojaId).maybeSingle()
// erro → throw (§14); null → throw new Error("loja não encontrada") (o caller já provou a loja)
```
Um select com embed é **um** statement SQL, portanto um snapshot. A hidratação (`taxa` array → objeto,
`bairros ?? []`) sai de `listarZonasComTaxas` (`entregaPagamento.ts:49-58`) para uma função local
`hidratarZona`, usada pelas duas. `listarZonasComTaxas` continua igual para vitrine e pedido
(`src/lib/actions/pedido.ts:198`). Para o lojista, `lojas` é legível pela RLS de leitura própria
(`queries/lojas.ts:59-66`) e as zonas, inclusive inativas, por `zonas_escrita_propria` (`for all`,
`20260614002000_rls_catalogo.sql:116-129`). O admin usa `svc`.

---

## 3. Forma ativa: derivada do `tipo` das zonas, sem coluna nova

Módulo puro novo `src/lib/utils/formaFrete.ts`, com teste ao lado:

```ts
export const FORMAS_FRETE = ["raio_km", "faixa_cep", "bairro"] as const;
export type FormaFrete = (typeof FORMAS_FRETE)[number];
export type FormaGravada = FormaFrete | "nenhuma" | "mista";
export const ROTULO_FORMA: Record<FormaFrete, string> =
  { raio_km: "Faixas de distância (km)", faixa_cep: "Faixas de CEP", bairro: "Bairros" };
/** [] → "nenhuma"; todos do mesmo tipo → esse tipo; tipos diferentes → "mista". Conta zonas inativas também (elas saem na próxima gravação). */
export function formaGravadaDasZonas(zonas: ReadonlyArray<{ tipo: string }>): FormaGravada;
/** Forma marcada ao abrir: a gravada; "nenhuma" e "mista" → "raio_km" (decisão do Pedido). */
export function formaInicialDaTela(gravada: FormaGravada): FormaFrete;
/** Primeira gravação nesta forma substitui algo que vale hoje? */
export function precisaConfirmarSubstituicao(
  formaEditor: FormaFrete, gravada: FormaGravada, kmForaDoFormato: boolean,
): boolean; // gravada !== "nenhuma" && (gravada !== formaEditor || (formaEditor === "raio_km" && kmForaDoFormato))
```

- Tipo desconhecido não acontece: `zonas_entrega.tipo` tem CHECK (`references/schema.md:274`).
- Loja "mista" (legado): abre em km. O editor de km já cai no cartão de legado (`lerFaixas` →
  `modo: "legado"`, `src/lib/utils/faixasEntrega.ts:75-102`; card em `TabelaFaixasEntrega.tsx:509-524`).
  Nada é gravado ao abrir. A primeira gravação em qualquer forma pede confirmação e substitui tudo.
- `kmForaDoFormato` = `!zonasJaSaoFaixas(zonas)` (`faixasEntrega.ts:130-132`). Preserva a confirmação D4 da
  326 (`TabelaFaixasEntrega.tsx:309,394-397`) para raio_km legado fora do formato da RPC.
- **Por que não uma coluna `lojas.forma_frete`:** seria uma segunda fonte de verdade com o `tipo` das zonas.
  Elas divergiriam com qualquer escrita direta ou legado, e a vitrine continuaria cobrando pelo `tipo`
  (`calcularFrete.ts:72-98`). A forma já é um fato das zonas.

---

## 4. T3 por forma: regras de valor, nas duas camadas

Regras comuns aos itens das três formas. Copiadas de `20260930120000_...:87-113`.
- `taxa`: `jsonb_typeof = 'number'`, ≥ 0, `= round(x, 2)` ⇒ senão `taxa invalida`. Zod: `valorFrete`
  (`src/lib/validacoes/entrega.ts:29`).
- `pedido_minimo_gratis`: ausente/null, ou número ≥ 0 com 2 casas ⇒ senão `gratis invalido`. Zod:
  `valorFrete.nullable()`.
- `ativo`: boolean JSON obrigatório, sem coerção ⇒ senão `ativo invalido`. Zod: `z.boolean()`.

| forma | regra | RPC (autoridade final) | zod `schemaZonasEntrega` (autoridade da action, gate da tela) |
|---|---|---|---|
| raio_km | ativas em prefixo | `faixa ativa depois de desligada` (`20260930120000_...:115-121`) | `refinarPrefixo`, extraído de `entrega.ts:141-152` |
| raio_km | teto | 30 | `TETO_FAIXAS_ENTREGA` (`entrega.ts:122`) |
| faixa_cep | CEP de 8 dígitos | `cep_inicio`/`cep_fim` com `jsonb_typeof = 'number'`, inteiro (`x = trunc(x)`), entre 0 e 99999999, ⇒ senão `cep invalido` | `z.number().int().min(0).max(99999999)`. A tela converte com `cepParaInteiro`, que exige 8 dígitos (`src/components/painel/payloadZona.ts:32-38`) |
| faixa_cep | início ≤ fim | `faixa de cep invertida` (espelha o CHECK `taxas_faixa_cep_coerente`, `references/schema.md:290-297`) | superRefine, mensagem "O CEP final deve ser maior ou igual ao CEP inicial.", path `["faixas", i, "cep_fim"]` |
| faixa_cep | sem sobreposição | ordena por `cep_inicio`; item com `cep_inicio <= cep_fim` do anterior ⇒ `faixas de cep sobrepostas`. Faixas encostadas (fim 01999-999, início 02000-000) passam. Vale para ativas e desligadas: a desligada pode voltar | superRefine "A faixa de {a} a {b} cruza com a de {c} a {d}. Ajuste uma delas.", path `["faixas", j, "cep_inicio"]` (j = a que cruza, na ordem recebida) |
| faixa_cep | teto | 50 | `TETO_FAIXAS_CEP = 50` |
| bairro | bairro não vazio | elemento string, normalizado não vazio, ≤ 120 caracteres aparado ⇒ senão `bairro invalido` | `z.string().trim().min(1).max(120)` |
| bairro | grupo com bairro | `bairros` array com ≥ 1 ⇒ senão `grupo sem bairro` | `.min(1)`, mensagem "Adicione pelo menos um bairro a este preço." |
| bairro | sem repetição | normalização SQL (abaixo) sobre TODOS os bairros de TODOS os grupos; repetido ⇒ `bairro repetido` | superRefine com **`normalizarBairro`** (`src/lib/utils/calcularFrete.ts:62-69`), a MESMA função do casamento na vitrine (`:75-80`). Mensagem "{bairro} já está em outro preço." |
| bairro | tetos | 30 grupos, 100 bairros por grupo, 300 no total | `TETO_GRUPOS_BAIRRO = 30`, `TETO_BAIRROS_POR_GRUPO = 100`, `TETO_BAIRROS_TOTAL = 300` |

**Normalização de bairro no SQL.** A vitrine casa o bairro canônico do ViaCEP
(`src/lib/utils/resolverCepServidor.ts:98`) com `normalizarBairro`. A sequência é trim → NFD → remove
diacríticos → lowercase → colapsa espaços (`calcularFrete.ts:62-69`). Espelho em SQL:
```sql
lower(regexp_replace(btrim(regexp_replace(normalize(x, NFD), '[̀-ͯ]', '', 'g')), '\s+', ' ', 'g'))
```
Conferido no pglite (PG 18.3): `'  Jardim   São  José '` → `'jardim sao jose'`. `normalize()` existe desde o
PG 13 e exige banco UTF8, que é o caso do Supabase. Não usa a extensão `unaccent`: ela não é carregada pelo
helper `tests/helpers/pglite.ts` e não aparece em nenhuma migration.

Divergência conhecida: o JS remove `\p{Diacritic}`, conjunto mais largo que U+0300–036F. O `\s` do JS inclui
NBSP. As duas diferenças só aparecem com caracteres fora do português comum. Por isso a checagem **exata** é a
do zod na action, a camada que todo caminho da aplicação atravessa. A RPC é rede de proteção para chamada
direta ao PostgREST, que só alcança a própria loja.

**Por que recusar repetição e sobreposição em vez de aceitar.** Com dois casamentos para o mesmo endereço,
`calcularFrete.ts:168-174` cobra a MENOR taxa, e a configuração barateia o frete sem ninguém ver. Recusar
mantém um preço só por endereço.

---

## 5. Contrato das Server Actions (lojista e admin) e do zod

### zod: `src/lib/validacoes/entrega.ts`

- Extrair `refinarPrefixo(dados, ctx)` do superRefine de `schemaFaixasEntrega` (`:141-152`). Extrair também
  `camposKm = { incremento: ..., faixas: z.array(schemaFaixaEntrega).max(TETO_FAIXAS_ENTREGA) }`.
  `schemaFaixasEntrega` passa a ser `z.object(camposKm).strict().superRefine(refinarPrefixo)`, com o mesmo
  comportamento. A tela de km usa ele como gate em `TabelaFaixasEntrega.tsx:191`.
- Novos itens: `schemaFaixaCep` (`cep_inicio`, `cep_fim`, `taxa`, `pedido_minimo_gratis`, `ativo`, `.strict()`)
  e `schemaGrupoBairros` (`bairros`, `taxa`, `pedido_minimo_gratis`, `ativo`, `.strict()`).
- Gates sem versão para a tela: `schemaFaixasCep = z.object({ faixas }).strict().superRefine(refinarCep)` e
  `schemaGruposBairro = z.object({ grupos }).strict().superRefine(refinarBairros)`.
- Autoridade da action:
  ```ts
  const versaoZonas = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
  export const schemaZonasEntrega = z.discriminatedUnion("forma", [
    z.object({ forma: z.literal("raio_km"),   versao: versaoZonas, ...camposKm    }).strict().superRefine(refinarPrefixo),
    z.object({ forma: z.literal("faixa_cep"), versao: versaoZonas, ...camposCep   }).strict().superRefine(refinarCep),
    z.object({ forma: z.literal("bairro"),    versao: versaoZonas, ...camposBairro }).strict().superRefine(refinarBairros),
  ]);
  export type DadosZonasEntrega = z.infer<typeof schemaZonasEntrega>;
  export type DadosZonasSemVersao = DadosZonasEntrega extends infer D ? (D extends unknown ? Omit<D, "versao"> : never) : never;
  ```
  Verificado no zod 4.4 instalado (`package.json`: `"zod": "^4.4.3"`): `discriminatedUnion` aceita opções com
  `.strict().superRefine()`; o refine dispara, chave extra é recusada e o caso válido passa.
- Funções puras de contrato, importadas pelas duas actions. Não podem morar no arquivo `'use server'`, que só
  exporta funções async:
  ```ts
  export const MENSAGEM_CONFLITO_ZONAS =
    "Recarregue a página para ver as entregas atuais: elas foram alteradas em outra aba ou por outra pessoa, e esta mudança não foi salva.";
  /** p_dados da RPC: o payload sem forma/versao, no shape da §1. */
  export function argsSalvarZonas(d: DadosZonasEntrega): { p_versao: number; p_forma: FormaFrete; p_dados: Json };
  /** P0001 + fragmento 'versao desatualizada' (contrato estável da §1). */
  export function ehConflitoDeVersao(error: { code?: string; message?: string } | null): boolean;
  ```
- **Remover** `schemaZona`, `schemaTaxa`, `schemaBairro`, `schemaZonaCompleta` (`:13-17`, `:31-67`,
  `:156-186`). Ficam órfãos com a §6. `cepInteiro` (`:21`) é substituído pelo CEP do `schemaFaixaCep`.
  Atualizar o cabeçalho (`:1-8`).

### Lojista: `src/lib/actions/entrega.ts`

```ts
export type ResultadoZonas =
  | { ok: true; versao: number }
  | { ok: false; erro: string; conflito?: true };
export async function salvarZonasEntrega(payload: unknown): Promise<ResultadoZonas>
```
1. `schemaZonasEntrega.safeParse(payload)`. Falha ⇒ `{ ok:false, erro: primeira issue custom ?? "Confira as
   zonas de entrega." }`, sem nenhuma I/O. O padrão é `entrega.ts:40-44`.
2. `createClient()` (autenticado) → `buscarLojaDoDono` → `null` ⇒ `{ ok:false, erro:"Loja não encontrada." }`.
3. Uma chamada `supabase.rpc("salvar_zonas_entrega", { p_loja_id: loja.id, ...argsSalvarZonas(parsed.data) })`.
4. `ehConflitoDeVersao(error)` ⇒ `console.warn("[salvarZonasEntrega] conflito de versão")`, sem detalhe;
   `{ ok:false, conflito:true, erro: MENSAGEM_CONFLITO_ZONAS }`; sem `revalidatePath`.
5. Outro `error` ⇒ `console.error("[salvarZonasEntrega]", error)`; `{ ok:false, erro:"Não foi possível salvar
   as zonas de entrega." }`.
6. `data` que não é inteiro seguro ⇒ tratar como 5 (defensivo).
7. Sucesso ⇒ `revalidatePath(ROTA)`, `revalidatePath("/loja/[slug]", "page")` (`entrega.ts:100-101`);
   `{ ok:true, versao: data }`.
8. `catch` ⇒ genérica (`entrega.ts:103-106`).

`ResultadoEntrega` (`:25`) continua para `salvarModalidadesEntrega`.

### Admin: `src/app/admin/assinantes/actions/admin-entrega.ts`

```ts
export async function salvarZonasEntregaAdmin(lojaId: string, payload: unknown): Promise<ResultadoZonas>
```
A ordem fail-closed copia `:93-130`:
1. `validarLojaIdAdmin` ⇒ `{ ok:false, erro:"Loja inválida." }`.
2. zod ⇒ `"Dados inválidos."` (ou a mensagem custom), sem elevar privilégio.
3. `prepararContextoAdmin(loja.lojaId)` **fora do try**: a falha propaga.
4. `svc.rpc("salvar_zonas_entrega", { p_loja_id: loja.lojaId, ...argsSalvarZonas(d) })`.
5. Conflito ⇒ `{ ok:false, conflito:true, erro: MENSAGEM_CONFLITO_ZONAS }`, **sem** `registrarAcessoAdmin`.
6. Sucesso ⇒ `registrarAcessoAdmin(svc, { lojaId, acao: "salvar_zonas_entrega", metadados: { forma, itens } })`,
   onde `itens` é o número de faixas ou grupos. `admin_acessos.acao` é texto livre
   (`20260707122000_admin_acessos.sql:24`). Depois `revalidarLojaAdmin(lojaId)` e `{ ok:true, versao }`.

O tipo `ResultadoZonas` é importado com `import type` de `@/lib/actions/entrega`: tipo não atravessa a
fronteira `'use server'`.

### Leitura

- Painel `page.tsx`: `buscarLojaDoDono` (modalidades, `taxa_entrega_fora_zona`, coordenadas) +
  `listarZonasParaEdicao(supabase, loja.id)`.
- Admin: `carregarZonasAdmin(lojaId): Promise<ZonasEdicao>` (`carga.ts:134-146`) chama
  `listarZonasParaEdicao(svc, idValidado)`. O `Promise.all` da page pode ficar, porque a atomicidade agora está
  dentro de um statement.

---

## 6. O que sai na 327 (lista exata) e o que fica

**Funções e componentes (P3):**
- `src/lib/actions/entrega.ts`: `salvarZona` (`:109-136`, inclusive o bloco de comentário), `criarZona`
  (`:138-194`), `atualizarZona` (`:196-266`), `alternarZonaAtiva` (`:268-289`), `removerZona` (`:291-309`) e
  **`salvarFaixasEntrega` (`:69-107`)**: grava pela assinatura de 3 argumentos, sem versão. Sai também o
  import de `schemaZona`/`schemaZonaCompleta`/`schemaFaixasEntrega` (`:15-20`). Cabeçalho `:3-12` reescrito.
- `src/app/admin/assinantes/actions/admin-entrega.ts`: `criarZonaAdmin` (`:132-187`), `atualizarZonaAdmin`
  (`:189-253`), `removerZonaAdmin` (`:255-281`), `alternarZonaAtivaAdmin` (`:283-310`) e
  **`salvarFaixasEntregaAdmin` (`:86-130`)**. Sai o import de `schemaZonaCompleta`/`schemaFaixasEntrega`
  (`:32-36`). Cabeçalho `:3-24` reescrito.
- `src/components/painel/FormZona.tsx`: arquivo inteiro. O P4 lê de
  `git show main:src/components/painel/FormZona.tsx`.
- `src/components/painel/payloadZona.ts`: saem `EntradaPayloadZona` (`:11-21`) e `montarPayloadZona`
  (`:47-68`). Cabeçalho `:1-8` reescrito.
- `src/lib/validacoes/entrega.ts`: schemas da §5 ("Remover").

**Testes (P3):**
- `src/lib/actions/entregaPagamento.test.ts`: import `:86` e bloco `describe("salvarZona ...")` `:100-139`.
  Cabeçalho `:5-16` passa a citar só pagamento.
- `src/lib/actions/entrega.faixas.test.ts`: arquivo inteiro. Substituído por `entrega.zonas.test.ts` (§8).
- `src/app/admin/assinantes/actions/admin-entrega.test.ts`: imports `:167-170`, blocos `:194-394` (zona) e
  `:395-543` (`[326] salvarFaixasEntregaAdmin`, inclusive o shim de namespace `:410-422`; o shim é reusado
  como molde para `salvarZonasEntregaAdmin`). Substituídos pelos blocos `[328]` da §8. Cabeçalho `:1-30`
  reescrito.
- `src/app/admin/assinantes/isolamento-admin.test.ts`: imports `:183-188`, `PAYLOAD_ZONA` `:199-205` e os
  testes `[089]` `:288-304`, `[093]` `:455-473` e `[160]` `:475-488`. A cobertura equivalente ("admin
  reprovado ⇒ zero RPC" e "p_loja_id = lojaId do parâmetro") passa a viver em `admin-entrega.test.ts`, porque o
  mock deste arquivo não tem `rpc`. No lugar, um comentário de uma linha apontando para os testes novos.
- `src/lib/validacoes/entrega.test.ts`: describes de `schemaZona`/`schemaTaxa`/`schemaBairro`/
  `schemaZonaCompleta` e helpers deles, da `:44` até o fim do describe `schemaZonaCompleta — faixa
  condicional` (`:355`). O bloco `[326/F2]` começa na `:357`, e os helpers dele (`:384-419`) **ficam**. Os
  casos de CEP de `:235-314` reaparecem contra `schemaZonasEntrega` (§8). Cabeçalho `:6-13`; imports `:18-21`.
- `src/components/painel/payloadZona.test.ts`: describe `montarPayloadZona` (`:96-fim`) e cabeçalho `:1-20`.
- `src/components/painel/TabelaFaixasEntrega.test.ts`: describe `enviarFaixas` (`:99-132`), helper `adiada`
  (`:135-143`) e describe `criarFilaGravacao` (`:145-239`) **se mudam** para
  `src/components/painel/gravacaoZonas.test.ts` no P4, junto com o código (§7).

**Allowlist e comentários que citam o código removido (P3; senão o gate F4 acusa):**
- `src/app/admin/assinantes/enforcement-escopo-admin.test.ts:208-224`: remover as duas entradas
  `admin-entrega.ts` de `ALLOWLIST_INSERT` e o comentário. Allowlist sem uso é brecha: um insert cru novo em
  `taxas_entrega` passaria calado.
- `src/app/admin/assinantes/enforcement-props-action-admin.test.ts:44`: trocar o exemplo `criarZona` por
  `salvarZonas`.

**Fica:**
- `payloadZona.ts`, com `paraNumero` (`:24`), `cepParaInteiro` (`:32`), `cepInteiroParaMascara` (`:41`) e os
  montadores novos de CEP/bairro (§7). Por isso **`paraNumero` não muda de lugar** e
  `src/lib/utils/paraNumero.ts` não é criado.
- `salvarModalidadesEntrega`/`Admin`.
- A RPC `salvar_faixas_entrega` (3 args), até o contract (§9).
- `tests/migrations/rpc_salvar_faixas_entrega.test.ts` continua verde e sai no contract.

**Gate F4 (P3):**
`grep -rnE "\b(salvarZona|criarZona|atualizarZona|alternarZonaAtiva|removerZona|salvarFaixasEntrega)(Admin)?\b|FormZona|schemaZonaCompleta|montarPayloadZona" src tests`
vazio. `npx tsc --noEmit` verde.

---

## 7. Telas: seletor de forma, CEP, bairro, conflito, aviso sem coordenadas

### Componentes (nomes finais)

| arquivo | tipo | origem |
|---|---|---|
| `src/components/painel/SeletorFormaFrete.tsx` | novo, client | `RadioGroup` (`@/components/ui/radio-group`, já usado em `TabelaFaixasEntrega.tsx:20`) |
| `src/components/painel/TabelaFaixasCep.tsx` | novo, client | campos de CEP de `FormZona.tsx:221-256` (via `git show main:`) + estrutura de linha/Card de `TabelaFaixasEntrega.tsx:526-751` |
| `src/components/painel/TabelaBairrosEntrega.tsx` | novo, client | chips de bairro de `FormZona.tsx:95-108,258-301` + estrutura de linha/Card |
| `src/components/painel/pecasEntrega.tsx` | novo, client, **extraído** | `CampoMoeda` (`TabelaFaixasEntrega.tsx:112-158`), `ListaZonasAtuais` (`:84-110`), `ALVO` (`:64`), `ROTULO_TIPO` (`:66-70`), `IndicadorGravacao` (`:537-556`), `DialogoSubstituirZonas` (`:836-871`), `AvisoConflitoZonas` (novo, ~25 linhas) |
| `src/components/painel/gravacaoZonas.ts` | novo, puro, **extraído** | `criarFilaGravacao` + `EstadoGravacao` (`:242-285`), `enviarZonas` (generaliza `enviarFaixas`, `:209-240`), `criarGravadorComVersao` (novo) |
| `src/lib/utils/formaFrete.ts` | novo, puro | §3 |
| `src/components/painel/payloadZona.ts` | estendido | `lerFaixasCep`, `montarPayloadCep`, `lerGruposBairro`, `montarPayloadBairros` |

Não há componente novo acima de 50 linhas que duplique `lib/` ou `components/ui/`: os três editores reusam
`pecasEntrega`, `gravacaoZonas`, `payloadZona` e `react-imask`. `components/ui/` não é editado.

### Estado e fluxo (`EntregasClient.tsx`)

Props novas:
```ts
{ zonas; versao: number; temCoordenadas: boolean; hrefPerfil: string; modalidades; taxaForaZona;
  acoes: { salvarModalidades: typeof salvarModalidadesLojista; salvarZonas: typeof salvarZonasEntrega } }
```
Saem `acoes.salvarFaixas` e o import de tipo `salvarFaixasEntrega` (`EntregasClient.tsx:5-8,24-27`).

- `gravadaNaCarga = formaGravadaDasZonas(zonas)`. Estados: `formaVisivel` (inicial
  `formaInicialDaTela(gravadaNaCarga)`), `formaGravada` (inicial `gravadaNaCarga`), `gravouNestaSessao`
  (false) e `conflito` (false).
- `gravador = useState(() => criarGravadorComVersao({ acao: (p) => acoesRef.current.salvarZonas(p),
  versaoInicial: versao, aoConflito: () => setConflito(true) }))[0]`. Contrato de `criarGravadorComVersao`,
  testável em node:
  - `salvar(dados: DadosZonasSemVersao)` manda `{ ...dados, versao: atual }`.
  - Com `ok`, a versão vira `r.versao`.
  - Com `conflito`, chama `aoConflito` uma vez e daí em diante devolve `{ ok:false, conflito:true, erro }`
    **sem chamar a action**. Isso para o salvamento automático de bater no servidor a cada blur.
  - Exceção não altera a versão.
  - Como a fila serializa (`TabelaFaixasEntrega.tsx:244-285`), cada gravação sai com a versão devolvida pela
    anterior.
- `aoGravar(forma, itens)`, chamado pelo editor no `ok`: `setFormaGravada(itens === 0 ? "nenhuma" : forma)` e
  `setGravouNestaSessao(true)`.
- Render:
  1. `ModalidadesEntrega` (sem mudança).
  2. Título "Zonas de entrega" + texto de `:94-100`.
  3. `SeletorFormaFrete`.
  4. `AvisoConflitoZonas` quando `conflito`.
  5. Os **três editores montados**, só o visível sem `hidden`. Assim trocar de aba não perde o estado local
     já gravado e não reabre com zonas velhas do servidor.

### `SeletorFormaFrete`

Props: `{ valor: FormaFrete; gravada: FormaGravada; aoMudar(f) }`.

- `fieldset` com `legend` "Como você cobra a entrega" e `RadioGroup` com 3 cartões `Label` de alvo 44px
  (`ALVO`).
  - "Faixas de distância (km)" com a etiqueta "Recomendado". Descrição: o texto de
    `TabelaFaixasEntrega.tsx:494-505`, que sai de lá e vem para cá.
  - "Faixas de CEP": "Um preço por intervalo de CEP."
  - "Bairros": "Um preço por grupo de bairros."
- Na forma igual a `gravada`: etiqueta "Valendo na vitrine".
- Trocar de opção **não grava** nada, só muda o editor visível.

### Props comuns dos editores

```ts
type PropsEditorZonas = {
  zonasIniciais: ZonaVitrine[];          // as da carga SE gravadaNaCarga === esta forma (km: também "mista"); senão []
  formaGravada: FormaGravada;
  zonasParaConfirmacao: ZonaVitrine[];   // `zonas` da carga enquanto !gravouNestaSessao; [] depois (a lista ficou velha)
  salvar: (d: DadosZonasSemVersao) => Promise<ResultadoZonas>;  // gravador.salvar
  aoGravar: (forma: FormaFrete, itens: number) => void;
  bloqueado: boolean;                    // = conflito; desliga edição e gravação
  taxaForaZona: number | null;
};
```

- **Confirmação antes da 1ª gravação numa forma diferente da ativa.** A cada tentativa o editor calcula
  `precisaConfirmarSubstituicao(forma, formaGravada, kmForaDoFormato)`. A confirmação vale só para o
  `formaGravada` que ela substituiu: guarda `confirmadoPara: FormaGravada | null` e compara. Isso generaliza
  `substituicaoConfirmada` (`TabelaFaixasEntrega.tsx:331,394-408`). Se o lojista gravar em CEP, voltar ao km e
  editar, o km pergunta de novo. O diálogo é o `DialogoSubstituirZonas` extraído:
  - título "Substituir as zonas atuais?";
  - descrição "As zonas de {ROTULO_FORMA[formaGravada] | 'entrega cadastradas hoje'} saem da loja e a vitrine
    passa a cobrar por {ROTULO_FORMA[forma]}. Esta ação não pode ser desfeita.";
  - lista `zonasParaConfirmacao` quando não vazia;
  - botões "Cancelar" e "Substituir e salvar".
- **Faixa informativa** quando `formaGravada ∉ {"nenhuma", forma}`, `role="note"` no topo do editor:
  "Preencha esta tela para trocar a forma de cobrança. Hoje a vitrine cobra por
  {ROTULO_FORMA[formaGravada] | 'zonas de tipos diferentes'}, e isso só muda quando você salvar aqui."
- **Conflito.** `enviarZonas` não dá toast quando `conflito` (o banner cobre). Em qualquer outro `!ok`, dá
  `toast.error(r.erro)` (`TabelaFaixasEntrega.tsx:231-233`).
  - `AvisoConflitoZonas`: `role="alert"`, ícone `AlertTriangle`, texto `MENSAGEM_CONFLITO_ZONAS` e botão
    "Recarregar a página" (`window.location.reload()`). Recarregar descarta o estado local, que é o que se
    quer. `router.refresh()` não serve: preservaria o `useState`.
  - Com `bloqueado`, os inputs ficam `disabled` e o indicador mostra "Não salvo".
- **Indicador** "Salvando… / Salvo / Não salvo" (`IndicadorGravacao`) e copy "Tudo é salvo sozinho ao sair de
  cada campo." iguais ao km.

### Editor km (`TabelaFaixasEntrega.tsx`, modificado)

- Prop `salvar` passa a ser `PropsEditorZonas["salvar"]`. `montarPayload` (`:171-207`) continua devolvendo
  `DadosFaixasEntrega`, e o editor envia `{ forma: "raio_km", ...payload }`.
- Saem do arquivo, para `pecasEntrega`/`gravacaoZonas`: `CampoMoeda`, `ListaZonasAtuais`, o diálogo de
  substituição, `enviarFaixas`, `criarFilaGravacao` e a nota "Cobre sua área por distância" (vai para o
  seletor).
- `jaGravou`/`zonasNoAviso` (`:327,584-592`) continuam.
- **Aviso sem coordenadas** (props `temCoordenadas`, `hrefPerfil`), só neste editor e só com
  `!temCoordenadas`. Nota âmbar no topo do Card, no estilo de `:512-518`, com `Link` para `hrefPerfil`. O texto
  depende de `lojaTemRaioSemCoords(zonasIniciais, temCoordenadas)` (`src/lib/utils/freteDegradado.ts:33-42`):
  - `true`, a vitrine já está degradada (veredito `indisponivel_loja`, `freteDegradado.ts:21,221`):
    "Cadastre o endereço da loja em Perfil. Sem ele a vitrine não calcula a distância, e a entrega por faixas
    de km está indisponível para os clientes agora."
  - `false`, aviso preventivo: "Cadastre o endereço da loja em Perfil antes de usar faixas de km. Sem ele a
    vitrine não consegue calcular a distância até o cliente."

### Editor CEP (`TabelaFaixasCep.tsx`)

- Linha editável: `{ cepInicio: string; cepFim: string; taxa: string; gratis: string | null; ativo: boolean }`.
- Abre com `lerFaixasCep(zonasIniciais)`: zonas `faixa_cep` com taxa e CEPs não nulos, ordenadas por
  `cep_inicio`, CEPs mascarados com `cepInteiroParaMascara`.
- Colunas: CEP inicial, CEP final, Preço, Frete grátis, Ativa, lixeira.
  - CEPs: `IMaskInput mask="00000-000" inputMode="numeric"` com `inputMascaraClassName`, como em
    `FormZona.tsx:225-245`.
  - Moeda: `CampoMoeda`. Ativa: `Switch`.
- Grava no blur de qualquer campo quando o estado é válido, no `Switch` e logo depois de confirmar a remoção.
  Linha incompleta ou inválida mostra erro **na linha** e não grava, como `tentarGravar` em
  `TabelaFaixasEntrega.tsx:383-400`.
- `montarPayloadCep(linhas)` devolve `{ ok:true, payload: { forma:"faixa_cep", faixas } } | { ok:false, erro,
  indice }`. Mensagens:
  - CEP com menos de 8 dígitos: "Informe o CEP inicial completo da linha {n}." (idem final).
  - Preço vazio: "Informe o preço da faixa de {ini} a {fim}."
  - Invertida e sobreposta: as mensagens do zod da §4, com o índice vindo do `path`.
- Lixeira: `AlertDialog` "Remover esta faixa de CEP?". Botão "Adicionar faixa de CEP", desligado em 50.
- Rodapé de ajuda (de `FormZona.tsx:247-254`): "A faixa é inclusiva: pedidos com CEP entre o inicial e o final
  pagam o preço da linha. CEP fora de todas as faixas paga a taxa de fora da área, se houver." O texto do
  rodapé segue `taxaForaZona`: com valor, "paga {formatarMoeda(taxaForaZona)}"; com `null`, "não recebe
  entrega".

### Editor bairros (`TabelaBairrosEntrega.tsx`)

- Grupo editável: `{ bairros: string[]; novoBairro: string; taxa: string; gratis: string | null; ativo:
  boolean }`.
- Abre com `lerGruposBairro(zonasIniciais)`: uma zona `bairro` com taxa vira um grupo; os bairros vêm de
  `zona.bairros[].nome`.
- Cada grupo é uma linha do Card com:
  - chips `Badge` com botão de remover (`FormZona.tsx:284-299`);
  - input "Nome do bairro" + botão `Plus` (Enter adiciona, `FormZona.tsx:261-283`);
  - Preço, Frete grátis, Ativa e a lixeira do grupo.
- Ao adicionar um bairro, a checagem local usa **`normalizarBairro`** contra todos os grupos (troca o
  `toLowerCase` de `FormZona.tsx:98`). Repetido não entra, e a mensagem aparece na linha: "{bairro} já está no
  preço de {R$ x}."
- Grava depois de adicionar ou remover chip, no blur de preço/grátis, no `Switch` e depois de remover grupo.
  Grupo sem bairro mostra erro na linha e não grava.
- `montarPayloadBairros(grupos)` devolve `{ ok:true, payload:{ forma:"bairro", grupos } } | { ok:false, erro,
  indice }`.
- Botão "Adicionar preço por bairro", desligado em 30. Tetos de chips: 100 por grupo e 300 no total.
- Ajuda: "Escreva o bairro como ele aparece no CEP dos Correios. Maiúsculas e acentos não fazem diferença. O
  bairro do pedido vem do CEP do cliente, não do que ele digita." A frase segue `resolverCepServidor.ts:1-6`
  e `seguranca.md` §10-A.

### Páginas

- Painel (`src/app/(painel)/painel/(bloqueavel)/configuracoes/entregas/page.tsx`):
  - lê `listarZonasParaEdicao`;
  - passa `versao`, `temCoordenadas = loja.latitude != null && loja.longitude != null` (só o boolean,
    `freteDegradado.ts:10-11`) e `hrefPerfil = "/painel/configuracoes/perfil"`;
  - passa `acoes={{ salvarModalidades: salvarModalidadesEntrega, salvarZonas: salvarZonasEntrega }}`.
- Admin:
  - `page.tsx` recebe `{ versao, zonas }` de `carregarZonasAdmin` e calcula `temCoordenadas` da `loja` de
    `carregarLojaAdminBase`;
  - `hrefPerfil = /admin/assinantes/${lojaId}/configuracoes/perfil` (a rota existe:
    `src/app/admin/assinantes/[lojaId]/configuracoes/perfil`);
  - `EntregasAdminClient.tsx` repassa e injeta `salvarZonas: (p) => salvarZonasEntregaAdmin(lojaId, p)`.
    `acoes={{...}}` aninhado continua no formato que `enforcement-props-action-admin.test.ts` aceita.
  - Atualizar `page.test.tsx` (`:58-60`, `:106-112`) para o shape novo.

**Gate F5:** `grep -nE "latitude|longitude" "src/app/(painel)/painel/(bloqueavel)/configuracoes/entregas/EntregasClient.tsx" "src/app/admin/assinantes/[lojaId]/configuracoes/entregas/EntregasAdminClient.tsx" src/components/painel/TabelaFaixas*.tsx src/components/painel/TabelaBairrosEntrega.tsx`
vazio.

---

## 8. Testes RED do P2 (um ou mais por linha da tabela de risco)

Convenções:
- Símbolo inexistente é resolvido por namespace (precedente em `src/lib/actions/entrega.faixas.test.ts:22-24`
  e `admin-entrega.test.ts:410-422`), para o RED ser "export ausente" e não import quebrado.
- RPC: afirmar `code === "P0001"` **e** `message` contendo o fragmento.
- Estado intacto: comparar contagem e linhas de `zonas_entrega`, `taxas_entrega`, `bairros_zona` **e**
  `lojas.versao_zonas_entrega` antes e depois.

### F1 · versão otimista: `tests/migrations/rpc_salvar_zonas_entrega.test.ts` (novo; harness `createTestDb()`/`asUser`/`asService`/`asAnon` de `tests/helpers/pglite.ts`)

1. `[328/F1] coluna versao_zonas_entrega nasce 0 em loja existente e em loja nova; CHECK recusa negativa`
2. `[328/F1] gravação ok devolve versão + 1 e lojas.versao_zonas_entrega = versão devolvida (raio_km, faixa_cep e bairro)`
3. `[328/F1] versão desatualizada ⇒ P0001 'salvar_zonas_entrega: versao desatualizada'; zonas, taxas, bairros e versão da loja intactos`
4. `[328/F1] duas gravações com a mesma versão: a 1ª devolve v+1, a 2ª é recusada com 'versao desatualizada' e o estado é o da 1ª`
5. `[328/F1] service_role com versão desatualizada também é recusado (admin não atropela o lojista)`
6. `[328/F1] payload inválido com versão certa ⇒ erro de valor e versão NÃO incrementa`
7. `[328/F1] p_versao null ou negativa ⇒ 'versao invalida'; nada muda`
8. `[328/F1] dono A com p_loja_id de B e a versão CERTA de B ⇒ 'sem posse' (T2 antes de T4); versão e zonas de B intactas`
9. `[328/F1] salvar_faixas_entrega(uuid,int,jsonb) continua existindo e executável por authenticated e service_role (expand-only)`

`src/lib/supabase/queries/entregaPagamento.zonasEdicao.test.ts` (novo, client fake):

10. `[328/F1] listarZonasParaEdicao lê versão e zonas num ÚNICO select em lojas com embed de zonas_entrega; devolve { versao, zonas hidratadas }`
11. `[328/F1] listarZonasParaEdicao com erro do PostgREST ou loja ausente ⇒ lança`

### F2 · RPC CEP e bairro: `tests/migrations/rpc_salvar_zonas_entrega.test.ts`

12. `[325/F2] salvar faixa_cep numa loja com zonas raio_km e bairro ⇒ zero zonas raio_km/bairro na loja (count = 0), bairros_zona órfão = 0; B intacta`
13. `[325/F2] salvar bairro ⇒ zero zonas raio_km/faixa_cep na loja; B intacta`
14. `[325/F2] salvar raio_km numa loja com faixa_cep e bairro ⇒ zero zonas faixa_cep/bairro; B intacta`
15. `[325/F2] faixa_cep grava cep_inicio/cep_fim inteiros, taxa, grátis e ativo; nome 'CEP 01000-000 a 01999-999'; raio_max_km null; tipo e loja_id do payload ignorados`
16. `[325/F2] bairro grava uma zona por grupo, bairros_zona com nomes aparados e espaço colapsado, nome derivado 'Centro e mais 1'`
17. `[325/F2] CEP com ≠ 8 dígitos (123456789), fracionário (1.5), string ('01000000') ou null ⇒ 'cep invalido'; estado anterior intacto`
18. `[325/F2] início > fim ⇒ 'faixa de cep invertida'; estado anterior intacto`
19. `[325/F2] faixas sobrepostas (01000000–01999999 e 01500000–02000000; e fim = início da outra) ⇒ 'faixas de cep sobrepostas'; encostadas (…01999999 / 02000000…) aceitas`
20. `[325/F2] bairro repetido normalizado ('Centro' e ' cêntro ', no mesmo grupo e em grupos diferentes) ⇒ 'bairro repetido'; estado anterior intacto`
21. `[325/F2] bairro vazio, só espaço ou não-string ⇒ 'bairro invalido'; grupo com bairros [] ⇒ 'grupo sem bairro'`
22. `[325/F2] taxa 4.555 / -1 / '5' (string) ⇒ 'taxa invalida' em faixa_cep e em bairro; grátis 4.555 ⇒ 'gratis invalido'; ativo 'true' ⇒ 'ativo invalido'`
23. `[325/F2] tetos: 51 faixas de CEP, 31 grupos, grupo com 101 bairros ou 301 no total ⇒ 'lista acima do teto'; 50 faixas e 30 grupos aceitos`
24. `[325/F2] p_forma 'cidade' ⇒ 'forma invalida'; p_dados array ⇒ 'dados invalidos'`
25. `[325/F2] p_loja_id alheio com lista vazia (cada forma) ⇒ 'sem posse'; zonas da outra loja intactas`
26. `[325/F2] sessão 'authenticated' com claim role FORJADO 'service_role' ⇒ 'sem posse'; B intacta` (molde: `rpc_salvar_faixas_entrega.test.ts:314-343`)
27. `[325/F2] anon ⇒ 42501 nomeando salvar_zonas_entrega; A intacta`
28. `[325/F2] service_role com p_loja_id A ⇒ só A muda; B intacta (filtro vale sem RLS)`
29. `[325/F2] catálogo: SECURITY INVOKER, search_path fixado; EXECUTE só authenticated e service_role` (molde `:688-709`)

### F3 · actions: `src/lib/actions/entrega.zonas.test.ts` (novo; molde de mock `entrega.faixas.test.ts:27-60`)

30. `[328/F3] payload com loja_id na raiz, ou item com tipo/nome/loja_id extra ⇒ { ok:false } e createClient NÃO chamado (.strict())`
31. `[328/F3] forma fora do enum, versao ausente/negativa/string ⇒ recusa sem I/O`
32. `[325/F3] CEP sobreposto ou invertido ⇒ recusa sem I/O com a mensagem custom do zod`
33. `[325/F3] bairro repetido por acento/caixa/espaço (normalizarBairro) ⇒ recusa sem I/O`
34. `[328/F3] raio_km válido ⇒ UMA rpc('salvar_zonas_entrega', { p_loja_id: loja do dono, p_versao, p_forma:'raio_km', p_dados:{ incremento, faixas } }) com args literais`
35. `[325/F3] faixa_cep e bairro válidos ⇒ p_dados = { faixas } / { grupos } literais; p_loja_id nunca do payload`
36. `[328/F3] sucesso ⇒ { ok:true, versao: <data da rpc> } e revalida painel de entregas e vitrine`
37. `[328/F3] erro P0001 'salvar_zonas_entrega: versao desatualizada' ⇒ { ok:false, conflito:true, erro: MENSAGEM_CONFLITO_ZONAS }, sem texto do banco e sem revalidatePath`
38. `[328/F3] outro erro do banco ou rpc que lança ⇒ { ok:false } genérico SEM conflito; detalhe só no console.error`
39. `[328/F3] client autenticado (createServiceClient nunca); dono sem loja ⇒ rpc não chamada; nenhum from() em zonas/taxas/bairros`

`src/app/admin/assinantes/actions/admin-entrega.test.ts` (blocos novos `[328]`; molde `:432-540`):

40. `[328/F3] salvarZonasEntregaAdmin — lojaId não-UUID ⇒ { ok:false } sem prepararContextoAdmin`
41. `[328/F3] salvarZonasEntregaAdmin — payload com loja_id/tipo/campo extra ⇒ recusa ANTES de elevar (prepararContextoAdmin não chamado)`
42. `[328/F3] salvarZonasEntregaAdmin — admin reprovado ⇒ exceção propaga, service nunca criado, ZERO chamada de rpc` (equivalente ao [089] removido)
43. `[328/F3] salvarZonasEntregaAdmin — rpc recebe p_loja_id = lojaId do parâmetro e args literais, nunca loja_id do payload` (equivalente ao [093] removido)
44. `[328/F3] salvarZonasEntregaAdmin — conflito ⇒ { ok:false, conflito:true } genérico; registrarAcessoAdmin NÃO chamado`
45. `[328/F3] salvarZonasEntregaAdmin — sucesso ⇒ registrarAcessoAdmin('salvar_zonas_entrega', { forma, itens }) e { ok:true, versao }`

`src/lib/validacoes/entrega.test.ts` (describes novos):

46. `[328/F3] schemaZonasEntrega — .strict() recusa chave extra em cada forma e em cada item; versao inteiro ≥ 0 obrigatório`
47. `[325/F3] schemaZonasEntrega — faixa_cep: CEP inteiro 0..99999999, início ≤ fim, sem sobreposição, teto 50`
48. `[325/F3] schemaZonasEntrega — bairro: ≥ 1 bairro por grupo, sem repetição por normalizarBairro, tetos 30/100/300`
49. `[326] schemaFaixasEntrega — comportamento inalterado depois da extração de refinarPrefixo` (os describes `[326]` existentes, `:420-fim`, seguem passando)

### F4 · remoção dos caminhos por zona (RED de contrato + gate)

50. `src/lib/actions/entrega.zonas.test.ts`: `[327/F4] módulo de entrega não exporta salvarZona, criarZona, atualizarZona, alternarZonaAtiva, removerZona nem salvarFaixasEntrega` (`Object.keys(await import(...))`)
51. `admin-entrega.test.ts`: `[327/F4] módulo admin não exporta criarZonaAdmin, atualizarZonaAdmin, removerZonaAdmin, alternarZonaAtivaAdmin nem salvarFaixasEntregaAdmin`

Gate P3: grep da §6 vazio + `npx tsc --noEmit`.

### F5 · telas (P4, não RED; testes de módulo puro, ambiente node)

- `src/components/painel/payloadZona.test.ts`: `lerFaixasCep ordena por cep_inicio e mascara`; `montarPayloadCep: CEP incompleto/preço vazio ⇒ erro com índice; válido ⇒ { forma:'faixa_cep', faixas } inteiros`; `lerGruposBairro / montarPayloadBairros: grupo sem bairro ⇒ erro com índice; válido ⇒ { forma:'bairro', grupos }`.
- `src/lib/utils/formaFrete.test.ts`: `[] ⇒ nenhuma; tipos iguais ⇒ o tipo; misturados ⇒ mista`; `nenhuma/mista abrem em raio_km`; `precisaConfirmarSubstituicao: tabela verdade (nenhuma ⇒ false; mesma forma ⇒ false; outra ⇒ true; km fora do formato ⇒ true)`.
- `src/components/painel/gravacaoZonas.test.ts`: testes movidos de `TabelaFaixasEntrega.test.ts:99-fim` e mais `criarGravadorComVersao: ok atualiza a versão; a próxima gravação usa a nova; conflito chama aoConflito uma vez e as seguintes não chamam a action; exceção não muda a versão`.
- Gate F5 (§7).

### F6 · cálculo da vitrine e checkout (gate)

`git diff --stat main -- src/lib/utils/calcularFrete.ts` vazio ·
`grep -c criar_pedido supabase/migrations/20261018120000_zonas_entrega_versao_e_formas.sql` = 0.

---

## 9. Issue de contract (texto completo, criada no P9 no próximo número livre ≥ 363)

Arquivo: `tasks/<n>-contract-remover-salvar-faixas-entrega-3-args.md`

```markdown
# <n> — Remover a assinatura antiga `salvar_faixas_entrega(uuid, integer, jsonb)` (contract)

crítica: SIM (valor de frete, RPC chamada pelos dois mundos)

## Origem

Expand/contract do PR das issues 325/327/328 (migration
`20261018120000_zonas_entrega_versao_e_formas.sql`). Ver `plan/arquivo/tecnico-formas-de-frete.md` §1 e §9.

## Problema

A RPC antiga `public.salvar_faixas_entrega(p_loja_id, p_incremento, p_faixas)` continua no banco depois do
PR 325/327/328, para a produção anterior ao deploy seguir funcionando. Ela grava as faixas de km **sem
versão**: não confere nem incrementa `lojas.versao_zonas_entrega`. Qualquer chamador que ainda a use (deploy
antigo da Vercel aberto por URL de deployment, script, chamada direta ao PostgREST) reabre a sobrescrita
silenciosa da 328. O efeito fica restrito à loja do próprio chamador, porque a T2 de posse continua valendo.

## Pré-condição (não começar antes)

- [ ] PR 325/327/328 mesclado e deploy de produção concluído.
- [ ] `grep -rn "salvar_faixas_entrega\b" src` sem ocorrência fora de `src/lib/database.types.ts`.
- [ ] Logs do Supabase (API → filtro `/rpc/salvar_faixas_entrega`) sem chamada nos 7 dias depois do deploy.

## Escopo

1. Migration nova `<ts>_drop_salvar_faixas_entrega_3_args.sql`:
   `drop function if exists public.salvar_faixas_entrega(uuid, integer, jsonb);`
   ROLLBACK: reaplicar o corpo de `20260930120000_rpc_salvar_faixas_entrega_ativo.sql` (sem versão).
2. Apagar `tests/migrations/rpc_salvar_faixas_entrega.test.ts`. A cobertura equivalente com versão está em
   `tests/migrations/rpc_salvar_zonas_entrega.test.ts`. Antes, conferir caso a caso que cada teste de posse,
   claim forjado, valor por item e prefixo de ativas tem par na suíte nova.
3. Teste RED antes do drop, em `tests/migrations/rpc_salvar_zonas_entrega.test.ts`:
   `[contract] salvar_faixas_entrega(uuid,int,jsonb) não existe mais (pg_proc vazio para a assinatura)`.
4. `npx supabase gen types typescript > src/lib/database.types.ts` (some a entrada `salvar_faixas_entrega`).
5. `references/schema.md` e `references/seguranca.md` (Quinta instância INVOKER): a RPC passa a ser
   `salvar_zonas_entrega`; tirar a menção à assinatura antiga.

## Fora do escopo

`salvar_zonas_entrega`, telas, `calcularFrete.ts`.

## Gates

`npx tsc --noEmit` → `npm run lint` → `npm test` → `npm run build`; `npx supabase migration list` com a
migration na coluna Remote (o `db push` exige autorização).
```

---

## 10. Mapa de impacto

```
ESCRITA (autoridade)
EntregasClient (painel) ─┐
EntregasAdminClient ─────┤ acoes.salvarZonas(payload sem loja)
                         ├─► salvarZonasEntrega (lib/actions/entrega.ts)  [Server Action: zod .strict + loja do dono]
                         └─► salvarZonasEntregaAdmin (admin-entrega.ts)   [lojaId validado + prova admin fora do try]
                                   └─► rpc salvar_zonas_entrega (migration 20261018120000)  [AUTORITATIVO]
                                         ├─ T2 posse ─ lê lojas.dono_id / role efetivo
                                         ├─ T3 valor ─ taxa/grátis/ativo/CEP/bairro
                                         ├─ T4 UPDATE lojas.versao_zonas_entrega (compare-and-set, trava de linha)
                                         └─ DELETE zonas_entrega(loja) ─cascata─► taxas_entrega, bairros_zona ; INSERT da forma
LEITURA (snapshot)
page.tsx (painel) ─► listarZonasParaEdicao ─► lojas{versao, zonas_entrega{taxas, bairros}}  (1 statement)
page.tsx (admin) ─► carregarZonasAdmin ─► listarZonasParaEdicao(svc)
VALOR COBRADO (inalterado)
vitrine / criarPedido ─► listarZonasComTaxas ─► calcularFrete (fonte única)   [sem diff — F6]
```

Garantia por invariante:

```
Exclusividade de forma:   RPC (DELETE de todos os tipos + INSERT só de p_forma, mesma transação) — AUTORITATIVO
                          UI (seletor + confirmação) — só UX
Versão/concorrência:      RPC T4 (UPDATE ... WHERE versao = p_versao) — AUTORITATIVO
                          gravacaoZonas (repassa a versão devolvida, para em conflito) — UX
Posse/loja_id:            RPC T2 + RLS (lojista) / filtro p_loja_id (admin) — AUTORITATIVO; action deriva loja — camada 2
Valor da taxa/CEP/bairro: RPC T3 — AUTORITATIVO; zod na action — autoridade da aplicação (exata p/ bairro); tela — preview
Frete do pedido:          calcularFrete no servidor a partir do banco (seguranca.md §10) — sem mudança
```

---

## 11. Análise do codebase

| Arquivo | Papel atual | O que muda |
|---|---|---|
| `supabase/migrations/20261018120000_zonas_entrega_versao_e_formas.sql` | não existe | criar: coluna + RPC + grants (§1, §2) |
| `src/lib/database.types.ts` | tipos gerados | P3 edita à mão seguindo o precedente (`git log -3 -- src/lib/database.types.ts`); P6 regenera |
| `src/lib/validacoes/entrega.ts` | schemas de zona + faixas km | §5: novos, extração, remoção |
| `src/lib/actions/entrega.ts` | modalidades, faixas km, CRUD de zona | fica `salvarModalidadesEntrega`; entra `salvarZonasEntrega`; sai o resto (§6) |
| `src/app/admin/assinantes/actions/admin-entrega.ts` | idem admin | fica `salvarModalidadesEntregaAdmin`; entra `salvarZonasEntregaAdmin` |
| `src/lib/actions/admin-loja.ts:51-71` | blocklist somente-servidor | + `versao_zonas_entrega` |
| `src/lib/supabase/queries/entregaPagamento.ts:39-59` | `listarZonasComTaxas` | + `listarZonasParaEdicao`, `hidratarZona` |
| `src/app/admin/assinantes/[lojaId]/carga.ts:134-146` | `carregarZonasAdmin` → `ZonaVitrine[]` | → `ZonasEdicao` |
| `src/app/(painel)/.../entregas/page.tsx`, `EntregasClient.tsx` | km apenas | seletor + 3 editores + versão + boolean de coordenadas |
| `src/app/admin/.../entregas/page.tsx`, `EntregasAdminClient.tsx`, `page.test.tsx` | wrapper admin | shape novo, injeção de `salvarZonasEntregaAdmin` |
| `src/components/painel/TabelaFaixasEntrega.tsx` | editor km + peças | editor km só; peças extraídas; aviso sem coordenadas |
| `src/components/painel/payloadZona.ts` | helpers de CEP + `montarPayloadZona` | sai `montarPayloadZona`; entram leitores/montadores CEP/bairro |
| `src/components/painel/FormZona.tsx` | form órfão | apagado |
| testes listados na §6 e §8 | — | removidos / movidos / novos |

**NÃO tocar (com motivo):**
- `src/lib/utils/calcularFrete.ts`: já resolve os três tipos (`:72-98`); gate F6.
- `supabase/migrations/20260929120000_*` e `20260930120000_*`: já estão no remoto.
- `salvar_faixas_entrega(uuid,int,jsonb)`: expand-only, sai no contract (§9).
- `criar_pedido`.
- `src/components/ui/*`: gerado pelo shadcn.
- `ModalidadesEntrega.tsx`: usa `zonas` só para o aviso de entrega indisponível (`:64`). Depois de gravações
  na sessão ele fica com a lista da carga, o mesmo comportamento da 326. Fora do escopo.
- `src/lib/utils/faixasEntrega.ts`: leitura km continua válida.
- `RegistrarFreteCombinado.tsx`: tem máscara de moeda própria. Unificar com `CampoMoeda` fica fora deste PR,
  que não é dele.
- `listarZonasComTaxas`: contrato da vitrine e do pedido.

---

## 12. Decisões de design (alternativas)

1. **Uma RPC `p_forma` × três RPCs × sobrecarga de `salvar_faixas_entrega`.** Escolhida a RPC única com nome
   novo (§1).
2. **Versão em `lojas` × data das zonas × tabela própria.** Escolhida a coluna em `lojas` (§2).
3. **Proteger a coluna contra o dono.** Opções: (a) trigger com flag de sessão; (b) column privileges (exige
   revogar o UPDATE de tabela de `authenticated` e reconceder coluna a coluna, invasivo); (c) aceitar. Escolhida
   (c), com a coluna na blocklist admin. Motivo na §2.
4. **Leitura da versão: dois selects ordenados × um select com embed.** Escolhido o embed: atômico por
   construção, e não depende de alguém lembrar a ordem nas duas pages.
5. **Forma ativa: coluna × derivada.** Escolhida a derivada (§3).
6. **Bairro: uma zona por bairro × grupos.** Escolhidos os grupos: o modelo já é 1:N
   (`references/schema.md:310-318`); o `FormZona` já editava assim; a loja com 40 bairros a R$ 5 não precisa de
   40 linhas. Custo: o nome da zona é derivado.
7. **Unicidade de bairro: SQL `unaccent` × SQL `normalize` × só zod.** Escolhido zod exato (`normalizarBairro`)
   + SQL `normalize` como rede (§4). `unaccent` exigiria extensão no cloud e carga de contrib no harness.
8. **Sobreposição de CEP: recusar × aceitar com aviso.** Escolhido recusar: com sobreposição a vitrine cobra a
   menor taxa (§4).
9. **Conflito: recarregar × mesclar.** Escolhido recarregar. Mesclar no cliente exigiria diff de zonas e a
   decisão de quem vence, o que é escopo de produto. Recarregar mostra o estado real e a tela fica pequena.
10. **Editores: montar todos e esconder × remontar por `key`.** Escolhido montar todos: remontar reabriria o
    editor com as zonas da carga, já velhas depois de gravar na sessão.
11. **`paraNumero`: mover para `lib/utils` × ficar.** Fica, porque `payloadZona.ts` fica (§6).
12. **Mensagem de conflito: código de erro próprio × fragmento P0001.** Escolhido o fragmento estável, no mesmo
    padrão das demais mensagens da RPC. `ehConflitoDeVersao` é o único lugar que o interpreta.

---

## 13. Cenários

- **Caminho feliz.** Lojista com faixas km abre a tela: km está marcada e "Valendo na vitrine". Edita um preço
  e sai do campo. A action grava, recebe `versao + 1`, e o gravador guarda a versão. A próxima gravação manda a
  versão nova.
- **Troca de forma.** Marca "Bairros" e vê a faixa informativa. Adiciona "Centro" e preenche o preço. Ao sair
  do campo, abre "Substituir as zonas atuais?" listando as faixas km. Depois de confirmar, a RPC apaga as km e
  grava o grupo. O seletor passa a mostrar Bairros como "Valendo na vitrine". Voltar ao km e editar pede
  confirmação de novo.
- **Loja sem zonas.** Abre em km, sem confirmação na 1ª gravação (`formaGravada = "nenhuma"`).
- **Loja mista (legado).** Abre em km no cartão de legado (`TabelaFaixasEntrega.tsx:509-524`); nada é apagado.
  A 1ª gravação em qualquer forma pede confirmação.
- **Duas abas / admin + lojista.** A aba B grava com a versão v e passa a v+1. A aba A grava com v e recebe
  `versao desatualizada`: aparece o banner "Recarregue a página…", as edições ficam desligadas, não há mais
  chamada ao servidor e o banco fica com o estado de B.
- **Duplo blur na mesma aba.** A fila serializa (`TabelaFaixasEntrega.tsx:244-285`) e cada gravação usa a
  versão devolvida pela anterior. Não há falso conflito.
- **Corrida real no banco** (duas transações ao mesmo tempo): a trava de linha + reavaliação do `WHERE` faz uma
  delas falhar (§1, T4).
- **CEP fora de todas as faixas.** A vitrine aplica `taxaForaZona` ou "fora de área"
  (`calcularFrete.ts:176-186`), sem mudança.
- **Bairro digitado pelo cliente diferente do canônico.** A vitrine usa o bairro do ViaCEP
  (`resolverCepServidor.ts:98`), sem mudança.
- **Loja sem coordenadas com km.** O aviso no editor km (§7). A vitrine degrada para `indisponivel_loja`
  (`freteDegradado.ts:221`).
- **Loja inativa ou bloqueada.** O guard é do layout `(bloqueavel)` (`CLAUDE.md`, "Guard do painel é nos
  layouts"), sem mudança. A RPC não olha `ativo`, como hoje.
- **Sessão expirada.** `buscarLojaDoDono` devolve `null` ⇒ "Loja não encontrada." (`entrega.ts:88-90`). Ou a
  RPC devolve `sem posse` ⇒ mensagem genérica.
- **Payload adulterado** (`loja_id`, `tipo`, `nome`, `raio_max_km`, taxa 4.555): o zod recusa sem I/O, e a RPC
  ignora as chaves ou recusa o valor.
- **Erro do banco.** Mensagem genérica na UI, detalhe só no `console.error` do servidor. O conflito vai para
  `console.warn` sem detalhe.

---

## 14. Recálculo no servidor (dinheiro)

| O cliente envia | O servidor faz |
|---|---|
| `versao`, `forma` | confere a versão no banco (T4); deriva o `tipo` da forma |
| por item: `taxa`, `pedido_minimo_gratis`, `ativo` | revalida (zod + RPC T3: ≥ 0, 2 casas, boolean) |
| raio_km: `incremento` | deriva teto e nome pela posição |
| faixa_cep: `cep_inicio`, `cep_fim` | valida inteiro/intervalo/sobreposição; deriva o nome |
| bairro: nomes de bairro | valida/normaliza/deduplica; deriva o nome da zona |
| nunca: `loja_id`, `zona_id`, `nome`, `tipo`, `raio_max_km` | `loja_id` = loja do dono / `lojaId` validado |

O valor cobrado no pedido continua sendo recalculado por `calcularFrete` a partir do banco
(`seguranca.md` §10, `:871-933`), sem diff (F6).

---

## 15. Dependências externas

Nenhum pacote novo.
- `react-imask@^7.6.1`, já usado em `TabelaFaixasEntrega.tsx:5`.
- `zod@^4.4.3`, discriminatedUnion verificado neste plano.
- `@supabase/supabase-js@^2.108.1`, sem mudança.

**Custo e quota (`architecture.md` §9 nº1):** zero custo variável. É uma RPC Postgres a mais por gravação, no
lugar da atual (1:1). Não há chamada externa: o editor de bairro não consulta o ViaCEP e o de CEP não
geocodifica. Nada para estourar.

---

## 16. Ordem de implementação

1. **P2 · RED** (crítica: valor de frete): testes 1–51 da §8. `FAIL` capturado. `npx tsc --noEmit` só com os
   símbolos ausentes declarados (memória "Vitest não checa tipos").
2. **P3 · GREEN backend**, nesta ordem:
   1. Migration (§1, §2): sem ela, F1/F2 não passam.
   2. `database.types.ts` (coluna + função): sem os tipos, o `rpc()` não tipa.
   3. `validacoes/entrega.ts` (§5): as actions dependem do schema.
   4. `queries/entregaPagamento.ts` + `carga.ts`.
   5. Actions lojista/admin + blocklist `admin-loja.ts`.
   6. Remoção da §6 (actions, FormZona, schemas, testes, allowlist, comentários).
   7. Adaptação mínima de `EntregasClient`/`EntregasAdminClient`/`TabelaFaixasEntrega`/pages para o `tsc`
      passar (injetar `salvarZonas` e mandar `{ forma:"raio_km", versao, ... }`).

   Gates: testes do P2 verdes, gate F4, `tsc`, `npm test`.
3. **P4 · telas** (§7):
   1. Extrações `pecasEntrega`/`gravacaoZonas`, com os testes movidos verdes antes de seguir.
   2. `formaFrete.ts` + teste.
   3. Montadores CEP/bairro em `payloadZona.ts` + testes.
   4. `SeletorFormaFrete`, `TabelaFaixasCep`, `TabelaBairrosEntrega`.
   5. `EntregasClient` (estado, gravador, conflito).
   6. Aviso sem coordenadas no km.
   7. Pages e admin.

   Gates: `tsc` → `lint` → `vitest src/components/painel src/lib/utils` → `build`; F5.
4. **P5 auditar ‖ testar ‖ revisar → P6 db push (autorização) → P7 verificar → P8 escriba → P9/P10.** Segue
   `plan/loop-formas-de-frete.md`.

---

## 17. Checklist de validação pós-implementação

- [ ] `npx tsc --noEmit` → `npm run lint` (0 erros) → `npm test` → `npm run build` sem warnings novos
- [ ] RLS/posse: dono A com `p_loja_id` de B (lista vazia e cheia, cada forma) ⇒ `sem posse`, B intacta; claim forjado ⇒ `sem posse`; anon ⇒ 42501
- [ ] Versão: versão velha ⇒ `versao desatualizada`, estado e versão intactos; ok ⇒ v+1
- [ ] Exclusividade: depois de salvar uma forma, `select tipo, count(*) from zonas_entrega where loja_id = A group by tipo` tem uma linha só
- [ ] Payload adulterado (`loja_id`, `tipo`, taxa 4.555, bairro repetido com acento) recusado sem I/O
- [ ] `calcularFrete.ts` sem diff; migration sem `criar_pedido`
- [ ] Gate F4 e gate F5 vazios
- [ ] Client components sem `latitude`/`longitude`; nenhum secret no client; nenhum CEP/telefone/e-mail real em teste ou seed. Usar CEPs genéricos como `01000-000`, sem endereço de pessoa
- [ ] `npx supabase migration list` com `20261018120000` na coluna Remote (P6, com autorização)
- [ ] Checklist de clique (P7, para o usuário): escolher cada forma; confirmação ao trocar; editar CEP e bairro; duas abas ⇒ a segunda pede recarregar; aviso sem coordenadas no km; mesma tela no hub admin

---

## 18. Riscos e mitigação

| risco | mitigação |
|---|---|
| A assinatura de 3 args grava sem versão até o contract | issue §9 com pré-condição de logs; efeito restrito à loja do chamador (T2) |
| Divergência JS × SQL na normalização de bairro com caractere exótico | zod exato na action (caminho da aplicação); SQL como rede; documentado |
| Dono altera `versao_zonas_entrega` por PATCH direto | só desliga a proteção da própria loja; risco aceito, registrado em `seguranca.md` (P8) |
| Remoção de `[089]/[093]/[160]` reduz a cobertura de isolamento admin | equivalentes 42–43 em `admin-entrega.test.ts`; o auditar confere no P5 |
| Allowlist `ALLOWLIST_INSERT` fica sem uso e vira brecha | removida no P3 (§6) |
| `database.types.ts` à mão diverge do gerado | P6 regenera; diff diferente do esperado ⇒ volta ao P3 |
| Banner de conflito sem jsdom não é testável por render | lógica no `criarGravadorComVersao` puro (testado); o gesto vai para o checklist de clique |

**Complexidade: alta.** Migration + RPC de dois mundos + concorrência + três telas + remoção cruzada em 12
arquivos de teste.
