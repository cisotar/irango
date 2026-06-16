---
name: fix
description: Workflow leve para correções simples (≤3 arquivos, sem RLS/migrations/Server Actions de valor/auth). Vai direto ao código sem especificar/quebrar/auditar completo. Use /fluxo para qualquer coisa fora desse escopo.
argument-hint: [descrição do fix ou número da issue]
---

Você é um engenheiro sênior executando uma correção simples. Vá direto ao ponto — sem cerimônia, sem agentes desnecessários.

**Branch:** todos os commits vão para a branch ativa. Nunca troque de branch. Se não souber qual é, rode `git branch --show-current` antes de começar.

---

## Critérios de uso — verifique antes de começar

Use `/fix` apenas quando **todos** forem verdadeiros:

- ≤ 3 arquivos modificados
- Sem toque em migrations Supabase (`supabase/migrations/`)
- Sem toque em políticas RLS
- Sem lógica de autenticação, autorização ou permissão
- Sem Server Action que lide com valor monetário, cupom, frete ou pedido
- Fix de UI, renderização, lógica isolada de front-end, ou correção pontual de função pura
- Se a mudança não altera lógica nem comportamento (só aparência/copy/espaçamento) — use `/polir`, não `/fix`

**Se qualquer critério falhar durante a execução:** pare, informe o motivo e escale para `/fluxo`.

---

## Princípios de implementação — ordem obrigatória

Antes de escrever qualquer linha nova, percorra esta sequência:

### 1. Reusar o que já existe no projeto

Grep pelo conceito no código. Se outro componente ou util já resolve o mesmo problema, copie e adapte — nunca reescreva o que já funciona.

```bash
grep -rn "conceito_relevante" src/
```

### 2. Preferir solução conhecidamente funcional

Se o padrão interno não existir, use a abordagem mais simples e comprovada. Prefira o óbvio ao engenhoso. Três linhas diretas valem mais que uma abstração prematura.

### 3. Buscar externamente quando necessário

Se a solução não for óbvia (API desconhecida, comportamento de browser, edge case de CSS), use WebSearch ou WebFetch **antes** de inventar. Anote a fonte em comentário apenas se a razão não for evidente para um leitor futuro.

### 4. Respeitar boas práticas em todas as camadas

- Naming claro — sem abreviações obscuras
- Sem código morto, sem `console.log` esquecido
- Sem side effects ocultos em funções puras
- Sem segurança comprometida (XSS, dados cross-tenant, valor/permissão só no cliente)
- Sem comentários explicando **o que** o código faz — apenas o **porquê** quando não for óbvio

---

## Etapas

### 0. Verificar escopo

- Issue já existe em `tasks/`? Use o número dela no commit e feche ao final.
- Já implementado? Reporte e encerre sem criar nada.
- Parcialmente implementado? Anote o delta e implemente só o que falta.

### 1. Entender o problema

Leia os arquivos afetados. Identifique o padrão mais próximo já existente no projeto. Documente mentalmente: "onde já está feito, o que precisa mudar".

### 2. Implementar

- **Edit direto** se a mudança for mecânica (< 40 linhas, padrão já existe em outro lugar no projeto).
- **Agente `executar`** se houver lógica nova, múltiplos pontos de alteração interdependentes, ou risco real de regressão.

Regras durante a implementação:
- Reusar componentes/helpers/utils existentes
- Sem abstração nova a menos que o padrão se repita 3× no mesmo diff
- Sem feature flags, sem backwards-compat shims — mude o código diretamente
- Sem tratamento de erro para cenários impossíveis no contexto atual
- `npm` (não `pnpm`) — o lockfile é `package-lock.json`

### 3. Build obrigatório

```bash
npx tsc --noEmit
npm run build
```

Zero erros, zero warnings novos. Se quebrar, corrija antes de continuar — não avance com build vermelho.

### 4. Testes

```bash
npm test
```

Zero regressões novas. Os testes usam Vitest + pglite (sem Docker, sem Supabase local).

Se a mudança toca lógica sem cobertura de teste — use o agente `testar` para decidir se vale escrever um. Para JSX puro de renderização, testes são opcionais.

> **🛑 Realidade de ambiente — build/teste verde ≠ funciona em runtime.** `npm run dev`
> roda contra o **Supabase cloud** (`.env.local`), não um banco local. Os testes (pglite)
> e o `build` não tocam o cloud. Se o fix depende de schema/coluna/RLS que só existe numa
> migration ainda **não aplicada no cloud**, ele falha em runtime com
> `PGRST204 Could not find the '<coluna>' ... in the schema cache` mesmo com tudo verde.
> Isso NÃO é um `/fix`: migration é gate de `/fluxo`. Se o sintoma aparecer, **pare e
> escale** — não tente contornar no código.

### 5. Revisar + auditar (condicional)

**Auditar — obrigatório** se o diff toca qualquer destes:
- `dangerouslySetInnerHTML`
- montagem de URL, `href`, `src`, ou `window.location`
- render de campo livre do usuário (label custom, nome editável, descrição)
- `JSON.parse` de string externa (localStorage, URL params)
- regex sobre input controlado pelo usuário
- qualquer valor lido de `searchParams` ou `params` sem validação

Tratamento de findings:
- **CRÍTICO/ALTO** — corrija no mesmo ciclo, rebuild
- **MÉDIO** — abra issue separada em `tasks/`, não bloqueia o fix
- **BAIXO** — registre mentalmente, siga adiante

### 6. Commit

```bash
git add <arquivos específicos>
git commit -m "fix(#NNN): descrição curta"
```

Nunca `git add -A`. Nunca commitar `.env*`.

### 7. Fechar (se havia issue)

```bash
rm tasks/NNN-*.md
git add tasks/NNN-*.md
git commit -m "chore(tasks): fecha NNN"
```

---

## Quando escalar para /fluxo

Pare e avise se durante a execução você descobrir qualquer um destes:

- Mais de 3 arquivos precisam mudar
- Toque em `supabase/migrations/` ou políticas RLS
- Toque em Server Action de valor monetário, cupom, frete ou pedido
- Lógica de autenticação ou autorização (Supabase Auth, guard de painel)
- Race condition ou problema de timing
- Mudança de schema de tabela com dados
- **Blast radius alto:** o arquivo modificado está em `src/lib/` e é importado por mais de 3 outros arquivos

```
⚠ Escopo maior que o esperado: [motivo].
Recomendo escalar para /fluxo. Prossigo?
```
