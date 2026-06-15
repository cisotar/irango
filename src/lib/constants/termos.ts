// Versão corrente dos Termos de Uso / Política de Privacidade.
// Constante de configuração compartilhada (não é dado pessoal — permitido em
// código, seguranca.md §8). Fonte única de verdade para:
//   - a action de cadastro (grava em `consentimento_versao` — issue 015)
//   - as páginas públicas /termos e /privacidade (exibem a versão — issue 062)
// A versão exibida ao usuário SEMPRE bate com a que é gravada no aceite.
// Bump quando os termos mudarem (futuro: re-consentimento).
export const VERSAO_TERMOS = "2026-06-13";
