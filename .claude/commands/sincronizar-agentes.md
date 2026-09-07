---
name: sincronizar-agentes
description: Verifica se os agentes e skills em .claude/ ainda descrevem o repositório real — caminhos, comandos, libs, funções, seções dos references, slash commands, model ids — e corrige o drift com evidência. O escriba mantém references/ alinhado com o código; esta skill mantém .claude/ alinhado com references/ e com o código.
argument-hint: [opcional: arquivo ou agente específico, ex. "tdd" ou ".claude/commands/fluxo.md"]
---

Você audita `.claude/agents/*.md` e `.claude/commands/*.md` contra o repositório. Um agente que cita `supabase start` num projeto que testa em pglite, ou `pnpm` num repo com `package-lock.json`, faz o agente pular etapa ou falhar em silêncio. Seu trabalho é achar cada afirmação verificável nesses arquivos, verificar, e corrigir o que estiver errado.

**Regra:** corrija só o que você **provou** errado, com o valor certo vindo do repo. Afirmação que não dá pra verificar mecanicamente vai pro relatório como "a confirmar", não é editada.

**Branch:** a ativa. Commit próprio `chore(agentes): sincroniza …`.

---

## Escopo

$ARGUMENTS

Sem argumento: todos os arquivos de `.claude/agents/` e `.claude/commands/`, mais `CLAUDE.md`.

---

## Etapa 1 — Fatos do repositório (fonte de verdade)

Levante uma vez, antes de ler qualquer agente:

```bash
ls package-lock.json pnpm-lock.yaml yarn.lock 2>/dev/null          # gerenciador real
grep -A12 '"scripts"' package.json                                   # comandos reais
ls src/lib/database.types.ts src/types/supabase.ts 2>/dev/null       # arquivo de tipos vivo vs morto
grep -rln "database.types\|types/supabase" src | wc -l               # quem importa o quê
cat vitest.config.* | grep -n "environment\|include"                 # runner e onde ficam os testes
ls tests/helpers/ tests/migrations/ | head                            # mecanismo de teste de RLS
grep -rl "^['\"]use server['\"]" src | xargs -n1 dirname | sort -u    # onde vivem as Server Actions
ls references/                                                       # quais references existem
ls .claude/commands/ | sed 's/\.md$//'                               # slash commands que existem
ls .claude/agents/*.md | xargs -n1 basename | sed 's/\.md$//'        # agentes que existem
grep -n "^## \|^### " references/*.md                                # seções citáveis (§N)
```

Guarde esses resultados: toda verificação da Etapa 2 compara contra eles.

## Etapa 2 — Extração e verificação por arquivo

Para cada arquivo em escopo, extraia e verifique cada classe de afirmação:

| Classe | Como extrair | Como verificar |
|---|---|---|
| **Caminho** | backticks com `src/`, `tests/`, `supabase/`, `references/`, `.claude/`, `specs/`, `tasks/`, `plan/`, `performance/` | `test -e <caminho>`; para diretório citado como convenção (ex. `src/__tests__/`), existe e tem arquivo? |
| **Comando** | linhas com `npm`, `pnpm`, `npx`, `yarn`, `supabase`, `vitest`, `next` | gerenciador bate com o lockfile; script existe em `package.json`; `supabase start`/`db reset` só se o projeto tiver Postgres local (não tem) |
| **Símbolo** | backticks em camelCase ou com `()` (ex. `validarCupom`, `createTestDb()`) | `grep -rn "function <nome>\|const <nome>\|export.*<nome>" src tests supabase` |
| **Lib** | nomes de pacote (`@…/…`, `react-…`, `zod`, `sonner`, `@testing-library/react`, `dompurify`) | está em `package.json`? Se não e o agente manda usar, é drift |
| **Reference e seção** | `architecture.md §8`, `seguranca.md §10` | arquivo existe e tem heading com esse número |
| **Slash command** | `/nome` em backticks | existe `.claude/commands/nome.md` (ou é built-in do Claude Code: `/model`, `/config`) |
| **Agente** | nome em backticks que bate com um agente | existe `.claude/agents/nome.md`; o README lista todos os arquivos? |
| **Model id** | `model:` no frontmatter | alias (`opus`, `sonnet`, `haiku`, `fable`) ou id completo atual; id de geração anterior é drift |
| **Caminho absoluto** | `/home/`, `/Users/`, `C:\` | nunca deve existir: é máquina de alguém |
| **Número volátil** | contagens ("1219 testes"), versões de lib, datas | substitua por descrição estável ou remova |

Mantenha uma lista de **frases de drift conhecido** deste repo e faça grep direto por elas:

```
pnpm build | pnpm dev | pnpm supabase | supabase start | Supabase local | db reset
src/types/supabase.ts (como gerado) | src/__tests__ | @testing-library | Radix
src/app/actions/ | middleware como guard | /home/ | /break | /plan | /tdd | /execute
```

## Etapa 3 — Contradições entre agentes e references

Além dos fatos mecânicos, procure afirmações de **arquitetura** que os references já decidiram diferente. Leia as seções relevantes e compare:

- Auth: `architecture.md` §5 (quem decide acesso: layouts, não middleware) ↔ o que `auditar`/`pentester` cobram
- Testes: `architecture.md` §7 (pglite) e §8 (padrão de injeção para browser) ↔ `tdd`/`testar`
- Stack de UI: `design-system.md` §3 (Base UI) ↔ `desenhar`
- Estrutura: `architecture.md` §3 ↔ qualquer caminho citado
- Entitlement/billing: `seguranca.md` §2 e `architecture.md` §6 ↔ `auditar`/`pentester`

Contradição entre dois agentes (ex. um manda `pnpm`, outro proíbe) também é drift: o repo decide quem está certo.

## Etapa 4 — Correção

Para cada achado provado: edite com o valor certo, no mesmo tom e formato do arquivo. Não reescreva seções, não "melhore" prosa que está correta. Depois de editar, rode de novo o grep de frases de drift: deve voltar vazio (ou só com negações do tipo "não existe Supabase local").

Se o drift estiver no **reference** e não no agente (ex. `architecture.md` cita arquivo que não existe), corrija o reference também com bump de versão patch + data, como o `escriba` faz, e registre.

Um commit: `chore(agentes): sincroniza .claude/ com o repo` com a lista do que mudou no corpo.

---

## Saída

```markdown
## Sincronização AAAA-MM-DD

### Fatos do repo usados como verdade
- gerenciador: npm | tipos: src/lib/database.types.ts | testes: vitest+pglite, ao lado do módulo | actions: src/lib/actions/ …

### Corrigido (arquivo:linha → o que era → o que ficou)
- .claude/agents/tdd.md:66 — "Supabase local (supabase start)" → pglite via tests/helpers/pglite.ts

### Contradições resolvidas
- auditar × architecture.md §5 — guard no middleware → guard nos layouts

### A confirmar (não verificável mecanicamente)
- …

### Sem drift
- lista dos arquivos que passaram limpos
```

## Quando rodar

- Ao fim de um `/fluxo` que mudou estrutura, stack, convenção ou mecanismo de teste (depois do `escriba`)
- Depois de renomear/mover pasta em `src/`, trocar lib, ou mudar gerenciador/runner
- Ao adicionar ou renomear agente ou skill (o README e o `/fluxo` precisam listar)
- Periodicamente, antes de confiar num agente que não roda há semanas
