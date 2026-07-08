# [140] Gate de `ativo` em `definirPublicacao`: comentário promete proteção de trigger inexistente

**crítica:** NÃO (BAIXA — bypass de regra de negócio em recurso próprio, sem cross-tenant/dinheiro)
**Mundo:** painel (lojista)
**Origem:** auditoria da issue 129 (fora do escopo daquela issue — pré-existente)
**Spec:** — (débito técnico independente do spec 4)

## Contexto
`src/lib/actions/loja.ts:155-159` — o comentário de `definirPublicacao` afirma que
`ativo` é "coluna PROTEGIDA pelo trigger anti-billing (057)". Verificado nas três
versões do trigger (057/074/128): **`ativo` NUNCA esteve na lista de colunas
protegidas.** O caminho funciona hoje só porque `definirPublicacao` roda como
service_role, mas o comentário garante uma proteção de banco que não existe.

## Vetor (BAIXA)
Lojista autenticado faz `PATCH /rest/v1/lojas?id=eq.<própria> {"ativo": true}` via
PostgREST direto → RLS `lojas_update_proprio` permite (linha própria), o trigger não
bloqueia → auto-publica loja incompleta, driblando o gate `nome + whatsapp` de
`definirPublicacao`. Sem cross-tenant, sem dinheiro, sem escalonamento — só prejudica
a própria vitrine. Por isso BAIXA.

## Escopo (decisão de design a validar)
- [ ] Decidir entre: (a) adicionar `ativo` às checagens do trigger via nova migration
  (proteção de banco real — mas `ativo` É editável pelo dono via `definirPublicacao`
  que hoje roda como service_role; precisaria manter esse caminho funcionando), OU
  (b) assumir o gate `nome + whatsapp` como UX-only e **corrigir o comentário** para
  não prometer proteção inexistente.
- [ ] Aplicar a opção escolhida.

## Critério de aceite
- [ ] Comentário e realidade do trigger consistentes.
- [ ] Se opção (a): teste pglite (dono não liga `ativo` sem passar por `definirPublicacao`).
