## Plano Técnico

### Análise do Codebase

O que já existe e será reusado:
- `src/lib/supabase/client.ts` (`createClient`) — browser client `@supabase/ssr`. O helper o importa; não criar novo client.
- `sonner` (`toast`) — já dependência e já usado nas duas páginas. O helper dispara `toast.error` internamente (mantém o comportamento atual).
- `src/lib/auth/` — diretório já existe (`reconciliarPosConfirmacao.ts`). É o destino correto; nenhuma pasta nova.

O que será criado:
- `src/lib/auth/googleOAuth.ts` — uma função `entrarComGoogle()` que move o corpo hoje duplicado. Justificativa: o corpo está copiado byte-a-byte em `login/page.tsx:63-70` e `cadastro/page.tsx:79-86` (confirmado por `grep`), com risco de drift. Não há helper equivalente em `src/lib/`.

Confirmação de duplicação (idêntica nos dois arquivos):
```ts
const supabase = createClient();
const { error } = await supabase.auth.signInWithOAuth({
  provider: "google",
  options: { redirectTo: `${window.location.origin}/auth/callback` },
});
if (error) toast.error("Não foi possível entrar com o Google. Tente novamente.");
```

Nota: a issue cita `cadastro:79-85`, mas a função vai de 79 a 86 (corpo + chave de fechamento). Usar a função inteira como alvo da remoção.

### Cenários

**Caminho Feliz:**
1. Usuário clica em "Entrar com Google" em `/login` ou `/cadastro`.
2. `onClick={entrarComGoogle}` chama o helper importado.
3. Helper cria o browser client e chama `signInWithOAuth({ provider: "google", redirectTo: origin + "/auth/callback" })`.
4. Supabase redireciona o navegador para o consent do Google. Sem `error`, nada de toast.

**Casos de Borda:**
- `signInWithOAuth` retorna `error` (provider mal configurado, rede): helper dispara `toast.error("Não foi possível entrar com o Google. Tente novamente.")` — mesma mensagem genérica de hoje (`seguranca.md §14`).
- Falha de rede antes da resposta: o `await` rejeita; comportamento idêntico ao atual (não havia try/catch antes — manter para não mudar escopo). Risco listado abaixo.
- `window` indefinido: impossível em prática — o helper só é chamado de componentes `'use client'` via `onClick` no navegador. O arquivo NÃO leva `'use server'`.

**Tratamento de Erros:** mensagem genérica ao usuário via toast; nenhum detalhe técnico exposto (`seguranca.md §14`). Comportamento preservado, sem novo log (o original não logava).

### Schema de Banco
Não se aplica. Nenhuma tabela, coluna ou migration. Refactor puro de código cliente.

### Validação (zod)
Não se aplica. Sem input de usuário a validar — o único parâmetro enviado ao Supabase é `provider: "google"` (literal hardcoded) e `redirectTo` (path interno derivado de `window.location.origin`).

### Recálculo no Servidor
Não se aplica. Sem valor monetário.

### Regra cliente ↔ servidor
- Sem RLS, sem permissão, sem valor — nada a garantir server-side. O OAuth é iniciado no client por design do `@supabase/ssr` (PKCE no navegador); o `redirectTo` é um path interno validado contra a allow-list do Supabase Auth (`seguranca.md §7/§9). O secret do Google nunca chega ao client.
- Por isso o helper é legitimamente client-side e NÃO é Server Action. Não há invariante de servidor a mapear.

### Arquivos a Criar / Modificar / NÃO tocar

Criar:
- `src/lib/auth/googleOAuth.ts` — exporta `async function entrarComGoogle(): Promise<void>`. Importa `createClient` de `@/lib/supabase/client` e `toast` de `sonner`. Corpo idêntico ao atual. Sem `'use client'`/`'use server'` (módulo neutro, importado por componentes client).

Modificar:
- `src/app/(auth)/login/page.tsx` — remover a função inline (63-70); adicionar `import { entrarComGoogle } from "@/lib/auth/googleOAuth";`. Manter `onClick={entrarComGoogle}`. O `import { createClient }` (linha 15) fica órfão — removê-lo (lint `no-unused-vars`).
- `src/app/(auth)/cadastro/page.tsx` — remover a função inline (79-86); adicionar o mesmo import. Manter `onClick`. Remover o `import { createClient }` órfão (linha 21).

NÃO tocar:
- `src/app/auth/callback/route.ts` (fora de escopo — issue 003).
- `components/ui/` (shadcn).
- `src/lib/supabase/client.ts`.

### Dependências Externas
Nenhuma nova. `@supabase/ssr` e `sonner` já no `package.json`.

### Ordem de Implementação
Não crítica — sem TDD red-first obrigatório. O critério de aceite é estático (`grep` + build/lint), não comportamental novo.
1. Criar `src/lib/auth/googleOAuth.ts`.
2. Editar `login/page.tsx`: importar, remover função inline e `createClient` órfão.
3. Editar `cadastro/page.tsx`: idem.
4. Verificar: `grep -rn "signInWithOAuth" src` retorna só o helper; `npm run build` e lint passam.
