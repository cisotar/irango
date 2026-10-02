# [339] Telas do mundo cliente: `/conta/*` e `/minha-conta/*` com guard

**crítica:** NÃO
**vetor:** —
**Mundo:** auth (route group `src/app/(cliente)/`)
**Depende de:** 336, 337, 338
**Spec:** specs/cliente-identidade.md
**Branch:** feat/clientes-identidade
**Plano:** P16/P17 (telas) → P20 (checklist de clique)

## Objetivo
Montar as telas neutras do iRango que consomem as actions de 336/337, com guard fail-closed em
`/minha-conta/layout.tsx` e o modal de persuasão da decisão 13.

## Behaviors do spec que esta issue fecha
- Entrar: Google primeiro; "Voltar para <loja>" com carrinho intacto; links preservando `next`.
- Cadastro: "Ver Continuar com Google como primeira opção"; validação instantânea; "Submeter abre o modal com a copy
  literal"; "Continuar com Google" no modal; "Prosseguir com e-mail" conclui; estado "Confirme seu e-mail".
- Completar: "Abandonar o passo complementar … `/minha-conta` sempre traz de volta" (guard); linha "Seu acesso ao
  painel continua o mesmo." para lojista/admin.
- Recuperar: etapa 2 só com sessão de recuperação; estado de erro com "Pedir novo link".
- Minha conta / Endereços: UI de perfil, sair, exclusão com `AlertDialog`, lista ≤3 com chips de rótulo, `Badge`
  "Padrão", "Adicionar" some em 3; "Rótulo… renderizados por JSX, nunca `dangerouslySetInnerHTML`".

## Escopo
- [ ] `src/app/(cliente)/layout.tsx` neutro (padrão de `(auth)/layout.tsx`).
- [ ] `src/app/(cliente)/minha-conta/layout.tsx` guard na ordem do spec (sem sessão → entrar; e-mail não confirmado →
  `signOut`; sem papel/perfil → `/conta/completar`; erro → `/conta/entrar?erro=sessao`); papéis da tabela.
- [ ] Páginas `/conta/entrar`, `/conta/cadastro`, `/conta/completar`, `/conta/recuperar`, `/minha-conta`,
  `/minha-conta/enderecos`; com sessão em `/conta/entrar|cadastro` → redirect.
- [ ] Componentes `FormEntrarCliente`, `FormCadastroCliente`, `FormPerfilCliente`, `FormRecuperarCliente`,
  `FormNovaSenhaCliente`, `LinkVoltarLoja`.

## Fora de escopo
- "Entrar" na vitrine (Marco C). Qualquer mudança no checkout ou em `FormEndereco` que altere seu contrato.

## Reuso esperado
- `BotaoGoogle` + `entrarComGoogle({contexto, next})` (336); `AlertDialog`, `Card`, `Input`, `Checkbox`, `Badge`,
  `Button` (shadcn — não editar `components/ui/`); `FormEndereco` + `buscarCep.ts` (rótulo em `Input` irmão se
  preciso); `react-imask`; `LoginForm.tsx`/`CadastroForm.tsx` como padrão; query pública de loja por slug;
  `sanitizarNext` (336). Consultar `references/design-system.md` e o mockup de P10.

## Segurança
- Guard é a barreira de navegação; dados vêm de RLS (335) e actions (337). Nada de valor no cliente.
- Copy do modal literal (decisão 13); mensagens de erro genéricas.

## Critério de aceite
- [ ] `grep -rn dangerouslySetInnerHTML 'src/app/(cliente)'` vazio (gate B4).
- [ ] Checklist de clique (P20, sem jsdom): Google acima do form; modal só no cadastro por e-mail, com a copy literal;
  Esc fecha sem enviar; data de 17 anos recusada em `/conta/completar`; 4º endereço indisponível; guard leva conta sem
  perfil a `/conta/completar`; lojista ativa perfil e continua entrando em `/painel`.
- [ ] `tsc`, lint, suíte e build verdes.

## Dúvidas
- Pré-requisito humano: Redirect URL `/auth/callback?contexto=cliente&next=…` na allowlist do Supabase em produção
  antes de ir ao ar (ADR risco 2).
