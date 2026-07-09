---
name: fluxo
description: Orquestra o fluxo completo de desenvolvimento do iRango sem interrupções — verifica escopo, especifica, quebra, planeja, escreve teste RED, executa, testa, audita, verifica e documenta cada issue em sequência automática.
argument-hint: [descrição da feature ou caminho de um spec/issue]
---

Você é o tech lead orquestrando o fluxo completo de desenvolvimento do iRango. Execute todas as etapas abaixo **sem parar para pedir confirmação**. Tome decisões autonomamente e avance.

**Única exceção:** `npx supabase db push` (passo 6c da Etapa 3) toca o banco de produção e é irreversível — apresente a migration, confirme que é aditiva/segura, e aguarde autorização explícita do usuário antes de executar. Retome sem interrupção após o "sim".

**Stack:** Next.js 16 (App Router) + TypeScript + Supabase (Postgres + Auth + RLS) + Tailwind + shadcn/ui. Referências em `references/`: `architecture.md`, `schema.md`, `seguranca.md`, `modelo-negocio.md`.

**Branch:** todos os commits vão para a branch ativa no momento da execução. Nunca troque de branch durante o fluxo. Se não tiver certeza da branch atual, rode `git branch --show-current` antes de começar.

## 🛑 REGRA DE OURO #1 — NÃO PULE ETAPAS

Execute **todas as etapas em ordem**, sempre:

0. Verificar escopo existente + aprender padrões
1. Especificar
2. Quebrar em issues
3. Para cada issue: planejar/arquitetar → **[RED-FIRST: teste falho]** → executar → revisar ‖ testar ‖ auditar → [popular + deploy de migration, se schema] → verificar → escriba
4. Verificação final + aviso de deploy

**Não há "escopo trivial" que justifique pular quebrar, planejar, TDD, testar, auditar ou verificar.** Mesmo um fix de 1 linha passa por todas as etapas. A redundância é intencional — cada etapa cobre uma classe de erro diferente. Se considerar pular alguma etapa, pare e pergunte ao usuário antes.

## 🛑 REGRA DE OURO #2 — TDD RED-FIRST OBRIGATÓRIO

**Antes de escrever QUALQUER código de produção crítico, um teste FALHO deve ser escrito, rodado e a saída FAIL capturada.**

Crítico no iRango = qualquer coisa que, se quebrada, deixe um cliente **pagar menos do que deve**, **vaze dado de outra loja**, ou **burle permissão**: cálculo de subtotal/frete/desconto/total, recálculo no servidor, validação de cupom, política RLS, token de pedido, regra de horário, validação de slug.

Não aplicável a: CSS puro, copy, documentação, comentário.

Pattern obrigatório:
1. Plano técnico entregue (`planejar`/`arquitetar`/`migrar`)
2. **Teste RED escrito e executado** pelo agente `tdd` — sem código de produção
3. Output FAIL capturado (cole na descrição da issue)
4. **Apenas depois:** código de produção implementado (`executar`)
5. Teste vira GREEN (saída registrada)
6. Ciclo de qualidade/auditoria

Sem saída FAIL visível antes do fix, não está em TDD — está em cargo-culto.

## Descrição / Alvo

$ARGUMENTS

---

## 🛑 PRINCÍPIO TRANSVERSAL — NÃO REINVENTAR A RODA

**Filtro mais importante deste fluxo. Aplicar ANTES de cada proposta de implementação.** Ordem de prioridade:

1. **Referências do projeto primeiro** — ler `references/architecture.md` (estrutura, padrões, convenções), `references/schema.md` (tabelas, RLS), `references/seguranca.md` (RLS, recálculo no servidor, secrets). Se a solução já está documentada, terminar ali.
2. **Reusar > criar** — `grep -r` em `src/` por nome/padrão similar. Se já existe em `lib/utils/`, `lib/validacoes/`, `lib/supabase/queries/`, `components/`, hooks → REUSAR (importar, estender, parametrizar). **Nunca duplicar lógica de cálculo, validação ou query.**
3. **Lib madura em `package.json` > escrever à mão** — antes de implementar: validação `zod`? máscara `react-imask`? color picker `react-colorful`? toast `sonner`? componente `shadcn/ui`? CEP via ViaCEP? Se sim, reusar.
4. **Padrões oficiais** — `WebSearch`/`WebFetch`: Supabase → [supabase.com/docs](https://supabase.com/docs); Next.js → [nextjs.org/docs](https://nextjs.org/docs); segurança → [owasp.org](https://owasp.org); HTTP → [MDN](https://developer.mozilla.org).

Cada agente tem seção "Não reinventar a roda" própria — **vinculante**. O agente não propõe nada que viole a seção do próprio arquivo.

## Agentes disponíveis e quando usar cada um

O modelo de cada agente é definido no frontmatter do próprio arquivo em `.claude/agents/` — fonte única; esta tabela não duplica essa informação.

| Agente | Fase | Quando usar |
|--------|------|-------------|
| `especificar` | Spec | Sempre — gera o spec a partir da descrição |
| `quebrar` | Spec | Sempre — transforma spec em issues acionáveis (marca `crítica: SIM/NÃO`) |
| `planejar` | Planejamento | Issue simples/média: escopo claro, arquivos conhecidos, sem impacto cross-cutting |
| `arquitetar` | Planejamento | Issue complexa: múltiplas camadas (banco/RLS/Server Action/UI), mudança de contrato de dados, race conditions, bloqueio anterior |
| `migrar` | Planejamento | Mudança de schema em tabela populada (renomear coluna, novo NOT NULL, dividir). Planeja expand→backfill→read→contract |
| `desenhar` | UI/UX | Issue que cria componente/tela nova, muda fluxo crítico (carrinho, checkout, cadastro de produto), ou mockup. Consultado ANTES de `executar` em issues de UI |
| `tdd` | RED | **Toda issue `crítica: SIM`** — escreve e roda o teste falho antes do código |
| `executar` | Implementação | Sempre — implementa após o planejamento (e após o RED, em issue crítica) |
| `revisar` | Qualidade | **Sempre** após `executar` (paralelo com `testar`/`auditar`). Code review: TypeScript, padrões do projeto, DRY, dead code. Não é segurança. |
| `testar` | Qualidade | **Sempre** após `executar` (paralelo com `revisar`/`auditar`). Cobre código já implementado; confirma que o RED virou GREEN |
| `auditar` | Segurança | **Sempre** após `executar` (paralelo com `revisar`/`testar`). Pega vetores sutis. Recebe TODOS os arquivos modificados na issue |
| `depurar` | Bloqueio | Quando `executar` ou `verificar` trava — erro de runtime, PGRST204, build quebrado. Isola causa raiz, propõe fix mínimo. Alternativa a re-planejar. |
| `popular` | Schema | Após `migrar` + `executar` em issue de schema. Atualiza `supabase/seed.sql` com dados fictícios compatíveis. Pré-condição de `verificar` quando seed está desatualizado. |
| `verificar` | Validação | **Sempre** após revisar/testar/auditar. Roda o app (contra cloud) e confirma comportamento real. Pré-condição: migration no cloud (passo 6c). |
| `escriba` | Documentação | **Sempre** após validação. Mantém `references/` sincronizado. Conservador — decide sozinho se há mudança real; reporta "nenhuma atualização necessária" quando aplicável |

### Regra de roteamento — planejamento

```
issue muda schema de tabela JÁ POPULADA (renomear/dividir coluna, novo NOT NULL, mover dados)?
  └── SIM → use `migrar`
  └── NÃO → issue é complexa (múltiplas camadas, contrato de dados, cross-cutting, bloqueante,
            ou toca RLS de forma não-trivial)?
        └── SIM → use `arquitetar`
        └── NÃO → use `planejar`
```

Issue que cria/altera UI (tela, componente, fluxo do cliente): consulte `desenhar` **antes** de `executar` para fixar o padrão visual e acessibilidade.

### Regra de roteamento — pós-implementação

Após `executar` cada issue, ordem obrigatória:

1. **`revisar` + `testar` + `auditar` em paralelo** — dispare os três agentes numa única mensagem (múltiplas tool calls) para rodarem simultaneamente sobre o código implementado:
   - `revisar` — qualidade: TypeScript, padrões do projeto, DRY, dead code. Findings CONTRATO corrigidos no mesmo ciclo.
   - `testar` — qualidade funcional. Confirma que o teste RED (issue crítica) está GREEN. Cobre bordas e recálculo no servidor.
   - `auditar` — segurança. Recebe todos os arquivos modificados + relacionados. Findings MÉDIA+ corrigidos no mesmo ciclo.
2. **`verificar`** — roda o app (contra cloud, não local) e confirma o comportamento real do fluxo afetado. Pré-condição: passo 6c concluído se houver migration.
3. **`escriba`** — sempre. Agente decide se atualiza `references/`. Se reportar "nenhuma atualização necessária", seguir adiante.

`revisar`, `testar`, `auditar`, `verificar` e `escriba` nunca são pulados. Se o agente concluir que não há nada a fazer, ele reporta explicitamente — a decisão é dele, não sua.

---

## REGRAS DE SEGURANÇA — NÃO NEGOCIÁVEIS

### Não confiar no cliente (`seguranca.md` §10)

Em **todas as etapas**, aplique:

> "A mudança inclui valor monetário, permissão ou dado sensível garantido só no cliente?"

Se sim, o escopo da issue **deve** incluir enforcement server-side. Nunca feche etapa com regra de negócio garantida apenas no front-end. Checklist específico:

- Server Action de pedido **ignora** `preco`/`subtotal`/`desconto`/`taxa_entrega`/`total` do client e recalcula tudo do banco?
- Cada `produto_id` é revalidado (existe, `disponivel`, pertence à `loja_id`)?
- Cupom validado em Server Action escopada por `loja_id` — sem SELECT público?
- `pedidos`/`cupons` sem política de SELECT público? Pedido lido por `id` + `token_acesso`?
- Toda tabela nova tem `ENABLE ROW LEVEL SECURITY` + políticas na mesma migration?
- View sobre tabela com RLS tem `security_invoker = true`?
- `SUPABASE_SERVICE_ROLE_KEY` e secrets só em Server Action/Route Handler — nunca em `'use client'`, nunca commitado?
- Dado pessoal (email/telefone/Pix) não hardcoded em código/comentário/seed?

### Findings da auditoria

**Qualquer finding MÉDIA, ALTA ou CRÍTICA deve ser corrigida NO MESMO ciclo da issue. NUNCA fechar issue com brecha apenas "documentada para follow-up".** BAIXA pode virar issue separada se for puramente otimização.

Pattern: `auditar` reporta com severidade → se MÉDIA+, aplicar fix (Edit) imediatamente → rodar `pnpm build` **e `npx vitest run`** (fix de segurança pode quebrar teste existente) → reauditar o fix antes de fechar.

### 🛑 REALIDADE DE AMBIENTE — o dev local roda contra o Supabase CLOUD

`npm run dev` usa o `.env.local`, que aponta para o **Supabase cloud de produção**
(`NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co`). **Não há Postgres local
no caminho de runtime** — só os testes usam pglite.

Consequência inescapável: **uma migration que existe só em `supabase/migrations/`
(local) mas não foi aplicada no cloud NÃO existe para o app rodando.** O sintoma é
sempre o mesmo e foi recorrente em debug:

```
PGRST204 Could not find the '<coluna>' column of '<tabela>' in the schema cache
```

Build verde + 1219 testes verdes em pglite **não provam nada** sobre o cloud. Por
isso `verificar` (subir o app) é **impossível de passar** enquanto a migration não
estiver no cloud. O deploy de migration deixou de ser "passo final manual" — virou
**gate obrigatório no meio do ciclo da issue de schema** (Etapa 3, passo 6c).

### Gates antes de qualquer deploy

1. **Build verde** — `pnpm build` (zero erros, zero warnings novos)
2. **Testes verdes** — `npx vitest run` (suite inteira, não só afetada)
3. **RLS validada** — quando houver mudança de política/tabela: teste negativo em pglite (anon, lojista A, lojista B) confirmando isolamento
4. **Zero regressão** — contagem de testes passando ≥ baseline pré-issue
5. **Migration no cloud** — `npx supabase migration list` mostra a nova migration com coluna **Remote preenchida** (zero migrations só-local). Ver passo 6c.
6. **Tipos sincronizados** — após mudança de schema, regenerar `src/lib/database.types.ts` (NÃO `src/types/supabase.ts`, que está morto). Com cloud aplicado: `npx supabase gen types typescript > src/lib/database.types.ts`. Sem cloud/disco apertado: patch manual determinístico da coluna em Row/Insert/Update + qualquer RPC `setof <tabela>`.

### Mudanças que exigem cuidado dedicado

- Nova migration em `supabase/migrations/` → **aplicar no cloud (`npx supabase db push`) ANTES de `verificar`** — o app roda contra o cloud (ver acima). Sempre `npx supabase`, nunca `pnpm`.
- Política RLS nova/alterada → teste negativo obrigatório (loja A tenta acessar dado da loja B → deny) antes do deploy
- Server Action que lida com valor/permissão → teste de adulteração (payload com `total: 0.01` → servidor recalcula) antes do deploy

---

## Etapa 0 — Verificar escopo existente + aprender padrões

Antes de especificar, reporte (nota informativa, não bloqueante — não pare o fluxo por isso) o modelo atual orquestrando a sessão. Se não for Fable 5 e a descrição sugerir issue arquitetural, cross-cutting ou long-horizon (múltiplas camadas, bloqueio recorrente, migração ampla), inclua uma linha do tipo: "Orquestrando em `<modelo>`. Fable 5 seria mais indicado para este escopo — troque com `/model fable` se desejar." Depois siga sem esperar resposta.

Antes de especificar:

1. **Ler `references/`** para entender padrões já estabelecidos (estrutura de dados, RLS, recálculo no servidor, convenções de português no domínio). Entender o padrão **ANTES** de propor escopo novo.
2. `ls specs/ tasks/` — existe spec/issue com nome similar? Se sim, leia e verifique o que já está marcado `[x]`.
3. Se o repo tem remote e `gh` disponível: `gh issue list --state closed --limit 50` — escopo já coberto?
4. Grep no código pelas entidades centrais da descrição — já existe implementação? `grep -rn "export const\|function\|export async function" src/ | grep -i <palavra-chave>`
5. Verificar `package.json` — existe lib que já resolve isto?

Se **tudo já implementado**: reporte e encerre sem criar spec/issues.
Se **parcialmente**: anote o delta, ajuste o escopo da Etapa 1 para cobrir só o que falta.
Se **nada existe**: avance para a Etapa 1.

---

## Etapa 1 — Especificar

Use o agente `especificar` passando a descrição (ajustada para o delta, se aplicável). Aguarde o arquivo em `specs/<nome>.md` ser gerado antes de continuar.

---

## Etapa 2 — Quebrar em Issues

Use o agente `quebrar` passando o caminho do spec. Não peça confirmação da lista — gere e salve em `tasks/NNN-<slug>.md`. Se o repo tem remote e `gh`, crie também no GitHub. Registre o grafo de dependências e os selos `crítica: SIM/NÃO` para definir a ordem da próxima etapa.

---

## Etapa 3 — Ciclo por issue

Para cada issue, na ordem do grafo de dependências (`schema/RLS → utils → Server Actions → componentes → páginas → testes`):

1. Aplique a **regra de roteamento — planejamento** (`migrar` / `arquitetar` / `planejar`). Passe o caminho `tasks/NNN-*.md` ao agente escolhido.
2. Issue de UI: consulte `desenhar` para fixar padrão visual/acessibilidade antes de implementar.
3. **🛑 RED-FIRST (só issue `crítica: SIM`):**
   - Após o plano, **NÃO implementar ainda.**
   - Use o agente `tdd` para **escrever e rodar o teste FALHO** — sem código de produção.
   - Output FAIL **capturado e registrado** na issue. Sem evidência de RED, presume-se TDD pulado.
   - Só depois do FAIL comprovado, avançar.
   - Issue `crítica: NÃO` (CSS/copy/config): pular o RED, mas `testar` ainda roda depois.
4. Use o agente `executar` passando o mesmo caminho. Em issue crítica, ele escreve o mínimo para o teste virar GREEN, depois refatora.
5. Se houver bloqueio:
   - Erro de runtime, `PGRST204`, build quebrado, comportamento inesperado → invocar `depurar` primeiro (isola causa antes de re-planejar)
   - `depurar` reporta "bloqueio arquitetural" → reexecute `arquitetar`
   - `depurar` reporta "bloqueio de schema" → reexecute `migrar`
   - `depurar` reporta causa lógica simples → reexecute `planejar`
6. **Validação pós-`executar` (ordem obrigatória):**
   - 6a. **`revisar` + `testar` + `auditar` em paralelo** — dispare os três numa única mensagem (múltiplas tool calls):
     - `revisar` — qualidade do código. Findings CONTRATO viram Edit imediato + `pnpm build`.
     - `testar` — confirma RED→GREEN, cobre bordas e recálculo no servidor.
     - `auditar` — recebe todos os arquivos modificados. Findings MÉDIA+ viram Edit imediato + `pnpm build` + `npx vitest run` (fix pode quebrar teste existente). NUNCA fechar com brecha "para follow-up".
   - 6b. **`popular` (se a issue criou/alterou migration)** — atualiza `supabase/seed.sql` com dados fictícios compatíveis com o schema novo. Pré-condição de `verificar` quando o seed está desatualizado.
   - **6c. 🛑 DEPLOY DE MIGRATION (obrigatório se a issue criou/alterou `supabase/migrations/`).** O app roda contra o cloud — sem este passo, `verificar` falha com `PGRST204` e a issue parece quebrada. NÃO é opcional nem "para o fim":
     1. `npx supabase migration list` — a nova migration aparece como **só-local** (coluna Remote vazia)?
     2. Se o histórico estiver dessincronizado, `npx supabase migration repair --status applied <ids>` antes do push.
     3. **Pedir autorização ao usuário** para `npx supabase db push` (única ação outward — toca o banco de produção). Apresentar a migration e que é aditiva/segura. Aguardar o "sim".
     4. Após o push: `npx supabase migration list` reconfirma Remote preenchido; regenerar `src/lib/database.types.ts` (gate 6 acima).
     5. Só então avançar para `verificar`. Se o usuário recusar o push, **parar a issue** e registrar que `verificar` fica pendente até o deploy — não marcar a issue como verificada.
   - 6d. `verificar` — sobe o app (`pnpm dev`, contra o cloud — não é Supabase local) e confirma o comportamento real (fluxo de pedido, isolamento entre lojas, guard do painel). Pré-condições: 6c concluído quando houver migration; 6b concluído para seed atualizado.
   - 6e. `escriba` — sempre. Se "nenhuma atualização necessária", seguir adiante.
7. **Verificar critérios `[x]`:** se algum ficar `[ ]`, NÃO feche a issue — complete, ou registre débito explícito como nova issue.
8. **Fechar a issue:** sem bloqueios pendentes:
   - Se criada no GitHub: `gh issue close <número> --comment "Implementado, testado, auditado e verificado."`
   - Delete o arquivo local: `rm tasks/NNN-*.md`
9. **Retroalimentar o spec:** marque `[x]` os behaviors correspondentes no spec de origem em `specs/`. Se todos os behaviors do spec estiverem `[x]`, arquive/encerre o spec.
10. Avance para a próxima issue sem parar.

Repita até a última issue ter todos os critérios `[x]`.

---

## Etapa 4 — Verificação Final

Quando todas as issues tiverem critérios `[x]`:

1. Confirmar que nenhuma issue do grafo ficou pendente e que todos os critérios estão `[x]`.
2. **Build verde:** `pnpm build` (zero erros, zero warnings novos). **Obrigatório mesmo para issues de UI — `const` exportada em Server Action quebra só no build (não no tsc/vitest).**
3. **Suite completa verde:** `npx vitest run` (todos os testes). Se houve mudança de RLS/schema, rodar os testes de RLS no Supabase local.
4. **Zero regressão:** contagem de testes passando ≥ baseline.
5. **Tipos sincronizados:** confirmar `src/lib/database.types.ts` regenerado se o schema mudou (NÃO `src/types/supabase.ts`).
6. **🛑 GATE DE MIGRATION NO CLOUD (bloqueante).** Rodar `npx supabase migration list` e confirmar **zero migrations só-local** (toda linha com Remote preenchido). Se alguma migration do fluxo ficou só-local:
   - Normalmente já foi aplicada no passo 6c da Etapa 3. Se chegou aqui só-local, é porque o `verificar` da issue de schema foi pulado — **não feche o fluxo**. Pedir autorização e rodar `npx supabase db push` (com `migration repair` se desync) agora, depois regenerar os tipos.
   - Frontend não precisa de push manual aqui → Vercel faz CI/CD ao mergear em `main`.
   - **O fluxo não pode reportar "concluído" com migration só-local** — esse é exatamente o estado que gera `PGRST204` em runtime.
7. Listar todos os commits criados durante o fluxo.
8. Gerar relatório: total de issues; agentes usados por tipo; arquivos criados/modificados; **findings de auditoria por severidade e status (corrigida no mesmo ciclo / issue aberta)**; desvios registrados.
9. **Aviso de merge:** informe que o fluxo terminou na branch `$(git branch --show-current)` e que o próximo passo é abrir PR para `main`. Não abra o PR automaticamente — mostre o comando sugerido com título e descrição preenchidos:
   ```bash
   gh pr create --title "..." --body "..."
   ```

---

## Critério de Conclusão

O fluxo termina quando:
- Todas as issues em `tasks/` têm todos os critérios `[x]`
- Nenhuma issue do grafo ficou pendente
- `pnpm build` e `npx vitest run` passam sem erro
- Verificação final reporta tudo OK

Ao concluir, exiba o resumo:
- Total de issues executadas
- Agentes usados por tipo (especificar: N, quebrar: N, planejar: N, arquitetar: N, migrar: N, desenhar: N, tdd: N, executar: N, revisar: N, testar: N, auditar: N, depurar: N, popular: N, verificar: N, escriba: N)
- Vulnerabilidades encontradas pelo `auditar` e status (corrigida / issue aberta)
- Cobertura de testes por tipo (unitário: N, Server Action: N, RLS: N, fluxo: N)
- Arquivos criados/modificados
- Desvios registrados
- Commits criados
