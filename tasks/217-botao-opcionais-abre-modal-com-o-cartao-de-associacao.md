# [217] O botão "Opcionais" abre modal tela cheia / Dialog largo com o cartão de associação

**crítica:** NÃO
**origem:** `plan/loop-refat-modal-de-opcionais-por-categoria.md`.
**depende de:** 216. É a última da sequência.

## Problema

O botão "Opcionais" do cabeçalho de cada categoria de produto abre hoje uma `Sheet` lateral
(`src/app/(painel)/painel/(bloqueavel)/produtos/ProdutosClient.tsx`, linhas ~699-736) contendo
só `SeletorOpcionaisCategoria`: uma lista de checkbox e um botão Salvar. O usuário rejeitou
esse container **por UX** — estreito demais no mobile para a sanfona que a 216 entrega.

## Escopo

Trocar a `Sheet` por **Dialog largo no desktop e modal tela cheia no mobile**, espelhando o
`useMediaQuery("(min-width: 768px)")` que o `FormProduto` já usa nas linhas ~661-695 **do
mesmo arquivo**, e renderizar dentro dele o `CartaoAssociacaoOpcionais` da 214, já com a
sanfona da 216. `SeletorOpcionaisCategoria` sai.

Junto, nesta mesma issue porque é a troca de container que as torna necessárias:

- **carregar `buscarOpcionaisDoLojista` em `produtos/page.tsx`** (hoje ausente), como **quarto
  ramo do `Promise.all` que já existe** — não em sequência;
- **injetar as actions novas no `acoes`** do painel **e** na via admin
  (`src/app/admin/assinantes/[lojaId]/produtos/CardapioAdminClient.tsx`) na **mesma** mudança:
  props de action são obrigatórias sem default desde a issue 160, e omitir uma quebra o build
  — que é o comportamento desejado, não um acidente;
- **acrescentar `/painel/produtos` aos `revalidatePath`** de `src/lib/actions/opcional.ts`.
  Hoje `CAMINHO_PAINEL` (linha 27) é só `/painel/produtos/opcionais`, usado em 10 pontos
  (96, 128, 151, 190, 229, 252, 270, 369, 439). Sem isso o sintoma é "editei e não atualizou",
  e só aparece em runtime.

- **relocar `CategoriaProduto` e `OpcionaisClientAcoes` para um módulo neutro.** Hoje o
  `CartaoAssociacaoOpcionais` importa os dois **de volta** de `OpcionaisClient.tsx` (rota),
  porque na 214 eles ainda tinham outros consumidores lá e movê-los teria estourado o escopo
  daquela issue. Esta issue introduz o **segundo** consumidor do cartão, que é o gatilho certo:
  um componente em `components/painel/` não deve depender de um arquivo de rota, ainda mais de
  uma rota que não é a dele. Apontado pelo `revisar` na 214, com o precedente
  `src/components/painel/DetalhePedido.tsx:28` (mesma inversão, já existente).

## Fora de escopo

Qualquer mudança de comportamento do cartão — ele chega pronto da 216. A página
`/painel/produtos/opcionais` continua existindo como está.

## Critério de aceite

- [ ] o botão "Opcionais" abre Dialog largo no desktop e modal tela cheia no mobile;
- [ ] o modal renderiza o mesmo cartão da página, com a sanfona de itens funcionando;
- [ ] `SeletorOpcionaisCategoria` removido, sem código morto sobrando;
- [ ] `produtos/page.tsx` carrega os opcionais no `Promise.all` existente, não em sequência;
- [ ] via admin compila e funciona com as actions escopadas por `lojaId`;
- [ ] editar item pelo modal reflete em `/painel/produtos` sem recarregar à mão;
- [ ] a ordem gravada aparece na vitrine `/loja/[slug]`;
- [ ] `npx tsc --noEmit` → `npm run lint` → `npm test` → `npm run build`, todos verdes.
