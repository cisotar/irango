# [260] Modo de seleção em `/painel/produtos` + `SeletorProdutosDoCardapio` + o diálogo com a prévia

**crítica:** NÃO
**Mundo:** painel
**Depende de:** [251] (`tasks/251-server-actions-de-lote-e-preverloteaction.md`) e [257] (`tasks/257-form-de-vigencia-recorrente.md`)
**Spec:** specs/cardapio-sazonal.md
**Decisões:** D2 · RN-09, RN-09-a, RN-10 · design §10.1, §10.2, §10.3, mecanismos M5 e M8
**Fatia:** 13

## Objetivo

Dar ao lojista a ação em lote de D2 nas **duas** superfícies que a pedem — a lista de produtos e
a tela do cardápio — com a confirmação dizendo **quantos e quais**, e com o número **dentro do
rótulo do botão**, vindo do servidor.

## Escopo

- [ ] `ProdutosClient` ganha `modoSelecao` + `Set<produtoId>` **no pai**, seguindo o desenho que
      `modoReordenar` (linha 304, issue 175) já fixou: estado no pai, a linha troca de aparência,
      uma barra de ação aparece;
- [ ] seleção de categoria = **par de botões `Selecionar os 12` / `Limpar`** no cabeçalho do
      grupo, **nunca checkbox tri-estado** (o `Checkbox` gerado renderiza `CheckIcon` fixo e
      "mixed" exigiria editar arquivo do shadcn CLI);
- [ ] barra de ação `fixed inset-x-0 bottom-0` (≥64px) no mobile, `sticky top` no desktop, com
      `aria-live="polite"` na contagem; sair por "Cancelar" ou ESC **limpa a seleção** e devolve
      o foco ao botão "Selecionar";
- [ ] `AlertDialog` de confirmação com a forma do design §10.2: até **3 nomes** no mobile e **6**
      no desktop + "e mais N" + `[ Ver todos ]` abrindo a lista rolável **dentro do mesmo
      diálogo**; a frase de vigência vinda de `descreverVigencia`; o aviso de que "categoria
      inteira" é **foto** (*"São os 12 produtos de Pizzas de hoje. Produtos criados depois não
      entram sozinhos."*) e, quando houver, *"2 deles estão ocultos e continuam ocultos"*;
- [ ] **`previa` é prop OBRIGATÓRIA e vem do servidor** (`preverLoteAction`, M8): o diálogo não
      existe antes de a prévia chegar; enquanto ela está em voo, o botão mostra `Loader2`;
- [ ] **o número vai dentro do rótulo do botão** — `Adicionar 12 produtos`, **nunca "Confirmar"**;
- [ ] `src/lib/utils/copiaLotePromocao.ts` — módulo **puro** com
      `perguntaLote({ acao, nomeCardapio, nomes, total })
      : { titulo; corpo; rotuloConfirmar }`, com teste ao lado (sem jsdom, copy só é travável
      fora do componente);
- [ ] `SeletorProdutosDoCardapio` em `/painel/cardapios/[cardapioId]` — lista da loja agrupada
      por categoria, checkbox por produto e "selecionar categoria inteira", **compartilhando a
      mesma Server Action** da barra de `/painel/produtos` (RN-09);
- [ ] alvo de toque `min-h-[44px] min-w-[44px]` **literal**, e a régua registrada em
      `design-system.md` §5: **linha que ganha checkbox soma ~44px de chrome; em 360px comprime,
      não estoura.**

## Fora de escopo

As ações "Marcar como exclusivo de cardápio" / "Devolver ao menu" e o badge de D14 (issue 261) —
esta issue entrega o **modo** e a barra; a 261 acrescenta dois botões nela. A trava cross-tenant
está na issue 251, não aqui. Pilha de "desfazer": não há undo, há a **mesma ação ao contrário**
(`Remover do cardápio`), e isso **não** é dito na confirmação — seria ruído.

## Reuso esperado

- `ProdutosClient` e `agruparPorCategoria` (linha 166) — **modificar**, não reescrever.
- `modoReordenar` (issue 175) — o precedente de "modo" que esta issue copia em forma.
- A barra fixa do carrinho em `VitrineClient` — a forma da barra de ação.
- `alcance-do-grupo.ts` — precedente de **copy pura com teste**, a forma de `copiaLotePromocao.ts`.
- `Checkbox`, `Button`, `Badge`, `AlertDialog` de `components/ui/`; `npx shadcn add alert-dialog`
  se ainda não existir.
- `descreverVigencia` (issue 254) para a frase de janela do diálogo.

## Segurança

- **A seleção é intenção, não permissão.** Nada no cliente autoriza coisa alguma; a trava é a FK
  composta + a RLS + o `loja_id` da sessão (issues 243 e 251).
- **A contagem nunca é do cliente** (RN-09-a): a seleção pode estar velha ou conter id de outra
  loja, e só o servidor resolve nomes sob RLS. `previa` obrigatória é a única trava possível sem
  jsdom.
- A prévia não distingue id alheio de id inexistente — anti-oráculo (§14).

## Critério de aceite

- [ ] `perguntaLote` tem teste próprio afirmando título, corpo e **rótulo do botão com o número**;
- [ ] `grep` prova que nenhum componente calcula `total` a partir do `Set` do cliente;
- [ ] o diálogo não renderiza sem `previa` (prop obrigatória, erro de `tsc` se omitida);
- [ ] ESC limpa a seleção e devolve o foco;
- [ ] em 360px a linha com checkbox não estoura;
- [ ] `npx tsc --noEmit` → `npm run lint` → `npm test` → `npm run build`.
