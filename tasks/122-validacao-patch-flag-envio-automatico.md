# [122] Base: validação + allowlist da flag (`schemaPerfil` + `montarPatchPerfil`)

**crítica:** NÃO
**Mundo:** painel
**Depende de:** [121]
**Spec:** specs/5-whatsapp-envio-automatico-toggle.md

## Objetivo
Estender a camada isomórfica de perfil (schema Zod + tipo + builder de patch) para
aceitar `whatsapp_envio_automatico`, num único lugar reusado pelas DUAS vias de escrita
(lojista e admin). Evita duplicar validação/allowlist (mandato "não reinventar a roda").

## Escopo
- [ ] `schemaPerfil` (`src/lib/validacoes/loja.ts`): adicionar `whatsapp_envio_automatico:
  z.boolean().optional()`. Manter `.strict()` (2ª barreira).
- [ ] `DadosPerfil` (`src/lib/actions/patches-loja.ts`): adicionar `whatsapp_envio_automatico?: boolean`.
- [ ] `montarPatchPerfil`: gravar a coluna coluna-a-coluna só quando `!== undefined`
  (mesmo padrão de `telefone`/`whatsapp`) — nunca via spread.
- [ ] `CHAVES_PERFIL` (`src/app/admin/assinantes/actions/admin-perfil.ts`): adicionar
  `"whatsapp_envio_automatico"` ao allowlist-pick ANTES do parse (para a via admin).
- [ ] Atualizar/estender os testes unitários existentes: `validacoes/loja.test.ts`,
  `patches-loja.test.ts` (flag entra no patch quando presente; ausente não polui o patch;
  chave hostil fora da allowlist continua descartada).

## Fora de escopo
- UI do toggle (issue 123).
- Wiring da action admin com binding por tenant (issue 124).
- Retorno de `criarPedido` (issue 125).

## Reuso esperado
- `schemaPerfil` / `DadosPerfil` / `montarPatchPerfil` / `CHAVES_PERFIL` — estender, NÃO recriar.

## Segurança
- A flag é preferência operacional: entra na allowlist de `montarPatchPerfil` (só grava se
  validada) e fica FORA de `CAMPOS_LOJA_SOMENTE_SERVIDOR`.
- Invariante preservada: colunas autoritativas (`dono_id`, `ativo`, `assinatura_*`,
  `hotmart_*`, `consentimento_*`, `id`, `latitude`, `longitude`) continuam JAMAIS no patch.

## Critério de aceite
- [ ] `schemaPerfil.safeParse({ ...validos, whatsapp_envio_automatico: true })` passa;
  com valor não-booleano falha.
- [ ] `montarPatchPerfil` inclui a chave só quando presente no input.
- [ ] Payload hostil com coluna autoritativa continua descartado (teste existente verde).
- [ ] Suítes `validacoes/loja.test.ts` e `patches-loja.test.ts` verdes.
