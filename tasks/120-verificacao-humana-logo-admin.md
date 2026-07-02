# 120 — Verificação humana: logo no admin (pós-fix cross-tenant)

**Origem:** débito de verificação do fix `specs/arquivo/fix-logo-admin-cross-tenant.md` (issues 116–119, branch `fix/logo-admin-cross-tenant`).
**crítica:** NÃO (só verificação observável — o comportamento já está garantido por Server Action + 17 testes automatizados novos e auditoria sem findings MÉDIA+).

## Contexto

O agente `verificar` confirmou tudo que era observável sem sessão (guards fail-closed,
build, suíte completa 1906 verdes, estado do banco intacto), mas **não pôde logar na
UI**: a conta do admin SaaS só tem identity Google (OAuth), sem senha, e não há
credencial de lojista recuperável no cloud. Optou-se por não impersonar conta real.

## Critérios (executar manualmente, logado como admin SaaS)

- [ ] Em `/admin/assinantes/5ec21485-e58a-4071-a41c-f8963076ae00/configuracao`, recortar
      e salvar uma logo → toast de sucesso, logo aparece, `lojas.logo_url` da loja-alvo
      aponta para `5ec21485-…/logo/<uuid>.webp`.
- [ ] Remover a logo → `logo_url` zera na loja-alvo.
- [ ] Cross-tenant: `logo_url` da loja do próprio admin (`paodociso`) permanece intacta
      antes/depois das duas operações.
- [ ] (Se houver credencial de lojista) `/painel/configuracoes/perfil` segue salvando a
      própria logo com os defaults.
