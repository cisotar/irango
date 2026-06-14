# FormEndereco — CEP com máscara e busca

**Componente:** `components/vitrine/FormEndereco.tsx` (usado no checkout)
**Mundo:** Vitrine · **Issue:** 029
**Stack:** react-hook-form + zod (schema em `lib/validacoes/`), react-imask (máscara CEP). Botão "Buscar" usa `--cor-primaria` (ou outline neutro).

---

## Estado inicial

```
┌────────────────────────────────────────────┐
│ Endereço de entrega                          │
│                                              │
│ CEP                                          │  ← <label> vinculado
│ ┌──────────────────────┐ ┌──────────────┐  │
│ │ 01310-100            │ │  🔍 Buscar    │  │  ← Input(react-imask) + Button
│ └──────────────────────┘ └──────────────┘  │
│                                              │
│ Rua                                          │
│ ┌──────────────────────────────────────┐   │
│ │                                       │   │  ← vazio até buscar
│ └──────────────────────────────────────┘   │
│ Bairro                  Cidade               │
│ ┌──────────────────┐ ┌──────────────────┐  │
│ │                  │ │                  │  │
│ └──────────────────┘ └──────────────────┘  │
│ Número                  Complemento          │
│ ┌──────────────────┐ ┌──────────────────┐  │
│ │                  │ │ (opcional)       │  │
│ └──────────────────┘ └──────────────────┘  │
└────────────────────────────────────────────┘
```

## Buscando (loading)

```
│ ┌──────────────────────┐ ┌──────────────┐  │
│ │ 01310-100            │ │ ◌ Buscando…  │  │  ← Button disabled + spinner
│ └──────────────────────┘ └──────────────┘  │
```

## Preenchido (auto após busca)

```
│ Rua                                          │
│ ┌──────────────────────────────────────┐   │
│ │ Av. Paulista                          │   │  ← auto-preenchido (editável)
│ └──────────────────────────────────────┘   │
│ Bairro                  Cidade               │
│ ┌──────────────────┐ ┌──────────────────┐  │
│ │ Bela Vista       │ │ São Paulo        │  │  ← auto-preenchido
│ └──────────────────┘ └──────────────────┘  │
│ Número                  Complemento          │
│ ┌──────────────────┐ ┌──────────────────┐  │
│ │ 1578             │ │ apto 42          │  │  ← foco vai pro Número após busca
│ └──────────────────┘ └──────────────────┘  │
```

## Erro de CEP

```
│ ┌──────────────────────┐ ┌──────────────┐  │
│ │ 00000-000            │ │  🔍 Buscar    │  │  ← Input aria-invalid (borda destructive)
│ └──────────────────────┘ └──────────────┘  │
│ ⚠ CEP não encontrado. Confira e tente de    │  ← text-destructive
│   novo, ou preencha manualmente.  [Tentar]   │
```

---

## Anatomia / primitives

| Parte | Primitive | Token / classe |
|-------|-----------|----------------|
| Form | `Form` (shadcn + react-hook-form) | label vinculado automaticamente |
| CEP | `Input` + react-imask `00000-000` | `inputMode="numeric"` |
| Buscar | `Button` | `min-h-11` |
| Campos auto | `Input` | editáveis após preenchimento |
| Erro | `FormMessage` | `aria-describedby` + `aria-invalid` |

## Notas UX / Acessibilidade
- Máscara CEP é só apresentação; valor validado pelo mesmo schema zod no client e no servidor.
- Após busca bem-sucedida, **foco move para "Número"** (próximo dado que só o usuário tem) — economiza toques.
- Campos auto-preenchidos permanecem **editáveis** (CEP genérico pode não ter rua).
- Todo input com `<label>` visível (não placeholder como label) — design-system §5.
- Erro de busca tem **retry** e fallback "preencher manualmente" — não trava o checkout.
- `inputMode="numeric"` no CEP/Número abre teclado numérico no mobile.
