# [062] LGPD — páginas /privacidade e /termos + direitos do titular

**crítica:** NÃO
**Mundo:** vitrine pública
**Depende de:** —
**Spec:** specs/spec_irango_mvp.md (seguranca.md §20)

## Objetivo
Publicar as páginas públicas de Política de Privacidade e Termos de Uso (conteúdo placeholder), linká-las no footer e no formulário de cadastro, e registrar o canal de exercício dos direitos do titular (exclusão/portabilidade) como follow-up de processo.

## Escopo
- [ ] Página pública `/privacidade` (Política de Privacidade) — conteúdo placeholder marcado claramente: "revisar com jurídico antes de operar comercialmente"
- [ ] Página pública `/termos` (Termos de Uso) — mesmo placeholder com aviso jurídico
- [ ] Cada página exibe a `versao` dos termos (constante compartilhada com a action de cadastro — issue 015, `consentimento_versao`)
- [ ] Link para `/privacidade` e `/termos` no footer público
- [ ] Link para ambas no formulário de cadastro, ao lado do checkbox de aceite (issue 015 grava o aceite; aqui só os links)
- [ ] Nota visível na Política sobre direito de exclusão e portabilidade de dados (LGPD), informando o canal de contato para solicitação
- [ ] Registrar como follow-up de processo (comentário/nota): exclusão e portabilidade NÃO precisam de automação no v1 — atendimento manual pelo canal informado; documentar para iteração futura

## Fora de escopo
Schema de consentimento (001), gravação do aceite no cadastro (015), automação de expurgo/anonimização de pedidos antigos (follow-up futuro, não esta issue).

## Reuso esperado
- `references/seguranca.md` §20 — base legal, minimização, retenção, exclusão; fonte do conteúdo placeholder
- Layout/footer público existente — reusar, não recriar estrutura de página
- Constante de versão dos termos compartilhada com a action de cadastro (015)

## Segurança
- Páginas públicas, sem dado sensível, sem valor monetário — nenhum recálculo no servidor
- Nenhuma tabela tocada → nenhuma política RLS nova
- Conteúdo é placeholder: não publicar comercialmente sem revisão jurídica (aviso explícito na própria página)

## Critério de aceite
- [ ] `/privacidade` e `/termos` carregam publicamente (sem auth) e exibem o aviso "revisar com jurídico antes de operar comercialmente"
- [ ] Footer público e formulário de cadastro têm links funcionais para ambas
- [ ] Política menciona direito de exclusão/portabilidade e o canal de contato
- [ ] Versão dos termos exibida bate com a constante usada em `consentimento_versao` (015)
