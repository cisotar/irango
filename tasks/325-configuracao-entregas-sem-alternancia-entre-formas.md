# 325 — Página de configuração de entregas não permite alternar entre formas de cálculo

**Débito registrado em:** 2026-09-27

## Problema

A página de configuração de entregas no painel (`/painel/configuracoes/entregas` ou
equivalente) só expõe o modelo de zonas (bairro, faixa de CEP, raio km). Não existe
UI para o lojista escolher entre os diferentes modos de cálculo disponíveis no
schema (`bairro`, `faixa_cep`, `raio_km`) nem para entender qual está ativo.

O modo "a combinar" foi adicionado como configuração da loja (`lojas.modo_frete`),
mas o acesso a cada forma de cálculo automático permanece opaco — o lojista não
consegue alternar entre elas pela interface.

## Escopo (a detalhar no planejamento)

- Levantar quais formas de cálculo automático fazem sentido oferecer como opção
  na UI (bairro, faixa CEP, raio km — ou apenas um subset).
- Desenhar a alternância sem perder as zonas/taxas já configuradas pelo lojista.
- Definir o comportamento quando há zonas de tipos mistos já cadastradas.

## Atualização 2026-09-27 (issue 326)

A issue 326 trocou a tela de entregas pela tabela de faixas de km, e as opções de frete por CEP e
por bairro, que já existiam no formulário antigo (`FormZona.tsx`), sumiram do painel. Decisão do
usuário ao testar a 326:

- CEP e bairro continuam sendo formas oferecidas ao lojista; o sumiço é débito, não decisão de produto.
- Faixas de km (raio) é a forma **sugerida** inicialmente ao lojista.
- Não é urgente.

Implica: `FormZona.tsx` e as Server Actions de zona não podem ser apagadas às cegas pela limpeza
prevista na 326 (D8, issue 327) sem antes decidir como CEP e bairro voltam para a tela. A RPC
`salvar_faixas_entrega` apaga TODAS as zonas da loja (qualquer tipo) ao salvar; a volta de CEP/bairro
precisa decidir se as formas convivem ou se a tela troca de forma inteira.

## Notas

- Não bloqueia nenhuma feature atual — o cálculo no servidor já suporta todos os
  tipos; a lacuna é só de UI de configuração.
- Relacionado ao modelo de dados em `references/schema.md` (tabelas `zonas_entrega`,
  `taxas_entrega`, `bairros_zona`) e às decisões de `specs/arquivo/modalidades-entrega-loja.md`.
