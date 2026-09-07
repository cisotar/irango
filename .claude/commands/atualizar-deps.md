---
name: atualizar-deps
description: Atualização rotineira de dependências com gate por pacote — npm outdated + npm audit, um bump por vez (ou grupo coeso), build e suíte verdes antes de cada commit. Major não é aplicado; vira relatório com breaking changes que tocam o projeto e issue em tasks/. Complementa o pentester (que casa CVE com versão) sem substituí-lo.
argument-hint: [opcional: pacote específico, ou "--security" para só o que npm audit aponta]
---

Você faz a manutenção de dependências do iRango. O objetivo é chegar ao fim com o `package-lock.json` mais novo possível **sem** nenhum gate vermelho e sem nenhum major aplicado às cegas. Um bump por vez: quando quebrar, você sabe quem foi.

**Regras fixas:**

- `npm`, nunca `pnpm`/`yarn`. Nunca `npm audit fix --force`, nunca `--legacy-peer-deps` sem explicar por quê no commit.
- Nunca toque em `.env*`. Nunca commite `node_modules`.
- O disco desta máquina anda cheio: antes de começar, `df -h .` e, se < 2 GB livres, `npm cache clean --force` e avise.
- Um commit por pacote (ou grupo coeso). Nunca `git add -A`: só `package.json` e `package-lock.json`.

**Branch:** a ativa. Se for `main`, crie `chore/deps-AAAA-MM-DD` antes.

---

## Escopo

$ARGUMENTS

- Sem argumento: tudo que `npm outdated` listar.
- Nome de pacote: só ele (e seu par obrigatório, ver grupos abaixo).
- `--security`: só o que `npm audit` aponta com severidade `high` ou `critical`.

---

## Etapa 1 — Levantamento

```bash
df -h .
npm outdated --json > /tmp/outdated.json; cat /tmp/outdated.json
npm audit --json > /tmp/audit.json; npm audit --audit-level=moderate
git status --short          # árvore precisa estar limpa em package.json/lock
```

Classifique cada pacote:

| Tipo | Critério | Política |
|---|---|---|
| **patch/minor** | `wanted` ≠ `current`, mesmo major | aplica, um por vez, com gate |
| **major** | `latest` com major maior que `current` | **não aplica**; vai pra Etapa 4 |
| **security** | aparece no `npm audit` | prioridade máxima; se o fix é patch/minor, aplica primeiro; se é major, Etapa 4 + avisar que o `pentester` deve casar o CVE com a versão instalada |

**Grupos coesos** (sobem juntos, num commit só, porque quebram separados):

- `react` + `react-dom` (+ `@types/react` + `@types/react-dom`)
- `@supabase/ssr` + `@supabase/supabase-js`
- `@serwist/turbopack` + `serwist` (+ qualquer `@serwist/*`)
- `eslint` + `eslint-config-next` + `@eslint/*`
- `vitest` + `@vitejs/plugin-react` + `vite-tsconfig-paths`
- `tailwindcss` + `@tailwindcss/postcss`

**Sensíveis** (mesmo em minor, leia as release notes antes: `WebFetch` da página de releases do GitHub do pacote):

`next`, `react`, `@supabase/*`, `@serwist/*`, `@sentry/nextjs`, `@base-ui/react`, `@electric-sql/pglite`, `tailwindcss`, `typescript`, `zod`

Ordem de aplicação: security → patch → minor de não-sensível → minor de sensível.

## Etapa 2 — Bump com gate (repita por pacote/grupo)

```bash
npm install <pacote>@<wanted> [<par>@<wanted>]      # nunca @latest quando latest é major
npm run build
npm test
```

- **Verde:** `git add package.json package-lock.json && git commit -m "chore(deps): <pacote> <de> → <para>"`. Se leu release notes por ser sensível, uma linha no corpo do commit dizendo o que mudou que toca o projeto (ou "nada relevante").
- **Vermelho:** `git checkout package.json package-lock.json && npm ci`. Registre o pacote, a versão e o erro exato (primeiras linhas) na tabela da Etapa 5. Não tente "consertar rápido" o código do projeto para acomodar a lib: isso é `/fix` ou `/fluxo` com issue própria. Siga para o próximo pacote.
- `pglite`, `vitest` ou `next` com falha na suíte: rode `npx vitest run tests/migrations` isolado antes de reverter, para saber se é o runner ou o banco em memória.

## Etapa 3 — Gates finais

Depois do último bump:

```bash
npm run build
npm test
npm audit --audit-level=moderate
git log --oneline main..HEAD          # ou desde o início da branch
```

Zero regressão: contagem de testes passando ≥ a de antes da primeira atualização (anote a baseline na Etapa 1).

## Etapa 4 — Majors e fixes de segurança que exigem major

Para cada um, **sem aplicar**:

1. `WebFetch` das release notes / changelog / guia de migração oficial.
2. `grep -rn` no projeto pelas APIs listadas como breaking. Só o que o projeto usa importa.
3. Escreva `tasks/NNN-deps-<pacote>-major.md` (próximo número livre) no formato das issues do projeto, `crítica: NÃO` salvo se o pacote for `next`, `@supabase/*` ou `@sentry/nextjs` (aí `crítica: SIM`, porque toca auth, RLS ou PII): objetivo, breaking changes que tocam o projeto com `arquivo:linha`, o que testar, e link do guia.
4. Se for security e o CVE tiver id, registre-o na issue e no relatório: o `pentester` precisa disso para escrever o teste-guarda de versão.

Não abra issue para major que não toca nada do projeto (grep vazio em todas as APIs quebradas): aplique como minor comum na Etapa 2 e diga no commit "major sem breaking que afete o projeto (grep em X, Y, Z vazio)".

---

## Etapa 5 — Saída

```markdown
## Dependências AAAA-MM-DD

| Pacote | De → Para | Tipo | Status | Obs |
|---|---|---|---|---|
| next | 16.2.9 → 16.2.11 | patch | ✅ commit abc123 | release notes: nada relevante |
| zod | 4.x → 5.0 | major | 📝 tasks/166 | breaking em .strict(); usado em 12 arquivos |
| pkg | … | minor | ❌ revertido | suíte: `tests/migrations/x.test.ts` falhou com "…" |

Baseline: N testes → final: M testes. `npm audit`: antes X high / depois Y high.
Espaço em disco: antes / depois.
Próximo passo: abrir PR com `/pr`; majors ficam para `/fluxo` nas issues criadas.
```

## Quando parar e escalar

- `npm install` falha por conflito de peer que não se resolve com o grupo coeso → não force; registre e siga.
- Mais de 3 pacotes revertidos por falha na suíte → pare: provavelmente algo transversal (runner, TypeScript, Node) subiu e o resto depende dele; relate antes de continuar.
- Vulnerabilidade `critical` cujo fix é major → pare o resto, escreva a issue como `crítica: SIM` e avise que o `pentester` deve rodar antes do próximo deploy.
