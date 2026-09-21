## Plano Técnico

### Análise do Codebase

O que já existe e será **reusado**:

- `src/lib/actions/cardapio.ts:576` — `definirDiasDoVinculo(payload)`: parse `schemaDiasDoVinculo` **antes** de qualquer I/O, `loja_id` de `buscarLojaDoDono`, UPDATE escopado pela **tripla** `loja_id ∧ cardapio_id ∧ produto_id` com `count: "exact"`, `count === 0` **é** a recusa, `MSG_DIAS_DO_VINCULO` única para alheio/inexistente/erro de banco, `revalidarCaminhosDoCardapio`. **Única via de escrita.**
- `src/app/admin/assinantes/actions/admin-cardapios.ts:578` — `definirDiasDoVinculoAdmin(lojaId, payload)`: mesma forma sob `escopo.atualizarPorChave` + `registrarAcessoAdmin` + `revalidatePath` do detalhe.
- `src/lib/actions/cardapio-contrato.ts` — `MSG_DIAS_DO_VINCULO` ("Não foi possível salvar os dias deste item.") e `Resultado`.
- `src/lib/validacoes/cardapio.ts:303` — `schemaDiasDoVinculo` (`.strict()`, `cardapio_id`/`produto_id` guid, `dias_semana` 0..6, máx 7) e `normalizarDiasDoVinculo` (`[]`→`NULL`, dedup, ordena).
- `src/components/painel/PilulasDeDias.tsx` ([275]) — `compacto={true}`. **Não recriar pílulas.**
- `src/lib/utils/vigenciaCardapio.ts` — `itemAberto`, `VinculoVigencia`, `cardapioAberto`. Nenhuma regra de dia é reescrita nesta issue.
- `src/lib/utils/descreverVigencia.ts` — `DIAS_LONGOS`/`DIAS_PLURAIS`/`DIAS_CURTOS`, `enumerar`, `ordenarSemana`, `fraseSoNosDias`, `preposicaoPlural`. A frase do aviso de RN-06 nasce **aqui dentro**, ao lado das outras redações, e não num módulo novo — é a única forma de não abrir uma segunda casa da tabela de dias (mandato 2).
- `src/lib/supabase/queries/cardapios.ts:24` — `COLUNAS_CARDAPIO_VIGENCIA` já traz `cardapio_produtos(produto_id, dias_semana)`, e `buscarCardapiosComProdutos` já devolve `vinculosPorProduto` com `dias_semana` por vínculo ([273]). **Nenhuma query nova, nenhuma ida a mais ao banco, nos dois mundos.**
- `src/app/admin/assinantes/[lojaId]/carga-cardapio-detalhe.ts` — já devolve `vinculosPorProduto` completo. **Não precisa mudar**; só ganha asserção no teste dela.
- `src/components/painel/contrato-lote.ts` — `AcoesLote` (módulo neutro, sem default, issue 160).
- `src/lib/utils/rotasCardapios.ts` — `ROTA_CARDAPIOS_LOJISTA` / `rotaCardapiosAdmin`. Nenhum literal de rota entra em `components/painel/**` (trava de `rotaCardapiosInjetada.test.tsx`).

O que **precisa ser criado**, e por quê:

- `src/components/painel/agendaDoVinculo.ts` — módulo **puro** com `alternarDiaDoVinculo(dias, dia)` e `payloadDeDias(cardapioId, produtoId, dias)`. Sem jsdom, um clique não é observável: o critério "chama a action com `{cardapio_id, produto_id, dias_semana}` e nada mais" só é afirmável fora do `.tsx`. Mesmo argumento que tirou a copy de lote do JSX em [260].
- `src/components/painel/SeletorProdutosDoCardapio.test.tsx` — não existe teste de render deste componente hoje.

### Cenários

**Caminho feliz**
1. `/painel/cardapios/[cardapioId]` renderiza, no SSR, para cada produto **já vinculado**: `dias` (do vínculo), `fraseAgenda` e `avisoNuncaAbre` — as três derivadas no servidor com o fuso da loja.
2. Linha da Feijoada mostra `Aparece: qua e sáb` + as 7 pílulas compactas com Qua e Sáb em `aria-pressed=true`.
3. Lojista clica "Sex": estado otimista pinta a pílula, o grupo vira `desabilitado`, o `<li>` vira `aria-busy="true"`, a região `aria-live="polite"` da linha anuncia "Salvando…".
4. `definirDiasDoVinculo({cardapio_id, produto_id, dias_semana: [3,5,6]})` volta `{ok:true}` → grupo reabilita, `aria-live` anuncia "Dias salvos.", `router.refresh()` recalcula frase e aviso **no servidor**.

**Casos de borda**
- **Produto não vinculado:** sem pílulas, sem frase, sem placeholder. Agenda é do vínculo.
- **Vínculo sem dias (`null`/`[]`):** nenhuma pílula marcada + "Todos os dias do cardápio" (`text-xs text-texto-muted`), que é o texto do `aria-describedby` do grupo.
- **Desmarcar o último dia:** manda `dias_semana: []`; o servidor grava `NULL` (`normalizarDiasDoVinculo`) e a linha volta a "Todos os dias do cardápio".
- **Sem permissão / vínculo de outra loja / vínculo apagado noutro dispositivo:** `count === 0` ⇒ `{ok:false, erro: MSG_DIAS_DO_VINCULO}` — alheio e inexistente byte a byte iguais.
- **Falha de rede / erro do banco:** as pílulas **voltam ao estado anterior**, `toast.error(MSG_DIAS_DO_VINCULO)`, o foco **fica** na pílula clicada.
- **Dois cliques rápidos na mesma linha (decisão D, aprovada):** o grupo desabilita por ~200 ms enquanto a escrita está em voo. Duas escritas concorrentes do array inteiro teriam como vencedor o último a **chegar**, não o último **clicado**. O estado otimista continua visível; nada pisca.
- **Agenda que nunca abre (RN-06):** cardápio recorrente `{sáb,dom}` + item `{qua}` ⇒ faixa âmbar `role="status"` abaixo das pílulas: *"Este item nunca aparece: o cardápio só abre aos sábados e domingos."* **Não bloqueia** o salvamento, não tem `aria-invalid`, não rouba foco e não oferece conserto (o consertável é a vigência do cardápio, que está na mesma rota, 400px acima).
- **Sem aviso quando:** cardápio inativo (RN-03: desligado não restringe), cardápio `prazo_fixo` (não tem eixo de dia da semana), cardápio sem `dias_semana`, item sem dias, **ou** cardápio com `dias_mes` não-vazio — o `OU` de RN-02 faz a interseção deixar de ser vazia (dia 15 numa quarta abre um cardápio `{sáb,dom}+{15}`). Este é o caso de teste que separa um aviso correto de um alarme falso.
- **Aviso um render atrasado (decisão E, registrada):** é SSR; depois do clique otimista a faixa só aparece quando o `router.refresh()` volta (~1 s). Aceito porque **nada depende dela**. A alternativa — avaliar dia no browser — é exatamente o que a spec proíbe.

**Tratamento de erros:** uma frase só na UI (`MSG_DIAS_DO_VINCULO`), detalhe (incluindo o `23514` do CHECK de domínio) só no `console.error` do servidor — já é o comportamento das duas actions de [274]. Nada é reescrito no cliente.

### Schema de Banco

**Nenhuma mudança.** `cardapio_produtos.dias_semana` + `cardapio_produtos_dias_semana_dominio` vieram na [272]. RLS: `cardapio_produtos_escrita_propria` já cobre o caminho do lojista; o caminho admin roda sob `service_role` (BYPASSRLS) e é protegido por **paridade** (`admin-cardapios.paridade.test.ts`) mais o `escopo.atualizarPorChave`, não por policy.

### Validação (zod)

`schemaDiasDoVinculo` **já existe e é o mesmo dos dois lados**. O cliente não valida nada além de montar o array: `payloadDeDias` produz exatamente as três chaves, e o `.strict()` recusa qualquer quarta chave pendurada — inclusive um `loja_id` vindo do browser (RN-10).

### Recálculo no Servidor

Sem valor monetário. Mas há **invariante de permissão**, e ela é garantida onde já estava:

| Invariante | Camada |
|---|---|
| "este vínculo é da minha loja" | UPDATE pela tripla com `count: "exact"` na Server Action ([274]) + RLS `cardapio_produtos_escrita_propria` |
| "este vínculo é da loja-alvo" (admin) | `validarLojaIdAdmin` + `escopo.atualizarPorChave` + `registrarAcessoAdmin` |
| forma do payload | `schemaDiasDoVinculo.strict()` na Server Action |
| representação (`[]`→`NULL`, dedup, ordem) | `normalizarDiasDoVinculo`, **no servidor** |
| "este item nunca aparece" (RN-06) | **preview de UX**, recalculado no SSR a cada render; nada depende dele |

O cliente envia `{cardapio_id, produto_id, dias_semana}` e **nada mais**. Nenhuma decisão nasce no browser.

### Arquivos a Criar / Modificar / NÃO tocar

**Criar**
- `src/components/painel/agendaDoVinculo.ts` + `agendaDoVinculo.test.ts` — funções puras de alternância e de payload.
- `src/components/painel/SeletorProdutosDoCardapio.test.tsx` — `renderToStaticMarkup` (padrão de `CardapiosClient.test.tsx`): vinculado tem pílulas e frase, não vinculado não tem nada, vínculo vazio lê "Todos os dias do cardápio", `aria-label` do grupo carrega o nome do produto, a faixa âmbar aparece só com `avisoNuncaAbre != null`, `role="status"`.

**Modificar**
- `src/lib/utils/descreverVigencia.ts` — exportar `avisoAgendaQueNuncaAbre(vinculo: VinculoVigencia): string | null`, **pura**, sobre as tabelas já existentes. Devolve `null` para inativo, `prazo_fixo`, cardápio sem `dias_semana`, item sem dias e cardápio com `dias_mes` não-vazio.
- `src/lib/utils/descreverVigencia.test.ts` — a matriz de casos acima, com a frase afirmada byte a byte.
- `src/components/painel/contrato-lote.ts` — `AcoesLote` ganha `definirDias: typeof definirDiasDoVinculo`. **Obrigatória e sem default** (issue 160): omitir quebra o `tsc`, em vez de rodar a action do lojista na loja do admin.
- `src/components/painel/SeletorProdutosDoCardapio.tsx` — `ProdutoDoSeletor` ganha `dias: number[] | null`, `fraseAgenda: string | null` e `avisoNuncaAbre: string | null` (todos derivados no servidor); a linha ganha a segunda fila com `<PilulasDeDias compacto>` + `aria-live` + `aria-busy`; estado otimista por `produto_id`.
- `src/app/(painel)/painel/(bloqueavel)/cardapios/[cardapioId]/page.tsx` — no `.map` dos grupos, achar o vínculo **deste** cardápio em `vinculosPorProduto` e derivar os três campos com `rotuloVoltaQuando`/`descreverVigencia`/`avisoAgendaQueNuncaAbre`; injetar `definirDias: definirDiasDoVinculo`.
- `src/app/admin/assinantes/[lojaId]/cardapios/[cardapioId]/page.tsx` — a **mesma** derivação (RN-14: espelha, não abre exceção).
- `src/app/admin/assinantes/[lojaId]/cardapios/[cardapioId]/CardapioDetalheAdminClient.tsx` — injeta `definirDias: (payload) => definirDiasDoVinculoAdmin(lojaId, payload)`.
- `src/app/admin/assinantes/[lojaId]/carga-cardapio-detalhe.test.ts` — asserção de que `dias_semana` do vínculo sobrevive à carga (a função em si **não muda**).

**NÃO tocar**
- `src/lib/actions/cardapio.ts`, `admin-cardapios.ts`, `src/lib/validacoes/cardapio.ts` — a escrita e o escopo são de [274]; **nenhuma regra nova de escrita nesta issue**.
- `src/lib/supabase/queries/cardapios.ts` e `carga-cardapio-detalhe.ts` — já trazem o dado.
- `src/lib/utils/vigenciaCardapio.ts` — em especial `voltaAAbrir`, que **continua ignorando** `dias_semana` do item de propósito (§Fora do Escopo da spec).
- `src/components/ui/**`; `DialogoLoteCardapio.tsx` / `useLoteDeProdutos.tsx` ([277]); `ProdutosClient.tsx` / `FormProduto.tsx` ([278]).

### Dependências Externas

**Nenhuma.** Nenhum pacote, nenhuma API, nenhuma quota. Custo variável: zero.

### Ordem de Implementação

1. `avisoAgendaQueNuncaAbre` + testes puros (a matriz de RN-06 é a parte com regra; ela vem antes do `.tsx`).
2. `agendaDoVinculo.ts` + teste — payload e alternância.
3. `contrato-lote.ts` ganha `definirDias`. **O `tsc` fica vermelho de propósito** nos 4 pontos de injeção; é essa a trava.
4. Injeção nos dois mundos: page do lojista, page admin, `CardapioDetalheAdminClient`. `tsc` volta a verde.
5. `SeletorProdutosDoCardapio.tsx` — pílulas, frase, aviso, otimismo, `aria-live`.
6. `SeletorProdutosDoCardapio.test.tsx` + asserção em `carga-cardapio-detalhe.test.ts`.

Issue **não** crítica (a escrita e o escopo já foram travados em RED na [274]): não exige fase `tdd`. A ordem 1→2 antes do `.tsx` já põe a regra sob teste antes do render.

**Gate mecânico:**
`npx vitest run src/components/painel/ src/lib/utils/descreverVigencia.test.ts "src/app/admin/assinantes/[lojaId]/carga-cardapio-detalhe.test.ts" src/app/admin/assinantes/enforcement-props-action-admin.test.ts` · `npx tsc --noEmit` = 0 · `npm run lint` = 0 · `npm run build` verde.

`rotaCardapiosInjetada.test.tsx` e `enforcement-props-action-admin.test.ts` **descobrem sozinhos** o arquivo e a prop novos (varredura de `components/painel/**` e AST dos `*AdminClient.tsx`): nenhuma lista é editada à mão, e esquecer a injeção admin fica vermelho sem ninguém lembrar de pedir.
