# [216] Sanfona de itens no cartão de opcionais: ver, criar, editar, remover e reordenar

**crítica:** NÃO — reusa Server Actions já validadas. Mas leva `auditar`: a superfície é nova e escreve **preço**.
**origem:** `plan/loop-refat-modal-de-opcionais-por-categoria.md`.
**depende de:** 214 (cartão extraído) e 215 (RPC de ordem dos itens).

## Problema

O cartão de associação mostra quais grupos de opcional entram em cada categoria de produto e
em que ordem, mas não mostra **o que tem dentro de cada grupo**. Para editar um item, o
lojista precisa sair para a aba "Biblioteca", achar o grupo, achar o item e voltar — e a
ordem do item só se define digitando um número.

## Escopo

Entregar os itens 3 e 4 do pedido do usuário **dentro de `/painel/produtos/opcionais`**, que
já renderiza o cartão hoje. A troca de container é da 217, de propósito: feature nova e
container novo não falham no mesmo diff.

Cada grupo marcado, ao abrir a sanfona, lista seus opcionais com:

- nome e preço **editáveis inline**;
- botão de adicionar opcional ao grupo;
- remoção com **aviso de alcance** e confirmação **inline na própria linha** — a linha vira
  "Remover 'Catupiry'? Ele sai de 3 categorias de produto. [Cancelar] [Remover]". Nada de
  `AlertDialog`: na 217 esse cartão passa a viver dentro de um modal, e confirmação em modal
  aninhado é armadilha de foco e de `Escape`;
- reordenação por **setas ↑↓ e teclado, sem alça de arrasto**.

**Por que sem arrasto:** os grupos já são arrastáveis, então uma lista arrastável dentro deles
seria `DndContext` dentro de `DndContext`, com o `pointerdown` da alça interna borbulhando
para o sensor externo. E há um buraco de verificação real: sem Playwright e sem MCP de browser
nesta máquina (issue 176), **nenhum agente consegue testar gesto de toque**. Setas e teclado
são testáveis em Vitest; arrasto aninhado não seria.

Isso exige a prop nova **`semArrasto`** no `ModoReordenar` (~10 linhas): a prop existente
`arrastoBloqueado` deixa alça **e** setas inertes, que não é o que se quer aqui. E a casca
`ReordenarItensDoGrupo.tsx`, espelhando `ReordenarOpcionaisDaCategoria.tsx` (115 linhas).

**Alcance da edição (decisão do usuário):** editar nome/preço ou remover vale para **todo
lugar que usa o grupo** — a biblioteca é da loja, e não existe "Coca só de Pães". A UI diz
isso no momento da ação, não em texto de ajuda.

### Desempate na leitura — pré-requisito, não enfeite

Achado pelo `arquitetar` na 215 e conferido no código: `buscarOpcionaisDoLojista`
(`src/lib/supabase/queries/opcionais.ts:52`) ordena **só por `ordem`, sem desempate**, e
`opcionais.ordem` é `int not null default 0` (`supabase/migrations/20260614007500_opcionais.sql:49`)
— ou seja, todas as linhas existentes hoje têm `ordem = 0`. O `sort` de itens em
`src/lib/supabase/queries/produtos.ts:260` tem o mesmo buraco, enquanto o dos grupos não.

Sem um segundo critério estável o Postgres pode devolver ordens diferentes entre requisições:
o SSR e o cliente divergem, e **o primeiro arrasto grava uma permutação que o lojista não
pediu** — exatamente o risco que `buscarAssociacoesOpcional` (`:62-67`, logo abaixo) já
documenta e resolve para os grupos, com desempate por `categoria_opcional_id`.

Acrescentar o mesmo desempate nas duas leituras **antes** de ligar a reordenação de itens.
É pré-requisito da RPC da 215 funcionar como o lojista espera, não polimento.

## Fora de escopo

O modal e a troca de container (217). Preço ou ordem por produto — o usuário rejeitou.
Criar ou remover **grupos** de dentro da sanfona: isso segue na aba Biblioteca.

## Critério de aceite

- [ ] abrir um grupo marcado lista seus opcionais na ordem gravada, inativos incluídos;
- [ ] criar, editar (nome e preço) e remover item funcionam sem recarregar a página;
- [ ] remoção pede confirmação **inline** e mostra em quantas categorias de produto o item
      deixa de aparecer;
- [ ] reordenar item por setas e por teclado grava via a RPC da 215;
- [ ] prop `semArrasto` no `ModoReordenar` sem regressão nos usos existentes
      (`ReordenarCategorias`, `ReordenarOpcionaisDaCategoria`);
- [ ] acessibilidade: alvos de 44px, foco visível, anúncio em região viva em pt-BR, WCAG AA;
- [ ] testes cobrindo criar/editar/remover/reordenar e o aviso de alcance;
- [ ] `npx tsc --noEmit` → `npm run lint` → `npm test` → `npm run build`, todos verdes.
