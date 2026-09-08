## Plano Técnico

### Estado real do código (IMPORTANTE — issue já majoritariamente implementada)
Ao explorar `src/components/vitrine/ProdutoModal.tsx`, o reflow desktop JÁ EXISTE e
está mais avançado do que o escopo descreve:

- O `DialogContent` já usa `md:max-w-3xl md:h-[min(560px,calc(100dvh-2rem))] md:flex-row`
  (não `md:max-w-2xl` como pedia a issue) — layout paisagem de 2 colunas funcionando.
- A coluna esquerda (`md:flex`, `md:w-[44%]`) já renderiza imagem em destaque +
  descrição abaixo com scroll próprio; some no mobile.
- A coluna direita já tem header (faixa primária), corpo rolável (quantidade +
  opcionais) e footer fixo (subtotal preview + CTA).
- `foto_url` já é validada `https://` via `fotoSegura()` (linha 47-50), atendendo §174.

Portanto esta issue NÃO é mais um build do zero. Vira uma issue de
**reconciliação/verificação**: decidir se o estado atual (`md:max-w-3xl`) é aceito
como cumprimento do critério, ou se há um ajuste fino pendente, e atualizar a issue/spec
para refletir a realidade. Não reescrever um layout que já está pronto e em produção
(commits recentes `feat(vitrine): clique em qualquer área do card abre modal`).

### Análise do Codebase
O que já existe e será reusado (NADA novo a criar):
- `src/components/vitrine/ProdutoModal.tsx` — o modal completo, com layout responsivo
  já implementado. Único arquivo candidato a toque (e provavelmente nenhum toque).
- `src/components/ui/dialog.tsx` (shadcn) — primitivo `Dialog/DialogContent/DialogTitle`.
  Default `max-w-md` (~448px), sobrescrito pelo `className` do modal. NÃO editar à mão.
- `src/lib/utils/formatarMoeda.ts` — formatação de moeda (reuso, já importado).
- `src/lib/utils/calcularTotal.ts` (`calcularSubtotal`) — subtotal PREVIEW (reuso, já importado).
- `src/lib/supabase/queries/produtos.ts` (`GrupoOpcional`) — tipo dos grupos (reuso, já importado).
- `next/image` com `unoptimized` — imagem remota (reuso, já usado).

Correção a um pressuposto da issue:
- `ListaOpcionaisItem.tsx` NÃO é usado por este modal. O modal renderiza os opcionais
  inline (stepper por opcional). `ListaOpcionaisItem` é consumido por `Carrinho.tsx`,
  `EtapaItens.tsx` e `confirmacao/page.tsx`. A linha do escopo "reusar `ListaOpcionaisItem`
  sem alteração interna" é factualmente incorreta para o modal — manter o componente
  inalterado é trivialmente satisfeito (não é tocado).

### Cenários
**Caminho Feliz (verificação):**
1. Abrir a vitrine em viewport mobile (< 768px) → modal estreito, conteúdo empilhado.
2. Abrir em viewport desktop (≥ 768px) → modal largo paisagem, imagem à esquerda,
   detalhes/opcionais à direita, cada coluna com seu scroll.
3. Ajustar quantidade e opcionais → subtotal PREVIEW atualiza igual nos dois layouts.
4. Clicar "Adicionar ao carrinho" → `onAdicionar(produtoId, quantidade, opcionais)` é
   chamado e o modal fecha, idêntico nos dois layouts.

**Casos de Borda (todos já tratados no código atual):**
- Produto sem `descricao` → bloco de descrição não renderiza (`descricao ? ... : null`).
- `foto_url` não-`https://` ou nula → `fotoSegura` retorna null, cai no fundo gradiente.
- Produto indisponível (`disponivel: false`) → selo "Esgotado", CTA desabilitado,
  steppers travados, imagem em grayscale.
- Sem grupos de opcional → seção Opcionais não renderiza.
- Descrição longa no desktop → scroll próprio na coluna esquerda, não vaza viewport.

**Tratamento de Erros:** nenhum I/O ou Server Action nesta camada — é apresentação
pura. Sem mensagens de erro novas; `seguranca.md` §14 não se aplica (nada a logar).

### Schema de Banco
Não se aplica. Nenhuma tabela tocada, nenhuma migration, nenhuma RLS nova.

### Validação (zod)
Não se aplica. Nenhum formulário submetido, nenhum payload novo. Os opcionais saem
do componente como dados de PREVIEW; o servidor já recalcula tudo no checkout
(`seguranca.md` §10) por código existente fora do escopo.

### Recálculo no Servidor
Não se aplica diretamente, mas a invariante é PRESERVADA: o subtotal exibido é
PREVIEW (`calcularSubtotal`), e `onAdicionar` propaga só `produtoId + quantidade +
opcionais` para o `useCarrinho`. Nenhum valor monetário daqui é autoritativo — o
checkout/Server Action recalcula do banco. Esta issue não pode introduzir nenhum
caminho que confie em valor calculado no cliente. (Mapeamento da tabela cliente↔servidor:
linha "Valor monetário" → recálculo na Server Action do checkout, já existente, intocado.)

### Arquivos a Criar / Modificar / NÃO tocar
- CRIAR: nenhum.
- MODIFICAR: `src/components/vitrine/ProdutoModal.tsx` — SOMENTE se a verificação
  apontar divergência real entre o comportamento atual e o critério de aceite
  (ex.: alinhar `md:max-w-3xl` vs. `md:max-w-2xl` da spec §66). Decisão recomendada:
  aceitar `md:max-w-3xl` atual e atualizar a spec/issue, em vez de regredir o layout.
- NÃO TOCAR:
  - `src/components/ui/dialog.tsx` — primitivo shadcn, não se edita à mão.
  - `src/components/vitrine/ListaOpcionaisItem.tsx` — fora do fluxo do modal.
  - `src/lib/utils/*`, `src/lib/supabase/queries/produtos.ts` — reuso sem alteração.

### Dependências Externas
Nenhuma nova. `next/image`, `lucide-react`, shadcn `Dialog` (Radix) já no `package.json`.

### Ordem de Implementação
Issue NÃO crítica (sem dinheiro/RLS/auth) → sem fase RED obrigatória.
1. Verificar o modal real nos breakpoints mobile/desktop (`/verificar`) contra o
   critério de aceite — provavelmente já passa.
2. Conciliar a discrepância de largura: aceitar `md:max-w-3xl` e atualizar
   spec §66 / esta issue (recomendado), OU justificar e ajustar para `md:max-w-2xl`.
3. Corrigir o pressuposto de reuso de `ListaOpcionaisItem` (não se aplica ao modal).
4. Fechar a issue. Nenhum código de produção novo previsto.
