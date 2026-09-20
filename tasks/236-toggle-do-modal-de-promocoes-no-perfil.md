# [236] Toggle "Mostrar promoções ao abrir a loja" em `/painel/configuracoes/perfil`

**crítica:** NÃO
**Mundo:** painel
**Depende de:** [231] (`tasks/231-allowlist-de-modal-promocoes-em-montarpatchperfil.md`)
**Spec:** specs/desconto-por-produto-e-pratos-promocionais.md
**Decisões:** D6 · RN-16 · design §5.6

## Objetivo

Dar ao lojista o controle do modal de promoções da própria loja, na tela onde ele já encontra a
preferência irmã (`whatsapp_envio_automatico`), com a frase de ajuda que evita o chamado
"liguei e não aparece nada".

## Escopo

- [ ] `Switch` "Mostrar promoções ao abrir a loja" em
      `src/app/(painel)/painel/(bloqueavel)/configuracoes/perfil/PerfilClient.tsx`, na mesma
      família visual de `whatsapp_envio_automatico`;
- [ ] texto de ajuda **com as duas frases**, ligado por `aria-describedby`: *"Na primeira visita do
      dia, o cliente vê um aviso com os pratos em promoção. **Se não houver promoção ativa, nada
      aparece.**"* — a segunda frase é obrigatória;
- [ ] a página lê o valor atual da loja e o `PerfilClient` o envia por `montarPayloadPerfil`;
- [ ] espelhar o campo no `PerfilAdminClient`
      (`src/app/admin/assinantes/[lojaId]/configuracoes/perfil/`), que compartilha a mesma
      allowlist — o admin edita em nome do lojista e não pode ser um caminho mais frouxo.

## Fora de escopo

A allowlist e as Server Actions (issue 231). A migration e a view (issue 220). O `ModalPromocoes`
em si (issue 234). Nenhuma leitura de `lojas` pela vitrine: ela continua lendo **só**
`vitrine_lojas` (`seguranca.md` §19).

## Reuso esperado

- `src/components/ui/switch.tsx` — shadcn.
- O bloco de `whatsapp_envio_automatico` no mesmo arquivo — layout, espaçamento e `aria` já prontos.
- `montarPayloadPerfil.ts` (issue 231) — o campo já viaja por lá.

## Segurança

- Escrita coberta por `lojas_update_proprio` (lojista) e por `verificarAdminSaaS()` + escopo por
  `loja_id` (admin, onde `service_role` bypassa RLS).
- `modal_promocoes` é preferência de UI: não é PII, não é billing, e expô-la na view pública não
  revela nada sobre dono, plano ou cliente.

## Critério de aceite

- [ ] desligar e salvar grava `false` (não é engolido por truthiness) e a vitrine para de montar o
      modal; ligar de novo volta a montar;
- [ ] loja nova nasce com o toggle **ligado** (`DEFAULT true`, D6);
- [ ] a frase "Se não houver promoção ativa, nada aparece." está na tela;
- [ ] `npx tsc --noEmit` → `npm run lint` → `npm test` → `npm run build`.
