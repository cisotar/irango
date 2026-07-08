# [123] Toggle no painel do lojista (aba Perfil)

**crítica:** NÃO
**Mundo:** painel
**Depende de:** [122]
**Spec:** specs/5-whatsapp-envio-automatico-toggle.md

## Objetivo
Dar ao lojista o controle Switch "Enviar a mensagem de WhatsApp automaticamente ao
confirmar o pedido" em `/painel/configuracoes/perfil`, gravado por `salvarPerfil`.

## Escopo
- [ ] `PerfilClient.tsx`: adicionar campo booleano `whatsapp_envio_automatico` ao
  `react-hook-form` já existente, com `defaultValue` lido do SSR
  (`buscarLojaDoDono` → `.select("*")` já traz a coluna após 121).
- [ ] Renderizar `Switch` (shadcn/ui) + `Label` logo abaixo do campo de WhatsApp.
- [ ] Desabilitar o Switch quando `whatsapp` está vazio, com dica "Cadastre um WhatsApp
  para ativar o envio automático" (RN-A3 / behavior UX).
- [ ] `salvarPerfil` (`src/lib/actions/loja.ts`): confirmar que o valor flui do
  `schemaPerfil` (122) para `montarPatchPerfil` sem mudança adicional além de repassar o campo.
- [ ] Rodar `next build` antes de fechar (constraint `use-server-export-constraint`).

## Fora de escopo
- Paridade admin (issue 124).
- Qualquer mecânica de disparo no checkout (issues 125/126).

## Reuso esperado
- `Switch` + `Label` do shadcn/ui — não criar toggle novo.
- Server Action `salvarPerfil` + `schemaPerfil`/`montarPatchPerfil` (122) — reuso.

## Segurança
- Escrita escopada por RLS `lojas_update_proprio` (`auth.uid() = dono_id`): não é
  cross-tenant. O valor do cliente é só UX; o servidor regrava a partir do payload validado.
- Sem valor monetário.

## Critério de aceite
- [ ] Ao carregar a aba, o Switch reflete `lojas.whatsapp_envio_automatico` (default LIGADO).
- [ ] Ligar/desligar e salvar persiste a coluna na loja do dono; recarregar mantém o estado.
- [ ] Sem WhatsApp cadastrado, o Switch aparece desabilitado com a dica.
- [ ] `next build` passa.
