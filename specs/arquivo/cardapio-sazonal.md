# Spec: Cardápio sazonal

**Versão:** 0.4.0 | **Atualizado:** 2026-09-20

> **Fatia B de duas.** Esta spec fecha o **calendário**: a entidade cardápio, os dois modos de
> vigência (recorrente e prazo fixo), a ação em lote no painel e o que acontece com o produto
> **fora da janela**. A fatia A (`specs/desconto-por-produto-e-pratos-promocionais.md`, **v0.3.0,
> aprovada**) fecha o **preço** e é a **dona do contrato de catálogo**. Esta spec **consome** aquele
> contrato pelo ponto de extensão que ele declarou (`compravel` + `motivoNaoCompravel`) e **não
> reabre nada dele**: não mexe em `preco`, `precoEfetivo`, `temDesconto`, `seloDesconto`, não cria um
> terceiro preço e não cria desconto de cardápio.
>
> Contrato de negócio de origem: **D2, D3, D4**, transcritos em
> `plan/loop-descontos-promocoes-cardapio-sazonal.md` §0, e as regras D1, D5–D11 do Spec A, que aqui
> valem como **contrato fechado**. Esta spec as mapeia contra o codebase; não as decide.
>
> ### O que mudou na v0.2.0 (as duas pendências foram respondidas pelo dono do produto)
>
> **As duas perguntas que a v0.1.0 deixou abertas foram respondidas em 2026-09-20. Não há pendência
> de contrato aberta nesta spec** — a antiga §Pendências de contrato virou §Contrato — o que foi
> fechado na v0.2.0, que registra as duas respostas e o que cada uma custou.
>
> 1. **Antiga P1 — `dias_semana` e `dias_mes` juntos: OU.** O default da v0.1.0 foi **confirmado** e
>    virou regra fechada (RN-02). `{sáb,dom}` + `{1,15}`, numa **quarta-feira dia 15** ⇒ **ABERTO**.
> 2. **Antiga P2 — prazo fixo expirado: substituída por D14**, que é uma **terceira resposta**, não
>    uma das duas que a v0.1.0 ofereceu, e **muda o modelo de dados**.
>
> > **D14 — Todo produto é "do menu" ou "de cardápio".** Coluna nova `produtos.visibilidade`.
> > **do menu** (default) — aparece sempre, como hoje; estar dentro de um cardápio serve só para
> > **destacar** na temporada, **não** tira do menu e **não** esconde quando o cardápio fecha ou
> > expira. **de cardápio** — só aparece quando **algum cardápio dele está aberto**.
> >
> > Palavras do dono do produto: *"se produto vivia só no cardápio de inverno, ele desaparece do menu
> > como um todo; se ele vivia no menu regular, ele continua onde vivia."*
>
> **Consequência que atravessa a spec inteira:** "fora da janela" deixou de ter **um** desfecho.
> Agora tem **dois**, decididos por uma pergunta só — *existe uma próxima abertura conhecida?*
> (RN-13). Com próxima abertura ⇒ **aparece marcado** com "volta sábado" (D4 intacto). Sem próxima
> abertura ⇒ o produto **de cardápio some da vitrine** (era o buraco que o `desenhar` achou por outro
> caminho: quando a temporada acabou, o selo "quando volta" não tem o que dizer). Produto **do menu**
> nunca some e nunca deixa de vender por causa de cardápio.
>
> **A migration continua sendo expand puro, sem backfill** (RN-14) — o default `'menu'` preserva
> exatamente o comportamento de hoje para os produtos que já existem.
>
> ### O que mudou na v0.4.0
>
> **Prévia da ação em lote, vinda do servidor (RN-09-a).** É mecanismo, não regra de negócio:
> D2 continua idêntico. O `desenhar` (`plan/design-promocoes-e-vigencia.md` §10.2 e §12, item 6,
> mecanismo M8) exigiu que a confirmação do lote mostre **quantos e quais** produtos a ação atinge,
> com o número **dentro do rótulo do botão**, e que essa contagem **nunca** seja feita no cliente —
> a seleção pode estar velha ou conter id de outra loja, e só o servidor resolve nomes sob RLS. A
> v0.3.0 não tinha onde isso morar. Entrou como RN-09-a, um behavior em "Produtos do painel" e uma
> asserção a mais no RED da fatia 5. Nada mais mudou.
>
> ### O que mudou na v0.3.0
>
> **1. RN-03 promovida a regra fechada.** Desligar um cardápio faz o produto **exclusivo** dele
> sumir da vitrine, e o produto **do menu** seguir vendendo. A v0.2.0 tinha escolhido a letra de D14
> contra a própria RN-03 v0.1.0 e pedido confirmação; **confirmado em 2026-09-20**, com o argumento
> que a própria spec levantou: se desligar o Cardápio de Inverno fizesse a sopa exclusiva voltar a
> vender o ano todo, desligar seria o gesto mais perigoso do painel. A cópia de dois números no
> `Switch` e no diálogo está aprovada. **Nada foi reescrito** — só saiu o pedido de confirmação.
>
> **2. D16 — escopo novo, a maior adição desde D14.**
>
> > **D16 — Todo cardápio ABERTO ganha uma seção própria no topo do catálogo da vitrine**, com o nome
> > do cardápio, contendo os produtos dele. A seção **some sozinha** quando o cardápio fecha.
> >
> > **D16-a — O produto aparece NAS DUAS seções.** A Lasanha (do menu, categoria "Massas", vinculada
> > ao Cardápio de Inverno) aparece na seção "Cardápio de Inverno" **e** continua em "Massas". A
> > seção do cardápio é **vitrine de destaque no topo**; ela **não move** o produto para fora da
> > categoria. Quem navega por "Massas" acha a Lasanha onde sempre esteve.
>
> D16 dá forma ao *"destacar na temporada"* de D14, que a v0.2.0 tinha deixado em §Fora do Escopo
> por não ter desenho. **Saiu de lá e entrou no escopo** (RN-15, RN-16, fatias 18 e 19).
>
> **A duplicata na tela é a novidade de risco**, e ela é tratada em dois lugares: **onde é
> desejada** (catálogo, é o ponto de D16-a) e **onde é proibida** (resultado de busca e qualquer
> contagem — RN-16). As duas são travadas por desenho, não por disciplina.

---

## Visão Geral

Hoje o iRango não tem **nenhum** conceito de sazonalidade, vigência ou cardápio: `produtos` tem
`disponivel` (esgotado, aparece marcado) e `oculto` (não aparece), e nada mais. O lojista que só
vende feijoada no fim de semana tem duas saídas ruins — deixar o produto visível a semana inteira e
recusar o pedido no WhatsApp, ou entrar no painel toda segunda para ocultar e toda sexta para
reexibir, à mão, produto a produto.

Esta feature dá ao lojista uma entidade **cardápio**: ele cria "Cardápio de Inverno" ou "Almoço
executivo", coloca **produtos** dentro (vários de uma vez, ou uma categoria inteira) e define **uma
janela de validade do cardápio** — não do produto. Fora da janela, o produto **aparece marcado**, sem
botão de compra e com um selo dizendo quando volta ("Só aos sábados e domingos"). O servidor recusa o
item se ele chegar num pedido fora da janela.

**D14 acrescenta a segunda metade da resposta, e ela é sobre o produto, não sobre o cardápio.** Todo
produto passa a ter uma `visibilidade`:

| `produtos.visibilidade` | Significado | Fora da janela |
|---|---|---|
| **`'menu'`** (default, comportamento de hoje) | o produto vive no menu regular. Pôr num cardápio serve para **destacar** na temporada | **nada acontece** — continua aparecendo e vendendo, o cardápio fechado ou expirado não o afeta |
| **`'cardapio'`** | o produto **só** existe por causa de um cardápio ("sopa de cebola" do inverno) | **aparece marcado** enquanto houver uma próxima abertura conhecida; **some da vitrine** quando não houver (RN-13) |

O caso que obrigava a inventar uma frase impossível — temporada acabada, nada a dizer sobre "quando
volta" — deixou de existir: ali o produto de cardápio **some**, e o lojista é avisado disso no painel
(RN-12), que é o único lugar onde ele consegue agir.

**E D16 dá ao cardápio ABERTO uma presença própria na vitrine.** Até aqui o cardápio era invisível
para o cliente: ele só se manifestava pela ausência ou pelo selo de um produto. Com D16, cardápio
aberto **é uma seção no topo do catálogo**, com o nome que o lojista deu, e some sozinha quando
fecha. O produto **não muda de lugar** por causa disso — ele aparece na seção do cardápio **e** na
categoria dele (D16-a). A seção é uma **vitrine de destaque**, não uma mudança de organização:
`categorias` continua sendo a estrutura do catálogo, e quem navega por "Massas" acha a Lasanha onde
sempre esteve.

**A UI não é a proteção.** O card desabilitado é cortesia para o cliente que está olhando a tela. A
recusa é do servidor, no mesmo lugar e com o mesmo padrão em que `criarPedido` já recusa produto
indisponível, oculto ou de outra loja (`src/lib/actions/pedido.ts:174-177`). As duas coisas são
fatias diferentes e só uma é crítica.

**Mundos em que vive:**

| Mundo | O que muda |
|---|---|
| Vitrine pública (`/loja/[slug]`, `/loja/[slug]/pedido`) | produto fora da janela aparece marcado e não comprável, no catálogo **e no resultado de busca** — ou **some**, se for `visibilidade = 'cardapio'` sem próxima abertura (D14/RN-13); **cardápio aberto vira seção no topo, com o produto aparecendo nela e na categoria dele** (D16); o checkout revisa e o servidor recusa |
| Painel do lojista (`/painel/cardapios`, `/painel/cardapios/[cardapioId]`, `/painel/produtos`) | CRUD de cardápio, form dos dois modos de vigência, ação em lote, o campo `visibilidade` do produto e o aviso de cardápio expirado/desligado escondendo produtos |
| Hub admin (`/admin/assinantes/[lojaId]/*`) | **nada** — gestão de cardápio não entra no hub admin na v1 (§Fora do Escopo, com a consequência de segurança registrada) |
| Auth | nada muda |

**O que NÃO é:** cardápio **não é categoria**, mesmo depois de D16. `categorias` continua sendo a
**estrutura** do catálogo — a organização, a ordem, o `exibir_imagens`, e o único lugar onde cada
produto **mora**. Cardápio é uma **janela de tempo** aplicada a um conjunto de produtos que, quando
está aberta, também **aparece como vitrine de destaque no topo**. A diferença que decide tudo:
categoria **contém** o produto (ele está em uma só); cardápio **aponta** para ele (pode apontar de
vários, e apontar não tira o produto de onde ele está). É por isso que D16-a é "aparece nas duas" e
não "muda de seção" — e por isso mudar o cardápio nunca reorganiza o catálogo.

---

## Atores Envolvidos

| Ator | O que faz nesta feature |
|---|---|
| **iRango (SaaS)** | fornece o mecanismo de janela. Não modera, não sugere e não define horário de ninguém. Garante que a janela é avaliada **no fuso da loja, no servidor**, que loja A nunca lê nem escreve cardápio da loja B, e que um item fora da janela **não vira pedido**. Continua sem tocar em pagamento (`modelo-negocio.md` §3). |
| **Lojista** | cria e nomeia o cardápio, escolhe o modo de vigência (recorrente ou prazo fixo), define dias/horários/prazo, liga e desliga, coloca e tira produtos — um a um, vários de uma vez, ou por categoria inteira. **E declara, por produto, se ele é "do menu" ou "de cardápio" (D14)** — é essa declaração, e só ela, que decide se o produto some quando a temporada acaba. O sistema **nunca** muda essa declaração sozinho. **E controla a ordem das seções de destaque** pela `ordem` do cardápio (D16). |
| **Cliente** | **vê os cardápios abertos como seções no topo do catálogo**, com o nome que o lojista deu, e encontra o mesmo produto também na categoria dele (D16/D16-a); vê o produto fora da janela marcado, com o selo dizendo quando volta; não consegue adicioná-lo ao carrinho; não vê o produto "de cardápio" cuja temporada acabou — para ele, é como se não existisse (D14); se tentar assim mesmo (payload forjado, ou item que ficou no carrinho até a janela fechar), tem o pedido recusado pelo servidor. Nunca informa horário nenhum e nunca decide se um cardápio está aberto. |

---

## Como esta spec consome o contrato do Spec A

O Spec A (§Contrato de catálogo) declarou **um** ponto de extensão e as regras que o Spec B não pode
quebrar. É isto, literalmente, que esta spec faz — nada além:

```ts
/** v1 (Spec A) tinha um membro só. O Spec B ACRESCENTA; não remove nem renomeia. */
export type MotivoNaoCompravel = "esgotado" | "fora_da_janela";
```

- `compravel` passa a ser composto: **`compravel = disponivel && dentroDaJanela`**.
- `motivoNaoCompravel` continua sendo **um só motivo, decidido no servidor** (regra 3 do contrato).
  A precedência está em RN-05.
- `preco`, `precoEfetivo`, `temDesconto`, `seloDesconto`, `descontoFim` — **intocados**. Esta spec
  não os lê para decidir nada e não introduz preço novo.
- `oculto = true` continua ganhando de tudo e nem chega a virar `ProdutoVitrine` (regra 4).
- **D14 usa esse mesmo mecanismo, e não um terceiro.** Produto `visibilidade = 'cardapio'` sem
  nenhuma abertura conhecida **também não vira `ProdutoVitrine`** — é omitido da lista projetada,
  igual a `oculto`, em vez de virar um estado novo no objeto. **Nenhum campo novo** em
  `ProdutoVitrine`, e `visibilidade` **não trafega** ao cliente: ela é **entrada** da projeção, como
  os cardápios e o `timezone` (regra 6 do contrato do Spec A).
- Nenhum campo novo em `ProdutoVitrine` (regra 2: "o ponto de extensão é `compravel` +
  `motivoNaoCompravel`, **e só ele**"). O texto do selo viaja **ao lado** do catálogo, não dentro do
  objeto — ver RN-06 e a nota de desenho logo abaixo.

### As duas mudanças de assinatura que a composição exige (e por que não são mudanças de contrato)

O Spec A disse que o Spec B "passa a compor `compravel` com a vigência do cardápio". Compor exige o
insumo. Então:

1. **`projetarProdutoVitrine` ganha dois parâmetros OBRIGATÓRIOS** — os cardápios daquele produto e
   o `timezone` da loja:

   ```ts
   projetarProdutoVitrine(
     produto: Produto,
     cardapios: CardapioVigencia[],   // lista vazia ⇒ comportamento idêntico ao v1
     agora: Date,
     timezone: string,
   ): ProdutoVitrine
   ```

   **Obrigatórios de propósito, não por rigor estético.** Parâmetro opcional com default "dentro da
   janela" faz um caller novo que esqueceu de passar os cardápios produzir, em silêncio, um catálogo
   inteiro comprável fora da janela. O repo **não tem jsdom** (`environment: node`, sem Docker):
   proteção que dependa de alguém lembrar não é travável por teste. Parâmetro obrigatório move o erro
   para o `tsc` — que é o primeiro passo do CI. Mesmo princípio do `resolverEndereco` como thunk
   obrigatório em `distanciaFrete.ts` (issue 160).

2. **`partesNoFuso` ganha `diaDoMes`** no objeto de retorno. O Spec A **v0.3.0 adotou o nome
   proposto aqui**, e o módulo compartilhado é **acordo fechado entre os dois specs**:
   **`src/lib/utils/fusoLoja.ts`**, exportando **`partesNoFuso` e `paraMinutos`** (Spec A, RN-03), com
   a suíte atual de `lojaAberta` passando **sem edição**. Nome diferente nos dois specs produziria
   dois módulos de fuso, que é exatamente o que o acordo existe para impedir. Esta spec **consome
   esse módulo extraído** e não duplica uma linha de aritmética de fuso (mandato 2). A
   vigência por dia do mês precisa do dia; acrescentar `day` ao `Intl.DateTimeFormat` que já existe e
   devolver mais um campo é aditivo — `lojaAberta` continua lendo só `diaIndex` e `minutos`.
   `paraMinutos` (o `"HH:MM" → minutos`, hoje privado no mesmo arquivo) sai na **mesma** extração,
   pelo mesmo motivo: a alternativa é o Spec B escrever um segundo parser de hora. A implementação
   atual (`hhmm.split(":").map(Number)`) já ignora o terceiro campo, então ela aceita tanto `"11:00"`
   quanto o `"11:00:00"` que o Postgres serializa para uma coluna `time` — nenhuma adaptação.

> **Nota de desenho — por que o rótulo do selo NÃO entra em `ProdutoVitrine`.** D4 pede um selo que
> diga *quando volta* ("Só aos sábados e domingos"), e esse texto depende da janela do cardápio: a UI
> não tem como inventá-lo a partir do literal `"fora_da_janela"`. A regra 2 do contrato do Spec A
> proíbe campo novo no objeto, então o rótulo viaja **ao lado**, num mapa `produto_id → rótulo`
> produzido no mesmo request — exatamente o padrão que `opcionaisPorCategoria` já usa na mesma cadeia
> de componentes (`page.tsx` → `CatalogoVitrine` → `SecaoCatalogo`), e imune ao filtro da busca porque
> é chaveado por id. Para o mapa não poder ficar vazio por descuido, ele é **devolvido junto com os
> produtos, pela mesma função, num único objeto** (RN-06) — não existe caminho que produza um sem o
> outro. **Alternativa considerada e recusada:** transformar a união num membro-objeto
> (`"esgotado" | { tipo: "fora_da_janela"; rotulo: string }`). Ela é mais coesa, mas contraria a
> letra do Spec A, que nomeou o membro novo como o literal `"fora_da_janela"`. Se o dono do produto
> preferir a variante coesa, a troca é de uma linha nesta spec e não muda nenhuma outra decisão.

---

## Páginas e Rotas

### Vitrine da loja — `/loja/[slug]`

**Mundo:** vitrine pública (sem auth)

**Descrição:** o catálogo passa a distinguir produto **fora da janela de algum cardápio**. O card
continua aparecendo, com o mesmo tratamento visual de `esgotado` que já existe
(`CardProduto.tsx:67-97` — pill no rodapé da imagem + botão `disabled` + `aria-label` explicando) e
**nunca** o de `oculto`. A diferença é o texto: em vez de "Esgotado", o selo diz quando o produto
volta.

**E, por D14, um segundo desfecho:** produto `visibilidade = 'cardapio'` **sem próxima abertura
conhecida** não é renderizado — ele sai da lista **antes** do agrupamento, do mesmo jeito que
`oculto` sai. Isso é RN-13, e a ordem importa: a filtragem acontece **antes** de `agruparCatalogo`,
para que a regra já existente de que *"grupo sem nenhum produto visível NÃO é devolvido"* (issue 177,
`produtos.ts:78-88`) continue valendo de graça — categoria que ficou vazia porque a temporada acabou
**não** vira cabeçalho que não leva a lugar nenhum. Nenhum código novo de agrupamento.

**E, por D16, o catálogo ganha uma faixa nova no topo.** Cada cardápio **aberto agora** vira uma
`<section>` com o nome dele, antes da primeira categoria, contendo os produtos vinculados. As seções
de categoria **continuam exatamente como estão** — mesma ordem, mesmos produtos, mesmo
`exibir_imagens`. O produto vinculado aparece **nos dois lugares** (D16-a): a seção de destaque é
adicional, nunca substitutiva.

**Três invariantes do desenho, e é delas que sai a segurança da duplicata:**

1. **O objeto renderizado é o MESMO nos dois lugares.** A seção de destaque não reprojeta nada: ela
   agrupa referências à lista já projetada por RN-06. Não existe caminho em que a Lasanha apareça
   comprável no destaque e marcada na categoria — seria preciso haver duas projeções, e não há.
2. **Produto dentro de seção de destaque nunca está fora da janela.** A seção só existe para
   cardápio **aberto**, e `dentroDaJanela` é união (RN-05): estar vinculado a um cardápio aberto já
   torna o produto comprável. Ele ainda pode estar **esgotado** — esse selo aparece normalmente nas
   duas seções. É propriedade da função pura, e vira asserção de teste na fatia 18.
3. **A duplicata é de RENDER, nunca de dado.** Carrinho, checkout, `criarPedido` e qualquer contagem
   continuam vendo **um** produto. Adicionar a Lasanha pelo destaque e depois pela categoria produz
   **uma linha de quantidade 2**, porque `useCarrinho().adicionar` já deduplica por chave de linha
   (produto + opcionais + observação canônica) — comportamento existente, nada a fazer.

A página **continua sem cache**. `carregarLoja` é `cache()` do React (dedup **por request**) e o
comentário de `src/app/(publica)/loja/[slug]/page.tsx:30-42` diz que a vitrine carrega dado vivo,
**não** é ISR/`revalidate`/`'use cache'`. Vigência por horário torna isso ainda mais verdadeiro: um
cardápio que abre às 11:00 tem que abrir às 11:00, e um catálogo cacheado entre requests serve a
janela errada. **Nenhuma proposta de cache do catálogo faz parte desta spec.** O risco legítimo de
custo (duas queries a mais por request, e o `proximaAbertura` dos cardápios fechados) é nota para o
agente `acelerar` **depois** do `executar` — não licença para cachear.

**Componentes:**
- `CardProduto` (`components/vitrine/CardProduto.tsx`) — **modificar**: o prop `disponivel` dá lugar
  a `compravel` + `motivoNaoCompravel` + `rotuloIndisponivel`. **Nenhum estilo novo**: mesma pill,
  mesma opacidade, mesmo `disabled`, mesmo padrão de `aria-label`. Só o texto muda.
- `ItemProdutoLista` (`components/vitrine/ItemProdutoLista.tsx`) — **modificar**: mesma regra na
  variante textual (categoria com `exibir_imagens = false`).
- `ProdutoModal` (`components/vitrine/ProdutoModal.tsx`) — **modificar**: o selo central
  (linhas 341-352) e o CTA desabilitado (linhas 523-531) passam a ser dirigidos pelo motivo. O modal
  de um produto fora da janela abre (o cliente pode querer ler a descrição) mas não adiciona nada.
- `SecaoCatalogo` (`components/vitrine/SecaoCatalogo.tsx`) — **modificar**: recebe o mapa
  `rotulosVigencia` como prop **obrigatória**, ao lado de `opcionaisPorCategoria`. **E, por D16,
  passa a receber `SecaoVitrine[]` em vez de `CategoriaComProdutos[]`**, onde
  `SecaoVitrine = CategoriaComProdutos & { tipo: "cardapio" | "categoria" }` — **um campo a mais, não
  um tipo novo**: a seção de categoria continua sendo exatamente o objeto de hoje. O laço de render
  não muda de forma; muda só quem produz a âncora (RN-16). `opcionaisPorCategoria` **não muda**: ele
  é resolvido por `produto.categoria_id`, que o produto carrega para onde for.
- `CatalogoVitrine` (`components/vitrine/CatalogoVitrine.tsx`) — **modificar**: repassa o mapa e
  ganha a prop **`secoesDestaque: SecaoVitrine[]`, separada de `categorias`**. A separação é a trava
  de RN-16, não organização: `filtrarCatalogo` e `contarProdutos` recebem **só** `categorias`, e o
  destaque é concatenado apenas no ramo em que `emBusca === false`. Esse booleano **já existe** e já
  decide trilho × `ResumoBusca` (linhas 163-170) — nenhum estado novo, nenhuma condição nova.
- `NavCategorias` (`components/vitrine/NavCategorias.tsx`) — **modificar minimamente**: recebe
  `[...secoesDestaque, ...categorias]` em vez de `categorias`, e `CategoriaNavegavel` ganha **um**
  campo — `tipo` —, que é tudo de que ela precisa para pedir a âncora certa. **Nada mais muda ali:**
  o scrollspy, o `useMediaQuery`, o `scrollIntoView` e a lógica de chip ativo continuam iguais.
  `MINIMO_CATEGORIAS = 3` passa a contar as seções de destaque junto, que é o comportamento certo —
  o trilho existe quando há o que navegar. A nav já é **desmontada** em modo busca (D2 da 202), então
  não existe caso de chip de destaque sem seção correspondente: condição existente reusada.
- `ancoraCategoria` (`lib/utils/ancoraCategoria.ts`) — **estender aditivamente, não reescrever**. A
  função atual (`cat-${id}` / `grupo-${indice}`) fica **intocada, byte a byte** (a suíte dela passa
  sem edição), e o módulo ganha duas irmãs:
  `ancoraCardapio(id) → \`cardapio-${id}\`` e o despachante
  `ancoraSecao(secao, indice)`, que chama `ancoraCardapio` ou `ancoraCategoria` conforme `tipo`.
  **`SecaoCatalogo` e `NavCategorias` passam a chamar `ancoraSecao`** — mantendo o desenho que a
  issue 201 fixou: os dois derivam a âncora da **mesma** função em vez de receberem a string pronta,
  e é isso que impede `id` de `<section>` e `href` de chip de divergirem. Prefixos **disjuntos por
  construção** (RN-16). O módulo continua puro e sem `'use client'` (decisão D1 da 201: é chamado de
  Server Component).
- `agruparPorCardapio` — **criar**, função pura, irmã de `agruparCatalogo` e no mesmo módulo
  (`lib/supabase/queries/produtos.ts` ou `lib/utils/catalogoVitrine.ts`, o que o `executar` achar
  mais coeso). **Não** é refactor de `agruparCatalogo`: ver RN-15 e o critério de aceite.
- `CardProduto` — **mais uma mudança, por D16:** o prop `id` (hoje presente no contrato e **não**
  emitido no DOM, `CardProduto.tsx:10`) vira **`idNaSecao`, obrigatório**, produzido só por
  `idNaSecao(ancoraDaSecao, produto.id)`. É a trava de RN-16: com a duplicata, um `produto.id` cru
  vazando para um atributo de DOM produziria `id` repetido na página. `ItemProdutoLista` **não**
  recebe id hoje e **não pode ganhar** um que não seja escopado.
- `BuscaProdutos` (`components/vitrine/BuscaProdutos.tsx`) + `filtrarCatalogo`
  (`lib/utils/buscarProdutos.ts:82`) — **verificar, não reescrever**. `filtrarCatalogo` é
  estritamente subtrativa e repassa o objeto de produto inteiro por referência
  (`categoria.produtos.filter(...)`), então `compravel`/`motivoNaoCompravel` sobrevivem ao filtro de
  graça; o mapa de rótulos é chaveado por `produto_id` e também. **A exigência é que continue
  assim** — se alguém re-montar um shape reduzido no filtro, o estado "fora da janela" some da
  busca e volta o botão de compra. Cobertura: um teste de `filtrarCatalogo` que afirma que o produto
  filtrado mantém `compravel === false` e `motivoNaoCompravel === "fora_da_janela"`. **D16 não muda
  uma linha dela** — a seção de destaque nunca entra na lista que ela recebe (RN-16).
- `page.tsx` da vitrine — **modificar**: mais uma leitura na onda de `Promise.all` que já existe
  (hoje `buscarCategorias` ‖ `buscarProdutosPublicos`), e a projeção `categoriasComProdutos` passa a
  sair de `projetarCatalogoVitrine` (RN-06) em vez do `map` inline de hoje (linhas 174-190). **Ordem
  obrigatória:** `projetarCatalogoVitrine` (que já filtra por RN-13) **→** `agruparCatalogo` ‖
  `agruparPorCardapio` **→** `categoriasComProdutos` + `secoesDestaque`. Hoje é o contrário
  (`agruparCatalogo` primeiro), e inverter é o que faz a issue 177 continuar cobrindo a categoria
  esvaziada pela temporada. Os dois agrupamentos leem **a mesma** lista projetada — é isso que
  garante a invariante 1 acima.
- `agruparCatalogo` (`lib/supabase/queries/produtos.ts:88`) — **generalizar, não reescrever**: passa a
  aceitar `<T extends { id: string; categoria_id: string | null }>` em vez de `Produto[]`, para
  receber a lista já projetada. Comportamento idêntico, **a suíte atual passa sem edição**, e a regra
  do grupo vazio (issue 177) fica onde está. **Não** criar um segundo agrupador.

**Behaviors:**
- [ ] **Ver um produto fora da janela, marcado e sem botão de compra** — o card aparece no catálogo,
  com selo e "Adicionar" desabilitado. Garantido em: **SSR** — a decisão de janela é do servidor, no
  fuso da loja, no instante do request. O cliente **nunca** avalia janela.
- [ ] **Ler no selo quando o produto volta** ("Só aos sábados e domingos, das 11:00 às 15:00").
  Garantido em: **SSR** (o rótulo vem pronto do servidor, RN-06).
- [ ] **Comprar normalmente um produto dentro da janela** — nenhuma diferença visual em relação a
  hoje. Garantido em: **SSR** (estado) + **Server Action + RPC `criar_pedido`** (o que é cobrado).
- [ ] **Comprar normalmente um produto que não está em nenhum cardápio** — comportamento atual,
  inalterado (D2). Garantido em: **SSR** (`visibilidade = 'menu'` ⇒ `dentroDaJanela = true`, RN-05).
- [ ] **Comprar normalmente um produto "do menu" que está num cardápio fechado ou expirado** — o
  cardápio **não** o afeta; nenhuma diferença visual em relação a hoje (D14). Garantido em: **SSR**
  (RN-05) + **Server Action** (`criarPedido` também não o recusa — a mesma função pura decide nos
  dois caminhos, RN-06).
- [ ] **Não ver o produto "de cardápio" cuja temporada acabou** — ele não é renderizado, e a
  categoria que ficou vazia não vira cabeçalho órfão. Garantido em: **SSR** (RN-13, a projeção omite)
  + **RLS** como defesa em profundidade contra o rascunho (`produtos_leitura_publica`, §Segurança).
  **O cliente nunca recebe o objeto**, então não há nada para reverter no browser.
- [ ] **Não ver produto `oculto`, dentro ou fora de janela** — comportamento atual, inalterado.
  Garantido em: **RLS** (`produtos_leitura_publica`, `oculto = false`) + o filtro
  `.eq("oculto", false)` de `buscarProdutosPublicos` como defesa em profundidade.
- [ ] **Ver o mesmo estado no resultado da busca** — o produto fora da janela continua marcado e não
  comprável quando aparece filtrado. Garantido em: **SSR** (o filtro do cliente é subtrativo e não
  reprojeta nada).
- [ ] **Abrir o modal de um produto fora da janela para ler a descrição, sem conseguir adicionar** —
  Garantido em: **cliente (UX)** para a abertura; **SSR** para o estado; **Server Action** para a
  recusa se o cliente forçar.
- [ ] **Ver o cardápio aberto como seção no topo do catálogo, com o nome que o lojista deu** (D16) —
  e ver a seção sumir sozinha quando ele fecha, sem ninguém publicar nada. Garantido em: **SSR** — a
  abertura é decidida no servidor, no fuso da loja, no instante do request (RN-15). O cliente
  **nunca** decide se um cardápio está aberto, aqui também não.
- [ ] **Achar o mesmo produto na seção do cardápio e na categoria dele** (D16-a) — a Lasanha aparece
  em "Cardápio de Inverno" **e** em "Massas". Garantido em: **SSR** (RN-15) — é a **mesma** referência
  de objeto nos dois lugares, então os dois cards dizem sempre a mesma coisa (RN-16).
- [ ] **Navegar direto para a seção de um cardápio pela pílula do trilho** — as pílulas de destaque
  vêm primeiro, na mesma ordem das seções. Garantido em: **cliente (UX)** (é link âncora nativo, e
  já funciona antes da hidratação) + **SSR** (a âncora, `ancoraCardapio`).
- [ ] **Buscar um produto que está em cardápio aberto e ver UM resultado, não dois** — a busca
  devolve o produto na categoria dele, uma vez, e a contagem do `ResumoBusca` bate.
  Garantido em: **desenho** — a seção de destaque **não está** na lista que `filtrarCatalogo` e
  `contarProdutos` recebem (RN-16). Não é filtro, é ausência.
- [ ] **Adicionar o mesmo produto pelas duas seções e ver uma linha só no carrinho, com quantidade 2**
  — Garantido em: **cliente (UX)** (`useCarrinho().adicionar` já deduplica por chave de linha) +
  **Server Action** (o pedido é recalculado do banco de qualquer forma).

---

### Checkout — `/loja/[slug]/pedido`

**Mundo:** vitrine pública (sem auth)

**Descrição:** um item pode entrar no carrinho às 14:59 e chegar ao checkout às 15:01, com a janela
já fechada. A revisão do carrinho — `revisarCarrinhoAction`, **criada pelo Spec A** — passa a
devolver, por linha, se o item ainda é comprável e por quê. Item fora da janela **bloqueia o envio**
até o cliente revisar; não há "confirmar assim mesmo", porque não existe preço que torne o item
vendável.

É a mesma família de D11 (Spec A, preço sobe ⇒ reconfirmação explícita), um degrau acima: aqui o
item não fica mais caro, ele **sai de venda**.

**D14 acrescenta um caso ao checkout, e é o único lugar onde o produto "sumido" ainda precisa ser
nomeado.** Um produto `visibilidade = 'cardapio'` cuja temporada acabou some da **vitrine**, mas pode
estar no carrinho de alguém que o adicionou antes. A revisão **não pode omiti-lo em silêncio** — ela
o devolve `compravel: false`, `motivoNaoCompravel: "fora_da_janela"` e **sem rótulo de volta** (não há
próxima abertura para prometer), e a UI usa a frase genérica. **Item que a revisão não encontra no
banco é tratado como não comprável, nunca ignorado**: sumir da conta seria alterar o carrinho do
cliente por omissão, e é a classe de erro que o `podeConfirmar` existe para impedir.

**Componentes (todos existentes ou já previstos pelo Spec A):**
- `revisarCarrinhoAction` (`lib/actions/`, **do Spec A**) — **estender**: cada linha do retorno ganha
  `compravel` + `motivoNaoCompravel`, derivados **da mesma** função pura da vitrine (RN-06). Depende
  da issue do Spec A que cria a action.
- `EtapaItens` (`components/vitrine/checkout/EtapaItens.tsx`) — **modificar**: exibe o aviso inline
  por item não comprável e bloqueia o avanço.
- `ResumoValores` (`components/vitrine/checkout/ResumoValores.tsx`) — **modificar**: o subtotal
  exibido desconsidera item bloqueado, e a linha aparece riscada com o motivo.
- `podeConfirmar` (`components/vitrine/checkout/estado.ts`) — **modificar**: ganha a condição
  "nenhum item bloqueado". `design-system.md` §9 é explícito: *toda UI que controla o submit do
  checkout consulta `podeConfirmar` — nunca reimplementa a lógica no componente*.
- `criarPedido` (`lib/actions/pedido.ts`) — **modificar**: mais uma condição no laço de recusa que
  já existe (linhas 173-179).

**Behaviors:**
- [ ] **Ver no checkout que um item saiu do cardápio deste horário**, com o motivo e a instrução de
  remover. Garantido em: **Server Action** (`revisarCarrinhoAction`, a partir do banco e do relógio
  do servidor no fuso da loja) + **cliente (UX)** (a frase).
- [ ] **Não conseguir finalizar com um item fora da janela no carrinho** — Garantido em:
  **cliente (UX)** para o botão (`podeConfirmar`) e **Server Action** para a recusa de verdade. A
  trava do botão é cortesia; a autoridade é a action.
- [ ] **Remover o item bloqueado e finalizar normalmente** — Garantido em: **cliente (UX)** (o
  carrinho é estado local) + **Server Action** (a revisão refeita).
- [ ] **Ter o pedido recusado ao enviar um item fora da janela** (payload forjado, ou corrida de
  segundos entre a revisão e o INSERT). Garantido em: **Server Action + RLS** — `criarPedido`
  recusa o **pedido inteiro**, antes de chamar a RPC, exatamente como já recusa produto
  indisponível/oculto/de outra loja. Ver RN-08.
- [ ] **Ter o pedido recusado quando o produto mudou de cardápio entre o carrinho e o envio** —
  vale o estado do **banco** no momento do envio, nunca o que o carrinho guardava.
  Garantido em: **Server Action** (RN-08).
- [ ] **Ver no checkout o item "de cardápio" que sumiu da vitrine com a temporada** — a linha aparece
  bloqueada, com a frase genérica (não há "volta em"), e o envio fica travado até removê-la.
  Garantido em: **Server Action** (`revisarCarrinhoAction`) + **cliente (UX)** (a frase). O item
  **não** é descartado da revisão só porque não aparece mais na vitrine.

---

### Cardápios do painel — `/painel/cardapios`

**Mundo:** painel (auth obrigatório, sob `(bloqueavel)` — o paywall de assinatura já se aplica)

**Descrição:** lista dos cardápios da loja com o estado **ao vivo** de cada um ("Aberto agora",
"Abre sábado às 11:00", "Expira em 3 dias", "Expirado"), quantos produtos cada um tem, e o botão de
criar. É aqui que mora o aviso de cardápio **expirado ou desligado** que está **escondendo produtos
da vitrine** (RN-12).

> **Com D14 este aviso ficou MAIS importante, não menos.** Na v0.1.0 ele dizia "cardápio expirado
> travando N produtos" e o lojista ainda via os produtos marcados na vitrine. Agora os produtos
> **exclusivos** desse cardápio **sumiram**: o lojista não vê nada na loja dele e não tem como
> descobrir por quê olhando a vitrine. **O painel é o único lugar onde esse estado é observável** —
> e, sem jsdom, ele é especificado como número vindo do servidor (função pura testável), não como
> aviso de componente.

**Componentes:**
- `CardapiosClient` — **criar**. Casca fina sobre `Card`, `Button`, `Switch`, `AlertDialog` do
  shadcn (`components/ui/`, gerado pelo CLI — não editar).
- `BadgeStatus` (`components/vitrine/BadgeStatus.tsx`) — **reuso**. É o único componente que já
  cruza os dois mundos (`design-system.md` §7) e já existe exatamente para dizer estado do sistema
  com **cor de sistema + texto**, nunca cor do tema da loja (§8). O estado do cardápio é da mesma
  família de "Aberto agora"/"Fechado" da loja. Os rótulos/cores exatos são do agente `desenhar`
  (`plan/design-promocoes-e-vigencia.md`).
- `AlertDialog` — **reuso** para a remoção e para o desligamento, deixando claro o efeito
  (`design-system.md` §6: ação destrutiva sempre diz o que será afetado). Com D14 a frase tem
  **dois números**, porque o efeito é diferente para cada metade:
  - *"N produtos **do menu** continuam aparecendo e vendendo normalmente."*
  - *"M produtos são **exclusivos deste cardápio** e vão **sumir da vitrine**."* — no caso da
    **remoção**, a operação é **recusada** enquanto existirem exclusivos (RN-14), e o diálogo oferece
    a saída a um clique: **"converter os M para o menu"**. No caso do **desligamento**, ela é
    permitida (é o gesto legítimo de "guardar o cardápio de inverno até o ano que vem") e os
    exclusivos somem enquanto ele estiver desligado.

**Behaviors:**
- [ ] **Criar um cardápio** (nome + modo de vigência). Garantido em: **Server Action + RLS**
  (`cardapios_escrita_propria`) + **zod** (`schemaCardapio`) + **CHECK** no banco.
- [ ] **Renomear um cardápio.** Garantido em: **Server Action + RLS**.
- [ ] **Ligar/desligar um cardápio sem perder a configuração** — desligado, o cardápio deixa de
  participar de qualquer decisão: os produtos **do menu** dele seguem vendendo (nada muda) e os
  produtos **de cardápio** dele **somem da vitrine**, porque não sobra abertura conhecida. Os dias,
  horários e prazo continuam salvos e um clique reverte tudo. Garantido em: **Server Action + RLS**
  (a coluna `ativo`) + **RN-03** (a função pura ignora cardápio inativo — a RLS **não** é a
  autoridade aqui, ver §Segurança) + **RN-13** (o desfecho para o produto exclusivo).
- [ ] **Ver, antes de desligar, quantos produtos vão sumir** — o diálogo mostra os dois números
  (do menu × exclusivos). Garantido em: **SSR / Server Action** (preview de UX; a contagem é
  recalculada no servidor, o cliente não a envia).
- [ ] **Remover um cardápio** — os vínculos caem por `ON DELETE CASCADE` e os produtos **do menu**
  voltam a ser só do menu. **A remoção é recusada** enquanto o cardápio tiver produto exclusivo, para
  não deixar produto "de cardápio" sem nenhum cardápio (RN-14). Garantido em: **Server Action**
  (mensagem legível + o atalho de conversão) + **trigger de constraint no banco** (a autoridade —
  vale inclusive sob `service_role`) + **RLS** + **FK**.
- [ ] **Converter para o menu, de uma vez, os produtos exclusivos de um cardápio** — a saída
  oferecida pelo diálogo de remoção. Garantido em: **Server Action + RLS** (`loja_id` de
  `buscarLojaDoDono`; a conversão é `update produtos set visibilidade = 'menu'` restrito aos
  vinculados àquele cardápio).
- [ ] **Ver o estado ao vivo de cada cardápio** ("Aberto agora", "Volta sábado", "Expirado").
  Garantido em: **SSR** (preview de UX — o número é recalculado no servidor a cada render; nada
  depende dele).
- [ ] **Entender que "Aberto agora" significa uma seção visível na vitrine** (D16) — o estado
  "Aberto agora" ganha a frase que diz o efeito: *"aparecendo como seção no topo da sua loja"*. É o
  mesmo princípio de RN-12 ao contrário: o lojista precisa saber o que o cliente está vendo.
  Garantido em: **SSR** (preview de UX).
- [ ] **Ser avisado de cardápio expirado ou desligado que está escondendo produtos da vitrine** —
  com o número de produtos exclusivos sumidos e as duas saídas a um clique. Garantido em: **SSR**
  (preview de UX; ver RN-12).
- [ ] **Não conseguir ver nem tocar em cardápio de outra loja**, nem por `id` forjado no payload.
  Garantido em: **RLS** (`cardapios_escrita_propria`, `cardapios_leitura_propria`) +
  **Server Action** (`loja_id` derivado de `buscarLojaDoDono`, **nunca** do payload — padrão já usado
  em `produto.ts` e `cupom.ts`).

---

### Detalhe do cardápio — `/painel/cardapios/[cardapioId]`

**Mundo:** painel (auth obrigatório, sob `(bloqueavel)`)

**Descrição:** o form de vigência e a lista de produtos do cardápio. **Esta é a tela mais
subestimada do trabalho inteiro** e não cabe numa fatia só — são três (§Fatias de implementação):
o form recorrente (dias da semana + dias do mês + faixa de horário), o form de prazo fixo (presets
+ customizado) e o preview no fuso da loja que traduz os dois em português.

Rota própria, e não modal dentro de `/painel/cardapios`, por causa do tamanho do form: um `Dialog`
com sete controles e um preview em 360px de largura é o tipo de tela que nasce quebrada no mobile
(`design-system.md` §1, mobile-first vale também quando o lojista usa o celular).

**Componentes:**
- `FormVigencia` — **criar**. `react-hook-form` + **o mesmo `schemaCardapio`** usado pela Server
  Action (`lib/validacoes/cardapio.ts`), validação isomórfica, como já é o padrão
  (`design-system.md` §6). **Nada de schema paralelo.**
- `Form`, `Input`, `Select`, `RadioGroup`, `Switch`, `Checkbox`, `Button` — **reuso** de
  `components/ui/`.
- `PreviewVigencia` — **criar**, apresentação pura: consome `descreverVigencia` (RN-07), a **mesma**
  função pura que monta o selo da vitrine. Uma frase, uma implementação.
- `SeletorProdutosDoCardapio` — **criar**: lista de produtos da loja agrupada por categoria, com
  checkbox por produto e "selecionar categoria inteira". Compartilha a mesma Server Action da ação
  em lote de `/painel/produtos` (RN-09) — não duplica. Cada produto já dentro do cardápio mostra se é
  **do menu** ou **exclusivo** (`Badge` de `components/ui/`, texto + cor de sistema), porque é essa
  diferença que decide o que acontece com ele quando o cardápio fechar.

**Behaviors:**
- [ ] **Escolher o modo de vigência** (recorrente ou prazo fixo) — trocar de modo limpa os campos do
  outro modo. Garantido em: **cliente (UX)** para a troca; **zod + CHECK** para a disjunção (RN-01:
  campos do modo oposto têm de ser NULL no banco).
- [ ] **Marcar dias da semana** ("sáb" e "dom"). Garantido em: **Server Action + zod + CHECK**
  (domínio 0..6).
- [ ] **Marcar dias do mês** ("1" e "15"). Garantido em: **Server Action + zod + CHECK**
  (domínio 1..31).
- [ ] **Definir a faixa de horário diária** (11:00 → 15:00). Garantido em: **Server Action + zod +
  CHECK** (par tudo-ou-nada, `hora_fim > hora_inicio`, sem cruzar a meia-noite — RN-02).
- [ ] **Escolher um preset de prazo fixo** (diário / semanal / mensal) e ver o fim calculado.
  Garantido em: **cliente (UX)** para o preview e **Server Action** para o valor gravado — o `fim`
  é **recalculado no servidor** a partir de `inicio + preset`, nunca aceito do cliente (RN-04).
- [ ] **Escolher prazo customizado** (início e fim digitados). Garantido em: **Server Action**
  (conversão do horário local da loja para instante) + **CHECK** (`fim > inicio`).
- [ ] **Ler o preview em português, no fuso da loja** ("Só aos sábados e domingos, das 11:00 às
  15:00"). Garantido em: **cliente (UX)** — mesma função pura do servidor, `agora` e `timezone`
  injetados (isomórfico, como `calcularFrete`).
- [ ] **Adicionar produtos ao cardápio** (seleção múltipla ou categoria inteira). Garantido em:
  **Server Action + RLS + FK composta** (RN-09, RN-10).
- [ ] **Tirar produtos do cardápio.** Garantido em: **Server Action + RLS** + **trigger** (tirar o
  **último** cardápio de um produto exclusivo é recusado — RN-14; a saída oferecida é convertê-lo
  para o menu no mesmo gesto).
- [ ] **Ver, por produto do cardápio, se ele é do menu ou exclusivo.** Garantido em: **SSR**
  (preview de UX).
- [ ] **Não conseguir salvar vigência incoerente** (prazo fixo sem fim, recorrente sem nenhum eixo,
  horário invertido). Garantido em: **zod** (primeira barreira, mensagem legível) + **CHECK**
  (backstop no banco; `23514` vira mensagem genérica na UI e detalhe no log — `seguranca.md` §14).

---

### Produtos do painel — `/painel/produtos`

**Mundo:** painel (auth obrigatório, sob `(bloqueavel)`)

**Descrição:** a tela de produtos ganha um **modo de seleção**: checkbox por produto, "selecionar
categoria inteira", e uma barra de ação com "Aplicar cardápio" / "Tirar de cardápio" / **"Marcar como
exclusivo de cardápio"** / **"Devolver ao menu"**. É a ação em lote de D2, mais o campo de D14. A
lista também passa a indicar, por produto, de quais cardápios ele participa, se é do menu ou
exclusivo, e se está fora da janela — ou **sumido** — agora.

**O campo `visibilidade` mora em dois lugares, com a mesma Server Action por trás:** o form de
produto (`FormProduto`, um `RadioGroup` de duas opções) e esta barra de ação em lote. A cópia das
duas opções é a que o lojista consegue verificar sozinho, não jargão de schema:
*"Aparece sempre no meu menu"* × *"Só aparece quando um cardápio dele estiver aberto"*.

`ProdutosClient.tsx` já agrupa produtos por categoria (`agruparPorCategoria`, linha 166) e já tem um
"modo" que troca a linha inteira (`modoReordenar`, linha 304, issue 175) — o modo de seleção segue o
mesmo desenho: estado no pai, linha troca de aparência, uma barra de ação aparece.

**Componentes:**
- `ProdutosClient` (`app/(painel)/painel/(bloqueavel)/produtos/ProdutosClient.tsx`) — **modificar**:
  estado `modoSelecao` + `Set<produtoId>` selecionado, no pai.
- `Checkbox`, `Button`, `Select`, `RadioGroup`, `Badge` — **reuso** de `components/ui/`.
- `FormProduto` (`components/painel/FormProduto.tsx`) — **modificar**: um `RadioGroup` de duas
  opções para `visibilidade`, ao lado dos campos que já existem, com o **mesmo** `schemaProduto`
  (`lib/validacoes/produto.ts`) usado pela Server Action — validação isomórfica, **sem schema
  paralelo** (`design-system.md` §6). `zod`: `z.enum(["menu","cardapio"]).default("menu")`, o mesmo
  default da coluna, para que um form antigo ou um payload sem o campo continuem produzindo o
  comportamento de hoje.
- **Alvo de toque:** `min-h-[44px] min-w-[44px]` **literal**, nunca `min-h-11` nem
  `size="icon-sm"` — a base de fonte do projeto é 120% e as classes semânticas do Tailwind não
  batem 44px (`design-system.md` §5). E vale a lição já registrada lá: **linha que ganha um prefixo
  (checkbox) soma ~44px de chrome e em 360px sobra pouco para o nome — a régua é comprimir, não
  estourar.**

**Behaviors:**
- [ ] **Entrar e sair do modo de seleção.** Garantido em: **cliente (UX)**.
- [ ] **Selecionar vários produtos.** Garantido em: **cliente (UX)** — a seleção é intenção, não
  permissão.
- [ ] **Selecionar uma categoria inteira.** Garantido em: **cliente (UX)** para a marcação;
  **Server Action + RPC** para a aplicação (RN-10: a expansão da categoria acontece **dentro** da
  transação, não em JS).
- [ ] **Aplicar um cardápio aos produtos selecionados.** Garantido em: **Server Action + RLS + FK
  composta** — ver RN-09. O `loja_id` vem de `buscarLojaDoDono`; um `produto_id` ou `cardapio_id` de
  outra loja é impossível de gravar (`23503`) e derruba a operação inteira.
- [ ] **Tirar um cardápio dos produtos selecionados.** Garantido em: **Server Action + RLS**.
- [ ] **Ver de quais cardápios cada produto participa, se é do menu ou exclusivo, e se está fora da
  janela ou sumido agora.** Garantido em: **SSR** (preview de UX).
- [ ] **Marcar um produto (ou vários) como exclusivo de cardápio.** Garantido em: **Server Action +
  RLS + zod** + **trigger** — marcar como exclusivo um produto que não está em nenhum cardápio é
  **recusado** (RN-14); a Server Action devolve a mensagem legível e o trigger é o backstop.
- [ ] **Devolver ao menu um produto exclusivo.** Sempre permitido — é a saída de qualquer estado
  preso. Garantido em: **Server Action + RLS**.
- [ ] **Ver, antes de confirmar, quantos e quais produtos a ação vai atingir** — o diálogo de
  confirmação só existe depois que a prévia chega do servidor, e o número vai dentro do rótulo do
  botão ("Aplicar a 12 produtos"). Garantido em: **Server Action** (`preverLoteAction`: contagem e
  nomes resolvidos sob RLS a partir dos ids selecionados; o cliente não envia número nenhum e não
  conta nada) — RN-09-a.
- [ ] **Não conseguir aplicar cardápio a produto de outra loja**, nem mandando o id no meio da lista.
  Garantido em: **FK composta (banco) + RLS + Server Action** — RN-09. **Fatia crítica.**
- [ ] **Não conseguir mudar a `visibilidade` de produto de outra loja.** Garantido em: **RLS**
  (`produtos_escrita_propria`) + **Server Action** (`loja_id` de `buscarLojaDoDono`, nunca do
  payload).

---

## Modelos de Dados

Referência: `references/schema.md`. **Duas tabelas novas** ⇒ política RLS obrigatória antes de
produção (`seguranca.md` §2), mais um índice único redundante em `produtos` para habilitar a FK
composta, mais **uma coluna nova em `produtos` (`visibilidade`, D14)** com o trigger que torna o
estado órfão impossível e um ajuste na policy pública de `produtos`.

**`public.vitrine_lojas` NÃO é recriada por esta spec.** `timezone` já está na projeção pública e é
tudo de que a vigência precisa. Recriar a view é o risco principal do Spec A (`drop` + `create`
reescreve colunas e privilégios); esta fatia não encosta nele.

### `produtos` / `cardapios` — chaves compostas (migration 1)

```sql
-- Redundante com a PK (id já é único), portanto sempre satisfeito pelas linhas
-- existentes: é só o alvo da FK composta de cardapio_produtos.
alter table public.produtos
  add constraint produtos_id_loja_unico unique (id, loja_id);
```

### `cardapios` (migration 2)

```sql
create table public.cardapios (
  id            uuid primary key default gen_random_uuid(),
  loja_id       uuid not null references public.lojas(id) on delete cascade,
  nome          text not null,
  ativo         boolean not null default true,
  -- D16: é a chave de ordenação das SEÇÕES DE DESTAQUE na vitrine (RN-15). A
  -- Server Action de criação grava max(ordem)+1 da loja → cardápio novo entra
  -- no fim. A UI de reordenar fica fora da v1 (§Fora do Escopo).
  ordem         int not null default 0,

  modo          text not null check (modo in ('recorrente','prazo_fixo')),

  -- RECORRENTE (D3-a). NULL/vazio em um eixo = "sem restrição por esse eixo".
  dias_semana   smallint[],   -- 0=dom .. 6=sab, mesma convenção de partesNoFuso
  dias_mes      smallint[],   -- 1..31
  hora_inicio   time,         -- INCLUSIVO
  hora_fim      time,         -- EXCLUSIVO

  -- PRAZO FIXO (D3-b)
  prazo_inicio  timestamptz,  -- INCLUSIVO
  prazo_fim     timestamptz,  -- EXCLUSIVO
  prazo_preset  text check (prazo_preset is null
                            or prazo_preset in ('diario','semanal','mensal','customizado')),

  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),

  constraint cardapios_id_loja_unico unique (id, loja_id),

  -- Disjunção por modo: os campos do OUTRO modo têm de ser NULL.
  constraint cardapios_recorrente_exclusivo check (
    modo <> 'recorrente'
    or (prazo_inicio is null and prazo_fim is null and prazo_preset is null)
  ),
  constraint cardapios_prazo_exclusivo check (
    modo <> 'prazo_fixo'
    or (dias_semana is null and dias_mes is null and hora_inicio is null and hora_fim is null)
  ),

  -- Recorrente precisa de PELO MENOS UM eixo: sem isso o cardápio não restringe
  -- nada e vira um estado confuso que o lojista não consegue diagnosticar.
  constraint cardapios_recorrente_tem_eixo check (
    modo <> 'recorrente' or (
      coalesce(cardinality(dias_semana), 0) > 0
      or coalesce(cardinality(dias_mes), 0) > 0
      or hora_inicio is not null
    )
  ),

  -- Faixa de horário: par tudo-ou-nada, e NÃO cruza a meia-noite (ver RN-02).
  constraint cardapios_hora_par   check ((hora_inicio is null) = (hora_fim is null)),
  constraint cardapios_hora_ordem check (hora_inicio is null or hora_fim > hora_inicio),

  -- Domínio dos dias (array literal: nada de generate_series dentro de CHECK).
  constraint cardapios_dias_semana_dominio check (
    dias_semana is null or dias_semana <@ array[0,1,2,3,4,5,6]::smallint[]
  ),
  constraint cardapios_dias_mes_dominio check (
    dias_mes is null or dias_mes <@ array[
      1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,
      17,18,19,20,21,22,23,24,25,26,27,28,29,30,31]::smallint[]
  ),

  -- Prazo fixo: par obrigatório e ordenado.
  constraint cardapios_prazo_obrigatorio check (
    modo <> 'prazo_fixo'
    or (prazo_inicio is not null and prazo_fim is not null and prazo_preset is not null)
  ),
  constraint cardapios_prazo_ordem check (
    prazo_inicio is null or prazo_fim is null or prazo_fim > prazo_inicio
  )
);

create index on public.cardapios (loja_id, ativo);
```

**Por que colunas + CHECK, e não jsonb como `lojas.horarios`.** `lojas.horarios` é jsonb porque é um
registro fixo de 7 chaves com **a mesma forma em todas**, escrito inteiro por um form só, nunca
consultado por predicado, e há exatamente um por loja. A vigência de cardápio é o oposto em três
pontos que decidem:

1. **A forma é disjunta por `modo`** — recorrente e prazo fixo não compartilham um campo sequer. Um
   jsonb não tem como impedir um cardápio `prazo_fixo` com `dias_semana` dentro; os CHECKs acima
   impedem.
2. **O lojista tem escrita direta nessa linha** (`cardapios_escrita_propria`, via PostgREST com a
   anon key do bundle). Um jsonb malformado gravado fora do form produziria uma janela que a função
   pura não sabe avaliar — e "não sei avaliar" numa restrição tende a virar fail-**open**. Com
   colunas e CHECK, a linha incoerente **não existe**. `seguranca.md`: o banco é a última linha de
   defesa, e `schema.md` §5 já fixa a convenção (CHECK inline, nunca `CREATE TYPE`).
3. **O erro é diagnosticável.** `23514` com nome de constraint diz qual regra caiu; um jsonb torto
   só aparece como comportamento errado na vitrine, semanas depois.

O que esta escolha **ganha de graça** sobre o precedente: `lojas.horarios` não tem defesa contra
janela que cruza a meia-noite (`abre 22:00, fecha 02:00` nunca abre, em silêncio —
`lojaAberta.ts:78`). Aqui o CHECK `hora_fim > hora_inicio` torna essa linha impossível de gravar, e
o caso vira erro explícito no form em vez de bug mudo (§Fora do Escopo registra a janela noturna
como não suportada, de propósito).

### `cardapio_produtos` (migration 3)

```sql
create table public.cardapio_produtos (
  id          uuid primary key default gen_random_uuid(),
  loja_id     uuid not null references public.lojas(id) on delete cascade,
  cardapio_id uuid not null,
  produto_id  uuid not null,
  criado_em   timestamptz not null default now(),

  -- FKs COMPOSTAS: a linha só existe se cardápio e produto forem da MESMA loja
  -- que a própria linha declara. É isto que torna o vetor cross-tenant da ação
  -- em lote IMPOSSÍVEL, em vez de meramente checado (ver RN-09).
  constraint cardapio_produtos_cardapio_fk
    foreign key (cardapio_id, loja_id)
    references public.cardapios (id, loja_id) on delete cascade,
  constraint cardapio_produtos_produto_fk
    foreign key (produto_id, loja_id)
    references public.produtos (id, loja_id) on delete cascade,

  unique (cardapio_id, produto_id)
);

create index on public.cardapio_produtos (loja_id, cardapio_id);
create index on public.cardapio_produtos (produto_id);
```

`loja_id` redundante na tabela de junção é a convenção do schema (mesmo desenho de
`categoria_produto_opcionais`), e aqui ele deixa de ser só conveniência de RLS: é a **coluna que as
duas FKs compostas amarram**. Um vínculo misturando lojas viola `23503` e a transação cai inteira.

> **Nota de melhoria deliberada, não de cópia.** `categoria_produto_opcionais` não tem FK composta —
> lá a posse cruzada é checada na Server Action (`categoriaPertenceALoja`,
> `src/lib/actions/produto.ts:38`), por disciplina. Aqui a checagem é **estrutural**, pelos motivos
> de §Segurança: a ação em lote recebe **uma lista de ids vinda do cliente**, que é o vetor clássico
> de IDOR, e o repo não tem como travar disciplina por teste de componente. O padrão novo é
> estritamente mais forte e não invalida o antigo.

### `criar_pedido` — **não muda**

A RPC não ganha nada. A recusa de item fora da janela acontece **antes** dela, na Server Action, no
mesmo laço que já recusa produto indisponível/oculto/de outra loja. A RPC continua transacional, não
é oráculo de regra (`seguranca.md` §10). Nenhuma migration de RPC nesta fatia, exceto a de
`aplicar_cardapio_em_categoria` abaixo.

### `public.aplicar_cardapio_em_categoria` (migration 4)

Única RPC nova. Existe por um motivo estreito: "aplicar a uma **categoria inteira**" é um
`insert ... select`, que o PostgREST não faz. Fazer o `select` em JS e mandar a lista de volta seria
**TOCTOU** — produto criado na categoria entre a leitura e a escrita ficaria de fora, produto movido
para fora entraria. Dentro da transação, não.

```sql
create or replace function public.aplicar_cardapio_em_categoria(
  p_loja_id     uuid,
  p_cardapio_id uuid,
  p_categoria_id uuid
) returns integer
language plpgsql
security invoker                 -- só o lojista escreve; a RLS é a autoridade (ver §Segurança)
set search_path = public
as $$
declare v_inseridos int;
begin
  -- T1 — parâmetros presentes (filtro mais barato).
  if p_loja_id is null or p_cardapio_id is null or p_categoria_id is null then
    raise exception 'aplicar_cardapio_em_categoria: parametro nulo';
  end if;

  -- T2 — AUTORIDADE antes de qualquer contagem. Sob invoker, lojas_leitura_propria
  -- já limita esta linha ao dono; o predicado explícito é a segunda camada.
  if not exists (
    select 1 from public.lojas
     where id = p_loja_id and dono_id = auth.uid()
  ) then
    raise exception 'aplicar_cardapio_em_categoria: loja alheia';
  end if;

  -- T3 — COERÊNCIA do par (loja, cardapio) e (loja, categoria). Tem de vir DEPOIS
  -- de T2: antes, viraria oráculo de existência em loja alheia (seguranca.md §2).
  if not exists (
    select 1 from public.cardapios where id = p_cardapio_id and loja_id = p_loja_id
  ) then
    raise exception 'aplicar_cardapio_em_categoria: cardapio fora da loja';
  end if;
  if not exists (
    select 1 from public.categorias where id = p_categoria_id and loja_id = p_loja_id
  ) then
    raise exception 'aplicar_cardapio_em_categoria: categoria fora da loja';
  end if;

  -- T4 — escreve só o vínculo, derivado do SELECT no servidor. Nenhum valor do
  -- cliente entra numa coluna. Reaplicar é idempotente.
  insert into public.cardapio_produtos (loja_id, cardapio_id, produto_id)
  select p_loja_id, p_cardapio_id, p.id
    from public.produtos p
   where p.loja_id = p_loja_id
     and p.categoria_id = p_categoria_id
  on conflict (cardapio_id, produto_id) do nothing;
  get diagnostics v_inseridos = row_count;

  return v_inseridos;
end;
$$;

-- O Postgres concede EXECUTE a PUBLIC por padrão em função nova, e o projeto NÃO
-- tem `alter default privileges ... on functions` (seguranca.md §2). Sem o revoke,
-- anon executaria com a chave do bundle público.
revoke all on function public.aplicar_cardapio_em_categoria(uuid, uuid, uuid) from public, anon;
grant execute on function public.aplicar_cardapio_em_categoria(uuid, uuid, uuid) to authenticated;
```

**`authenticated` e não `service_role`, de propósito.** Não há via admin na v1. Sob `service_role`,
`auth.uid()` é NULL e T2 falha — a função **fail-closes** para a via de serviço, que é o
comportamento correto enquanto essa via não existe. O dia em que o hub admin precisar gerenciar
cardápio, a conversão é a documentada em `seguranca.md` §2: `SECURITY DEFINER` + T1–T7 no corpo,
`coalesce(auth.role(), '')` na conjunção de autoridade e `set search_path = public, pg_temp`.
**Não** basta acrescentar o grant.

**Aplicar a "Sem categoria"** (produtos com `categoria_id is null`) usa o caminho de seleção
explícita, não esta RPC — `p_categoria_id` nulo é recusado por T1, de propósito, para não haver dois
significados para o mesmo parâmetro.

### `produtos.visibilidade` — a coluna de D14 (migration 5)

```sql
-- EXPAND PURO, SEM BACKFILL. O default 'menu' é constante e não-volátil: no
-- Postgres 11+ isso NÃO reescreve a tabela e NÃO exige UPDATE nenhum. Toda linha
-- que já existe passa a ser 'menu', que É o comportamento de hoje — nenhum
-- produto muda de aparência por causa desta migration. É a propriedade que
-- barateia a fase de migration (plan/loop-... §5) e o motivo de 'menu' ser o
-- default, e não 'cardapio'.
alter table public.produtos
  add column visibilidade text not null default 'menu'
  check (visibilidade in ('menu', 'cardapio'));

-- Consultado sempre junto com loja_id (o painel conta exclusivos por loja).
create index on public.produtos (loja_id, visibilidade);
```

**Texto + CHECK, e não boolean.** Mesma razão de `cardapios.modo`: o nome do estado aparece no erro
(`23514` diz `produtos_visibilidade_check`), a leitura do SQL é a leitura do negócio, e um terceiro
valor no futuro ("só no balcão") é `alter constraint`, não migração de semântica de `true`/`false`.
Convenção já fixada em `schema.md` §5: CHECK inline, nunca `CREATE TYPE`.

### O estado órfão é impossível: trigger de constraint (migration 5, mesma transação)

**O estado a matar:** produto `visibilidade = 'cardapio'` **sem nenhum vínculo** em
`cardapio_produtos`. Ele some da vitrine e **não há nada no painel que explique por quê** — não
aparece em cardápio nenhum, porque não está em nenhum. É o estado que o lojista não consegue
diagnosticar e do qual só sai por acidente.

**Por que não é CHECK, e por que não é só a Server Action:**

- **CHECK não alcança outra tabela.** A condição é "existe linha em `cardapio_produtos`", e CHECK é
  por linha, na própria tabela.
- **A Server Action sozinha não cobre o caminho que cria o órfão sem passar por ela.** O vínculo cai
  por `ON DELETE CASCADE` quando o lojista **remove um cardápio** ou **apaga um produto**; a cascata
  acontece **no banco**, depois que a action já decidiu. E o repo **não tem jsdom**: proteção que
  depende de alguém lembrar de rechecar não é travável por teste (mesmo princípio do parâmetro
  obrigatório de `projetarProdutoVitrine`, e a lição já registrada no projeto: *não testável? torne
  impossível*).

**A trava escolhida: `CONSTRAINT TRIGGER ... DEFERRABLE INITIALLY DEFERRED` nas duas pontas.** Ele é
avaliado **no COMMIT**, não a cada linha — que é exatamente o que uma relação obrigatória 1..N exige
e o que o Postgres não sabe declarar sozinho. Consequências que só o modo deferido dá:

- criar o produto exclusivo **e** vinculá-lo na mesma transação passa (a ordem interna não importa);
- trocar um vínculo por outro passa (o "sem vínculo" existe só no meio da transação);
- a **cascata** de remover um cardápio é pega no fim, e **derruba a transação inteira** — nada é
  removido pela metade;
- apagar o **produto** passa: no COMMIT ele não existe mais, e o predicado começa por ele.

```sql
create or replace function public.checar_produto_exclusivo_tem_cardapio()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare v_produto uuid;
begin
  v_produto := coalesce(new.produto_id, old.produto_id);  -- serve às duas tabelas

  -- Começa pelo produto: se ele não existe mais (DELETE em produtos), não há
  -- invariante a defender. Ordem importa — o contrário levantaria erro ao apagar.
  if exists (
    select 1 from public.produtos
     where id = v_produto and visibilidade = 'cardapio'
  ) and not exists (
    select 1 from public.cardapio_produtos where produto_id = v_produto
  ) then
    raise exception
      'produto exclusivo sem cardapio: %', v_produto
      using errcode = 'integrity_constraint_violation';
  end if;

  return null;   -- AFTER trigger: o retorno é ignorado
end;
$$;

-- Ponta 1: o produto vira 'cardapio' (INSERT ou UPDATE da coluna).
create constraint trigger produtos_exclusivo_tem_cardapio
  after insert or update of visibilidade on public.produtos
  deferrable initially deferred
  for each row when (new.visibilidade = 'cardapio')
  execute function public.checar_produto_exclusivo_tem_cardapio();

-- Ponta 2: o vínculo some (DELETE direto, ou CASCADE de cardapios/produtos).
create constraint trigger cardapio_produtos_exclusivo_tem_cardapio
  after delete on public.cardapio_produtos
  deferrable initially deferred
  for each row
  execute function public.checar_produto_exclusivo_tem_cardapio();
```

- **Vale para `service_role` também.** Trigger não é RLS: `BYPASSRLS` não o desliga. É a diferença
  que importa aqui, porque o caminho autoritativo do pedido roda sob `service_role` (§Segurança).
- **A função pura não precisa tratar o caso.** `cardapiosDoProduto` vazio com
  `visibilidade = 'cardapio'` continua tendo um desfecho definido em RN-13 (o produto some), então o
  trigger não é a única defesa contra um comportamento indefinido — ele é a defesa contra o lojista
  **chegar** a esse estado sem entender.
- **A Server Action continua sendo a primeira barreira**, com mensagem legível
  (*"Este produto só aparece quando um cardápio dele está aberto — escolha pelo menos um cardápio, ou
  devolva-o ao menu."*). O trigger é o backstop, e o `23514`/`raise` vira mensagem genérica na UI com
  o detalhe no log (§14). **Mesma divisão de zod × CHECK que a spec já usa em toda parte.**

### `produtos_leitura_publica` — ajuste da policy existente (migration 6)

O produto exclusivo que some da vitrine ainda seria **legível por `anon`** via PostgREST com a anon
key do bundle. Para o produto de temporada encerrada isso é irrelevante (ele já esteve público); para
o **rascunho** — "Cardápio de Natal", criado em setembro, ainda desligado — é a mesma preocupação de
estratégia comercial que já faz a policy de `cardapios` filtrar `ativo = true`.

Predicado atual, literal, de `20260621099000_produtos_oculto_rls_publica.sql:34-39`:
`oculto = false and public.loja_esta_ativa(produtos.loja_id)`. Ele é **preservado inteiro**; só entra
um `and` novo:

```sql
drop policy "produtos_leitura_publica" on public.produtos;
create policy "produtos_leitura_publica" on public.produtos for select
  using (
    oculto = false
    and public.loja_esta_ativa(produtos.loja_id)
    and (
      visibilidade = 'menu'                      -- curto-circuito: TODO o catálogo de hoje
      or exists (
        select 1
          from public.cardapio_produtos cp
          join public.cardapios c
            on c.id = cp.cardapio_id
         where cp.produto_id = produtos.id
           and c.ativo = true
      )
    )
  );
```

> ⚠️ **Esta é a única alteração de policy existente da spec, e o `drop` + `create` é a operação de
> maior risco da fatia.** Três travas: (1) o predicado atual é **preservado literalmente** e o
> disjunto novo é **acrescentado** — a policy nova é diffada contra
> `20260621099000_produtos_oculto_rls_publica.sql`, nunca reescrita de memória; (2) `visibilidade = 'menu'` é curto-circuito para **100% das linhas
> existentes** depois da migration 5, então o catálogo de hoje é bit a bit idêntico — e isso é
> **asserção de teste**, não argumento; (3) o `EXISTS` é sobre `cardapio_produtos (produto_id)`, que
> já tem índice.
>
> **Ela não é a autoridade da janela, e não tenta ser.** A policy filtra por *"tem algum cardápio
> ligado"*, não por *"está aberto agora"*: replicar a aritmética de dia/hora/fuso em SQL seria uma
> segunda implementação da regra (mandato 2) e a primeira a divergir. A janela é decidida **uma vez**,
> na função pura (RN-06). A policy é defesa em profundidade contra vazamento de rascunho — nada mais.

---

## Regras de Negócio

> Legenda da camada: **cliente (preview)** = estética, nunca autoritativo · **SSR** = decidido no
> servidor durante o render · **Server Action** = recalculado do banco · **RLS** = isolamento por
> linha · **FK/CHECK** = impossível por construção no banco · **zod** = validação isomórfica.

### Vigência

**RN-01 — Um cardápio tem exatamente um modo de vigência (D3).** `recorrente` ou `prazo_fixo`,
nunca os dois, nunca nenhum. Os campos do modo oposto são NULL.
→ Camada: **zod** + **CHECK** (`cardapios_recorrente_exclusivo`, `cardapios_prazo_exclusivo`).

**RN-02 — Vigência RECORRENTE (D3-a).** O cardápio está aberto no instante `agora` quando, e só
quando, as duas condições valem **no fuso da loja** (`lojas.timezone`):

```
diaOk   = (dias_semana vazio E dias_mes vazio)
            ? true
            : (dias_semana contém diaIndex)  OU  (dias_mes contém diaDoMes)     ← OU, regra FECHADA
horaOk  = (hora_inicio é NULL) ? true : (minutos >= hora_inicio E minutos < hora_fim)
aberto  = diaOk E horaOk
```

> **O `OU` entre os dois eixos de dia é regra fechada** (resposta do dono do produto, 2026-09-20 —
> era a P1 da v0.1.0). **Basta uma das regras bater.** O caso que separa as leituras:
> `dias_semana = {sáb, dom}` + `dias_mes = {1, 15}`, numa **quarta-feira, dia 15** ⇒ **ABERTO**.
> A leitura `E` (interseção) daria fechado — abriria só nos sábados/domingos que caíssem em dia 1 ou
> 15, algo como duas vezes por ano, e é o mesmo defeito silencioso que fez a interseção **entre
> cardápios** ser recusada em RN-05. Os dois eixos **acrescentam** dias; a faixa de horário filtra
> **dentro** dos dias escolhidos (por isso `E` entre `diaOk` e `horaOk`, e `OU` dentro de `diaOk`).

- **Eixo vazio = sem restrição por esse eixo**, não "nenhum dia". Um cardápio com só faixa de
  horário abre todo dia nesse horário; um com só dias da semana abre o dia inteiro nesses dias. Este
  é o ponto em que uma implementação ingênua erra (interseção com conjunto vazio ⇒ nunca abre).
- **Mas os três eixos vazios ao mesmo tempo é estado PROIBIDO, e não pode ser gravado** (fechado em
  2026-09-20, junto com D14). Um cardápio recorrente sem dia da semana, sem dia do mês e sem horário
  não restringe nada: ele abre sempre, e o lojista que o criou achando que restringia algo não tem
  como descobrir o erro olhando a vitrine — tudo parece normal. **A trava é o CHECK
  `cardapios_recorrente_tem_eixo`** (§Modelos de Dados), com `zod` como primeira barreira e mensagem
  legível; `coalesce(cardinality(...), 0) > 0` recusa tanto `NULL` quanto o array vazio `'{}'`. A
  Server Action **normaliza array vazio para NULL** antes de gravar, para que "sem restrição" tenha
  uma representação só no banco. Regra pedida no mesmo critério de RN-14: **estado inválido que não
  pode ser gravado**, não validação de formulário — sem jsdom, aviso de form não é trava.
- **Início inclusivo, fim exclusivo.** Mesma convenção de `lojaAberta`
  (`minutos >= abre && minutos < fecha`, `lojaAberta.ts:78`), de `validarUsoCupom` e do prazo de
  desconto que o Spec A fixou (RN-03 do Spec A). **Não divergir.**
- **Repete indefinidamente** até `ativo = false` ou o cardápio ser removido. Não há data de término
  no modo recorrente e não existe job que o desligue.
- **Não cruza a meia-noite.** `hora_fim > hora_inicio` é CHECK; janela noturna está em
  §Fora do Escopo.
- `dias_mes` contendo 31 simplesmente não casa em meses de 30 dias. É a leitura literal e é o que o
  preview tem de dizer ao lojista.

→ Camada: **Server Action / SSR** (a decisão, sempre) + **cliente (preview)** (só o texto do
preview no form). **O browser nunca decide se um cardápio está aberto.**

**RN-03 — Cardápio `ativo = false` não participa de nada.** Ele sai da conta: não abre, não fecha,
não restringe, e não conta como abertura futura. Desligar preserva dias, horários e prazo (mesma
família do `desconto_ativo` do Spec A: desligar não é apagar).

**O que isso significa para cada metade de D14** — e note que **a regra é uma só**, não duas:

| Produto | Único cardápio dele foi desligado | Por quê |
|---|---|---|
| **do menu** | continua aparecendo e vendendo | cardápio nunca o restringiu (RN-05) |
| **de cardápio** | **some da vitrine** | não sobrou nenhuma abertura conhecida (RN-13) — desligado, ninguém sabe se e quando ele volta |

> **Regra FECHADA** (dono do produto, 2026-09-20 — a v0.2.0 tinha adotado a leitura literal de D14
> *"de cardápio — só aparece quando algum cardápio dele está aberto"* e pedido confirmação; foi
> confirmada, com o argumento que a própria spec levantou). É o desfecho seguro: se desligar o
> "Cardápio de Inverno" fizesse a sopa de cebola exclusiva **voltar a vender o ano todo**, desligar
> seria o gesto mais perigoso do painel.
>
> **Consequência de UI, aprovada junto:** o texto do `Switch` e do diálogo de desligamento **não**
> pode dizer "os produtos voltam a vender" — ele mostra **dois números**, N do menu que seguem
> normais × M exclusivos que somem (ver §Páginas, `/painel/cardapios`). O estado é reversível com um
> clique e é **listado no painel** (RN-12).
>
> **E, com D16, desligar tem um segundo efeito visível:** a **seção** daquele cardápio some da
> vitrine (RN-15), porque só cardápio aberto tem seção. Para o produto **do menu** é exatamente o que
> D14 promete — ele perde o destaque e continua vendendo **na categoria dele**, que nunca deixou de
> ser a casa dele.

→ Camada: **função pura** (`cardapioAberto` e `proximaAbertura` ignoram inativo) **e** **RLS** (a
policy pública nem revela cardápio inativo). São duas camadas com o mesmo resultado, e **a função é a
autoritativa**: o caminho de pedido roda sob `service_role`, que tem `BYPASSRLS` — se a regra morasse
só na policy, ela não existiria no caminho que decide o pedido.

**RN-04 — Vigência PRAZO FIXO (D3-b).** `prazo_inicio <= agora < prazo_fim`. **Início inclusivo, fim
exclusivo**, idem RN-02. Os dois são `timestamptz` — **instantes absolutos** (`schema.md` §6). Comparar
instante com instante não precisa de fuso, e introduzir aritmética de fuso nessa comparação criaria
um bug. O fuso da loja entra em **dois lugares de borda**, os mesmos do Spec A (RN-03 de lá):

1. **Escrita** — o lojista digita "10/10 às 00:00" num `datetime-local`; a Server Action converte
   esse horário local **no fuso da loja** para o instante gravado.
2. **Exibição** — "de 10/10 a 16/10" é renderizado no fuso da loja.

**Presets.** `prazo_preset` é **eco de UI**, não autoridade: serve para o form reabrir marcando o
mesmo preset. A autoridade são `prazo_inicio` e `prazo_fim`. Quando o preset é `diario`, `semanal`
ou `mensal`, **a Server Action recalcula `prazo_fim` a partir de `prazo_inicio` + preset e descarta
o `fim` que veio do cliente**. Só `customizado` aceita o `fim` digitado.

```
diario  → inicio + 1 dia
semanal → inicio + 7 dias
mensal  → inicio + 1 mês, com CLAMP de fim de mês
```

> ⚠️ **O "+1 mês" é a armadilha desta regra.** `Date.prototype.setMonth` **transborda**: 31/01 + 1
> mês vira 03/03, não 28/02. A função pura `calcularFimDoPreset(inicio, preset, timezone)` faz o
> clamp para o último dia do mês de destino (mesma semântica do `interval '1 month'` do Postgres),
> e o caso `31/01 → 28/02` (e `31/01/2028 → 29/02`, bissexto) é **caso de aceite obrigatório**. A
> mesma função pura é usada pelo preview no form (isomórfica) — nunca uma segunda fórmula.

→ Camada: **Server Action** (o `fim` gravado) + **CHECK** (`prazo_fim > prazo_inicio`) +
**cliente (preview)** (o preview do form).

**RN-05 — UNIÃO entre cardápios, e a precedência do motivo.**

**Um produto em vários cardápios está dentro da janela se estiver dentro de QUALQUER um deles
(união), não de todos (interseção).**

```
dentroDaJanela = visibilidade === 'menu'                       // D14 — nem entra na conta
              || cardapiosAtivosDoProduto.some(cardapioAberto) // a UNIÃO, inalterada
```

> **A união sobreviveu a D14 sem emenda — o que mudou foi o domínio dela, não o operador.** O `some`
> é literalmente o mesmo da v0.1.0. O que saiu da fórmula foi o disjunto
> `cardapiosAtivosDoProduto.length === 0`, que **nunca foi parte da união**: ele codificava a
> **regra-base de D2** ("produto que não está em nenhum cardápio é sempre visível"). D14 passou a
> expressar essa mesma regra com uma coluna — `visibilidade = 'menu'`, o **default**, que é onde
> todo produto que existe hoje cai. D2 continua valendo, palavra por palavra; só mudou de casa.
>
> **Produto do menu nem entra na conta** (D14, item 3): estar em 1, 5 ou 0 cardápios — abertos,
> fechados ou expirados — não muda nada para ele. **Produto de cardápio** é o único cujo
> `dentroDaJanela` a união decide, e para ele `some([]) === false` é a resposta certa: nenhum
> cardápio ativo aberto ⇒ não é comprável (e, por RN-13, provavelmente nem é renderizado).

Por que união e não interseção — três argumentos, em ordem de peso:

1. **Interseção transforma um gesto comum num produto invisível para sempre, em silêncio.** Feijoada
   no cardápio "Fim de semana" (sáb+dom) e no "Almoço executivo" (seg–sex, 11:00–15:00): a
   interseção é o conjunto **vazio**. O produto nunca mais vende, nenhum erro é levantado, nada na
   tela explica. Não existe mensagem de erro possível para "você acabou de criar uma contradição",
   porque o lojista não fez nada inválido.
2. **União é monotônica: pôr o produto em mais um cardápio nunca reduz a disponibilidade dele.** Essa
   é a propriedade que o lojista consegue raciocinar sem ler documentação — "coloquei no cardápio de
   inverno, então ele também é vendido no inverno".
3. **União é contínua com a regra-base de D2.** Do menu ⇒ sempre vendável; de cardápio com um
   cardápio ⇒ aquela janela; com dois ⇒ as duas janelas. Com interseção há um degrau abrupto entre
   "um" e "dois disjuntos" que nada na UI prepara.

**Precedência do motivo — `"fora_da_janela"` ganha de `"esgotado"`.** O conflito só existe num caso:
produto **fora da janela** E `disponivel = false`. O servidor manda **um** motivo (regra 3 do
contrato do Spec A); a UI nunca compõe dois.

Por que a janela ganha:

- **"Esgotado" seria factualmente errado.** Numa terça-feira, a feijoada do cardápio de fim de
  semana não acabou — ela **não está sendo servida hoje**. Dizer "Esgotado" afirma algo sobre
  estoque que não é verdade e ensina o cliente a voltar amanhã, quando o certo é sábado.
- **É a restrição que sobrevive à outra.** Se o lojista repuser o estoque na terça, o produto
  continua não vendável; se a janela abrir no sábado, o esgotado pode já ter sido resolvido. Mostrar
  a restrição que o cliente não consegue destravar esperando pouco é a informação útil.
- **É a única das duas que sabe dizer quando volta**, que é literalmente o que D4 pede do selo.

**D14 reforçou a precedência em vez de enfraquecê-la, e eliminou o único caso que a atacava.** O
argumento mais frágil dos três era o terceiro: na v0.1.0 existia um caso em que `"fora_da_janela"`
ganhava de `"esgotado"` **sem saber dizer quando volta** — cardápio de prazo fixo já expirado, selo
caindo no genérico *"Indisponível no momento"*, que diz menos do que "Esgotado" diria. Com D14 esse
caso **não renderiza**: o produto de cardápio some (RN-13). Então **todo** produto que chega à
vitrine com motivo `"fora_da_janela"` tem, por construção, uma próxima abertura para anunciar — e o
terceiro argumento passa a ser verdadeiro sem exceção.

**Vale para as duas metades de D14?** A pergunta só existe para uma: produto **do menu** nunca recebe
`"fora_da_janela"` (RN-05 curto-circuita antes), então o único motivo que ele pode ter é
`"esgotado"` — não há conflito a resolver. A precedência decide apenas o produto **de cardápio**
renderizado, e ali ela vale integralmente.

→ Camada: **SSR / Server Action** (a decisão e o motivo) + **cliente (UX)** (a renderização).

### Catálogo e vitrine

**RN-13 (D14) — Uma pergunta só decide se o produto fora da janela aparece marcado ou some:
_existe uma próxima abertura conhecida?_**

Esta é **uma regra, não duas exceções.** A diferença entre "volta sábado" e "sumiu" não é o modo de
vigência do cardápio (recorrente × prazo fixo): é se o servidor **sabe dizer uma data**.

```
cardapiosDoProduto      = vínculos do produto com cardápio ATIVO        (RN-03 intacta)
proximaAberturaProduto  = menor proximaAbertura(c) não-nula             (RN-07)
                          sobre cardapiosDoProduto — null se não houver nenhuma

visivelNaVitrine = visibilidade === 'menu'         // D14: do menu nunca some
                || dentroDaJanela                  // aberto agora
                || proximaAberturaProduto !== null // fechado, mas com volta conhecida
```

Os quatro desfechos, todos do mesmo predicado:

| Situação do produto **de cardápio** | `proximaAbertura` | Vitrine |
|---|---|---|
| algum cardápio **aberto agora** | — | **normal, comprável** |
| recorrente **fechado** (é terça, abre sábado) | sábado 11:00 | **aparece marcado**, *"Só aos sábados e domingos…"* — **D4 intacto** |
| prazo fixo que **ainda não começou** (é maio, começa 01/06) | 01/06 00:00 | **aparece marcado**, com a data de estreia |
| prazo fixo **expirado**, ou único cardápio **desligado** | `null` | **SOME da vitrine** |

**Por que "some" é a resposta certa quando `proximaAbertura` é `null`.** O selo de D4 existe para
dizer **quando volta**. Temporada encerrada não tem o que dizer: o rótulo cairia no genérico
*"Indisponível no momento"*, que é um card ocupando espaço no celular do cliente para informar nada —
e, pior, sugerindo que aquele prato faz parte da loja. Este era o buraco que o `desenhar` achou por
outro caminho, e D14 o fecha pela raiz.

**Produto `visibilidade = 'menu'` nunca é afetado por esta regra**, esteja em quantos cardápios
estiver, abertos, fechados ou expirados. Para ele o predicado é `true` no primeiro disjunto — nem lê
os cardápios.

**Onde o filtro acontece, e onde NÃO acontece:**

- **Acontece na projeção do catálogo** (`projetarCatalogoVitrine`, RN-06): o produto invisível é
  **omitido da lista devolvida**, antes de `agruparCatalogo`, do mesmo jeito que `oculto`. Assim a
  categoria esvaziada some junto, pela regra da issue 177 que já existe.
- **NÃO acontece no caminho autoritativo.** `criarPedido` **recusa**, não omite: para o produto
  sumido, `dentroDaJanela` já é `false`, então a recusa de RN-08 o cobre **sem nenhum branch novo**.
  Omitir um item do pedido seria entregar ao cliente um pedido que ele não montou (mesmo argumento de
  RN-08 e RN-09).
- **NÃO acontece na revisão do carrinho.** `revisarCarrinhoAction` devolve a linha **bloqueada**, com
  motivo e **sem** rótulo de volta. É o único consumidor em que o rótulo genérico continua sendo um
  caso real de negócio, e não só fallback defensivo de render.

→ Camada: **SSR** (a omissão na vitrine) + **Server Action** (a recusa, que é a autoridade) +
**RLS** (defesa em profundidade contra rascunho, §Segurança). **O cliente nunca recebe o objeto do
produto sumido**, então não há estado a forjar no browser.

**RN-15 (D16) — Cardápio aberto é uma SEÇÃO de destaque no topo; a categoria continua sendo a casa
do produto.**

```
secoesDestaque = cardapiosAbertosDaLoja                        // RN-02/RN-04, decidido UMA vez
                   .map(c => ({ tipo: "cardapio", cardapio: c,
                                produtos: produtosVisiveis vinculados a c }))
                   .filter(s => s.produtos.length > 0)         // issue 177, mesma regra
                   .sort(ordemDeterminística)

catalogo = [...secoesDestaque, ...categoriasComProdutos]       // destaque SEMPRE primeiro
```

**Os oito desfechos que D16 obriga a fixar:**

1. **Ordem das seções.** Cardápios abertos **primeiro**, na ordem deles; depois as categorias, na
   ordem atual, sem nenhuma mudança. Entre dois cardápios abertos: **`cardapios.ordem` crescente**
   (a coluna já existe no schema desta spec), desempate por `nome` (`localeCompare` pt-BR) e depois
   `id` — **a mesma escada determinística de RN-07**, porque duas ordenações diferentes de cardápio
   no mesmo produto é como nasce bug de "a seção mudou de lugar sozinha". O lojista controla por
   `ordem`; a Server Action de criação grava `max(ordem) + 1` da loja, de modo que cardápio novo
   entra **no fim**. **UI de arrastar para reordenar fica fora da v1** (§Fora do Escopo) e, quando
   entrar, reusa o padrão de `reordenar_categorias` — não inventa outro.
2. **Produto em dois cardápios abertos:** aparece **nas duas seções de destaque _e_ na categoria
   dele** — três aparições, um produto. Não há corte, não há "só o primeiro cardápio". A regra de
   D16-a é *"a seção não move o produto"*, e ela vale por seção: cada cardápio aberto mostra o que
   tem dentro. União (RN-05) já garantia que ele é comprável; D16-a garante que ele é **encontrável**
   em todos os caminhos que o lojista criou.
3. **Produto `visibilidade = 'cardapio'` (a sopa) aparece na seção do cardápio _e_ na categoria
   dele.** Confirmado, e **não há terceira regra**: D16-a diz "não move", não "duplica só para
   produto do menu". A sopa tem `categoria_id` como qualquer produto e a categoria é a casa dela.
   **A coerência com D14 é exata:** enquanto o cardápio está aberto, a sopa aparece nos dois lugares;
   quando ele fecha com volta conhecida, a **seção some** e a sopa continua na categoria, **marcada**
   com "volta sábado" (D4); quando não há volta, ela some dos **dois** lugares (RN-13). Um produto,
   um estado, dois lugares de render.
4. **Busca:** a seção de destaque **não participa** — ver RN-16, que é onde a trava mora.
5. **Navegação:** cada seção de destaque ganha **pílula própria** no trilho de `NavCategorias`,
   antes das pílulas de categoria, na mesma ordem das seções. Ela é link âncora nativo para o topo
   da seção, como as outras. Sem exceção de comportamento: o scrollspy, o `scroll-margin-top` da
   âncora e o `MINIMO_CATEGORIAS = 3` passam a contar as seções de destaque como quaisquer outras.
6. **`agruparCatalogo` NÃO muda de responsabilidade — D16 é uma função IRMÃ.** `agruparCatalogo`
   agrupa por categoria e é onde mora a regra do grupo vazio (issue 177). `agruparPorCardapio` agrupa
   **os mesmos produtos** por cardápio aberto. São duas visões da mesma lista, não uma generalização
   de uma delas — tentar unificar produziria uma função com dois modos e um parâmetro de tipo, que é
   exatamente o refactor que quebra o teste existente.
   **Critério de aceite, o mesmo que o Spec A usou em `totalDaLinha`: a suíte atual de
   `agruparCatalogo` passa SEM UMA EDIÇÃO.** Se precisou editar, o refactor mudou comportamento e
   está errado — reverter, não ajustar o teste. A única mudança tolerada em `agruparCatalogo` é a
   generalização de tipo já especificada para RN-13 (`<T extends { id; categoria_id }>`), que é
   nula em runtime.
7. **Chave de render e id de DOM:** RN-16.
8. **Custo:** fatias **18** (a função pura + a ordenação) e **19** (o render, a nav e as âncoras),
   nenhuma crítica — ver §Fatias.

**Seção de destaque vazia não é emitida** (`filter(produtos.length > 0)`): cardápio aberto cujos
produtos estão todos `oculto` não vira cabeçalho que não leva a lugar nenhum. É a mesma regra da
issue 177, aplicada de novo em vez de reinventada.

**Nenhuma decisão de valor ou permissão vive aqui.** Seção é apresentação: o conjunto de produtos já
veio do SSR sob `anon` + RLS, o preço é recalculado no checkout e a vigência é a da função pura.
Forjar uma seção no devtools pinta a tela e não compra nada — exatamente o que o comentário de
`NavCategorias.tsx` já diz sobre o trilho.

→ Camada: **SSR** (a decisão de quais cardápios estão abertos, e a montagem das seções) +
**cliente (UX)** (a rolagem e o realce do chip).

**RN-16 (D16) — A duplicata é permitida no catálogo, PROIBIDA na busca e em qualquer contagem, e
impossível de colidir na identidade de render.**

D16-a cria a primeira situação da vitrine em que **um produto aparece duas vezes na mesma tela**.
Três consequências, cada uma travada por desenho:

**(a) Busca e contagem — a trava é ausência, não filtro.** `CatalogoVitrine` recebe `secoesDestaque`
como **prop separada** de `categorias`. `filtrarCatalogo(categorias, termo)` e
`contarProdutos(filtradas)` **continuam recebendo só `categorias`** — não existe chamada em que o
destaque entre. Por isso:

- não há como a Lasanha voltar duas vezes numa lista curta, onde a repetição salta;
- e o `ResumoBusca` — que hoje anuncia `total` em região viva `aria-live` (`CatalogoVitrine`
  linhas 164, 173-185) — **não passa a mentir**. "3 resultados" com 2 produtos na tela é pior que a
  duplicata visual: é erro anunciado a leitor de tela.

O destaque é concatenado **só** no ramo `emBusca === false`, que é o **mesmo booleano** que já decide
trilho × `ResumoBusca` e já desmonta a nav (D2 da issue 202). **Nenhuma condição nova, nenhum estado
novo** — e é por isso que não existe combinação de estado em que apareça chip de destaque sem seção.

> **Por que ausência e não "filtrar o destaque na hora de buscar":** um filtro é uma linha que alguém
> pode esquecer, e **sem jsdom o repo não consegue travá-lo por teste de componente**. Prop separada
> move o erro para o `tsc`, que é o primeiro passo do CI — o mesmo argumento dos parâmetros
> obrigatórios de `projetarProdutoVitrine` e do `resolverEndereco` da issue 160.

**(b) Âncora de seção — namespaces disjuntos, não "uuid não colide".**
`ancoraCategoria(id, indice)` continua emitindo `cat-${id}` / `grupo-${indice}`, **intocada**;
`ancoraCardapio(id)` emite `cardapio-${id}`; `ancoraSecao` despacha por `tipo`. Os prefixos **não se
intersectam**, então a colisão é impossível **por construção** — e não por confiar que um uuid de
`cardapios` nunca vai bater com um de `categorias`. Depender de unicidade acidental entre duas
tabelas é o tipo de premissa que sobrevive até alguém trocar a chave. Fonte única preservada: o `id`
da `<section>` e o `href` do chip saem da **mesma** função, como a issue 201 fixou — e o despachante
é o que mantém essa propriedade agora que há dois tipos de seção.

**(c) Identidade do produto dentro da seção — `idNaSecao`, obrigatório por tipo.**

```ts
// Único produtor de identidade de DOM para produto renderizado numa seção.
idNaSecao(ancoraSecao: string, produtoId: string): string   // "cardapio-<uuid>:<produtoId>"
```

`CardProduto` troca o prop `id: string` por **`idNaSecao: string`, obrigatório**. Hoje esse `id` não
é emitido no DOM (`CardProduto.tsx:10` — está no contrato e não é usado), e é justamente por isso que
a trava tem de ser agora: no dia em que alguém acrescentar `id={...}`, `aria-labelledby` ou
`aria-describedby` — coisas que uma issue de acessibilidade pede naturalmente — o valor disponível
já será o escopado. **Sem jsdom, `id` duplicado no DOM não é detectável por teste de render**; com o
prop renomeado e obrigatório, passar um `produto.id` cru **não compila**.

**O que NÃO precisa de trava:** a `key` do React dos cards. Chave só precisa ser única **entre
irmãos**, e cada seção tem seu próprio laço — `key={produto.id}` continua correto e **não muda**.
Trocá-la por uma chave composta desmontaria e remontaria o card à toa. A trava é para **DOM id**, que
é global; `key`, que é local, já estava certa. E o `ProdutoModal` é **singleton fora do laço**, com
`key={produtoSelecionado?.id ?? "vazio"}`: abrir a Lasanha pelo destaque ou pela categoria dá o mesmo
modal, que é o comportamento correto — **nada a mudar**.

→ Camada: **desenho / `tsc`** (as três travas) + **SSR** (a separação das listas). **Nenhuma delas é
regra de valor ou permissão** — mas a de busca é de **integridade do que é anunciado**, e por isso
não é cosmética.

**RN-06 — A projeção do catálogo produz o objeto e o rótulo JUNTOS, numa função só.**

```ts
// src/lib/utils/catalogoVitrine.ts — módulo do Spec A, estendido (não duplicado)
projetarCatalogoVitrine(entrada: {
  produtos: Produto[];
  cardapiosPorProduto: Map<string, CardapioVigencia[]>;  // obrigatório
  agora: Date;
  timezone: string;                                       // obrigatório
}): {
  /**
   * JÁ FILTRADA por RN-13: o produto `visibilidade = 'cardapio'` sem próxima abertura
   * conhecida NÃO está aqui. Pode ser menor que `entrada.produtos` — é contrato, não
   * efeito colateral. `visibilidade` é ENTRADA (vem em `Produto`), nunca sai no objeto.
   */
  produtos: ProdutoVitrine[];
  /** produto_id → frase do selo. Uma entrada para CADA produto com motivo "fora_da_janela". */
  rotulosVigencia: Record<string, string>;
  /**
   * D16: os cardápios ABERTOS neste instante, já ordenados (RN-15). Sai daqui, e não
   * de uma segunda avaliação, para que "está aberto?" tenha UMA resposta por request.
   * `agruparPorCardapio` consome esta lista; ela não reavalia janela nenhuma.
   */
  cardapiosAbertos: CardapioVigencia[];
}
```

Os dois saem do **mesmo** retorno, então não existe caminho de código que produza o produto marcado
sem produzir o rótulo dele. O render tem fallback (`"Indisponível no momento"`) para o caso de a
chave faltar — degradação visível e correta, nunca um selo em branco. **Com D14 esse fallback deixou
de ser um caso de negócio na vitrine** (todo produto marcado tem uma volta a anunciar, RN-13) e passa
a ser puramente defensivo ali; ele continua sendo caso real **na revisão do carrinho**, onde o item
de temporada encerrada precisa aparecer bloqueado sem ter data para prometer.

> ⚠️ **D16 obriga a mover uma linha que hoje está no lugar errado, e isso é vazamento, não estética.**
> `page.tsx:188-190` zera `foto_url` **por grupo**: `grupo.categoria?.exibir_imagens === false ? null
> : p.foto_url`. Isso funciona enquanto cada produto aparece **uma** vez, dentro do grupo da
> categoria dele. Com D16-a ele aparece **também** na seção de destaque, que não é de categoria
> nenhuma — e a cópia de lá carregaria a URL da foto que o lojista escolheu esconder. A issue 201 foi
> explícita: *"em categoria 'ocultar', a foto NÃO trafega ao cliente — zerada no SSR, não só
> escondida no render (o payload RSC não carrega a URL)"*. Com duas seções, o payload voltaria a
> carregar.
>
> **Correção: o zeramento vira propriedade do PRODUTO, dentro de `projetarCatalogoVitrine`**, que
> passa a receber as categorias (ou um `Map<categoria_id, exibir_imagens>`) e devolve `foto_url`
> já resolvido. O produto viaja com **um** `foto_url` para onde for. **Critério de aceite: o render
> das seções de categoria é idêntico ao de hoje** — é movimentação de decisão, não mudança de regra.
> A seção de destaque renderiza como **grid** (é vitrine), e o produto de categoria "ocultar"
> aparece nela **sem foto**, com o mesmo placeholder que o grid já usa para produto sem foto.

Três consumidores, **uma** implementação — é o que garante que preview e autoritativo dizem a mesma
coisa sobre janela, do mesmo jeito que D5-b garante para preço:

| Consumidor | Caminho | Papel |
|---|---|---|
| SSR da vitrine | `page.tsx` → `buscarProdutosPublicos` + `buscarCardapiosComProdutos` → `projetarCatalogoVitrine` | o que o cliente vê |
| Preview do checkout | `revisarCarrinhoAction` → `buscarProdutosPorIds` + cardápios → `avaliarVigenciaDoProduto` | o que o cliente vê antes de enviar |
| Recusa autoritativa | `criarPedido` → `buscarProdutosPorIds` + cardápios → `avaliarVigenciaDoProduto` | se o pedido nasce |

→ Camada: **SSR / Server Action**. Componente client **nunca** avalia janela a partir de dados crus —
as colunas de vigência **não trafegam** para o cliente na vitrine, só o `ProdutoVitrine` projetado e
o rótulo pronto (regra 6 do contrato do Spec A; mesmo princípio da issue 201 sobre `foto_url`).

**RN-07 — O texto do selo é derivado, numa função pura, e o critério de escolha é determinístico.**

```ts
descreverVigencia(c: CardapioVigencia, timezone: string): string       // "Só aos sábados e domingos, das 11:00 às 15:00"
proximaAbertura(c: CardapioVigencia, agora: Date, timezone: string): Date | null
```

Quando o produto está fora da janela e participa de **N** cardápios ativos, todos fechados, o rótulo
é o `descreverVigencia` do cardápio que **abre mais cedo**, por `proximaAbertura` crescente, com
`null` (prazo fixo já expirado) por último, e empate resolvido por `nome` (`localeCompare` pt-BR) e
depois `id`. **Se todos derem `null`, não há rótulo a escolher** — e, por RN-13, também não há card:
o produto de cardápio **some**, e o produto do menu nunca chega aqui. O rótulo genérico
("Indisponível no momento" — copy final do `desenhar`) fica para a **revisão do carrinho**, onde o
item existe mas não tem volta a prometer, e como fallback defensivo de render.

**`proximaAbertura` é o mesmo número que RN-13 consome para decidir se o produto aparece.** Uma
implementação, dois usos: escolher **qual frase verdadeira** exibir e decidir **se há frase**. Nunca
dois critérios de "quando volta" no código.

- `proximaAbertura` para prazo fixo: `agora < inicio` ⇒ `inicio`; `agora >= fim` ⇒ `null`.
- `proximaAbertura` para recorrente: varredura adiante **limitada a 400 dias** (cobre `dias_mes = [31]`
  com folga), devolvendo o primeiro dia que casa `diaOk` no `hora_inicio`; nada em 400 dias ⇒ `null`.
  É a generalização do `reabreEm` que `lojaAberta` já faz para a semana — mesma ideia, mais eixos.
- **Custo:** `proximaAbertura` é calculada **uma vez por cardápio por request**, memoizada dentro de
  `projetarCatalogoVitrine`, nunca por produto. Uma loja tem poucos cardápios.
- O ordenamento por `proximaAbertura` afeta **qual frase verdadeira** é exibida, nunca **se** o
  produto é comprável. Por isso é fatia separada e não crítica.

→ Camada: **SSR** (o texto) — **cliente (UX)** só renderiza.

**RN-08 — O servidor recusa o item fora da janela; a UI não é a proteção.**

`criarPedido` (`src/lib/actions/pedido.ts`) ganha **uma condição** no laço de recusa que já existe
(linhas 173-179), lendo os cardápios do banco sob `service_role` no mesmo `Promise.all` da onda única
de leituras (linhas 113-122). Item fora da janela ⇒ **recusa o PEDIDO INTEIRO**, antes de chamar a
RPC — é a decisão que o arquivo já tomou para produto indisponível, oculto, de outra loja, e para
opcional inativo/cross-loja (linhas 196-202). Aceitar o resto do carrinho seria inventar um
comportamento novo e entregar ao cliente um pedido que ele não montou.

**`visibilidade` não exige mudança de query em nenhum dos dois caminhos.** `buscarProdutosPublicos`
(`produtos.ts:66`) e `buscarProdutosPorIds` (`produtos.ts:158`) já fazem `select("*")`, então a coluna
nova chega sozinha aos dois — **o objeto `Produto` continua sendo o insumo, e nenhuma query nova é
criada** (mandato 2). O que muda é só o tipo gerado (`npx supabase gen types`).

A query de cardápios do caminho autoritativo **não filtra por `ativo`** — pelo mesmo motivo que
`buscarProdutosPorIds` não filtra por `disponivel`: *"o recálculo precisa enxergar o indisponível
para recusá-lo"* (`src/lib/supabase/queries/produtos.ts:153-157`). É a mesma mecânica, reusada, não
uma decisão nova. A regra "inativo não restringe" mora na função pura (RN-03), que é o único lugar
onde ela existe nos dois caminhos.

**Mensagem ao cliente:** `"Um item do seu pedido saiu do cardápio deste horário. Revise o carrinho."`
— específica, e **não é oráculo**: a mesma informação já está pública no selo da vitrine. Mesma
classe de `"Loja fechada no momento."`, que já convive com o `ERRO_GENERICO` do resto do arquivo. A
mensagem **não nomeia o item** (quem nomeia é a revisão do carrinho, que o cliente já autenticou
mandando os ids).

**Falha ao ler cardápios ⇒ o `Promise.all` rejeita ⇒ catch externo ⇒ `ERRO_GENERICO` ⇒ pedido
recusado.** Fail-closed, sem branch novo.

→ Camada: **Server Action** (autoritativa) + **cliente (UX)** (o botão desabilitado, que é cortesia).

### Painel e ação em lote

**RN-09 — A ação em lote recusa a OPERAÇÃO INTEIRA, e o cross-tenant é impossível, não checado.**

O lojista da Loja A manda a lista `[p1, p2, pB, p3]`, onde `pB` é produto da Loja B.

- **O servidor recusa a operação inteira.** Nada é gravado, nem para `p1`, `p2`, `p3`. Dois
  precedentes diretos: `criarPedido` recusa o pedido inteiro por um item ruim
  (`pedido.ts:174-178`), e `reordenar_categorias` derruba a transação inteira por um id alheio
  (`20260908120000`, comentário "nada é escrito em nenhuma das duas lojas"). Aplicar parcialmente
  deixaria o lojista com um cardápio meio aplicado que ele não consegue distinguir de um bug — e
  confirmaria, pela diferença entre pedido e resultado, **quais ids existem em outra loja**.
- **A trava é estrutural.** A gravação é um `insert` homogêneo do PostgREST
  (`.upsert(linhas, { onConflict: "cardapio_id,produto_id", ignoreDuplicates: true })`), uma
  instrução, uma transação. `loja_id` vem de `buscarLojaDoDono` (`auth.uid()`), **nunca** do payload.
  `pB` viola `cardapio_produtos_produto_fk` ⇒ `23503` ⇒ a instrução inteira falha ⇒ nada gravado.
  **Não há pre-check em JS**, de propósito: um `SELECT` de posse antes do `INSERT` é TOCTOU (a lista
  pode mudar entre os dois), e a checagem dentro da transação não é — o mesmo racional já escrito em
  `reordenarCategorias` (`src/lib/actions/produto.ts:326-328`).
- **Mensagem ao lojista:** uma só, genérica, para id alheio, id inexistente, cardápio alheio e falha
  de banco — `"Não foi possível aplicar o cardápio aos produtos selecionados."` Mensagens distintas
  virariam oráculo de existência de id (`seguranca.md` §14). O detalhe vai para o log do servidor.
- **O que o teste afirma.** Não basta o SQLSTATE: uma trava de escopo passa por acidente aritmético
  quando só se checa o código do erro. O RED afirma **o nome da constraint**
  (`cardapio_produtos_produto_fk`) dentro da mensagem do erro — isso prova **qual** armadilha
  disparou, não só que algo falhou — **e** o fragmento da mensagem devolvida pela Server Action. Na
  via da RPC de categoria, afirma os fragmentos literais `cardapio fora da loja` /
  `categoria fora da loja` / `loja alheia`.
- **Cardinalidade:** `zod` `.max(200)` na lista de ids, sem duplicata, array novo produzido pelo
  parse (propriedade hostil pendurada no array do cliente não sobrevive) — mesma forma de
  `schemaReordenacaoCategorias`. CWE-770.

→ Camada: **FK composta (banco) + RLS + Server Action + zod**. **Fatia crítica.**

**RN-09-a — A prévia da ação em lote vem do servidor; o cliente nunca conta.** Antes de gravar, o
diálogo de confirmação (`plan/design-promocoes-e-vigencia.md` §10.2, mecanismo M8) precisa dizer
*"Adicionar 12 produtos"*, nomear até três e contar o resto. Esse número **não** pode sair do
`Set<produtoId>` do cliente: a seleção pode estar velha (o catálogo mudou noutro dispositivo) ou
conter id de outra loja, e o nome do produto é dado que só o servidor resolve sob RLS.

```ts
// lib/actions/cardapio.ts — mesma família das actions de lote; NÃO grava nada
preverLoteAction(entrada: { produto_ids: string[] } | { categoria_id: string })
  : { ok: true; total: number; nomes: string[] } | { ok: false; erro: string }
```

- **Mesmo zod da gravação**: `.max(200)`, sem duplicata, array novo produzido pelo parse — uma
  forma, dois consumidores, nunca um schema paralelo.
- **`loja_id` de `buscarLojaDoDono`**, nunca do payload. A leitura é `select id, nome from produtos
  where id in (...) and loja_id = <própria>` — id alheio ou inexistente **simplesmente não volta**,
  sem mensagem distinta e sem contagem de "ignorados" (anti-oráculo, `seguranca.md` §14). A
  gravação continua sendo quem recusa a operação inteira (RN-09); a prévia só mostra o que é seu.
- `nomes` limitado a **6** (o desktop mostra 6, o mobile 3 — `desenhar` §10.3); `total` é a contagem
  inteira. Para `categoria_id`, a contagem é dos produtos da categoria **agora** (mesma leitura
  que a RPC fará no `insert ... select`; a diferença entre a prévia e o gravado é a janela TOCTOU
  que RN-10 já aceita e que a confirmação diz em voz alta: *"Produtos criados depois não entram
  sozinhos"*).
- **Preview de UX**: nenhuma decisão depende do número. O botão de confirmar recebe `previa`
  **obrigatória** e não existe antes de ela chegar (M8) — sem jsdom, prop obrigatória é a única
  trava possível para "não confirmar sobre contagem do cliente".

→ Camada: **Server Action** (contagem e nomes) + **cliente (UX)** (a frase e o rótulo do botão).

**RN-10 — "Categoria inteira" é expandida DENTRO da transação.** A Server Action manda
`(loja_id, cardapio_id, categoria_id)` para `aplicar_cardapio_em_categoria`; o `insert ... select`
lê os produtos da categoria no mesmo instante em que grava. Inclui produtos `oculto` e
`disponivel = false` — a participação num cardápio é ortogonal a esses dois eixos, e excluir o
oculto criaria uma regra que o lojista descobriria só quando reexibisse o produto. Reaplicar é
idempotente (`on conflict do nothing`).
→ Camada: **Server Action + RPC + RLS**.

**RN-11 — Revalidação.** As Server Actions de cardápio chamam
`revalidatePath("/painel/cardapios")`, `revalidatePath("/painel/produtos")` e
``revalidatePath(`/loja/${loja.slug}`)`` — **o slug da própria loja, nunca a forma coringa
`("/loja/[slug]", "page")`**, que invalidaria o Router Cache da vitrine de todas as lojas do
marketplace a cada gravação (lição já registrada em `reordenarCategorias`). Não usar
`CAMINHO_PAINEL` de `produto.ts:25`: `"/painel/cardapio"` não existe como rota e os
`revalidatePath` que o consomem são no-op (débito conhecido, `architecture.md` §10).
→ Camada: **Server Action**.

**RN-12 (reescrita por D14) — Cardápio expirado ou desligado: o painel avisa que N produtos SUMIRAM
da vitrine.**

`"Cardápio de Inverno", prazo 01/06→01/09`. Em dezembro:

| Produto dentro dele | O que acontece | O que o painel diz |
|---|---|---|
| **do menu** ("Coca-Cola", que também é vendida o ano todo) | nada — continua vendendo | nada a avisar |
| **de cardápio** ("Sopa de cebola") | **sumiu da vitrine** (RN-13) | **é isto que precisa ser avisado** |

> **Esta fatia mudou de sentido, e ficou MAIS importante do que era na v0.1.0 — não menos.** Antes o
> aviso dizia *"cardápio expirado travando N produtos"* e era uma cortesia: o lojista via os produtos
> marcados na própria vitrine e podia deduzir o que houve. Agora ele **não vê nada**: a sopa de
> cebola não está na vitrine, não está em lugar nenhum, e a loja parece simplesmente menor. **O
> painel é o único lugar do sistema onde esse estado é observável.** Sem ele, D14 troca um problema
> visível por um invisível.

O aviso vive em `/painel/cardapios` (na linha do cardápio) e em `/painel/produtos` (na linha do
produto: *"sumiu da vitrine — o cardápio X expirou"*), cobre **expirado e desligado** pelo mesmo
predicado (`proximaAbertura === null`, RN-13 — não são dois casos), e traz as saídas a um clique:
**religar/estender o cardápio** ou **devolver os produtos ao menu**.

**O sistema não desliga, não reativa e não converte nada sozinho.** Nem o cardápio, nem a
`visibilidade` do produto. É mudança de disponibilidade de venda, e vale o mesmo princípio de D10 no
Spec A: o sistema não mexe em venda sem o lojista pedir. Um "conversor automático" que devolvesse ao
menu os produtos de um cardápio expirado venderia sopa de cebola em dezembro — exatamente o que D14
existe para impedir.

**A contagem é função pura, não JSX.** `contarProdutosEscondidos(cardapio, produtos, vinculos, agora,
timezone): { doMenu: number; sumidos: number }`, testável sem jsdom, consumida pelo SSR das duas
telas e pelos diálogos de desligar/remover. **Preview de UX** — nenhuma decisão depende do número.

→ Camada: **função pura** (a contagem) + **SSR** (o aviso, preview de UX).

**RN-14 (D14) — Produto "de cardápio" sem nenhum cardápio é IMPOSSÍVEL, não desaconselhado.**

É o estado que some da vitrine sem deixar rastro: o produto não aparece em cardápio nenhum (não está
em nenhum), então nem o aviso de RN-12 o alcança. O lojista perde um produto e não tem onde procurar.

**A trava escolhida: `CONSTRAINT TRIGGER ... DEFERRABLE INITIALLY DEFERRED` nas duas pontas**
(`produtos` e `cardapio_produtos`), detalhado em §Modelos de Dados. Por quê esta e não as outras:

| Candidata | Por que não basta |
|---|---|
| `CHECK` | não alcança outra tabela — a condição é "existe linha em `cardapio_produtos`" |
| só a Server Action | não cobre o `ON DELETE CASCADE` de remover cardápio/produto, que acontece **no banco**, depois da action |
| aviso de UI | **sem jsdom, não é travável por teste** — e o projeto já decidiu que proteção que depende de disciplina vira desenho, não aviso |
| trigger **não** deferido | quebraria o caso legítimo de criar produto e vínculo na mesma transação, e de trocar um vínculo por outro |

Os três caminhos que o trigger fecha, todos no COMMIT: (a) marcar como exclusivo um produto solto;
(b) tirar o **último** vínculo de um exclusivo; (c) **remover um cardápio** cuja cascata deixaria
exclusivos órfãos — a transação inteira cai, nada é removido pela metade.

**A Server Action é a primeira barreira, com a saída junto da recusa.** Ela lê os exclusivos antes
(dado do próprio lojista — não há oráculo a proteger), recusa com mensagem legível e oferece
**"converter os N para o menu"** no mesmo diálogo. O trigger é o backstop que torna o estado
inalcançável mesmo por caminho que ninguém previu — inclusive sob `service_role`, que `BYPASSRLS` não
ajuda a burlar porque **trigger não é RLS**.

**O que NÃO é impossível, de propósito:** produto exclusivo cujos cardápios existem mas nenhum está
aberto (ou todos desligados). Esse é o estado **normal** de fora de temporada, é reversível com um
clique e é **visível no painel** por RN-12. A trava é contra o órfão **estrutural**, não contra o
produto fora de temporada.

→ Camada: **trigger de constraint no banco (autoridade)** + **Server Action + zod** (mensagem
legível) + **SSR** (o aviso de RN-12 para os estados temporários).

---

## Segurança (obrigatório)

Base: `seguranca.md` §2 (RLS), §6 (inputs), §10 (recálculo no servidor), §14 (erros), §19 (views).
Mandato 1 do `CLAUDE.md`: nunca confiar no cliente.

### Que dado sensível entra ou sai

| Dado | Classificação | Tratamento |
|---|---|---|
| Nome e janela de um cardápio **ativo** | informação pública da vitrine (o selo diz isso ao cliente) | legível por `anon` via policy pública; nenhuma coluna crua trafega ao cliente — só o `ProdutoVitrine` + o rótulo pronto (RN-06) |
| Cardápio **inativo** (rascunho: "Cardápio de Natal" em setembro) | estratégia comercial do lojista | **não** exposto a `anon`: a policy pública filtra `ativo = true`. Mesma preocupação que impede SELECT público em `cupons` (§2), em escala menor |
| Vínculo produto↔cardápio | público | legível por `anon` (loja ativa); vínculo de cardápio inativo é inútil sem o cardápio |
| **Produto `visibilidade = 'cardapio'` que só existe em cardápio inativo** (rascunho: os pratos do "Cardápio de Natal" montado em setembro) | estratégia comercial do lojista, mesma classe do cardápio inativo | **não** exposto a `anon`: o disjunto novo de `produtos_leitura_publica` exige **algum cardápio ativo**. Nome e preço do prato de Natal não vazam antes da hora |
| **`produtos.visibilidade`** (a coluna em si) | interno do painel | **não trafega ao cliente**: é entrada da projeção, e `ProdutoVitrine` não ganha campo (regra 2 do contrato do Spec A) |
| PII de cliente | **inalterado** | esta feature não lê, não escreve e não exibe nenhum campo de cliente |
| Chave Pix / pagamento | **inalterado** | o SaaS continua sem tocar em pagamento |

### Valor monetário

**Esta fatia não introduz, não altera e não lê nenhum valor monetário.** Preço, desconto, base
elegível e snapshot do pedido são inteiramente do Spec A e não são tocados aqui. O que esta fatia
decide é **se o item pode ser comprado**, que é invariante de integridade do pedido, não de preço —
e é decidido **no servidor, a partir do banco e do relógio do servidor no fuso da loja** (RN-06,
RN-08). O payload de `criarPedido` continua `.strict()` e continua sem nenhum campo monetário: **e
também não ganha nenhum campo de janela, horário, cardápio ou `visibilidade`.** O cliente não manda
nada novo — nem para dizer que horas são, nem para dizer que um produto "é do menu", nem para dizer
de qual seção ele clicou.

**D16 não acrescenta superfície de segurança nenhuma.** Seção de destaque é **apresentação**: o
conjunto de produtos é o mesmo que já veio do SSR sob `anon` + RLS, o nome do cardápio já era público
(o selo o diz ao cliente), e forjar uma seção no devtools pinta a tela sem comprar nada — o mesmo
raciocínio que `NavCategorias.tsx` já registra sobre o trilho. As duas únicas consequências reais de
D16 estão em outra prateleira: **(a)** o `foto_url` de categoria "ocultar" tinha de deixar de ser
decidido por seção, ou a segunda seção recolocaria a URL no payload RSC (RN-06, regressão da issue
201) — **isso é vazamento e está corrigido**; **(b)** a contagem anunciada em `aria-live` não pode
contar o mesmo produto duas vezes (RN-16), que é integridade do que é dito, não segurança.

### Tabelas novas → políticas RLS necessárias

Duas tabelas novas ⇒ RLS obrigatória antes de produção. **Mais uma policy existente alterada**
(`produtos_leitura_publica`, §Modelos de Dados) e **um trigger de constraint**, que não é RLS e por
isso vale também sob `service_role`.

```sql
alter table public.cardapios         enable row level security;
alter table public.cardapio_produtos enable row level security;

-- Leitura pública: só cardápio ATIVO de loja ativa. loja_esta_ativa() e não
-- EXISTS direto em lojas — a tabela base não tem SELECT público para anon (§19),
-- e um EXISTS sob RLS do anon devolveria zero linhas, quebrando a vitrine em
-- silêncio (regra explícita de seguranca.md §2).
create policy "cardapios_leitura_publica" on public.cardapios for select
  using (ativo = true and public.loja_esta_ativa(loja_id));

create policy "cardapios_leitura_propria" on public.cardapios for select
  using (exists (select 1 from public.lojas
                  where lojas.id = cardapios.loja_id and lojas.dono_id = auth.uid()));

create policy "cardapios_escrita_propria" on public.cardapios for all
  using       (exists (select 1 from public.lojas
                        where lojas.id = cardapios.loja_id and lojas.dono_id = auth.uid()))
  with check  (exists (select 1 from public.lojas
                        where lojas.id = cardapios.loja_id and lojas.dono_id = auth.uid()));

create policy "cardapio_produtos_leitura_publica" on public.cardapio_produtos for select
  using (public.loja_esta_ativa(loja_id));

create policy "cardapio_produtos_leitura_propria" on public.cardapio_produtos for select
  using (exists (select 1 from public.lojas
                  where lojas.id = cardapio_produtos.loja_id and lojas.dono_id = auth.uid()));

create policy "cardapio_produtos_escrita_propria" on public.cardapio_produtos for all
  using       (exists (select 1 from public.lojas
                        where lojas.id = cardapio_produtos.loja_id and lojas.dono_id = auth.uid()))
  with check  (exists (select 1 from public.lojas
                        where lojas.id = cardapio_produtos.loja_id and lojas.dono_id = auth.uid()));
```

**O que a RLS destas tabelas NÃO cobre, e o que cobre no lugar.** `cardapio_produtos_escrita_propria`
valida só `cardapio_produtos.loja_id`. Um lojista poderia, pela RLS sozinha, inserir
`{loja_id: própria, produto_id: de outra loja}` — o vetor clássico de IDOR da ação em lote. **É isso
que as FKs compostas fecham por construção** (§Modelos de Dados), e é o motivo pelo qual esta spec
não repete o padrão de `categoria_produto_opcionais` (que resolve o mesmo problema por checagem na
Server Action). Testes obrigatórios em pglite (`tests/helpers/pglite.ts`, `asAnon`/`asUser`):

1. Lojista A **não** lê cardápio da loja B (`asUser`, zero linhas).
2. Lojista A **não** cria, edita nem remove cardápio da loja B.
3. Lojista A **não** grava vínculo com `produto_id` da loja B — afirmando o **nome da constraint**
   `cardapio_produtos_produto_fk`, não só o SQLSTATE.
4. Lojista A **não** grava vínculo com `cardapio_id` da loja B — afirmando
   `cardapio_produtos_cardapio_fk`.
5. `anon` **lê** cardápio ativo de loja ativa e **não** lê cardápio inativo.
6. `anon` **não** faz INSERT/UPDATE/DELETE em nenhuma das duas tabelas.
7. Os CHECKs de vigência recusam: modo misturado; **recorrente sem nenhum eixo** (as três dimensões
   vazias, com `NULL` **e** com `'{}'`); `hora_fim <= hora_inicio`; `dias_semana` com 7; `dias_mes`
   com 0 ou 32; prazo fixo sem `fim`.
8. **D14 — o trigger de RN-14**, quatro asserções: (a) marcar `visibilidade = 'cardapio'` num produto
   sem vínculo **falha no COMMIT**, afirmando o fragmento `produto exclusivo sem cardapio`; (b)
   marcar como exclusivo **e** vincular na **mesma transação** passa; (c) remover o cardápio que
   deixaria exclusivos órfãos **derruba a transação inteira** — `cardapios`, `cardapio_produtos` e
   `produtos` ficam como estavam; (d) **apagar o produto** exclusivo passa (a cascata leva o vínculo
   junto e não há invariante a defender). Rodar (a)–(d) também `asService`, provando que o trigger
   **não** é desligado por `BYPASSRLS`.
9. **D14 — a policy alterada**, três asserções: (a) **não-regressão**, a mais importante — com todos
   os produtos em `visibilidade = 'menu'` (o estado pós-migration), `anon` lê **exatamente** o mesmo
   conjunto de antes; (b) `anon` **não** lê produto `'cardapio'` cujos cardápios estão todos
   inativos; (c) `anon` **lê** produto `'cardapio'` com pelo menos um cardápio ativo, **mesmo fora da
   janela** — a policy não é a autoridade da janela, e assumir que é esconderia a ausência da regra
   na função pura.
10. **D14 — a coluna**: `CHECK` recusa `visibilidade = 'promocional'`; `anon` **não** faz UPDATE de
    `visibilidade`; lojista A **não** muda `visibilidade` de produto da loja B (`produtos_escrita_propria`).

### O caminho que a RLS não protege

`criarPedido` roda sob `createServiceClient()`, que tem `BYPASSRLS`. **Nenhuma regra desta feature
pode morar só na RLS**, ou ela não existe no caminho que decide o pedido. Consequências concretas,
todas já escritas acima:

- "cardápio inativo não participa" mora na **função pura** (RN-03), não na policy.
- **D14 mora em duas camadas, e a divisão é proposital.** A decisão de *"este produto não aparece
  agora"* é da **função pura** (RN-13), porque depende do relógio e do fuso e precisa existir também
  sob `service_role`. O `and` novo da policy pública é **só defesa em profundidade** contra vazamento
  de rascunho, e filtra por *"tem cardápio ligado"*, não por *"está aberto"*. Trocar as duas de lugar
  — pôr a janela na RLS — a apagaria do caminho do pedido.
- **O trigger de RN-14 é a exceção que prova a regra:** ele **não** é RLS, então vale para
  `service_role` também. É por isso que ele, e não a Server Action, é a autoridade do estado órfão.
- "cardápio de outra loja não conta" é garantido pelo `loja_id` da query **e** pelas FKs compostas,
  que valem para `service_role` também (FK não é RLS).
- O `Promise.all` que lê os cardápios no caminho autoritativo é **fail-closed**: falha ⇒ catch ⇒
  `ERRO_GENERICO` ⇒ pedido recusado (RN-08).

### Caminho admin (service_role)

**Gestão de cardápio não existe no hub admin na v1** (§Fora do Escopo). Isso é uma lacuna de
funcionalidade, não um buraco de segurança: não há caminho admin mais frouxo porque não há caminho
admin. Duas consequências que a issue tem de registrar:

- a RPC `aplicar_cardapio_em_categoria` é `SECURITY INVOKER` e **fail-closes** sob `service_role`
  (`auth.uid()` NULL ⇒ T2 levanta exceção) — comportamento correto e testável;
- o dia em que o admin precisar disso, a conversão é `SECURITY DEFINER` + as travas T1–T7 de
  `seguranca.md` §2, com `coalesce(auth.role(), '')` na conjunção de autoridade (o fail-open real
  corrigido por `20260918130000`) e `set search_path = public, pg_temp`. **Acrescentar o `grant` sem
  as travas seria abrir a função sem nenhuma checagem de tenant.**

### API externa com key

Nenhuma. Esta feature não chama serviço externo. A avaliação de fuso é `Intl`, em processo, função
pura, com o instante injetado.

### Erros

`23503` de FK, `23514` de CHECK ou qualquer exceção interna: **mensagem genérica na UI, detalhe no
log do servidor** (§14). O texto cru do Postgres nunca chega ao lojista nem ao cliente. As mensagens
de `raise exception` da RPC são **para o log e para o teste**, nunca para a tela.

---

## Fatias de implementação

Seleção para o agente `quebrar` selar. Critério do `CLAUDE.md` (mandato 3): dinheiro, RLS,
autorização, integridade. Cada `crítica: SIM` exige teste **vermelho com output `FAIL` capturado**
antes de qualquer código de produção.

| # | Fatia | crítica | Por quê / o que o RED precisa provar |
|---|---|---|---|
| 1 | **Migration + RLS de `cardapios` e `cardapio_produtos`** (incl. FKs compostas e CHECKs de vigência) | **SIM** | isolamento multitenant e integridade. As 7 asserções de §Segurança, com **nome de constraint** afirmado, não só SQLSTATE |
| 2 | **`vigenciaCardapio.ts` — `cardapioAberto` + `avaliarVigenciaDoProduto`** (puras, fuso da loja, união, **RN-13**) | **SIM** | é a função que decide o que é vendável **e o que existe**. Os cenários 1 e 2 literais; **o caso de quarta dia 15 com `{sáb,dom}`+`{1,15}` ⇒ ABERTO** (RN-02, OU); eixo vazio ⇒ sem restrição; início inclusivo / fim exclusivo nos dois modos; inativo ignorado; **`'menu'` ⇒ sempre dentro, sem nem ler cardápio**; união (cenário 4); **RN-13: os quatro desfechos, inclusive `'cardapio'` + desligado ⇒ some**; `partesNoFuso` **consumido** do módulo `fusoLoja.ts`, sem segunda cópia |
| 3 | **Extensão do contrato de catálogo** — `projetarProdutoVitrine`/`projetarCatalogoVitrine` compondo `compravel`, **filtrando por RN-13** e aplicando a precedência do motivo | **SIM** | é o contrato que o Spec A nomeou. `compravel === disponivel && dentroDaJanela`; cenário 3 (precedência `fora_da_janela` > `esgotado`); `oculto` nem chega; **produto sumido não está na lista devolvida, e a categoria que ficou vazia não é devolvida por `agruparCatalogo`**; `visibilidade` **ausente** do objeto projetado, como as colunas cruas de vigência; rótulo presente para **todo** produto com motivo `"fora_da_janela"` |
| 4 | **Recusa do servidor em `criarPedido`** (D4) | **SIM** | **a UI não é a proteção.** Payload forjado com produto fora da janela ⇒ **pedido inteiro** recusado, antes da RPC, sem gravar nada; produto dentro da janela passa; cardápio inativo não bloqueia; falha de leitura de cardápio ⇒ recusa (fail-closed) |
| 5 | **Ação em lote — Server Actions + `aplicar_cardapio_em_categoria`** | **SIM** | lista de ids vinda do cliente = IDOR. `produto_id` da Loja B ⇒ **operação inteira** recusada, nada gravado nas duas lojas, afirmando `cardapio_produtos_produto_fk` **e** o fragmento da mensagem da action; `cardapio_id` alheio idem; `p_loja_id` forjado ⇒ `loja alheia`; `p_categoria_id` alheio ⇒ `categoria fora da loja`; teto de 200 ids; reaplicar é idempotente; **RN-09-a:** `preverLoteAction` com `[p1, pB]` devolve `total = 1` e só o nome de `p1` — o id da Loja B não aparece na prévia e não produz mensagem distinta |
| 6 | **Preview = autoritativo para vigência** (`revisarCarrinhoAction`, estende o Spec A) | **SIM** | preview mais generoso que o autoritativo é oráculo (`seguranca.md` §10-A). A revisão e `criarPedido` dão **o mesmo veredito** para o mesmo carrinho e o mesmo `agora`; `produto_id` de outra loja recusado, fragmento afirmado |
| 7 | `calcularFimDoPreset` (diário/semanal/mensal + clamp de fim de mês) | NÃO | pura, mas com armadilha real: `31/01 → 28/02`, `31/01/2028 → 29/02`, `10/10 + semanal → 17/10 00:00` |
| 8 | `descreverVigencia` + `proximaAbertura` + escolha determinística entre N cardápios | NÃO | muda **qual frase verdadeira** aparece, nunca se o produto vende |
| 9 | CRUD de cardápio (`/painel/cardapios`) + lista com estado ao vivo | NÃO | tela de gestão; a autorização está na fatia 1 |
| 10 | **Form de vigência RECORRENTE** (dias da semana + dias do mês + faixa de horário) | NÃO | — |
| 11 | **Form de vigência PRAZO FIXO** (presets + customizado) | NÃO | — |
| 12 | **Preview do form no fuso da loja** (`PreviewVigencia`) | NÃO | — |
| 13 | Modo de seleção em `/painel/produtos` (checkbox, categoria inteira, barra de ação) | NÃO | a trava está na fatia 5 |
| 14 | Selo e estado não comprável na vitrine (`CardProduto`, `ItemProdutoLista`, `ProdutoModal`) + o teste de `filtrarCatalogo` que prova que o estado sobrevive à busca | NÃO | reuso literal do padrão de `esgotado`; nenhum estilo novo. O produto sumido nem chega aqui (fatia 3) |
| 15 | **Aviso de cardápio expirado ou desligado escondendo produtos (RN-12 reescrita)** + `contarProdutosEscondidos` puro + a cópia nova do diálogo de desligar/remover | NÃO | preview de UX, **mas é o único lugar onde o sumiço de D14 é observável** — sem ele o lojista perde produto sem saber. A **contagem** é função pura com teste ao lado (sem jsdom); a tela só a consome |
| 16 | **D14 no banco: coluna `produtos.visibilidade` + trigger de RN-14 + a policy `produtos_leitura_publica` alterada** | **SIM** | expand puro (default `'menu'`, sem backfill); as asserções 8, 9 e 10 de §Segurança, com **fragmento de mensagem** afirmado e a **não-regressão** da policy como teste, não como argumento; trigger provado também `asService` |
| 17 | **D14 no painel: campo `visibilidade` no `FormProduto`, ação em lote "exclusivo / devolver ao menu", badge na lista e o atalho "converter os N para o menu"** | NÃO | a autorização está nas fatias 5 e 16; aqui é form, cópia e barra de ação. A recusa de marcar exclusivo sem cardápio é testada na fatia 16, não no componente |
| 18 | **D16 puro: `agruparPorCardapio` + `cardapiosAbertos` no retorno da projeção + a ordenação determinística + o `foto_url` zerado por produto** | NÃO | função pura com teste ao lado, e é onde as invariantes de D16 ficam traváveis sem jsdom: seção vazia não é emitida; **nenhum produto de seção de destaque está fora da janela**; produto em dois cardápios abertos sai nas duas seções; ordem `ordem → nome → id` estável; **a suíte atual de `agruparCatalogo` passa SEM EDIÇÃO**; `foto_url` de categoria "ocultar" é `null` **também** na seção de destaque (regressão da issue 201) |
| 19 | **D16 na tela: seções de destaque em `CatalogoVitrine`/`SecaoCatalogo`, pílulas em `NavCategorias`, `ancoraCardapio`, `idNaSecao` e `CardProduto.idNaSecao`** | NÃO | render, âncora e nav. As três travas de RN-16 são de **tipo e desenho** (`tsc`), não de teste de componente: prop `secoesDestaque` separada de `categorias`, prefixos de âncora disjuntos, `idNaSecao` obrigatório. Depende da fatia 14 (as duas tocam `SecaoCatalogo` e `CardProduto` — **nunca em paralelo**) |

> **Ordem: as fatias 16, 18 e 19 andam mais cedo do que o número sugere.** Elas são numeradas por
> último porque são os acréscimos das v0.2.0 e v0.3.0, não porque venham depois. A ordem que o
> `quebrar` deve emitir:
>
> **1 → 16 → 2 → 3 → 18 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11 → 12 → 13 → 17 → 14 → 19 → 15**
>
> - **16 junto de 1:** é **migration**, e as fatias 2 e 3 precisam da coluna `visibilidade` no tipo
>   gerado (`npx supabase gen types`) para compor RN-05 e RN-13. 1 e 16 são independentes entre si
>   (tabelas novas × coluna em tabela existente) e podem ser duas issues paralelas, desde que o
>   trigger de 16 venha **depois** de `cardapio_produtos` existir.
> - **18 logo após 3:** ela consome `cardapiosAbertos`, que a 3 passa a devolver, e é **pura** — sai
>   inteira antes de qualquer componente, que é o que mantém o D16 travável num repo sem jsdom.
> - **19 depois de 14, nunca em paralelo:** as duas editam `SecaoCatalogo.tsx` e `CardProduto.tsx`.
>   Este é o único conflito de arquivo real entre as fatias de UI desta spec.
> - **15 por último:** ela depende da cópia que 17 e 19 fixam para "sumiu" e "destaque".

> **As fatias 10, 11 e 12 são TRÊS, não uma.** O form dos dois modos é a UI mais subestimada deste
> trabalho: dias da semana + dias do mês + faixa de horário + presets + customizado + preview no
> fuso da loja, em 360px, com o mesmo schema zod do servidor. Empacotar isso numa fatia só é como o
> escopo estoura. E como **não há jsdom**, o que precisa ser travado por teste tem de sair do
> componente: `calcularFimDoPreset`, `descreverVigencia` e o `schemaCardapio` são módulos puros com
> teste ao lado; o componente só os consome.

---

## Cenários de aceite (data e hora literais, fuso `America/Sao_Paulo`)

### Cenário 1 — Recorrente: "Feijoada", sáb + dom, 11:00–15:00

`modo = 'recorrente'`, `dias_semana = {0,6}`, `dias_mes = NULL`, `hora_inicio = 11:00`,
`hora_fim = 15:00`, `ativo = true`. Produto `disponivel = true`, `oculto = false`.

| Instante no fuso da loja | `diaIndex` | `minutos` | Dentro? | O que a vitrine mostra |
|---|---|---|---|---|
| **sáb 10/10/2026 10:59** | 6 | 659 | **não** | card visível, "Adicionar" **desabilitado**, selo *"Só aos sábados e domingos, das 11:00 às 15:00"* |
| **sáb 10/10/2026 11:00** | 6 | 660 | **sim** | card normal, comprável (início **inclusivo**) |
| sáb 10/10/2026 14:59 | 6 | 899 | sim | comprável |
| **sáb 10/10/2026 15:00** | 6 | 900 | **não** | marcado de novo (fim **exclusivo**, igual a `lojaAberta`) |
| **ter 13/10/2026 12:00** | 2 | 720 | **não** | marcado — o dia não está em `dias_semana` |
| **sáb 17/10/2026 12:00** | 6 | 720 | **sim** | comprável — **recorrente repete para sempre**; não há data de término, e uma semana depois é idêntico ao primeiro sábado |

Em todas as linhas o card **aparece**. Em nenhuma ele some: esse é o padrão de `esgotado`, não o de
`oculto` (D4).

### Cenário 2 — Prazo fixo: "Semana do Hambúrguer", preset semanal, início 10/10/2026 00:00

A Server Action grava `prazo_inicio = 2026-10-10T00:00 (fuso da loja)` e **recalcula**
`prazo_fim = prazo_inicio + 7 dias = 2026-10-17T00:00 (fuso da loja)`, descartando qualquer `fim`
que tenha vindo do cliente (RN-04).

| Instante no fuso da loja | Dentro? | Estado |
|---|---|---|
| **sáb 10/10/2026 00:00** | **sim** | comprável — início **inclusivo** |
| sáb 10/10/2026 09:00 | sim | comprável |
| **sex 16/10/2026 23:59** | **sim** | comprável — último minuto |
| **sáb 17/10/2026 00:00** | **não** | expirou — fim **exclusivo** |
| **sáb 17/10/2026 00:01** | **não** | **expirado**. `proximaAbertura = null` ⇒ **os produtos `'cardapio'` deste cardápio somem da vitrine** (RN-13); os `'menu'` seguem vendendo. O painel mostra *"Expirado — N produtos sumiram da vitrine"* (RN-12) |

**Fim exclusivo, início inclusivo — a mesma convenção que o Spec A fixou para o prazo de desconto e
que `lojaAberta` já usa.** Um preset "semanal" cobre exatamente 7 dias de 24 h, sem o dia a mais que
um fim inclusivo daria.

### Cenário 3 — Interação com `oculto`, `disponivel` e `visibilidade`

Produto do **cardápio recorrente do cenário 1** (sáb+dom, 11:00–15:00), olhado numa **terça-feira**.

| Situação | `visibilidade` | Aparece? | `compravel` | `motivoNaoCompravel` | Selo |
|---|---|---|---|---|---|
| `oculto = true`, **dentro** da janela | qualquer | **não** | — | — | nem vira `ProdutoVitrine`: `produtos_leitura_publica` + `.eq("oculto", false)` são anteriores à projeção |
| `oculto = true`, **fora** da janela | qualquer | **não** | — | — | idem — `oculto` ganha de tudo |
| **dentro** da janela, `disponivel = false` | qualquer | sim | `false` | `"esgotado"` | *"Esgotado"* — sem conflito, só um motivo se aplica |
| **fora** da janela, `disponivel = true` | `'cardapio'` | sim | `false` | `"fora_da_janela"` | *"Só aos sábados e domingos…"* — há próxima abertura (sábado) |
| **fora** da janela **e** `disponivel = false` | `'cardapio'` | sim | `false` | **`"fora_da_janela"`** | a janela **ganha** (RN-05): numa terça, a feijoada não acabou — ela não é servida hoje; e é o único motivo que sabe dizer quando volta |
| **fora** da janela, `disponivel = true` | **`'menu'`** | sim | **`true`** | — | **nenhum.** D14: o cardápio não afeta produto do menu — ele vende na terça como vendia antes de existir cardápio |
| **fora** da janela, `disponivel = false` | **`'menu'`** | sim | `false` | **`"esgotado"`** | *"Esgotado"* — o motivo de janela **não se aplica** a produto do menu, então não há precedência a decidir |

### Cenário 4 — Produto em DOIS cardápios, um aberto e um fechado

Feijoada **`visibilidade = 'cardapio'`** em "Fim de semana" (recorrente, sáb+dom 11:00–15:00,
**fechado** numa terça) **e** em "Cardápio de Inverno" (prazo fixo 01/06→01/09, **aberto** em 15/07).

| Instante | "Fim de semana" | "Inverno" | União ⇒ | Interseção daria |
|---|---|---|---|---|
| **qua 15/07/2026 12:00** | fechado | **aberto** | **comprável** | não comprável |
| ter 13/10/2026 12:00 | fechado (abre sáb 17/10) | fechado (expirado, `null`) | não comprável, **aparece marcado** com o selo do que abre mais cedo — o "Fim de semana" (RN-07/RN-13) | não comprável |
| sáb 17/10/2026 12:00 | **aberto** | fechado (expirado) | **comprável** | não comprável |

**A regra é UNIÃO.** Justificativa completa em RN-05; o argumento decisivo é que a interseção de
"sáb+dom" com "seg–sex" é o conjunto vazio, e o lojista acabaria com um produto que nunca mais vende
sem nenhuma mensagem de erro possível.

**A linha do meio é a que mostra D14 e a união trabalhando juntas:** um dos dois cardápios expirou
(`proximaAbertura = null`) e mesmo assim o produto **não some** — porque o outro tem abertura
conhecida. RN-13 pergunta *"existe **alguma** próxima abertura?"*, não *"algum cardápio expirou?"*.

**A mesma feijoada, se fosse `visibilidade = 'menu'`:** comprável nas **três** linhas, sem selo
nenhum, porque cardápio não restringe produto do menu. A união nem é avaliada.

### Cenário 5 — Ação em lote hostil

Lojista da **Loja A**, autenticado, manda
`aplicarCardapioEmProdutos({ cardapio_id: cA, produto_ids: [p1, p2, pB, p3] })`, onde `pB` pertence
à **Loja B**.

1. `zod` valida a forma: array de uuid, sem duplicata, no máximo 200. Passa — a forma está certa, o
   problema é de posse.
2. `loja_id` vem de `buscarLojaDoDono(auth.uid())` = **A**. O payload não tem `loja_id` e não teria
   como ter.
3. Um `insert` homogêneo com 4 linhas, todas com `loja_id = A`. A linha de `pB` viola
   `cardapio_produtos_produto_fk` — **não existe** `(pB, A)` em `produtos(id, loja_id)`.
4. `23503`. A instrução inteira falha. **Nada é gravado**: nem `p1`, nem `p2`, nem `p3`, e nada na
   Loja B. Não há estado intermediário, porque é uma instrução só.
5. A Server Action loga o erro e devolve **uma** mensagem:
   *"Não foi possível aplicar o cardápio aos produtos selecionados."* — a mesma para id alheio, id
   inexistente, cardápio alheio e falha de banco (anti-oráculo, §14).

**O que o teste afirma:** (a) nenhuma linha nova em `cardapio_produtos` para **nenhum** dos 4 ids;
(b) o erro contém **`cardapio_produtos_produto_fk`** — o nome da constraint, não só `23503`, para
provar **qual** armadilha disparou e não deixar a trava passar por acidente; (c) o fragmento da
mensagem devolvida ao lojista. Na variante de categoria, o teste afirma os fragmentos literais
`cardapio fora da loja`, `categoria fora da loja` e `loja alheia` levantados pela RPC.

### Cenário 6 (D14) — A temporada acabou: dois produtos, dois desfechos

"Cardápio de Inverno", **prazo fixo 01/06/2026 → 01/09/2026**, com dois produtos dentro:

- **Sopa de cebola** — `visibilidade = 'cardapio'` (só existe no inverno);
- **Coca-Cola 2L** — `visibilidade = 'menu'` (vendida o ano todo; entrou no cardápio para ser
  **destacada** na temporada).

Instante: **dom 20/12/2026 12:00**, fuso `America/Sao_Paulo`. O lojista não mexeu em nada.

| | Sopa de cebola (`'cardapio'`) | Coca-Cola 2L (`'menu'`) |
|---|---|---|
| `cardapioAberto("Inverno")` | `false` | `false` |
| `proximaAbertura("Inverno")` | **`null`** (prazo fixo com `agora >= fim`) | **`null`** |
| `dentroDaJanela` (RN-05) | `false` | **`true`** — curto-circuito por `'menu'` |
| `visivelNaVitrine` (RN-13) | **`false`** | `true` |
| **Vitrine** | **não aparece.** Nem card, nem selo, nem espaço ocupado | **normal e comprável**, como em qualquer outro dia do ano |
| **Busca** | não aparece — `filtrarCatalogo` é subtrativa sobre uma lista que já não a contém | aparece |
| **Categoria "Sopas", se a sopa era o único produto dela** | **a seção some** — issue 177, de graça | — |
| **`criarPedido` com a sopa no payload** | **pedido inteiro recusado** (RN-08, sem branch novo: `dentroDaJanela` já é `false`) | aceito |
| **Revisão do carrinho** | linha **bloqueada**, motivo `"fora_da_janela"`, **sem** "volta em" ⇒ frase genérica | normal |
| **`/painel/cardapios`** | *"Cardápio de Inverno — **expirado**. 1 produto sumiu da vitrine."* + religar / devolver ao menu (RN-12) | não entra na contagem de sumidos |
| **Se o lojista DESLIGAR o cardápio** (em vez de ele expirar) | **idêntico**: `proximaAbertura = null`, some. RN-03 + RN-13, um predicado só | **idêntico**: continua vendendo |

**É esta a correção da antiga P2.** A v0.1.0 respondia *"a janela expira, a restrição permanece"* — a
sopa ficava marcada para sempre e a Coca-Cola junto com ela. D14 responde outra coisa: **a sopa some,
a Coca-Cola nunca foi afetada**, e o que decide não é o cardápio, é a `visibilidade` do produto.

### Cenário 7 (D14) — O estado órfão é recusado pelo banco

Loja A, autenticada. Produto "Sopa de cebola", hoje `visibilidade = 'menu'`, **em nenhum cardápio**.

| # | Gesto do lojista | Resultado |
|---|---|---|
| 1 | Marca a sopa como **"só aparece quando um cardápio dele estiver aberto"**, sem escolher cardápio | **Server Action recusa** com a frase legível. Se o payload burlar a action, o **COMMIT falha** no trigger `produtos_exclusivo_tem_cardapio` (`produto exclusivo sem cardapio: <uuid>`) e **nada** é gravado |
| 2 | Marca como exclusiva **e** aplica o "Cardápio de Inverno" no mesmo gesto | **passa** — o trigger é `DEFERRABLE INITIALLY DEFERRED` e só olha no COMMIT, quando o vínculo já existe |
| 3 | Tira a sopa (agora exclusiva) do único cardápio dela | **recusado**; o diálogo oferece *"devolver ao menu"*, que resolve os dois em uma transação |
| 4 | **Remove** o "Cardápio de Inverno", que tem a sopa exclusiva e mais 3 produtos do menu | **a transação inteira cai** — a cascata em `cardapio_produtos` dispara o trigger. O cardápio **não** é removido, os 3 produtos do menu **não** perdem o vínculo. O diálogo diz: *"3 produtos do menu continuam normais; 1 produto é exclusivo e precisa voltar ao menu antes"* + o botão de converter |
| 5 | Converte a sopa para o menu e remove o cardápio | **passa** — nenhum exclusivo sobrou |
| 6 | **Apaga** a sopa exclusiva | **passa** — no COMMIT o produto não existe mais, e o predicado do trigger começa por ele (`exists(produtos ... visibilidade='cardapio')` é `false`) |
| 7 | Qualquer um dos acima **via `service_role`** | **mesmo resultado**: trigger não é RLS, `BYPASSRLS` não o desliga |

**O que o teste afirma:** o fragmento `produto exclusivo sem cardapio` (não só o SQLSTATE — trava de
escopo checada só pelo código do erro passa por acidente), e, no caso 4, que as **três** tabelas
ficaram intactas depois do rollback.

### Cenário 8 (D16) — A seção de destaque, a duplicata e a busca

Loja com duas categorias — **"Massas"** (Lasanha, Nhoque) e **"Sopas"** (Sopa de cebola) — e um
**"Cardápio de Inverno"** (recorrente, **aberto agora**) contendo **Lasanha** (`'menu'`) e **Sopa de
cebola** (`'cardapio'`).

**Catálogo, com a busca vazia** — 3 produtos, **5 cards**, 3 seções:

| Ordem | Seção | Âncora | Produtos |
|---|---|---|---|
| 1 | **Cardápio de Inverno** (destaque) | `cardapio-<uuid>` | Lasanha, Sopa de cebola |
| 2 | Massas | `cat-<uuid>` | Lasanha, Nhoque |
| 3 | Sopas | `cat-<uuid>` | Sopa de cebola |

- A **Lasanha** aparece 2× e a **Sopa** 2× — **é o ponto de D16-a**, não um defeito. Nenhuma das duas
  saiu da categoria: quem navega por "Massas" acha a Lasanha onde sempre esteve.
- **Trilho:** 3 pílulas — *Cardápio de Inverno*, *Massas*, *Sopas* — nessa ordem. Com 3 seções o
  trilho aparece (`MINIMO_CATEGORIAS = 3`); antes de D16 esta loja teria 2 seções e **nenhum**
  trilho. É efeito esperado.
- **Os dois cards da Lasanha dizem exatamente a mesma coisa** — mesmo preço, mesmo selo, mesmo
  estado — porque são a mesma referência de objeto (RN-16).

**O cliente digita "lasanha":**

| | Resultado |
|---|---|
| Seções renderizadas | **só "Massas"**, com 1 card |
| Cards da Lasanha na tela | **1** |
| `ResumoBusca` | *"1 resultado"* — e é verdade |
| Trilho | **desmontado** (comportamento existente, D2 da 202) |
| Como está travado | `secoesDestaque` é **prop separada**: `filtrarCatalogo` e `contarProdutos` nunca a recebem. Não é filtro que alguém possa esquecer — é lista que não chega lá |

**O cardápio fecha** (bate o horário, ou o lojista desliga):

| | Antes | Depois |
|---|---|---|
| Seção "Cardápio de Inverno" | existe | **some sozinha**, sem ninguém publicar nada |
| Lasanha (`'menu'`) | 2 cards | **1 card, em "Massas", comprável** — perdeu o destaque, não a venda |
| Sopa (`'cardapio'`), **com** volta conhecida | 2 cards | **1 card, em "Sopas", marcada** *"Só aos sábados…"* (D4) |
| Sopa (`'cardapio'`), **sem** volta conhecida | 2 cards | **0 cards** — some dos dois lugares (RN-13), e "Sopas" some junto se ela era o único produto (issue 177) |
| Trilho | 3 pílulas | 2 seções ⇒ **trilho some** (RN-4 existente) |

**É a coerência que fecha D14 + D16:** um produto, um estado decidido uma vez pela função pura, e
dois lugares de render que nunca discordam porque leem o mesmo objeto.

---

## Contrato — o que foi fechado na v0.2.0

**Nenhuma pendência de contrato aberta.** As duas perguntas da v0.1.0 foram respondidas pelo dono do
produto em 2026-09-20. Registro do que foi perguntado, do que foi respondido e do que cada resposta
custou:

### Antiga P1 — `dias_semana` **e** `dias_mes` juntos: **OU** (default confirmado)

> **Caso levado ao dono do produto:** cardápio recorrente com `dias_semana = {sáb, dom}` **e**
> `dias_mes = {1, 15}`. **Numa quarta-feira, dia 15, está aberto?**
> **Resposta: SIM — basta uma das regras bater.**

Confirma o default que a v0.1.0 tinha adotado. **Promovida a regra fechada em RN-02**, com o caso
numérico como cenário de aceite da fatia 2. Nada mudou no schema, na RLS ou nas outras fatias — o
`OU` já estava implementado como default.

### Antiga P2 — prazo fixo expirado: **substituída por D14**, que é uma terceira resposta

> **Caso levado ao dono do produto:** "Cardápio de Inverno", prazo fixo 01/06 → 01/09, com "Sopa de
> cebola" dentro. **Em 20/12, a sopa aparece comprável?**
> A v0.1.0 ofereceu duas saídas: *restrição expira* (volta a vender sozinha) ou *janela expira*
> (segue marcada para sempre). **A resposta não foi nenhuma das duas.**
>
> *"Se produto vivia só no cardápio de inverno, ele desaparece do menu como um todo; se ele vivia no
> menu regular, ele continua onde vivia."*

A pergunta estava mal posta: ela tratava como propriedade **do cardápio** algo que é propriedade
**do produto**. D14 move a decisão para onde ela pertence (`produtos.visibilidade`) e, com isso,
responde as duas metades ao mesmo tempo — a sopa **some**, a Coca-Cola **continua vendendo** —
enquanto a v0.1.0 só conseguia dar a mesma resposta para as duas.

**O que essa resposta custou, e o que ela pagou:**

| Custou | Pagou |
|---|---|
| uma coluna nova (`produtos.visibilidade`), um trigger de constraint e um ajuste de policy — fatia 16, crítica | fecha o buraco do selo *"quando volta"* sem ter o que dizer, que o `desenhar` tinha achado por outro caminho |
| RN-03, RN-05, RN-12 reescritas; RN-13 e RN-14 novas | a migration continua **expand puro, sem backfill** (default `'menu'`), que era a propriedade barata identificada pelo plano do loop |
| uma fatia nova de painel (17) | a fatia 15 deixa de ser cortesia e vira a única janela do lojista para o estado novo |

### Fechado na v0.3.0 — RN-03: desligar faz o exclusivo sumir

A v0.2.0 tinha adotado a **letra de D14** contra a própria RN-03 da v0.1.0 (*"desligar ⇒ os produtos
voltam a vender"*) e levantado o ponto para confirmação, por ser o único lugar em que D14 e uma regra
anterior apontavam para lados opostos. **Confirmado em 2026-09-20**, com o argumento que a spec tinha
usado: desligar não pode ser o gesto mais perigoso do painel. RN-03 é regra fechada, e a cópia de
dois números no `Switch` e no diálogo está aprovada. **Nenhum retrabalho** — só saiu o pedido de
confirmação.

### D16 — o "destacar na temporada" de D14 ganhou forma

A v0.2.0 registrou em §Fora do Escopo que **a v1 não construiria destaque visual nenhum**, porque
D14 dizia *para que serve* pôr um produto do menu num cardápio, mas não *como isso aparece*. A spec
ofereceu a extensão barata (o mapa de rótulos que já viaja ao lado do catálogo, RN-06) e deixou a
decisão para o `desenhar`.

**O dono do produto foi além da extensão barata: quer seção própria.** D16 + D16-a, transcritas no
cabeçalho. O item **saiu de §Fora do Escopo e entrou no escopo** — RN-15, RN-16, fatias 18 e 19, e o
cenário 8.

**O que D16 custou, e o que ele pagou:**

| Custou | Pagou |
|---|---|
| duas fatias novas (18 pura, 19 de tela), nenhuma crítica | o cardápio deixa de ser invisível para o cliente: ele só se manifestava por ausência ou por selo |
| a primeira duplicata de render da vitrine, e as três travas de RN-16 | `agruparCatalogo`, `filtrarCatalogo` e o `ProdutoModal` ficam **intocados** — a duplicata é aditiva, não um refactor do catálogo |
| mover o zeramento de `foto_url` para dentro da projeção | **fecha um vazamento que D16 teria criado**: a foto de categoria "ocultar" voltaria ao payload pela seção de destaque (issue 201) |

**Não abriu pendência de contrato nova.** Os oito pontos pedidos estão decididos em RN-15, e nenhum
deles ficou com duas leituras possíveis.

---

## Fora do Escopo (v1)

### É do Spec A — não desenhar nada disso aqui

- Desconto por produto (percentual/fixo, prazo), selo de promoção, preço riscado, "pratos
  promocionais", modal de abertura, base elegível de cupom, `itens_pedido.preco_original`.
- Qualquer regra de preço. Preço é do Spec A; calendário é do Spec B; **nenhum dos dois herda a
  régua do outro.**

### Recusado por contrato (D1–D11 e D14 são fechadas)

- **Desconto próprio de cardápio** ("tudo do cardápio de inverno com 10%"). D1: o mecanismo de
  desconto é **um só**, por produto. Esta spec não lê nem escreve nenhum campo de preço.
- **Preço diferente por cardápio** (happy hour com outro preço). Mesma razão: seria um terceiro
  preço, proibido pela regra 1 do contrato de catálogo.
- **Produto fora da janela sumir da vitrine — quando há próxima abertura conhecida.** D4 é explícito:
  **aparece marcado**, padrão de `esgotado`, nunca o de `oculto`. ⚠️ **Atualizado por D14:** o sumiço
  passou a ser o desfecho correto no caso oposto — produto `visibilidade = 'cardapio'` **sem** próxima
  abertura (temporada encerrada ou cardápio desligado). Não é a mesma coisa que a v0.1.0 recusava, e
  a regra que separa os dois casos é RN-13. **Continua recusado:** sumir com o produto do menu, e
  sumir com produto de cardápio que tem volta marcada.
- ~~**Destaque visual do produto "do menu" dentro de um cardápio aberto.**~~ ⚠️ **Promovido ao
  escopo por D16 (v0.3.0):** cardápio aberto vira **seção própria no topo** do catálogo, e o produto
  aparece nela **e** na categoria dele. Ver RN-15, RN-16, fatias 18 e 19. Copy, cor e o tratamento do
  cabeçalho da seção continuam sendo do `desenhar`.
- **O sistema converter `visibilidade` sozinho.** Nem ao expirar, nem ao desligar, nem ao remover o
  último cardápio. Converter é gesto do lojista, sempre — o contrário venderia sopa de cebola em
  dezembro (RN-12).
- **Job/cron de expiração de cardápio**, coluna "expirado" mantida em dia, fila de reprocessamento.
  A vigência é avaliada **por request, no servidor**. Não há worker.
- **Cache do catálogo** (`revalidate`, `'use cache'`, ISR) para amortizar as duas queries novas. A
  vitrine é dado vivo por decisão documentada (`page.tsx:30-42`), e um cardápio que abre às 11:00
  tem que abrir às 11:00. Custo é assunto do `acelerar`, **depois** do `executar`.
- ~~**Cardápio como seção da vitrine.**~~ ⚠️ **Revogado por D16 (v0.3.0).** Cardápio **aberto** é
  seção — de **destaque**, no topo, aditiva. O que continua valendo da recusa original: cardápio
  **não é agrupador**, `categorias` continua sendo a estrutura do catálogo e a casa de cada produto,
  e a seção de destaque **não move** o produto para fora da categoria dele (D16-a). **Continua
  recusado:** cardápio fechado virar seção, produto sair da categoria ao entrar num cardápio, e
  cardápio substituir categoria como organização da vitrine.

### Fora por escopo de produto (v1)

- **Janela que cruza a meia-noite** (22:00 → 02:00). Recusada por CHECK, com erro explícito no form.
  O mesmo buraco existe hoje em `lojas.horarios` e lá é **mudo** (`lojaAberta.ts:78`) — aqui, pelo
  menos, é diagnosticável. Suportar a janela noturna exige mudar `cardapioAberto` **e** `lojaAberta`
  juntos, e isso é outra issue.
- **Mais de uma faixa de horário por cardápio** ("11:00–15:00 e 19:00–23:00"). Hoje, dois cardápios
  com a mesma lista de produtos resolvem, pela união (RN-05).
- **Regras de calendário além de dia-da-semana e dia-do-mês**: "último dia do mês", "toda primeira
  segunda", "dias úteis", feriados nacionais, exceções pontuais ("fechado no dia 25").
- **Gestão de cardápio no hub admin** (`/admin/assinantes/[lojaId]/*`). Lacuna de funcionalidade
  registrada em §Segurança, com a conversão para `SECURITY DEFINER` + T1–T7 já especificada para o
  dia em que entrar.
- **Ordenar ou priorizar produtos dentro do cardápio.** Dentro da seção de destaque os produtos
  saem na mesma ordem do catálogo (`produtos.ordem` dentro de `categorias.ordem`) — a seção não
  reordena nada.
- **UI de arrastar para reordenar CARDÁPIOS** (a ordem das seções de destaque entre si). A coluna
  `cardapios.ordem` **existe e é a chave de ordenação** (RN-15); o que fica fora da v1 é a tela de
  reordenar. Até lá, cardápio novo entra no fim (`max(ordem) + 1` na criação) e o desempate é
  determinístico. Quando entrar, reusa o padrão de `reordenar_categorias` — **não** inventa outro.
- **Limite de seções de destaque simultâneas.** Uma loja com seis cardápios abertos empurra o
  catálogo inteiro para baixo. A v1 **não** impõe teto: é decisão do lojista, e um teto arbitrário
  esconderia um cardápio que ele ligou de propósito. Fica como **nota para o `desenhar`**
  (`plan/design-promocoes-e-vigencia.md`) tratar o caso de muitas seções, e para o `acelerar` medir
  o peso do catálogo duplicado — **não** é licença para cachear (a trava de cache continua de pé).
- **Filtrar a vitrine por cardápio** (aba, chip de filtro, "ver só o Cardápio de Inverno"). D16 pede
  **seção**, que é aditiva; filtro é subtrativo e mudaria a navegação do catálogo. O trilho já leva
  à seção com um toque.
- **Seção de destaque no resultado de busca.** Decisão de RN-16, registrada aqui porque é o tipo de
  "melhoria" que alguém propõe depois: a busca mostra o produto **uma vez**, na categoria dele.
- **Notificar o cliente quando o cardápio abre** (push, e-mail, WhatsApp em massa). Depende de
  notificação em tempo real, que é **fase 2**, e de base de contatos, que o SaaS não mantém
  (`modelo-negocio.md` §8).
- **Histórico de vigências** ("este cardápio ficou aberto X horas no mês") e relatório de vendas por
  cardápio. Relatórios são **fase 3** (`modelo-negocio.md` §8).
- **Cardápio por zona de entrega, por tipo de entrega (retirada × entrega) ou por forma de
  pagamento.** Nenhum está em D2–D4.
- **Duplicar cardápio** ("copiar o Cardápio de Inverno de 2026 para 2027") e importar/exportar.
- **`supabase/seed.sql` com cardápios fictícios** — trabalho do agente `popular` na fase de
  implementação, não desta spec. Mas sem ele o `verificar` chega a um banco onde nenhum dos estados
  novos existe: produto dentro da janela, produto fora da janela recorrente, produto em cardápio de
  prazo fixo expirado e produto em dois cardápios. **D14 acrescenta dois estados obrigatórios ao
  seed**, sem os quais a metade nova da feature não é observável: **um produto `'cardapio'` com a
  temporada encerrada** (tem de sumir da vitrine e aparecer contado no painel) e **um produto
  `'menu'` dentro do mesmo cardápio expirado** (tem de continuar vendendo). **D16 acrescenta mais
  um:** um **cardápio aberto agora** com pelo menos dois produtos dentro, sendo um deles de uma
  categoria que também tem produto fora do cardápio — sem isso o `verificar` não consegue observar a
  seção de destaque, a duplicata de D16-a nem a ordem das seções.
