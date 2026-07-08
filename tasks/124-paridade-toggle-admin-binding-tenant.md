# [124] Paridade admin: toggle na configuração da loja-alvo (binding por tenant)

**crítica:** SIM (TDD red-first)
**Mundo:** painel (admin SaaS)
**Depende de:** [122]
**Spec:** specs/5-whatsapp-envio-automatico-toggle.md

## Objetivo
Espelhar o mesmo Switch em `/admin/assinantes/[lojaId]/configuracoes`, gravando a flag na
LOJA-ALVO (`lojaId` da rota), reusando `salvarPerfilAdmin` + `escopo.atualizarLoja`.

## Escopo
- [ ] `ConfiguracaoAdminClient.tsx`: adicionar o mesmo bloco `Switch` + `Label` do painel
  do lojista (paridade visual — `specs/paridade-hub-admin-painel.md`), com valor lido da loja-alvo.
- [ ] Confirmar que `salvarPerfilAdmin` já flui a flag via `CHAVES_PERFIL` (122) +
  `montarPatchPerfil` + `escopo.atualizarLoja` — sem escrita nova fora do wrapper.
- [ ] `next build` antes de fechar.

## Fora de escopo
- Toggle do lojista (123).
- Checkout / disparo (125/126).
- Migração blocklist→allowlist da task 115 (dependência leve, não bloqueante).

## Reuso esperado
- `salvarPerfilAdmin` + `prepararContextoAdmin` + `escopo.atualizarLoja` — reuso.
- `montarPatchPerfil` / `CHAVES_PERFIL` (122).
- Padrão de teste `src/lib/actions/admin-loja.binding.test.ts` — reusar, não recriar.

## Segurança
- Superfície REAL: escrita cross-tenant em `lojas`. O `lojaId` vem da rota validada
  (`validarLojaIdAdmin`), NUNCA do payload; `escopo.atualizarLoja` injeta `.eq("id", lojaId)`
  por construção (PRs #99/#100/#101; incidente 2026-07-03).
- `whatsapp_envio_automatico` fica FORA de `CAMPOS_LOJA_SOMENTE_SERVIDOR` (permitida por design).

## Critério de aceite
- [ ] (RED-first) Teste de binding: `salvarPerfilAdmin(lojaId, { whatsapp_envio_automatico })`
  grava a flag na loja-alvo e o UPDATE é escopado por `.eq("id", lojaId)` — nunca em outra loja.
- [ ] (RED-first) Teste: um `lojaId` no payload/hostil não redireciona a escrita para outra loja.
- [ ] Vermelho escrito e confirmado ANTES do código; depois verde.
- [ ] Admin liga/desliga o toggle da loja-alvo; a flag da loja do próprio admin permanece intacta.
- [ ] `next build` passa.
