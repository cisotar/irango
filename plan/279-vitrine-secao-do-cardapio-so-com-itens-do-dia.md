## Plano Técnico

### Análise do Codebase

O que já existe e será **reusado**:

- `src/lib/utils/vigenciaCardapio.ts` — `itemAberto(vinculo, agora, timezone)` ([273]): `cardapioAberto` **E** o dia do item, interseção e não união, `diaIndex` de `partesNoFusoCompletas`. **Nenhuma regra de dia é escrita nesta issue.**
- `src/lib/utils/catalogoVitrine.ts:agruparPorCardapio` — já ordena por `ordem → nome (pt-BR) → id`, já deduplica vínculo repetido por `Set`, e **já termina com `.filter(secao => secao.produtos.length > 0)`** (regra da issue 177, reaplicada em [248]). É esse filtro que faz a seção vazia sumir — **nenhuma linha nova de filtro**, exatamente como a issue exige.
- `projetarCatalogoVitrine` — já consome `vinculosPorProduto: Map<string, VinculoVigencia<C>[]>` e já produz `rotulosVigencia` por vínculo via `escolherVinculoParaRotulo` + `rotuloVoltaQuando`, que desde [273] lê os dias do **item** quando o cardápio está aberto (RN-08). **Já está pronto; esta issue não o toca.**
- `src/app/(publica)/loja/[slug]/page.tsx:222` — a única chamada de `agruparPorCardapio` em produção. `agora` e `timezoneLoja` **já existem** duas linhas acima, no mesmo escopo.
- `src/lib/actions/paridade-preview-autoritativo.test.ts` — gate de que a vitrine não diverge do recálculo autoritativo.
- `src/components/vitrine/secoesDestaque.test.tsx` — render das seções com `renderToStaticMarkup`.

O que **precisa ser criado**: **nada**. Esta issue é uma mudança de três linhas em uma função pura, mais casos de teste.

### A mudança, exatamente

`agruparPorCardapio` hoje empurra o produto na seção do cardápio quando o cardápio está no mapa (`secoes.get(cardapio.id)?.produtos.push(produto)`), o que já é o filtro de RN-15. Passa a empurrar **só quando `itemAberto(vinculo, agora, timezone)`** — e para isso precisa dos dois parâmetros novos. Assinatura:

```
agruparPorCardapio(produtos, cardapiosAbertos, vinculosPorProduto, agora, timezone)
```

`agora`/`timezone` por parâmetro, nunca `new Date()` dentro — é a convenção de todo o módulo, e é o que mantém o teste determinístico. A alternativa (injetar um predicado) esconderia qual regra decide e abriria a porta para um segundo critério de dia; `itemAberto` chamado diretamente mantém um dono só.

**O docstring da função precisa ser corrigido junto com o código.** Ele hoje afirma: *"todo produto de cardápio aberto está `dentroDaJanela` … então nenhum produto de seção de destaque está fora da janela"*. Com agenda por item isso deixa de ser verdade por propriedade e passa a ser verdade **por filtro**. Um comentário que mente é pior que nenhum, e a revisão vai tropeçar nele.

### Cenários

**Caminho feliz (quarta-feira)**
1. "Especiais do Dia" abre os 7 dias. Feijoada `{qua, sáb}`, Virado `{seg}`, Dobradinha `{ter}`.
2. `projetarCatalogoVitrine` devolve os três produtos (RN-13: nenhum some, todos têm volta).
3. `agruparPorCardapio` põe na seção **só a Feijoada**.
4. Virado e Dobradinha continuam nas categorias deles, `disabled`, com o selo lendo os dias do **item** (RN-08): "Só às segundas", "Só às terças".

**Casos de borda**
- **Domingo, nenhum item do dia:** a seção **não é devolvida** — cai no `.filter` que já existe. O trilho `NavCategorias` deixa de ganhar uma pílula que não leva a lugar nenhum (ele recebe as seções renderizadas, não `cardapiosAbertos`).
- **`rotulosJanela` órfão:** a página monta o mapa `cardapio_id → rótulo` a partir de `cardapiosAbertos`, e a seção descartada deixa uma entrada que ninguém lê. Inofensivo e **deliberadamente não "consertado"**: derivar o mapa das seções acoplaria duas coisas que hoje são independentes, por alguns bytes de payload.
- **Produto `visibilidade = 'menu'` com vínculo agendado:** continua comprável **todo dia** — `avaliarVigenciaDoProduto` curto-circuita antes de olhar cardápio (RN-05). Na seção de destaque ele **não** aparece fora do dia do item: a seção é a projeção do cardápio, não da comprabilidade. Caso de teste obrigatório, porque é o que separa "some da seção" de "some da loja".
- **Produto em dois cardápios abertos, com agenda só em um:** sai na seção de quem está aberto **para ele** hoje, e na categoria dele. `dentroDaJanela` continua sendo a **união** dos vínculos: pôr o produto em mais um cardápio nunca reduz disponibilidade.
- **Vínculo sem dias:** `itemAberto` devolve `true` (`dias.length === 0` = todos os dias do cardápio). É 100% das linhas no deploy da [272] — **o comportamento de hoje não muda em loja nenhuma que não use a feature.**
- **Produto esgotado dentro do dia:** continua na seção, com selo de esgotado. `disponivel` é ortogonal à janela.
- **`cardapiosAbertos` vazio / `produtos` vazio:** `[]`, como hoje.
- **Loja quase toda de destaque (efeito colateral registrado):** num dia sem itens, o número de seções pode cair abaixo de `MINIMO_CATEGORIAS = 3` em `NavCategorias.tsx:47` e esconder o trilho. É o comportamento **certo** do trilho (não há o que navegar), mas é uma mudança visível dia a dia — **registrada, não consertada**.

**Tratamento de erros:** função pura, sem I/O e sem caminho de erro. A decisão é sempre SSR, no fuso da loja, no instante do request; o cliente **nunca** avalia dia.

### Schema de Banco

**Nenhuma mudança.** Nenhuma query nova: `buscarCardapiosComProdutos` já é uma das cinco da onda da vitrine e já traz `dias_semana` no embed.

### Validação (zod)

Nenhuma. Não há entrada de usuário nesta issue.

### Recálculo no Servidor

Sem valor monetário **nesta projeção** — mas a invariante que importa é adjacente e já está travada: **a recusa de compra não é daqui.** A autoridade de "este item pode ser comprado agora" é `avaliarVigenciaDoProduto` no recálculo de `criarPedido` e em `revisarCarrinho` ([273]). Esta issue muda apenas **onde o card é exibido**. Por isso `paridade-preview-autoritativo.test.ts` é o gate: se alguém trocar exibição por permissão aqui, ele acusa a divergência.

Nenhum campo novo em `ProdutoVitrine`, nenhum motivo novo em `MotivoNaoCompravel`, nenhum cache (o catálogo da vitrine continua proibido de cachear).

### Arquivos a Criar / Modificar / NÃO tocar

**Modificar**
- `src/lib/utils/catalogoVitrine.ts` — `agruparPorCardapio` ganha `agora: Date` e `timezone: string`, chama `itemAberto` antes do `push`, e tem o docstring corrigido.
- `src/lib/utils/catalogoVitrine.test.ts` — os casos acima. As ~10 chamadas existentes de `agruparPorCardapio` no arquivo passam a receber os dois parâmetros; **as asserções de ordem, dedup e `foto_url` não mudam** (vínculo sem dias = comportamento de hoje), e é isso que prova que a mudança é aditiva.
- `src/app/(publica)/loja/[slug]/page.tsx` — só a chamada ganha `agora, timezoneLoja`. **Nenhuma query nova.**
- `src/components/vitrine/secoesDestaque.test.tsx` — cenário de dia sem item: a seção não é renderizada, o `id` de âncora dela não existe no HTML, e o trilho não a lista.

**NÃO tocar**
- `CardProduto`, `ItemProdutoLista`, `ProdutoModal`, `SecaoCatalogo`, `CatalogoVitrine`, `NavCategorias`, `ancoraSecao`/`ancoraCategoria`, `filtrarCatalogo` — a issue os lista nominalmente, e o ponto é justamente que **nenhum componente de vitrine muda**.
- `projetarProdutoVitrine` / `projetarCatalogoVitrine` — já consomem `vinculosPorProduto` e já produzem o selo por item desde [273].
- `agruparCatalogo` (seções de **categoria**) — irmã, não refactor: o item fora do dia **continua** na categoria dele.
- `rotuloVoltaQuando` / `escolherVinculoParaRotulo` — a escada continua sendo `proximaAbertura` **do cardápio**.
- `src/lib/utils/vigenciaCardapio.ts`.

### Dependências Externas

**Nenhuma.** Custo variável: zero. Custo de CPU: uma chamada de `itemAberto` por par produto↔cardápio aberto — `partesNoFusoCompletas` por chamada, na mesma ordem de grandeza do que a projeção já faz por produto. Nenhum round trip novo, nenhum byte novo no payload RSC.

### Ordem de Implementação

1. Casos novos em `catalogoVitrine.test.ts` escritos **contra a assinatura nova** (quarta ⇒ só a Feijoada; domingo ⇒ seção ausente; `'menu'` comprável todo dia). Eles não compilam ainda — é o vermelho barato desta issue.
2. `agruparPorCardapio` com `agora`/`timezone` + `itemAberto` + docstring corrigido.
3. `page.tsx` passa os dois argumentos.
4. `secoesDestaque.test.tsx` — o cenário de dia vazio.

Issue **não** crítica (projeção de exibição; a recusa de compra já está travada em [273]): não exige fase `tdd` formal, mas o passo 1 é vermelho-primeiro por construção.

**Gate mecânico:**
`npx vitest run src/lib/utils/catalogoVitrine.test.ts src/lib/actions/paridade-preview-autoritativo.test.ts src/components/vitrine/secoesDestaque.test.tsx` · `npx tsc --noEmit` = 0 · `npm run build` verde.
