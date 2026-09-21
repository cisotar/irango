# [285] Terceiro botão "Remover produtos" com segunda confirmação no diálogo de remoção

**crítica: NÃO** — só UI; a autorização e o escopo são da 284 (Server Action).

**Mundo:** `src/app/(painel)/painel/(bloqueavel)/cardapios/CardapiosClient.tsx` (reusado pelo
hub admin via `CardapiosAdminClient.tsx`).
**Depende de:** [284] (as actions `remover(id, modo)` precisam existir).
**Spec:** `specs/remocao-cardapio-exclusivos.md` — Páginas e Rotas, Mensagens.

## Origem

Ver [284]. O bloco de recusa âmbar hoje só oferece "Converter para o menu". Passa a oferecer os
três modos no mesmo `AlertDialog` destrutivo já existente.

## Escopo

- [ ] `src/components/painel/frasesCardapio.ts` ganha as cinco funções puras da spec
      (`rotuloArquivar`, `rotuloRemoverProdutos`, `fraseArquivar`, `fraseCascataPermanente`,
      `rotuloConfirmarCascata`), com teste literal singular/plural ao lado.
- [ ] Bloco de recusa em `CardapiosClient.tsx` ganha o segundo botão ("Arquivar os N produtos",
      `acoes.remover(id, "arquivar")`, sem segunda confirmação) e o terceiro (destrutivo,
      "Remover os N produtos") que **não** executa nada — troca o bloco para o estado de segunda
      confirmação com `fraseCascataPermanente(n)` e os botões "Cancelar" / "Apagar N produtos e
      remover o cardápio".
- [ ] Confirmar a segunda vez chama `acoes.remover(id, "cascata")`.
- [ ] Toasts de sucesso: "Produtos arquivados e cardápio removido." / "Produtos apagados e
      cardápio removido."
- [ ] `AcoesCardapios`/`contrato-lote.ts` reflete a nova assinatura de `remover`; nenhum wrapper
      admin fica sem a prop (gate: `enforcement-props-action-admin.test.ts`, auto-descoberta).
- [ ] Nenhum componente novo em `components/ui/`; reusa o `AlertDialog` já montado.

## Fora de escopo

Mockup novo (o `AlertDialog` já é o padrão destrutivo do projeto); mudar a mensagem de recusa
inicial (`/polir` depois do merge, ver spec).

## Critério de aceite

- [ ] Cinco funções puras de `frasesCardapio.ts` com teste literal.
- [ ] Render do bloco de recusa com N exclusivos mostra os três botões corretos (via
      `renderToStaticMarkup`, sem jsdom).
- [ ] `rotaCardapiosInjetada.test.tsx` e `enforcement-props-action-admin.test.ts` continuam verdes
      sem edição de lista.
- [ ] `npx tsc --noEmit` → `npm run lint` → `npm test` → `npm run build`.
