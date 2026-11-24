# Handoff — 2026-11-23: frete (billing Google) + revisão de agentes/skills para Opus 5.5

Nota de contexto para retomar em outra sessão. Seções 1–6 escritas antes das edições; o que mudou depois está nas seções 7 a 9.

> **Estado em 2026-11-23:** tudo abaixo marcado "sem commit" já foi commitado — seções 7 e 8 em `f675cdd`,
> seção 9 no PR #200 (`f1efefe`), este arquivo em `8a9faa2`. Sincronização posterior em `05734fe`.

## 1. O que foi feito nesta sessão

- Loop 294 (`pedidos_insert_publico`): já entregue (PR #156, commit `02f735e`, migration `20260923060457_pedidos_remove_insert_publico.sql`). Cópia solta em `plan/` removida pelo usuário.
- Spec `specs/vitrine-cor-unica-primaria.md`: commitada e empurrada no `main` (`52bab97`, após `git pull --rebase`).
- Memória `agentes-irango` e `MEMORY.md`: contagem de agentes corrigida para 19.
- Incidente de frete: resolvido (seção 2).
- Revisão de agentes/skills vs `CLAUDE.md` para Opus 5.5, com pesquisa na doc (seções 3 e 4).

## 2. Incidente de frete — causa raiz e resolução

- Sintoma: ViaCEP achava o endereço, mas o checkout mostrava "Nosso serviço de endereços não respondeu agora" e o frete não calculava.
- Diagnóstico: logs de runtime na Vercel mostraram `[geocodificarEndereco] status Google: REQUEST_DENIED` em `/loja/paodociso/pedido`. O código mapeia qualquer status Google diferente de OK para o motivo `transitorio` (`src/lib/utils/geocodificarEndereco.ts`, ~linha 368-375), por isso a UI culpava "serviço não respondeu".
- Causa: a conta de faturamento do projeto Google Cloud de geocoding estava **fechada** ("This billing account is closed") depois de um cartão recusado. Trocar o cartão não reabriu a conta.
- Correção: **Reopen billing account** no console Google Cloud (conta de faturamento do projeto de geocoding). Frete voltou a calcular.
- O que NÃO era: `NOMINATIM_USER_AGENT` (o código migrou de Nominatim para Google na issue 190; a env existe no Vercel mas não é mais o caminho), Upstash, restrição de API da chave (chave "Maps Platform API Key" restrita a Geocoding API, ok).
- Pendências sugeridas:
  - Criar alerta/orçamento de billing no Google Cloud e manter um cartão reserva, para não repetir.
  - Atualizar a memória `frete-raio-geocode-ratelimit` (está desatualizada: descreve Nominatim e cache sem TTL; hoje é Google, TTL de 25 dias, cache v3). Adicionar o padrão de diagnóstico: `REQUEST_DENIED` nos logs Vercel = billing/chave, não código.
  - Opcional: distinguir `REQUEST_DENIED` de `transitorio` no código, com `console.error` já existente, para o lojista receber mensagem de configuração em vez de "tentando de novo".

## 3. Revisão dos agentes e skills — veredito pós-pesquisa

Fontes: guias `prompt-audit.md` e `model-migration.md` do skill `claude-api`; docs do Claude Code em subagentes e model-config.

| Item da análise inicial | Resultado |
|---|---|
| Tom de alarme (CAPS, 🛑) | Corrigido: concentrado no `fluxo.md` (10 linhas); demais arquivos têm 2 ou menos. Regra com restrição real (RLS, dinheiro, PII, `db push`) fica, de preferência com o porquê. |
| Subagentes carregam `CLAUDE.md` | Confirmado: por padrão sim; existe `omitClaudeMd: true` (versão mínima não verificada). |
| Repetição dos mandatos em vários arquivos | Rebaixado: redundância que funciona não é cruft. Só corrigir onde diverge (numeração duplicada dos gates no `fluxo.md`). |
| Alias `fable` no `pentester` | Confirmado: frontmatter aceita `sonnet`/`opus`/`haiku`/`fable`/id completo/`inherit`. Hoje fixa `claude-fable-5-1`; Fable 5.2 é sucessor mais barato ($8/$40 vs $10/$50). |
| Menos subagentes | Rebaixado a opinião: a doc só manda fundir agentes quase idênticos e tirar do LLM o que é determinístico. Medir antes. |
| Aviso "troque para Fable 5" na Etapa 0 do `fluxo.md` | Desatualizado. |
| Coreografia passo a passo | Confirmado como over-specification, mas operação frágil (`db push`, `migration repair`) mantém script exato. |

## 4. Achados novos (ordem de prioridade)

1. **Segurança — esforço (`effort`).** No Opus 5.5 o padrão é `medium` (no Opus 5 era `high`) e thinking não pode ser desligado. Nenhum dos 19 agentes define esforço. Candidatos a `high` ou mais: `auditar`, `tdd`, `pentester`, `executar` em issue crítica. **Antes de editar:** confirmar em https://code.claude.com/docs/en/sub-agents o nome do campo de frontmatter e se vale para subagentes (a doc do skill diz que "alguns agentes" aceitam `effort`; não verificado para o Claude Code).
2. **Segurança — impor em código o que está só em prosa.** Hooks (skill `update-config`) para: `git add -A`, commit de `.env*`, commit de `plan/seguranca-auditoria-*.md`, `npx supabase db push` sem autorização.
3. **`fluxo.md`:** baixar o tom de alarme mantendo os porquês; agrupar `tdd`/`auditar` por vetor (como o `orquestrar` já manda); corrigir numeração dos gates (dois "5." e dois "6."); remover o aviso de Fable da Etapa 0.
4. **`pentester`:** trocar `claude-fable-5-1` pelo alias `fable`.
5. **Agentes em Sonnet 5.5** (`testar`, `revisar`, `verificar`, `escriba`, `popular`): em esforço baixo ele pode declarar "pronto" sem verificação real. Adicionar o trecho da doc (rodar teste/tipos/build que exercite a mudança; checagem só de sintaxe não conta; se faltar só `npm install`, instalar).
6. Retestar instruções escritas para o Opus 5 (verbosidade, verificação excessiva, escopo) em vez de carregá-las intactas.
7. Baixa prioridade: `desenhar` — Opus 5.5 recai em poucos estilos padrão no frontend; listas de padrões nomeados a evitar funcionam melhor que "evite look genérico".

Limpo na checagem: nenhum agente pede ao modelo para despejar raciocínio na saída (risco de `refusal` no Opus 5.5); sem limites numéricos de saída nem cadência fixa de updates.

## 5. Restrições a respeitar ao aplicar

- Não enfraquecer nenhuma regra de RLS, valor monetário, token de pedido, PII, `db push` ou relatório de pentest.
- Edição de `.claude/` e `CLAUDE.md` é mudança sem código de produção: pode ir direto no `main`, mas só com ordem explícita do usuário (regra de push direto) ou via `/sincronizar-agentes`.
- `npm`, nunca `pnpm`; esta máquina não tem `node_modules` (gates tsc/lint/test/build rodam no outro PC).

## 6. Pendências abertas

- Confirmar no outro PC: `npx supabase migration list` com Remote preenchido para `20260923060457`.
- ~~Decidir por onde começar a seção 4~~ — executada; ver seções 7 e 8.
- Memória do frete (seção 2) ainda não atualizada.

## 7. Executado depois do handoff (2026-11-23, mesma sessão) — tudo local, sem commit

- Passo 1: doc de subagentes confirmou o campo `effort` (low a max) e `omitClaudeMd` (v2.1.271+). `effort: high` em `auditar`, `tdd`, `executar`, `pentester`; nota no `agents/README.md`.
- Passo 2: hook PreToolUse em `.claude/settings.json` + guarda (primeira versão em bash; substituída na seção 8). Nega `git add -A/--all/.`, `.env*` (exceto `.env.example`) e `plan/seguranca-auditoria-*`; pede confirmação em `supabase db push` (libera `--dry-run`). 22 casos testados por pipe e disparo real provado com `git add -n -A`.
- Passo 3: `fluxo.md` com regra de agrupar `tdd`/`auditar` por vetor, tom reduzido nos cabeçalhos (🛑 mantido só em deploy de migration e gate de migration no cloud), numeração dos gates corrigida, aviso de Fable removido.
- Passo 4: `pentester` com `model: fable` (alias) e referências a "fable 5.1" atualizadas.
- Passo 5: seção "Verificação real antes de dar como pronto" em `verificar` e `testar`, adaptada: não instalar dependências (node_modules removido de propósito) e reportar "não verificado".
- Decisão de reverter: apagar `effort` de um agente se o custo subir demais; o resto é independente.
- Pendências: commit (precisa de ordem explícita para ir direto no `main`, ou via PR), memória do frete e `omitClaudeMd` (não aplicado de propósito).

## 8. Revisão em Opus (2026-11-23) — aplicada, sem commit

- Agrupamento por vetor revertido no `/fluxo` (roda sem confirmação; issue fechava antes do `auditar` do vetor). Fica só no `/orquestrar`, com definição de vetor mais estrita.
- `/fluxo` não fecha issue "não verificada" e não insiste em verificar de novo na mesma máquina.
- `effort: high` em `auditar`, `tdd`, `pentester`, `migrar`, `quebrar`, `arquitetar`, `orquestrar-autonomo`. `executar` ficou de fora por custo (roda em toda issue e no `/fix`; coberto por `tdd` e `auditar`).
- YAML das descriptions de `tdd`, `escriba`, `orquestrar-autonomo` corrigido (19 frontmatters passam no parser).
- Revisão adversarial da guarda (~150 casos) achou bypass real: `git add -f plan/*.md` vazava o relatório; `ask` de `db push` engolia `deny` posterior; `db reset`/`migration up|repair` e variantes de lançador sem cobertura; falso positivo com heredoc. Guarda reescrita em node: `.claude/scripts/guard-bash.mjs` (lê aspas/heredoc/prefixos como o shell, `deny` vence `ask`, erro interno bloqueia) + regressão `guard-bash.test.mjs` (128/128). `guard-bash.sh` removido. Prova ao vivo: `git add -n -f plan/*.md` barrado; heredoc citando os comandos passa.
- Não aplicado (decisão do dono): hook de pre-commit do git que vê o que está staged de fato; tirar os relatórios de pentest de dentro do repo; secret scanning/push protection no GitHub; `permissions.deny` como segunda camada.

## 9. Camadas extras aceitas (2026-11-23) — aplicadas, sem commit

- Relatório `seguranca-auditoria-2026-09-22.md` movido para `~/irango-privado/seguranca/` (chmod 700/600), com marcador na 1ª linha. Nada de pentest resta em `plan/`. O `pentester` agora manda gravar lá.
- `.githooks/pre-commit` (barra `.env*`, `*seguranca-auditoria*` e 1ª linha com o marcador, no staging) + `.githooks/instalar.mjs` + script `prepare` no `package.json`. Ativo neste clone (`core.hooksPath`). Teste: `node .githooks/pre-commit.test.mjs` (12/12, inclui `git commit` real).
- Guarda do Claude: nega `--no-verify`, `commit -n`, `-c core.hooksPath` e `git config core.hooksPath` (exceto o valor `.githooks`). Teste: 148/148.
- Secret scanning e push protection: já estavam ligados no GitHub. Não ligados (decisão do dono): `secret_scanning_non_provider_patterns` e `dependabot_security_updates`.
- Vazamento antigo reavaliado: `76b866b` (relatório de 2026-06-19) segue público; 6,8 KB, sem chave/e-mail/PoC nos padrões testados. Não reescrever histórico (decisão em aberto desde 2026-07-02, não recomendado).
- Mudança toca `package.json` (código): vai por branch + PR. Gates (tsc, lint, test, build) não rodam nesta máquina (sem `node_modules`); dependem do CI ou do outro PC.

