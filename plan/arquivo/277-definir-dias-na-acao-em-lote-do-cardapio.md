## Plano Técnico

### Análise do Codebase

O que já existe e será **reusado**:

- `src/components/painel/useLoteDeProdutos.tsx` — o ciclo inteiro: `prever` → diálogo → `confirmar`. A **ordem é inegociável (M8): prévia primeiro**; o diálogo só é montado com a resposta do servidor em mãos. Já tem `prevendo`/`pendente`, o teto `TETO_LOTE` com `MSG_TETO`, e o toast de erro vindo da action.
- `src/components/painel/DialogoLoteCardapio.tsx` — `AlertDialog` (não `Dialog`: o gesto muda o que a vitrine mostra para todos os clientes), `previa` **obrigatória** (a trava possível sem jsdom), lista de nomes com "Ver todos", `alvo.cardapio.descricao` já redigida no servidor. **Nenhuma frase é escrita neste arquivo e nenhum número é calculado aqui** — continua assim.
- `src/lib/utils/copiaLotePromocao.ts` — `perguntaLote`, `perguntaVisibilidade`, `fraseEMais`, `frasesDeVisibilidade`, `plural`. O número vai **dentro** do rótulo do botão (trava 1 do design §10.2).
- `src/components/painel/lote-contagem-do-servidor.test.ts` — trava de fonte **auto-descoberta**: varre todo arquivo que importa `utils/copiaLotePromocao` e prova que `total` nunca vem de `.length`/`.size` local. Frase nova entra na varredura sozinha.
- `src/components/painel/contrato-lote.ts` — `AcoesLote` já ganhou `definirDias` em [276]; **nenhuma action nova**.
- `src/components/painel/PilulasDeDias.tsx` ([275]) com `compacto`.
- `src/components/painel/agendaDoVinculo.ts` ([276]) — `payloadDeDias`.
- `src/lib/actions/cardapio-contrato.ts` — `MSG_DIAS_DO_VINCULO`, `MSG_GENERICA_LOTE`.

O que **precisa ser criado**:

- `perguntaDias(...)` em `copiaLotePromocao.ts` (função, não módulo) e `podeDefinirDias` / `payloadsDeDiasEmLote` em `agendaDoVinculo.ts`. Justificativa do desenho §8-G: **não é uma segunda redação de confirmação** (que a spec proíbe) — é a redação da **ação nova**, no mesmo módulo puro, no mesmo formato, varrida pela mesma trava de fonte.

### Decisões de escopo que este plano fixa

**A ação "Definir dias" existe só no `SeletorProdutosDoCardapio`** (detalhe do cardápio, lojista + admin), **não** na `BarraSelecaoLote` de `/painel/produtos`. Dois motivos, ambos estruturais: ali o cardápio é **um só e conhecido** (a barra de produtos escolhe o destino por menu), e a decisão B aprovada exige saber, por produto, se ele já está **neste** cardápio — informação que só `ProdutoDoSeletor.noCardapio` carrega.

**Decisão B (aprovada na sessão):** "Definir dias" fica **habilitado só com a seleção inteira já vinculada** a este cardápio, mais a frase no corpo do diálogo. Motivo: a prévia conta **produtos**, a escrita alcança **vínculos**; selecionando 12 dos quais 4 não estão no cardápio, o botão diria "12" e 4 escritas terminariam em `count === 0`. Mudar a contagem da prévia está fora do escopo desta issue.

**Fan-out de N escritas, não uma instrução.** A issue decide isso explicitamente ("a escrita é a de [274] aplicada aos pares selecionados"; critério: "N escritas escopadas"). É a **única divergência** do princípio "o lote é UMA instrução" que vale registrar — e ela é segura porque cada escrita é individualmente escopada pela tripla com `count: "exact"`. A consequência assumida é **atomicidade parcial**: ver "Casos de borda".

### Cenários

**Caminho feliz**
1. Lojista seleciona 12 produtos, todos já no cardápio. "Definir dias" habilita.
2. Clique → `preverLoteAction({produto_ids})` roda (o mesmo caminho das outras ações); `Loader2` no botão.
3. Diálogo abre com a prévia do **servidor**: "Definir os dias em 12 produtos?", os nomes, a `descricao` do cardápio e a frase "Só vale para quem já está neste cardápio."
4. Foco inicial vai para a **primeira pílula** (é o campo que o lojista veio preencher), não para "Cancelar".
5. Marca Qua e Sáb; o rótulo do botão lê **"Definir os dias em 12 produtos"**.
6. Confirma → 12 chamadas de `acoes.definirDias` com `{cardapio_id, produto_id, dias_semana:[3,6]}`; toast único "Dias atualizados."; `onConcluido()` limpa a seleção e dá `router.refresh()`.

**Casos de borda**
- **Nenhuma pílula marcada:** rótulo vira **"Voltar 12 produtos para todos os dias"** (redação em `copiaLotePromocao.ts`, nunca no `.tsx`). Grava `[]`, que o servidor normaliza para `NULL`.
- **Seleção com produto fora do cardápio:** botão **desabilitado**, com `title`/texto de apoio dizendo por quê. Predicado puro `podeDefinirDias`.
- **`previa.total === 0`** (a seleção inteira sumiu sob a RLS): o botão de confirmação já desabilita hoje; o rótulo de `perguntaDias` com `total === 0` não pode prometer escrita — devolve "Nada a alterar", como as outras duas funções de copy.
- **Seleção acima de `TETO_LOTE`:** `MSG_TETO` já barra na prévia, antes de qualquer diálogo. O fan-out fica limitado pelo mesmo teto.
- **Falha parcial** (`Promise.allSettled`: 9 ok, 3 recusados por corrida): política fixada aqui — o diálogo **permanece aberto**, `toast.error(MSG_DIAS_DO_VINCULO)`, e o `router.refresh()` acontece **mesmo assim**, para a tela voltar a mostrar a verdade do banco. Sem contagem parcial na mensagem: o servidor não tem número confiável nesse instante (mesmo argumento de `MSG_EXCLUSIVOS_SEM_NUMERO`).
- **Falha total (rede):** idem — uma frase, diálogo aberto, dias preservados.
- **Escrita em voo:** `desabilitado={pendente}` no grupo de pílulas; os dois botões do rodapé já desabilitam hoje.
- **ESC / clique fora:** `onOpenChange` já roteia para `onCancelar`, que só fecha se `!pendente`.

**Tratamento de erros:** `MSG_DIAS_DO_VINCULO`, a frase própria de [274] — e **não** `MSG_GENERICA_LOTE`, cujo texto ("não foi possível aplicar o cardápio aos produtos selecionados") descreveria uma operação que não aconteceu. Detalhe só no log do servidor.

### Schema de Banco

**Nenhuma mudança.** Nenhuma tabela, nenhuma policy, nenhuma migration.

### Validação (zod)

`schemaDiasDoVinculo` por escrita — o **mesmo** schema `.strict()` do form de [276] e das duas Server Actions. O lote não ganha schema próprio: ele é N aplicações do payload de um.

### Recálculo no Servidor

Sem valor monetário. As invariantes e suas camadas:

| Invariante | Camada |
|---|---|
| **alcance** do lote (quantos e quais) | `preverLoteAction` / `preverLoteAdmin` — **servidor**, sob RLS. O cliente nunca conta; travado por `lote-contagem-do-servidor.test.ts` |
| posse de cada vínculo | UPDATE pela tripla com `count: "exact"` em `definirDiasDoVinculo` ([274]) + RLS |
| posse no mundo admin | `validarLojaIdAdmin` + `escopo.atualizarPorChave` + auditoria |
| representação dos dias | `normalizarDiasDoVinculo`, no servidor |
| "toda a seleção está vinculada" (decisão B) | **UI apenas** — é conveniência, não autoridade. Se o cliente burlar, cada par não vinculado simplesmente recebe `count === 0` e a recusa genérica. Nenhuma escrita indevida é possível. |

### Arquivos a Criar / Modificar / NÃO tocar

**Modificar**
- `src/lib/utils/copiaLotePromocao.ts` — `perguntaDias({ nomeCardapio, nomes, total, dias })` devolvendo `CopiaDoLote` + a frase de apoio de decisão B. **Não** estender `AcaoLote` (`"adicionar" | "remover"`), que é consumido por `BarraSelecaoLote` e forçaria um caso morto lá.
- `src/lib/utils/copiaLotePromocao.test.ts` — rótulo com o número dentro nos dois sentidos, `total === 0`, singular/plural.
- `src/components/painel/agendaDoVinculo.ts` — `podeDefinirDias(produtos, selecionados)` e `payloadsDeDiasEmLote(cardapioId, produtoIds, dias)`; testes ao lado (é assim que "N escritas escopadas" fica afirmável sem jsdom).
- `src/components/painel/DialogoLoteCardapio.tsx` — terceira variante de `AlvoDoLote`: `{ tipo: "dias"; cardapio; dias: number[]; onDias: (d:number[])=>void }`; renderiza `<PilulasDeDias compacto>` no corpo. Continua sem redigir uma frase e sem calcular um número.
- `src/components/painel/useLoteDeProdutos.tsx` — `abrirDias(cardapio, produtoIds)`, estado `diasEscolhidos` (o payload mora no hook, junto do resto do ciclo), ramo de `confirmar` com `Promise.allSettled` sobre `acoes.definirDias`.
- `src/components/painel/SeletorProdutosDoCardapio.tsx` — botão "Definir dias" na barra, `disabled` por `podeDefinirDias`.
- `src/components/painel/SeletorProdutosDoCardapio.test.tsx` ([276]) — estado desabilitado do botão e presença do gatilho.

**NÃO tocar**
- `src/lib/actions/cardapio.ts` / `admin-cardapios.ts` — **nenhuma action de lote nova**.
- `src/components/painel/BarraSelecaoLote.tsx` e `/painel/produtos` — fora de escopo (ver "Decisões de escopo").
- `preverLoteAction` e a semântica do alcance — a contagem da prévia **não muda** nesta issue.
- `src/components/ui/**`.

### Dependências Externas

**Nenhuma.** Custo variável: zero. O único custo novo é de **round trips**: até `TETO_LOTE` UPDATEs por confirmação, contra 1 hoje. Cada um é um UPDATE por chave primária composta, sem leitura antes — dentro do orçamento de uma ação explícita e rara. Se o `acelerar` reclamar, a saída é uma RPC de lote, e isso é issue própria, não remendo aqui.

### Ordem de Implementação

1. `perguntaDias` + teste puro (a redação primeiro — é o que a trava de fonte varre).
2. `podeDefinirDias` / `payloadsDeDiasEmLote` + testes puros.
3. `AlvoDoLote` ganha a variante `"dias"` no `DialogoLoteCardapio` (`tsc` guia os ramos faltantes).
4. `useLoteDeProdutos` — `abrirDias`, estado, `confirmar` com `allSettled`.
5. Botão na barra do `SeletorProdutosDoCardapio` + asserções de render.

Issue **não** crítica: não exige fase `tdd`. A ordem 1→2 antes do `.tsx` já cumpre "o número e a frase sob teste antes da tela".

**Gate mecânico:**
`npx vitest run src/components/painel/ src/lib/utils/copiaLotePromocao.test.ts` · `npx tsc --noEmit` = 0 · `npm run lint` = 0 · `npm run build` verde.

`lote-contagem-do-servidor.test.ts` descobre a frase nova sozinho (varre quem importa `utils/copiaLotePromocao`): alimentar `total` com `selecionados.length` fica vermelho sem ninguém editar lista nenhuma.
