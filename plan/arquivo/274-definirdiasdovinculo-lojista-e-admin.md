## Plano Técnico

> Escrito depois de ler, no estado do branch `feat/vigencia-por-item-do-cardapio` (HEAD `7c23bc9`):
> `src/lib/actions/cardapio.ts`, `src/lib/actions/cardapio-contrato.ts`,
> `src/lib/validacoes/cardapio.ts`, `src/lib/actions/admin-loja.ts`,
> `src/app/admin/assinantes/actions/admin-cardapios.ts`,
> `src/lib/supabase/queries/cardapios.ts`, `src/lib/utils/rotasCardapios.ts`,
> `src/lib/utils/vigenciaCardapio.ts`, `supabase/migrations/20260920129000_*.sql`,
> `supabase/migrations/20260921130000_cardapio_produtos_dias_semana.sql`,
> `src/app/admin/assinantes/enforcement-escopo-admin.test.ts`,
> `src/app/admin/assinantes/enforcement-props-action-admin.test.ts`,
> `src/lib/actions/cardapio-posse.enforcement.test.ts` e
> `src/app/admin/assinantes/actions/admin-cardapios.paridade.test.ts`.

### Análise do Codebase

**O que já existe e será REUSADO (nada disso se reescreve):**

| Arquivo | O que já faz | Como esta issue usa |
|---|---|---|
| `src/lib/validacoes/cardapio.ts` → `eixoOuNulo` (privada, ~linha 195) | dedup + `sort` numérico + `[]`/`null` → `null` | **É** `normalizarDiasDoVinculo`. Vira export nomeada; `schemaCardapio.transform` continua chamando a MESMA função. Zero implementação nova. |
| `src/lib/validacoes/cardapio.ts` → `z.guid()`, `.strict()`, `schemaIdCardapio` | forma dos payloads de cardápio | `schemaDiasDoVinculo` herda o mesmo molde |
| `src/lib/actions/cardapio-contrato.ts` | `Resultado`, `MSG_*`, `erroDoLote`, contrato NEUTRO dos dois mundos | ganha só `MSG_DIAS_DO_VINCULO` |
| `src/lib/actions/admin-loja.ts` → `criarEscopoLoja`, `validarLojaIdAdmin`, `prepararContextoAdmin`, `registrarAcessoAdmin`, `revalidarLojaAdmin` | escopo por construção, prova de admin antes de elevar, log best-effort | ganha **um** método (`atualizarPorChave`) |
| `src/lib/supabase/queries/cardapios.ts` → `cardapioPertenceALoja` (270) | posse de cardápio, `.eq("loja_id")` explícito, `false` idêntico p/ alheio e inexistente | usada no item absorvido (4), **não** em `definirDiasDoVinculo` (ver D2) |
| `src/lib/utils/rotasCardapios.ts` → `ROTA_CARDAPIOS_LOJISTA`, `rotaCardapiosAdmin(lojaId)` | as duas bases de rota | montagem do caminho do **detalhe** para revalidar |
| `src/lib/supabase/queries/lojas.ts` → `buscarLojaDoDono`, `buscarLojaAdminPorId` | loja da sessão / loja-alvo | `loja_id` e `slug` |
| `src/lib/utils/vigenciaCardapio.ts` → `VinculoVigencia`, `itemAberto` (273) | motor de vigência por vínculo | **não toca** — esta issue é só escrita |
| `admin-cardapios.paridade.test.ts` | harness de mock `makeChain` + `respostaPorTabela` | os casos novos entram nele |
| `cardapio-posse.enforcement.test.ts` (270) | guard estático de escrita em `cardapio_produtos` | ganha o verbo `update` (ver D6) |

**O que precisa ser CRIADO, e por que não dá para reusar:**

1. `schemaDiasDoVinculo` — nenhum schema existente tem a forma `{cardapio_id, produto_id, dias_semana}`. `schemaLoteDeProdutos` é `{cardapio_id, produto_ids[]}`: forma diferente, e frouxá-lo para servir aos dois seria abrir o teto e a unicidade do lote.
2. `MSG_DIAS_DO_VINCULO` — uma frase nova, porque a operação é nova (ver D3).
3. `EscopoLoja.atualizarPorChave` — `escopo.atualizar` só aceita `id` (ver D4).
4. `definirDiasDoVinculo` / `definirDiasDoVinculoAdmin` — as duas Server Actions da issue.

**Correção factual da issue.** O texto do escopo diz *"`cardapio_produtos` não tem `id`"*. **Tem**:
`20260920129000_cardapio_produtos_fks_compostas_rls.sql` declara `id uuid primary key default
gen_random_uuid()`. O motivo real de `atualizarPorChave` é outro e é melhor: o cliente conhece o
par `(cardapio_id, produto_id)`, **não** o `id` da linha de junção. Usar `escopo.atualizar(tabela,
id, …)` obrigaria a um SELECT prévio para resolver o `id` — uma segunda ida ao banco, TOCTOU, e um
oráculo em potencial ("o id existe?" antes da escrita). O UPDATE pela **chave natural** prova posse
**na própria escrita**. Isso está corrigido no escopo acima.

---

### Decisões

**D1 — `schemaDiasDoVinculo` NÃO deduplica; quem deduplica é a normalização.**
`z.array(…).max(7)` não deduplica (nota da auditoria da 272), e o `.refine(Set.size === length)` de
`listaDeProdutos` **não** é o padrão certo aqui. Em lote, id repetido muda a cardinalidade do que
vai ser escrito e é sinal de payload mal formado → recusa. Em `dias_semana`, `[1,1,3]` e `[1,3]`
são **semanticamente idênticos** ("segunda e quarta"); recusar seria transformar uma redundância
inofensiva numa frase de erro que o lojista não sabe corrigir. A regra é: **schema valida FORMA,
normalização decide REPRESENTAÇÃO** — a mesma divisão que `schemaCardapio` já aplica a
`cardapios.dias_semana` via `eixoOuNulo`.

```ts
// src/lib/validacoes/cardapio.ts
export const schemaDiasDoVinculo = z
  .object({
    cardapio_id: z.guid(),
    produto_id: z.guid(),
    dias_semana: z.array(z.number().int().min(0).max(6)).max(7),
  })
  .strict();
```

*Wart aceita e documentada:* `.max(7)` é teto de cardinalidade **do fio** (CWE-770), avaliado ANTES
da dedup — `[1,1,1,1,1,1,1,1]` (8 elementos) é recusado mesmo normalizando para `[1]`. É o
comportamento correto: o teto existe para barrar payload inflado, não para julgar semântica. A UI
real (7 pílulas) nunca produz isso.

**D2 — `normalizarDiasDoVinculo` mora em `src/lib/validacoes/cardapio.ts`, não em
`cardapio-contrato.ts`.** Divergência deliberada do texto da issue, por dois motivos:
(a) a função **já existe ali** como `eixoOuNulo` — dedup + ordem + `[]`→`null`, byte a byte o que
RN-11 pede; escrevê-la de novo em contrato é a violação exata do mandato 2;
(b) `cardapio-contrato.ts` **importa** de `validacoes/cardapio` (`ehMensagemDeVigencia`,
`DadosCardapio`), então pôr a função em contrato e importá-la de volta em validacoes cria ciclo.
Ação: renomear `eixoOuNulo` → `normalizarDiasDoVinculo` e exportá-la; `schemaCardapio.transform`
passa a chamar o nome novo (3 call sites, mesma linha). As duas Server Actions importam de
`@/lib/validacoes/cardapio`. A garantia de "uma cópia, dois mundos" é preservada — muda o arquivo,
não o princípio.

```ts
/** RN-11 (274) / RN-02 (spec-mãe): "sem restrição" tem UMA representação — NULL. */
export function normalizarDiasDoVinculo(dias: number[] | null | undefined): number[] | null {
  if (dias == null || dias.length === 0) return null;
  return [...new Set(dias)].sort((a, b) => a - b);
}
// [1,1,3] → [1,3] · [3,1] → [1,3] · [] → null · null → null
```

**D3 — a frase da recusa é `MSG_DIAS_DO_VINCULO`, nova, em `cardapio-contrato.ts`.**
Cogitou-se reusar `MSG_GENERICA_LOTE`. O invariante de segurança (UMA frase para alheio **e**
inexistente, sem oráculo) é satisfeito pelas duas opções — mas o **texto** de `MSG_GENERICA_LOTE`
é *"Não foi possível aplicar o cardápio aos produtos selecionados."*, que num toast de "marcar
quarta na linha da Feijoada" descreve uma operação que não aconteceu. Frase errada é dívida de UX,
não de segurança, e custa uma constante. Além disso o critério de aceite da própria issue e RN-12
da spec nomeiam `MSG_DIAS_DO_VINCULO`.

```ts
export const MSG_DIAS_DO_VINCULO =
  "Não foi possível salvar os dias deste item.";
```

Regra de uso, idêntica nos dois mundos: parse falho, loja ausente, `count === 0`, erro de banco e
`catch` → **esta** frase. O `23514` do CHECK `cardapio_produtos_dias_semana_dominio` é backstop e
vai cru para `console.error`, nunca para a tela (`seguranca.md` §14).

**D4 — `EscopoLoja.atualizarPorChave(tabela, chave, patch)`.**

```ts
/** UPDATE por CHAVE NATURAL: escopo = `loja_id` + TODAS as colunas de `chave`, `count:"exact"`.
 * Existe porque `atualizar` só chaveia por `id`, e o cliente de `cardapio_produtos` conhece o par
 * (cardapio_id, produto_id), não o `id` da junção — resolver o `id` por SELECT prévio seria uma
 * segunda ida ao banco, TOCTOU, e um oráculo de existência. Aqui a posse é provada PELA PRÓPRIA
 * escrita: `count === 0` é a recusa.
 * `patch` é `Omit<Update, "loja_id" | "id" | K>`: o `.eq` escopa QUAL linha, nunca O QUE se grava —
 * o wrapper barra POR TIPO re-parentear (loja_id), re-chavear (id) ou mover a linha pelas colunas
 * da chave. Mesma simetria de `inserir`/`atualizar`. */
atualizarPorChave<
  T extends TabelaComLojaId,
  K extends Exclude<Extract<keyof Tabelas[T]["Row"], string>, "loja_id">,
>(tabela: T, chave: Record<K, string>, patch: Omit<Tabelas[T]["Update"], "loja_id" | "id" | K>) {
  const colunas = Object.entries(chave) as [string, string][];
  // Chave vazia degradaria para um UPDATE da LOJA INTEIRA. Lança — não é `{ok:false}` amigável,
  // é bug de programação, e fail-closed é a regra da via service_role.
  if (colunas.length === 0) throw new Error("atualizarPorChave: chave vazia");
  let q = from(tabela).update(patch, { count: "exact" }).eq("loja_id", lojaId);
  for (const [coluna, valor] of colunas) q = q.eq(coluna, valor);
  return q;
}
```

O `throw` da chave vazia é **o** footgun novo desta issue e tem teste próprio (ver contrato de
teste, caso E1). `Encadeavel.eq` já devolve `Encadeavel`, então o laço tipa sem `any`.

**D5 — a escrita, nos dois mundos.**

Lojista (`src/lib/actions/cardapio.ts`), client AUTENTICADO, `.eq("loja_id")` explícito ALÉM da RLS:

```ts
const { error, count } = await supabase
  .from("cardapio_produtos")
  .update({ dias_semana: normalizarDiasDoVinculo(dias_semana) }, { count: "exact" })
  .eq("loja_id", loja.id)
  .eq("cardapio_id", cardapio_id)
  .eq("produto_id", produto_id);
if (error) { console.error("[definirDiasDoVinculo]", error); return { ok:false, erro: MSG_DIAS_DO_VINCULO }; }
if (count === 0) return { ok: false, erro: MSG_DIAS_DO_VINCULO };   // sem log: não é erro, é id que não existe NESTA loja
```

Admin (`src/app/admin/assinantes/actions/admin-cardapios.ts`), `service_role`, escopo pelo wrapper:

```ts
const { error, count } = await escopo.atualizarPorChave(
  "cardapio_produtos",
  { cardapio_id, produto_id },
  { dias_semana: normalizarDiasDoVinculo(dias_semana) },
);
```

`count === 0` ⇒ `{ ok:false, erro: MSG_DIAS_DO_VINCULO }` **antes** de `registrarAcessoAdmin` e
**antes** de qualquer `revalidatePath`. Sem `console.error` — logar um id-probe é ruído, e o
servidor não aprendeu nada que valha registro.

**Por que `count === 0` basta e a linha nunca cruza loja:** o UPDATE é `where loja_id = <derivado> and
cardapio_id = … and produto_id = …`. Um `cardapio_id` de outra loja não casa linha nenhuma
(`count = 0`), e é estruturalmente impossível ele passar a casar: as FKs compostas
`(cardapio_id, loja_id)` / `(produto_id, loja_id)` garantem que a linha da loja A só referencia
cardápio e produto da loja A — **inclusive sob BYPASSRLS**. Diferente do `ON CONFLICT DO NOTHING`
da 270, um UPDATE não tem caminho que pule a avaliação do `where`.

**D6 — `definirDiasDoVinculo` NÃO chama `cardapioPertenceALoja`.** A 270 exigiu o gate porque
`upsert … ignoreDuplicates` descarta a linha antes da FK (escrita alheia terminando sem erro) e
porque `delete` de zero linhas devolve sucesso mudo. Nenhum dos dois vale aqui: o UPDATE com
`count:"exact"` **transforma "zero linhas" em recusa**, que é exatamente o que o gate comprava — só
que sem a segunda ida ao banco e sem a janela TOCTOU entre a leitura e a escrita. É estritamente
mais forte e um round trip mais barato. O guard estático da 270 precisa aprender essa segunda forma
de prova (ver §Arquivos, `cardapio-posse.enforcement.test.ts`).

**D7 — a camada 3 do `enforcement-escopo-admin.test.ts` fica INALTERADA, e isso é correto.**
Registrado porque o texto da issue pede o contrário. Três fatos:
(a) a camada 3 varre só `src/app/admin/assinantes/**`; `admin-loja.ts` mora em `src/lib/actions/` e
**nunca** foi varrido por ela — o corpo de `atualizarPorChave` (que carrega `.eq("loja_id")` e
passaria) está fora do alcance dela, como já está o de `atualizar`/`remover`;
(b) em `admin-cardapios.ts` a chamada é `escopo.atualizarPorChave(…)`, que não casa
`ESCRITA = /\.from\(["'`]t["'`]\)[\s\S]*?\.(update|delete|insert|upsert)\(/` — igual a todas as
outras chamadas de `escopo.*` de hoje. A camada 3 existe para pegar `svc.from(…)` **cru**; passar
pelo wrapper é justamente o caminho sancionado;
(c) exigir que a chamada do wrapper "apareça" para a camada 3 obrigaria a afrouxar a regex para
casar nomes de método do wrapper, o que a tornaria ruidosa e mais fraca.
**O guard que de fato precisa crescer é o da 270** (`cardapio-posse.enforcement.test.ts`), que varre
`src/**` inteiro e é o único que conhece a tabela `cardapio_produtos` por nome. Ver §Arquivos.

**D8 — item absorvido da auditoria da 270: as quatro actions admin passam a checar `count`, e o
lojista ACOMPANHA (paridade recomendada e adotada).**

O `escopo.atualizar`/`escopo.remover` já pedem `count:"exact"`; o que falta é **ler** o valor.

| Action | Hoje | Passa a ser |
|---|---|---|
| `atualizarCardapioAdmin` | ignora `count` → `{ok:true}` + log com `entidade_id` alheio | `count === 0` ⇒ `{ok:false, erro: MSG_SALVAR}` **antes** do `registrarAcessoAdmin` |
| `ligarDesligarCardapioAdmin` | idem | `count === 0` ⇒ `{ok:false, erro: MSG_SALVAR}` idem |
| `removerCardapioAdmin` | idem (`escopo.remover`) | `count === 0` ⇒ `{ok:false, erro: MSG_REMOVER, exclusivos: 0}` idem |
| `converterExclusivosParaMenuAdmin` | lê órfãos de cardápio possivelmente alheio; `orfaos.length === 0` ⇒ loga assim mesmo | `cardapioPertenceALoja(svc, lojaId, cardapioId)` **antes** de ler órfãos; `false` ⇒ `{ok:false, erro: MSG_CONVERTER}`, sem log. Com posse provada, `orfaos.length === 0` continua logando (o rastro que explica por que a tela não mudou — comportamento intencional, preservado). |

**O lojista acompanha** (`atualizarCardapio`, `ligarDesligarCardapio`, `removerCardapio`,
`converterExclusivosParaMenu` em `src/lib/actions/cardapio.ts`), por três razões:
1. **Paridade é a proteção** (cabeçalho de `cardapio-contrato.ts`). Corrigir um lado só é o drift
   que o contrato neutro existe para impedir — e o `admin-cardapios.paridade.test.ts` compara os
   dois mundos: divergir aqui é escolher entre quebrar o teste e enfraquecê-lo.
2. Hoje o lojista tem **sucesso mudo** com id inexistente/alheio: a UI diz "salvo", nada mudou, e
   ele não tem como saber. Não é falha de segurança (a RLS + `.eq("loja_id")` já impedem a escrita),
   é mentira de interface.
3. Sem oráculo: a frase de alheio é **a mesma** de inexistente (`MSG_SALVAR`/`MSG_REMOVER`/
   `MSG_CONVERTER`), e sob RLS as duas já eram indistinguíveis para o cliente.
Mudança concreta no lojista: acrescentar `{ count: "exact" }` aos três `.update(…)`/`.delete(…)` e
o gate `cardapioPertenceALoja` em `converterExclusivosParaMenu` (antes de
`buscarProdutosQueFicariamOrfaos`).

*Não é falso positivo:* no Postgres o `UPDATE` conta linhas **casadas**, não alteradas — regravar o
mesmo valor devolve `count = 1`. Salvar sem mudar nada não vira recusa.

**D9 — revalidação.** `revalidatePath("/painel/cardapios")` invalida **só** aquele path (type
`page` é o default), **não** `/painel/cardapios/[cardapioId]` — que é exatamente a tela desta
feature. Hoje isso é um bug latente das actions de CRUD e vira bug real aqui.
- Lojista: `revalidarCaminhosDoCardapio(slug, cardapioId?)` ganha parâmetro opcional e, quando ele
  vem, `revalidatePath(`${ROTA_CARDAPIOS_LOJISTA}/${cardapioId}`)`. Caminho **concreto**, não a
  forma coringa nem `"layout"`: revalidar o layout derrubaria o cache do detalhe de todos os
  cardápios da loja sem necessidade. `ROTA_CARDAPIOS_LOJISTA` vem de `rotasCardapios.ts` — o
  literal não se reescreve (guard `rotaCardapiosInjetada.test.tsx`).
- Admin: `revalidarLojaAdmin(lojaId)` + `revalidatePath(`${rotaCardapiosAdmin(lojaId)}/${cardapio_id}`)`.
  `revalidarLojaAdmin` **não** ganha o parâmetro: ela é compartilhada por todas as actions admin da
  loja e cardápio não é assunto dela.
- Vitrine: já coberta — `/loja/${slug}` no lojista e `revalidatePath("/loja/[slug]", "page")` dentro
  de `revalidarLojaAdmin`.

---

### Cenários

**Caminho feliz (lojista).** 1) lojista marca "qua" na linha da Feijoada, dentro de
`/painel/cardapios/<id>` → 2) o client chama `definirDiasDoVinculo({cardapio_id, produto_id,
dias_semana:[3]})` → 3) `schemaDiasDoVinculo.safeParse` passa → 4) `createClient()` +
`buscarLojaDoDono` dão `loja.id`/`loja.slug` → 5) UPDATE `where loja_id ∧ cardapio_id ∧ produto_id`,
`dias_semana = [3]`, `count:"exact"` → 6) `count === 1` → 7) revalida detalhe + `/painel/cardapios` +
`/painel/produtos` + `/loja/<slug>` → 8) `{ ok: true }` (sucesso mudo, sem log).

**Caminho feliz (admin).** idêntico, com: `validarLojaIdAdmin(lojaId)` → `prepararContextoAdmin`
(prova de admin **antes** de `createServiceClient`, fora do `try` → exceção PROPAGA) →
`escopo.atualizarPorChave` → `count === 1` → `registrarAcessoAdmin(svc, { lojaId, acao:
"cardapio.definir_dias", entidadeId: cardapio_id, metadados: { produto_id, dias: n } })` →
`revalidarLojaAdmin` + detalhe → `{ ok: true }`.

**Casos de borda:**

| Entrada | Resposta | Onde é garantido |
|---|---|---|
| `dias_semana: []` | `{ok:true}`, banco recebe **`NULL`** | `normalizarDiasDoVinculo` (servidor) + CHECK de domínio |
| `dias_semana: [1,1,3]` | `{ok:true}`, banco recebe `[1,3]` | `normalizarDiasDoVinculo` |
| `dias_semana: [3,1]` | `{ok:true}`, banco recebe `[1,3]` (ordenado) | `normalizarDiasDoVinculo` |
| `dias_semana: [7]` / `[-1]` / `[1.5]` | `MSG_DIAS_DO_VINCULO`, **sem I/O** | zod (1ª barreira); CHECK é backstop |
| `dias_semana` com 8+ itens | `MSG_DIAS_DO_VINCULO`, sem I/O | `.max(7)` (CWE-770) |
| payload com `loja_id` extra | `MSG_DIAS_DO_VINCULO`, sem I/O | `.strict()` — RN-10 |
| `cardapio_id` não-UUID | `MSG_DIAS_DO_VINCULO`, sem I/O | `z.guid()` |
| `cardapio_id` de OUTRA loja | `MSG_DIAS_DO_VINCULO` | `count === 0`; no admin, **sem** `registrarAcessoAdmin` |
| `produto_id` de OUTRA loja | `MSG_DIAS_DO_VINCULO` | `count === 0` |
| par que existe mas **não está vinculado** | `MSG_DIAS_DO_VINCULO` — **byte a byte** igual ao alheio | `count === 0` (§14, sem oráculo) |
| sessão sem loja (`buscarLojaDoDono` → null) | `MSG_DIAS_DO_VINCULO` | guard na action |
| `lojaId` da URL não-UUID (admin) | `MSG_LOJA_INVALIDA`, **antes** de elevar | `validarLojaIdAdmin` |
| usuário não-admin chamando a action admin | **exceção propaga**, nada retorna | `verificarAdminSaaS` fora do `try` (fail-closed, D-4) |
| falha de rede / `error` do PostgREST | `MSG_DIAS_DO_VINCULO` + `console.error` | `if (error)` + `catch` |
| `23514` do CHECK de domínio | `MSG_DIAS_DO_VINCULO` na tela, texto cru no log | mesmo ramo |
| loja inativa / cardápio desligado | **salva normalmente** | agenda é configuração; `ativo` é RN-03 e não é assunto desta action |
| cardápio {sáb,dom} + item {qua} ("nunca abre") | **salva** + aviso de UX | RN-06 — aviso é [276], não bloqueio |

**Tratamento de erros.** Uma frase só na UI (`MSG_DIAS_DO_VINCULO`); `error`/`e` crus em
`console.error("[definirDiasDoVinculo]", …)` / `"[definirDiasDoVinculoAdmin]"`. `count === 0`
**não** vira log em nenhum dos dois mundos. Nenhum nome de constraint, SQLSTATE ou id chega à tela
(`seguranca.md` §14).

---

### Schema de Banco

**Nenhuma migration nova.** `cardapio_produtos.dias_semana smallint[]` e o CHECK
`cardapio_produtos_dias_semana_dominio` já existem (`20260921130000`, issue 272 — **entregue**).
Sem tabela nova ⇒ sem RLS nova e sem GRANT novo: as três policies de
`20260920129000_cardapio_produtos_fks_compostas_rls.sql` filtram por **linha**, não por coluna, e os
GRANTs são de tabela.

**RLS relevante, por camada:**

| Invariante | Lojista | Admin (`service_role`, BYPASSRLS) |
|---|---|---|
| escrever agenda só na própria loja | `cardapio_produtos_escrita_propria` + `.eq("loja_id", loja.id)` explícito | **RLS não vale.** `loja_id` do `lojaId` da URL validado, injetado por ÚLTIMO pelo wrapper |
| vínculo nunca cruza tenant | FK composta `(cardapio_id, loja_id)` / `(produto_id, loja_id)` | **mesma FK** — vale sob qualquer role |
| domínio 0..6 | CHECK `cardapio_produtos_dias_semana_dominio` | mesmo CHECK |
| prova de posse | `count === 0` ⇒ recusa | `count === 0` ⇒ recusa |

**Atenção de ambiente:** `20260921130000` é migration só-local se `npx supabase migration list`
mostrar a coluna Remote vazia. Sem ela aplicada no cloud, `definirDiasDoVinculo` devolve `PGRST204`
em runtime mesmo com build e suíte verdes (`CLAUDE.md`). Confirmar antes de `verificar`; o push é
irreversível e exige autorização.

---

### Validação (zod)

Schema ÚNICO em `src/lib/validacoes/cardapio.ts` (`schemaDiasDoVinculo`, D1), consumido por:
- a Server Action do lojista (`cardapio.ts`) — **segurança**;
- a Server Action admin (`admin-cardapios.ts`) — **segurança** (a única, já que a RLS não alcança);
- (nas issues [275]–[277]) o componente de pílulas — **UX**, mesmo símbolo.

`.strict()` é a barreira de RN-10: um `loja_id` pendurado no payload não é ignorado, é **recusado**
antes de qualquer I/O.

### Recálculo no Servidor

**Nenhum valor monetário nesta issue** — o payload é dois UUIDs e uma lista de inteiros 0..6. O que
o servidor não aceita do cliente, e deriva sozinho:

| Cliente envia | Servidor decide |
|---|---|
| `cardapio_id`, `produto_id`, `dias_semana` | — |
| — | **`loja_id`**: `buscarLojaDoDono(auth.uid())` (lojista) / `lojaId` da URL validado (admin). Nunca do payload (RN-10) |
| — | **a representação** de "todos os dias": `[]` → `NULL`, dedup, ordem (RN-11) |
| — | **se o par existe**: `count` do UPDATE, nunca um "existe?" perguntado antes |
| — | dia/hora/fuso de avaliação: nada disso entra aqui; quem avalia é `itemAberto` no SSR e em `criarPedido` (RN-04, já entregue pela 273) |

### Arquivos a Criar / Modificar / NÃO tocar

**Criar:** nenhum arquivo de produção. (A fase RED cria/estende testes — ver Ordem.)

**Modificar (produção):**

| Arquivo | Mudança |
|---|---|
| `src/lib/validacoes/cardapio.ts` | + `schemaDiasDoVinculo`; `eixoOuNulo` → `normalizarDiasDoVinculo` exportada (3 call sites internos) |
| `src/lib/actions/cardapio-contrato.ts` | + `MSG_DIAS_DO_VINCULO` |
| `src/lib/actions/admin-loja.ts` | + `EscopoLoja.atualizarPorChave` (com `throw` de chave vazia) |
| `src/lib/actions/cardapio.ts` | + `definirDiasDoVinculo`; `revalidarCaminhosDoCardapio(slug, cardapioId?)`; **D8:** `count:"exact"` + recusa em `atualizarCardapio`, `ligarDesligarCardapio`, `removerCardapio`; gate `cardapioPertenceALoja` em `converterExclusivosParaMenu` |
| `src/app/admin/assinantes/actions/admin-cardapios.ts` | + `definirDiasDoVinculoAdmin`; **D8:** leitura de `count` em `atualizarCardapioAdmin`, `ligarDesligarCardapioAdmin`, `removerCardapioAdmin` (recusa ANTES do log) + gate em `converterExclusivosParaMenuAdmin` |

**Modificar (testes — o `tdd` escreve o RED, ver §Contrato de teste):**
`src/app/admin/assinantes/actions/admin-cardapios.paridade.test.ts`,
`src/lib/actions/cardapio.test.ts` (ou `cardapio.crud.test.ts` para os casos de D8),
`src/lib/actions/admin-loja.test.ts`,
`src/lib/actions/cardapio-posse.enforcement.test.ts` (verbo `update` + forma de prova por `count`).

**NÃO tocar:**
- `src/components/ui/**` — gerado pelo shadcn CLI.
- `src/lib/utils/vigenciaCardapio.ts`, `catalogoVitrine.ts`, `descreverVigencia.ts` — motor de
  LEITURA, entregue pela 273. Esta issue é só escrita.
- `src/lib/supabase/queries/cardapios.ts` — nenhuma query nova; `ProdutoVinculado` ganhar os dias é
  a issue [278].
- `supabase/migrations/**` — nenhuma migration nova (272 já entregou a coluna).
- `src/app/admin/assinantes/enforcement-escopo-admin.test.ts` — camada 3 inalterada (D7).
- Qualquer componente (`SeletorProdutosDoCardapio`, `PilulasDeDias`, `FormVigencia`,
  `DialogoLoteCardapio`, `CardapioAdminClient`) — issues [275]–[278].
- `src/types/supabase.ts` — arquivo morto.

### Dependências Externas

**Nenhuma.** Nenhum pacote novo, nenhuma API externa, nenhuma key, nada sai do processo.
**Custo e quota (`architecture.md` §9 nº1):** custo variável **zero**. Nada de Upstash, Nominatim,
Sentry ou qualquer serviço tarifado por chamada entra neste caminho. O único custo incremental é de
banco: **um** round trip por toggle de pílula no lojista (o UPDATE), e **dois** no admin (o UPDATE +
o INSERT fire-and-forget de `admin_acessos`). Não há gate a estourar; o teto prático é o próprio
`.max(7)` do payload e a quantidade de linhas do cardápio. A decisão D6 (não chamar
`cardapioPertenceALoja`) **economiza** um round trip por escrita em relação ao padrão da 270.
Efeito colateral de custo a registrar: D9 acrescenta um `revalidatePath` por escrita — invalidação
de cache, não chamada tarifada.

### Ordem de Implementação

Issue **crítica** ⇒ **fase RED (`tdd`) antes de qualquer código de produção**, com output `FAIL`
real capturado.

1. **RED — contrato e normalização.** Casos de `schemaDiasDoVinculo` + `normalizarDiasDoVinculo`
   (função pura, teste ao lado do módulo) e o `throw` de `atualizarPorChave` com chave vazia em
   `admin-loja.test.ts`. São a base dos dois mundos; sem eles os testes de action testam ar.
2. **RED — escopo e paridade.** Os casos de `definirDiasDoVinculo`/`definirDiasDoVinculoAdmin` em
   `cardapio.test.ts` e `admin-cardapios.paridade.test.ts` (ver §Contrato de teste). **Primeiro** o
   harness (captura de `update` + opts), senão os casos de `count` passam vacuamente.
3. **RED — item absorvido (D8).** `count: 0` ⇒ `{ok:false}` **e** `logouAcesso() === false` nas
   quatro actions admin, + os espelhos do lojista.
4. **RED — guard estático da 270.** `update`/`atualizarPorChave` em `cardapio_produtos` no
   `cardapio-posse.enforcement.test.ts`, com a segunda forma de prova e os casos de LETALIDADE.
5. **GREEN — primitivos** (`validacoes/cardapio.ts` → `admin-loja.ts` → `cardapio-contrato.ts`).
   Ordem por dependência: as actions importam destes três.
6. **GREEN — `definirDiasDoVinculo`** (lojista). É o espelho de referência; o admin copia a forma,
   nunca o contrário.
7. **GREEN — `definirDiasDoVinculoAdmin`** + `registrarAcessoAdmin`.
8. **GREEN — item absorvido (D8)**, nas oito actions (quatro admin + quatro lojista). Por último
   porque é a mudança de comportamento mais ampla e não bloqueia as anteriores.
9. **GREEN — revalidação (D9)** nos dois mundos.
10. **Gates:** `npx vitest run` dos arquivos tocados → `npx tsc --noEmit` = 0 → `npm run lint` = 0 →
    `npm test` → **`npm run build`** (const exportada em `'use server'` só quebra aqui — e esta
    issue acrescenta constantes a `validacoes/` e `cardapio-contrato.ts`, que são módulos NEUTROS
    justamente por isso).

---

### Contrato de teste para o `tdd`

**Pré-requisito do harness (senão tudo passa vacuamente).** Em
`admin-cardapios.paridade.test.ts`, `queryChain.update` hoje descarta o 2º argumento e
`respostaDe` devolve `count: 1` por padrão. O RED precisa:
```ts
type Op = { …; update?: Record<string, unknown>; updateOpts?: unknown; … };
queryChain.update = (row, opts) => { op.update = row; op.updateOpts = opts; return queryChain; };
```
e um caso que afirme `op.updateOpts` = `{ count: "exact" }` — sem ele, "a action checa `count`" é
indistinguível de "a action recebeu `count:1` do mock por default".

**Memória do projeto aplicada:** *SQLSTATE não basta em teste de escopo.* Todo caso de recusa
afirma **o fragmento da mensagem** (`MSG_DIAS_DO_VINCULO`) **e** a linha/filtros capturados — nunca
só "não é ok".

**A — `definirDiasDoVinculo` / `definirDiasDoVinculoAdmin` (paridade byte a byte):**
| # | Caso | Asserção |
|---|---|---|
| A1 | caminho feliz `[3]` | existe UMA op em `cardapio_produtos` com `update.dias_semana === [3]`, `updateOpts = {count:"exact"}` e filtros **exatamente** `loja_id=<derivado>`, `cardapio_id`, `produto_id` — os três, nomeando a coluna |
| A2 | `dias_semana: []` | `update.dias_semana === null` (**não** `[]`) |
| A3 | `[1,1,3]` | `update.dias_semana` = `[1,3]` |
| A4 | `[3,1]` | `update.dias_semana` = `[1,3]` |
| A5 | payload com `loja_id: LOJA_OUTRA` | `{ok:false, erro: MSG_DIAS_DO_VINCULO}` e **`ops` vazio** (recusa antes do I/O) |
| A6 | `count: 0` (cardápio alheio) | `{ok:false, erro: MSG_DIAS_DO_VINCULO}` |
| A7 | `count: 0` (par inexistente) | resposta **byte a byte idêntica** a A6 — `expect(r6).toEqual(r7)` |
| A8 | admin, `count: 0` | `logouAcesso() === false` |
| A9 | admin, `count: 1` | log com `acao: "cardapio.definir_dias"`, `entidadeId: cardapio_id`, `metadados: { produto_id, dias: n }`; **sem** `nome` e sem o array cru — `expect(Object.keys(metadados)).toEqual(["produto_id","dias"])` |
| A10 | admin, `lojaId` não-UUID | `MSG_LOJA_INVALIDA` e `createServiceClient` **não** chamado |
| A11 | admin, `verificarAdminSaaS` lança | a Server Action **rejeita** (`rejects.toThrow`), não devolve `{ok:false}` |
| A12 | `error` do PostgREST | `MSG_DIAS_DO_VINCULO` + `console.error` chamado |
| A13 | `count: 0` | `console.error` **não** chamado |
| A14 | **paridade de frase** | a mesma string sai do lojista e do admin nos casos A5–A7 e A12, com a constante escrita à mão no teste (padrão já adotado no cabeçalho do arquivo) |
| A15 | revalidação | detalhe do cardápio revalidado (`/painel/cardapios/<id>` / `/admin/assinantes/<loja>/cardapios/<id>`) + vitrine; **nada** revalidado quando `count === 0` |

**B — item absorvido (D8), `count: 0` nas quatro admin + quatro lojista:**
`atualizarCardapio(Admin)`, `ligarDesligarCardapio(Admin)`, `removerCardapio(Admin)` ⇒
`{ok:false}` com `MSG_SALVAR`/`MSG_REMOVER` **e** `logouAcesso() === false`;
`converterExclusivosParaMenu(Admin)` com cardápio alheio ⇒ `MSG_CONVERTER`, `logouAcesso() === false`
e **`buscarProdutosQueFicariamOrfaos` não chamada** (o gate vem antes da leitura).
Um caso de regressão: `count: 1` com zero órfãos continua `{ok:true}` **e continua logando**.

**C — `atualizarPorChave` (`admin-loja.test.ts`):**
E1 chave vazia ⇒ **lança** (`expect(() => …).toThrow()`), e nenhuma op é emitida;
E2 chave de 2 colunas ⇒ filtros na ordem `loja_id`, depois as colunas da chave;
E3 `count:"exact"` presente;
E4 (tipo, via `npx tsc --noEmit`) patch com `loja_id` ou com uma coluna da chave **não compila**.

**D — guard estático (`cardapio-posse.enforcement.test.ts`):** o analisador passa a ver `update` e
`atualizarPorChave` em `cardapio_produtos`, com **duas** provas aceitas — `cardapioPertenceALoja(`
antes, **ou** o escopo pela tripla completa (`loja_id` + `cardapio_id` + `produto_id`) com
`count: "exact"`. LETALIDADE obrigatória (fixtures contra o MESMO analisador):
`.update(…).eq("loja_id", l)` sozinho ⇒ **reprovado**;
`.update(…).eq("loja_id", l).eq("cardapio_id", c)` (sem `produto_id`) ⇒ **reprovado**;
`.update(…, {count:"exact"}).eq("loja_id", l).eq("cardapio_id", c).eq("produto_id", p)` ⇒ aprovado;
`atualizarPorChave("cardapio_produtos", { cardapio_id, produto_id }, …)` ⇒ aprovado;
`atualizarPorChave("cardapio_produtos", { cardapio_id }, …)` ⇒ **reprovado**.
E o ANTI-VACUIDADE do arquivo sobe de `>= 4` para `>= 6` escritas descobertas.

### Riscos

| # | Risco | Mitigação |
|---|---|---|
| R1 | **Chave vazia em `atualizarPorChave`** degradaria para UPDATE da loja inteira sob `service_role` | `throw` no wrapper (D4) + caso E1. É o footgun novo desta issue |
| R2 | Teste de `count` **vacuamente verde**: o mock devolve `count:1` por default e descarta `{count:"exact"}` | pré-requisito do harness, acima. Sem ele, D8 inteiro é decorativo |
| R3 | Renomear `eixoOuNulo` toca `schemaCardapio` — regressão silenciosa na vigência do **cardápio** | `cardapio-contrato.test.ts` e `cardapio.crud.test.ts` têm de continuar verdes sem edição; a mudança é de nome, não de corpo |
| R4 | D8 muda comportamento de 8 actions: um teste que hoje afirma `{ok:true}` com mock devolvendo `count: null`/`undefined` **quebra** | a recusa é só em `count === 0` **estrito** — `null`/`undefined` (resposta sem `count:"exact"`) NÃO recusa. Fail-open deliberado aqui: fail-closed transformaria qualquer mock desatualizado em recusa em produção |
| R5 | Migration `20260921130000` só-local ⇒ `PGRST204` em runtime com CI verde | `npx supabase migration list` antes de `verificar`; push exige autorização |
| R6 | D7 diverge do texto da issue ("visível à camada 3") | registrado com os três fatos; o guard que cresce é o da 270 |
| R7 | D3 troca `MSG_GENERICA_LOTE` (pedido literal) por `MSG_DIAS_DO_VINCULO` | invariante de segurança idêntico nos dois; é troca de **uma linha** se a preferência for a outra |
| R8 | `dias: n` no log admin com `n = 0` é ambíguo entre "desmarcou tudo" e "não mandou nada" | aceito: `[]` e `null` são semanticamente idênticos no banco (RN-11), então a ambiguidade não existe no domínio |
