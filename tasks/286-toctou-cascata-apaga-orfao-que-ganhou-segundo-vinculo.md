# [286] Cascata de remoção: janela TOCTOU apaga produto que ganhou um segundo cardápio entre o recálculo e o DELETE

**crítica: NÃO** — mesmo tenant, janela de milissegundos, sem cross-tenant. Severidade da
auditoria: **BAIXA**.

**Depende de:** [284] (entregue).

## Origem

Auditoria da feature de remoção de cardápio com escolha do lojista (commits `bbf135b`,
`9345f69`, branch `feat/remocao-cardapio-exclusivos`).

## O problema

`removerCardapio`/`removerCardapioAdmin` (`src/lib/actions/cardapio.ts:497-515`,
`src/app/admin/assinantes/actions/admin-cardapios.ts:295-312`) recalculam `orfaos` no servidor e
apagam esse conjunto. Entre o recálculo e o DELETE, uma segunda aba pode vincular um dos
produtos a outro cardápio — ele deixa de ser órfão, mas o DELETE já lido não reconfere isso, e o
produto é apagado mesmo assim. O trigger `produtos_exclusivo_tem_cardapio` não impede: no COMMIT o
produto não existe mais, então `EXISTS` é falso e o CASCADE leva o vínculo novo junto.

Viola a letra de RN-07 da spec (`specs/remocao-cardapio-exclusivos.md`): "exclusivo pendurado em
outro cardápio não é apagado". Perda permanente de um produto que não era mais órfão no instante
da escrita, dentro do mesmo tenant.

## Correção proposta

Reconferir a contagem imediatamente antes do DELETE e abortar se divergir do recálculo original:

```ts
const orfaos2 = await buscarProdutosQueFicariamOrfaos(svc, loja.lojaId, id);
if (orfaos2.length !== orfaos.length) return { ok: false, erro: MSG_REMOVER, exclusivos: 0 };
```

Estreita a janela, não a fecha por completo (fechar de verdade exigiria a RPC que a decisão D1 da
spec descartou). Alternativa: documentar RN-07 como "no instante do recálculo" e aceitar a janela,
já que `cascata` é gesto de uma aba só na prática.

## Critério de aceite

- [ ] Caso pglite ou de action que vincula o produto a um 2º cardápio entre o recálculo e o
      DELETE e afirma que ele sobrevive (ou, se a decisão for aceitar a janela, documentar a
      decisão na spec e fechar sem código).
- [ ] `npx tsc --noEmit` → `npm run lint` → `npm test` → `npm run build`.
