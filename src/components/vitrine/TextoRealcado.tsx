import { partirPorTermo } from "@/lib/utils/buscarProdutos";

type TextoRealcadoProps = {
  texto: string;
  /** Termo de busca do cliente. Ausente/vazio → `texto` cru, sem `<mark>`. */
  termo?: string;
};

/**
 * Estilo do `<mark>` (issue 200, design-system.md §4/§5):
 * o Preflight do Tailwind NÃO reseta `<mark>` — sem `background`/`color`
 * explícitos sai o amarelo do navegador, fora da paleta e alheio ao tema da
 * loja. Fundo `--cinza-medio` + cor de texto HERDADA garantem contraste AA
 * independente da cor que o lojista escolheu; o tema entra só como cor do
 * sublinhado (decoração, não portadora de texto → WCAG 1.4.1 satisfeito por
 * fundo + sublinhado, não só por cor). `cinza-medio` e não `cinza-claro`:
 * a linha da lista tem `hover:bg-cinza-claro` e o realce precisa sobreviver
 * ao hover. Nada vira `block` nem ganha `margin` → `line-clamp-2` (card) e
 * `truncate` (lista) continuam funcionando.
 */
const ESTILO_MARCA =
  "rounded-[3px] bg-cinza-medio px-0.5 text-inherit underline decoration-2 underline-offset-2 decoration-[var(--cor-destaque)]";

/**
 * Projeta o casamento de `partirPorTermo` (199) em nós React, envolvendo o
 * trecho casado em `<mark>`. NÃO reimplementa casamento de string: todo o
 * trabalho de normalização/índice vive em `lib/utils/buscarProdutos.ts`.
 *
 * Segurança: cada segmento entra como filho TEXTO de JSX — escape automático
 * do React. Nenhuma injeção de HTML cru (a prop de innerHTML do React não
 * aparece aqui NEM como literal, para o grep do critério de aceite continuar
 * limpo), nenhuma concatenação de HTML, nenhum `RegExp` derivado do termo
 * (RN-9 / seguranca.md §15). `texto` é conteúdo de lojista e `termo` é input
 * do cliente: ambos não confiáveis.
 *
 * Sem `'use client'` próprio — puro e isomórfico como `buscarProdutos.ts`,
 * herda o ambiente do consumidor e não causa hydration mismatch.
 */
export function TextoRealcado({ texto, termo }: TextoRealcadoProps) {
  const partes = termo ? partirPorTermo(texto, termo) : [];
  const temRealce = partes.some((parte) => parte.casa);

  // Early-return obrigatório (não só uma otimização): sem match, a árvore React
  // tem de ser IDÊNTICA à de antes desta issue. Um `<>{partes.map(...)}</>` com
  // um único segmento já mudaria o HTML de SSR (`renderToString` insere
  // `<!-- -->` entre text nodes irmãos).
  if (!temRealce) return <>{texto}</>;

  return (
    <>
      {partes.map((parte, indice) =>
        parte.casa ? (
          // Key posicional é correta aqui: os segmentos são posicionais e a
          // lista inteira é recriada a cada mudança de termo.
          <mark key={indice} className={ESTILO_MARCA}>
            {parte.texto}
          </mark>
        ) : (
          parte.texto
        ),
      )}
    </>
  );
}
