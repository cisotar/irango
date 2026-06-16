// Contrato compartilhado das Server Actions de logo da loja (issue 003).
// Vive FORA do módulo `'use server'` (logo.ts) porque arquivos com a diretiva
// `'use server'` só podem EXPORTAR funções async — exportar uma const/tipo de lá
// quebra o build do Next. O nome do campo do FormData é reusado de
// `upload-contrato.ts` (CAMPO_ARQUIVO) — NÃO duplicar aqui.

/**
 * Resultado de `salvarLogoLoja`: sucesso com a URL pública persistida ou erro
 * genérico. `logo_url` é OBRIGATÓRIO no ramo de sucesso (o client lê e exibe o
 * preview), permitindo narrowing seguro sem checagem de `undefined`.
 */
export type ResultadoSalvarLogo =
  | { ok: true; logo_url: string }
  | { ok: false; erro: string };

/**
 * Resultado de `removerLogoLoja`: sucesso sem URL (a logo foi para NULL) ou erro
 * genérico.
 */
export type ResultadoLogo =
  | { ok: true }
  | { ok: false; erro: string };
