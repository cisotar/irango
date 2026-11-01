# 366 — Recuperação de senha do lojista (self-service)

crítica: SIM (auth, sessão, token, anti-enumeração) · Spec: specs/recuperacao-senha-self-service.md

## Origem
Spec v0.2.0, commit `a5e9d9d` (branch feat/366-recuperacao-senha-lojista).

## Plano
plan/loop-recuperacao-senha-lojista.md

## Risco por fatia
| fatia | superfície | prova |
|---|---|---|
| F1 extração (`origemDaRequisicao`, piso de latência, `temSessaoDeRecuperacao`, base do schema de nova senha) | anti-enumeração (piso), host do `redirectTo`, checagem `amr` da porta cliente | suíte do cliente verde e sem diff nos arquivos de teste; 1 definição de cada peça em `src` |
| F2a `solicitarRedefinicaoSenha` | PII (e-mail), enumeração por resposta/tempo, rate limit, redirect por header | resposta idêntica em GoTrue ok/erro/throw; não resolve antes de 1500 ms; `redirectTo` exato; e-mail ausente de `console.error`; chave `recuperacaoLojista` barra antes do GoTrue; payload com `next` recusado |
| F2b `confirmarNovaSenha` | autorização (`amr`), sessão (logout global), secret (senha), input | sem sessão / amr `password` / amr `oauth` / erro de claims → sem `updateUser` e sem `signOut`; `updateUser` antes de `signOut({scope:'global'})`; destino `/login?redefinida=1`; `.strict()`; senha ausente de log; chave `novaSenhaLojista` |
| F3 ramo do callback | token/sessão, papel (RN-09), open redirect (RN-07) | amr recovery → `/nova-senha` fixo, sem `atribuirPapelInicial`; `next` adulterado ignorado; `amr` na URL ignorado; fail-closed se `getClaims` falha; erros → `/recuperar-senha?erro=link`; porta cliente inalterada |
| F4 telas e login | PII na URL, UI não é autoridade | sem `email=` nas páginas; `autoComplete` correto; smoke HTTP |
| configuração Supabase | host forjado, entrega do link | Redirect Allow List e SMTP próprio conferidos pelo usuário, listados no PR |
