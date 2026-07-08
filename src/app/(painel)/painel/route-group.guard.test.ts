import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, sep } from "node:path";
import { globSync } from "glob";

/**
 * RN-03 (anti-loop) — GUARD ESTRUTURAL (filesystem), no padrão de
 * `src/middleware.cve-guard.test.ts` (trava de regressão por árvore de arquivos).
 *
 * Invariante travada: as DUAS telas isentas do paywall de assinatura
 *   - painel/assinatura-bloqueada/page.tsx
 *   - painel/configuracoes/assinatura/page.tsx
 * NUNCA podem cair sob o route group `(bloqueavel)/` (grupo criado na issue 142).
 *
 * Por que a isenção é POSICIONAL e não por string (spec §RN-02/RN-03):
 * o gate de assinatura passa a ser aplicado por POSIÇÃO na árvore de rotas —
 * só o que está SOB `(bloqueavel)/layout.tsx` é bloqueado —, não mais por
 * comparação de header de pathname vindo do transporte (imune a header forjado,
 * classe CVE-2025-29927). Se uma dessas telas fosse movida para DENTRO do
 * grupo, o `(bloqueavel)/layout.tsx` a bloquearia e a loja com assinatura
 * vencida ficaria presa num loop de redirect (DEADLOCK): o gate mandaria para
 * uma rota que o próprio gate bloqueia.
 *
 * TRAP: hoje `(bloqueavel)/` ainda não existe, então este guard fica VERDE
 * trivialmente. Ele vira VERMELHO no instante em que a issue 142 mover (por
 * engano) uma das telas isentas para dentro do grupo — travando a regressão
 * antes do deploy. A mordida do guard é comprovada por um caso sintético no PR
 * (RED red-first): criar `(bloqueavel)/assinatura-bloqueada/page.tsx` faz o
 * segundo teste falhar; remover restaura o verde.
 */

const here = dirname(fileURLToPath(import.meta.url));
// here === .../src/app/(painel)/painel  → raiz da árvore de rotas do painel.
const painelRoot = here;

// Leaves isentas, relativas a painel/. Escritas por posição-alvo, não por
// onde vivem hoje — o guard vale mesmo depois que a 142 reorganizar a árvore.
const TELAS_ISENTAS = [
  "assinatura-bloqueada/page.tsx",
  "configuracoes/assinatura/page.tsx",
] as const;

const SEGMENTO_GRUPO = "(bloqueavel)";

/** Todos os page.tsx do painel, caminho relativo a painel/ com "/" normalizado. */
function paginasDoPainel(): string[] {
  return globSync("**/page.tsx", { cwd: painelRoot }).map((p) =>
    p.split(sep).join("/"),
  );
}

/** true se ALGUM segmento do caminho é exatamente o route group bloqueável. */
function sobGrupoBloqueavel(rel: string): boolean {
  return rel.split("/").includes(SEGMENTO_GRUPO);
}

/** Ocorrências de uma leaf isenta na árvore (por sufixo de caminho). */
function ocorrenciasDaLeaf(paginas: string[], leaf: string): string[] {
  return paginas.filter((p) => p === leaf || p.endsWith("/" + leaf));
}

describe("RN-03 guard estrutural — telas isentas nunca sob (bloqueavel)/", () => {
  const paginas = paginasDoPainel();

  it.each(TELAS_ISENTAS)(
    "'%s' existe FORA do route group (bloqueavel)/ (posição = isenção)",
    (leaf) => {
      const foraDoGrupo = ocorrenciasDaLeaf(paginas, leaf).filter(
        (p) => !sobGrupoBloqueavel(p),
      );
      expect(
        foraDoGrupo,
        `Tela isenta '${leaf}' precisa existir FORA de ${SEGMENTO_GRUPO}/ ` +
          `(filha direta de painel/). Se sumiu daqui, o anti-loop RN-03 quebrou.`,
      ).not.toHaveLength(0);
    },
  );

  it.each(TELAS_ISENTAS)(
    "'%s' NÃO está sob nenhum caminho contendo (bloqueavel)/ (anti-loop RN-03)",
    (leaf) => {
      const dentroDoGrupo = ocorrenciasDaLeaf(paginas, leaf).filter(
        sobGrupoBloqueavel,
      );
      expect(
        dentroDoGrupo,
        `DEADLOCK: '${leaf}' está sob ${SEGMENTO_GRUPO}/ — o gate de assinatura ` +
          `a bloquearia e a loja vencida entraria em loop de redirect. ` +
          `Mova-a de volta para FORA do grupo (spec §RN-03). Achados: ` +
          JSON.stringify(dentroDoGrupo),
      ).toHaveLength(0);
    },
  );
});
