# Débito de infra — sessão 2026-07-08

Notas operacionais levantadas durante a implementação do toggle exibir/ocultar
imagens por categoria (PR #109). Não são features; são riscos/dívidas de ambiente
que valem acompanhamento.

## 1. Disco quase cheio (ambiente de dev)

O disco da máquina de desenvolvimento está próximo do limite. Impacto observado:
subir o Supabase local (`npx supabase start`) para regenerar tipos ou rodar testes
com container falha/arrisca falhar por falta de espaço. Nesta sessão os tipos de
`categorias.exibir_imagens` em `database.types.ts`/`types/supabase.ts` foram
adicionados **à mão** (seguindo o padrão de `produtos.disponivel/oculto`) porque o
container local não estava de pé — depois um agente confirmou via `gen types --local`
que o diff manual batia 1:1 com o schema real.

**Ação recomendada:** liberar espaço em disco antes da próxima issue de schema, para
poder rodar `npx supabase gen types typescript --local` sem improviso.

## 2. Rotação da `service_role` pendente

Débito conhecido de segurança (já registrado na memória do projeto): a chave
`service_role` do Supabase precisa ser rotacionada. Enquanto não rotaciona, todo
caminho admin que usa `createServiceClient()` (ex.: `alternarExibirImagensAdmin`,
`atualizarCategoriaAdmin`) opera com a chave atual. A isolação por tenant é feita
por construção (`escopo.atualizar` injeta `eq("loja_id", lojaId)`), então a rotação
não bloqueia a feature — mas segue como dívida aberta.

## 3. Deploy de migration no cloud — procedimento confirmado nesta sessão

Ao aplicar `20260708150000_categorias_exibir_imagens.sql`:

- `npx supabase migration list` mostrou histórico **sincronizado** (todo local ==
  remote), com a nova migration sendo a única com `remote` vazio, no topo. Ou seja,
  **não foi necessário `migration repair`** desta vez — o histórico não estava
  dessincronizado como em ocasiões anteriores.
- `npx supabase db push --dry-run` confirmou que só a nova seria aplicada, antes do
  push real.
- Sempre `npx supabase` (nunca pnpm). Nunca redirecionar saída de comando para
  arquivo `.ts`.

**Regra que se manteve verdadeira:** build/test verde ≠ coluna no cloud. O toggle só
funciona em runtime após o `db push` (senão `PGRST204 ... schema cache`).

---

Relacionado: `specs/toggle-imagens-por-categoria.md` (feature desta sessão).
