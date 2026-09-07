---
name: triar
description: Reconcilia o backlog que vive em quatro lugares — tasks/, specs/, a tabela de débitos do architecture.md §10 e as issues do GitHub — contra o código real. Marca o que já foi resolvido (com evidência arquivo:linha), o que está obsoleto e o que segue aberto, e propõe ordem de ataque. Só fecha item com prova.
argument-hint: [opcional: pasta ou tema para restringir, ex. "admin" ou "tasks/15*"]
---

Você é o tech lead fazendo triagem de backlog do iRango. O backlog está espalhado e ninguém reconcilia: issue em `tasks/` pode já ter sido implementada por outra, débito do `architecture.md` §10 pode ter sido pago sem a tabela ser atualizada, spec pode ter behaviors `[ ]` que o código já cobre. Seu trabalho é cruzar tudo com o código e dizer o que é real.

**Regra de ouro:** só marque algo como resolvido com evidência `arquivo:linha` que qualquer pessoa consiga abrir e confirmar. Sem evidência, o item continua aberto. Na dúvida, aberto.

**Branch:** a ativa. Edições vão em commit próprio `chore(triagem): ...`.

---

## Escopo

$ARGUMENTS

Sem argumento: tudo. Com argumento: restrinja às fontes que casam com o tema/glob.

---

## Etapa 1 — Inventário das quatro fontes

```bash
ls tasks/*.md                                   # issues abertas
ls specs/*.md specs/arquivo/*.md                # specs abertas e arquivadas
sed -n '/^## 10\./,$p' references/architecture.md   # tabela de débitos técnicos
gh issue list --state open --limit 100 2>/dev/null   # se houver remote + gh
```

Para cada item, extraia: identificador (número ou slug), título, criticidade (`crítica: SIM/NÃO` nas issues), e as **âncoras verificáveis** que o texto cita: caminhos de arquivo, nomes de função, tabelas, colunas, políticas RLS, migrations, números de issue relacionados.

## Etapa 2 — Verificação contra o código (uma por item)

Para cada âncora:

```bash
test -e <caminho>                                  # arquivo citado existe?
grep -rn "function <nome>\|const <nome>\|export.*<nome>" src tests supabase   # símbolo existe?
ls supabase/migrations | grep -i <tema>            # migration citada existe?
grep -rn "<coluna>\|<policy>" supabase/migrations  # coluna/policy existe?
```

Depois leia o trecho encontrado. Existir o símbolo não prova que a issue está resolvida: confira se o comportamento pedido no **critério de aceite** está implementado e, quando for crítico, se há teste (`grep -rln "<nome>" src tests | grep test`).

Classifique cada item em exatamente uma categoria:

| Categoria | Critério | Ação |
|---|---|---|
| **RESOLVIDO** | todos os critérios de aceite têm evidência `arquivo:linha` no código (e teste, se `crítica: SIM`) | propor fechamento com a evidência |
| **PARCIAL** | parte dos critérios tem evidência | manter aberto; marcar `[x]` nos critérios provados e listar o delta |
| **ABERTO** | nenhuma evidência | manter; só reprioriza |
| **OBSOLETO** | o contexto mudou (arquivo/fluxo citado não existe mais, decisão de produto reverteu, coberto por outra issue) | propor arquivar com a justificativa |
| **DUPLICADO** | mesmo objetivo de outro item aberto | propor unir, mantendo o de menor número |

Sinais de RESOLVIDO que costumam passar despercebidos neste repo:

- Débito do §10 cujo "quando revisar" cita issue já fechada (`gh issue view NNN --json state` ou arquivo ausente em `tasks/`).
- Débito do §10 contradito por outra seção do mesmo `architecture.md` (ex.: guard descrito como implementado em §5 e listado como pendente em §10).
- Issue de `tasks/` cujos arquivos-alvo já contêm o padrão pedido e a suíte tem teste com o nome do comportamento.
- Spec com behavior `[ ]` cujo componente/action citado já existe e está em uso.

## Etapa 3 — Aplicar o que tem prova

Aplique **só** RESOLVIDO e OBSOLETO com evidência. PARCIAL só recebe `[x]` nos critérios provados. Nunca delete issue ABERTA.

- **Issue em `tasks/` RESOLVIDA:** se existe no GitHub, `gh issue close NNN --comment "Resolvido em <commit/arquivo:linha>"`; `git rm tasks/NNN-*.md`. Se a issue tem `Spec:`, marque `[x]` nos behaviors correspondentes; se o spec ficar 100% `[x]`, `git mv` para `specs/arquivo/`.
- **Débito do §10 pago:** edite a linha da tabela para o padrão já usado ali ("implementado (issue NNN): …" na coluna Decisão, `—` em Quando revisar). Bump de versão patch + data no header do `architecture.md`, como o `escriba` faria.
- **OBSOLETO:** mova a issue para `tasks/arquivo/` (crie a pasta se não existir) com uma linha `**Arquivada em AAAA-MM-DD:** motivo` no topo. Não delete: o histórico da decisão vale.
- **DUPLICADO:** adicione `**Duplica:** NNN` na issue mais nova e mova-a para `tasks/arquivo/`.

Um commit por categoria aplicada (`chore(triagem): fecha issues resolvidas`, `chore(triagem): atualiza débitos do architecture.md`, `chore(triagem): arquiva issues obsoletas`). Nunca `git add -A`.

## Etapa 4 — Ordem de ataque do que ficou aberto

Ordene o que sobrou (ABERTO + PARCIAL) por:

1. `crítica: SIM` com brecha de segurança já auditada (finding MÉDIA+ que virou issue) — primeiro, sempre
2. `crítica: SIM` restante (dinheiro, RLS, token, auth)
3. Débito que bloqueia outra issue (`Depende de:`)
4. Performance com achado GARGALO registrado em `performance/`
5. O resto, por idade (mais antigo primeiro)

Para cada item da lista, uma linha: `NNN — título — categoria — por que está nessa posição — skill sugerida (/fix ou /fluxo)`.

---

## Saída

```markdown
## Triagem AAAA-MM-DD

### Contagem
| Fonte | Total | Resolvido | Parcial | Aberto | Obsoleto | Duplicado |

### Fechados (com evidência)
- NNN — título — `arquivo:linha` — teste: `arquivo.test.ts` (se crítico)

### Débitos do §10 atualizados
- item — evidência

### Arquivados (obsoleto/duplicado)
- NNN — motivo

### Ordem de ataque
1. NNN — ...

### Sem decisão (precisa do humano)
- NNN — o que falta para decidir
```

## Restrições

- Nunca feche item sem `arquivo:linha`. "Parece implementado" é ABERTO.
- Nunca reescreva o conteúdo de uma issue aberta; só marque critérios e adicione linhas de metadado.
- Nunca toque em `specs/arquivo/` além de mover para lá.
- Se o remote/`gh` não estiver disponível, trabalhe só com os arquivos locais e registre "GitHub: não consultado".
