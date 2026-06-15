import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  TAMANHO_MAXIMO_BYTES,
  TIPOS_IMAGEM_PERMITIDOS,
} from "../../src/lib/utils/validarImagem";

/**
 * [073] Bucket `produtos` — file_size_limit + allowed_mime_types (TDD RED).
 *
 * LIMITAÇÃO DO HARNESS: pglite NÃO tem o schema `storage` (sem
 * `storage.buckets`). A migration de limites tem um GUARD `to_regclass(
 * 'storage.buckets') IS NULL → RETURN` que a faz pular silenciosamente no
 * harness — exatamente como `20260614010500_storage_bucket_produtos.sql`.
 * Logo, NÃO dá para asseverar o `file_size_limit`/`allowed_mime_types` REAIS
 * do bucket aqui: isso só é verificável via `supabase db reset` + query
 * (`SELECT file_size_limit, allowed_mime_types FROM storage.buckets WHERE
 * id='produtos'`), na etapa `verificar`.
 *
 * O que ESTE teste valida com valor real (não cosmético):
 *   - A migration de limites EXISTE (hoje não existe → RED).
 *   - Tem o GUARD pglite correto (alvo `storage.buckets`, a tabela tocada) —
 *     senão quebraria a suíte no harness.
 *   - O `UPDATE` seta `file_size_limit` para o MESMO valor de
 *     `TAMANHO_MAXIMO_BYTES` da app (anti-drift: se um mudar e o outro não,
 *     Storage e validação da app divergem — risco §9 da issue).
 *   - O `allowed_mime_types` é EXATAMENTE os 3 MIME de
 *     `TIPOS_IMAGEM_PERMITIDOS` (nem a mais, nem a menos).
 *   - Escopo na linha certa: `WHERE id = 'produtos'`.
 *
 * Anti-falso-verde: sem a migration o arquivo não existe → todos os casos que
 * dependem do conteúdo ficam vermelhos. O valor de tamanho é importado do
 * módulo real (não duplicado como literal), então o teste prova a equivalência,
 * não apenas a presença de um número mágico.
 */

const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");

function lerMigrationLimites(): string {
  const arquivo = readdirSync(MIGRATIONS_DIR).find(
    (f) =>
      f.endsWith(".sql") && f.includes("storage_bucket_produtos_limites"),
  );
  if (!arquivo) {
    throw new Error(
      "Migration de limites do bucket `produtos` não encontrada (esperado " +
        "supabase/migrations/*storage_bucket_produtos_limites*.sql). " +
        "Fase GREEN ainda não implementou.",
    );
  }
  return readFileSync(join(MIGRATIONS_DIR, arquivo), "utf8");
}

describe("[073] migration limites bucket produtos — contrato de enforcement", () => {
  it("[1] migration de limites existe", () => {
    expect(() => lerMigrationLimites()).not.toThrow();
  });

  it("[2] tem o GUARD pglite para `storage.buckets` (não quebra o harness)", () => {
    const sql = lerMigrationLimites();
    expect(sql).toContain("to_regclass('storage.buckets')");
    // O GUARD deve sair cedo quando o schema storage não existe.
    expect(sql).toMatch(/IS NULL[\s\S]*RETURN/i);
  });

  it("[3] faz UPDATE de storage.buckets escopado em id='produtos'", () => {
    const sql = lerMigrationLimites();
    expect(sql).toMatch(/UPDATE\s+storage\.buckets/i);
    expect(sql).toMatch(/WHERE\s+id\s*=\s*'produtos'/i);
  });

  it("[4] file_size_limit === TAMANHO_MAXIMO_BYTES da app (anti-drift)", () => {
    const sql = lerMigrationLimites();
    // O número no SQL precisa bater com a constante real da app, não um literal
    // qualquer. Constrói o regex a partir da constante importada.
    const re = new RegExp(
      `file_size_limit\\s*=\\s*${TAMANHO_MAXIMO_BYTES}\\b`,
      "i",
    );
    expect(sql).toMatch(re);
    // Sanidade: o valor esperado pela issue é exatamente 2 MB.
    expect(TAMANHO_MAXIMO_BYTES).toBe(2097152);
  });

  it("[5] allowed_mime_types contém EXATAMENTE os 3 MIME de TIPOS_IMAGEM_PERMITIDOS", () => {
    const sql = lerMigrationLimites();
    // Cada tipo permitido pela app deve aparecer na lista do bucket.
    for (const mime of TIPOS_IMAGEM_PERMITIDOS) {
      expect(sql).toContain(`'${mime}'`);
    }
    // Extrai o array do SQL e confere que não tem MIME a mais (nem a menos).
    const m = sql.match(/allowed_mime_types\s*=\s*ARRAY\[([^\]]*)\]/i);
    expect(m, "ARRAY[...] de allowed_mime_types não encontrado").not.toBeNull();
    const mimesNoSql = (m![1].match(/'([^']+)'/g) ?? []).map((s) =>
      s.replace(/'/g, ""),
    );
    expect([...mimesNoSql].sort()).toEqual([...TIPOS_IMAGEM_PERMITIDOS].sort());
  });
});
