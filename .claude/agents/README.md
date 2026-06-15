# Agentes do iRango

Agentes especializados (subagents) para implementar o iRango. Cada um tem um papel único e conhece o stack do projeto (Next.js 15 + TypeScript + Supabase + Tailwind + shadcn/ui) e as referências em `references/`.

## Três mandatos — válidos em TODOS os agentes

1. **Nunca confiar no cliente.** O banco (RLS) é a última linha de defesa. Valor monetário é sempre recalculado no servidor — o cliente nunca define quanto paga (`seguranca.md` §10). Permissão é garantida por RLS, não por UI oculta.
2. **Não reinventar a roda.** Reusar antes de criar: `lib/utils/`, `lib/validacoes/`, `lib/supabase/queries/`, `components/`, e libs maduras (zod, shadcn/ui, react-imask, ViaCEP). Código duplicado é bug em potencial.
3. **TDD red-first em código crítico.** Toda issue marcada `crítica: SIM` (dinheiro, RLS, cupom, token, autorização) passa pela fase RED (`tdd`) antes de qualquer código de produção.

## Fluxo

```
especificar → quebrar → planejar (ou arquitetar) → [tdd RED] → executar GREEN → testar → auditar → verificar → documentar
                                                       └── só em issue crítica ──┘
```

| Agente | Papel | Modelo |
|--------|-------|--------|
| `especificar` | Descrição → spec acionável em `specs/` | opus |
| `quebrar` | Spec → issues ordenadas em `tasks/` (marca criticidade) | opus |
| `planejar` | Issue → plano técnico preciso | opus |
| `arquitetar` | Plano profundo para issue complexa (causa raiz, anti-remendo) | opus |
| `tdd` | Fase RED — teste vermelho antes do código (issue crítica) | opus |
| `executar` | Fase GREEN — implementa a issue | opus |
| `testar` | Testes de código já implementado | sonnet |
| `desenhar` | UI/UX, mockups, acessibilidade, design da vitrine/painel | opus |
| `auditar` | Segurança — caça vulnerabilidade real no código escrito | opus |
| `migrar` | Migrations de schema Postgres/Supabase (expand→contract) | opus |
| `documentar` | Mantém `references/` sincronizado (conservador) | sonnet |
| `verificar` | Roda o app e confirma o comportamento real | sonnet |

## Como invocar
Pelo orquestrador (Task/Agent) passando o `subagent_type` (ex.: `auditar`) e o caminho do alvo (issue, arquivo, ou descrição). Issues críticas: `tdd` antes de `executar`.
