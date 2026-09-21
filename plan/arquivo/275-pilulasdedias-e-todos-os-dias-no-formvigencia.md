## Plano Técnico

### Análise do Codebase

O que já existe e será **reusado** (nada disso se reescreve):

- `src/components/painel/rascunhoCardapio.ts:81` — `DIAS_DA_SEMANA` (`{valor, rotulo}` × 7). É a **única** tabela de dias curtos do painel; a inicial do modo compacto sai de `rotulo.charAt(0)`, derivação e não segunda tabela.
- `src/components/painel/FormVigencia.tsx:283-311` — o bloco inline de 7 `<button aria-pressed>` + `ALVO = "min-h-[44px] min-w-[44px]"` + as classes `border-primary bg-primary text-primary-foreground` / `bg-background hover:bg-muted` / `focus-visible:ring-3 focus-visible:ring-ring/50`. A extração é **mudança de casa, não de bytes**.
- `src/lib/utils/descreverVigencia.ts:45` — `DIAS_LONGOS`, hoje `const` privada. Vira uma **exportação** (`rotuloLongoDoDia`), não uma tabela nova (decisão F do desenho).
- `src/lib/utils/descreverVigencia.ts` — `descreverDiasDaSemana` já curto-circuita 7 dias em `"todos os dias"` (entregue em [273]): a prévia com os 7 marcados lê **"Aparece todos os dias."** sem uma linha nova neste escopo.
- `src/components/painel/PreviewVigencia.tsx` + `fraseDoRascunho` — consomem a frase pronta; nenhum consumidor muda.
- `components/ui/button` (`variant="outline"` / `variant="ghost"`, `size="sm"`) — o mesmo par visual de "Selecionar os N" / "Limpar" de `SeletorProdutosDoCardapio.tsx:170-190`. **Não existe `toggle`/`toggle-group` instalado** e nenhum componente novo do shadcn CLI é gerado.
- `src/lib/utils/navegacao-por-teclado.ts` — utilitário puro já usado pelo `ModoReordenar`; o roving tabindex das pílulas reusa o que houver ali e só cria helper novo se a forma não servir (verificar antes de escrever).

O que **precisa ser criado**, e por quê:

- `PilulasDeDias.tsx` — [275] exige **duas superfícies, uma implementação** ([276] põe as mesmas 7 pílulas na linha do vínculo e [277] dentro do diálogo de lote). Manter o bloco inline obrigaria a copiá-lo duas vezes. É extração, não invenção: nenhum estilo, tabela ou comportamento novo além do modo `compacto` e do roving tabindex.

### Cenários

**Caminho feliz**
1. Lojista abre `/painel/cardapios/[cardapioId]`, modo "Repete sempre".
2. Clica "Qua" e "Sáb" → `aria-pressed=true` nas duas; a prévia lê "Aparece todo quarta e sábado."
3. Clica **"Todos os dias"** → os 7 marcados de uma vez; a prévia lê **"Aparece todos os dias."** (RN-07, função pura de [273]).
4. Salva. O CHECK `cardapios_recorrente_tem_eixo` está satisfeito — 7 dias marcados **é** eixo preenchido.

**Casos de borda**
- **Nenhum dia marcado:** nota "Nenhum dia marcado = todos os dias." permanece; o submit continua caindo no erro de RN-02 do zod se nem semana nem mês nem hora existirem. Nada muda aqui.
- **Já com os 7 marcados:** "Todos os dias" fica `disabled` + `aria-pressed={true}`; **não** vira "Nenhum dia" (decisão do desenho §2), porque o gesto de limpar tem botão próprio.
- **"Limpar"** (decisão C, aprovada): devolve o eixo a vazio. Sem ele, desfazer o atalho custa 7 cliques.
- **Modo "Período com data de fim":** o bloco de dias da semana não é renderizado — comportamento de hoje, intocado.
- **360px:** modo **não compacto** mantém `grid-cols-4 sm:grid-cols-7` (comportamento atual). Modo **compacto** (usado só por [276]/[277]) aplica a **exceção A aprovada na sessão**: altura 44px literal intacta, a **largura** cai para `flex-1` com piso `min-w-[40px]` abaixo de `sm`. Isso é uma exceção registrada a `design-system.md` §5 e precisa da linha correspondente lá (tarefa do `escriba`, não deste código).
- **Teclado:** roving tabindex — o grupo é **uma** parada de Tab; ←/→ com wrap, Home/End, Espaço/Enter alterna. Seta **não** marca (`selection-follows-focus` desligado): com escrita otimista em [276], navegar gravando seriam 7 escritas sem intenção.
- **`desabilitado`:** `opacity-60` + `pointer-events-none`, **sem** esconder — o lojista precisa continuar lendo a agenda enquanto salva.

**Tratamento de erros:** o componente não tem estado de erro próprio e não faz I/O. Erro é do consumidor (toast `sonner` em [276]/[277]); esta issue não toca nenhuma action. Nenhum detalhe de servidor chega à tela.

### Schema de Banco

**Nenhum.** Zero migration, zero coluna, zero RLS. `cardapio_produtos.dias_semana` e o CHECK de domínio já vieram na [272].

### Validação (zod)

Nenhum schema novo. O `FormVigencia` continua validando por `validarRascunho` → `schemaCardapio` (`src/lib/validacoes/cardapio.ts`), o **mesmo** que a Server Action roda. "Todos os dias" produz `dias_semana: [0..6]`, que o schema já aceita e o CHECK `cardapios_recorrente_tem_eixo` já dá por satisfeito.

### Recálculo no Servidor

Não há valor monetário nesta issue. A autoridade do que é gravado continua inteira na Server Action `atualizarCardapio` / `atualizarCardapioAdmin` — o componente é preview de UX.

### Arquivos a Criar / Modificar / NÃO tocar

**Criar**
- `src/components/painel/PilulasDeDias.tsx` — controlado (`valor: number[]`, `onChange`, `rotulo`, `compacto?`, `desabilitado?`, `descritoPor?`), sem `useState`, sem action dentro. É o que permite a mesma instância servir rascunho local, escrita otimista por linha e payload de lote.
- `src/components/painel/PilulasDeDias.test.tsx` — `renderToStaticMarkup` (padrão de `CardapiosClient.test.tsx`), `environment: node`. Cobre: 7 botões, `aria-pressed` correto por `valor`, `min-h-[44px]` literal presente, `aria-label` com nome completo do dia, `role="group"` com o `rotulo`, modo compacto com iniciais, `desabilitado`. **Mais a trava de fonte do critério de aceite:** varredura `readFileSync` sobre `src/components/` provando que `DIAS_DA_SEMANA` só aparece em `rascunhoCardapio.ts` e `PilulasDeDias.tsx` (forma copiada de `rotaCardapiosInjetada.test.tsx`).

**Modificar**
- `src/lib/utils/descreverVigencia.ts` — exportar `rotuloLongoDoDia(dia: number): string` sobre a `DIAS_LONGOS` existente. Uma linha de export; a tabela continua tendo um dono só.
- `src/lib/utils/descreverVigencia.test.ts` — os 7 rótulos longos e o comportamento fora de 0..6.
- `src/components/painel/rascunhoCardapio.ts` — `todosOsDias(): number[]` derivado de `DIAS_DA_SEMANA` (nunca um literal `[0,1,2,3,4,5,6]` escrito à mão). É o que torna o critério de aceite "Todos os dias ⇒ `dias_semana` com os 7 valores" afirmável **sem jsdom**.
- `src/components/painel/rascunhoCardapio.test.ts` — `todosOsDias()` e `fraseDoRascunho` com 7 marcados ⇒ "Aparece todos os dias."
- `src/components/painel/FormVigencia.tsx` — troca do bloco inline por `<PilulasDeDias compacto={false} …>`; acrescenta a linha `[ Todos os dias ] [ Limpar ]` **abaixo** das pílulas e **acima** da nota. `aria-describedby={ID_ERROS}` continua chegando por `descritoPor`.
- `src/components/painel/FormVigencia.test.tsx` — os alvos de 44px continuam no HTML, a linha dos dois botões existe, "Todos os dias" fica `disabled` quando o cardápio salvo já tem os 7.

**NÃO tocar**
- `src/components/ui/**` — gerado pelo shadcn CLI.
- `DIAS_LONGOS` / `DIAS_CURTOS` / `DIAS_PLURAIS` em `descreverVigencia.ts` — só ganham um export; nenhuma tabela é movida, copiada ou reordenada.
- `SeletorProdutosDoCardapio.tsx`, `DialogoLoteCardapio.tsx`, `useLoteDeProdutos.tsx`, `contrato-lote.ts` — são [276]/[277].
- Qualquer Server Action, query ou migration.

### Dependências Externas

**Nenhuma.** Nenhum pacote novo, nenhuma API, nenhuma quota. Custo variável: zero.

### Ordem de Implementação

1. `rotuloLongoDoDia` exportado + teste (a pílula precisa do nome completo antes de existir).
2. `todosOsDias()` em `rascunhoCardapio.ts` + teste (é a trava pura do critério de aceite).
3. `PilulasDeDias.tsx` + `PilulasDeDias.test.tsx`, ainda sem consumidor.
4. `FormVigencia.tsx` passa a consumi-lo — **sem** o atalho, provando que o render não mudou (`FormVigencia.test.tsx` verde sem edição).
5. Só então os botões "Todos os dias" / "Limpar" e as asserções novas.

Issue **não** crítica (nenhuma decisão de valor ou de permissão): não exige fase RED do `tdd`. A ordem 1→2 antes de 3 já entrega o teste puro antes do `.tsx`.

**Gate mecânico:**
`npx vitest run src/components/painel/ src/lib/utils/descreverVigencia.test.ts` · `npx tsc --noEmit` = 0 · `npm run lint` = 0
