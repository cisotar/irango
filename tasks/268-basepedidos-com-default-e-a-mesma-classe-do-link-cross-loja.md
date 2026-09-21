# [268] `basePedidos` com default é a mesma classe do link cross-loja do cardápio

**crítica: NÃO** — hoje todo call site admin passa o valor, então não há sintoma.

**Depende de:** nada.

## Origem

Varredura feita ao corrigir o bug que o usuário encontrou em teste local (PR #144): no hub admin,
editando "Lanches base", o link "Escolher um cardápio" levava a `/painel/cardapios/novo` — o painel
do lojista logado, ou seja, a loja do próprio admin. O href estava hardcoded em componente que o
admin reusa. Corrigido com prop obrigatória sem default (`hrefCardapios: string | null`), no padrão
que `NavPainel` e a issue 160 já fixavam: regra de roteamento não mora em componente de
apresentação, e omitir tem que quebrar o build.

## O que sobrou

Quatro componentes reusados pelo admin têm a prop de rota **com default** `"/painel/pedidos"`:

- `src/components/painel/DetalhePedido.tsx` (`basePedidos`)
- `src/components/painel/TabelaPedidos.tsx` (`basePedidos`)
- `src/components/painel/DashboardLoja.tsx` (`basePedidos`)
- `src/app/(painel)/painel/(bloqueavel)/pedidos/PedidosClient.tsx` (`basePedidos`)

Hoje todos os call sites admin passam o valor explícito, então nenhum link nasce errado. Mas um
call site admin novo cairia no default em silêncio — e o link levaria o operador ao pedido da loja
dele mesmo, não da loja-alvo. É bug adormecido, não bug ativo.

Há testes que afirmam o default explicitamente ("sem basePedidos: aponta para /painel/pedidos"), o
que impediu corrigir dentro do PR #144 sem afrouxar asserção.

Também: `FormProduto.tsx` tem `router.push("/painel/produtos")` no ramo sem `onSucesso`.
Inalcançável hoje (os dois mundos sempre passam `onSucesso`), e o dano seria só de navegação — a
gravação já teria ido na loja certa. Vale tornar `onSucesso` obrigatória ou injetar o destino.

## Escopo

1. Remover o default das quatro props e tornar a rota obrigatória; ajustar os testes que afirmavam
   o default para afirmar a **ausência** de default (omitir não compila).
2. Estender a trava de fonte de `rotaCardapiosInjetada.test.tsx` para proibir também
   `"/painel/pedidos"` e `"/painel/produtos"` em `src/components/painel/**`.

## Critério de aceite

- `grep -rn '"/painel/' src/components/painel/ --include=*.tsx --include=*.ts | grep -v test` volta
  vazio.
- Omitir qualquer uma das quatro props quebra `npx tsc --noEmit`.
