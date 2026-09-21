# Spec: Vigência por item do cardápio (agenda semanal por vínculo)

**Versão:** 0.1.0 | **Atualizado:** 2026-09-21

> **Filha direta de `specs/arquivo/cardapio-sazonal.md` (Spec B, v0.4.0, arquivada).** Esta spec
> **não reabre** nenhuma regra daquela: não cria modo de vigência novo, não mexe em
> `produtos.visibilidade`, não toca em preço, não cria segunda janela. Ela **acrescenta um eixo de
> filtro dentro da janela que já existe** — a agenda semanal do **vínculo** produto↔cardápio.
>
> **Numeração local.** As regras desta spec são **RN-01..RN-14 desta spec**. Toda referência à
> spec-mãe é escrita por extenso: *"RN-05 da spec-mãe"*. Os IDs não se misturam.
>
> **Pedido literal do dono do SaaS** (sessão de 2026-09-21, transcrito em
> `plan/loop-vigencia-por-item-do-cardapio.md` §0):
>
> > A visibilidade por dia da semana hoje é atributo do **cardápio inteiro**. Ele precisa que um
> > cardápio "Especiais do Dia" fique aberto a semana inteira e que **cada produto dentro dele**
> > tenha a própria agenda semanal: "Virado à Paulista" só segunda, "Dobradinha" só terça,
> > "Feijoada" quarta e sábado. Cliente que acessa na quarta vê a seção "Especiais do Dia" contendo
> > só a Feijoada.
>
> **Issues companheiras do mesmo loop, citadas e NÃO reescritas aqui:**
> `tasks/270-lote-de-cardapio-on-conflict-pula-fk-composta.md` (crítica SIM — conserta o mesmo
> caminho de escrita que `definirDiasDoVinculo` vai espelhar; **pré-requisito**, entra antes de
> qualquer código desta spec) e `tasks/271-buscarcardapioporid-valida-uuid-fail-closed.md`
> (crítica NÃO — toca `queries/cardapios.ts`, o mesmo arquivo; entra como `/fix` no mesmo branch).

---

## Visão Geral

Hoje a sazonalidade tem **uma** granularidade: o cardápio. O lojista que quer um "Especiais do Dia"
com prato diferente por dia da semana tem de criar **sete cardápios** — "Especiais de segunda",
"Especiais de terça", … — e a vitrine mostra sete seções de destaque, uma com um prato cada. Ele
pediu o contrário: **um** cardápio aberto a semana inteira, com **uma agenda por produto dentro
dele**.

Esta spec dá ao vínculo produto↔cardápio uma coluna `dias_semana`. A regra que sai disso é **uma
só**, e ela é um **filtro dentro da janela do cardápio**, nunca uma segunda janela:

```
itemAberto(vínculo) = cardapioAberto(vínculo.cardapio)          ← a janela do cardápio, intacta
                      E ( vínculo.dias_semana vazio             ← "todos os dias do cardápio"
                          OU vínculo.dias_semana contém diaIndex )
```

`dentroDaJanela(produto)` continua sendo a **união** entre os vínculos do produto (RN-05 da
spec-mãe, operador inalterado): basta **um** vínculo com `itemAberto`.

**Por que filtro e não janela.** Uma segunda janela independente abriria a porta para o produto
aparecer num dia em que o cardápio está fechado — o lojista desligaria o cardápio e o prato
continuaria no ar. O `E` com `cardapioAberto` torna isso **impossível por construção**: desligar o
cardápio continua sendo o gesto que apaga tudo (RN-03 da spec-mãe, intacta).

**Mundos em que vive:**

| Mundo | O que muda |
|---|---|
| Vitrine pública (`/loja/[slug]`, `/loja/[slug]/pedido`) | a seção de destaque do cardápio aberto lista **só os itens abertos hoje**; item fora do dia aparece marcado na categoria dele, com o rótulo vindo dos **dias do item**; o checkout revisa e `criarPedido` recusa |
| Painel do lojista (`/painel/cardapios/[cardapioId]`, `/painel/produtos`) | 7 pílulas por produto vinculado, "Definir dias" na ação em lote, atalho "Todos os dias" no `FormVigencia`, leitura "Está em: … (qua e sáb)" no `FormProduto` |
| Hub admin (`/admin/assinantes/[lojaId]/cardapios/[cardapioId]`, `.../produtos`) | **paridade total** com o lojista — a 269 já estabeleceu o contrato neutro e as actions admin; esta spec as espelha, não abre exceção |
| Auth | nada muda |

**O que NÃO é:** não é horário por item (§Decisões do dono do produto, (b)), não é dia do mês por
item, não é ordenação de produto dentro da seção de destaque, e **não é** um estado do produto — é
estado do **vínculo**. O mesmo produto pode ser "só quarta" no "Especiais do Dia" e "todo dia" no
"Cardápio de Inverno", e a união decide.

---

## Atores Envolvidos

| Ator | O que faz nesta feature |
|---|---|
| **iRango (SaaS)** | fornece o eixo de filtro. Avalia o dia **no fuso da loja, no servidor**, com a mesma função pura que já decide a janela do cardápio. Garante que loja A nunca escreve dias no vínculo da loja B e que item fora do dia **não vira pedido**. Continua sem tocar em pagamento (`modelo-negocio.md` §3). |
| **Lojista** | marca, por produto dentro de um cardápio, em que dias da semana ele aparece. Nenhum dia marcado = todos os dias do cardápio. É avisado quando a agenda que marcou **nunca** vai abrir (RN-06). O sistema nunca marca nem desmarca dia sozinho. |
| **Admin do SaaS** | faz o mesmo, na loja-alvo, pela via `service_role` do hub — com o `loja_id` **da URL validada**, log de acesso e a mesma frase de recusa do lojista. |
| **Cliente** | vê a seção do cardápio contendo só os pratos do dia; vê o prato fora do dia marcado na categoria dele, com "Só às quartas e sábados"; não consegue adicioná-lo; se forçar, tem o pedido recusado. **Nunca** informa dia, hora ou fuso, e nunca decide se um item está aberto. |

---

## O que muda nas quatro regras herdadas

| Regra da spec-mãe | O que era | O que passa a significar |
|---|---|---|
| **RN-02** (vigência recorrente) | `diaOk = dias_semana ∪ dias_mes` (**OU** entre os eixos), `horaOk`, `aberto = diaOk E horaOk`. Eixo vazio = sem restrição. | **Inalterada, byte a byte.** Ela continua respondendo *"o cardápio está aberto?"*. O eixo do item é aplicado **depois e por fora**, em `E` com o resultado dela. O `OU` entre `dias_semana` e `dias_mes` **permanece dentro do cardápio**; o `E` com o item é o de fora. Ver RN-02 desta spec para o caso numérico. |
| **RN-05** (união entre cardápios + precedência do motivo) | `dentroDaJanela = visibilidade==='menu' \|\| cardapios.some(cardapioAberto)` | **Operador inalterado**: continua `some`. Muda só o **predicado de dentro**: `vinculos.some(itemAberto)` em vez de `cardapios.some(cardapioAberto)`. Produto do menu continua curto-circuitando antes de olhar vínculo nenhum. A precedência `"fora_da_janela"` > `"esgotado"` continua idêntica — o item fora do **dia** produz o mesmo motivo do item fora da **janela**, porque para o cliente é a mesma frase útil ("volta quarta"). Nenhum motivo novo na união `MotivoNaoCompravel`. |
| **RN-13** (aparece marcado × some da vitrine) | Uma pergunta só: *existe próxima abertura conhecida?* `visivelNaVitrine = menu \|\| dentroDaJanela \|\| proximaAbertura !== null` | **A pergunta é a mesma; quem responde passa a ser o vínculo.** `voltaAAbrir` deixa de ser propriedade do cardápio e vira propriedade do **vínculo** (RN-03 desta spec). Consequência: o produto exclusivo de um cardápio recorrente com dias de item marcados **sempre** tem volta — ele nunca some, só alterna entre comprável e marcado. Quem some continua sendo o exclusivo de prazo fixo expirado ou de cardápio desligado. |
| **RN-15 / D16** (seção de destaque do cardápio aberto) | Toda seção existe **enquanto o cardápio está aberto** e lista os produtos vinculados; seção sem produto visível não é devolvida (issue 177, reaplicada em `agruparPorCardapio`). | **A seção passa a listar só os itens abertos AGORA.** Um vínculo cujo dia não é hoje **não entra** na seção — mas o produto continua na **categoria** dele, marcado (D16-a intacto: a seção é destaque, não é a casa do produto). E, por decisão desta spec (RN-05), **a seção some quando nenhum item está aberto hoje**, mesmo com o cardápio aberto. |

---

## Páginas e Rotas

### Vitrine da loja — `/loja/[slug]`

**Mundo:** vitrine pública (sem auth)

**Descrição:** o cardápio "Especiais do Dia" está aberto de segunda a domingo. Numa quarta-feira, a
seção de destaque no topo mostra **só a Feijoada**. O "Virado à Paulista" (só segunda) e a
"Dobradinha" (só terça) continuam aparecendo na categoria deles — marcados, sem botão de compra,
com o selo "Só às segundas" / "Só às terças", exatamente com o mesmo tratamento visual que o
produto fora da janela do cardápio já tem hoje (`CardProduto`, pill + `disabled` + `aria-label`).
**Nenhum estilo novo, nenhum motivo novo, nenhum campo novo em `ProdutoVitrine`.**

**Componentes:** (todos **existentes** — esta spec não cria componente de vitrine)
- `projetarCatalogoVitrine` (`lib/utils/catalogoVitrine.ts`) — **modificar**: recebe
  `vinculosPorProduto` em vez de `cardapiosPorProduto` (RN-09).
- `agruparPorCardapio` (mesmo módulo) — **modificar**: o laço que hoje empurra o produto na seção
  de cada cardápio aberto passa a consultar `itemAberto(vínculo)`. O filtro final
  `secao.produtos.length > 0` **já existe** e é o que faz a seção sumir quando não há item do dia
  (RN-05 desta spec) — **nenhuma linha nova de filtro**.
- `descreverVigencia.ts` — **modificar**: `rotuloVoltaQuando` ganha a variante por vínculo
  (RN-08); `descreverVigencia` ganha "Todos os dias" (RN-07).
- `CardProduto`, `ItemProdutoLista`, `ProdutoModal`, `SecaoCatalogo`, `CatalogoVitrine`,
  `NavCategorias`, `ancoraSecao`, `filtrarCatalogo` — **não tocar**. O contrato que eles consomem
  (`compravel`, `motivoNaoCompravel`, `rotulosVigencia`) é o mesmo.
- `page.tsx` da vitrine — **modificar**: só o nome do índice (`vinculosPorProduto`). Nenhuma query
  nova, nenhuma ida a mais ao banco: `COLUNAS_CARDAPIO_VIGENCIA` ganha **uma coluna escalar** dentro
  do embed que já existe.

**Behaviors:**
- [ ] **Ver na seção do cardápio só os pratos do dia** — quarta-feira mostra a Feijoada e não mostra
  o Virado nem a Dobradinha. Garantido em: **SSR** — `itemAberto` roda no servidor, no fuso da loja,
  no instante do request. O cliente nunca avalia dia.
- [ ] **Não ver a seção do cardápio num dia sem nenhum item aberto** — o título não aparece vazio.
  Garantido em: **SSR** (RN-05 desta spec, pelo filtro de grupo vazio que já existe).
- [ ] **Achar o prato fora do dia na categoria dele, marcado e sem botão** — o Virado continua em
  "Pratos executivos" numa quarta, desabilitado. Garantido em: **SSR** (RN-01, RN-04).
- [ ] **Ler no selo os dias do ITEM, não os do cardápio** — "Só às quartas e sábados", e não "Todos
  os dias" (que é a janela do cardápio). Garantido em: **SSR** (RN-08).
- [ ] **Comprar normalmente o prato do dia** — nenhuma diferença em relação a hoje. Garantido em:
  **SSR** (estado) + **Server Action `criarPedido`** (o que é cobrado — RN-04).
- [ ] **Não ser afetado quando o produto é `visibilidade = 'menu'`** — produto do menu com vínculo
  agendado continua vendendo todo dia; a agenda do vínculo só decide **destaque**, nunca compra,
  para ele. Garantido em: **SSR** (RN-05 da spec-mãe curto-circuita antes de olhar vínculo).
- [ ] **Buscar o prato fora do dia e ver o mesmo estado** — o filtro do cliente é subtrativo e não
  reprojeta nada. Garantido em: **SSR** (comportamento existente, coberto por teste de
  `filtrarCatalogo`).

---

### Checkout — `/loja/[slug]/pedido`

**Mundo:** vitrine pública (sem auth)

**Descrição:** o cliente adicionou a Feijoada numa quarta às 23:58 e chegou ao checkout na quinta às
00:02. A linha fica **bloqueada**, com o motivo, e o envio trava até ele remover — o mesmo desenho
que a spec-mãe já fixou para o item fora da janela. Não há "confirmar assim mesmo".

**Componentes (todos existentes):**
- `revisarCarrinho.ts` — **modificar**: lê `vinculosPorProduto` e chama
  `avaliarVigenciaDoProduto` com os vínculos. Nenhuma regra nova no arquivo.
- `pedido.ts` (`criarPedido`) — **modificar**: idem, no laço de recusa que já existe.
- `EtapaItens`, `ResumoValores`, `podeConfirmar` — **não tocar**.

**Behaviors:**
- [ ] **Ver a linha do item que saiu do dia bloqueada, com o motivo.** Garantido em:
  **Server Action** (`revisarCarrinhoAction`, a partir do banco e do relógio do servidor no fuso da
  loja) + **cliente (UX)** (a frase).
- [ ] **Não conseguir finalizar com um item fora do dia no carrinho.** Garantido em:
  **cliente (UX)** para o botão (`podeConfirmar` — cortesia) e **Server Action** para a recusa de
  verdade.
- [ ] **Ter o pedido recusado ao enviar a Feijoada numa segunda-feira** (payload forjado, ou corrida
  de segundos entre a revisão e o INSERT). Garantido em: **Server Action + RLS** — `criarPedido`
  recusa o **pedido inteiro** antes de chamar a RPC, com o mesmo padrão em que já recusa produto
  indisponível/oculto/de outra loja. **RN-04. Fatia crítica: é o vermelho principal do loop.**
- [ ] **Ter o valor recalculado do banco em qualquer cenário** — o cliente nunca informa dia, hora,
  fuso nem preço. Garantido em: **Server Action + RPC `criar_pedido`** (`seguranca.md` §10,
  inalterado).

---

### Detalhe do cardápio — `/painel/cardapios/[cardapioId]`

**Mundo:** painel (auth obrigatório, sob `(bloqueavel)`)

**Descrição:** é a tela principal desta feature. Cada produto **já vinculado** ganha, na própria
linha, 7 pílulas `D S T Q Q S S`. Nenhuma marcada = *"Todos os dias do cardápio"*. Marcar ou
desmarcar salva na hora, sem botão de submit — é uma escrita pequena, idempotente e reversível com
o mesmo clique. O produto **não vinculado** não mostra pílulas: agenda é do vínculo, e vínculo que
não existe não tem agenda.

O `FormVigencia` (a vigência do **cardápio**, acima na mesma rota) ganha o atalho **"Todos os
dias"**, que marca os 7 dias de uma vez — é o gesto que torna "Especiais do Dia" configurável em um
clique, sem inventar um `modo` novo no banco (o CHECK `cardapios_recorrente_tem_eixo` segue
valendo, porque 7 dias marcados **é** um eixo preenchido).

**Componentes:**
- `SeletorProdutosDoCardapio` (`components/painel/`) — **modificar**: a linha do produto vinculado
  ganha as pílulas e o aviso de RN-06.
- **`PilulasDeDias`** — **criar**, extraído do bloco que já existe em `FormVigencia.tsx:286`.
  Componente controlado, sem estado próprio, consumindo `DIAS_DA_SEMANA`
  (`components/painel/rascunhoCardapio.ts:81`) — **a tabela de dias não é reescrita** (mandato 2).
  Duas superfícies, uma implementação. Alvo de toque `min-h-[44px] min-w-[44px]` **literal**
  (`design-system.md` §5 — a base de fonte é 120% e `min-h-11` não bate 44px), rótulo acessível por
  pílula, e a régua já registrada lá: **linha que ganha prefixo soma chrome; em 360px a saída é
  comprimir, não estourar**. O layout exato é do agente `desenhar`, que roda depois deste spec.
- `FormVigencia` — **modificar**: botão "Todos os dias" + troca do bloco inline por `PilulasDeDias`.
- `DialogoLoteCardapio` + `contrato-lote.ts` + `useLoteDeProdutos` — **modificar**: entra a ação
  **"Definir dias"** no diálogo de alcance que já existe, com a mesma prévia vinda do servidor
  (`preverLoteAction`, RN-09-a da spec-mãe) e a mesma trava de "o número vai dentro do rótulo do
  botão". **Nenhum segundo caminho de escrita e nenhuma segunda redação de confirmação.**
- `Button`, `Toggle`/`Checkbox`, `Badge`, `Card`, `AlertDialog` — **reuso** de `components/ui/`
  (gerado pelo shadcn CLI, não editar à mão — `design-system.md` §7).

**Behaviors:**
- [ ] **Marcar "qua" e "sáb" na linha da Feijoada e ver salvo sem submit.** Garantido em:
  **Server Action + RLS** (`definirDiasDoVinculo`, `cardapio_produtos_escrita_propria`) +
  **zod** (`schemaDiasDoVinculo`) + **CHECK** (`cardapio_produtos_dias_semana_dominio`). O
  `loja_id` vem de `buscarLojaDoDono`, **nunca** do payload — RN-10.
- [ ] **Desmarcar todas as pílulas e voltar a "Todos os dias do cardápio".** Garantido em:
  **Server Action** (`[]` é normalizado para `NULL` no servidor — RN-11) + **cliente (UX)** para o
  rótulo.
- [ ] **Definir dias para vários produtos de uma vez, pela ação em lote.** Garantido em:
  **Server Action + RLS + FK composta** (RN-09 da spec-mãe, caminho de escrita inalterado — e
  corrigido antes por `tasks/270`) + **Server Action** para a prévia (o cliente não conta nada).
- [ ] **Ser avisado de que a agenda marcada nunca vai abrir** — cardápio {sáb, dom} e item {qua}: o
  painel diz, na própria linha, *"Este item nunca aparece: o cardápio só abre aos sábados e
  domingos."* O salvamento **não é bloqueado** (RN-06). Garantido em: **SSR (preview de UX)** — a
  frase é recalculada no servidor a cada render a partir do cardápio salvo; nada depende dela.
- [ ] **Marcar os 7 dias do cardápio com um clique ("Todos os dias").** Garantido em:
  **cliente (UX)** para a marcação + **Server Action + zod + CHECK** (`cardapios_recorrente_tem_eixo`)
  para o que é gravado.
- [ ] **Ler a prévia dizendo "Todos os dias" quando os 7 estão marcados.** Garantido em:
  **SSR / cliente (UX)** — a **mesma** função pura `descreverVigencia` nos dois lados, com `agora` e
  `timezone` injetados (isomórfico, como `calcularFrete`). RN-07.
- [ ] **Não conseguir definir dias num vínculo de outra loja**, nem mandando `cardapio_id` ou
  `produto_id` alheio no payload. Garantido em: **RLS** + **Server Action** (escopo por `loja_id`
  derivado da sessão) + **FK composta** como trava estrutural. A recusa usa a **mesma frase** de
  "não existe" — sem oráculo (`seguranca.md` §14). **RN-12. Fatia crítica.**

---

### Produtos do painel — `/painel/produtos`

**Mundo:** painel (auth obrigatório, sob `(bloqueavel)`)

**Descrição:** a linha do produto já diz de quais cardápios ele participa e se está dentro da janela
agora (`CardapioDoProduto`, issue 260). Passa a dizer **em que dias** — *"Especiais do Dia (qua e
sáb)"*. O `FormProduto` mostra a mesma informação em **somente leitura**, na linha "Está em:" que já
existe (`FormProduto.tsx:744`): a agenda é editada onde ela vive, que é o detalhe do cardápio.

**Componentes:**
- `FormProduto` — **modificar**: `cardapiosDoProduto` ganha os dias por vínculo, e a linha passa a
  renderizar o rótulo. **Nenhum controle novo, nenhum campo novo no `schemaProduto`.**
- `ProdutosClient` + `contrato-lote.ts` (`CardapioDoProduto`) — **modificar**: um campo a mais,
  `dias: number[] | null`, e a frase derivada dele no servidor.

**Behaviors:**
- [ ] **Ver, na linha do produto, em que dias ele aparece em cada cardápio.** Garantido em:
  **SSR** (preview de UX — a frase vem de `descreverVigencia`, o browser nunca redige janela).
- [ ] **Ler "Está em: Especiais do Dia (qua e sáb)" no form do produto, sem poder editar ali.**
  Garantido em: **SSR** (preview de UX) — a escrita mora em `definirDiasDoVinculo`, e não existe
  segundo caminho.

---

### Cardápio no hub admin — `/admin/assinantes/[lojaId]/cardapios/[cardapioId]` e `.../produtos`

**Mundo:** painel admin (auth obrigatório + `verificarAdminSaaS`)

**Descrição:** **paridade total** com as duas telas do lojista. A 269 já pagou esse preço: o
contrato neutro (`lib/actions/cardapio-contrato.ts`), as actions admin
(`app/admin/assinantes/actions/admin-cardapios.ts`), as cargas
(`carga-cardapio-detalhe.ts`, `carga-cardapios.ts`) e o `CardapioAdminClient` já existem. Esta spec
**não abre exceção de escopo**: se a feature existe no lojista, existe no admin, com log de acesso.

**Componentes:** `CardapioAdminClient`, `carga-cardapio-detalhe.ts`, `admin-cardapios.ts`,
`admin-loja.ts` (`EscopoLoja`) — **modificar**. `PilulasDeDias` e `SeletorProdutosDoCardapio` são
**os mesmos** componentes do lojista.

**Behaviors:**
- [ ] **Definir os dias de um vínculo na loja-alvo.** Garantido em: **Server Action**
  (`definirDiasDoVinculoAdmin`) + **`verificarAdminSaaS` ANTES de elevar a `service_role`**
  (fail-closed: se a prova lança, a exceção propaga e o service client nunca é criado) +
  **`loja_id` do `lojaId` da URL validado**, injetado pelo wrapper `EscopoLoja` — **nunca** do
  payload. **RLS não protege este caminho** (`service_role` tem BYPASSRLS): o que protege é a
  **FK composta** + o escopo explícito. RN-12.
- [ ] **Ter a ação registrada no log de acesso admin.** Garantido em: **Server Action**
  (`registrarAcessoAdmin`, `acao: "cardapio.definir_dias"`, `entidadeId: cardapio_id`,
  `metadados: { produto_id, dias: n }` — contagem, nunca PII).
- [ ] **Receber exatamente a mesma frase de recusa do lojista** para vínculo inexistente ou de outra
  loja. Garantido em: **Server Action** (constante única em `cardapio-contrato.ts` — paridade por
  construção, não por cópia).

---

## Modelos de Dados

Referência: `references/schema.md`. **Nenhuma tabela nova** ⇒ nenhuma política RLS nova
(`seguranca.md` §2 satisfeito pelas policies de `cardapio_produtos` criadas em
`supabase/migrations/20260920129000_cardapio_produtos.sql`, que cobrem a coluna nova sem alteração —
policy é por **linha**, não por coluna). **Nenhum GRANT novo** pelo mesmo motivo.

### Migration aditiva — `cardapio_produtos.dias_semana`

```sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Vigência por ITEM do cardápio: agenda semanal do VÍNCULO produto↔cardápio.
-- Spec: specs/vigencia-por-item-do-cardapio.md (RN-01, RN-11).
--
-- ADITIVA E REVERSÍVEL. Coluna NULLABLE, SEM DEFAULT e SEM BACKFILL: todo
-- vínculo existente fica `NULL`, que a regra lê como "todos os dias do
-- cardápio" — o comportamento de hoje, byte a byte. NADA muda no deploy, e a
-- aplicação antiga continua funcionando contra o schema novo (a coluna é
-- ignorada por quem não a seleciona).
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.cardapio_produtos
  add column dias_semana smallint[];

comment on column public.cardapio_produtos.dias_semana is
  'Dias da semana em que ESTE produto aparece DENTRO deste cardapio. 0=dom..6=sab, mesma convencao de partesNoFuso e de cardapios.dias_semana. NULL = todos os dias do cardapio. NUNCA e uma segunda janela: a regra e cardapioAberto(cardapio) E (dias_semana vazio OU contem(diaIndex)) — RN-01.';

-- Domínio, e só isso. O array VAZIO passa de propósito (`<@` e verdadeiro para
-- `{}`): vazio e NULL sao SEMANTICAMENTE IDENTICOS aqui ("sem restricao por
-- este eixo"), diferente de `cardapios_recorrente_tem_eixo`, onde vazio em
-- todos os eixos significava um cardapio que nao restringe nada. A Server
-- Action normaliza `[]` para NULL (RN-11) para que haja UMA representacao no
-- banco; o CHECK nao precisa proibir a outra.
alter table public.cardapio_produtos
  add constraint cardapio_produtos_dias_semana_dominio
  check (
    dias_semana is null
    or dias_semana <@ array[0,1,2,3,4,5,6]::smallint[]
  );
```

**Não entra nesta migration, de propósito:** nenhum índice. A coluna é lida **sempre** junto com a
linha que já é lida pelo embed `cardapio_produtos(...)` de `COLUNAS_CARDAPIO_VIGENCIA` — nunca é
critério de filtro em SQL, porque a decisão de dia é **função pura em TS** (RN-01 desta spec e RN-06
da spec-mãe: janela nunca vira SQL).

```sql
-- ─────────────────────────────────────────────────────────────────────────────
-- ROLLBACK (manual, fora da migration — nunca automático)
--
-- Janela segura: TOTAL. Reverter volta todo vínculo a "todos os dias do
-- cardápio", que é o comportamento de hoje. O ÚNICO dado perdido é a agenda que
-- o lojista tiver marcado depois do deploy — nenhum vínculo, produto, cardápio
-- ou pedido é afetado. Reverter DEPOIS de retirar o código que seleciona a
-- coluna (senão o select nomeado quebra com `42703`).
--
--   alter table public.cardapio_produtos
--     drop constraint if exists cardapio_produtos_dias_semana_dominio;
--   alter table public.cardapio_produtos
--     drop column if exists dias_semana;
-- ─────────────────────────────────────────────────────────────────────────────
```

### Contrato de dados em TypeScript (mudança de contrato — RN-09)

```ts
// src/lib/utils/vigenciaCardapio.ts
/** Um vínculo produto↔cardápio reduzido ao que decide vigência (RN-01). */
export type VinculoVigencia<C extends CardapioVigencia = CardapioVigencia> = {
  cardapio: C;
  /** 0=dom..6=sab. NULL ou vazio = todos os dias do cardápio. */
  dias_semana: number[] | null;
};
```

- `avaliarVigenciaDoProduto(produto, vinculos: VinculoVigencia<C>[], agora, timezone)` — o segundo
  parâmetro troca de `CardapioVigencia[]` para `VinculoVigencia[]`.
- `queries/cardapios.ts`: `COLUNAS_CARDAPIO_VIGENCIA` passa a embutir
  `cardapio_produtos(produto_id, dias_semana)`; o índice `cardapiosPorProduto` é **renomeado** para
  **`vinculosPorProduto: Map<string, VinculoVigencia<CardapioDaLoja>[]>`**.
- `contarProdutosEscondidos.ts`: `CardapiosPorProdutoLidos` vira `VinculosPorProdutoLidos`;
  `listarProdutosEscondidos`, `contarProdutosEscondidos` e `diagnosticarSumico` recebem vínculos.
- `agruparPorCardapio(produtos, cardapiosAbertos, vinculosPorProduto)`.

**O rename é mecânico e tem gate mecânico:** `npx tsc --noEmit` = 0 erros e
`grep -rn cardapiosPorProduto src/` = vazio. A lista fechada de consumidores está no
`plan/loop-vigencia-por-item-do-cardapio.md` §0, item 17 (17 arquivos não-teste + ~13 de teste).
**Por que renomear em vez de manter o nome:** o `Map` deixa de conter cardápios e passa a conter
vínculos. Manter `cardapiosPorProduto` apontando para vínculos é exatamente como nasce o bug de
alguém ler `.get(id)[0].ativo` e receber `undefined` em silêncio — aqui o `tsc` pega, mas o **nome**
é o que impede o próximo leitor de errar.

---

## Regras de Negócio

> Legenda da camada: **cliente (preview)** = estética, nunca autoritativo · **SSR** = decidido no
> servidor durante o render · **Server Action** = recalculado do banco · **RLS** = isolamento por
> linha · **FK/CHECK** = impossível por construção no banco · **zod** = validação isomórfica.

### O motor

**RN-01 — A regra é UMA, e é um filtro DENTRO da janela do cardápio.**

```
itemAberto(vínculo, agora, tz) =
      cardapioAberto(vínculo.cardapio, agora, tz)                ← RN-02/RN-03/RN-04 da spec-mãe
  E  ( (vínculo.dias_semana ?? []).length === 0                  ← vazio = sem restrição
       OU vínculo.dias_semana.includes(diaIndex) )               ← diaIndex vem de partesNoFusoCompletas
```

`diaIndex` é **o mesmo** de `partesNoFusoCompletas` (`lib/utils/fusoLoja.ts`), no fuso da **loja**:
0=dom..6=sáb. **Nenhum `Intl`, nenhum parse de hora e nenhuma segunda tabela de dias** entram nesta
regra (mandato 2).

**Os dois casos numéricos que separam as leituras possíveis:**

| Cardápio | Item | Instante | Veredito | Por quê |
|---|---|---|---|---|
| `dias_semana = {seg..dom}` (os 7) | `dias_semana = {qua, sáb}` | **quarta-feira** | **ABERTO** | `cardapioAberto = true` (quarta está nos 7) **E** item contém 3 (qua). É o pedido literal do dono: cardápio aberto a semana inteira, prato só na quarta. |
| `dias_semana = {sáb, dom}` | `dias_semana = {qua}` | **qualquer** | **NUNCA ABRE** | é **interseção**: `cardapioAberto` é falso toda quarta, e o item é falso todo sábado e domingo. **Não é erro de gravação** e não é recusado — é uma configuração legítima em trânsito (o lojista pode estar prestes a corrigir o cardápio). O painel **avisa** (RN-06). |

**Interação com `dias_mes` do cardápio.** O `OU` entre `dias_semana` e `dias_mes` da spec-mãe
(RN-02) **fica inteiramente dentro de `cardapioAberto`** e não é tocado. O `E` desta regra é **por
fora** dele. Caso numérico: cardápio `dias_semana = {sáb, dom}` + `dias_mes = {15}`, item
`dias_semana = {qua}`, numa **quarta-feira dia 15** ⇒ **ABERTO** — `cardapioAberto` é verdadeiro
pelo eixo `dias_mes` (o `OU` da spec-mãe), e o item contém quarta. No **dia 16**, quarta, ⇒
**FECHADO**. O item **não** ganha eixo de dia do mês (§Fora do Escopo).

→ Camada: **SSR / Server Action** (a decisão, sempre) + **cliente (preview)** (só o texto do
preview no painel). **O browser nunca decide se um item está aberto.**

**RN-02 — `dentroDaJanela` continua sendo UNIÃO, agora sobre vínculos.**

```
dentroDaJanela(produto) = visibilidade === 'menu'
                       || vinculos.filter(v => v.cardapio.ativo).some(itemAberto)
```

O operador (`some`) e o curto-circuito de `visibilidade === 'menu'` são **os mesmos** de RN-05 da
spec-mãe. Os três argumentos que fundamentaram a união lá valem aqui com mais força, porque agora
um produto pode estar em dois cardápios com **agendas diferentes**: pôr o produto em mais um
cardápio (ou marcar mais um dia) **nunca reduz** a disponibilidade dele. Monotonicidade é a
propriedade que o lojista consegue raciocinar sem ler documentação.

→ Camada: **SSR / Server Action**.

**RN-03 — `voltaAAbrir` passa a ser propriedade do VÍNCULO, não do cardápio.**

```
voltaAAbrir(vínculo, agora) =
    vínculo.cardapio.modo === 'prazo_fixo'
      ? (prazo_fim === null || agora < prazo_fim)      ← só enquanto não expirou
      : (hora_inicio === null || hora_fim === null || hora_inicio < hora_fim)
```

Em português: **item com dias não vazios num cardápio recorrente sempre volta** (a semana
recomeça); num **prazo fixo**, volta só enquanto o prazo não expirou. A faixa de horário degenerada
(`hora_inicio >= hora_fim`) continua sendo o único caso de recorrente que não volta — regra já
existente, inalterada.

**O eixo do item NÃO entra neste predicado, de propósito.** Marcar dias no item nunca tira a volta:
se o cardápio volta a abrir, o dia do item chega junto. A única exceção teórica é a **interseção
vazia** da tabela de RN-01 (cardápio {sáb, dom} + item {qua}), em que `voltaAAbrir` responde `true`
e nada abre nunca. Essa lacuna **é deliberada e tem dono**: encodá-la aqui obrigaria `voltaAAbrir` a
ler a regra de dia, que hoje ela não lê, e criaria **a segunda casa** da regra de RN-02 da spec-mãe
— exatamente o que a arquitetura do motor existe para impedir. A mitigação é **observabilidade no
painel** (RN-06), no único lugar onde o lojista consegue agir, e está registrada em §Fora do
Escopo.

**Consequência em RN-13 da spec-mãe:** o produto exclusivo (`visibilidade = 'cardapio'`) de um
cardápio **recorrente** com agenda de item **nunca some da vitrine** — ele alterna entre comprável e
marcado com "Só às quartas". Quem continua sumindo é o exclusivo de prazo fixo expirado ou de
cardápio desligado. É o desfecho certo: há sempre uma data a prometer.

→ Camada: **SSR** (RN-13 da spec-mãe, inalterada no formato) + **SSR (preview de UX)** para o aviso.

**RN-04 — A recusa é do SERVIDOR, e ela é a única autoridade.** Item fora do dia que chega em
`criarPedido` derruba o **pedido inteiro**, antes da RPC, no mesmo laço que já recusa produto
indisponível/oculto/de outra loja. A UI desabilitada é cortesia. **Garantido em: Server Action +
RLS** — e o valor cobrado continua recalculado do banco (`seguranca.md` §10). Este é o **vermelho
red-first obrigatório** do loop: *"`criarPedido` recusa a Feijoada numa segunda-feira"*.

### Vitrine

**RN-05 — A seção de destaque lista só os itens abertos AGORA, e SOME quando não há nenhum.**

A seção existe enquanto o cardápio está aberto **e** tem pelo menos um item aberto hoje. Cardápio
aberto com zero itens do dia **não produz seção**.

**Decidido assim, e não "seção existe enquanto o cardápio está aberto", por três motivos:**

1. **Título vazio é ruído que o cliente não sabe interpretar.** "Especiais do Dia" com nada embaixo,
   no topo do catálogo, num celular, ocupa a primeira dobra para informar nada — o mesmo argumento
   que fez RN-13 da spec-mãe escolher "some" para o produto sem volta a anunciar.
2. **A trava já existe e é de desenho, não de disciplina.** `agruparPorCardapio` termina com
   `.filter(secao => secao.produtos.length > 0)` — a regra "grupo sem produto visível não é
   devolvido" (issue 177, reaplicada). Com o filtro por item, a seção vazia cai ali **sem uma linha
   nova**. Manter a seção vazia exigiria **remover** uma proteção existente.
3. **O trilho de navegação continua coerente de graça.** `NavCategorias` recebe
   `[...secoesDestaque, ...categorias]`: seção que não existe não vira pílula que não leva a lugar
   nenhum — e `MINIMO_CATEGORIAS = 3` continua contando o que é navegável de verdade.

**D16-a permanece intacto:** o item aberto aparece na seção **e** na categoria dele; o item fechado
hoje aparece **só** na categoria, marcado. A seção nunca é a casa do produto.

→ Camada: **SSR**.

**RN-06 — Agenda que nunca abre é AVISADA no painel, nunca bloqueada.**

Quando a interseção entre `vínculo.dias_semana` e os dias em que o cardápio abre é vazia (cardápio
{sáb, dom} + item {qua}, sem `dias_mes` no cardápio), a linha do produto em
`/painel/cardapios/[cardapioId]` mostra: *"Este item nunca aparece: o cardápio só abre aos sábados e
domingos."*

**Por que avisar e não recusar:**

- A recusa **não é expressável no banco**: a validade depende de **outra linha** (o cardápio), e
  CHECK não cruza linhas. Só um trigger faria isso, e um trigger que recusa uma escrita reversível e
  de baixo risco troca um estado observável por um erro que o lojista não sabe destravar.
- O estado é **legítimo em trânsito**: o lojista pode marcar "qua" no item e só depois abrir o
  cardápio na quarta. Recusar o primeiro dos dois gestos torna a sequência impossível em uma ordem.
- O estado é **totalmente reversível** com um clique, e **o painel é o único lugar onde ele é
  observável** — mesmo princípio de RN-12 da spec-mãe (o aviso de cardápio expirado escondendo
  produtos).

A frase é **função pura**, não texto de componente: sem jsdom, aviso que mora em `.tsx` não é
travável por teste neste repo.

→ Camada: **SSR (preview de UX)** — recalculado no servidor a cada render; **nenhuma decisão depende
dele**.

### Rótulos

**RN-07 — `descreverVigencia` diz "Todos os dias" quando os 7 dias estão marcados.**

`dias_semana` com os 7 valores é, semanticamente, "sem restrição por dia da semana" — mas é o que o
atalho do `FormVigencia` grava (o CHECK `cardapios_recorrente_tem_eixo` exige um eixo preenchido).
Sem esta regra a prévia diria *"Aparece de segunda a domingo"*, pela `corridaDaSemana`, que é
verdadeiro e desnecessariamente longo. Com os 7 marcados:

- prévia longa do painel: **"Aparece todos os dias"** (+ a faixa de horas, se houver);
- selo curto da vitrine: **"Todos os dias"** (+ a faixa curta, se houver) — este selo só é produzido
  para cardápio **fechado com volta**, e um cardápio de 7 dias fica fechado fora da faixa de horas,
  então o caso é real.

O curto-circuito mora numa passagem só, antes de `corridaDaSemana`, e vale para as duas redações —
**uma tabela de dias, uma implementação** (é a razão de `descreverVigencia.ts` existir: M6).

→ Camada: **SSR** (o rótulo) + **cliente (preview)** (a prévia do form, mesma função pura).

**RN-08 — O rótulo do item fora do dia vem dos dias do ITEM.**

Dizer "Todos os dias" (a janela do cardápio) num prato que só sai na quarta seria **falso** para o
cliente, e é a informação que D4 da spec-mãe existe para dar. Então o selo do produto marcado por
agenda de item lê `vínculo.dias_semana`: *"Só às quartas e sábados"*, no mesmo formato, com o mesmo
teto de 32 caracteres aplicado **na função pura** (nunca no CSS) e com a faixa de horas do
**cardápio** anexada quando houver — o horário continua sendo do cardápio (§Decisões, (b)).

A nova redação reusa as tabelas `DIAS_LONGOS`/`DIAS_PLURAIS`/`DIAS_CURTOS`, `corridaDaSemana` e
`enumerar` que já existem em `descreverVigencia.ts`. **Nenhuma segunda tabela de nome de dia.**

Precedência entre os dois motivos de "fora da janela" (cardápio fechado × item fora do dia): quando
o **cardápio** está fechado, a frase é a do cardápio ("volta sábado") — é a restrição que o cliente
não destrava esperando pouco, mesmo argumento de RN-05 da spec-mãe. Quando o cardápio está **aberto**
e só o item está fora do dia, a frase é a do item.

→ Camada: **SSR**.

### Contrato de dados e escrita

**RN-09 — `cardapiosPorProduto` → `vinculosPorProduto`.** Mudança de contrato de dados, com o tipo
`VinculoVigencia` (§Modelos de Dados). Gate mecânico: `npx tsc --noEmit` = 0 e
`grep -rn cardapiosPorProduto src/` vazio.
→ Camada: **tsc** (é a única barreira possível, e é a certa).

**RN-10 — `loja_id` NUNCA vem do payload.** No lojista, de `buscarLojaDoDono(supabase)`. No admin,
do `lojaId` da **URL validado** (`validarLojaIdAdmin`) e injetado **por último** pelo wrapper
`EscopoLoja` — payload hostil não sobrescreve o escopo. O par `(cardapio_id, produto_id)` chega do
cliente, e é a **FK composta** de `cardapio_produtos` que torna o vínculo cross-tenant impossível
**inclusive sob `service_role`** (FK não é RLS).

A escrita é um **UPDATE escopado pela tripla** `loja_id` + `cardapio_id` + `produto_id`, com
`count: "exact"`; `count === 0` é falha (vínculo inexistente **ou** de outra loja — indistinguível,
RN-12). **Preferência arquitetural:** estender `EscopoLoja` com um `atualizarPorChave(tabela,
chave, patch)` (escopo duplo `loja_id` + colunas da chave, `count:"exact"`) em vez de usar o `svc`
cru — o wrapper existe justamente para injetar `loja_id` por construção, e relaxar o enforcement de
`admin-loja.ts` para acomodar um `svc.from(...).update(...)` seria andar para trás.
→ Camada: **Server Action + RLS + FK composta**.

**RN-11 — `[]` é normalizado para `NULL` no servidor; o cliente nunca escolhe a representação.**
`schemaDiasDoVinculo` aceita a lista, deduplica e ordena; uma função pura em
`cardapio-contrato.ts` (`normalizarDiasDoVinculo`) devolve `null` para lista vazia. Uma
representação só no banco para "todos os dias do cardápio" — mesmo princípio que a spec-mãe aplicou
a `cardapios.dias_semana`.

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
→ Camada: **zod** (primeira barreira) + **Server Action** (a normalização) + **CHECK** (backstop de
domínio no banco).

**RN-12 — Vínculo de outra loja recebe a MESMA mensagem de vínculo inexistente.** Uma frase única em
`cardapio-contrato.ts` (`MSG_DIAS_DO_VINCULO`), compartilhada pelos dois mundos — paridade por
construção, não por cópia. Mensagens distintas por tipo de falha transformariam a action num
**oráculo de existência de id** (`seguranca.md` §14). O detalhe vai para `console.error`, nunca para
a UI.
→ Camada: **Server Action + RLS + FK composta**.

**RN-13 — A agenda é do VÍNCULO, não do produto.** O mesmo produto pode ter agendas diferentes em
cardápios diferentes, e RN-02 (união) resolve. Tirar o produto do cardápio apaga a agenda junto
(`ON DELETE CASCADE` já existente); recolocá-lo **não** ressuscita a agenda — nasce `NULL` ("todos
os dias do cardápio"). É o default seguro: nunca esconder um prato por causa de uma configuração que
o lojista não lembra de ter feito.
→ Camada: **FK/CASCADE** + **Server Action**.

**RN-14 — Paridade lojista ↔ admin é obrigatória.** Toda regra acima vale igual nos dois mundos. O
caminho admin roda sob `service_role` (BYPASSRLS): **nenhuma regra desta spec pode morar só na
RLS**. Todas moram em função pura, em zod, no CHECK, na FK composta ou no contrato neutro
compartilhado.
→ Camada: **Server Action + FK/CHECK + contrato neutro**.

---

## Decisões do dono do produto

> **As duas decisões abaixo estão fixadas no default recomendado e marcadas `pendente de OK`.**
> Elas são o gate humano único do loop (G1 do `plan/loop-vigencia-por-item-do-cardapio.md` §4),
> antes de qualquer linha de código. Mudar qualquer uma **não** muda o modelo de dados.

### (a) Categoria num dia fechado: **manter RN-13 da spec-mãe** — `pendente de OK`

**Default recomendado:** o item fora do dia continua aparecendo na categoria dele, **desabilitado**,
com o rótulo vindo dos dias do item ("Só às quartas e sábados"). **Alternativa recusada:** sumir da
listagem.

**Por quê:** (1) a regra já existe, está implementada e testada — manter custa zero e sumir custaria
um segundo predicado de visibilidade; (2) o prato **volta na quarta**, e o card marcado é
literalmente o que D4 da spec-mãe existe para comunicar; (3) sumir e voltar a cada dia faz a loja
parecer instável para o cliente recorrente, e o lojista não tem como perceber; (4) a seção de
destaque **já dá** o efeito "só o prato de hoje" que o dono pediu — a categoria é o lugar onde o
catálogo completo continua legível.

**Se o dono mudar:** a mudança é na projeção (`visivelNaVitrine` passaria a ler o dia do item),
**não** no schema, e não afeta RN-04 (a recusa do servidor é a mesma).

### (b) Sem horário por item no v1 — `pendente de OK`

**Default recomendado:** o item tem **só** dia da semana. A faixa de horário continua sendo do
**cardápio**, aplicada igual a todos os itens dele.

**Por quê:** (1) o pedido literal do dono é por **dia**, não por hora; (2) o motor já aceita a forma
completa — `cardapioAberto` faz `diaOk E horaOk`, e acrescentar `hora_inicio`/`hora_fim` ao vínculo
no v2 é uma migration aditiva no mesmo desenho, **sem quebrar nada** do v1; (3) horário por item
multiplica a superfície de UI (dois inputs por linha em 360px) e a de teste (borda de meia-noite,
fim exclusivo, fuso) sem demanda; (4) `NULL` no vínculo já significa "herda do cardápio", que é
exatamente a semântica que o v2 vai querer.

**Se o dono mudar:** vira uma migration adicional (`hora_inicio time`, `hora_fim time` em
`cardapio_produtos`, com o mesmo CHECK de par tudo-ou-nada e `hora_fim > hora_inicio`) e uma linha a
mais em `itemAberto`. **Não é reescrita.**

---

## Segurança (obrigatório)

**Dado sensível que entra/sai:** nenhum. O payload é `{ cardapio_id, produto_id, dias_semana }` —
dois UUIDs e uma lista de inteiros 0..6. **Nenhuma PII de cliente, nenhuma chave Pix, nenhum cupom.**
O log de acesso admin grava contagem (`dias: n`), nunca conteúdo de produto.

**Valor monetário:** esta spec **não introduz nenhum**. Mas ela muda o predicado que decide **se um
item pode ser vendido**, e portanto entra no caminho autoritativo do pedido:
- `criarPedido` recalcula **do banco**, no servidor, com o relógio do servidor no fuso da loja
  (RN-04). O cliente **nunca** envia dia, hora, fuso ou preço — `seguranca.md` §10 inalterado.
- `revisarCarrinhoAction` usa **a mesma** função pura da vitrine. O gate mecânico dessa paridade já
  existe: `src/lib/actions/paridade-preview-autoritativo.test.ts` — **tem de continuar verde**.

**Tabela nova?** Não. `cardapio_produtos` já tem RLS (`cardapio_produtos_leitura_publica`,
`cardapio_produtos_leitura_propria`, `cardapio_produtos_escrita_propria`) e GRANTs, criados na
migration `20260920129000`. **Política é por linha, não por coluna** — a coluna nova é coberta sem
alteração. **Nenhum GRANT novo.**

**Vetor multitenant (o risco principal desta spec):** duas Server Actions novas escrevendo em
`cardapio_produtos`, sendo uma sob `service_role`. As camadas, em ordem de força:
1. **FK composta** `(cardapio_id, loja_id)` e `(produto_id, loja_id)` — vínculo cross-tenant é
   **impossível**, inclusive sob BYPASSRLS. É a trava estrutural, não uma checagem.
2. **`loja_id` da sessão (lojista) ou da URL validada (admin)**, injetado por último pelo wrapper —
   nunca do payload (RN-10).
3. **RLS** `cardapio_produtos_escrita_propria` — vale para o lojista; **não** vale para o admin.
4. **zod `.strict()`** — payload com chave a mais é recusado antes de qualquer ida ao banco.
5. **Mensagem única** para alheio e inexistente — sem oráculo (`seguranca.md` §14, RN-12).

**Precedente de auditoria a respeitar:** `tasks/270` documenta que `ON CONFLICT DO NOTHING` **pula a
FK composta** quando o par alheio já existe. `definirDiasDoVinculo` é um **UPDATE**, não um upsert —
mas o "Definir dias" **em lote** passa pelo mesmo caminho de escrita da 270. **Por isso a 270 é
pré-requisito desta spec** e entra antes, para que o padrão novo não copie o bug.

**API externa com key?** Nenhuma. Nada sai do processo.

**Erro do banco:** nunca vaza. `console.error("[definirDiasDoVinculo]", e)` no servidor, frase
genérica na UI (`seguranca.md` §14).

---

## Fora do Escopo (v1)

Conferido contra o roadmap de `references/modelo-negocio.md` e contra a §Fora do Escopo da spec-mãe
(que continua valendo inteira).

- **Horário por item** — §Decisões, (b). O motor já aceita a forma completa; é migration aditiva.
- **Dia do mês por item** (`dias_mes` no vínculo) — o pedido é semanal. O eixo `dias_mes` continua
  sendo do cardápio, com o `OU` de RN-02 da spec-mãe.
- **Datas de exceção por item** ("não sai no feriado") — outra feature, outro modelo de dados.
- **`voltaAAbrir` resolvendo a interseção vazia** (RN-03): o caso "cardápio {sáb, dom} + item {qua}"
  continua respondendo `true` e sendo tratado por **aviso no painel** (RN-06). Encodá-lo no motor
  exigiria `voltaAAbrir` ler a regra de dia e criaria a segunda casa de RN-02 da spec-mãe. Se o
  aviso não bastar na prática, a saída é uma issue própria, com o cruzamento feito **uma vez por
  request** no mesmo lugar em que o aviso já é calculado.
- **Ordenar produtos dentro da seção de destaque** — a seção preserva a ordem de `produtos.ordem`,
  como hoje (§Fora do Escopo da spec-mãe).
- **Reordenar as seções de destaque pela UI** — `cardapios.ordem` continua sem tela (idem).
- **Copiar a agenda de um item para outro / templates de semana** — sem demanda; o lote "Definir
  dias" já resolve o caso de massa.
- **Cache do catálogo da vitrine** — continua **proibido** pela spec-mãe, e a agenda por item torna
  isso mais verdadeiro: um catálogo cacheado entre requests serve o dia errado à meia-noite.
- **Filtrar dia em SQL** — a decisão de janela é função pura em TS (RN-06 da spec-mãe). Nenhum
  índice, nenhum `where` por dia.
- **Notificar o lojista de item que nunca abre por e-mail/push** — o aviso vive no painel (RN-06).

---

## Ordem de implementação sugerida (o `quebrar` fecha a lista)

A ordem **crítica-antes-de-tela** é obrigatória; o corte por issue está em
`plan/loop-vigencia-por-item-do-cardapio.md` §5.

1. **`tasks/270`** — conserta o caminho de escrita em lote que esta spec vai espelhar. *(crítica: SIM)*
2. **Migration** `dias_semana` + CHECK + `npx supabase gen types typescript`. *(crítica: SIM)*
3. **Motor e consumidores autoritativos** — `VinculoVigencia`, `itemAberto`, `voltaAAbrir` por
   vínculo, `COLUNAS_CARDAPIO_VIGENCIA`, rename `vinculosPorProduto`, `pedido.ts`,
   `revisarCarrinho.ts`, `contarProdutosEscondidos.ts`. Vermelho principal: **`criarPedido` recusa a
   Feijoada numa segunda-feira**. *(crítica: SIM — fatia coesa)*
4. **`definirDiasDoVinculo`** lojista + admin, `schemaDiasDoVinculo`, `normalizarDiasDoVinculo`,
   `MSG_DIAS_DO_VINCULO`, `atualizarPorChave` em `EscopoLoja`. Vermelho: `loja_id` do payload é
   ignorado; cardápio alheio recusado **afirmando o fragmento da mensagem**, não só o SQLSTATE;
   `[]` vira `NULL`. *(crítica: SIM)*
5. **UX do painel** — `PilulasDeDias`, `SeletorProdutosDoCardapio`, "Definir dias" no lote, "Todos os
   dias" no `FormVigencia`, aviso de RN-06, leitura no `FormProduto`, paridade admin. *(crítica: NÃO)*
6. **Vitrine** — `agruparPorCardapio` por item, rótulos de RN-07/RN-08. *(crítica: NÃO)*
7. **`tasks/271`** — `/fix` isolado, commit próprio, mesmo branch.
