## Plano Técnico

### Análise do Codebase

Leitura de `src/lib/actions/admin-loja.ts` em `466d269`:

- `criarEscopoLoja(svc, lojaId)` (l. 118–223) devolve os helpers que viram `EscopoLoja` (l. 226).
- `atualizar(tabela, id, patch)` (l. 159–165): manda o `patch` **cru** para
  `from(tabela).update(patch, { count: "exact" })` e depois aplica `.eq("loja_id", lojaId).eq("id", id)`.
  A única defesa é o tipo `Omit<Update, "loja_id" | "id">`.
- `atualizarPorChave(tabela, chave, patch)` (l. 181–197): `colunas = Object.entries(chave)`, lança
  `"atualizarPorChave: chave vazia"` se `colunas.length === 0` e depois faz
  `from(tabela).update(patch, …).eq("loja_id", lojaId)` mais um `.eq` por coluna. O `patch` também vai
  **cru**. A única defesa é o tipo `Omit<Update, "loja_id" | "id" | K>`.
- `atualizarLoja(patch)` (l. 213–221) já faz o strip em runtime com
  `Object.fromEntries(Object.entries(patch).filter(...))` contra `CAMPOS_LOJA_SOMENTE_SERVIDOR`. É o
  padrão que a issue manda seguir.

O que será reusado:

- **O padrão de strip de `atualizarLoja`.** Ele vira uma função privada do módulo e passa a ser usado
  pelas três funções (detalhe em "Arquivos").
- **O builder-espião de `admin-loja.test.ts`** (l. 58–97, `opsEspia`, que captura `payload`, `opts` e
  `eqs`) e o helper `escopoPorChave()` (l. 559–569). Os casos RED usam os dois sem criar
  infraestrutura nova.
- **Precedente de teste:** `"atualizarLoja descarta chaves somente-servidor mesmo sob cast"`
  (l. 250–258) e `"atualizarLoja com payload SÓ de chaves bloqueadas → UPDATE vazio"` (l. 348–363). Os
  casos novos seguem o mesmo formato, com `as never` e `op.payload`.

O que precisa ser criado: nenhum arquivo novo. Só uma função privada (não exportada) dentro de
`admin-loja.ts`. Não existe helper genérico de "omitir chaves" em `src/lib/utils/` (conferido com
grep). `descartarLojaId` em `admin-opcionais.ts:60` só tira `loja_id` e roda **antes** do zod, para
evitar o 400 espúrio do `.strict()`. A camada é outra e a finalidade também, por isso ele não serve
aqui.

**Call sites que a mudança precisa manter iguais.** Conferi todos com grep:

| Arquivo | Chamada | Patch | Leva `loja_id`/`id`/chave? |
|---|---|---|---|
| `admin-produtos.ts:218,270,335,366,397` | `atualizar("produtos", …)` | campo a campo / `comPrazosDaLojaAlvo(parsed.data)` / `{disponivel}` / `{oculto}` / `{ordem}` | não |
| `admin-cardapios.ts:177,220` | `atualizar("cardapios", …)` | `linhaDoCardapio(parsed.data, tz)` / `{ativo}` | não |
| `admin-cardapios.ts:678` | `atualizarPorChave("cardapio_produtos", {cardapio_id, produto_id}, {dias_semana})` | `{dias_semana}` | não |
| `admin-cupom.ts:93` | `atualizar("cupons", …)` | `{...parsed.data}` sem `limite_por_cliente` | não |
| `admin-categorias.ts:87,122,180,218,255` | `atualizar("categorias", …)` | literais / `patchFrequenciaCategoria` | não |
| `admin-pagamento.ts:142,227` | `atualizar("formas_pagamento", …)` | `{tipo, config}` / `{config}` | não |
| `admin-opcionais.ts:146,257,287` | `atualizar("opcionais*", …)` | `parsed.data` (schema `.strict()` sem `id`/`loja_id`) / `{ativo}` | não |
| `admin-modal-sazonal.ts:256` | `atualizar("modais_sazonais", …)` | `{ativo:false}` | não |
| `admin-status.ts:100`, `admin-frete-combinado.ts:72` | `atualizar("pedidos", …)` e depois `.eq(...)`/`.in(...)` | `{status}` / campos de frete | não. **O retorno precisa continuar sendo o builder encadeável** |

Nenhum call site legítimo manda chave bloqueada, então o strip não muda o comportamento de nenhum
deles. Os testes das actions admin usam o `admin-loja.ts` **real** com `createServiceClient` mockado.
Procurei asserções de payload de UPDATE contendo `loja_id`/`id` e não achei nenhuma: o único resultado,
`admin-modal-sazonal.escopo.test.ts:424`, verifica **filtros**, não payload.

### Cenários

**Caminho Feliz:**
1. A action admin valida o payload com zod e chama `escopo.atualizar(tabela, id, patch)`.
2. O wrapper tira `loja_id` e `id` do `patch` (não há nenhum, então o objeto chega igual) e emite
   `update(seguro, { count: "exact" }).eq("loja_id", lojaId).eq("id", id)`.
3. Em `atualizarPorChave`: primeiro a guarda de chave vazia (lança), depois o strip de
   `loja_id`, `id` e de cada coluna de `chave`, e por fim os mesmos `.eq` de hoje
   (`loja_id`, depois as colunas da chave, nessa ordem).
4. A action segue lendo `error`/`count` como hoje.

**Casos de Borda:**
- **Patch com `loja_id` alheio via cast** (`atualizar` e `atualizarPorChave`): a chave sai do payload, e
  `.eq("loja_id", lojaId)` continua sendo o do wrapper.
- **Patch com `id` via cast** (as duas funções): sai, porque `id` é chave de escopo em `atualizar` e PK
  em `atualizarPorChave`.
- **Patch com coluna da chave via cast** (`cardapio_id`/`produto_id` em `atualizarPorChave`): sai. É o
  vetor provado na auditoria: `loja_id` + `cardapio_id` + `produto_id` alheios moviam 1 linha.
- **Chave parcial** (`chave = { cardapio_id }`, `patch = { cardapio_id: X }`): `cardapio_id` sai. O
  conjunto bloqueado vem **da chave da chamada**, não de uma lista fixa por tabela.
- **Patch só com chaves bloqueadas:** vira `update({})` e não lança. Mesmo comportamento de
  `atualizarLoja` (teste l. 348–363). Não vamos inventar regra nova (lançar) só para estes dois
  métodos. A paridade fica documentada no teste.
- **Chave vazia:** continua lançando **antes** de qualquer op (o teste E1 já trava isso). O strip não
  pode ficar antes da guarda de um jeito que mude o resultado. Como o strip é puro, a ordem
  "guarda → strip → update" é a natural.
- **Patch legítimo com outras colunas `*_id`** (`categoria_id`, `categoria_opcional_id`): **não** podem
  sair. Um caso anti-sobre-strip (verde desde o início) trava uma implementação errada como
  "remover todo `*_id`".
- **Mutação do objeto do caller:** o strip devolve um objeto novo. Um GREEN do tipo
  `delete patch.loja_id` mexeria no `parsed.data` da action (que `admin-cupom` e `admin-opcionais`
  ainda leem depois para o log). Um caso trava isso.
- **`chave` com `loja_id` via cast** (fora do escopo, sem mudança): adiciona um segundo `.eq("loja_id", X)`
  em AND com o do wrapper. Isso só estreita (zero linhas se X ≠ lojaId) e é seguro. Só fica registrado.
- **`patch` `null`/`undefined` via cast** (fora do escopo): `Object.entries` lançaria `TypeError`.
  `atualizarLoja` tem o mesmo comportamento hoje, o zod sempre entrega objeto e falhar alto aqui é
  fail-closed. Sem tratamento novo.
- Os casos de loja inativa, cupom expirado, produto indisponível e falha de rede não se aplicam: o
  primitivo não lê estado de negócio, e o erro de rede continua vindo em `error` como hoje.

**Tratamento de Erros:** nada muda. O strip é silencioso, igual ao de `atualizarLoja`: não loga nem
lança, porque nenhum caminho do cliente chega até aqui com chave bloqueada (o zod `.strict()` barra
antes). As mensagens genéricas das actions e o `console.error` no servidor continuam como estão
(`seguranca.md` §14).

### Schema de Banco

Não se aplica. Não há migration nem RLS nova. A FK composta `(cardapio_id, loja_id)` /
`(produto_id, loja_id)` continua sendo a terceira camada, e a PoC da auditoria mostrou que ela **não**
segura o re-parent quando o patch move todas as colunas juntas. Por isso a defesa fica no wrapper. Não
dá para fechar isso no banco sem um trigger de "coluna imutável" em cada tabela com `loja_id`, o que
seria desproporcional a uma BAIXA sem vetor de cliente.

### Validação (zod)

Não se aplica. Os schemas `.strict()` das actions continuam sendo a fronteira do cliente. O strip é a
defesa de servidor contra **caller interno** que fura o tipo com cast. Nenhum schema muda.

### Camada de enforcement (cliente ↔ servidor)

| Invariante | Camada | Onde |
|---|---|---|
| Patch admin não re-parenteia linha (`loja_id`) | Servidor: strip em runtime no wrapper (novo) + tipo `Omit` (já existe) | `admin-loja.ts` `atualizar`/`atualizarPorChave` |
| Patch admin não re-chaveia linha (`id`) | idem | idem |
| Patch admin não move linha pela chave natural | Servidor: strip das colunas de `chave` (novo) | `admin-loja.ts` `atualizarPorChave` |
| Payload do cliente sem chaves extras | Servidor: zod `.strict()` (já existe) | schemas em `src/lib/validacoes/` |
| Operação com service role | só em Server Action admin, depois de `verificarAdminSaaS` | `prepararContextoAdmin` (já existe) |

Não há nada do lado do cliente: a issue é 100% servidor.

### Recálculo no Servidor

Não se aplica, porque não há valor monetário. O `atualizar("produtos", …)` grava `preco`, mas o strip
não muda esse campo nem a validação de preço/desconto (`validarPrecoContraDesconto`) que vem antes.

### Arquivos a Criar / Modificar / NÃO tocar

**Modificar:**

1. `src/lib/actions/admin-loja.test.ts` (fase RED, `tdd`). Os casos novos ficam no `describe` do
   `escopo` (l. 158) para `atualizar` e no `describe("[274] escopo.atualizarPorChave …")` (l. 571) para
   `atualizarPorChave`:
   São **3 testes novos**, sem sobreposição com os existentes (decisão do usuário: nenhum teste dobrado).
   - **R1 (RED)** `atualizar("produtos", ID, { nome: "y", categoria_id: "c1", loja_id: "hostil",
     id: "outro" } as never)` ⇒ `op.payload` `toEqual({ nome: "y", categoria_id: "c1" })` **e** o objeto
     passado continua com `loja_id: "hostil"` depois da chamada. A coluna legítima trava um GREEN que
     remova todo `*_id`; a imutabilidade trava um GREEN baseado em `delete`. Sem asserção de `op.eqs`:
     o teste "atualizar escopa por loja_id E id" (l. 169) já cobre os filtros, que nunca vêm do patch.
   - **R2 (RED)** `atualizarPorChave("cardapio_produtos", { cardapio_id: CARDAPIO, produto_id: PRODUTO },
     { dias_semana: [1], loja_id: "hostil", id: "x", cardapio_id: "outro-c", produto_id: "outro-p" } as never)`
     ⇒ `op.payload` `toEqual({ dias_semana: [1] })` **e** objeto passado não mutado. É o vetor exato da
     PoC. Sem asserção de `op.eqs`: o E2 (l. 575) já cobre a tripla de filtros.
   - **R3 (RED)** patch só com bloqueadas, nas duas funções, num único teste ⇒ `op.tipo === "update"`,
     `op.payload` `toEqual({})` e `resultado.error` `toBeNull()`. Paridade com `atualizarLoja`
     (l. 348–363).
   - **Descartados por duplicar cobertura:** caso de chave parcial (mesma tabela do R2, então um strip
     fixo em `cardapio_id`/`produto_id` passaria nos dois; não prova nada novo) e as travas G1/G2 como
     testes separados (viraram asserções do R1/R2).
   - **Remover o teste da l. 618** ("o `loja_id` do wrapper NÃO é substituível por uma coluna homônima
     na chave"). O patch dele é benigno, então a asserção de payload é vazia; o R2 cobre o vetor de
     verdade e o E2 cobre os filtros.
   - **Corrigir o comentário E4 (l. 543–549).** Hoje ele diz que "Não há caso de runtime para isso de
     propósito: um `as never` aqui provaria o contrário do que se quer". Depois desta issue isso é
     falso: passa a existir caso de runtime **de propósito**, e o `as never` é o vetor. Reescrever
     dizendo que o tipo é a 1ª defesa (verificada por `tsc`) e o strip é o backstop (R1–R3). Pela
     regra "nenhum comentário errado", isso entra no mesmo PR.
   - Quem rodar o RED captura o output `FAIL` de R1–R3 antes de mexer em `admin-loja.ts`.

2. `src/lib/actions/admin-loja.ts` (fase GREEN, `executar`):
   - Uma função privada no módulo, perto de `CAMPOS_LOJA_SOMENTE_SERVIDOR`:
     ```ts
     /** Strip em runtime: o `Omit` do tipo é derrotável por cast e `svc` é service_role
      *  (BYPASSRLS) — este filtro é o backstop real. Devolve objeto NOVO (não muta o caller). */
     function semChaves(patch: unknown, bloqueadas: ReadonlySet<string>): Record<string, unknown> {
       return Object.fromEntries(
         Object.entries(patch as Record<string, unknown>).filter(([k]) => !bloqueadas.has(k)),
       );
     }
     const CHAVES_DE_ESCOPO: ReadonlySet<string> = new Set(["loja_id", "id"]);
     ```
   - `atualizar`: `from(tabela).update(semChaves(patch, CHAVES_DE_ESCOPO), { count: "exact" })`, com
     o resto da cadeia igual.
   - `atualizarPorChave`: a guarda de chave vazia continua **primeiro**. Depois vêm
     `const bloqueadas = new Set([...CHAVES_DE_ESCOPO, ...colunas.map(([c]) => c)])` e
     `update(semChaves(patch, bloqueadas), …)`. O resto fica igual.
   - `atualizarLoja`: passa a usar `semChaves(patch, new Set(CAMPOS_LOJA_SOMENTE_SERVIDOR))`, sem
     mudar comportamento. É DRY de verdade: hoje já existe uma cópia do padrão e esta issue criaria mais
     duas. Os 7 testes de `atualizarLoja` (l. 237–363) cobrem a refatoração. Se algum deles mudar, a
     refatoração está errada; volte atrás em vez de editar o teste.
   - Docstrings de `atualizar` (l. 155–158) e `atualizarPorChave` (l. 176–179): hoje dizem que o
     wrapper barra "POR TIPO". Acrescentar que o strip em runtime é o backstop, como já diz a docstring
     de `atualizarLoja` (l. 206–212).
   - **Assinaturas públicas e tipos de retorno sem mudança.** `EscopoLoja` continua
     `ReturnType<typeof criarEscopoLoja>`, e `admin-status`/`admin-frete-combinado` continuam
     encadeando `.eq`/`.in` no retorno de `atualizar`.

3. `references/seguranca.md` §7 (l. 728): trocar a frase "**Débito conhecido (issue 282):** …" por uma
   descrição do strip em runtime (`loja_id`, `id` e colunas de `chave`, mesmo padrão de
   `atualizarLoja`). Na l. 704 o título "garantido por tipo, não por convenção" pode virar "por tipo e
   por runtime". Pode ir no mesmo PR, ou o `escriba` faz.
4. `references/architecture.md` §10 (l. 461): **remover** a linha do débito "issue 282" no mesmo PR.
5. `tasks/282-escopoloja-strip-em-runtime-do-patch.md`: `git rm` na branch, antes do `/pr`. O plano vai
   para `plan/arquivo/`.

**NÃO tocar:**
- Os call sites em `src/app/admin/assinantes/actions/*.ts`: nenhum precisa mudar, e mexer neles fugiria
  do escopo.
- `inserir`/`inserirVarios`: `loja_id` já é injetado por último, e `id` no INSERT é legítimo.
- `remover`/`buscarPorId`: não recebem payload.
- `admin-opcionais.ts` `descartarLojaId`: outra camada (pré-zod), outra finalidade.
- `admin-loja.binding.test.ts`: já exercita `atualizar` com o client no formato real (l. 196). O strip
  não muda o binding, e a suíte deve continuar verde sem edição.
- `src/lib/database.types.ts`, `supabase/migrations/`, `components/ui/`.

### Dependências Externas

Nenhuma. Não há pacote, API nem serviço novo, e o custo variável é zero.

### Ordem de Implementação

Issue **crítica** (primitivo de escrita sob `service_role`), então a ordem é red-first:

1. **`tdd` (RED):** escrever R1–R3 em `admin-loja.test.ts`, remover o teste da l. 618 e corrigir o
   comentário E4. Rodar
   `npx vitest run src/lib/actions/admin-loja.test.ts` e **capturar o `FAIL`** de R1–R3. As asserções
   são de payload (`toEqual`), não de "lança": um `TypeError` não passa por acaso. Rodar `npx tsc --noEmit`,
   porque o Vitest não checa tipos e o `as never` precisa compilar.
2. **`executar` (GREEN):** criar `semChaves` + `CHAVES_DE_ESCOPO`, aplicar em `atualizar` e
   `atualizarPorChave`, depois refatorar `atualizarLoja` para usar o mesmo helper e atualizar as
   docstrings. Nessa ordem, porque o helper vem antes dos usos e a refatoração de `atualizarLoja` só
   depois que o RED novo estiver verde, para isolar regressão.
3. **Suítes afetadas:** `admin-loja.test.ts`, `admin-loja.binding.test.ts`,
   `src/lib/actions/cardapio-posse.enforcement.test.ts` (ele analisa arquivos que citam
   `cardapio_produtos` e `admin-loja.ts` cita em comentário; como `criarEscopoLoja` não é
   `export async function`, a análise não deve mudar, mas confirme),
   `src/app/admin/assinantes/enforcement-escopo-admin.test.ts` e
   `npx vitest run src/app/admin/assinantes/actions`.
4. **Docs:** `seguranca.md` l. 728 (e l. 704) e remoção da linha do `architecture.md` §10.
5. **Gate completo:** `npx tsc --noEmit` → `npm run lint` → `npm test` → `npm run build`.
6. Higiene de fechamento: `git rm tasks/282-…md` e `git mv plan/282-…md plan/arquivo/` na branch.

**Riscos:**
- **Sobre-strip** (tirar coluna legítima) quebraria escrita admin em silêncio, porque o UPDATE passa sem
  o campo. A coluna legítima do R1 trava isso, e a suíte das actions admin roda contra o wrapper real.
- **Refatoração de `atualizarLoja`** mexe num backstop de billing (RN-M3). Os 7 testes existentes são
  a rede. Se algum ficar vermelho, desfaça a refatoração e mantenha `atualizarLoja` como está; a issue
  não depende dela.
- **Comentário E4 desatualizado** é o drift mais provável de passar despercebido no review. Ele é parte
  do critério de aceite do RED.
