# Painel — Clientes (lista + detalhe)

Telas: `/painel/clientes` e `/painel/clientes/[id]`
Spec: `specs/cliente-base-do-lojista.md` (APROVADO) — passo P37, Marco D
Padrão espelhado: `src/app/(painel)/painel/(bloqueavel)/pedidos/` (`PedidosClient.tsx`, `TabelaPedidos.tsx`)
Paginação espelhada: `src/app/(cliente)/minha-conta/pedidos/page.tsx` ("Carregar mais" via `?pagina=N`)
Preview: `mockups/painel-clientes.html`

Legenda: **[spec]** = texto/comportamento literal do spec. **[proposta]** = decisão de UI deste mockup, não
está no spec; precisa de aceite. Itens sem resposta estão em "Dúvidas".

---

## Gate de reuso

- shadcn/ui varridos: `button`, `card`, `badge`, `separator`, `menu`, `sheet`, `dialog`, `toggle-group`,
  `accordion`, `input`, `label`. **Não existe `ui/table.tsx`** → a tabela usa a mesma marcação de `TabelaPedidos`
  (o spec manda isso; não gerar primitivo à mão).
- Componentes painel: `CabecalhoPagina`, `TabelaPedidos` (+ `paraLinhaPedido`), `BadgeStatusPedido`,
  `NavPainel`, `PedidosClient` (filtro em linha de `Button size="sm"`), página de histórico de `/minha-conta/pedidos`
  ("Carregar mais" com `Button variant="outline" className="min-h-11"` renderizando `<Link>`).
- Tokens: `--color-card`, `--color-foreground`, `--color-muted`, `--color-muted-foreground`, `--color-primary`,
  `--color-primary-foreground`, `--color-border` (redefinido para `#8a8a8a` por `.superficie-painel`),
  `--color-fundo` (creme `#f5f0e6`), `--radius`.

Decisão: **REUSAR** (+ 1 componente novo de apresentação já previsto no spec: `TabelaClientes`).
Justificativa: tudo o que a tela precisa já existe; `TabelaClientes` é cópia estrutural de `TabelaPedidos` com
outras colunas, sem token, cor ou primitivo novo.

O painel **não** usa `lojas.tema` (cor do lojista). Tudo aqui é token de sistema.

---

## 1. Navegação — item "Clientes" [spec]

```
 Dashboard
 Pedidos
 Clientes      <- novo, ícone Users (lucide), logo após "Pedidos"
 Produtos
   Opcionais
 Cupons
 Configurações
```

- Entrada em `NavPainel.tsx`: `{ href: \`${base}/clientes\`, rotulo: "Clientes", icone: Users }`.
- Ativo em `/painel/clientes` e `/painel/clientes/<id>` pelo `estaAtivo` existente (prefixo).
- Ícone `aria-hidden`; o texto "Clientes" é o nome acessível.

## 2. Lista — `/painel/clientes`

### Desktop (≥ md)

```
+------------------------------------------------------------------------------+
| < Painel                                                                     |  CabecalhoPagina
| Clientes                                                                     |  (card)
+------------------------------------------------------------------------------+
+------------------------------------------------------------------------------+
| [ Todos ] [ Aniversariantes do mês ]                                         |  Card > CardHeader
|------------------------------------------------------------------------------|
| Nome            | Telefone        | Pedidos | Último pedido | Aniver. | Promoções  |
| Mariana Souza   | (11) 98765-4321 |    12   | 01/10/2026    | 14/03   | Aceita     |
| Rafael Lima     | (11) 91234-5678 |     3   | 28/09/2026    | 02/10   | Não aceita |
| Beatriz Nunes   | (11) 99876-1234 |     0   | —             | 21/07   | Aceita     |
|------------------------------------------------------------------------------|
|                          [ Carregar mais ]                                   |
+------------------------------------------------------------------------------+
```

### Mobile (360px) — lista de cards (sem scroll horizontal, design-system §9)

```
+--------------------------------+
| < Painel                       |
| Clientes                       |
+--------------------------------+
+--------------------------------+
| [Todos] [Aniversariantes do mês]|
|                                |
| +----------------------------+ |
| | Mariana Souza          >   | |  nome = link (cobre o card)
| | (11) 98765-4321            | |
| | 12 pedidos · último 01/10/2026|
| | Aniversário 14/03          | |
| | [Aceita promoções]         | |
| +----------------------------+ |
|            ...                 |
| [      Carregar mais       ]   |
+--------------------------------+
```

### Colunas — exatamente a allowlist do spec, nesta ordem [spec]

| Coluna exibida | Campo da função | Formato |
|---|---|---|
| **Nome** (link p/ detalhe) | `nome` (`cliente_id` só no `href`, nunca exibido) | texto |
| **Telefone** | `telefone` | como gravado; ver Dúvida D4 |
| **Pedidos** | `total_pedidos` (exclui cancelado, RN-D08) | inteiro; `0` permitido |
| **Último pedido** | `ultimo_pedido_em` | data no fuso da loja; `—` quando null (só cancelados) [spec] |
| **Aniversário** | `dia_aniversario`, `mes_aniversario` | `dd/mm` [spec]; nunca ano |
| **Promoções** | `aceita_marketing` | "Aceita" / "Não aceita" [spec] |

Nada além disso. Sem e-mail, sem idade, sem endereço, sem valor em dinheiro.

### Componentes

| Peça | Componente / classe |
|---|---|
| Cabeçalho | `CabecalhoPagina` titulo="Clientes" voltarHref="/painel" [spec] |
| Container | `Card` > `CardHeader` (filtro) + `CardContent` (tabela) — mesma forma de `PedidosClient` |
| Filtro | 2 × `Button size="sm"` renderizando `<Link>`; ativo `variant="default"`, inativo `variant="outline"`; `aria-current="page"` no ativo. Rótulos "Todos" / "Aniversariantes do mês" [spec]. Links `?aniversariantes=1` e sem param [spec]. Uso de link + `aria-current` em vez de `role="tab"` é **[proposta]**: o estado vive na URL e cada opção navega. |
| Tabela desktop | marcação de `TabelaPedidos`: `thead` `bg-muted/50 text-muted-foreground`, `tr relative hover:bg-muted/50`, link do nome com `after:absolute after:inset-0` (linha inteira clicável, nenhum botão dentro de `<a>`) |
| Pedidos | `text-right tabular-nums` **[proposta]** |
| Promoções | `Badge variant="outline"` com texto (nunca só cor) **[proposta]** — sem cor semântica nova |
| Cards mobile | `Card size="sm" className="relative gap-2 hover:bg-muted/50"` em `<ul class="flex flex-col gap-3 md:hidden">` |
| Carregar mais | `Button variant="outline" className="min-h-11"` + `<Link href="?pagina=N+1" scroll={false}>`, igual a `/minha-conta/pedidos`; aparece só quando há próxima página (50 por página) [spec: 50 + "Carregar mais"]. Centralizado abaixo da tabela **[proposta]**. |

### Estados

| Estado | Texto | Origem |
|---|---|---|
| Base vazia (filtro "Todos") | "Nenhum cliente com conta pediu na sua loja ainda." | [spec] |
| Filtro ligado, sem resultado | "Nenhum aniversariante neste mês." | [spec] |
| Erro da RPC | mensagem genérica (texto não definido — Dúvida D6) | [spec: "UI mostra mensagem genérica"] |

Visual do vazio: mesmo bloco de `TabelaPedidos` (`rounded-lg border border-dashed py-12 text-center`, texto
`text-sm text-muted-foreground`), dentro do `CardContent`. O filtro continua visível no estado vazio filtrado,
para o lojista voltar a "Todos" **[proposta]**. Sem CTA (ver Dúvida D5).

## 3. Detalhe — `/painel/clientes/[id]`

```
+--------------------------------+
| < Clientes                     |  CabecalhoPagina titulo=<nome> voltarHref="/painel/clientes" [spec]
| Mariana Souza                  |
+--------------------------------+
+--------------------------------+
| Telefone        (11) 98765-4321|  Card > CardContent, <dl> em grade [proposta]
| Aniversário     14/03          |
| Promoções       Aceita         |
| Pedidos         12             |
| Último pedido   01/10/2026     |
+--------------------------------+
+--------------------------------+
| Pedidos nesta loja             |  título da seção [proposta]
| TabelaPedidos (reuso)          |  número/data, status, modalidade, total [spec]
|  #A1B2C3 · Entregue · 01/10    |  cada um -> /painel/pedidos/[id]
+--------------------------------+
```

- Os campos do bloco são os mesmos da linha da lista [spec]; rótulos iguais aos cabeçalhos de coluna **[proposta]**.
- `<dl>`/`<dt>`/`<dd>` em `grid grid-cols-[auto_1fr] gap-x-4 gap-y-2` **[proposta]**.
- Pedidos: `TabelaPedidos` com `BadgeStatusPedido` estático [spec] — ver Dúvidas D1 e D2 (o componente hoje não
  tem modo estático nem coluna de data/modalidade).
- 404 (`notFound()`): id não-UUID ou fora da base. Página 404 padrão do app, sem texto novo [spec].

## 4. Acessibilidade (WCAG 2.1 AA)

- Alvos de toque ≥ 44×44: filtro e "Carregar mais" com `min-h-11`; card mobile inteiro é o alvo do link.
- `focus-visible:ring-2` em todo link/botão; no card mobile o anel aparece no card (`has-[a:focus-visible]:ring-2`) **[proposta]**.
- Tabela com `<th scope="col">`; `<caption class="sr-only">` "Clientes da loja" **[proposta]** (equivalente ao `CardTitle sr-only` de Pedidos).
- "Promoções" = texto, nunca só cor. Contraste: `foreground` sobre `card` ≈ 18:1; `muted-foreground` (`oklch 0.556` ≈ `#737373`) sobre branco ≈ 4,7:1 e sobre `muted/50` > 4,5:1 — passa.
- Limite do card pela `.superficie-painel` (3,45:1, design-system §10.2).
- "Carregar mais": após carregar, o foco permanece no botão (`scroll={false}`); anunciar a nova contagem é **[proposta]** fora do escopo do spec.
- `—` em "Último pedido" recebe `aria-label="Sem pedido concluído"` **[proposta]** (o traço sozinho é lido como nada).

## 5. Dúvidas (não resolvidas pelo spec)

- **D1 — Status estático em `TabelaPedidos`.** O spec pede `BadgeStatusPedido` estático no detalhe, mas
  `TabelaPedidos` sempre renderiza `MenuStatusPedido` (clicável) em status não terminal e não tem prop para
  desligar isso. Opções: prop nova (ex.: `somenteLeitura`) ou outra marcação. Decidir no `planejar`.
- **D2 — Colunas do detalhe vs. `TabelaPedidos`.** O spec lista "número/data, status, modalidade e total";
  `TabelaPedidos` mostra Pedido, **Cliente** (redundante aqui), Total, Status e **Hora** (sem data), e modalidade
  só como selo RETIRADA. Reuso puro mostra hora sem dia e o nome repetido. Precisa de decisão: aceitar como está,
  ou parametrizar colunas.
- **D3 — Paginação do detalhe.** O spec pagina a lista (50), mas não diz nada sobre a lista de pedidos do detalhe.
  Mostrar todos?
- **D4 — Formato do telefone.** Exibir como gravado ou mascarado `(11) 98765-4321`? Link `tel:`? O spec não diz.
  O mockup mostra mascarado só como ilustração.
- **D5 — CTA no estado vazio.** `design-system.md` §6 pede "texto + CTA"; o spec dá só o texto. Sem CTA no mockup.
- **D6 — Texto do erro genérico** da RPC na lista/detalhe não está definido.
- **D7 — Mês no filtro.** Mostrar o nome do mês ("Aniversariantes de outubro")? O spec diz só
  "Aniversariantes do mês"; mockup segue o spec.
- **D8 — `?pagina` + `?aniversariantes`.** Trocar o filtro zera a página? O mockup assume que sim (links do filtro
  sem `pagina`). "Carregar mais" preserva `aniversariantes=1`.
- **D9 — Formato de "Último pedido".** Só data (`dd/mm/aaaa`) ou data + hora? O spec diz "data no fuso da loja";
  mockup usa só data.
