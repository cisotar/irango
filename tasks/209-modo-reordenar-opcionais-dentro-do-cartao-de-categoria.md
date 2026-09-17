# [209] Modo "Reordenar" dos opcionais dentro do cartão de categoria de produto

**crítica:** NÃO
**Mundo:** painel + hub admin
**Depende de:** [208]
**Spec:** specs/opcionais-sanfona-e-ordenacao.md (v0.2.0)

## Objetivo

Dar ao lojista o drag & drop dos grupos de opcional **dentro do cartão de cada categoria de
produto**, na seção "Opcionais por categoria de produto", chamando a Server Action entregue
na 208. Paridade no hub admin pela variante escopada por `lojaId`.

Não é crítica: nenhuma decisão de valor nem de permissão mora aqui. A ordem só é verdade
depois do servidor gravar (RN-3) — a lista já vem filtrada por RLS no SSR, e a autorização
foi provada na 208.

## Escopo

- [ ] `CartaoAssociacao` (dentro de
      `src/app/(painel)/painel/(bloqueavel)/produtos/opcionais/OpcionaisClient.tsx`):
      estado "modo reordenar" **por cartão**. Fora do modo, a grade de checkboxes de hoje;
      dentro do modo, a lista arrastável **só dos grupos marcados naquela categoria**.
      Botão "Reordenar" **desabilitado com menos de 2 grupos marcados** (nada a ordenar).
- [ ] `OpcionaisClientAcoes` (`OpcionaisClient.tsx:55`) ganha a chave
      **obrigatória** `reordenarOpcionaisDaCategoria` — **sem default**, padrão da issue 160:
      omitir tem que quebrar o build, não cair silenciosamente na action do lojista.
- [ ] `OpcionaisAdminClient.tsx`
      (`src/app/admin/assinantes/[lojaId]/produtos/opcionais/`) injeta
      `(payload) => reordenarOpcionaisDaCategoriaAdmin(lojaId, payload)`, como já faz com as
      8 actions existentes.
- [ ] Componente de reordenação em `src/components/painel/`:
      - envia sempre `categoria_id` + a **sequência completa de ids de grupo daquela
        categoria**, nunca um delta e **nunca número de `ordem`** (RN-4)
      - preview otimista via `moverPorDeslocamento` (deslocamento, não troca de pares)
      - teclado: `KeyboardSensor` + `sortableKeyboardCoordinates`, anúncio em pt-BR por
        `mensagemPosicao` ("Molhos movida para a posição 2 de 4")
      - salvamento coalescido (`criarSalvamentoCoalescido`, debounce 500 ms, fila, flush)
      - handle imperativo `finalizar()` (`useImperativeHandle`, como
        `ManipuladorReordenarCategorias` em `ReordenarCategorias.tsx:97`): sair do modo
        (Concluir / ESC) **aguarda o flush** antes de desmontar e de `router.refresh()`
      - falha → `toast` (sonner) com a mensagem genérica da action, **sem perder o estado
        local**
- [ ] **Decisão de arquitetura que esta issue tem que fechar antes de escrever o arquivo**
      (delegada pelo spec ao `planejar`): extrair o miolo genérico de
      `src/components/painel/ReordenarCategorias.tsx` (393 linhas) para um componente
      parametrizado por rótulo/linha, **ou** criar um irmão.
      Critério: se a duplicação passar de ~150 linhas de a11y/coalescência, **extrai**; se a
      extração exigir mexer no comportamento já entregue e testado da 175
      (`ReordenarCategorias.test.tsx`), **não extrai e registra o débito** em
      `architecture.md` §10. Duplicar ~380 linhas de acessibilidade em pt-BR é exatamente o
      que o mandato "não reinventar a roda" existe para evitar.
- [ ] `LinhaCategoriaReordenavel.tsx`: generalizar o prop para `{ id, nome, detalhe? }` se
      hoje tipar `Categoria` de produto. **Preservar as duas travas de a11y documentadas no
      cabeçalho do arquivo**: limites com `aria-disabled` + `onClick` no-op (nunca
      `disabled` real) e alvos de 44px literais.

## Fora de escopo

- Migration, RPC, schema zod, Server Actions, RN-12 → issue **208**.
- Sanfona do `ProdutoModal` e ordenação da vitrine → issue **210**.
- **A "Biblioteca de opcionais" não muda** — não tem contexto de categoria de produto e
  portanto não tem ordem a definir (Decisão D-1). O texto de apoio que explica a
  divergência painel × vitrine é mitigação registrada no spec, não escopo desta issue.
- Drag & drop dos itens dentro de um grupo — v2.

## Reuso esperado

- `src/lib/utils/reordenar.ts` — `moverPorDeslocamento`, `mensagemPosicao`. **Já coberto por
  `reordenar.test.ts`: reusar, não recriar e não reteste.**
- `src/lib/utils/salvamento-coalescido.ts` — `criarSalvamentoCoalescido`
- `src/components/painel/ReordenarCategorias.tsx` — padrão a espelhar ou a extrair
- `src/components/painel/LinhaCategoriaReordenavel.tsx` — reuso, generalizado
- `@dnd-kit` (`DndContext`, `SortableContext`, `PointerSensor`, `KeyboardSensor`) — já em
  `package.json`
- `Card`, `CardContent`, `Button`, `Badge`, `Separator`, `toast` (sonner) — primitivos
  existentes. **`components/ui/` é gerado pelo shadcn CLI: não editar à mão.**

## Segurança

- Sem valor monetário e sem tabela nova. Nenhuma política RLS tocada.
- O cliente manda **ids**, nunca `ordem`; o escopo (`loja_id`) é derivado no servidor. Se
  esta issue precisar mandar qualquer outra coisa para a action, é sinal de erro de desenho
  — a action da 208 não deve mudar.
- Falha de salvamento mostra **uma** mensagem genérica na UI; detalhe fica no log do
  servidor.

## Critério de aceite

- [ ] Com 2+ grupos marcados numa categoria de produto, o botão "Reordenar" troca a grade de
      checkboxes pela lista arrastável dos marcados; com 0 ou 1, fica desabilitado
- [ ] Arrastar reordena a lista local imediatamente e agenda um salvamento coalescido com a
      sequência completa de ids
- [ ] Mover por teclado (espaço + setas) funciona e anuncia a posição em pt-BR
- [ ] Sair do modo (Concluir / ESC) aguarda o flush antes do `router.refresh()` — o último
      movimento não se perde
- [ ] Erro da action → toast genérico, estado local preservado
- [ ] Omitir `reordenarOpcionaisDaCategoria` em `OpcionaisClientAcoes` **quebra o build**
- [ ] Teste de render sem jsdom (`renderToStaticMarkup`) do cartão nos dois modos
- [ ] `npx tsc --noEmit`, `npm run lint`, `npm test`, `npm run build` verdes
- [ ] Checkpoint humano (não há Playwright nem MCP de browser nesta máquina): arrastar por
      toque no celular em "Lanches base", recarregar e ver a ordem mantida
