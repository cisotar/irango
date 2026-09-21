## Plano Técnico

### Análise do Codebase — e a descoberta que muda o tamanho desta issue

O que já existe e será **reusado**:

- `src/lib/utils/contarProdutosEscondidos.ts` — `listarProdutosEscondidos`, `contarProdutosEscondidos`, `diagnosticarSumico`, `VinculosPorProdutoLidos = ReadonlyMap<string, VinculoVigencia[]>`.
- `src/lib/utils/vigenciaCardapio.ts` — `avaliarVigenciaDoProduto` (que desde [273] raciocina **por vínculo**: `dentroDaJanela = ativos.some(v => itemAberto(v, …))`) e `voltaAAbrir` (que **ignora** `dias_semana` do item, de propósito).
- `src/lib/utils/contarProdutosEscondidos.test.ts` — a base de testes.
- Os quatro callers: `/painel/cardapios/page.tsx:58,65`, `/admin/assinantes/[lojaId]/cardapios/page.tsx:40,47`, `/painel/produtos/page.tsx:157`, e `ProdutosClient.tsx` (só o tipo `SumicoDoProduto`).

**A descoberta:** os três módulos **já delegam 100% do predicado a `avaliarVigenciaDoProduto`**, e nunca leram `cardapio.dias_semana` nem chamaram `cardapioAberto` diretamente. O predicado "é UM SÓ", como o docstring promete. Como [273] converteu `avaliarVigenciaDoProduto` para vínculos, **o comportamento de RN-03 provavelmente já é o correto**, e `VinculosPorProdutoLidos` já está no tipo renomeado (`ReadonlyMap` é covariante, então `Map<string, VinculoVigencia<CardapioDaLoja>[]>` dos callers já é aceito — `npx tsc --noEmit` está verde hoje).

**Consequência para o `executar`:** esta issue é, muito provavelmente, **caracterização + documentação, com zero linha de produção**. O primeiro passo é escrever os testes e ver se passam. **Se passarem de primeira, a issue fecha assim — não inventar mudança para justificar a issue.** Se algum falhar, aí sim há um bug de vínculo escondido, e o fix mora dentro de `contarProdutosEscondidos.ts`, nunca num segundo critério de "quando volta".

### Cenários

**Caminho feliz**
1. Loja com "Especiais do Dia" recorrente, ativo, sem restrição de dia. Feijoada exclusiva de cardápio, vínculo `{qua}`.
2. Numa terça, `itemAberto` ⇒ `false`, mas `voltaAAbrir` ⇒ `true` ⇒ `visivelNaVitrine = true`.
3. `contarProdutosEscondidos` ⇒ `sumidos: 0`. **O painel não acusa sumiço** de quem só está fora do dia — a loja não é assustada à toa e não é oferecida uma conversão que não resolve nada.
4. `diagnosticarSumico` ⇒ `null`. A linha de `/painel/produtos` não pinta o aviso âmbar.

**Casos de borda**
- **Exclusivo de cardápio recorrente com item `{qua}`, em qualquer dia da semana:** **nunca** contado como escondido. Alterna entre comprável e marcado, e é isso que RN-03 diz. Teste varrendo os 7 dias — um dia só passaria por acidente.
- **Exclusivo de prazo fixo expirado:** continua contado. `voltaAAbrir` ⇒ `false` ⇒ `visivelNaVitrine` ⇒ `false`.
- **Exclusivo de cardápio desligado (`ativo = false`):** continua contado. RN-03: desligado não abre, não fecha e não restringe; `ativos` o descarta antes.
- **Produto do menu vinculado:** nunca entra em `sumidos`; entra em `doMenu`. `visibilidadeDe` fail-open — valor desconhecido vira `'menu'`.
- **Produto em dois cardápios, um expirado e um aberto com item `{qua}`:** não sumiu. A união dos vínculos decide.
- **Interseção vazia (RN-06): cardápio `{sáb,dom}` + item `{qua}`** — `dentroDaJanela` é `false` para sempre, mas `voltaAAbrir` devolve `true` (recorrente ativo) ⇒ `visivelNaVitrine = true` ⇒ **não é contado como escondido**, embora o item literalmente nunca apareça comprável. **Divergência conhecida e aceita**, registrada na spec §Fora do Escopo e coberta pelo aviso do painel em [276] — *outra pergunta, outra tela*. **Este caso precisa de teste explícito com comentário**, senão a próxima revisão o "conserta" e recria a regra de dia dentro de `voltaAAbrir`.
- **`diagnosticarSumico` com vários cardápios sem volta:** o culpado sai da escada `nome` (pt-BR) → `id`. Determinismo: a frase não troca de cardápio a cada refresh.

**Tratamento de erros:** nenhum caminho de erro. Preview de UX, funções puras, sem I/O. Nenhum número destes chega ao cliente como decisão.

### Schema de Banco

**Nenhuma mudança.** Nenhuma tabela, nenhuma policy, nenhuma escrita.

### Validação (zod)

Nenhuma. Não há entrada de usuário.

### Recálculo no Servidor

Sem valor monetário e sem permissão. As três funções são **preview de UX recalculado no servidor a cada render**; o cliente nunca as envia de volta. As autoridades continuam intactas e **não são tocadas**: a recusa da remoção é da Server Action (RN-14), a autorização é a RLS, e a visibilidade real do produto é `avaliarVigenciaDoProduto` no SSR da vitrine e no recálculo do pedido.

A invariante que esta issue protege é de **coerência entre telas**: um produto não pode estar "sumido" no painel e presente na vitrine. Ela é garantida estruturalmente — `contarProdutosEscondidos` e `agruparPorCardapio` ([279]) chamam as **mesmas** funções de `vigenciaCardapio.ts`, nunca um segundo critério.

### Arquivos a Criar / Modificar / NÃO tocar

**Modificar**
- `src/lib/utils/contarProdutosEscondidos.test.ts` — os casos acima, com `agora` injetado e varredura dos 7 dias no caso de RN-03. O caso de interseção vazia vai com comentário explicando **por que passa assim**.
- `src/lib/utils/contarProdutosEscondidos.ts` — **só se um teste falhar**. Em qualquer caso, os docstrings passam a dizer "por vínculo" onde hoje dizem "por cardápio", e o caso de interseção vazia fica registrado ali.

**NÃO tocar**
- `src/lib/utils/vigenciaCardapio.ts` — em especial `voltaAAbrir`: encodar o dia do item ali criaria a segunda casa da regra de dia, e a issue lista isso em Fora de Escopo.
- `agruparPorCardapio` — é [279].
- O aviso de RN-06 — é [276].
- Os quatro callers, **a menos que o `tsc` peça**. Eles já passam `VinculoVigencia<CardapioDaLoja>[]`, que já é aceito.
- `copiaCardapioPainel.ts` / `CardapiosClient.tsx` — a copy consome os números; nenhum número muda de nome.

### Dependências Externas

**Nenhuma.** Custo variável: zero.

### Ordem de Implementação

1. Escrever os testes de caracterização e **rodar**. Capturar o output real.
2. **Se verdes:** corrigir os docstrings para "por vínculo", registrar a divergência de RN-06 no comentário, fechar. Nenhuma linha de produção.
3. **Se vermelhos:** o output é a fase RED de fato; o fix mínimo mora em `contarProdutosEscondidos.ts`, reusando `avaliarVigenciaDoProduto`/`itemAberto`, jamais reimplementando dia.
4. Rodar a suíte inteira — as três funções são consumidas por quatro rotas, e o custo de quebrar uma em silêncio é um painel que mente.

Issue **não** crítica: não exige fase `tdd` formal, mas o passo 1 é literalmente "teste antes de código" e deve ser feito assim.

**Gate mecânico:**
`npx vitest run src/lib/utils/contarProdutosEscondidos.test.ts src/lib/utils/catalogoVitrine.test.ts` · `npx tsc --noEmit` = 0 · `npm run lint` = 0 · `npm test` verde (com pouca memória: `npx vitest run --maxWorkers=2`).
