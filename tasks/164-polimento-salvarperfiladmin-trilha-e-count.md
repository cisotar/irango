# [164] Polimento de `salvarPerfilAdmin`: trilha de auditoria e `count` ignorado

**crítica:** NÃO
**Mundo:** painel (admin SaaS)
**Depende de:** —
**Origem:** findings BAIXA 2 e 3 da auditoria da issue 124.

## Problema A — trilha registra QUE editou, não O QUÊ

`src/app/admin/assinantes/actions/admin-perfil.ts:120` chama
`registrarAcessoAdmin(svc, { lojaId, acao: "salvar_perfil_loja" })` sem metadados.
Compare com `alternarModuloImpressao`, que grava
`metadados: { modulo, ativo, coluna }`.

Um admin que desligue `whatsapp_envio_automatico` de um assinante deixa uma linha
indistinguível de uma correção de CEP. O lojista reclama "meu envio automático
parou" e a trilha não responde.

O padrão fire-and-forget em si está CORRETO aqui e não deve mudar: derrubar uma
escrita de perfil porque o log falhou seria pior. (Fire-and-forget seria
inaceitável numa ação de billing/permissão — não é o caso.)

Correção sugerida:
```ts
registrarAcessoAdmin(svc, {
  lojaId: validacao.lojaId,
  acao: "salvar_perfil_loja",
  // Só chaves alteradas, NUNCA valores (PII: telefone/whatsapp/endereço — §8).
  metadados: { campos: Object.keys(patch) },
});
```

- [ ] Registrar os campos alterados, nunca os valores.

## Problema B — `ok: true` para loja inexistente

`admin-perfil.ts:97,113` — `atualizarLoja` usa `{ count: "exact" }` mas a action
só lê `error`. Um UUID válido de loja inexistente (ou excluída entre o load e o
submit) percorre tudo e devolve `{ ok: true }` sem ter gravado nada.

`alternarModuloImpressao:90` já faz o certo:
`if (count === 0) return { ok: false, erro: "Loja não encontrada." }`.

Não é brecha de isolamento — o `.eq("id")` garante que nada foi gravado em lugar
errado. É inconsistência de contrato que mascara falha silenciosa.

- [ ] Tratar `count === 0` como erro, em paridade com `alternarModuloImpressao`.

## Critério de aceite

- [ ] Trilha permite distinguir quais campos o admin alterou, sem PII.
- [ ] Salvar perfil de loja inexistente devolve erro, não `ok: true`.
