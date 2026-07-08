# Agentes do iRango

Agentes especializados (subagents) para implementar o iRango. Cada um tem um papel único e conhece o stack do projeto (Next.js 16 + TypeScript + Supabase + Tailwind + shadcn/ui) e as referências em `references/`.

## Três mandatos — válidos em TODOS os agentes

1. **Nunca confiar no cliente.** O banco (RLS) é a última linha de defesa. Valor monetário é sempre recalculado no servidor — o cliente nunca define quanto paga (`seguranca.md` §10). Permissão é garantida por RLS, não por UI oculta.
2. **Não reinventar a roda.** Reusar antes de criar: `lib/utils/`, `lib/validacoes/`, `lib/supabase/queries/`, `components/`, e libs maduras (zod, shadcn/ui, react-imask, ViaCEP). Código duplicado é bug em potencial.
3. **TDD red-first em código crítico.** Toda issue marcada `crítica: SIM` (dinheiro, RLS, cupom, token, autorização) passa pela fase RED (`tdd`) antes de qualquer código de produção.

## Fluxo

```
especificar → quebrar → planejar (ou arquitetar/migrar) → [tdd RED] → executar GREEN
                                                              └── só em issue crítica ──┘
    → [revisar ‖ testar ‖ auditar] → [popular se schema] → verificar → documentar
```

Se bloqueio em executar/verificar: `depurar` primeiro, depois re-rotear.

| Agente | Papel | Modelo |
|--------|-------|--------|
| `especificar` | Descrição → spec acionável em `specs/` | opus |
| `quebrar` | Spec → issues ordenadas em `tasks/` (marca criticidade) | opus |
| `planejar` | Issue → plano técnico preciso | opus |
| `arquitetar` | Plano profundo para issue complexa (causa raiz, anti-remendo) | opus |
| `migrar` | Migrations de schema Postgres/Supabase (expand→contract) | opus |
| `desenhar` | UI/UX, mockups, acessibilidade, design da vitrine/painel | opus |
| `tdd` | Fase RED — teste vermelho antes do código (issue crítica) | opus |
| `executar` | Fase GREEN — implementa a issue | opus |
| `revisar` | Code review: TypeScript, padrões, DRY, dead code (paralelo com testar/auditar) | sonnet |
| `testar` | Testes de código já implementado (paralelo com revisar/auditar) | sonnet |
| `auditar` | Segurança — caça vulnerabilidade real (paralelo com revisar/testar) | opus |
| `depurar` | Debug de bloqueio: runtime error, PGRST204, comportamento errado | opus |
| `popular` | Atualiza `seed.sql` após issue de schema — pré-condição de verificar | sonnet |
| `verificar` | Roda o app (contra cloud) e confirma comportamento real | sonnet |
| `documentar` | Mantém `references/` sincronizado (conservador) | sonnet |

## Como invocar
Pelo orquestrador (Task/Agent) passando o `subagent_type` (ex.: `auditar`) e o caminho do alvo (issue, arquivo, ou descrição). Issues críticas: `tdd` antes de `executar`.
