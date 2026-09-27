# Plano técnico · Frequência de exibição por item e por categoria (issues 320–323)

gerado: arquitetar (P2 de `plan/loop-frequencia-exibicao.md`) · 2026-09-27 · branch `feat/frequencia-exibicao`
Spec: `specs/frequencia-exibicao.md` · Issues: `tasks/320..323` · Complexidade: **alta**

Tudo o que este plano afirma sobre código atual foi conferido com `arquivo:linha` na branch
`feat/frequencia-exibicao` (HEAD `40aa8c3`). Nenhuma decisão RN-1/RN-2/S1–S6 foi reaberta.

---

## Decisões do usuário (2026-09-27)

Registradas no spec como RN-7 e RN-8 (`specs/frequencia-exibicao.md`, §Regras de negócio). Elas
substituem os dois defaults da versão anterior deste plano.

1. **RN-7 · período encerrado some.** Produto com período 01/12–31/12 visto em 15/01 fica **ausente**
   da vitrine. Categoria com período 01/12–31/12 (produtos sem período próprio) vista em 15/01 some,
   **com os produtos**. Antes de `periodo_inicio`, produto e categoria aparecem **indisponíveis**
   (RN-2/RN-3 inalterados). O servidor recusa na compra nos dois casos. O dia civil é o da loja
   (`diaNoFuso`, `fusoLoja.ts:160`). Onde isso mora: D12.
2. **RN-8 · nenhum dia marcado = nunca.** `dias_semana = '{}'` é **gravável** e significa "nunca
   disponível". O item fica visível e sempre indisponível; na categoria, todos os itens ficam
   indisponíveis. NULL continua sendo "todo dia", e 7 dias distintos continuam normalizados para NULL.
   `[]` e NULL são **dois estados distintos** em todas as camadas: D2 e D13.

Não sobrou dúvida bloqueante.

Correção de premissa do pedido do P2 (não é dúvida): `visibilidadeDe`
(`src/lib/utils/vigenciaCardapio.ts:254`) é **fail-OPEN** (valor desconhecido vira `'menu'`,
comentário em :247-253). O padrão **fail-closed** é `paraCardapioVigencia` (`:228`). O avaliador
novo segue o fail-closed (dado malformado ⇒ indisponível), porque ele decide **compra**.

---

## Diagnóstico

**Causa raiz.** Hoje "este produto pode ser comprado agora?" depende de uma entidade externa ao
produto (o cardápio, via `cardapio_produtos`) e de um modo por produto (`visibilidade`), avaliado por
`avaliarVigenciaDoProduto` (`vigenciaCardapio.ts:200`), que curto-circuita `'menu'` (`:206-208`).
A regra nova coloca a janela **no próprio produto e na própria categoria**. A troca exige:
(a) colunas de frequência com CHECKs; (b) um avaliador puro **único**, consumido pelos três caminhos
que hoje leem cardápio (vitrine SSR, `revisarCarrinhoAction`, `criarPedido`); (c) o banco esconder a
categoria oculta e os produtos dela da API pública. Um remendo seria acrescentar "frequência" como
mais um guard em cada caminho, ao lado do cardápio. A saída correta é trocar a fonte da decisão nos
três de uma vez e deixar o cardápio sem nenhum leitor no caminho de compra.

**Por que é complexo.**
- Muda o contrato público `vitrine_produtos` (view definer `security_barrier`, lida por todas as lojas).
  Uma coluna a menos derruba a vitrine inteira sem erro de CI (risco R1 da 245).
- Muda a regra de comprabilidade autoritativa (`seguranca.md` §10) em `criarPedido` e na paridade
  preview↔autoritativo (§10-A).
- Escrita em lote cross-loja nos dois mundos (lojista sob RLS, admin sob `service_role`/BYPASSRLS).
- `UPDATE` de dado de produção (8 produtos da Alma Bragantina) numa migration irreversível no cloud.
- Efeito cascata em fixtures tipadas como linha inteira (`Tables<"produtos">`), que o `tsc` do CI
  checa (`tsconfig.json:25-33` inclui `**/*.ts`).

---

## Mapa de Impacto

```
Banco (I1)
  produtos    + dias_semana, hora_inicio, hora_fim, periodo_inicio, periodo_fim (+4 CHECKs)
  categorias  + as mesmas 5 + oculta (+4 CHECKs)
  policy categorias_leitura_publica ← passa a exigir oculta = false          [RLS, AUTORITATIVO p/ anon]
  view vitrine_produtos ← +5 colunas no fim, exclui produto de categoria oculta [definer, AUTORITATIVO p/ anon]
  rpc aplicar_frequencia_em_produtos / salvar_grade_de_dias (INVOKER)        [AUTORITATIVO p/ escrita em lote]
  UPDATE produtos 'cardapio' → 'menu'                                        [dado]

Regra de compra (I2): fonte única src/lib/utils/frequencia.ts
  ├── app/(publica)/loja/[slug]/page.tsx → projetarCatalogoVitrine            [SSR, preview de UX]
  ├── lib/actions/revisarCarrinho.ts (buscarCategorias svc)                   [preview, mesma função]
  └── lib/actions/pedido.ts (buscarCategorias svc) → recusa antes da RPC      [AUTORITATIVO, ignora cliente]
       cliente envia só produto_id+quantidade; frequência/categoria/oculta vêm do banco

Escrita (I3): contrato único src/lib/actions/frequencia-contrato.ts + src/lib/validacoes/frequencia.ts
  ├── lib/actions/produto.ts (lojista: createClient + buscarLojaDoDono → rpc / update .eq loja_id, count)
  └── admin/assinantes/actions/admin-produtos.ts + admin-categorias.ts
        (validarLojaIdAdmin → zod → prepararContextoAdmin → svc.rpc(p_loja_id=URL) / escopo.atualizar)

UI (I4)
  vitrine: page.tsx (sem cardápio) → CatalogoVitrine (sem destaque) → rotuloEsgotado (rótulo pronto)
  painel:  produtos/page.tsx → ProdutosClient → {DialogoFrequencia, GradeFrequencia, BarraSelecaoFrequencia,
           GerenciarCategorias(+oculta/frequência), FormProduto(sem RadioGroup)}
  admin:   [lojaId]/produtos/page.tsx → CardapioAdminClient → ProdutosClient (mesmas peças, actions *Admin)
  nav:     NavPainel.tsx (sem "Cardápios", vale para os dois mundos)
  modal sazonal: configuracoes/promocoes/{page.tsx, PromocoesClient.tsx} (sem eixo cardápios, S6)
```

### Invariantes e camada que as garante

| Invariante | Cliente (UX) | Server Action | RLS / view / CHECK / RPC |
|---|---|---|---|
| Produto fora da frequência não é comprado | card marcado (`projetarCatalogoVitrine`) | `criarPedido` recusa com `ERRO_FORA_DA_JANELA` antes da RPC | — (janela é função pura, nunca SQL — mesma regra RN-06 do cardápio) |
| Produto de categoria oculta não é comprado nem listado | omitido no SSR | `criarPedido` → `ERRO_GENERICO` | view exclui; policy de `categorias` esconde a categoria de anon |
| Período encerrado (produto ou categoria) não é comprado nem listado (RN-7) | omitido no SSR (`encerrado`) | `criarPedido` → `ERRO_FORA_DA_JANELA` (D12) | — (depende do dia civil da loja; a view não tem fuso, D12) |
| `dias_semana = []` = nunca, distinto de NULL = todo dia (RN-8) | card marcado | idem fora da frequência | CHECK aceita `{}`; RPC exige a chave presente (D13) |
| Frequência coerente | zod no form | zod `.strict()` antes do I/O | 8 CHECKs nomeados (23514) |
| Escrita só na própria loja | — | `p_loja_id` = `buscarLojaDoDono` / `lojaId` do `prepararContextoAdmin` | RLS `produtos_escrita_propria` (lojista) + `loja_id = p_loja_id` + `row_count` no corpo (os dois) |
| Grade/seleção tudo ou nada | — | uma chamada RPC | transação da RPC + exceção |

---

## Decisões de Design

### D1 · Nomes das colunas: sem prefixo, iguais aos de `cardapios`
- (a) `dias_semana`, `hora_inicio`, `hora_fim`, `periodo_inicio`, `periodo_fim`: os mesmos nomes e
  tipos de `cardapios` (`20260920128000:50-53`) e da issue. O shape `Frequencia` é idêntico para
  produto e categoria (um tipo, dois donos) e o `Pick` do tipo gerado serve aos dois.
- (b) Prefixo `frequencia_*`: mais explícito, mas nomes longos na view pública e dois vocabulários
  para o mesmo eixo.
- **Escolhida: (a).** O risco de confundir `periodo_*` com `desconto_inicio/fim` é coberto pelo
  comentário de coluna na migration.

### D2 · `dias_semana`: três estados, NULL (todo dia) × `[]` (nunca, RN-8) × subconjunto
- O CHECK de domínio **aceita** `'{}'`: é só `dias_semana is null or dias_semana <@ array[0..6]`.
  `<@` é verdadeiro para `{}` (precedente: `cardapio_produtos_dias_semana_dominio`,
  `20260921130000:52-57,62-67`).
- A normalização é **própria**, `normalizarDiasDaFrequencia` em `validacoes/frequencia.ts`:
  `null → null`; `[] → []`; deduplica e ordena; 7 distintos `→ null`. **Não** reusar
  `normalizarDiasDoVinculo` (`validacoes/cardapio.ts:260-265`): ela faz `[] → null` (`:263`), o
  **oposto** de RN-8. É o desvio registrado em relação ao "importar, não copiar" da seção Reuso do
  loop.
- 7 dias distintos ⇒ NULL (uma representação para "todo dia"). Não existe normalização inversa
  (NULL nunca vira `[]`).

### D3 · Período `date` com pontas independentes (meio-aberto permitido)
- `periodo_inicio` sem `periodo_fim` = "a partir de"; só `periodo_fim` = "até". Mesmo espírito do
  prazo de desconto aberto de um lado. CHECK só de ordem quando as duas pontas existem, com `>=`
  (S1: inclusivo nas duas pontas, então um dia só é válido).
- Mensagem nova `MSG_PERIODO_ORDEM`. **Não** reusar `MSG_PRAZO_ORDEM` (`validacoes/cardapio.ts:163`,
  "precisa ser depois"): com ponta inclusiva, fim = início é válido e a frase estaria errada.

### D4 · A view mantém o predicado de cardápio no WHERE
- (a) Tirar o braço `visibilidade = 'menu' or exists(...)`: SQL mais simples. Mas reabre, para `anon`,
  o rascunho de quem gravar `'cardapio'` direto pelo PostgREST, e quebra os testes [h]..[m] de
  `produtos_exclusivo_trigger_e_vitrine_visibilidade.test.ts:613-680` sobre uma feature morta.
- (b) Manter: depois da migração 100% dos produtos são `'menu'`, e o 1º braço curto-circuita
  (comentário D3 em `20260920132000:37-42`), então o `EXISTS` roda zero vezes. Nada muda para quem lê.
- **Escolhida: (b).** S5 fala do **avaliador TS** ignorar `visibilidade`. A view decide
  **existência pública da linha**, não comprabilidade.

### D5 · Categoria oculta é garantida no banco (policy + view), e o TS filtra de novo
- A view é definer e não passa por RLS de `categorias`. Por isso precisa de `NOT EXISTS` explícito.
- A policy `categorias_leitura_publica` (`20260614002000_rls_catalogo.sql:91-94`) ganha
  `oculta = false`: o nome da categoria oculta deixa de sair em `/rest/v1/categorias` (mesma
  preocupação do rascunho de cardápio, `20260920128000:133-136`). O dono continua vendo tudo pela
  `categorias_escrita_propria` (FOR ALL, `:96`).
- O TS filtra **também**, por dois motivos. (1) O dono logado visitando a própria vitrine lê a
  categoria oculta via a policy própria. (2) `agruparCatalogo` joga produto de categoria ausente da
  lista no grupo "Outros" (`queries/produtos.ts:127-128`). Categoria ausente do mapa é tratada como
  oculta (fail-closed).

### D6 · Atomicidade da grade e da seleção: duas RPCs `SECURITY INVOKER` com escopo explícito
- (a) PostgREST `update().in(ids)`: um valor para todas as linhas, então não serve para a grade
  (valor por linha). Para a seleção, id alheio é **ignorado em silêncio**. A prova exige recusa com
  fragmento de mensagem e zero linhas alteradas.
- (b) `upsert` com linhas parciais: caminho de INSERT com `nome`/`preco` NOT NULL e policy de INSERT
  no meio. Frágil.
- (c) RPC `SECURITY DEFINER` + T1..T7 (`seguranca.md` §"RPC de escrita em lote reusada por lojista E
  admin"): o lojista perde a RLS, trocada por trava T2 no corpo.
- (d) RPC `SECURITY INVOKER` com `p.loja_id = p_loja_id` no predicado do UPDATE + `row_count =
  cardinality`, `REVOKE ... FROM public, anon`, `GRANT ... TO authenticated, service_role`.
  Precedente literal: `reordenar_produtos` (`20260922120000`, INVOKER, grant a `service_role`,
  `p.loja_id = p_loja_id -- escopo explícito ALÉM da RLS`).
- **Escolhida: (d).** O lojista tem **duas** camadas: a RLS `produtos_escrita_propria` avaliada dentro
  da função, mais o filtro e a contagem. Se ele chamar a RPC direto com `p_loja_id` alheio, a RLS
  zera as linhas, a contagem diverge e a exceção desfaz tudo. O admin tem o filtro e a contagem com
  `p_loja_id` = `lojaId` do `prepararContextoAdmin` (`admin-loja.ts:236`). É exatamente a garantia
  que `EscopoLoja` dá às escritas admin (`.eq("loja_id")` + `count`). Com DEFINER, o T2 "é serviço"
  não acrescenta nada ao admin e **tira** a RLS do lojista.
  **Divergência registrada com a regra escrita de `seguranca.md`** ("DEFINER quando a via admin
  precisa do mesmo caminho"): a regra nasceu de RPCs cujo corpo não filtrava tenant. Aqui o corpo
  filtra. O `auditar` (P6) confere, e o `escriba` (P9) registra a variante.
- Por que não uma RPC só: a grade escreve **só** `dias_semana` por linha. Mandar hora/período de
  volta sobrescreveria edição concorrente feita em outra aba.
- Frequência unitária (um produto) = `aplicar_frequencia_em_produtos` com 1 id. Não existe terceiro
  caminho.
- Categoria (uma linha por vez) não precisa de RPC. Usa `update().eq("id").eq("loja_id")` com
  `count: "exact"` e `count !== 1` ⇒ recusa. O precedente fail-closed do débito 283 aplica-se porque
  o id é PK.

### D7 · Frequência fora do `schemaProduto`/`FormProduto`
- (a) Campos no `schemaProduto`: `atualizarProduto`/`atualizarProdutoAdmin` gravam a linha inteira
  (`produto.ts:129`, `admin-produtos.ts:223`). Todo teste de CRUD e de paridade de produto mudaria.
- (b) Editor próprio (`DialogoFrequencia`), aberto do kebab do produto, da barra de seleção e da
  categoria, sempre pela mesma action em lote.
- **Escolhida: (b).** Produto novo nasce permanente sem tocar no CRUD (colunas NULL por default).

### D8 · Avaliador: `avaliarFrequencia` puro + `avaliarFrequenciaNaLoja` (resolve a categoria)
- Motivo com três valores, `"categoria_oculta" | "encerrado" | "fora_da_frequencia"`, porque os
  consumidores distinguem exatamente esses três. Vitrine: omite, omite, marca. Pedido:
  `ERRO_GENERICO`, `ERRO_FORA_DA_JANELA`, `ERRO_FORA_DA_JANELA`. Distinguir "do produto" de "da
  categoria" não tem consumidor.
- Precedência: `categoria_oculta` > `encerrado` > `fora_da_frequencia`. Uma categoria oculta e
  encerrada responde oculta; um produto com `[]` e período encerrado responde encerrado (some, RN-7
  vence RN-8).
- O `MotivoNaoCompravel` da vitrine continua `"esgotado" | "fora_da_janela"`
  (`catalogoVitrine.ts:67`). Não entra motivo novo, porque o `encerrado` nunca chega ao cliente:
  ele é omitido antes.

### D12 · RN-7 mora no avaliador TS, não na view
- (a) Filtro na view (`periodo_fim < current_date`): `current_date` é o dia do **servidor Postgres**
  (UTC), não o da loja. Em Manaus às 21:00 de 31/12 o banco já está em 01/01, e o item sumiria 4h
  antes. É a mesma razão da RN-06 do cardápio: janela nunca vira SQL (`20260920132000:48-54`).
- (b) Estado `encerrado` no avaliador, calculado com `diaNoFuso(agora, timezone)`: o produto é
  omitido por `projetarCatalogoVitrine`, e a categoria encerrada sai de `categoriasVisiveis` com
  todos os produtos dela.
- **Escolhida: (b).** Consequência aceita: as colunas `periodo_*` ficam públicas na view (já estavam
  no C1). Um item encerrado continua legível em `/rest/v1/vitrine_produtos` com o período que o
  encerra. Não é segredo: é o mesmo dado que a vitrine mostraria antes de encerrar. Precedente: o
  produto de cardápio com prazo vencido também ficava dentro da view (teste [j],
  `produtos_exclusivo_trigger_e_vitrine_visibilidade.test.ts:641`).
- **Erro do pedido para `encerrado`: `ERRO_FORA_DA_JANELA`**, não `ERRO_GENERICO`. O caso real é o
  carrinho montado em 31/12 às 23:50 e confirmado em 01/01 às 00:05. `ERRO_FORA_DA_JANELA` ("…
  Revise o carrinho.", `pedido.ts:77-78`) manda o cliente à revisão, onde a linha aparece bloqueada
  (`revisarCarrinho.ts:247`, `fora_da_janela`). `ERRO_GENERICO` ("Tente novamente") o faria repetir o
  mesmo envio em loop. O `ERRO_GENERICO` da categoria oculta vem do RN-3 e esconde uma decisão
  editorial do lojista; aqui não há o que esconder, porque o período é público na view.
- A revisão do carrinho marca `encerrado` como `fora_da_janela`. A UI usa o fallback "Indisponível no
  momento" (`rotuloEsgotado.ts:51`, `ROTULO_SEM_VOLTA`), sem data a prometer.

### D13 · `[]` e NULL não se confundem em nenhuma camada (RN-8)
| Camada | Regra |
|---|---|
| CHECK | `{}` aceito; NULL aceito; `{7}` e `{-1}` recusados |
| RPC | `jsonb_to_record(set)` converte `[]` em `'{}'` e `null` em NULL, mas **chave ausente também vira NULL** (conferido no PGlite 0.5.3). Por isso as duas RPCs **exigem a chave presente**: `p_frequencia ?& array['dias_semana','hora_inicio','hora_fim','periodo_inicio','periodo_fim']`, e na grade cada elemento `? 'produto_id'` e `? 'dias_semana'`. Sem isso, um payload que esquecesse a chave viraria "todo dia" em silêncio |
| zod | `z.array(...).max(7).nullable()` **sem** `.min(1)`; as 5 chaves obrigatórias (`.strict()`, sem `.optional()`/`.nullish()`) |
| contrato/builders | copiam `dias_semana` como está; nenhum `?? null`, `\|\| null` nem `length ? … : null` |
| avaliador | `dias === null` ⇒ sem restrição; `dias.length === 0` ⇒ fora (sempre); nunca `!dias`/`dias?.length` |
| redação | `rotuloDiasDoItem`/`ordenarSemana` (`descreverVigencia.ts:372-375,436-440`) tratam `[]` como "sem restrição", então **não servem** à frequência. As funções novas testam `=== null` e `length === 0` antes de chamar `descreverDiasDaSemana` |
| `database.types.ts` | `number[] \| null` não distingue `[]` de NULL no tipo. A distinção é só de valor, travada pelos testes do P3 1 [c], 3 [a9]/[g6], 4, 5, 8 e 9 |
| UI | "Todos os dias" ⇒ `null`; "Dias específicos" sem pílula marcada ⇒ `[]` com o texto "Nunca disponível", sem erro. A grade com a linha toda desmarcada ⇒ `[]` |

### D9 · Migration em três arquivos
- `…130000` schema + policy + view · `…131000` RPCs · `…132000` só o `UPDATE` de dados.
- Isolar o `UPDATE` torna a migração de dados **testável de verdade**. No pglite o banco nasce vazio
  (`tests/helpers/pglite.ts:131-138`), então `count = 0` depois de `createTestDb()` é vácuo. O teste
  semeia um produto `'cardapio'` e **reexecuta** o arquivo `…132000`, que é idempotente.

### D10 · `database.types.ts`: patch manual determinístico agora, regen depois do push
- O `gen types` lê o cloud, e a migration só vai ao cloud no P7. Precedente: issue 146
  (`plan/arquivo/146-migration-admin-acessos-audit-log.md:63`) e `loop-modalidades-entrega-loja.md:95`.
- O P7 roda `npx supabase gen types typescript --linked > src/lib/database.types.ts` depois do
  `db push`. O diff esperado são as colunas e funções deste plano **mais** o que já estava atrasado:
  `modais_sazonais` tem 0 ocorrências hoje. Por isso `tsc` + `build` rodam de novo depois do regen.

### D11 · Cardápio na UI: some das superfícies, o código fica (S5)
- `/painel/produtos` e o hub admin deixam de passar `lote`, `sumicos` e o índice de vínculos (passam
  `{}`). O `RadioGroup` Menu/Cardápio sai do `FormProduto`. O bloco de aviso legado continua, e só
  renderiza para produto `'cardapio'` gravado por REST. As rotas `/painel/cardapios` e
  `/admin/.../cardapios` continuam existindo, fora do menu.
- `CatalogoVitrine.tsx`/`SecaoCatalogo.tsx` **não mudam**: `secoesDestaque`/`rotulosJanela` já são
  opcionais com default (`CatalogoVitrine.tsx:43,61-63,86-87`). A página só deixa de passá-las.

---

## Contrato

### C1 · Migrations (timestamps > `20260927125000`)

`supabase/migrations/20260928130000_frequencia_produtos_categorias.sql`

```
produtos   add column dias_semana smallint[], hora_inicio time, hora_fim time,
                      periodo_inicio date, periodo_fim date            -- nullable, sem default, sem backfill
categorias add column (as mesmas 5) + oculta boolean not null default false

-- nomes LITERAIS (os testes afirmam o nome na mensagem do 23514):
produtos_dias_semana_dominio    check (dias_semana is null
                                       or dias_semana <@ array[0,1,2,3,4,5,6]::smallint[])
                                  -- '{}' PASSA de propósito: RN-8 (nunca). Proibido usar cardinality/coalesce aqui
produtos_hora_par               check ((hora_inicio is null) = (hora_fim is null))
produtos_hora_ordem             check (hora_inicio is null or hora_fim > hora_inicio)
produtos_periodo_ordem          check (periodo_inicio is null or periodo_fim is null
                                       or periodo_fim >= periodo_inicio)
categorias_dias_semana_dominio  | categorias_hora_par | categorias_hora_ordem | categorias_periodo_ordem
                                  (mesmas expressões)
```

- `comment on column` em cada coluna nova: semântica S1–S3, "avaliada em TS
  (`src/lib/utils/frequencia.ts`), nunca em SQL". Em `dias_semana` o comentário diz, literal: "NULL =
  todo dia; '{}' = nunca (RN-8); 7 dias são gravados como NULL pela Server Action". Em `periodo_fim`:
  "depois dele, no dia civil da loja, o item/categoria some da vitrine (RN-7) — decidido em TS".
- Policy: `alter policy "categorias_leitura_publica" on public.categorias using (oculta = false and
  public.loja_esta_ativa(categorias.loja_id));`
- View: `create or replace view public.vitrine_produtos with (security_invoker = false,
  security_barrier = true) as select` com as **15 colunas literais de `20260920132000:85-104`, na
  mesma ordem**, seguidas de `p.dias_semana, p.hora_inicio, p.hora_fim, p.periodo_inicio,
  p.periodo_fim` (colunas 16..20). O WHERE fica literal a `:106-120` com mais um AND:
  `and not exists (select 1 from public.categorias c where c.id = p.categoria_id and c.oculta = true)`.
  O produto sem categoria (`categoria_id` NULL) passa.
- No **mesmo arquivo**: `comment on view` atualizado, `revoke all on public.vitrine_produtos from
  anon, authenticated; grant select on public.vitrine_produtos to anon, authenticated;` (guarda [G4],
  `tests/migrations/vitrine_lojas_select_only.test.ts:298-302`).
- Rollback comentado no fim: drop + create literal da `20260920132000:81-127` (15 colunas; o
  `create or replace` não remove coluna, 42P16), `alter policy` de volta, drop das constraints e das
  colunas. Ordem: reverter o código que nomeia as colunas **antes** (senão 42703).

`supabase/migrations/20260928131000_rpc_frequencia_produtos.sql`

```
public.aplicar_frequencia_em_produtos(p_loja_id uuid, p_ids uuid[], p_frequencia jsonb) returns integer
public.salvar_grade_de_dias(p_loja_id uuid, p_itens jsonb) returns integer
  language plpgsql · security invoker · set search_path = public, pg_temp
  revoke all on function … from public, anon; grant execute on function … to authenticated, service_role;
```

Corpo e mensagens (P0001 = `raise exception`; os testes afirmam SQLSTATE **e** fragmento):

| Função | Trava | Mensagem literal |
|---|---|---|
| aplicar | `coalesce(cardinality(p_ids),0) = 0` | `aplicar_frequencia_em_produtos: lista vazia` |
| aplicar | `> 200` (espelha `TETO_LOTE`, `validacoes/produto.ts:45`) | `aplicar_frequencia_em_produtos: lista acima do teto` |
| aplicar | `count(distinct) <> cardinality` | `aplicar_frequencia_em_produtos: ids repetidos` |
| aplicar | `p_frequencia` nulo, `jsonb_typeof <> 'object'` ou **sem alguma das 5 chaves** (`not (p_frequencia ?& array['dias_semana','hora_inicio','hora_fim','periodo_inicio','periodo_fim'])`, D13) | `aplicar_frequencia_em_produtos: frequencia invalida` |
| aplicar | `row_count <> v_enviadas` depois de `update public.produtos p set <5 colunas> = f.* where p.id = any(p_ids) and p.loja_id = p_loja_id` | `aplicar_frequencia_em_produtos: % ids, % linhas afetadas` |
| grade | array ausente/vazio (`jsonb_typeof <> 'array'` ou `jsonb_array_length = 0`) | `salvar_grade_de_dias: lista vazia` |
| grade | `> 200` | `salvar_grade_de_dias: lista acima do teto` |
| grade | algum elemento que não é objeto ou não tem as chaves `produto_id` **e** `dias_semana` (`exists (select 1 from jsonb_array_elements(p_itens) e where jsonb_typeof(e) <> 'object' or not (e ? 'produto_id') or not (e ? 'dias_semana'))`, D13) | `salvar_grade_de_dias: item incompleto` |
| grade | `produto_id` nulo ou repetido | `salvar_grade_de_dias: ids repetidos ou ausentes` |
| grade | `row_count <> v_enviadas` depois de `update public.produtos p set dias_semana = x.dias_semana from jsonb_to_recordset(p_itens) as x(produto_id uuid, dias_semana smallint[]) where p.id = x.produto_id and p.loja_id = p_loja_id` | `salvar_grade_de_dias: % itens, % linhas afetadas` |

- `f` sai de `jsonb_to_record(p_frequencia) as f(dias_semana smallint[], hora_inicio time, hora_fim
  time, periodo_inicio date, periodo_fim date)`. Conversão de array JSON → `smallint[]` conferida no
  PGlite 0.5.3 (Postgres 18.3) desta máquina. `[]` vira `'{}'` (não NULL), `null` vira NULL e
  **chave ausente vira NULL**; daí a trava de chaves acima. Valor inválido (`"x"`) dá 22P02 e `[7]`
  dá 23514 do CHECK. Os dois desfazem a transação inteira.
- Nenhuma das RPCs usa `coalesce`/`cardinality` sobre `dias_semana` (confundiria `{}` com NULL).
- A grade toca **só** `dias_semana`. Hora e período ficam como estão.

`supabase/migrations/20260928132000_frequencia_cardapio_volta_ao_menu.sql`

```
update public.produtos set visibilidade = 'menu' where visibilidade = 'cardapio';
```
- Idempotente. Não toca `cardapio_produtos`/`cardapios`. O trigger RN-14 só dispara `when
  (new.visibilidade = 'cardapio')` (`20260920131000_produtos_exclusivo_trigger.sql:115-120`), então
  não bloqueia a volta ao menu. Não converte nada em frequência (RN-4).
- Rollback: ids em `plan/rollback-frequencia-exibicao.local.md` (P0, local, não versionado) →
  `update … set visibilidade='cardapio' where id in (…)`. Os vínculos seguem intactos, então o
  trigger aceita.

### C2 · Tipos e avaliador — `src/lib/utils/frequencia.ts` (módulo puro, sem `Intl`)

```ts
export type Frequencia = {
  dias_semana: number[] | null;    // 0=dom..6=sáb; NULL = todo dia; [] = NUNCA (RN-8)
  hora_inicio: string | null;      // "HH:MM" ou "HH:MM:SS" (time do PG); INCLUSIVO
  hora_fim: string | null;         // EXCLUSIVO; par com hora_inicio
  periodo_inicio: string | null;   // "YYYY-MM-DD"; INCLUSIVO
  periodo_fim: string | null;      // "YYYY-MM-DD"; INCLUSIVO; depois dele = encerrado (RN-7)
};
export type CategoriaFrequencia = Frequencia & { oculta: boolean };
export const FREQUENCIA_PERMANENTE: Frequencia;               // os 5 null
export type MotivoIndisponivel = "categoria_oculta" | "encerrado" | "fora_da_frequencia";
export type AvaliacaoFrequencia =
  | { disponivel: true; motivo: null }
  | { disponivel: false; motivo: MotivoIndisponivel };
export type Combinacao = { vazia: true } | { vazia: false; frequencia: Frequencia };

export function frequenciaDe(row: Frequencia): Frequencia;    // copia os 5 campos, nada mais
export function periodoEncerrado(f: Frequencia, agora: Date, timezone: string): boolean;   // RN-7
export function dentroDaFrequencia(f: Frequencia, agora: Date, timezone: string): boolean;
export function avaliarFrequencia(
  produto: Frequencia, categoria: CategoriaFrequencia | null, agora: Date, timezone: string,
): AvaliacaoFrequencia;
export function avaliarFrequenciaNaLoja(
  produto: Frequencia & { categoria_id: string | null },
  categoriasPorId: ReadonlyMap<string, CategoriaFrequencia>,
  agora: Date, timezone: string,
): AvaliacaoFrequencia;
export function categoriaVisivel(c: CategoriaFrequencia, agora: Date, timezone: string): boolean;
  // !c.oculta && !periodoEncerrado(c) — a MESMA regra que a vitrine usa para `categoriasVisiveis`
export function combinarFrequencias(a: Frequencia, b: Frequencia | null): Combinacao;
export function frequenciaNuncaAbre(produto: Frequencia, categoria: Frequencia | null): boolean;
```

`combinarFrequencias` devolve um objeto discriminado e não `Frequencia | null`, porque `null` ao
lado de campos que também usam `null` ("sem restrição") seria a confusão que D13 proíbe. Uma
interseção de dias vazia produz `{ vazia: true }`, não `dias_semana: []`.

Regras:
- `periodoEncerrado(f)` = `f.periodo_fim !== null && diaNoFuso(agora, tz) > f.periodo_fim`
  (`fusoLoja.ts:160`; compara strings `YYYY-MM-DD`). Com `periodo_fim` malformado ⇒ **true**
  (fail-closed: some e não vende).
- `dentroDaFrequencia` usa `partesNoFusoCompletas(agora, tz)` (`fusoLoja.ts:47`) para
  `diaIndex`/`minutos`, `diaNoFuso` para o dia civil e `paraMinutos` (`:84`, aceita "HH:MM:SS").
  Período: `hoje < inicio` ⇒ fora; `hoje > fim` ⇒ fora. Dia: `dias === null` ⇒ ok;
  `dias.length === 0` ⇒ **fora sempre** (RN-8, semântica e não defeito);
  `!dias.includes(diaIndex)` ⇒ fora. Hora: `minutos >= ini && minutos < fim`.
- **Fail-closed** (espelho de `paraCardapioVigencia`, `vigenciaCardapio.ts:228-231`) para estados que
  os CHECKs tornam impossíveis: só uma ponta de hora, hora que não vira número finito, período fora
  de `/^\d{4}-\d{2}-\d{2}$/` ⇒ fora. Se aparecerem, o produto não é vendido.
- `avaliarFrequencia` avalia nesta ordem:
  1. `categoria?.oculta` ⇒ `categoria_oculta`;
  2. `periodoEncerrado(categoria)` **ou** `periodoEncerrado(produto)` ⇒ `encerrado`;
  3. categoria fora ⇒ `fora_da_frequencia`;
  4. produto fora ⇒ `fora_da_frequencia`;
  5. senão `{ true, null }`.

  O **antes de `periodo_inicio`** cai no passo 3/4 (visível e indisponível, RN-2/RN-3). **Ignora
  `visibilidade`** (S5). A interseção RN-1 sai de graça do AND.
- `avaliarFrequenciaNaLoja`: `categoria_id === null` ⇒ só o produto. Id ausente do mapa ⇒
  `{ false, "categoria_oculta" }` (fail-closed: categoria de outra loja, removida ou escondida pela
  RLS).
- `frequenciaNuncaAbre` (RN-1/RN-8, preview do painel) é true quando:
  - `combinarFrequencias(...).vazia`;
  - `dias_semana` de um dos lados é `[]`;
  - ou o período está fechado nas duas pontas, com ≤ 7 dias e `dias_semana` não nulo, e nenhuma
    data do intervalo cai num dia da semana civil marcado (`Date.UTC(...).getUTCDay()`, aritmética de
    data e não de fuso).

  Senão false. Não olha `agora`: o "já encerrou" é outro aviso (C8).

### C3 · Validação — `src/lib/validacoes/frequencia.ts`

- Importa de `validacoes/cardapio.ts` `MSG_HORA_PAR`, `MSG_HORA_ORDEM` (`:159-161`) e `horaDoDia`
  (`:184`). `horaDoDia` passa a ser `export const`, única mudança naquele arquivo. **Não** importa
  `normalizarDiasDoVinculo` (`:260`), porque ela faz `[] → null` (D2).
- Mensagem nova: `MSG_PERIODO_ORDEM = "A data de fim não pode ser antes da de início."`. Não existe
  mensagem de "dias vazios": `[]` é válido (RN-8).
- `export function normalizarDiasDaFrequencia(dias: number[] | null): number[] | null`: `null → null`;
  `[] → []`; `[...new Set(dias)].sort((a, b) => a - b)`; 7 distintos `→ null`. Devolve array novo.
- `diasDaFrequencia = z.array(z.number().int().min(0).max(6)).max(7).nullable().transform(normalizarDiasDaFrequencia)`,
  **sem `.min(1)`**. Duplicatas contam no `.max(7)` antes do dedup, e isso é suficiente: a grade e o
  editor nunca mandam duplicata.
- `schemaFrequencia = z.object({ dias_semana, hora_inicio: horaDoDia.nullable(), hora_fim:
  horaDoDia.nullable(), periodo_inicio: z.iso.date().nullable(), periodo_fim: z.iso.date().nullable()
  }).strict()`. As **5 chaves são obrigatórias** (null explícito = sem restrição). `superRefine`:
  par de hora ⇒ `MSG_HORA_PAR`; `fim <= inicio` ⇒ `MSG_HORA_ORDEM`; `periodo_fim < periodo_inicio` ⇒
  `MSG_PERIODO_ORDEM`. `z.iso.date()` conferido no zod 4.4.3 instalado (recusa `2026-02-30`).
- `schemaAplicarFrequencia = z.object({ produto_ids: z.array(z.guid()).min(1).max(TETO_LOTE)` + refine
  unicidade, `frequencia: schemaFrequencia }).strict()`
- `schemaGradeDeDias = z.object({ itens: z.array(z.object({ produto_id: z.guid(), dias_semana:
  diasDaFrequencia }).strict()).min(1).max(TETO_LOTE)` + refine de `produto_id` único `}).strict()`
- `schemaFrequenciaCategoria = z.object({ categoria_id: z.guid(), frequencia: schemaFrequencia }).strict()`
- Ocultar categoria segue o molde posicional de `alternarExibirImagens(id, bool)` (`produto.ts:381`):
  `typeof oculta === "boolean"` + `schemaIdProduto` (`z.guid()`, `validacoes/produto.ts:225`) no id.

### C4 · Contrato compartilhado lojista/admin — `src/lib/actions/frequencia-contrato.ts` (neutro, sem `'use server'`, sem I/O)

Molde: `produto-contrato.ts` / `cardapio-contrato.ts` (`architecture.md` §8).

```ts
export const MSG_SALVAR_FREQUENCIA = "Não foi possível salvar a frequência.";
export const MSG_CATEGORIA_NAO_ENCONTRADA = "Categoria não encontrada.";   // literal já usado em admin-categorias.ts
export function mensagemDeFrequencia(issues: readonly { message: string }[]): string;
  // promove só MSG_HORA_PAR | MSG_HORA_ORDEM | MSG_PERIODO_ORDEM; senão MSG_SALVAR_FREQUENCIA
export function argsAplicarFrequencia(lojaId: string, d: DadosAplicarFrequencia):
  { p_loja_id: string; p_ids: string[]; p_frequencia: Frequencia };
export function argsGradeDeDias(lojaId: string, d: DadosGradeDeDias):
  { p_loja_id: string; p_itens: { produto_id: string; dias_semana: number[] | null }[] };
export function patchFrequenciaCategoria(f: Frequencia): Frequencia;      // só as 5 chaves
```

`p_loja_id` é **sempre** o primeiro argumento do builder (`buscarLojaDoDono`/`prepararContextoAdmin`)
e nunca vem do payload. O `.strict()` recusa `loja_id` no corpo. Os builders emitem **sempre as 5
chaves** de `p_frequencia` e **sempre** `dias_semana` em cada item da grade, com o valor já
normalizado (`[]` continua `[]`). É o par da trava de chaves das RPCs (D13).

### C5 · Server Actions

Lojista (`src/lib/actions/produto.ts`, client autenticado, nunca `service_role`):

| Action | Assinatura | I/O |
|---|---|---|
| `aplicarFrequenciaEmProdutos` | `(payload: unknown) → ResultadoGestaoProduto` | zod → `createClient` → `buscarLojaDoDono` (null ⇒ `"Loja não encontrada."`) → `supabase.rpc("aplicar_frequencia_em_produtos", argsAplicarFrequencia(loja.id, …))` |
| `salvarGradeDeDias` | `(payload: unknown) → ResultadoGestaoProduto` | idem com `salvar_grade_de_dias` |
| `alternarOcultaCategoria` | `(id: string, oculta: boolean) → ResultadoGestaoCategoria` | `update({ oculta }, { count: "exact" }).eq("id", id).eq("loja_id", loja.id)`; `count !== 1` ⇒ `MSG_CATEGORIA_NAO_ENCONTRADA` |
| `definirFrequenciaCategoria` | `(payload: unknown) → ResultadoGestaoCategoria` | idem com `patchFrequenciaCategoria` |

- Erro de banco ⇒ `console.error("[nome]", e)` + `MSG_SALVAR_FREQUENCIA` (ou a genérica de categoria).
  **Nunca** a mensagem da RPC (§14: "linhas afetadas" seria oráculo de existência).
- `revalidatePath("/painel/produtos")` + `revalidatePath(\`/loja/${loja.slug}\`)`, no padrão de
  `reordenarProdutos` (`produto.ts:615-616`). **Não** usar `CAMINHO_PAINEL` (`:42`, rota inexistente,
  `architecture.md` §10).

Admin (`service_role`, `lojaId` da URL), ordem D-4 `validarLojaIdAdmin → zod → prepararContextoAdmin`
(fora do try) `→ escrita → registrarAcessoAdmin → revalidarLojaAdmin`:

| Arquivo | Action | Escrita |
|---|---|---|
| `admin-produtos.ts` | `aplicarFrequenciaEmProdutosAdmin(lojaId, payload)` | `svc.rpc("aplicar_frequencia_em_produtos", argsAplicarFrequencia(loja.lojaId, …))`; log `acao: "produto.frequencia_lote"`, `metadados: { produtos: n }` |
| `admin-produtos.ts` | `salvarGradeDeDiasAdmin(lojaId, payload)` | `svc.rpc("salvar_grade_de_dias", …)`; `acao: "produto.grade_dias"` |
| `admin-categorias.ts` | `alternarOcultaCategoriaAdmin(lojaId, id, oculta)` | `escopo.atualizar("categorias", id, { oculta })`; `!count` ⇒ `MSG_CATEGORIA_NAO_ENCONTRADA`; `acao: "categoria.oculta"` |
| `admin-categorias.ts` | `definirFrequenciaCategoriaAdmin(lojaId, payload)` | `escopo.atualizar("categorias", id, patchFrequenciaCategoria(…))`; `acao: "categoria.frequencia"` |

`svc.rpc` fica fora do alcance da camada 3 de `enforcement-escopo-admin.test.ts` (que casa
`.from(t)…update/insert/upsert/delete`). O escopo aqui é o `p_loja_id` do contexto, provado pelo
teste de paridade.

### C6 · Payloads (cliente → action)

```jsonc
// seleção múltipla e unitária
{ "produto_ids": ["uuid", …], "frequencia": { "dias_semana": [1,2,3,4,5] | null,
  "hora_inicio": "11:00" | null, "hora_fim": "15:00" | null,
  "periodo_inicio": "2026-12-01" | null, "periodo_fim": "2026-12-31" | null } }
// grade (só as linhas alteradas; tudo ou nada)
{ "itens": [ { "produto_id": "uuid", "dias_semana": [6] | [] | null }, … ] }
// dias_semana: null = todo dia · [] = nunca (RN-8) · a chave é SEMPRE enviada (ausente ⇒ recusa)
// frequência de categoria
{ "categoria_id": "uuid", "frequencia": { …as mesmas 5 chaves… } }
```

### C7 · Vitrine

- `src/lib/supabase/queries/produtos.ts`: `ProdutoPublico` (`:53-73`) passa a incluir as 5 colunas.
  `COLUNAS_PRODUTO_PUBLICO` (`:81-83`) ganha `, dias_semana, hora_inicio, hora_fim, periodo_inicio,
  periodo_fim` **no fim**, na ordem da view.
- Categorias: **sem query nova**. `buscarCategorias` (`queries/categorias.ts:19-34`) já faz
  `select("*")` na tabela. As colunas novas chegam sozinhas, e a policy nova filtra a oculta para anon.
- `catalogoVitrine.ts`:
  - `projetarProdutoVitrine(produto: ProdutoParaVitrine, avaliacao: AvaliacaoFrequencia, agora: Date,
    exibirImagensPorCategoria?)`. `compravel = disponivel && avaliacao.disponivel`. A precedência
    janela > esgotado continua (`:145-152`).
  - `projetarCatalogoVitrine<C extends { id: string } & CategoriaFrequencia>({ produtos: (ProdutoParaVitrine
    & Frequencia)[], categorias: readonly C[], agora, timezone, exibirImagensPorCategoria? })` →
    `{ produtos: ProdutoVitrine[]; rotulosVigencia: Record<string,string>; categoriasVisiveis: C[] }`.
    - `categoria_oculta` **ou `encerrado`** ⇒ produto **omitido** (RN-2/RN-7), antes de qualquer
      agrupamento, do mesmo jeito que o RN-13 omitia (`catalogoVitrine.ts:208-216`).
    - `fora_da_frequencia` ⇒ marcado, com
      `rotulosVigencia[id] = rotuloForaDaFrequencia(produto, categoria, agora, tz)`.
    - `categoriasVisiveis = categorias.filter(c => categoriaVisivel(c, agora, tz))`: sai a oculta
      **e a encerrada**. Sem isso, o produto sem categoria na lista cairia em "Outros"
      (`queries/produtos.ts:127-128`).
    - Categoria com `periodo_inicio` no futuro continua visível, com os itens `fora_da_janela`.
      Categoria com `dias_semana = []` continua visível, com todos os itens `fora_da_janela` (RN-8).
    - Sai o `cardapiosAbertos`.
  - `agruparPorCardapio` (`:327`) e `derivarProdutosDoModalSazonal` (`:470`) **ficam** (sem caller de
    cardápio).
- Redação (`src/lib/utils/descreverVigencia.ts`, o dono das frases, reusa `descreverDiasDaSemana`,
  `hhmm`, `cortar`, `ROTULO_SEM_VOLTA`):
  - `rotuloForaDaFrequencia(produto, categoria|null, agora, tz): string`, com teto de 32 (`MAX_ROTULO`),
    sobre `combinarFrequencias`. `vazia` ou algum `dias_semana = []` ⇒ `ROTULO_SEM_VOLTA`
    ("Indisponível no momento"); período futuro ⇒ `"A partir de dd/MM"`; dia ⇒
    `"Só " + dias curtos` ("Só sáb e dom", "Só seg a sex"); hora ⇒ `"Das HH:MM às HH:MM"`. Não trata
    encerrado: esse produto nunca chega aqui (omitido).
  - `rotuloFrequencia(f): string | null` (chip do painel). `null` = permanente. `dias_semana = []` ⇒
    `"Nunca disponível"` (sozinho, sem os outros eixos). Exemplos:
    `"seg a sex · 11:00–15:00 · 01/12 a 31/12"`, `"desde 01/12"`, `"até 31/12"`.
  - `avisoFrequenciaQueNuncaAbre(produto, categoria|null): string | null` (RN-1/RN-8, molde
    `avisoAgendaQueNuncaAbre` `:399`). A primeira causa que se aplica decide o texto (a copy é
    imperativa, conforme a memória "copy manda agir"):
    1. produto `[]` ⇒ `null`. Foi escolha explícita do lojista, e o chip "Nunca disponível" já diz;
       avisar seria ruído;
    2. categoria `[]` ⇒ `"Este item nunca vai ficar disponível: a categoria está sem nenhum dia
       marcado. Marque os dias na categoria."`;
    3. interseção vazia ⇒ `"Este item nunca vai ficar disponível: os dias e horários dele não batem
       com os da categoria. Ajuste a frequência do item ou da categoria."`;
    4. período × dias do próprio item ⇒ `"Este item nunca vai ficar disponível: o período marcado não
       tem nenhum dos dias escolhidos. Ajuste os dias ou o período."`.
  - `avisoCategoriaQueNuncaAbre(categoria): string | null`: `[]` ⇒ `null` (chip); período × dias ⇒ o
    texto 4 com "Esta categoria… Ajuste os dias ou o período.".
  - `avisoPeriodoEncerrado(f, agora, tz): string | null` (RN-7): `periodoEncerrado` ⇒
    `"Período encerrado em dd/MM: não aparece mais na vitrine. Mude o período para voltar a vender."`.
    Senão `null`.

### C8 · Painel/admin (UI)

- `src/lib/utils/frequenciaPainel.ts` (puro, **um** helper para os dois mundos):
  ```ts
  export type FrequenciasDoPainel = {
    produtos: Record<string, { rotulo: string | null; aviso: string | null }>;
    categorias: Record<string, { oculta: boolean; frequencia: Frequencia; rotulo: string | null; aviso: string | null }>;
  };
  export function projetarFrequenciasDoPainel(produtos: (Frequencia & { id: string; categoria_id: string | null })[],
    categorias: (CategoriaFrequencia & { id: string })[], agora: Date, timezone: string): FrequenciasDoPainel;
  ```
  `aviso` = `avisoPeriodoEncerrado` (se houver; ele vence, porque o item já sumiu) senão
  `avisoFrequenciaQueNuncaAbre`/`avisoCategoriaQueNuncaAbre`. `agora` e `timezone` vêm da página (o
  mesmo `agora` de `projetarPromocaoDoPainel`, `produtos/page.tsx:126`), com o fuso da loja, e são
  decididos no servidor.
- `ProdutosClientProps` ganha `frequencias: FrequenciasDoPainel` (**obrigatória**).
  `AcoesProdutosClient` (`ProdutosClient.tsx:219-244`) ganha 4 chaves obrigatórias,
  `aplicarFrequenciaEmProdutos`, `salvarGradeDeDias`, `alternarOcultaCategoria` e
  `definirFrequenciaCategoria`, tipadas por `typeof` da action do lojista (padrão issue 160). O
  `enforcement-props-action-admin.test.ts` passa a exigi-las no `CardapioAdminClient` sem edição.
- Componentes novos (visual fechado pelo `desenhar` no P3b, alvos ≥ 44px):
  - `src/components/painel/EditorFrequencia.tsx`: controlado. Dias com dois modos explícitos:
    "Todos os dias" ⇒ `null`; "Dias específicos" ⇒ as `PilulasDeDias`. **Nenhuma pílula marcada ⇒
    `[]`**, com a legenda "Nunca disponível", sem erro. O `PilulasDeDias` (`PilulasDeDias.tsx:24-26`)
    documenta "vazio = sem restrição"; aqui o **editor** traduz, e o componente continua burro. Hora
    com `<input type="time">` ×2 e "O dia todo"; período com `<input type="date">` ×2 e "Sempre".
  - `src/components/painel/DialogoFrequencia.tsx`: dialog shadcn com `EditorFrequencia`, aviso RN-1
    vindo pronto do servidor e `aoSalvar(f)`. Serve produto (1 id), seleção (N ids) e categoria.
  - `src/components/painel/GradeFrequencia.tsx` + `src/components/painel/gradeFrequencia.ts` (puro).
    `montarPayloadDaGrade(inicial, atual): { itens: { produto_id: string; dias_semana: number[] | null }[] }`
    manda só as linhas alteradas. Linha toda marcada ⇒ `null`; linha toda desmarcada ⇒ `[]` (RN-8,
    sem erro). "Alterada" compara o valor **normalizado**: `null` ≠ `[]`, e `[1,2]` = `[2,1]`. Nenhum
    pré-preenchimento converte `null` em 7 dias no estado salvo.
  - `src/components/painel/BarraSelecaoFrequencia.tsx`: casca fina (contagem, "Definir frequência",
    Limpar, Cancelar), com a mesma régua `ALVO` de `BarraSelecaoLote.tsx:18`. Não generaliza a barra
    antiga, que é de cardápio e fica como está.
- `GerenciarCategorias` ganha `onAlternarOculta`, `onDefinirFrequencia` e `frequencias`
  (`FrequenciasDoPainel["categorias"]`). É a superfície de categoria que já tem o toggle
  `exibir_imagens` (`GerenciarCategorias.tsx:56`).

---

## Cenários

Caminho feliz: o lojista marca "Feijoada" só sáb, 11:00–15:00, e a categoria "Pratos" seg–sáb. No
sábado às 12:00 (fuso da loja) a feijoada está comprável. No sábado às 16:00 aparece riscada com "Das
11:00 às 15:00", e `criarPedido` recusa com `ERRO_FORA_DA_JANELA` sem chamar a RPC.

Bordas:
- **RN-1:** categoria seg–sex + item só sáb. O painel mostra o aviso. A vitrine mostra o item sempre
  indisponível, com rótulo `ROTULO_SEM_VOLTA`.
- **Categoria oculta:** a categoria e seus itens somem da vitrine (view + policy + filtro TS). Carrinho
  antigo com o item: a revisão marca a linha `fora_da_janela`, e o pedido recusa com `ERRO_GENERICO`.
- **Categoria fora da frequência:** a categoria aparece, todos os itens riscados, e cada um recebe o
  rótulo do eixo que falha.
- **RN-7, produto encerrado:** "Panetone" com período 01/12–31/12. Em 31/12 às 23:59 (loja) ainda
  aparece; em 01/01 às 00:00 some da vitrine. Carrinho montado antes: a revisão bloqueia a linha
  (`fora_da_janela`, "Indisponível no momento") e o pedido recusa com `ERRO_FORA_DA_JANELA` antes da
  RPC. O painel mostra "Período encerrado em 31/12…".
- **RN-7, categoria encerrada:** categoria "Natal" 01/12–31/12, itens sem período próprio. Em 15/01
  somem a categoria (fora de `categoriasVisiveis`) e todos os itens, e o pedido recusa com
  `ERRO_FORA_DA_JANELA`.
- **RN-7, antes do início:** período 01/12–31/12 visto em 20/11: item/categoria visíveis e
  indisponíveis, com "A partir de 01/12".
- **RN-7, fuso na virada:** `periodo_fim = 2026-12-31`, `agora = 2027-01-01T03:30Z`. Em
  `America/Sao_Paulo` já é 01/01 00:30 ⇒ encerrado; em `America/Manaus` ainda é 31/12 23:30 ⇒
  aparece.
- **RN-8, item sem dia:** `dias_semana = []` ⇒ visível, sempre riscado, "Indisponível no momento";
  chip "Nunca disponível" no painel; pedido recusa com `ERRO_FORA_DA_JANELA`.
- **RN-8, categoria sem dia:** a categoria aparece com todos os itens riscados; cada item recebe o
  aviso "a categoria está sem nenhum dia marcado".
- **RN-7 × RN-8:** item com `[]` e período encerrado ⇒ some (encerrado vence).
- **Fuso:** `2026-10-03T03:30Z` é sábado 00:30 em `America/Sao_Paulo` e sexta 23:30 em
  `America/Manaus`. O item "só sáb" abre numa e não na outra.
- **Loja inativa:** a view já exclui (`loja_esta_ativa`) e o pedido recusa antes (gate de loja).
- **Produto de outra loja no carrinho:** gate existente `produto.loja_id !== dados.loja_id`
  (`pedido.ts:242`).
- **Categoria de outra loja** (`categoria_id` alheio): ausente do mapa ⇒ `categoria_oculta` ⇒
  `ERRO_GENERICO`.
- **Duplo submit da grade:** as duas chamadas gravam o mesmo estado (idempotente por linha). A UI
  desabilita "Salvar tudo" durante o envio.
- **Edição concorrente em duas abas:** a grade só escreve `dias_semana`. Hora e período de outra aba
  sobrevivem.
- **Sessão expirada:** `buscarLojaDoDono` devolve null ⇒ `"Loja não encontrada."`. A RPC não é
  chamada.
- **Produto legado `'cardapio'`** (regravado por REST depois da migração): a view só o mostra com
  vínculo em cardápio ativo (predicado mantido, D4). O avaliador ignora `visibilidade`.
- **Erro de banco:** mensagem genérica na UI; detalhe no log do servidor (`console.error` com o nome
  da action).

---

## Arquivos a criar / modificar

### Criar
| Arquivo | Issue | Conteúdo |
|---|---|---|
| `supabase/migrations/20260928130000_frequencia_produtos_categorias.sql` | 320 | C1 |
| `supabase/migrations/20260928131000_rpc_frequencia_produtos.sql` | 322 (P4 junto) | C1 |
| `supabase/migrations/20260928132000_frequencia_cardapio_volta_ao_menu.sql` | 320 | C1 |
| `src/lib/utils/frequencia.ts` | 321 | C2 |
| `src/lib/validacoes/frequencia.ts` | 322 | C3 |
| `src/lib/actions/frequencia-contrato.ts` | 322 | C4 |
| `src/lib/utils/frequenciaPainel.ts` | 323 | C8 |
| `src/components/painel/{EditorFrequencia,DialogoFrequencia,GradeFrequencia,BarraSelecaoFrequencia}.tsx`, `gradeFrequencia.ts` (+ `gradeFrequencia.test.ts`) | 323 | C8 |
| testes do P3 | 320–322 | ver "Testes" |

### Modificar (nível função, com linha atual)
| Arquivo:linha | Issue | Mudança |
|---|---|---|
| `src/lib/database.types.ts` (`categorias` :283-, `produtos`, `vitrine_produtos`, `Functions` perto de `reordenar_produtos` :1543) | 320/322 | patch manual D10: 5 colunas em Row/Insert/Update de `produtos` e `categorias` + `oculta`; 5 colunas `\| null` em `vitrine_produtos` Row; `aplicar_frequencia_em_produtos: { Args: { p_loja_id: string; p_ids: string[]; p_frequencia: Json }; Returns: number }` e `salvar_grade_de_dias: { Args: { p_loja_id: string; p_itens: Json }; Returns: number }` |
| `src/lib/validacoes/cardapio.ts:184` | 322 | `const horaDoDia` → `export const horaDoDia` (nada mais) |
| `src/lib/actions/pedido.ts:50-55` | 321 | troca os imports de cardápio/vigência por `buscarCategorias` (`queries/categorias`) + `avaliarFrequenciaNaLoja` |
| `src/lib/actions/pedido.ts:169-189` | 321 | 5º item da onda: `buscarCategorias(svc, dados.loja_id)` no lugar de `buscarCardapiosComProdutos`, mesmo comentário fail-closed; `categoriasPorId = new Map(categorias.map(c => [c.id, c]))` |
| `src/lib/actions/pedido.ts:247-259` | 321 | `const av = avaliarFrequenciaNaLoja(produto, categoriasPorId, agora, loja.timezone); if (!av.disponivel) return { erro: av.motivo === "categoria_oculta" ? ERRO_GENERICO : ERRO_FORA_DA_JANELA };`. `encerrado` e `fora_da_frequencia` ⇒ `ERRO_FORA_DA_JANELA` (D12). `ERRO_FORA_DA_JANELA` (`:77-78`) fica **literal** |
| `src/lib/actions/revisarCarrinho.ts:39-43,107-124,227-238` | 321 | mesma troca; `compravel = produto.disponivel && av.disponivel`; `:247` inalterado (`"fora_da_janela"` para os três motivos: oculta, encerrado, fora) |
| `src/lib/actions/produto.ts` (depois de `:678`) | 322 | 4 actions lojista (C5); imports de `validacoes/frequencia` e `frequencia-contrato` |
| `src/app/admin/assinantes/actions/admin-produtos.ts` (depois de `:448`) | 322 | 2 actions admin (C5) |
| `src/app/admin/assinantes/actions/admin-categorias.ts` (depois de `:131`) | 322 | 2 actions admin (C5), molde `alternarExibirImagensAdmin` `:99-131` |
| `src/lib/supabase/queries/produtos.ts:53-83` | 323 | C7 |
| `src/lib/utils/catalogoVitrine.ts:10-23,89-154,170-258` | 323 | C7; `ProdutoParaVitrine & { visibilidade: string }` → `ProdutoParaVitrine & Frequencia` |
| `src/lib/utils/descreverVigencia.ts` (novas exports depois de `:412`) | 323 | C7 (5 funções: `rotuloForaDaFrequencia`, `rotuloFrequencia`, `avisoFrequenciaQueNuncaAbre`, `avisoCategoriaQueNuncaAbre`, `avisoPeriodoEncerrado`); `rotuloDiasDoItem`/`ordenarSemana` intactos e **não** usados pela frequência (D13) |
| `src/app/(publica)/loja/[slug]/page.tsx:15,24-31` | 323 | tira `buscarCardapiosComProdutos`, `agruparPorCardapio`, `rotuloJanelaDestaque` |
| `…/page.tsx:186-192` | 323 | `Promise.all` com 3 queries (categorias, produtos, modal) |
| `…/page.tsx:210-251` | 323 | `projetarCatalogoVitrine({ produtos, categorias, agora, timezone, exibirImagensPorCategoria })`; `agruparCatalogo(produtosVitrine, categoriasVisiveis)`; saem `secoesDestaque`/`rotulosJanela` |
| `…/page.tsx:321-330` | 323 | 2º argumento de `derivarProdutosDoModalSazonal` = `[]` (S6: cardápio não contribui) |
| `…/page.tsx:387-391` | 323 | não passa mais `secoesDestaque`/`rotulosJanela` |
| `src/app/(painel)/painel/(bloqueavel)/produtos/page.tsx:48-65,96-120,134-173,188-210` | 323 | sem `buscarCardapiosComProdutos`/`diagnosticarSumico`/`lote`/`sumicos`; `vinculosPorProduto={{}}`; `frequencias={projetarFrequenciasDoPainel(produtos, categorias, agora, loja.timezone)}` (o `agora` de `:126`); 4 actions novas em `acoes` (`:224-248`) |
| `src/app/(painel)/painel/(bloqueavel)/produtos/ProdutosClient.tsx:128-208,219-244` | 323 | props/acoes (C8) |
| `…/ProdutosClient.tsx:866-876` | 323 | "Selecionar" passa a depender de `produtos.length > 0` (não de `lote != null`); botão "Grade de dias" ao lado |
| `…/ProdutosClient.tsx:883-898` | 323 | `BarraSelecaoFrequencia` com `modoSelecao` (a `BarraSelecaoLote` antiga continua atrás de `lote != null`, que nenhuma página passa) |
| `…/ProdutosClient.tsx` (ESC, `:513-520`) | 323 | não sai do modo com `DialogoFrequencia` aberto |
| `…/ProdutosClient.tsx:1269` (chips) | 323 | chip `frequencias.produtos[id].rotulo` + aviso RN-1 |
| `src/components/painel/GerenciarCategorias.tsx` | 323 | C8 |
| `src/components/painel/FormProduto.tsx:651-711` | 323 | remove o `RadioGroup` (e o comentário `[261]`); o `<fieldset>` `:657-756` passa a renderizar só quando `visibilidade === "cardapio"` (legado); envio inalterado |
| `src/app/admin/assinantes/[lojaId]/produtos/page.tsx:5,11,17-20,46-54,66-92,94-110` | 323 | sem `carregarCardapiosAdmin`/`cardapiosDoLote`; `vinculosPorProduto={{}}`; `frequencias` pelo **mesmo** helper, com as categorias/produtos de `carregarLojaAdmin` e o `agora`/`loja.timezone` de `:58` |
| `src/app/admin/assinantes/[lojaId]/produtos/CardapioAdminClient.tsx:7,34-41,84-92,140-152` | 323 | tira `cardapiosDoLote` e `lote`; `acoes` ganha as 4 closures `(p) => xAdmin(lojaId, p)`; `hrefCardapios` inalterado |
| `src/components/painel/NavPainel.tsx:173-179` (+ import `CalendarRange` `:10`) | 323 | remove o item "Cardápios" (vale para lojista e admin) |
| `src/app/(painel)/painel/(bloqueavel)/configuracoes/promocoes/page.tsx:7,50-54,82-86` | 323 | sem `buscarCardapiosComProdutos`/prop `cardapios` |
| `…/promocoes/PromocoesClient.tsx:93,123,128,294,362,369,583-621` | 323 | remove o `fieldset` "Cardápios a divulgar" e a prop `cardapios`; `cardapiosSel` vira `const cardapiosSel = inicial?.cardapios ?? []` (repassado sem mudar no `salvar` `:430`, senão o `salvar_modal_sazonal` apagaria as junções, contra S6); `modalSoComTitulo({ …, cardapios: [] })` em `:408-412` |
| `src/components/vitrine/checkout/itensBloqueados.ts:8-11`, `src/lib/actions/revisarCarrinho-contrato.ts:64` | 321 | só comentário (`avaliarFrequencia` no lugar de `avaliarVigenciaDoProduto`) |

### Testes existentes afetados (quem mexe e por quê)
| Arquivo | Passo | Mudança |
|---|---|---|
| `tests/migrations/vitrine_produtos.test.ts:90-106` (+ nome do [5a] `:506`) | P3 (RED) | `COLUNAS_VITRINE_PRODUTOS` com 20 colunas (as 5 novas no fim) |
| `tests/migrations/produtos_exclusivo_trigger_e_vitrine_visibilidade.test.ts:722-729` | P3 (RED) | [n] afirma `slice(0, 15)` igual a `COLUNAS_VITRINE_15` (o prefixo intacto é a intenção) |
| `src/lib/actions/pedido.vigencia-cardapio.test.ts`, `src/lib/actions/revisarCarrinho.vigencia.test.ts` | P4 | `git rm`: afirmam a regra removida (S5); substituídos por `*.frequencia.test.ts` |
| `pedido.test.ts:55`, `pedido.modalidades.test.ts:44`, `pedido.snapshot-preco.test.ts:74`, `frete.test.ts:81`, `paridade-preview-autoritativo.test.ts:76`, `revisarCarrinho.test.ts:64` | P4 | acrescentar `vi.mock("@/lib/supabase/queries/categorias", …)` com as categorias das fixtures (`oculta: false`, 5 nulls); o mock de `cardapios` pode ficar (inerte) |
| fixtures `Tables<"produtos">`/`Categoria` de linha inteira que o `tsc` apontar | P4 | acrescentar as colunas novas com `null`/`false`; nenhuma asserção muda |
| `tests/migrations/rpc_pedido_e2e.test.ts` | P4 | só confirmar verde (o shim já tem `.order()`, `:48-64`) |
| `src/lib/supabase/queries/produtos.test.ts:94` | P5 | literal de `COLUNAS_PRODUTO_PUBLICO` com 20 colunas |
| `src/lib/utils/catalogoVitrine.test.ts` blocos `:499`, `:649`, `:802`, `:905`, `:948` | P5 | reescritos para a assinatura nova (C7); `:1015`, `:1237`, `:1608` (funções que ficam) intactos |
| `src/components/vitrine/secoesDestaque.test.tsx` | P5 | continua testando `agruparPorCardapio`/`CatalogoVitrine` (código que fica); só mexer se o `tsc` pedir |
| `src/components/painel/NavPainel.test.tsx:150-180` | P5 | inverter: "Cardápios" **não** aparece nos dois mundos |
| `src/components/painel/FormProduto.test.tsx`, `ProdutosClient.test.tsx`, `rotaCardapiosInjetada.test.tsx` | P5 | ajustar ao `RadioGroup` removido, ao "Selecionar" sem `lote` e à prop `frequencias` |

---

## Testes do P3 (RED) — nomes finais e o que afirmar

Regra comum (`memory: sqlstate-nao-basta`): toda recusa afirma **SQLSTATE e fragmento da mensagem**.
"Nada mudou" é relido num bloco `asService` **separado**, depois do bloco que lançou, porque o
`withRole` do harness faz rollback (`tests/helpers/pglite.ts:142-160`). Módulo TS que ainda não existe
é importado com `await import()` e mensagem `[RED 32x]`, como em `validacoes/cardapio.test.ts:256-271`,
para que o FAIL seja "módulo/exports ausentes", nunca erro de sintaxe.

1. **`tests/migrations/frequencia_schema_e_view.test.ts`** (320)
   - [c] Para `produtos` **e** `categorias`, via INSERT e via UPDATE: `hora_fim` sem `hora_inicio` ⇒
     23514 + `*_hora_par`; `15:00/11:00` e `11:00/11:00` ⇒ 23514 + `*_hora_ordem`; `periodo_fim <
     periodo_inicio` ⇒ 23514 + `*_periodo_ordem`; `'{7}'`, `'{-1}'` ⇒ 23514 +
     `*_dias_semana_dominio`. Aceitos: os 5 null; período de um dia (`fim = inicio`); meio-aberto;
     frequência completa válida; **`'{}'` (RN-8)**, relido como `[]` e **não** `null` (`dias_semana
     is null` = false, `cardinality` = 0), nas duas tabelas.
   - [e] a view **não** filtra período: produto com `periodo_fim` no passado continua em
     `vitrine_produtos` para `asAnon` (D12; a janela é do TS). Trava contra quem tentar pôr
     `current_date` no WHERE.
   - [o] `categorias.oculta` nasce `false` numa linha inserida sem ela; `oculta = null` ⇒ 23502.
   - [v1] `asAnon` em `vitrine_produtos` da loja A: some o produto de categoria oculta (existe na base
     via `asService`); ficam o produto sem categoria e o de categoria visível.
   - [v2] produto de loja inativa fora da view.
   - [v3] dono logado lendo a view também não vê o produto da categoria oculta (definer).
   - [v4] ao vivo: `oculta = true` tira e `false` devolve na leitura seguinte.
   - [v5] `information_schema.columns` da view = as 20 colunas na ordem do C1.
   - [v6] `pg_class.reloptions` contém `security_barrier=true` e `security_invoker=false`.
   - [v7] `anon`/`authenticated` só com SELECT (`has_table_privilege` insert/update/delete = false).
   - [p1] `asAnon` em `categorias` da loja A não vê a oculta; `asUser(dono A)` vê; `asUser(dono B)`
     não vê.
2. **`tests/migrations/frequencia_migracao_dados.test.ts`** (320)
   - Semeia loja + cardápio ativo + produto `'cardapio'` com vínculo (`dias_semana` preenchido) +
     produto `'menu'`. Guarda a foto de `cardapio_produtos` e `cardapios` e roda
     `db.exec(readFileSync(".../20260928132000_frequencia_cardapio_volta_ao_menu.sql"))`.
   - Afirma: `count(*) where visibilidade='cardapio'` = 0; `cardapio_produtos`/`cardapios` idênticos
     à foto (ids, `produto_id`, `cardapio_id`, `dias_semana`); o produto migrado tem as 5 colunas de
     frequência null (nada convertido, RN-4); o produto `'menu'` intacto; reexecutar o arquivo não
     lança e não muda nada.
   - Guarda estática: o arquivo não contém `delete`/`drop`/`truncate`.
3. **`tests/migrations/rpc_frequencia_produtos.test.ts`** (322, prova de banco de RN-5/RN-6)
   - aplicar: [a1] dono A, `p_loja_id` A, `[a1,a2]` ⇒ retorna 2 e grava. [a2] `[a1,b1]` ⇒ P0001 +
     `"aplicar_frequencia_em_produtos: 2 ids, 1 linhas afetadas"`, e depois `asService`: a1 **e** b1
     sem mudança. [a3] dono A com `p_loja_id` B e `[b1]` ⇒ P0001 + `"1 ids, 0 linhas afetadas"`, b1
     intacto (RLS). [a4] `asService`, `p_loja_id` A, `[a1,b1]` ⇒ P0001 + `"linhas afetadas"`, nada
     muda. [a5] `asService`, `p_loja_id` A, `[a1]` ⇒ 1. [a6] vazia ⇒ `"lista vazia"`; repetidos ⇒
     `"ids repetidos"`; 201 ids ⇒ `"lista acima do teto"`; `p_frequencia` null/array ⇒
     `"frequencia invalida"`; `p_frequencia` **sem a chave `dias_semana`** (as outras 4 presentes) ⇒
     `"frequencia invalida"`, e a1 não vira NULL (D13). [a7] `hora 15:00/11:00` ⇒ 23514 +
     `produtos_hora_ordem`, nada gravado. [a8] `asAnon` ⇒ 42501. [a9] RN-8: `dias_semana: []` ⇒
     gravado e relido `[]` (não null); `dias_semana: null` sobre um a1 que era `[]` ⇒ relido `null`.
   - grade: [g1] `[{a1,[1,2]},{a2,null}]` ⇒ 2; hora/período pré-existentes de a1 **preservados**.
     [g2] tudo ou nada: `[{a1,[1]},{a2,[7]}]` ⇒ 23514 + `produtos_dias_semana_dominio`, a1 **não**
     gravado. [g3] `[{a1,[1]},{b1,[2]}]` ⇒ P0001 + `"salvar_grade_de_dias: 2 itens, 1 linhas
     afetadas"`, a1 e b1 intactos. [g4] repetido ⇒ `"ids repetidos ou ausentes"`; `[]`/objeto ⇒
     `"lista vazia"`; elemento sem a chave `dias_semana` ⇒ `"item incompleto"`, sem gravar nada.
     [g5] `asService` `p_loja_id` A com b1 ⇒ P0001; `asAnon` ⇒ 42501. [g6] RN-8:
     `[{a1,[]},{a2,[0,6]}]` ⇒ 2, a1 relido `[]` (não null).
   - catálogo: `pg_proc.prosecdef = false` nas duas; `proconfig` com `search_path`; ACL sem `anon`,
     com `authenticated` e `service_role`.
4. **`src/lib/utils/frequencia.test.ts`** (321) — tabela de casos com `{ disponivel, motivo }` exato:
   permanente; dia (sáb sim, sex não); hora 11:00–15:00 em 10:59 ✗, 11:00 ✓, 14:59 ✓, 15:00 ✗, também
   com "11:00:00"; período 01/12–31/12 em 30/11 23:59 local ✗, 01/12 00:00 ✓, 31/12 23:59 ✓, 01/01
   00:00 ✗; meio-aberto; fuso `2026-10-03T03:30Z` com `[6]` ⇒ SP ✓ e Manaus ✗, idem com
   `periodo_inicio "2026-10-03"`; RN-1 (categoria `[1..5]`, item `[6]`) ⇒ ✗ em 7 dias × 3 horários
   amostrados e `frequenciaNuncaAbre` = true; categoria oculta ⇒ `categoria_oculta` mesmo dentro da
   janela (precedência); categoria fora ⇒ `fora_da_frequencia`; fail-closed (hora sem par, `"xx"`,
   `"31/12/2026"`) ⇒ ✗; `avaliarFrequenciaNaLoja` (id null ⇒ só produto; id ausente ⇒
   `categoria_oculta`); `combinarFrequencias` (retorno `{ vazia }` discriminado) e
   `frequenciaNuncaAbre` (dias disjuntos, horas disjuntas, períodos disjuntos, sáb–dom × seg–sex, `[]`
   de qualquer lado ⇒ true; sobreposição ⇒ false; NULL × NULL ⇒ false). Guarda estática: o fonte não
   contém `Intl`. Casos novos (RN-7/RN-8):
   - **RN-7:** produto 01/12–31/12. Em 31/12 23:59 local ⇒ `{ true, null }`. Em 01/01 00:00 local e
     em 15/01 ⇒ `{ false, "encerrado" }`. Em 30/11 ⇒ `{ false, "fora_da_frequencia" }` (antes do
     início **não** é encerrado). Só `periodo_fim` no passado ⇒ `encerrado`.
   - **Categoria encerrada**, produto sem período ⇒ `encerrado`, e `categoriaVisivel` = false.
     Categoria com início futuro ⇒ `categoriaVisivel` = true e item `fora_da_frequencia`.
   - **Fuso na virada**, `periodo_fim "2026-12-31"`, `agora 2027-01-01T03:30Z`: SP ⇒ `encerrado`;
     Manaus ⇒ `{ true, null }`.
   - **Precedência:** categoria oculta **e** encerrada ⇒ `categoria_oculta`; produto `[]` **e**
     encerrado ⇒ `encerrado`.
   - **RN-8:** `dias_semana = []` ⇒ `{ false, "fora_da_frequencia" }` em todos os 7 dias × 3 horários
     amostrados. Contraprova: `null` ⇒ `{ true, null }` nos mesmos instantes, e `[0..6]` também
     `{ true, null }`. Categoria `[]` ⇒ todo item `fora_da_frequencia`. `periodoEncerrado` com
     `periodo_fim` malformado ⇒ true.
5. **`src/lib/validacoes/frequencia.test.ts`** (322):
   - Mensagens literais (`MSG_HORA_PAR`, `MSG_HORA_ORDEM`, `MSG_PERIODO_ORDEM`); `[3,1,1]` ⇒ `[1,3]`;
     7 distintos ⇒ `null`.
   - **RN-8:** `[]` **aceito** e devolvido `[]`, com `toEqual([])` **e** `not.toBeNull()`; `null` ⇒
     `null`. `normalizarDiasDaFrequencia([])` ⇒ `[]` e `normalizarDiasDaFrequencia(null)` ⇒ `null`.
     A grade com `dias_semana: []` numa linha é aceita.
   - Chave `dias_semana` **ausente** recusada (não vira null); chave extra recusada (`.strict()`,
     `loja_id` incluso); `TETO_LOTE + 1` ids recusado; id/`produto_id` repetido recusado;
     `2026-02-30` recusado.
   - Guarda estática: o fonte de `validacoes/frequencia.ts` não importa `normalizarDiasDoVinculo`.
6. **`src/lib/actions/pedido.frequencia.test.ts`** (321), mocks como em
   `pedido.vigencia-cardapio.test.ts:28-84` mais `vi.mock("@/lib/supabase/queries/categorias")`:
   produto fora ⇒ `{ erro: "Um item do seu pedido saiu do cardápio deste horário. Revise o carrinho." }`;
   categoria fora ⇒ idem; categoria oculta ⇒ `{ erro: "Não foi possível criar o pedido. Tente
   novamente." }`; categoria ausente do mapa ⇒ idem. **RN-7:** produto com `periodo_fim` ontem (fuso
   da loja) ⇒ `ERRO_FORA_DA_JANELA` literal; categoria encerrada com produto sem período ⇒ idem.
   **RN-8:** produto `dias_semana: []` ⇒ `ERRO_FORA_DA_JANELA`; categoria `[]` ⇒ idem. Em todos esses
   casos, `fakeClient.rpc` com **0** chamadas. Dentro da janela ⇒ `rpc` 1×; `dias_semana: null` ⇒
   `rpc` 1× (contraprova de RN-8). `buscarCategorias` chamada com `(fakeClient, LOJA_A)`;
   `buscarCardapiosComProdutos` com **0** chamadas. Produto `visibilidade: "cardapio"` sem vínculo e
   permanente ⇒ aceito (S5).
7. **`src/lib/actions/revisarCarrinho.frequencia.test.ts`** (321): categoria oculta, encerrado
   (produto e categoria), fora da frequência e `[]` ⇒ a linha sai `compravel: false,
   motivoNaoCompravel: "fora_da_janela"`, `ok: true`, e o `subtotal` exclui a linha. Dentro ⇒
   `compravel: true`. `buscarCardapiosComProdutos` 0 chamadas.
8. **`src/lib/actions/produto.frequencia.test.ts`** (322), `createClient`/`buscarLojaDoDono`
   mockados, com captura de `rpc`/`update`/filtros:
   - `aplicarFrequenciaEmProdutos`/`salvarGradeDeDias`: `rpc` com `{ p_loja_id: LOJA_DO_DONO, … }`
     igual a `argsAplicarFrequencia`/`argsGradeDeDias`; payload com `loja_id` ⇒ recusa sem I/O; `hora
     15:00/11:00` ⇒ `{ ok: false, erro: MSG_HORA_ORDEM }`, `createClient` e `rpc` com 0 chamadas.
   - **RN-8 de ponta a ponta no contrato:** seleção com `dias_semana: []` ⇒ `rpc` 1× e
     `p_frequencia.dias_semana` `toEqual([])` (não null); grade com uma linha `[]` e outra
     `[0,1,2,3,4,5,6]` ⇒ `p_itens` `[{…, dias_semana: []}, {…, dias_semana: null}]`; `p_frequencia`
     tem **as 5 chaves** (`Object.keys(...).sort()`) e cada item de `p_itens` tem `dias_semana`.
   - Dono sem loja ⇒ `{ ok: false, erro: "Loja não encontrada." }`, rpc 0.
   - `rpc` devolvendo `{ code: "P0001", message: "aplicar_frequencia_em_produtos: 2 ids, 1 linhas
     afetadas" }` ⇒ `{ ok: false, erro: MSG_SALVAR_FREQUENCIA }`, e a mensagem **não** contém
     `"linhas afetadas"`.
   - `alternarOcultaCategoria`/`definirFrequenciaCategoria`: patch exatamente `{ oculta }` / as 5
     chaves; filtros `["id", id]` **e** `["loja_id", LOJA_DO_DONO]`; `count: 0` ⇒
     `MSG_CATEGORIA_NAO_ENCONTRADA`; `oculta` não booleano ou id não-uuid ⇒ recusa sem I/O.
   - `revalidatePath` com `"/painel/produtos"` e `"/loja/<slug>"`.
9. **`src/app/admin/assinantes/actions/admin-frequencia.paridade.test.ts`** (322), molde
   `admin-produtos.paridade.test.ts:1-80`: para as 4 actions *Admin, `lojaId` inválido ⇒ `"Loja
   inválida."` sem `verificarAdminSaaS`; payload inválido ⇒ recusa antes de `prepararContextoAdmin`;
   `verificarAdminSaaS` lançando ⇒ a action rejeita e `svc.rpc` tem 0 chamadas. Mesmo payload nos dois
   mundos ⇒ args da RPC **idênticos exceto `p_loja_id`**, que é `LOJA_ALVO` da URL; um dos payloads
   de paridade tem `dias_semana: []`, que chega `[]` nos dois mundos. Categoria:
   `update` em `"categorias"` com filtros `loja_id = LOJA_ALVO` e `id`, patch igual ao do lojista,
   `count 0` ⇒ `MSG_CATEGORIA_NAO_ENCONTRADA`. Erro da RPC ⇒ a mesma genérica do lojista.
   `admin_acessos` recebe `acao` ∈ {`produto.frequencia_lote`, `produto.grade_dias`,
   `categoria.oculta`, `categoria.frequencia`}.

Gate P3 (substitui o do loop, que não tinha 2, 5 e 7):
```
npx vitest run tests/migrations/frequencia_schema_e_view.test.ts tests/migrations/frequencia_migracao_dados.test.ts \
  tests/migrations/rpc_frequencia_produtos.test.ts tests/migrations/vitrine_produtos.test.ts \
  tests/migrations/produtos_exclusivo_trigger_e_vitrine_visibilidade.test.ts \
  src/lib/utils/frequencia.test.ts src/lib/validacoes/frequencia.test.ts \
  src/lib/actions/pedido.frequencia.test.ts src/lib/actions/revisarCarrinho.frequencia.test.ts \
  src/lib/actions/produto.frequencia.test.ts src/app/admin/assinantes/actions/admin-frequencia.paridade.test.ts
```
Todos FAIL pelo motivo certo. A exceção do teste 2 é [guarda estática], que falha por arquivo ausente.

---

## Não tocar (com motivo)

- `src/lib/utils/vigenciaCardapio.ts`, `src/lib/supabase/queries/cardapios.ts`,
  `src/lib/actions/cardapio*.ts`, `admin-cardapios.ts`, `carga-cardapio*.ts`, rotas `…/cardapios/**`,
  `DialogoLoteCardapio.tsx`, `BarraSelecaoLote.tsx`, `useLoteDeProdutos.tsx`, `contrato-lote.ts`,
  `contarProdutosEscondidos.ts`: cardápio vira função morta, sem apagar (S5 / fora do escopo do spec).
- `agruparPorCardapio`/`derivarProdutosDoModalSazonal` (`catalogoVitrine.ts:327,470`): ficam; a
  página só passa `[]`.
- `src/components/vitrine/CatalogoVitrine.tsx`, `SecaoCatalogo.tsx`, `rotuloEsgotado.ts`: props de
  destaque já opcionais (D11); o rótulo continua descendo por `rotulosVigencia`.
- Lógica de `src/components/vitrine/checkout/itensBloqueados.ts`: só pareia o que o servidor decidiu
  (`:41-54`).
- `schemaProduto`/`FormProduto` fora do `RadioGroup`, `atualizarProduto`/`atualizarProdutoAdmin`: D7.
- `src/lib/validacoes/modalSazonal.ts`, `patches-modal-sazonal.ts`, RPC `salvar_modal_sazonal`: S6
  tira o eixo só do editor; as junções ficam.
- Trigger RN-14 (`20260920131000`): a migração de dados depende de ele **não** disparar.
- `src/types/supabase.ts`: morto (CLAUDE.md).
- `src/components/ui/**`: gerado pelo shadcn.

---

## Dependências externas

Nenhuma nova. `zod@4.4.3` (`z.iso.date()`, conferido), `@electric-sql/pglite@0.5.3`
(`jsonb_to_record(set)` com `smallint[]`, conferido) e shadcn já instalados. **Custo e quota:** zero
chamada externa. O custo fica dentro do Supabase fixo. A vitrine **perde** uma query por request
(cardápios); o pedido e a revisão trocam uma query (cardápios ⇒ categorias). A view ganha um `NOT
EXISTS` por PK de `categorias`.

---

## Ordem de implementação

1. **P3 `tdd` (RED)**: os 9 arquivos acima + as 2 edições de teste existente. É issue crítica, então
   é pré-condição de tudo.
2. **P4 `executar` (I1+I2+I3)**, nesta ordem. Cada item depende do anterior.
   a. `20260928130000` ⇒ testes 1, `vitrine_produtos`, `produtos_exclusivo…` verdes.
   b. `20260928131000` ⇒ teste 3. `20260928132000` ⇒ teste 2.
   c. `database.types.ts` (D10) ⇒ `npx tsc --noEmit`; corrigir as fixtures que ele apontar.
   d. `validacoes/cardapio.ts:184` export + `validacoes/frequencia.ts` ⇒ teste 5.
   e. `utils/frequencia.ts` ⇒ teste 4.
   f. `pedido.ts` + `revisarCarrinho.ts`; `git rm` dos dois `*.vigencia*.test.ts`; mocks de categorias
      nos 6 testes ⇒ testes 6, 7 e suíte `src/lib/actions`.
   g. `frequencia-contrato.ts` + actions do lojista ⇒ teste 8.
   h. actions admin ⇒ teste 9 + `enforcement-escopo-admin.test.ts` +
      `enforcement-escopo-queries.test.ts`.
   Gate: `npx tsc --noEmit && npm run lint && npx vitest run --maxWorkers=2 && npm run build`.
3. **P5 `executar` (I4)**, depois do P4 porque consome C2/C5. Ordem: `descreverVigencia` (funções
   novas) → `frequenciaPainel.ts` → `catalogoVitrine.ts` + testes reescritos. Casos obrigatórios:
   - categoria oculta omitida;
   - categoria fora ⇒ todos `fora_da_janela`;
   - RN-7: produto encerrado **ausente** de `produtos`; categoria encerrada **ausente** de
     `categoriasVisiveis` e **nenhum** produto dela em `produtos` (nem no grupo "Outros"); início
     futuro ⇒ presente e marcado;
   - RN-8: `[]` ⇒ presente, `fora_da_janela`, rótulo `ROTULO_SEM_VOLTA`; categoria `[]` ⇒ presente
     com todos marcados.

   Depois: → `queries/produtos.ts` + `produtos.test.ts`
   → `page.tsx` da vitrine → componentes → `ProdutosClient`/`GerenciarCategorias`/`FormProduto` →
   páginas do painel e do admin + `CardapioAdminClient` → `NavPainel` + teste → modal sazonal. Mesmo
   gate, mais `grep -rn "agruparPorCardapio\|buscarCardapiosComProdutos" "src/app/(publica)"
   src/lib/actions/pedido.ts src/lib/actions/revisarCarrinho.ts
   "src/app/(painel)/painel/(bloqueavel)/produtos" "src/app/(painel)/painel/(bloqueavel)/configuracoes/promocoes"
   src/app/admin/assinantes/\[lojaId\]/produtos` vazio.
4. **P7**: `db push` (humano autoriza) **antes** do merge. As três migrations são compatíveis com o
   código em produção: as 15 colunas nomeadas continuam, nenhuma categoria está oculta, e os 8 itens
   'cardapio' viram permanentes. Depois `gen types --linked` (D10) + `tsc`/`build` de novo.

---

## Checklist de validação pós-implementação

- [ ] `npx tsc --noEmit`, `npm run lint` (0 erros), `npm test`, `npm run build` sem warning novo
- [ ] Os 9 testes do P3 vermelhos antes e verdes depois
- [ ] RLS/escopo: lojista A com id da loja B na grade e na seleção ⇒ exceção + zero linhas (teste 3)
- [ ] Admin só escreve na `lojaId` da URL (teste 9); enforcement admin verde sem edição
- [ ] Pedido com item fora da frequência ou de categoria oculta não chega à RPC (teste 6)
- [ ] `anon` não lê categoria oculta nem produto dela por REST (teste 1 [v1]/[p1])
- [ ] View: 20 colunas, `security_barrier=true`, SELECT-only, revoke no mesmo arquivo ([G4] verde)
- [ ] Nenhuma mensagem de RPC/SQL vaza para a UI (teste 8)
- [ ] Sem secret no client; nenhum dado pessoal real em fixture/seed
- [ ] `npx supabase migration list` com as 3 migrations na coluna Remote antes do merge (P7)
- [ ] RN-7: produto/categoria com período encerrado ausentes da vitrine e recusados no pedido
      (testes 4 e 6 + catálogo do P5); a view não filtra período (teste 1 [e])
- [ ] RN-8: `[]` gravado e relido como `[]` (nunca NULL) no banco, no zod, nos builders e na RPC
      (testes 1, 3, 5, 8, 9); `[]` ⇒ visível e indisponível
- [ ] `grep -n "normalizarDiasDoVinculo" src/lib/validacoes/frequencia.ts src/lib/actions/frequencia-contrato.ts` vazio
- [ ] Verificação HTTP em "Lanches base" (P8): item fora ⇒ rótulo no HTML; categoria oculta ⇒ nome
      ausente; item com `periodo_fim` ontem ⇒ nome ausente; item com `dias_semana = '{}'` ⇒ presente
      com "Indisponível no momento"
