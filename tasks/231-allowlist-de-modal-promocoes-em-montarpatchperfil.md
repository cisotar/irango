# [231] `modal_promocoes` na allowlist de `montarPatchPerfil` (lojista **e** admin)

**crítica:** SIM (TDD red-first)
**Mundo:** painel
**Depende de:** [220] (`tasks/220-migration-modal-promocoes-em-lojas-e-recriacao-de-vitrine-lojas.md`)
**Spec:** specs/desconto-por-produto-e-pratos-promocionais.md
**Decisões:** D6 · RN-16
**Fatia crítica:** 7 (`vitrine_lojas` recriada + allowlist de `modal_promocoes`) — a metade de Server Action

## Objetivo

Fazer a preferência `modal_promocoes` ser gravável pelos dois mundos que editam perfil de loja,
por **uma** allowlist compartilhada, com o cuidado que `patches-loja.ts` já documenta: `!== undefined`,
nunca truthiness — porque `false` precisa ser gravado e ausente precisa preservar.

## Escopo

- [ ] `montarPatchPerfil` (`src/lib/actions/patches-loja.ts`) ganha **uma entrada na allowlist
      explícita** para `modal_promocoes`, com o teste de `!== undefined`;
- [ ] `DadosPerfil` ganha o campo booleano opcional correspondente;
- [ ] `montarPayloadPerfil.ts`
      (`src/app/(painel)/painel/(bloqueavel)/configuracoes/perfil/montarPayloadPerfil.ts`) passa o
      campo adiante;
- [ ] conferir que o caminho admin (`admin-perfil` / `escopo.atualizarLoja`) usa **a mesma**
      `montarPatchPerfil` — a allowlist vale nos dois mundos de uma vez, sem segunda lista.

## Fora de escopo

O `Switch` na tela de perfil (issue 236) e o `ModalPromocoes` (issue 234). A migration e a view
(issue 220, já entregue). `modal_promocoes` **não** entra em `CAMPOS_LOJA_SOMENTE_SERVIDOR` nem na
lista de 14 colunas de `lojas_protege_billing()`: é preferência operacional, não billing e não PII.
Nenhum spread do payload — allowlist, sempre.

## Reuso esperado

- `src/lib/actions/patches-loja.ts` — a allowlist e o padrão `!== undefined` já existem; só entra
  mais uma linha.
- `whatsapp_envio_automatico` — a preferência booleana da mesma família, precedente literal.
- `src/lib/actions/patches-loja.test.ts` — a suíte que já cobre a allowlist.

## Segurança

- **Permissão:** a escrita alcança só a linha cujo `dono_id = auth.uid()` (`lojas_update_proprio`);
  no admin o isolamento é `verificarAdminSaaS()` + `validarLojaIdAdmin` + escopo por `loja_id`,
  porque `service_role` bypassa RLS.
- **Allowlist é a defesa contra escalonamento de coluna:** um spread do payload deixaria o lojista
  escrever qualquer coluna de `lojas`, inclusive as de billing. A forma importa mais que o campo.

## Critério de aceite

- [ ] teste vermelho escrito e depois verde: `modal_promocoes: false` **é gravado** (não é engolido
      por truthiness); ausente **preserva** o valor atual; uma coluna fora da allowlist enviada no
      payload **não** aparece no patch;
- [ ] o mesmo teste vale para o caminho admin, sem segunda allowlist;
- [ ] `npx tsc --noEmit` → `npm run lint` → `npm test` → `npm run build`.
