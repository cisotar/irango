# /login — Entrar (lojista)

**Rota:** `/login` · **Issue:** 034 · **Mundo:** Painel (área autenticada — sem tema de loja, usa tokens iRango)
**Stack:** react-hook-form + zod, sonner para erro de credencial. Botão primário usa token iRango (não `--cor-primaria` de loja — login não é vitrine).

---

## Mobile (centralizado, max-w-sm)

```
┌────────────────────────────────────────────┐
│                                              │
│                 🥖 iRango                    │  ← logo do produto
│                                              │
│            Entrar na sua conta               │  ← h1
│                                              │
│  E-mail                                      │
│  ┌──────────────────────────────────────┐  │
│  │ ciso@paodociso.com.br                 │  │  ← Input type=email
│  └──────────────────────────────────────┘  │
│                                              │
│  Senha                                       │
│  ┌──────────────────────────────────┬───┐  │
│  │ ••••••••••                        │ 👁 │  │  ← Input type=password + toggle
│  └──────────────────────────────────┴───┘  │
│                          Esqueci minha senha │  ← link (text-sm)
│                                              │
│  ┌──────────────────────────────────────┐  │
│  │              Entrar                   │  │  ← Button primário, ≥44px
│  └──────────────────────────────────────┘  │
│                                              │
│  ──────────────  ou  ──────────────         │  ← Separator
│                                              │
│  ┌──────────────────────────────────────┐  │
│  │   [G]  Entrar com Google              │  │  ← Button outline
│  └──────────────────────────────────────┘  │
│                                              │
│  Não tem conta? Cadastre-se                  │  ← link para /cadastro
│                                              │
└────────────────────────────────────────────┘
```

## Erro de credencial

```
│  ┌──────────────────────────────────────┐  │
│  │ ⚠ E-mail ou senha incorretos.         │  │  ← Alert(destructive), não revela qual
│  └──────────────────────────────────────┘  │
```
(além do Alert, toast sonner de erro)

## Loading no submit

```
│  ┌──────────────────────────────────────┐  │
│  │            ◌ Entrando…                │  │  ← Button disabled + spinner
│  └──────────────────────────────────────┘  │
```

---

## Anatomia / primitives

| Parte | Primitive | Token / classe |
|-------|-----------|----------------|
| Card central | `Card` | `max-w-sm mx-auto` |
| Campos | `Form` + `Input` | label vinculado |
| Toggle senha | `Button` ghost + `Eye/EyeOff` | `aria-label="Mostrar senha"` |
| Entrar | `Button` | primário, `min-h-11` |
| Separador | `Separator` | "ou" |
| Google | `Button variant=outline` | ícone G |
| Erro | `Alert variant=destructive` | + toast |

## Notas UX / Acessibilidade
- Mensagem de erro **genérica** ("e-mail ou senha incorretos") — não revela se o e-mail existe (segurança).
- `<label>` visível em ambos os campos; toggle de senha com `aria-label` e `aria-pressed`.
- `autoComplete="email"` e `autoComplete="current-password"`.
- Ordem de foco lógica; Enter submete o form.
- Botão primário usa token iRango — esta é área de produto, não vitrine de loja.
