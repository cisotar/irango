---
name: pr
description: Fecha o ciclo que o /fluxo deixa aberto — roda os gates finais (build, suíte, migration no cloud, tipos), monta o corpo do PR no formato do projeto e abre o PR para main com gh. Não faz merge. Opcionalmente faz smoke check na URL de produção após o merge.
argument-hint: [título curto do PR] [--smoke https://dominio-de-producao]
---

Você é o engenheiro responsável por entregar a branch atual como PR para `main`. Rode todos os gates, não pule nenhum, e não abra o PR com gate vermelho. Nunca faça merge: isso é decisão do usuário.

**Branch:** a ativa (`git branch --show-current`). Se for `main`, pare: não há o que entregar.

---

## Argumentos

$ARGUMENTS

- Sem título: derive do primeiro commit da branch que não está em `main` (`git log main..HEAD --reverse --format=%s | head -1`), no formato Conventional Commits.
- `--smoke <url>`: após o usuário confirmar o merge, roda o smoke check contra essa URL. Sem o flag, o smoke não roda e o relatório registra "smoke: não executado".

---

## Etapa 1 — Estado da árvore

```bash
git status --short
git log main..HEAD --oneline
```

- Arquivo modificado fora do escopo da branch (ex.: spec de outro assunto): **não** inclua no PR. Liste no relatório como "fora do PR, deixado na árvore".
- Nenhum commit à frente de `main` → pare e informe.
- Qualquer `.env*` no diff (`git diff main --name-only | grep -E '^\.env'`) → pare. Nunca entra em PR.

## Etapa 2 — Gates (todos obrigatórios, nesta ordem)

```bash
npm run build                      # zero erros, zero warnings novos
npm test                           # suíte inteira em pglite
npx supabase migration list        # toda linha com Remote preenchido
```

Regras:

1. **Build** vermelho → corrija ou pare. `const` exportada em arquivo `'use server'` só quebra aqui, não no tsc.
2. **Suíte** com falha → pare. Não abra PR "com um teste quebrado que já estava assim". Se for pré-existente, prove com `git stash` + rerun em `main` e registre no corpo do PR.
3. **Migration só-local** (coluna Remote vazia) → pare. O app de produção roda contra o cloud; PR com migration não aplicada gera `PGRST204` após o deploy da Vercel. O push é irreversível: apresente a migration, confirme que é aditiva e **peça autorização** para `npx supabase db push`. Sem "sim", o PR não abre.
4. **Tipos sincronizados**: se `git diff main --name-only -- supabase/migrations/` não estiver vazio, `src/lib/database.types.ts` também precisa estar no diff. Se não estiver, regenere (`npx supabase gen types typescript > src/lib/database.types.ts`), rode build de novo e faça commit `chore(tipos): regenera database.types.ts`.
5. **Segredo hardcoded**: `git diff main | grep -nE 'eyJ[A-Za-z0-9_-]{20,}|sk_(live|test)_|pk_(live|test)_|Bearer [A-Za-z0-9]'` vazio.

## Etapa 3 — Corpo do PR

Colete automaticamente:

- **Issues fechadas:** `git diff main --diff-filter=D --name-only -- tasks/` (arquivos removidos = issues concluídas). Liste por número e título (primeira linha do arquivo em `git show main:tasks/<arquivo>`).
- **Specs arquivadas:** `git diff main --diff-filter=A --name-only -- specs/arquivo/`.
- **Migrations:** `git diff main --diff-filter=A --name-only -- supabase/migrations/` + confirmação "aplicada no cloud (migration list)".
- **Auditorias de performance:** `git diff main --diff-filter=A --name-only -- performance/`.
- **Findings de segurança:** procure nos commits da branch (`git log main..HEAD --format=%b`) e nas issues fechadas por menções a `auditar`/`CRÍTICA`/`ALTA`/`MÉDIA`; liste severidade e status (corrigida no ciclo / issue aberta em `tasks/`).

Modelo do corpo (preencha só as seções com conteúdo; remova as vazias):

```markdown
## Resumo
<2–4 frases: o que muda para o lojista/cliente/admin e por quê>

## Issues fechadas
- [NNN] título

## Migrations
- `AAAAMMDDHHMMSS_nome.sql` — aditiva; aplicada no cloud ✔

## Segurança
- <severidade> — <título> — corrigida no ciclo / aberta em tasks/NNN

## Como verificar
1. <passo reproduzível na vitrine ou painel>
2. <estado esperado no banco ou UI>

## Gates
- [x] `npm run build` verde
- [x] `npm test` verde (N arquivos, M testes)
- [x] `npx supabase migration list` sem migration só-local
- [x] tipos regenerados (se houve migration)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

## Etapa 4 — Abrir o PR

```bash
git push -u origin "$(git branch --show-current)"
gh pr create --base main --title "<título>" --body-file <arquivo temporário no scratchpad>
```

Mostre a URL do PR. **Não faça merge**, não aprove, não marque auto-merge.

## Etapa 5 — Smoke pós-merge (só com `--smoke <url>`)

Aguarde o usuário dizer que o merge foi feito e o deploy da Vercel terminou. Então:

```bash
curl -s -o /dev/null -w '%{http_code}\n' "<url>/loja/<slug de teste do seed>"      # esperado 200
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' "<url>/painel"             # esperado 3xx → /login
curl -s -o /dev/null -w '%{http_code}\n' "<url>/loja/<slug>/manifest.webmanifest"   # esperado 200
```

Nada além de GET. Sem POST, sem criar pedido em produção. Qualquer código fora do esperado → relate como **regressão em produção** e sugira `git revert` do merge commit como primeira opção.

---

## Saída

- URL do PR
- Tabela de gates com resultado
- O que ficou fora do PR e por quê
- Smoke: resultado por endpoint, ou "não executado"

## Quando parar e escalar

- Gate vermelho que não é trivial de corrigir → pare, descreva, sugira `/fix` ou `/fluxo`.
- Migration só-local e usuário não autorizou o push → pare; PR não abre.
- Branch com mais de um assunto misturado (commits de features distintas) → sugira dividir antes de abrir.
