import { schemaTema } from "@/lib/validacoes/loja";
import {
  DESTAQUE_PADRAO,
  FUNDO_PADRAO,
  THEME_PADRAO,
} from "@/lib/utils/manifest";

export type TemaVitrine = { primaria: string; fundo: string; destaque: string };

const TEMA_PADRAO: TemaVitrine = {
  primaria: THEME_PADRAO,
  fundo: FUNDO_PADRAO,
  destaque: DESTAQUE_PADRAO,
};

/**
 * Extrai o tema da loja validando com o mesmo schema da Server Action de config
 * (`#RRGGBB`). Tema ausente/malformado → defaults. Os valores já são validados
 * na escrita, então a injeção SSR via `<style>` não tem risco de injeção.
 */
export function resolverTema(tema: unknown): TemaVitrine {
  const parsed = schemaTema.safeParse(tema);
  return parsed.success ? parsed.data : TEMA_PADRAO;
}
