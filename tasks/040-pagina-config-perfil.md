# [040] Página de perfil da loja `/painel/configuracoes/perfil`

**crítica:** NÃO
**Mundo:** painel
**Depende de:** 019, 023, 030
**Spec:** specs/spec_irango_mvp.md (Perfil, RN-07)

## Objetivo
Form de perfil: nome, slug (com sanitização UX), telefone, WhatsApp, endereço (ViaCEP) e preview do link público.

## Escopo
- [ ] Criar `src/app/(painel)/painel/configuracoes/perfil/page.tsx`
- [ ] FormPerfil (react-hook-form + `schemaPerfil` 019); máscaras react-imask (telefone/WhatsApp)
- [ ] FormEndereco com ViaCEP
- [ ] PreviewLink `irango.com.br/loja/[slug]` + copiar
- [ ] Carregar dados via `buscarLojaDoDono` (023); salvar via `salvarPerfil` (030)
- [ ] Exibir erro "Este endereço já está em uso" no conflito de slug

## Fora de escopo
Validação/unicidade no servidor (030/019).

## Reuso esperado
- `schemaPerfil`/`sanitizarSlug` (019), `salvarPerfil` (030), `buscarLojaDoDono` (023), react-imask, ViaCEP, sonner

## Segurança
- Sanitização de slug no client é só UX; servidor valida e checa unicidade (RN-07)

## Critério de aceite
- [ ] Salvar atualiza a loja; slug duplicado mostra erro; WhatsApp salvo como `55...`; link público copiável
