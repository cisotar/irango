# Spec: Opcionais (Add-ons) de Produtos

**Versão:** 0.1.0 | **Atualizado:** 2026-06-14

> **Emenda ao `specs/spec_irango_mvp.md` e ao `specs/spec_checkout_pagamento.md`.** Adiciona a feature de OPCIONAIS (add-ons pagos) ao catálogo e ao pedido. Não altera nenhuma outra seção dos specs existentes. A seção "Opcionais/Add-ons" do mockup `design-claude/vitrine/produto-modal.html` — hoje marcada como ASPIRACIONAL — passa a ser implementável conforme este spec. Nada aqui pode contradizer `references/seguranca.md` §10 (recálculo de valores no servidor) nem o modelo multitenant (`references/architecture.md` §4).

---

## Visão Geral

Produtos da vitrine podem oferecer **opcionais** — itens adicionais pagos que o cliente escolhe no modal do produto (ex.: "Brie extra +R$ 8,00", "Geleia artesanal +R$ 6,00"). Cada opcional tem nome e preço de acréscimo; o cliente escolhe a quantidade de cada um por item do carrinho.

O lojista organiza os opcionais em **categorias de opcional** (ex.: Laticínios, Charcutaria, Doces, Embalagens) — que **não** se confundem com as categorias de produto já existentes (Pães, Tortas, Bebidas). Os opcionais formam uma **biblioteca reutilizável por loja**: o mesmo "Brie extra" pode aparecer em vários produtos sem ser recadastrado.

Quais categorias de opcional aparecem em cada produto é determinado pela **categoria de produto** à qual o produto pertence (decisão de modelo abaixo): todos os Pães oferecem Laticínios + Charcutaria + Doces; todas as Tortas oferecem esses três mais Embalagens.

**Problema que resolve:** lojistas de food precisam vender acréscimos (recheio extra, acompanhamento, embalagem para presente) sem duplicar produtos. Hoje o catálogo só tem preço único por produto.

**Mundo:** vive em dois mundos — vitrine pública (modal do produto, sem login) e painel do lojista (gestão da biblioteca de opcionais, auth obrigatório).

---

## DECISÃO DE MODELO (recomendada) — destaque

> 🟢 **RECOMENDAÇÃO: "tipo de produto" = a `categorias` de produto já existente.** A associação "quais opcionais aparecem neste produto" é feita **por categoria de produto** (todos os produtos da categoria herdam o mesmo conjunto de categorias de opcional), via tabela de junção `categoria_produto_opcionais`.

### Por que reusar `categorias`

O "tipo de produto" descrito pelo usuário (pães, tortas) é semanticamente idêntico a `categorias` (Pães, Tortas, Bebidas) — que já agrupa produtos na vitrine, já é escopada por loja, já tem RLS e ordenação. Criar uma entidade `tipo_produto` paralela duplicaria esse conceito e forçaria o lojista a cadastrar cada produto em duas taxonomias quase iguais. Reusar `categorias` é a opção mais simples e provavelmente correta.

### Alternativas consideradas (e por que não)

| Alternativa | Trade-off | Veredito |
|-------------|-----------|----------|
| **A — `categorias` é o "tipo"; associação por categoria de produto** (recomendada) | Simples, sem nova taxonomia. Limitação: produto sem `categoria_id` (nullable) não herda opcionais — aceitável, cai em "sem opcionais". | ✅ MVP |
| **B — entidade `tipo_produto` separada** | Desacopla "agrupar na vitrine" de "definir opcionais". Custo: segunda taxonomia, segundo cadastro por produto, mais UI. Ganho real só se um dia os dois conceitos divergirem. | ❌ over-engineering p/ MVP |
| **C — opcionais presos diretamente a cada produto** (`produto_opcionais`) | Granularidade máxima (cada produto escolhe seus add-ons). Custo: lojista reconfigura produto a produto; o exemplo do usuário ("todos os pães…") fica trabalhoso. | ❌ não atende o exemplo bem |
| **D — biblioteca presa a um único produto** | Sem reuso; "Brie extra" recadastrado N vezes. | ❌ contradiz o requisito de reuso |

**Granularidade recomendada:** associação **por categoria de produto** (alternativa A). Override por produto individual fica **fora do MVP** (ver Fora do Escopo) — mantém o cadastro simples e cobre 100% do exemplo do usuário. Se no futuro um produto precisar de exceção, adiciona-se uma tabela de override sem quebrar o modelo.

### Biblioteca reutilizável

> 🟢 **RECOMENDAÇÃO:** opcionais são uma **biblioteca por loja** (espelha a loja-referência lojinhaonline): `opcionais` agrupados por `opcionais_categorias`, com busca por nome no painel. Um item da biblioteca serve vários produtos via a associação por categoria de produto — nunca duplicado.

---

## Atores Envolvidos

| Ator | Papel nesta feature |
|------|---------------------|
| **iRango (servidor)** | Recalcula o subtotal do item COM opcionais a partir dos preços do banco; valida que cada opcional pertence à loja, está ativo e é permitido para a categoria do produto; persiste snapshot imutável dos opcionais no item do pedido |
| **Lojista** | Cadastra categorias de opcional + itens (biblioteca); associa categorias de opcional a categorias de produto; ativa/desativa itens — tudo no painel (auth) |
| **Cliente** | No modal do produto, escolhe a quantidade de cada opcional; nunca envia preço — só `{ opcional_id, quantidade }` |

---

## Páginas e Rotas

### Modal de Produto (vitrine) — `/loja/[slug]` (modal sobre a vitrine)

**Mundo:** vitrine pública (sem auth)
**Descrição:** O modal de detalhe do produto (`design-claude/vitrine/produto-modal.html`) ganha a seção **Opcionais**, hoje aspiracional. Carregada via SSR junto com o catálogo: cada produto traz os opcionais disponíveis (derivados da sua `categoria_id`), agrupados por categoria de opcional. O cliente seleciona quantidades por mini-stepper; o subtotal do item exibido é **PREVIEW**. Ao "Adicionar ao carrinho", o item entra no `useCarrinho` carregando seus opcionais escolhidos (`opcional_id` + quantidade).

**Componentes:** (reuso de shadcn/ui e do mockup existente)
- `ProdutoModal` (`components/vitrine/ProdutoModal.tsx`) — bottom-sheet existente; recebe os opcionais do produto
- `SecaoOpcionais` — lista de grupos (categoria de opcional) com itens; reusa o markup `.secao` / `.grupo-label` / `.opcional-item` / `.mini-stepper` do mockup
- `MiniStepper` — controle de quantidade compacto por opcional (já existe no mockup)
- Reusa: `lib/utils/formatarMoeda.ts`, `lib/utils/calcularTotal.ts` (estende p/ somar opcionais no preview), `useCarrinho` (estende item p/ carregar opcionais), shadcn/ui `Separator`

**Behaviors:**
- [ ] Exibir opcionais disponíveis do produto — derivados da `categoria_id` do produto via `categoria_produto_opcionais` → `opcionais_categorias` → `opcionais` (apenas `ativo = true`), agrupados por categoria de opcional ordenada por `ordem`. Garantido em: Server Component (leitura SSR) + RLS pública de catálogo.
- [ ] Produto sem opcionais — se a categoria do produto não tem associação (ou produto sem `categoria_id`), a seção Opcionais não é renderizada. Garantido em: cliente (UX) com base nos dados do servidor.
- [ ] Selecionar quantidade de opcional — mini-stepper incrementa/decrementa por opcional. Garantido em: cliente (UX).
- [ ] Exibir subtotal do item preview — `(preco_produto × quantidade_item) + Σ preco_opcional × qtd_opcional` (opcional por linha, 090). **PREVIEW — não autoritativo.** Garantido em: cliente (UX), via `calcularTotal` estendido.
- [ ] Adicionar ao carrinho com opcionais — grava no `useCarrinho` o item com `{ produto_id, quantidade, opcionais: [{ opcional_id, quantidade }] }`. **Apenas ids e quantidades — nunca preço.** Garantido em: cliente (UX); valor real recalculado no checkout (Server Action).
- [ ] Item esgotado — produto indisponível mantém comportamento existente (botão desabilitado); opcionais não são exibidos. Garantido em: cliente (UX) + RLS `produtos_leitura_publica`.

---

### Carrinho / Checkout (vitrine) — `/loja/[slug]/pedido`

**Mundo:** vitrine pública (sem auth)
**Descrição:** Cada linha do carrinho que tiver opcionais lista os opcionais escolhidos sob o nome do produto, com o acréscimo correspondente. O subtotal segue **PREVIEW**. Na submissão (`criarPedido`), o servidor recalcula tudo de forma autoritativa (ver Checkout spec, Etapa 3).

**Componentes:**
- `Carrinho` / `EtapaItens` (existentes) — passam a renderizar a sublista de opcionais por item
- Reusa: `ResumoValores` (existente — preview), `formatarMoeda`

**Behaviors:**
- [ ] Listar opcionais por item do carrinho — exibe nome + acréscimo de cada opcional escolhido (do snapshot local do carrinho). **PREVIEW.** Garantido em: cliente (UX).
- [ ] Recalcular subtotal preview com opcionais — `calcularTotal` estendido. **PREVIEW.** Garantido em: cliente (UX).
- [ ] Enviar pedido com opcionais — o payload de `criarPedido` inclui `opcionais` por item (ver Segurança / payload). Servidor recalcula o subtotal do item a partir dos preços do banco. Garantido em: **Server Action + RLS** (recálculo autoritativo, `seguranca.md` §10).

---

### Gestão de Opcionais (painel) — `/painel/produtos/opcionais`

**Mundo:** painel (auth obrigatório)
**Descrição:** Aba/seção dentro da gestão de produtos onde o lojista mantém a biblioteca de opcionais: categorias de opcional, itens (nome + preço + ativo) e a associação categoria-de-produto → categorias-de-opcional. (Pode ser entregue como fase posterior — ver Dependências/Fora do Escopo. Mapeada aqui para a quebra em issues.)

**Componentes:**
- `ListaCategoriasOpcional` (`components/painel/opcionais/ListaCategoriasOpcional.tsx`) — nome, ordem, nº de itens, ações
- `FormCategoriaOpcional` — react-hook-form + zod (`lib/validacoes/opcional.ts`, novo): nome, ordem
- `FormOpcional` — react-hook-form + zod: nome, preço (`numeric ≥ 0`), categoria de opcional, ativo, ordem
- `BuscaOpcional` — campo de busca por nome (deep-search da biblioteca — espelha lojinhaonline)
- `AssociacaoOpcionaisPorCategoria` — para cada categoria de produto, checkboxes das categorias de opcional disponíveis
- Reusa: shadcn/ui `Table`, `Dialog`, `Input`, `Switch`, `AlertDialog`, sonner `toast`

**Behaviors:**
- [ ] Listar categorias de opcional da loja — `opcionais_categorias WHERE loja_id` ordenadas por `ordem`. Garantido em: Server Component + RLS própria.
- [ ] Criar/editar/remover categoria de opcional — Server Action INSERT/UPDATE/DELETE com `loja_id` do lojista. Remover com confirmação. Garantido em: **Server Action + RLS** (escrita própria).
- [ ] Listar itens (opcionais) da loja — `opcionais WHERE loja_id`, agrupados por categoria de opcional. Garantido em: Server Component + RLS própria.
- [ ] Buscar opcional por nome — filtro client-side ou query escopada por loja. Garantido em: cliente (UX) / Server Component.
- [ ] Criar/editar opcional — Server Action INSERT/UPDATE; valida nome, `preco ≥ 0`, categoria de opcional pertence à loja. Garantido em: **Server Action + RLS** (escrita própria; revalida que `categoria_opcional_id` é da mesma loja).
- [ ] Ativar/desativar opcional — toggle `ativo`. Opcional inativo some da vitrine e não pode ser pedido. Garantido em: **Server Action + RLS**.
- [ ] Remover opcional — DELETE com confirmação. Pedidos passados não são afetados (snapshot). Garantido em: **Server Action + RLS**.
- [ ] Associar categorias de opcional a uma categoria de produto — Server Action grava/remove linhas em `categoria_produto_opcionais`. Valida que **ambas** as categorias pertencem à loja do lojista (anti-cross-tenant). Garantido em: **Server Action + RLS** (CHECK de ownership das duas pontas).
- [ ] Reordenar categorias de opcional / opcionais — atualiza `ordem` via Server Action. Garantido em: **Server Action + RLS**.

---

## Modelos de Dados

Todas as tabelas existentes em `references/schema.md`. Este spec adiciona **3 tabelas novas + 1 tabela de junção + 1 tabela de snapshot**. Cada item exige migration versionada e política RLS antes de produção (`seguranca.md` §2).

### Delta 1 — `opcionais_categorias` (nova tabela)

```sql
CREATE TABLE opcionais_categorias (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  loja_id   uuid NOT NULL REFERENCES lojas(id) ON DELETE CASCADE,
  nome      text NOT NULL,            -- ex: Laticínios, Charcutaria, Doces, Embalagens
  ordem     int  NOT NULL DEFAULT 0,
  criado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON opcionais_categorias(loja_id, ordem);
```

Escopada por loja. Mesma forma de `categorias`. **Não** confundir com `categorias` (que agrupa produtos).

### Delta 2 — `opcionais` (nova tabela — itens da biblioteca)

```sql
CREATE TABLE opcionais (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  loja_id               uuid NOT NULL REFERENCES lojas(id) ON DELETE CASCADE,
  categoria_opcional_id uuid NOT NULL REFERENCES opcionais_categorias(id) ON DELETE CASCADE,
  nome                  text NOT NULL,                       -- ex: "Brie extra"
  preco                 numeric(10,2) NOT NULL CHECK (preco >= 0),  -- acréscimo
  ativo                 boolean NOT NULL DEFAULT true,
  ordem                 int NOT NULL DEFAULT 0,
  criado_em             timestamptz NOT NULL DEFAULT now(),
  atualizado_em         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON opcionais(loja_id, categoria_opcional_id, ativo, ordem);
```

`loja_id` redundante com `categoria_opcional_id → loja_id`, mas mantido (igual a `produtos`) para RLS e índices diretos. **Valor `preco` é AUTORITATIVO (servidor)** — fonte de verdade do acréscimo.

### Delta 3 — `categoria_produto_opcionais` (junção tipo↔grupos de opcional)

```sql
-- Define QUAIS categorias de opcional aparecem para produtos de uma categoria de produto.
CREATE TABLE categoria_produto_opcionais (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  loja_id               uuid NOT NULL REFERENCES lojas(id) ON DELETE CASCADE,
  categoria_id          uuid NOT NULL REFERENCES categorias(id) ON DELETE CASCADE,            -- categoria de PRODUTO (Pães, Tortas)
  categoria_opcional_id uuid NOT NULL REFERENCES opcionais_categorias(id) ON DELETE CASCADE,  -- categoria de OPCIONAL (Laticínios…)
  UNIQUE (categoria_id, categoria_opcional_id)
);
CREATE INDEX ON categoria_produto_opcionais(loja_id, categoria_id);
```

`loja_id` redundante mas presente para RLS direta. A integridade "ambas as categorias são da mesma loja" é garantida na **Server Action** (revalidação de ownership) — defesa primária — e reforçada por RLS (ver Segurança). Exemplo: Tortas ⋈ {Laticínios, Charcutaria, Doces, Embalagens}; Pães ⋈ {Laticínios, Charcutaria, Doces}.

### Delta 4 — `itens_pedido_opcionais` (snapshot imutável no pedido)

```sql
-- Snapshot dos opcionais escolhidos por item do pedido. Imutável após criação,
-- igual ao snapshot de nome/preco em itens_pedido (schema.md §itens_pedido, RN-04).
CREATE TABLE itens_pedido_opcionais (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_pedido_id  uuid NOT NULL REFERENCES itens_pedido(id) ON DELETE CASCADE,
  opcional_id     uuid REFERENCES opcionais(id) ON DELETE SET NULL,  -- histórico preservado se opcional deletado
  nome_snapshot   text NOT NULL,                       -- nome no momento do pedido
  preco_snapshot  numeric(10,2) NOT NULL CHECK (preco_snapshot >= 0),  -- preço no momento do pedido (do banco)
  quantidade      int NOT NULL CHECK (quantidade > 0)
);
CREATE INDEX ON itens_pedido_opcionais(item_pedido_id);
```

**`preco_snapshot` e `nome_snapshot` são AUTORITATIVOS** — copiados do banco pelo servidor no momento do pedido, **nunca** do cliente. Mesmo padrão de `itens_pedido.preco`/`nome` (RN-04). `ON DELETE SET NULL` em `opcional_id` preserva o histórico do pedido se o lojista remover o opcional depois.

### Delta 5 — extensão do payload e da RPC

Sem nova coluna em `pedidos`/`itens_pedido`. A RPC `public.criar_pedido` e a action `criarPedido` passam a aceitar opcionais por item (ver Impacto e Segurança).

---

## Regras de Negócio

### RN-O1 — Recálculo autoritativo do subtotal do item com opcionais
- **Regra (revisada em 090):** o subtotal de cada item = `(preco_produto_banco × quantidade_item) + Σ (preco_opcional_banco × qtd_opcional)`. O opcional é **por linha do item**: soma uma vez, NÃO multiplica pela quantidade do produto. Ex.: 2 pães de 40 + 1 opcional de 20 = `(40×2) + (20×1)` = 100. Todos os preços vêm do **banco**, no servidor.
- **Camada cliente (PREVIEW):** `calcularTotal` estendido exibe estimativa no modal e no carrinho — estético.
- **Camada servidor (AUTORITATIVO):** Server Action `criarPedido` + RPC `public.criar_pedido` recalculam do zero, ignorando qualquer valor do cliente. Garantido em: **Server Action + RPC** (`seguranca.md` §10).

### RN-O2 — Cliente nunca envia preço de opcional
- **Regra:** o cliente envia apenas `{ opcional_id, quantidade }` por opcional. Campos de preço são rejeitados pelo schema zod `.strict()`.
- **Camada:** **Server Action** (zod `.strict()`) — mesmo princípio de `seguranca.md` §10 para itens.

### RN-O3 — Opcional precisa pertencer à loja do pedido (anti-cross-tenant)
- **Regra:** cada `opcional_id` enviado deve ter `opcionais.loja_id = pedido.loja_id`. Opcional de outra loja → pedido recusado integralmente.
- **Camada servidor (AUTORITATIVO):** Server Action valida `loja_id` de cada opcional contra o banco; RPC reforça. Garantido em: **Server Action + RLS**.

### RN-O4 — Opcional precisa ser permitido para a categoria do produto
- **Regra:** o `opcional_id` só é aceito no item se sua `categoria_opcional_id` estiver associada (via `categoria_produto_opcionais`) à `categoria_id` do produto do item. Opcional não-permitido para o produto → recusado (anti-injeção de add-on de outro tipo).
- **Camada servidor (AUTORITATIVO):** Server Action / RPC fazem o JOIN `produto → categoria_id → categoria_produto_opcionais → opcional`. Garantido em: **Server Action + RPC**.

### RN-O5 — Opcional inativo/removido não pode ser pedido
- **Regra:** `opcionais.ativo = false` ou inexistente → opcional rejeitado no pedido.
- **Camada servidor:** Server Action filtra `ativo = true`. Garantido em: **Server Action**. (RLS pública já oculta inativos na vitrine.)

### RN-O6 — Snapshot imutável dos opcionais
- **Regra:** editar/remover/reprecificar um opcional após o pedido **não** altera pedidos anteriores.
- **Camada servidor:** INSERT em `itens_pedido_opcionais` com `nome_snapshot`/`preco_snapshot` copiados do banco no momento do pedido. Garantido em: **Server Action / RPC**. Reforço no banco: `ON DELETE SET NULL` em `opcional_id`.

### RN-O7 — Quantidade de opcional ≥ 1 quando presente
- **Regra:** opcional com quantidade 0 não é enviado (cliente omite). Se enviado, `quantidade > 0`.
- **Camada:** zod (`.int().positive()`) + CHECK `quantidade > 0` no banco. Garantido em: **Server Action + CHECK**.

### RN-O8 — Associação cross-tenant de categorias é bloqueada na gestão
- **Regra:** ao associar `categoria_id` ⋈ `categoria_opcional_id`, ambas devem ser da loja do lojista autenticado.
- **Camada servidor:** Server Action revalida ownership das duas pontas; RLS exige `loja_id = própria loja`. Garantido em: **Server Action + RLS**.

---

## Segurança (obrigatório)

### Dado sensível que entra/sai

| Campo | Tipo | Tratamento |
|-------|------|------------|
| `opcionais.nome`, `opcionais.preco` | Dado comercial do lojista | Leitura pública só em loja ativa (RLS de catálogo). Escrita só pelo dono. |
| `opcional_id`, `quantidade` (do cliente) | Referência + inteiro | Único que o cliente envia. Validado contra o banco (loja, ativo, permitido). **Nenhum preço aceito do cliente.** |
| `itens_pedido_opcionais.*` | Snapshot do pedido (PII do contexto do pedido) | Lido só por token (confirmação) ou pelo lojista dono — mesma regra de `itens_pedido`. |

### Valor monetário → recálculo autoritativo obrigatório

O acréscimo de cada opcional entra no total do pedido. Portanto **todo preço de opcional é recalculado no servidor** a partir de `opcionais.preco` no banco. O cliente envia só `opcional_id` + `quantidade`. Recálculo em `criarPedido` / RPC:

```
para cada item:
  produto      = buscar produto (preco do banco, valida loja + disponivel)
  permitidos   = opcionais permitidos p/ produto.categoria_id (JOIN categoria_produto_opcionais)
  para cada opcional do item:
    op = buscar opcional por id  -- valida: loja_id == pedido.loja_id, ativo, id ∈ permitidos
    se inválido -> recusa o pedido
    snapshot { nome_snapshot=op.nome, preco_snapshot=op.preco, quantidade }
  subtotal_item = (produto.preco × item.quantidade) + Σ op.preco × op.quantidade  -- opcional por linha (090)
subtotal = Σ subtotal_item
```

Garantido em: **Server Action `criarPedido` + RPC `public.criar_pedido`** (`seguranca.md` §10).

### Payload zod `.strict()` (extensão do schema de checkout)

```ts
// lib/validacoes/pedido.ts — estende itens com opcionais; mantém .strict()
itens: z.array(z.object({
  produto_id: z.string().uuid(),
  quantidade: z.number().int().positive(),
  opcionais: z.array(z.object({
    opcional_id: z.string().uuid(),
    quantidade:  z.number().int().positive(),
  })).optional(),   // NÃO declara preco/nome — .strict() rejeita campos extras
})).min(1),
```

Garantido em: **Server Action** (validação autoritativa).

### Tabelas novas — RLS necessária (antes de produção)

```sql
ALTER TABLE opcionais_categorias        ENABLE ROW LEVEL SECURITY;
ALTER TABLE opcionais                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE categoria_produto_opcionais ENABLE ROW LEVEL SECURITY;
ALTER TABLE itens_pedido_opcionais      ENABLE ROW LEVEL SECURITY;
```

**`opcionais_categorias` e `categoria_produto_opcionais`** — leitura pública (vitrine precisa montar a seção) usando o helper `public.loja_esta_ativa()` (não `EXISTS` direto em `lojas` — `seguranca.md` §2); escrita só do dono:

```sql
CREATE POLICY "opc_cat_leitura_publica" ON opcionais_categorias FOR SELECT
  USING (public.loja_esta_ativa(opcionais_categorias.loja_id));
CREATE POLICY "opc_cat_escrita_propria" ON opcionais_categorias FOR ALL
  USING     (EXISTS (SELECT 1 FROM lojas WHERE lojas.id = opcionais_categorias.loja_id AND lojas.dono_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM lojas WHERE lojas.id = opcionais_categorias.loja_id AND lojas.dono_id = auth.uid()));

CREATE POLICY "cat_prod_opc_leitura_publica" ON categoria_produto_opcionais FOR SELECT
  USING (public.loja_esta_ativa(categoria_produto_opcionais.loja_id));
CREATE POLICY "cat_prod_opc_escrita_propria" ON categoria_produto_opcionais FOR ALL
  USING     (EXISTS (SELECT 1 FROM lojas WHERE lojas.id = categoria_produto_opcionais.loja_id AND lojas.dono_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM lojas WHERE lojas.id = categoria_produto_opcionais.loja_id AND lojas.dono_id = auth.uid()));
```

**`opcionais`** — leitura pública só de `ativo = true` em loja ativa (espelha `produtos_leitura_publica`); leitura própria do dono inclui inativos; escrita só do dono:

```sql
CREATE POLICY "opcionais_leitura_publica" ON opcionais FOR SELECT
  USING (ativo = true AND public.loja_esta_ativa(opcionais.loja_id));
CREATE POLICY "opcionais_leitura_propria" ON opcionais FOR SELECT
  USING (EXISTS (SELECT 1 FROM lojas WHERE lojas.id = opcionais.loja_id AND lojas.dono_id = auth.uid()));
CREATE POLICY "opcionais_escrita_propria" ON opcionais FOR ALL
  USING     (EXISTS (SELECT 1 FROM lojas WHERE lojas.id = opcionais.loja_id AND lojas.dono_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM lojas WHERE lojas.id = opcionais.loja_id AND lojas.dono_id = auth.uid()));
```

**`itens_pedido_opcionais`** — espelha exatamente `itens_pedido` (`seguranca.md` §itens_pedido): INSERT público só em pedido pendente de loja ativa via helper; leitura só do lojista dono; leitura do cliente apenas server-side por token. Como a tabela filtra por `item_pedido_id → pedido`, é necessário um helper `security definer` análogo a `public.pedido_aceita_itens` que receba o `item_pedido_id`:

```sql
-- Novo helper security definer (mesmo padrão de pedido_aceita_itens — seguranca.md §2)
-- Verifica que o item pertence a pedido pendente de loja ativa, sem expor pedidos ao anon.
CREATE FUNCTION public.item_pedido_aceita_opcionais(p_item_id uuid)
  RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM itens_pedido ip
    JOIN pedidos p ON p.id = ip.pedido_id
    JOIN lojas l   ON l.id = p.loja_id
    WHERE ip.id = p_item_id AND p.status = 'pendente' AND l.ativo = true
  );
$$;
REVOKE ALL ON FUNCTION public.item_pedido_aceita_opcionais(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.item_pedido_aceita_opcionais(uuid) TO anon, authenticated, service_role;

CREATE POLICY "ipo_insert_publico" ON itens_pedido_opcionais FOR INSERT
  WITH CHECK (public.item_pedido_aceita_opcionais(item_pedido_id));
CREATE POLICY "ipo_leitura_lojista" ON itens_pedido_opcionais FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM itens_pedido ip
    JOIN pedidos p ON p.id = ip.pedido_id
    JOIN lojas l   ON l.id = p.loja_id
    WHERE ip.id = itens_pedido_opcionais.item_pedido_id AND l.dono_id = auth.uid()
  ));
```

> Nota: na prática a inserção é feita pela RPC `public.criar_pedido` via `service_role` (atômica, junto com `itens_pedido`), então a policy de INSERT público é defesa em profundidade — não o caminho normal. Mantida por consistência com `itens_pedido`. A leitura pela confirmação do cliente é server-side por token via `service_role` (nunca SELECT anon), igual a `itens_pedido` (`seguranca.md` §itens_pedido).

### API externa com key?

Não. Nenhuma API externa nova. Opcionais são 100% dados internos do banco.

---

## Impacto em Código / Issues Existentes

| Área | Arquivo / artefato | Mudança |
|------|--------------------|---------|
| Schema | nova migration `..._opcionais.sql` | 4 tabelas + índices + RLS + helper `item_pedido_aceita_opcionais` |
| Tipos | `src/types/supabase.ts` | regenerar após migration (`supabase gen types`) |
| Validação | `lib/validacoes/pedido.ts` | estender `itens[]` com `opcionais[]` (mantém `.strict()`) |
| Validação | `lib/validacoes/opcional.ts` (novo) | schemas de categoria de opcional e opcional p/ o painel |
| Cálculo | `lib/utils/calcularTotal.ts` | somar `Σ preco_opcional × qtd` ao subtotal do item (preview e autoritativo usam a mesma fn) |
| RPC | `public.criar_pedido` (migration nova/ajuste) | aceitar opcionais por item; validar loja+ativo+permitido; INSERT `itens_pedido_opcionais` com snapshot na mesma transação |
| Server Action | `criarPedido` | montar/validar opcionais antes da RPC; recálculo autoritativo |
| Queries | `lib/supabase/queries/produtos.ts` | trazer opcionais disponíveis por produto (via `categoria_id`) para o modal SSR |
| Vitrine | `components/vitrine/ProdutoModal.tsx`, `useCarrinho` | seção opcionais + item do carrinho carrega opcionais escolhidos |
| Vitrine | `Carrinho` / `EtapaItens` | listar opcionais por item; preview do subtotal |
| Painel | `app/(painel)/painel/produtos/opcionais/` (novo) | UI da biblioteca + associação por categoria |
| Confirmação | leitura por token (server-side) | exibir opcionais de cada item (snapshot) — ajuste de exibição |
| Mockup | `design-claude/vitrine/produto-modal.html` | seção "Opcionais" deixa de ser ASPIRACIONAL — vira a referência visual implementável |

> **Dependência crítica do checkout:** este spec **estende** o payload e a RPC definidos em `spec_checkout_pagamento.md`. A RPC `public.criar_pedido` já será tocada por aquele spec (campos `tipo_entrega`/`troco_para`); a mudança de opcionais deve ser coordenada para não conflitar.

---

## Dependências

| Dependência | Estado | Impacto |
|-------------|--------|---------|
| `categorias` de produto (existente) | ✅ pronto | base da associação tipo→opcionais |
| RPC `public.criar_pedido` (issue 014 / checkout spec) | ✅ existe, será ajustada | precisa aceitar e persistir opcionais |
| `useCarrinho` (existente) | ✅ existe | item passa a carregar `opcionais[]` |
| `calcularTotal` (existente) | ✅ existe | estender p/ somar opcionais |
| Helper `loja_esta_ativa` e padrão de helper `security definer` (`seguranca.md` §2) | ✅ existe | reuso direto nas RLS |
| UI de gestão no painel | 🟡 pode ser fase posterior | sem ela o lojista não cadastra opcionais; vitrine não os exibe (degrada para "sem opcionais") |

---

## Fora do Escopo (v1)

| Item | Motivo |
|------|--------|
| Override de opcionais por produto individual | MVP usa associação por categoria de produto; override = complexidade extra, não exigida pelo exemplo |
| Entidade `tipo_produto` separada de `categorias` | Decisão de modelo: reusar `categorias` (alternativa B descartada) |
| Opcionais obrigatórios / grupos com mínimo-máximo de seleção (ex.: "escolha 1 de 3") | iFood tem; MVP só add-ons opcionais de quantidade livre |
| Opcional com estoque/disponibilidade própria | Opcional só tem `ativo` booleano no MVP |
| Opcional que altera preço base (substituição, não acréscimo) | Só acréscimo (`preco >= 0`) no MVP |
| Foto por opcional | Só nome + preço no MVP |
| Opcional compartilhado entre lojas (catálogo global) | Biblioteca é escopada por loja (multitenant) |
| Limite de quantidade por opcional | Quantidade livre `> 0`; teto fica para fase 2 |
