// Contrato compartilhado da Server Action de upload (issue 075).
// Vive FORA do módulo `'use server'` (upload.ts) porque arquivos com a diretiva
// `'use server'` só podem EXPORTAR funções async — exportar uma const/tipo de lá
// faz o build do Next falhar ("module has no exports at all"). Este módulo neutro
// é importado tanto pela action quanto pelo client component `UploadFotoProduto`.

/** Nome do campo do FormData que carrega o arquivo enviado à action. */
export const CAMPO_ARQUIVO = "file";

/** Resultado da Server Action de upload: sucesso com URL pública ou erro genérico. */
export type ResultadoUpload =
  | { ok: true; foto_url: string }
  | { ok: false; erro: string };
