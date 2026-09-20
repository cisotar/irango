# [267] Selo de promoção: Router Cache de 30s e a foto em "pratos promocionais"

**crítica: NÃO** — nenhum dos dois é risco monetário; quem cobra é `criarPedido`.

**Depende de:** 233 (selo e par de preços nas quatro superfícies), 234 (`ModalPromocoes`)

## Origem

Dois achados preventivos do `auditar` na issue 224, commit `3970e47`, branch
`feat/promocoes-nucleo-monetario`. Nenhum dos dois exigia ação na 224 porque a fatia ainda era
dark: `precoEfetivo` e `seloDesconto` eram calculados e descartados. Os dois passam a valer no
instante em que 233/234 levarem esses campos às props.

## Item A — Router Cache de 30s reexibe selo de promoção expirada

`next.config.ts:64` define `staleTimes.dynamic = 30`. Não é ISR e não congela a vigência no
servidor — `agora` continua sendo avaliado por request e o catálogo segue sem cache, como o
contrato exige. Mas o Router Cache do cliente pode reusar um payload RSC de até 30 segundos numa
navegação de volta.

Hoje o custo disso é, no máximo, um card esgotado desatualizado, e o comentário do arquivo já
assume esse risco. Depois de 233, o mesmo payload carrega `precoEfetivo` e `seloDesconto`: uma
promoção que expirou há 20 segundos pode continuar aparecendo com selo por mais 10.

A guarda estática de cache que a 224 deixou (`catalogoVitrine.test.ts`) faz `grep` só em
`page.tsx`, então não alcança `next.config.ts`.

### Escopo

1. Decidir entre: baixar `staleTimes.dynamic` para as rotas públicas, ou aceitar a janela e
   documentá-la em `references/architecture.md` como limite conhecido da vitrine.
2. Estender a guarda estática para cobrir `next.config.ts`, qualquer que seja a decisão — hoje
   ninguém percebe se esse número mudar.

## Item B — `_promocionais` preserva `foto_url` que a RN-3 anula no outro ramo

`src/app/(publica)/loja/[slug]/page.tsx` anula `foto_url` quando a categoria tem
`exibir_imagens === false` — a URL não pode trafegar, não basta não renderizar (RN-3, issue 201).
Esse nulling acontece dentro do adaptador de grupos.

A lista de promocionais é derivada de `produtosVitrine`, **antes** do adaptador, e portanto carrega
`foto_url` intacta. Hoje é inofensivo porque a lista não é consumida. Quando 233/234 renderizarem a
seção ou o modal de promoções a partir dela, a URL volta ao payload RSC e a issue 201 regride em
silêncio.

### Escopo

Derivar os promocionais depois do adaptador, ou mover o nulling de foto para dentro da projeção —
a segunda opção é a que torna a regressão impossível em vez de apenas corrigida.

## Fora de escopo

- Cachear o catálogo. Proibido por contrato (`page.tsx:30-42`), e nada aqui muda isso.
- O skew entre o `now()` do Postgres e o `new Date()` do Node: a composição é fail-closed por
  construção (só é promocional quando os dois concordam) e não precisa de correção.

## Critério de aceite

- Guarda estática que quebra se `staleTimes` mudar sem decisão registrada.
- Teste provando que produto de categoria com `exibir_imagens = false` não leva `foto_url` em
  nenhum dos dois caminhos, incluindo o de promocionais.
