# [163] zod inteiro no bundle público do checkout (42% do JS da rota)

**crítica:** NÃO (é performance — mas mexe em validação, exige cuidado)
**Mundo:** vitrine pública
**Depende de:** —
**Origem:** finding CUSTO da auditoria de performance da issue 126.
Registro: `performance/2026-09-06-checkout-abertura-whatsapp.md`
**Pré-existente** — NÃO é regressão da 126.

## Problema

Primeira medição real do bundle da rota do checkout público:
**63,8 KB gzip de 151 KB (42% do JS) é o zod**, importado pelo cliente via
`src/lib/validacoes/pedido.ts:10`.

O veredito dessa validação no cliente é apenas **preview de UX** — `criarPedido`
revalida tudo no servidor de qualquer forma (é o princípio de não confiar no
cliente). O painel do lojista paga esse custo atrás de login, onde conversão não
está em jogo; aqui quem paga é o comprador no celular, no caminho da compra.

## Diagnóstico detalhado

O chunk sozinho tem 283.469 B raw / 63.797 B gzip e é praticamente zod 4.4.3
puro. O build clássico do zod v4 NÃO é tree-shakable: o minificado carrega
`cidr` x119, `nanoid`/`cuid2`/`base64url` x108, `emoji` x90 e `toJSONSchema` —
nada disso é usado aqui.

`useEnviarPedido.ts` e o UNICO importador client de zod na vitrine. Todos os
outros importadores sao painel/auth, atras de login.

## Escopo (em ordem de preferencia)

**Resolvida pela variante B'' — B com pre-carga fora do React.** Justificativa da
escolha em `plan/loop-163-zod-fora-do-bundle-do-checkout.md` §2.

- [x] ~~**Opcao A (`zod/mini`)**~~ — REJEITADA. Reescreveria o gate autoritativo do
      servidor (`.transform().pipe()`, `.trim().toUpperCase()`, `.strict()`,
      `.refine()`), exigindo TDD red-first + auditoria, para economia MENOR que B''
      (mini ainda entrega chunk no bundle inicial; B'' entrega zero).
- [x] **Opcao B, na variante B''** — schema em escopo de modulo, carregado por
      `import()` unico agendado em idle FORA de componente/hook.
      `src/components/vitrine/checkout/useEnviarPedido.ts:44-65`.
      B literal (o `import()` dentro do `enviar()`) foi rejeitada: poria um `await`
      antes de `prepararAbaWhatsapp`, invalidando a user activation e matando o
      popup do WhatsApp (RN-A5 da issue 126). `enviar()` permanece SINCRONO.
- [x] ~~**Opcao C**~~ — REJEITADA: fere o criterio de aceite 3 e duplicaria no
      cliente regras que hoje tem fonte unica.
- [x] O schema permanece INTACTO como fronteira de seguranca no servidor.
      Gate G0 do plano: `git diff main -- src/lib/validacoes/pedido.ts
      src/lib/actions/pedido.ts` VAZIO em todo passo. `criarPedido(payload: unknown)`
      roda o proprio `safeParse` em `src/lib/actions/pedido.ts:65`, antes de qualquer I/O.
- [x] Build A/B de confirmacao + teste de paridade.
      Registro: `performance/2026-09-13-163-zod-fora-do-bundle.md`.
      Paridade: `useEnviarPedido.semSchema.test.ts:186` (describe "paridade (163)").

## 🛑 Cuidado

Isto mexe na validação do caminho de pedido. A regra é: o cliente pode perder o
preview, o servidor NÃO pode perder nenhuma barreira. Qualquer mudança tem que
manter verdes os testes de adulteração de payload de `criarPedido`.

## Critério de aceite

- [x] **Redução medida do JS da rota `/loja/[slug]/pedido`.**
      Build A/B real (metodo da auditoria da 126, duas copias fora do repo):
      JS inicial cai de **151.775 B para 87.610 B gzip — −64.165 B (−42,3%)**,
      de 10 para 9 chunks. Raw: 582.376 B → 298.008 B.
      Prova de que zod saiu: `grep -c 'cuid2|toJSONSchema|base64url'` = **0** nos
      9 chunks iniciais, e o chunk `2-3f1p4geboky.js` sumiu do
      `page_client-reference-manifest.js` da rota.
      **Limite honesto:** somando o chunk diferido, o total baixado cai so 240 B
      (−0,16%). O ganho e de caminho critico de parse/hidratacao, NAO de trafego.
- [x] **Nenhuma validação do servidor removida ou enfraquecida.**
      Gate G0 vazio (os dois arquivos de fronteira sem diff). O describe
      "paridade (163)" em `useEnviarPedido.semSchema.test.ts:186` bate o payload
      CRU direto contra `schemaPayloadPedido`: valido aceito; nome vazio, forma de
      pagamento ausente e entrega sem endereco rejeitados. O que o cliente barrava,
      o servidor barra.
- [x] **UX de erro de formulário preservada.**
      Com o schema carregado (caso normal), o toast local continua igual:
      `useEnviarPedido.test.ts:126`. Sem o schema (janela de idle ou falha de rede),
      o veredito vem do servidor e a aba pre-aberta e fechada por `aba.concluir(null)`
      — flash de aba, nao aba orfa: `useEnviarPedido.semSchema.test.ts:120` e `:134`.

## Verificação manual (Passo 5 do plano — sem browser automatizável, issue 176)

Contra o build de **produção** (`npx next start`), com o chunk do zod bloqueado na
marra no DevTools (`1 affected`, `(blocked:devtools)`, 0.0 kB): checkout carregou,
pedido `8D67E906` criado, aba do WhatsApp aberta NO GESTO do clique, confirmacao
renderizada. Caminho feliz tambem validado.

**Cuidado registrado:** o mesmo bloqueio em `next dev` derruba a pagina com
`ChunkLoadError` — artefato do preload do Turbopack em dev, ausente em producao.
Detalhes e o padrao de bloqueio que funciona estao no registro em `performance/`.
