# [368] Assistente de primeiros passos antes do painel + gate único de publicação (incorpora 193)

**crítica:** SIM — autorização do painel + gate único de publicação (lojista e admin, escopo por loja_id) + Server Action nova com API externa
**Incorpora:** 193 — as opções em aberto da 193 estão decididas em D12–D17; ignore as listas de opções de lá
**Mundo:** painel do lojista + hub admin (gate de publicação)
**Plano de execução:** `plan/loop-368-primeiros-passos-da-loja.md`

## Pedido (literal)

> lojista cria nova loja, ele não deve ser direcionado para /painel enquanto loja não for publicada. enquanto loja não for publicada, ele deve ser direcionado para um wizard que o ajude a configurar o perfil da loja, os horários, as formas de entrega e de pagamento, os primeiros produtos e opcionais para então a loja ser publicada. lojista só deve ir para painel após login quando loja já estiver publicada.

## Resposta do usuário à 1ª versão do plano (literal)

> 1. A task 193 entra nesta entrega (`tasks/193-endereco-obrigatorio-e-gate-de-publicacao.md`). Ela sai de `tasks/` no mesmo PR, junto com a 368.
> 2. Mesmo gate em todos os caminhos. Publicar pelo lojista, republicar depois de pausar e publicar pelo hub admin (`src/app/admin/assinantes/actions/admin-perfil.ts` e/ou `admin-publicar`) passam por um gate único em `podePublicarLoja`, com o mínimo: nome, WhatsApp, ≥1 produto, ≥1 forma de pagamento, endereço completo e coordenada gravada. O admin não pode forçar.
> 3. Endereço completo obrigatório para publicar: CEP, rua, número, bairro, cidade e UF. Complemento é opcional. O zod do perfil (`src/lib/validacoes/loja.ts`) marca os mesmos campos. A coordenada não entra no zod: é derivada no servidor. A mensagem de erro distingue "falta preencher o endereço" de "não conseguimos localizar seu endereço agora, tente em instantes".
> 4. 193 item 5 (loja publicada que perde a coordenada): a loja segue no ar. O painel mostra um aviso persistente com o botão "Localizar meu endereço de novo". Esse botão é também o caminho de recuperação exigido pelo aceite da 193 (loja sem coords cujo endereço não mudou e que não regeocodifica pela 180-A). O checkout já degrada pela 180-B (mesclada no PR #128).
> 5. Versão completa, sem corte.

## Leitura do cloud (P1, só leitura, 2026-11-16)

- lojas no total: 11 · `ativo=true`: 9
- `ativo=true` com endereço incompleto (algum dos 6 campos vazio): 4
- `ativo=true` com endereço completo e sem par `latitude`/`longitude`: 2
- "Pão do Ciso": ativa, endereço completo, com par
- "Lanches base": ativa, endereço completo, sem par
- Gatilho de pausa do D16 (>10 com endereço completo e sem par, ou "Pão do Ciso" incompleta/sem par): não disparou.
- Consequência: 4 lojas ativas sem endereço completo e 2 sem par entram no ar com o aviso D15, sem backfill.

## Decisões (fixas; divergência de qualquer agente → `ok:false` com motivo)

- **D1.** Roteamento usa "já publicada ao menos uma vez" = `lojas.primeira_publicacao_em IS NOT NULL`, nunca `ativo` atual. Despublicar não devolve ao assistente.
- **D2.** Backfill do marcador: preenche em toda loja com `ativo = true` OU com ≥1 linha em `pedidos`. Demais ficam nulas e caem no assistente no próximo acesso.
- **D3.** Marcador gravado só pelo banco (trigger BEFORE INSERT/UPDATE em `lojas`) quando `ativo` vira/nasce `true`. Write-once: nenhum papel de aplicação (`authenticated`, `service_role`) altera ou limpa depois de preenchido.
- **D4.** Assistente em `/painel/primeiros-passos/*`, FORA de `(bloqueavel)/` (isenção posicional, igual a `assinatura-bloqueada/`). Gate novo vive em `(bloqueavel)/layout.tsx`. `decidirAcessoBase` NÃO muda. Layout do painel troca o chrome (sem `SidebarPainel`) para loja não concluída.
- **D5.** Assistente não aplica `decidirAssinatura`; `assinatura-bloqueada/` e `configuracoes/assinatura/` seguem alcançáveis.
- **D6.** Etapas: perfil → horários → entregas → pagamentos → produtos → opcionais (pode pular) → revisar e publicar. Navegação livre; retomada abre a primeira etapa com pendência.
- **D7.** Gate único de publicação em `podePublicarLoja` (`src/lib/utils/publicacao.ts`), revalidado no servidor a partir do banco: nome + WhatsApp + CEP, rua, número, bairro, cidade e UF preenchidos + par `latitude`/`longitude` gravado + ≥1 produto disponível + ≥1 forma de pagamento. Contagens com `eq("loja_id")` explícito. Caminhos: `definirPublicacao` (lojista, inclusive republicar depois de pausar) e `publicarLojaAdmin` (admin, sem exceção). Despublicar nunca passa pelo gate.
- **D8.** Botão publicar só na última etapa do assistente; no painel, segue onde está hoje (perfil).
- **D9.** Após publicar pelo assistente: `/painel` com o layout pai re-renderizado (chrome completo).
- **D10.** Mensagens do gate, cada uma com verbo no imperativo e nunca começando com "Sem…"/"Caso não…": (a) falta preencher endereço → lista os campos que faltam; (b) endereço completo sem coordenada → manda tocar em "Localizar meu endereço de novo" e tentar em instantes, sem pedir para corrigir o endereço; (c) perfil, (d) produto, (e) pagamento: uma cada. A causa exata da falha de localização vem do botão, por `avisoGeocodingPerfil(motivo)`, que já separa falha nossa de dado errado.
- **D11.** Nenhum ponto de login/callback muda.
- **D12.** Endereço exigido só a partir do perfil: `schemaPerfil` torna os 6 campos obrigatórios; `FormNovaLoja.tsx`, `schemaNovaLojaAdmin` e o cadastro do lojista não mudam. Consequência aceita: qualquer save de perfil (assistente, painel e hub admin) passa a exigir o endereço completo.
- **D13.** Com o endereço obrigatório no zod, payload sem endereço é recusado na validação, antes do geocoding: o modal "não localizamos seu endereço" deixa de aparecer para quem nunca preencheu (aceite da 193). Remover ou manter o ramo morto "sem motivo" de `avisoGeocodingPerfil` é decisão do P2.
- **D14.** Botão "Localizar meu endereço de novo" = Server Action nova do lojista em `src/lib/actions/loja.ts`. Só age se o endereço está completo e falta o par. Reusa `montarConsultaGeocoding`, `temCoordenadas` e `geocodificarLojaComRetry` (balde por loja). Rate limit com chave nova em `LIMITES`. Grava só o par, com o client autenticado e `eq("id")` da loja do dono. Se falhar, não grava nada e devolve `motivo`. Revalida o layout do painel para o aviso sumir.
- **D15.** Aviso persistente no layout do painel, em toda página, para loja já publicada alguma vez (D1) que esteja sem endereço completo ou sem par: (a) endereço incompleto → link para completar o perfil; (b) completo sem par → botão D14. A loja segue no ar; nenhum código despublica. Hub admin não ganha botão: o admin recupera salvando o perfil (regra 3 de `deveRegeocodificar`).
- **D16.** Lojas já publicadas sem endereço completo ou sem par: contagem só por leitura (números acima). Continuam no ar e recebem o aviso D15. Sem backfill de geocoding em lote.
- **D17.** Débito 140 (PATCH direto em `ativo` pelo dono) fica ABERTO nesta entrega: fechá-lo por trigger copiaria as 11 condições de D7 em SQL, criando segunda fonte contra o "gate único em `podePublicarLoja`". O bypass exige o JWT do próprio dono sobre a própria loja (auto-dano). O PATCH direto também preenche o marcador e pula o assistente: mesma classe, mesmo registro. O P10 registra o 140 em `architecture.md` §10 com o gate novo. Fechar no futuro: função SQL única de prontidão, chamada pelo trigger e por `podePublicarLoja`, em issue própria.

## Critério de aceite

1. Prova por fatia: coluna "prova" da tabela "Risco por fatia" do plano `plan/loop-368-primeiros-passos-da-loja.md` (marcador/trigger/backfill, decisão + gate posicional, gate único de publicação, endereço obrigatório no perfil, Server Action D14, aviso D15, etapas sem via de escrita própria, chrome por estado).
2. Aceites da 193:
   - [ ] Publicar loja sem o endereço mínimo é recusado no servidor, com mensagem que diz quais campos faltam.
   - [ ] Publicar loja com endereço preenchido mas sem coordenada é recusado, com mensagem que distingue falha do serviço de dado errado do lojista.
   - [ ] Existe caminho de recuperação para loja sem coords cujo endereço não mudou (botão D14).
   - [ ] O schema zod do perfil exige os mesmos campos, e o form marca-os como obrigatórios.
   - [ ] Loja já publicada sem endereço tem comportamento definido e documentado (aviso D15).
   - [ ] Teste do gate cobrindo: sem endereço → recusa; endereço mínimo → publica; nome/WhatsApp ausentes seguem recusando.
   - [ ] O modal de aviso de geocoding não aparece mais por ausência de endereço, só por falha do serviço ou endereço não localizável.
3. Checklist de clique (usuário):
   1. criar conta nova de lojista (e-mail de teste próprio), confirmar, entrar → assistente, sem menu lateral
   2. digitar `/painel/pedidos` → volta ao assistente; `/painel/configuracoes/assinatura` → abre
   3. etapa de perfil: salvar sem endereço → campos marcados como obrigatórios, sem o modal "não localizamos seu endereço"
   4. última etapa com algo faltando (endereço, localização, produto ou pagamento) → publicar desabilitado com a mensagem certa; corrigir → habilita
   5. pular opcionais → segue para revisar
   6. publicar → `/painel` com menu completo
   7. despublicar no painel → sair → entrar → continua no painel
   8. entrar como "Pão do Ciso" → painel direto; se aparecer o aviso de endereço, só anotar, não alterar
   9. hub admin: publicar a loja de teste nova sem produto ou sem endereço → recusa com a mensagem
   10. aviso persistente: vale o teste automatizado; opcional: "Lanches base" com endereço que o mapa não encontre, tocar em "Localizar meu endereço de novo"
4. Gates: `npx tsc --noEmit`, `npm run lint`, `npm test`, `npm run build` verdes; migration com Remote preenchido (`npx supabase migration list`); `gh pr checks <n>` verde.

## Arquivos

criar: migration `supabase/migrations/20261101xxxxxx_lojas_primeira_publicacao.sql` · `tests/migrations/lojas_primeira_publicacao.test.ts` · `src/app/(painel)/painel/primeiros-passos/` (layout, páginas das etapas, `layout.guard.test.tsx`) · componente do aviso D15 em `src/components/painel/` · `mockups/primeiros-passos-da-loja.html` + `.md`

modificar: `src/lib/utils/acessoPainel.ts` · `(bloqueavel)/layout.tsx` · `painel/layout.tsx` · `route-group.guard.test.ts` · `src/lib/utils/publicacao.ts` · `src/lib/actions/loja.ts` · `src/app/admin/assinantes/actions/admin-publicar.ts` · `src/lib/actions/admin-loja.ts` (`CAMPOS_LOJA_SOMENTE_SERVIDOR`) · `src/lib/validacoes/loja.ts` · `src/lib/utils/rateLimit.ts` · `PerfilClient.tsx` e `PerfilAdminClient.tsx` · `src/lib/database.types.ts` · fixtures de teste (`manifestPainel.test.ts`, `manifest.webmanifest/route.test.ts`, guards, payloads de perfil) · `references/architecture.md` §3, §5, §6, §10 · `references/schema.md` §`lojas` · `references/seguranca.md` §4, §17

higiene no fim: `git rm` desta issue e da 193; `git mv` dos dois `plan/loop-368-*` para `plan/arquivo/`.
