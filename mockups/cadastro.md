# /cadastro — Criar conta (lojista)

**Rota:** `/cadastro` · **Issue:** 035 · **Mundo:** Painel (tokens iRango)
**Stack:** react-hook-form + zod; toast sonner "Loja criada! Configure seu perfil." no sucesso (design-system §6).

---

## Mobile (centralizado, max-w-sm)

```
┌────────────────────────────────────────────┐
│                 🥖 iRango                    │
│                                              │
│           Crie sua loja grátis               │  ← h1
│      Comece a receber pedidos hoje.          │  ← subtítulo
│                                              │
│  E-mail                                      │
│  ┌──────────────────────────────────────┐  │
│  │ ciso@paodociso.com.br                 │  │
│  └──────────────────────────────────────┘  │
│                                              │
│  Senha                                       │
│  ┌──────────────────────────────────┬───┐  │
│  │ ••••••••••                        │ 👁 │  │
│  └──────────────────────────────────┴───┘  │
│  Mínimo 8 caracteres.                        │  ← FormDescription (text-xs)
│                                              │
│  ┌─┐                                         │
│  │☑│ Li e aceito os Termos de Uso e a        │  ← Checkbox + label clicável
│  └─┘ Política de Privacidade.                │     (links abrem em nova aba)
│                                              │
│  ┌──────────────────────────────────────┐  │
│  │        Criar conta grátis             │  │  ← Button primário (disabled até aceite)
│  └──────────────────────────────────────┘  │
│                                              │
│  ──────────────  ou  ──────────────         │
│                                              │
│  ┌──────────────────────────────────────┐  │
│  │   [G]  Entrar com Google              │  │  ← Button outline
│  └──────────────────────────────────────┘  │
│                                              │
│  Já tem conta? Entrar                        │  ← link para /login
└────────────────────────────────────────────┘
```

## Erro de validação (e-mail já usado)

```
│  E-mail                                      │
│  ┌──────────────────────────────────────┐  │
│  │ ciso@paodociso.com.br                 │  │  ← aria-invalid
│  └──────────────────────────────────────┘  │
│  ⚠ Este e-mail já tem conta. Entrar?         │  ← FormMessage + link
```

## Aceite não marcado (tentativa de submit)

```
│  ┌─┐                                         │
│  │☐│ Li e aceito os Termos...               │  ← Checkbox aria-invalid
│  └─┘                                         │
│  ⚠ É preciso aceitar os Termos para criar    │  ← FormMessage
│    a conta.                                   │
```

---

## Anatomia / primitives

| Parte | Primitive | Token / classe |
|-------|-----------|----------------|
| Card central | `Card` | `max-w-sm mx-auto` |
| Campos | `Form` + `Input` | — |
| Dica de senha | `FormDescription` | `text-xs text-muted-foreground` |
| Aceite | `Checkbox` (shadcn) + `<label>` | label inteira clicável |
| Criar conta | `Button` | primário, `min-h-11` |
| Google | `Button variant=outline` | — |

## Notas UX / Acessibilidade
- Botão "Criar conta grátis" **desabilitado** até o checkbox de aceite estar marcado — e validado também no servidor (não confiar no client).
- Label do aceite é **clicável inteira** e contém os links (Termos / Privacidade) abrindo em nova aba.
- Aceite com `aria-invalid` + mensagem quando submetido sem marcar.
- Dica de senha sempre visível (não só no erro) — reduz frustração.
- `autoComplete="email"` / `"new-password"`.
- Sucesso: redireciona ao painel + toast "Loja criada! Configure seu perfil." (design-system §6).
