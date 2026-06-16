# [009] `PerfilClient`: bloco de Endereço da Loja + autocomplete ViaCEP + toast de geocoding

**crítica:** NÃO
**Mundo:** painel
**Depende de:** 004, 008
**Spec:** specs/zonas-entrega-raio-km.md

## Objetivo
Adicionar à `PerfilClient.tsx` uma seção nova "Endereço da Loja" (CEP, logradouro, número, bairro, cidade, UF) com máscara de CEP e autocomplete via ViaCEP. Ao salvar, exibir toast não-bloqueante quando o servidor retornar `geocodificado: false`.

## Escopo
- [ ] Bloco de endereço novo no form (campos mapeados às colunas `endereco_*` conforme spec).
- [ ] Máscara de CEP com `IMaskInput` (react-imask) — já usado no arquivo.
- [ ] Autocomplete ViaCEP: ao digitar CEP, preencher `endereco_rua/bairro/cidade/estado` (mesmo padrão de `FormEndereco.tsx`).
- [ ] Edição manual de qualquer campo permitida (UX); o `schemaPerfil` (issue 004) valida no submit como gate; a action revalida.
- [ ] Toast quando `salvarPerfil` retorna `geocodificado: false`: "Não localizamos seu endereço no mapa — zonas por raio ficam inativas até corrigir".
- [ ] Pré-preencher os campos de endereço a partir do `inicial` (estender `PerfilInicial` e a página que monta o prop).

## Fora de escopo
- Lógica de geocoding/coords (servidor — issue 008).
- Qualquer campo `latitude`/`longitude` no form (proibido por design).
- Tooltip de margem no raio em `/painel/configuracoes/entregas` (mitigação documentada — issue 010).

## Reuso esperado
- `FormEndereco.tsx` (`components/vitrine/`) — padrão de autocomplete ViaCEP; portar a lógica, não duplicar a chamada (extrair helper de ViaCEP se ainda não existir compartilhável).
- shadcn/ui `Input`, `Label`, `Card`, `Separator` (já importados em `PerfilClient`).
- `IMaskInput` (react-imask) já no arquivo.
- `schemaPerfil` (issue 004) e `salvarPerfil` (issue 008).

## Segurança
- UI sem lógica de valor monetário nem autorização — cliente não define coords. Por isso `crítica: NÃO`.
- A validação real é server-side (issues 004/008); o form é gate de UX.

## Critério de aceite
- [ ] Digitar CEP autocompleta logradouro/bairro/cidade/UF (observável).
- [ ] Salvar com endereço válido persiste os campos `endereco_*` (verificável no banco).
- [ ] Quando o servidor retorna `geocodificado: false`, o toast de aviso aparece.
- [ ] `next build` sem erro.
