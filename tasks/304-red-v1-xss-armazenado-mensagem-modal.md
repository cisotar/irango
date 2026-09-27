# [304] RED V1: XSS armazenado e injeção de marcação na mensagem do modal

**crítica:** SIM (TDD red-first)
**Mundo:** vitrine pública
**Depende de:** —
**Spec:** specs/modal-sazonal-mensagem-formatada.md (§Segurança, matriz V1; RN-M03, RN-M04, RN-M05)

## Objetivo
Suíte vermelha que prova, de ponta a ponta, que texto ou chave hostil na mensagem nunca vira marcação: zod de escrita, `lerMensagemModal` na leitura e renderizador.

## Escopo
- [ ] Criar `tests/seguranca/modal-sazonal/v1-xss.test.tsx` (pasta nova).
- [ ] **A1**, camadas:
  - zod escrita: corpus `"<img src=x onerror=alert(1)>"`, `"<script>alert(1)</script>"`, `"javascript:alert(1)"` como `texto` de trecho é aceito como TEXTO (não reprova, é dado), e sai idêntico;
  - renderer: `renderToStaticMarkup(<MensagemFormatada mensagem={...} />)` sem `<img`, `<script`, ` on[a-z]+=`, `href`, `style=`; texto escapado (`&lt;`);
  - leitura: o mesmo corpus passado como JSON cru (simulando linha do banco) por `lerMensagemModal` e renderizado continua inerte.
- [ ] **A2**, camadas:
  - zod escrita: chave extra em documento, parágrafo e trecho (`href`, `style`, `class`, `target`, `rel`, `dangerouslySetInnerHTML`, `__proto__`, `constructor`) reprova, cada uma num caso (`it.each`);
  - `__proto__`/`constructor` injetados via `JSON.parse` (não literal de objeto);
  - leitura: `lerMensagemModal` devolve `null` para cada JSON acima e chama `console.error("[modalSazonal] mensagem inválida", { lojaId, modalId })` sem conteúdo (spy afirma que o 2º argumento só tem essas chaves).
- [ ] Rodar e capturar o `FAIL` (módulos `@/lib/validacoes/mensagemModal` e `@/components/shared/MensagemFormatada` ainda não existem).

## Fora de escopo
Código de produção (313). URL/link (305). Enums/CSS (306).

## Reuso esperado
- Padrão `renderToStaticMarkup` de `src/app/admin/assinantes/[lojaId]/configuracoes/ModulosImpressaoAdmin.test.tsx`.
- Assinaturas do spec §Formato da mensagem e RN-M04 (`lerMensagemModal(raw, ctx)`: o `planejar` não roda; o `tdd` fixa a assinatura com `{ lojaId, modalId }` como 2º argumento e a 313 obedece).

## Segurança
Superfície clássica de XSS armazenado para visitante anônimo. Sem banco nesta suíte.

## Critério de aceite
- [ ] Suíte existe, cobre A1 e A2 em todas as camadas listadas, e o output `FAIL` foi capturado antes de qualquer código de produção.
- [ ] Nenhum arquivo em `src/` criado ou alterado.
