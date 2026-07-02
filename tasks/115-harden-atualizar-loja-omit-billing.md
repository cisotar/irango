# 115 — Hardening: blindar `escopo.atualizarLoja` contra colunas de billing/dono

**crítica:** NÃO (defesa em profundidade; não há furo explorável hoje)
**Depende de:** — (branch `feat/enforcement-escopo-admin` já mergeada/aberta)

## Contexto

A auditoria da migração das actions admin para o wrapper `EscopoLoja`
(`src/lib/actions/admin-loja.ts`) apontou um resíduo de baixa severidade, **não
explorável hoje**, mas que fecharia a garantia "por construção":

`escopo.atualizarLoja(patch)` tipa `patch` como `Tabelas["lojas"]["Update"]`
**completo** — aceita, no tipo, colunas de billing/dono (`assinatura_status`,
`billing_provider`, `provider_subscription_id`, `plano_id`, `dono_id`,
`hotmart_*`, `consentimento_*`, `ativo`, `latitude`, `longitude`, `id`).

Por que **não** é furo hoje:
- O trigger `lojas_protege_billing` no banco bloqueia escrita dessas colunas por
  qualquer role **exceto** `service_role` — mas as actions admin rodam justamente
  como `service_role`, então a proteção do trigger não se aplica a elas.
- A proteção real hoje é **disciplina do chamador**: `admin-perfil` usa a allowlist
  `montarPatchPerfil` (RN-7) antes do `atualizarLoja`; `admin-publicar` passa
  `{ ativo }` exato; `admin-horarios-tema` passa `{ horarios }`/`{ tema }`
  zod-validados. Nenhum passa coluna autoritativa.

O risco é **futuro/estrutural**: uma action nova poderia montar um `atualizarLoja`
com coluna de billing/dono vinda de payload sem passar pela allowlist, e o tipo
não a barraria.

## Objetivo

Fechar por tipo, espelhando o que já foi feito no `escopo.atualizar`
(commit `bbaeb22`: `Omit<Update, "loja_id" | "id">`).

## Tarefas

1. Em `criarEscopoLoja` (`src/lib/actions/admin-loja.ts`), estreitar a assinatura
   de `atualizarLoja` para `Omit<Tabelas["lojas"]["Update"], CAMPOS>`, onde `CAMPOS`
   cobre `id` + colunas autoritativas de billing/assinatura/dono/consentimento/
   coords. Definir a lista uma vez (derivar de uma constante) para não divergir do
   trigger `lojas_protege_billing_v2`.
   - **Cuidado:** `admin-perfil` grava `latitude`/`longitude` (coords derivadas no
     servidor) via `atualizarLoja(coordsPatch)`. Se `CAMPOS` incluir lat/long, esse
     chamador quebra. Decidir: (a) permitir lat/long (coords são derivadas no
     servidor, não de payload) e omitir só billing/dono/id; ou (b) um helper
     dedicado `atualizarCoords`. Preferir (a) — mais simples, e coords já vêm de
     `geocodificarEnderecoComMotivo`, nunca do cliente.

2. Rodar `npx tsc --noEmit` — qualquer chamador que passe coluna omitida quebra em
   compilação (é o objetivo). Ajustar os chamadores legítimos ou a lista `CAMPOS`.

3. Rodar `npx vitest run src/app/admin/assinantes src/lib/actions/admin-loja.test.ts`
   — a suíte de isolamento (§3 "protected columns") deve continuar verde.

4. (Opcional, defesa em profundidade runtime) Considerar, além do `Omit` de tipo,
   um filtro em runtime que descarte chaves fora da allowlist no `atualizarLoja` —
   proteção contra `as`/cast que o tipo não pega. Avaliar custo/benefício.

## Fora de escopo

- Alterar o trigger `lojas_protege_billing` (a proteção do banco está correta).
- Tocar `escopo.atualizar` (já blindado no commit `bbaeb22`).

## Verificação

- `npx tsc --noEmit` limpo.
- `npx vitest run src/app/admin/assinantes` verde (incl. isolamento §3).
- `npx next build` (mandato: `'use server'` só exporta async).
