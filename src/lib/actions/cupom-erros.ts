// Módulo NEUTRO (sem `'use server'`) — infra compartilhada pelo CRUD de cupom do
// LOJISTA (`lib/actions/cupom.ts`) e pelo CRUD ADMIN
// (`app/admin/assinantes/actions/admin-cupom.ts`). Motivo da extração: um módulo
// `'use server'` só pode exportar funções async — não pode exportar `type` nem a
// função SYNC `erroPersistencia` (quebra só no `next build`; ver MEMORY
// use-server-export-constraint). Fonte ÚNICA do contrato de resultado e do mapper
// 23505 nos dois caminhos (padrão de `upload-imagem.ts`, architecture.md §8).

export type ResultadoGestaoCupom = { ok: true } | { ok: false; erro: string };

/**
 * Mapeia o `error` do PostgREST para o contrato `{ ok:false, erro }`:
 *  - `23505` (UNIQUE `loja_id`+`codigo`) → mensagem específica ACIONÁVEL
 *    ("Este código já existe") — regra de negócio, não vaza detalhe interno;
 *  - qualquer outro → mensagem genérica (seguranca.md §14).
 *
 * `message: string` obrigatório para casar por propriedade em comum com o
 * shape real de erro do PostgREST/`escopo` (`{ message: string }`) — evita
 * cast de alargamento (`as { code?: string; ... }`) nos call sites. `code`
 * opcional: os helpers do `escopo` não tipam `code`, mas em runtime o objeto
 * PostgREST traz — lido de forma defensiva.
 */
export function erroPersistenciaCupom(error: {
  code?: string;
  message: string;
}): ResultadoGestaoCupom {
  if (error.code === "23505") {
    return { ok: false, erro: "Este código já existe" };
  }
  return { ok: false, erro: "Não foi possível salvar o cupom." };
}
