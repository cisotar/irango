# Spec: Observações por item do pedido

**Versão:** 0.1.0 | **Atualizado:** 2026-07-09

## Visão Geral

Adiciona um campo livre de **observações por item** no modal de produto da vitrine
(ex: "sem cebola", "ponto da carne mal passada", "trocar batata por salada"). Cada
linha do carrinho carrega a sua própria observação; o texto é encaixado na mensagem
de WhatsApp gerada no checkout e fica visível para o lojista onde ele vê o pedido
(painel, hub admin, comanda e recibo).

Hoje já existe observação **por pedido inteiro** (`estado.observacoes` → coluna
`pedidos.observacoes`, limite 500). Esta feature é ortogonal: cria observação **por
item** — as duas coexistem.

**Mundos:**
- Escrita: **vitrine pública** (`/loja/[slug]`, sem auth) — cliente digita no modal.
- Persistência autoritativa: **Server Action + RPC** (`criarPedido` → `public.criar_pedido`).
- Leitura pelo lojista: **painel** (`/painel/pedidos/[id]`, auth) e **hub admin**
  (`/admin/assinantes/[lojaId]/pedidos/[id]`, auth admin).

## Atores Envolvidos

- **iRango (SaaS):** define o limite de caracteres, a sanitização e o contrato de dados.
  Não vê a observação (é dado do pedido do lojista).
- **Cliente:** digita a observação de cada item no modal de produto. Input não-confiável.
- **Lojista:** lê a observação de cada item na tela de pedido, na comanda e no recibo.
  Não edita (v1).

## Páginas e Rotas

### Modal de Produto (vitrine) — `/loja/[slug]` (overlay, sem rota própria)
**Mundo:** vitrine pública (sem auth)
**Descrição:** ao adicionar um item ao carrinho, o cliente pode digitar uma observação
livre para aquele item. Campo opcional, com contador de caracteres visível.

**Componentes:** (reuso — não criar componente novo de dialog)
- `src/components/vitrine/ProdutoModal.tsx` (`'use client'`) — recebe um novo `<textarea>`
  no **corpo rolável**, dentro de um `.card` (mesmo padrão visual das seções
  "Quantidade"/"Opcionais" do mockup `design-claude/vitrine/produto-modal.html`), logo
  após o card de Quantidade. Título de seção "Observações" segue `.card-titulo`
  (uppercase, `--marrom-cafe`). Não inventar estilo: usar os tokens da vitrine
  (`--cor-destaque` no foco, `--borda-nav` na borda, `--texto-muted` no contador/placeholder).
- `textarea` — multi-linha (permite quebra de linha), `maxLength={140}` no cliente,
  `rows` ~3, placeholder de exemplo ("Ex: sem cebola, ponto da carne...").
- Contador `n/140` visível abaixo do campo (`--texto-muted`; vira estado de alerta ao
  aproximar do limite).
- shadcn/base-ui: se já existir primitivo `Textarea` em `components/ui/`, reusar; senão
  `<textarea>` estilizado com os tokens da vitrine (é UI da vitrine, tema da loja).

**Behaviors:**
- [ ] Digitar observação — cliente escreve texto livre no `<textarea>`. Garantido em: cliente (UX/estado local).
- [ ] Ver contador de caracteres — contador `n/140` atualiza a cada tecla. Garantido em: cliente (UX).
- [ ] Ser impedido de exceder o limite visualmente — `maxLength={140}` trava a digitação. Garantido em: cliente (UX); **limite real garantido em: Server Action (zod `.max(140)`)**.
- [ ] Quebrar linha — Enter insere `\n` (é textarea, não input). Garantido em: cliente (UX).
- [ ] Adicionar ao carrinho com observação — o CTA do footer (`confirmar()`) passa a observação junto de quantidade/opcionais para `onAdicionar`. Garantido em: cliente (estado do carrinho); persistência em: Server Action.
- [ ] Deixar em branco — campo é opcional; sem texto, o item entra no carrinho normalmente. Garantido em: cliente (UX) + Server Action (campo `.optional()`).
- [ ] Reabrir o modal do mesmo produto para observação diferente — dois itens iguais com observações diferentes viram **linhas separadas** no carrinho. Garantido em: cliente (`linhaCarrinhoId` inclui a observação na chave de dedup — ver Regras de Negócio).

---

### Carrinho / Checkout → WhatsApp (vitrine) — `/loja/[slug]/pedido`
**Mundo:** vitrine pública (sem auth)
**Descrição:** ao finalizar, cada item que tem observação exibe o texto na mensagem
gerada. A mensagem só é montada **depois** que o pedido é persistido (a observação vem
do snapshot do banco, `pedido.itens_pedido[i].observacao`, não do estado do cliente).

**Componentes:** (reuso)
- `src/lib/utils/whatsappPedido.ts` — `montarLinkWhatsappPedido`. No `flatMap` que
  serializa cada item (linhas ~57-71), acrescentar uma linha `  obs: <texto>` quando
  `item.observacao` existir, logo após o nome/opcionais do item. `encodeURIComponent`
  (já aplicado à mensagem inteira) escapa o texto para a URL.
- `src/components/vitrine/checkout/estado.ts` — `ItemPayload` ganha `observacao?`;
  `montarPayloadPedido` propaga o campo do `ItemCarrinho` para o payload.
- `src/components/vitrine/checkout/useEnviarPedido.ts` — sem mudança de lógica; passa o
  payload já com `observacao` para `criarPedido`.

**Behaviors:**
- [ ] Ver a observação de cada item na prévia do carrinho (opcional, se o carrinho listar) — exibe o texto que o cliente digitou. Garantido em: cliente (UX/preview — não autoritativo).
- [ ] Enviar o pedido com observações por item — `montarPayloadPedido` inclui `observacao` por item no payload da Server Action. Garantido em: **Server Action + RLS** (recálculo de valor ignora a observação; observação persiste via RPC service_role).
- [ ] Ver a observação de cada item na mensagem do WhatsApp — a linha `obs:` aparece por item na mensagem final. Garantido em: **Server Action** (o texto vem do snapshot no banco, não do estado do cliente) + cliente (montagem da string a partir do dado autoritativo lido por token).

---

### Pedido do Lojista — `/painel/pedidos/[id]` e `/admin/assinantes/[lojaId]/pedidos/[id]`
**Mundo:** painel (auth obrigatório) / hub admin (auth admin)
**Descrição:** na tela de detalhe do pedido, cada item que tiver observação exibe o
texto abaixo do nome/opcionais. Também aparece na comanda de cozinha e no recibo.

**Componentes:** (reuso — Server Components, sem `'use client'`)
- `src/components/painel/DetalhePedido.tsx` — no `<li>` de cada item (após
  `ListaOpcionaisItem`, ~l.216), renderizar a observação quando presente, com estilo
  discreto (texto menor/muted). React auto-escapa o JSX (defesa contra XSS).
- `src/components/painel/ComandaCozinha.tsx` — exibir a observação por item (é a
  informação mais útil pra cozinha: "sem cebola").
- `src/components/painel/ReciboCliente.tsx` — exibir a observação por item.
- `src/lib/supabase/queries/pedidos.ts` — o `SELECT_PEDIDO_COM_ITENS`
  (`*, itens_pedido(*, ...)`) já traz a coluna nova automaticamente (usa `*`); só o
  tipo gerado precisa ser regenerado.

**Behaviors:**
- [ ] Ver a observação de cada item no detalhe do pedido — lojista lê o texto do cliente. Garantido em: **RLS** (`itens_pedido_lojista` — só o dono da loja lê) / hub admin: `verificarAdminSaaS()` + escopo por `lojaId`.
- [ ] Ver a observação na comanda de cozinha impressa — texto aparece por item. Garantido em: RLS (dado lido sob a mesma query escopada).
- [ ] Ver a observação no recibo do cliente impresso — texto aparece por item. Garantido em: RLS (idem).
- [ ] Não ver observação em item que não tem — quando `observacao` é `null`, nada é renderizado (sem rótulo vazio). Garantido em: servidor (render condicional).

---

## Modelos de Dados

Referência: `schema.md` §`itens_pedido`.

### Migration nova — coluna `observacao` em `itens_pedido`

```sql
-- supabase/migrations/<timestamp>_itens_pedido_observacao.sql
ALTER TABLE itens_pedido
  ADD COLUMN observacao text
    CHECK (observacao IS NULL OR char_length(observacao) <= 140);
```

- `text` nullable — `NULL` = item sem observação (padrão). Snapshot imutável junto do
  item, mesma família de `nome`/`preco` (§schema convenções).
- `CHECK <= 140` — defesa em profundidade no banco (a autoridade real é a Server Action
  zod + a RPC). Espelha o padrão de CHECK de defesa dos demais campos do schema.
- **Não** é campo de billing/identidade — fora de qualquer trigger de proteção.

### Migration nova — atualizar a RPC `public.criar_pedido`

A RPC (`CREATE OR REPLACE FUNCTION public.criar_pedido(...)`, última versão em
`20260614009500_rpc_criar_pedido_idempotencia.sql`) itera `p_itens` (jsonb) e faz
`INSERT INTO itens_pedido(...)`. **A assinatura não muda** — a observação viaja dentro
de cada elemento de `p_itens` (mesmo padrão dos opcionais, migration
`20260614008000`). O `INSERT` dentro do loop passa a ler
`(v_item->>'observacao')` e gravar na coluna nova (com `NULLIF(trim(...), '')` para
normalizar string vazia → `NULL`, e truncamento defensivo a 140 no SQL).

> ⚠️ INSERT em `itens_pedido` é **exclusivo da RPC sob `service_role`** (seguranca.md
> §`itens_pedido` — INSERT público foi removido, achado #3A). A observação **não** abre
> nenhuma nova via de escrita: entra pelo mesmo `p_itens` já existente.

### Regen de tipos

`npx supabase gen types typescript` → `src/lib/database.types.ts` passa a listar
`itens_pedido.Row.observacao: string | null`. `ItemPedido`/`ItemPedidoComOpcionais`
(em `queries/pedidos.ts`) herdam o campo automaticamente.

### Contrato do payload (client → server)

- `src/types/dominio.ts` — `ItemCarrinho` ganha `observacao?: string`.
- `src/components/vitrine/checkout/estado.ts` — `ItemPayload` ganha `observacao?: string`.
- `src/lib/validacoes/pedido.ts` — `schemaItemPedido` (que é `.strict()`) **precisa**
  declarar `observacao: z.string().trim().max(140).optional()`. Sem isso o `.strict()`
  **rejeita** o payload inteiro. Este é o **gate obrigatório de tamanho no servidor**.
- `src/lib/actions/pedido.ts` — o snapshot de item (`itensSnapshot`) propaga
  `observacao` (normalizada: `trim()`, vazio → `undefined`) para `p_itens`.

### RLS

Nenhuma tabela nova. `itens_pedido` já tem RLS habilitada e políticas cobrindo o caso:
- Leitura: `itens_pedido_lojista` (SELECT só do dono da loja) — a coluna nova é lida sob
  a mesma policy, sem alteração.
- Escrita: deny-all para anon/authenticated; só a RPC sob `service_role` insere. A coluna
  nova herda esse modelo — **nenhuma policy nova é necessária**.
- Leitura pelo cliente (confirmação): Server Component escopado por `id + token_acesso`
  via `service_role` (padrão existente) — a coluna nova acompanha o `select`.

## Regras de Negócio

| Regra | Camada que garante |
|-------|-------------------|
| **Limite de 140 caracteres** (ver justificativa abaixo) | Cliente `maxLength` (preview) + **Server Action `zod .max(140)`** (autoritativo) + CHECK no banco (defesa) + truncamento na RPC (defesa) |
| Campo **opcional** — item sem observação é válido | Cliente (UX) + zod `.optional()` + coluna nullable |
| **Quebra de linha permitida** (`\n`) — é textarea | Cliente (textarea) + servidor (zod aceita `\n`; sem `.regex` de linha única) |
| **String vazia/whitespace → `NULL`** (não gravar `""`) | Server Action (`trim()`, vazio → `undefined`) + RPC (`NULLIF(trim(...),'')`) |
| **Observação faz parte da identidade da linha do carrinho** — mesmo produto + mesmos opcionais + observações diferentes = duas linhas distintas | Cliente (`linhaCarrinhoId` em `useCarrinho.ts` **deve** incluir a observação na chave de dedup; sem isso uma observação seria perdida na fusão) |
| Observação **não afeta preço** — é texto, nunca entra no cálculo de subtotal/total | Server Action (recálculo de valor ignora a observação — seguranca.md §10) |
| Observação é **snapshot imutável** — não muda se o produto for editado | Coluna em `itens_pedido` (mesma semântica de `nome`/`preco`) |

### Justificativa do limite: 140 caracteres

Padrão de mercado para **observação por item** (distinto da observação por pedido, que
neste projeto já é 500). Apps de delivery limitam o campo de item a uma nota curta:

- **iFood** — campo "Algum comentário?" por item historicamente limitado a ~140 caracteres.
- **Rappi / apps similares** — nota por item na mesma ordem de grandeza (100–150), o
  suficiente para "sem cebola, maionese à parte, ponto mal passado" e não para um texto
  livre longo que polui a comanda.

Adotamos **140** (nota curta, mnemônico "tamanho de tweet clássico"): grande o bastante
para instruções reais, pequeno o bastante para caber numa comanda de cozinha e limitar a
superfície de abuso de payload. Deliberadamente **menor** que a observação por pedido
(500), que é o campo para instruções gerais de entrega. O número vive em **um único
lugar** reutilizado (constante compartilhada entre o zod e, idealmente, o `maxLength` do
textarea) — não duplicar o literal.

## Segurança (obrigatório)

- **Dado sensível que entra:** texto livre do cliente (**input não-confiável**). Pode
  conter qualquer caractere, incluindo tentativa de injeção. Tratamento:
  - **Tamanho:** validado no servidor por `zod .max(140)` (não confiar no `maxLength`
    do cliente) + CHECK no banco + truncamento na RPC. Três camadas.
  - **Sanitização/normalização:** `trim()` no servidor; string vazia → `NULL`.
    Recomenda-se remover caracteres de controle (exceto `\n`) e colapsar sequências
    absurdas de quebra de linha, para não quebrar comanda/recibo.
  - **XSS na view do lojista:** o texto é renderizado em **Server Components React**
    (`DetalhePedido`, `ComandaCozinha`, `ReciboCliente`) — o JSX **auto-escapa** por
    padrão. **Proibido** usar `dangerouslySetInnerHTML` com este campo (seguranca.md §15).
  - **Injeção na mensagem do WhatsApp:** a mensagem inteira passa por
    `encodeURIComponent` antes de virar URL (`whatsappPedido.ts` já faz isso) — o texto
    do cliente é escapado para a URL. Sem risco de quebra de query string.
- **Valor monetário?** Não. A observação **nunca** entra no cálculo. O recálculo
  autoritativo de subtotal/frete/desconto/total no servidor (seguranca.md §10) ignora
  completamente o campo. Reforçar que a observação não é vetor de manipulação de preço.
- **Tabela nova?** Não — coluna nova em `itens_pedido`. **Nenhuma policy RLS nova**: a
  coluna herda as políticas existentes (leitura só do dono; escrita só via RPC
  `service_role`). O modelo de escrita deny-all para anon já cobre o campo.
- **API externa com key?** Não se aplica.
- **Trajeto de confiança:** cliente digita (não-confiável) → `montarPayloadPedido` →
  `schemaItemPedido.safeParse` (**gate de tamanho .strict()**) → `criarPedido` normaliza
  → RPC `service_role` grava snapshot → lojista lê sob RLS. O cliente nunca escreve
  direto em `itens_pedido`.

## Fora do Escopo (v1)

- **Editar/remover a observação depois de enviado o pedido** (nem cliente nem lojista) —
  snapshot imutável, como `nome`/`preco`.
- **Observação por pedido** — já existe (`pedidos.observacoes`, limite 500); não é tocada.
- **Sugestões/atalhos de observação** (chips "sem cebola", "sem glúten") — fase futura.
- **Observação em opcional individual** (`itens_pedido_opcionais`) — só no item, não no opcional.
- **Notificação em tempo real ao lojista** — fora do escopo (roadmap fase 2, `modelo-negocio.md` §8).
- **Configuração pelo lojista** (ligar/desligar o campo, mudar o limite por loja) — v1
  é sempre-ligado com limite fixo global.
- **Busca/filtro de pedidos por conteúdo da observação** — não previsto.
