"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  BuscaProdutos,
  EstadoVazioBusca,
  ResumoBusca,
} from "@/components/vitrine/BuscaProdutos";
import { criarAnunciadorBusca } from "@/components/vitrine/anunciadorBusca";
import { NavCategorias } from "@/components/vitrine/NavCategorias";
import {
  SecaoCatalogo,
  type CategoriaComProdutos,
} from "@/components/vitrine/SecaoCatalogo";
import {
  CLASSES_MAIN_VITRINE,
  ESCADA_LARGURA_VITRINE,
  ID_MAIN_VITRINE,
} from "@/components/vitrine/layoutVitrine";
import {
  VAR_ALTURA_BARRA,
  medirEObservarBarra,
} from "@/components/vitrine/medicaoBarraVitrine";
import {
  contarProdutos,
  textoAnuncioBusca,
} from "@/components/vitrine/resumoBusca";
import { filtrarCatalogo, normalizarBusca } from "@/lib/utils/buscarProdutos";
import type { GrupoOpcional } from "@/lib/supabase/queries/produtos";

type CatalogoVitrineProps = {
  categorias: CategoriaComProdutos[];
  opcionaisPorCategoria?: Record<string, GrupoOpcional[]>;
  /**
   * [262] Repassado intacto ao `SecaoCatalogo`. Este componente não lê nem
   * reescreve o mapa: a frase vem pronta do servidor (247/254) e chaveada por
   * id, então o filtro da busca (que é subtrativo) não a alcança.
   */
  rotulosVigencia: Record<string, string>;
};

/**
 * Dono do layout do catálogo na vitrine: a barra sticky (busca + nav de
 * categorias), a medição dessa barra em runtime, o estado do termo de busca e o
 * `<main>` que envolve o `SecaoCatalogo`.
 *
 * É a única camada client com estado de layout da vitrine — busca, nav e
 * catálogo precisam do mesmo `termo`, e três irmãos sob um Server Component não
 * têm onde compartilhá-lo. Nenhuma invariante de valor ou de permissão vive
 * aqui: o conjunto de produtos vem do SSR sob `anon` + RLS (RN-1) e o preço é
 * recalculado no checkout (seguranca.md §10).
 */
export function CatalogoVitrine({
  categorias,
  opcionaisPorCategoria,
  rotulosVigencia,
}: CatalogoVitrineProps) {
  const barraRef = useRef<HTMLDivElement>(null);
  const temBarra = categorias.length > 0;

  // D1 — `termo` E o ref do input moram aqui: três dos quatro caminhos de
  // limpar (o "Limpar" do resumo, o CTA do estado vazio e o `Esc`) nascem fora
  // do `BuscaProdutos`. Uma única `limpar` serve aos quatro e é a garantia
  // ESTRUTURAL de que o foco nunca cai no `<body>`.
  const [termo, setTermo] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  // D6 — nenhum id literal: o `aria-describedby` do campo aponta para cá.
  const idRegiaoViva = useId();
  const [anuncio, setAnuncio] = useState("");

  const limpar = useCallback(() => {
    setTermo("");
    inputRef.current?.focus();
  }, []);

  // O gate é `normalizarBusca(termo) !== ""`, NUNCA `termo !== ""`: só espaços
  // ou só acentos ("~~~") normalizam para vazio, e tratá-los como busca
  // esconderia o trilho para mostrar "N produtos encontrados para “ ”".
  const emBusca = normalizarBusca(termo) !== "";
  // D4/D5 — filtragem SÍNCRONA (o spec exige a tela reagindo no frame; o que é
  // debouncado é só o anúncio). Com termo vazio `filtrarCatalogo` devolve a
  // MESMA referência, então `SecaoCatalogo` não re-renderiza por identidade
  // nova fora do modo busca. Estritamente subtrativo: nunca faz aparecer
  // produto ausente do payload do SSR (RN-1).
  const filtradas = useMemo(
    () => filtrarCatalogo(categorias, termo),
    [categorias, termo],
  );
  const total = useMemo(() => contarProdutos(filtradas), [filtradas]);
  const semResultado = emBusca && total === 0;

  // Um anúncio por PARADA de digitação, não um por tecla. Mecânica em módulo
  // neutro (`anunciadorBusca.ts`), aqui só o fio com o React.
  //
  // Sair do modo busca passa pelo MESMO caminho (texto vazio) em vez de um
  // `setAnuncio("")` síncrono no corpo do efeito: além de evitar a cascata de
  // render que o `react-hooks/set-state-in-effect` proíbe, é o comportamento
  // certo — digitar e apagar dentro da janela não anuncia nada, porque o
  // pendente é cancelado antes de disparar.
  useEffect(() => {
    const anunciador = criarAnunciadorBusca({ aoAnunciar: setAnuncio });
    anunciador.anunciar(emBusca ? textoAnuncioBusca(total, termo) : "");
    return anunciador.parar;
  }, [emBusca, total, termo]);

  // Altura medida da barra, em px. NÃO é usada como valor aqui: só desce para
  // `NavCategorias` como GATILHO de reconstrução do observer (o `rootMargin` é
  // congelado no construtor do IntersectionObserver). `aoMedir` só dispara
  // quando a altura MUDA de verdade — montagem, rotação, troca trilho↔resumo
  // (202) — nunca por scroll ou tecla digitada, então não há loop de render.
  const [alturaBarra, setAlturaBarra] = useState(0);

  // Altura REAL da barra, medida antes do paint e republicada a cada resize
  // (rotação, quebra de linha, troca trilho↔resumo da 202). Valor fixo é
  // proibido (RN-6): os 6rem da antiga classe fixa de scroll-margin só não
  // quebravam porque não havia barra. `useLayoutEffect` direto — o aviso de
  // SSR do React não existe mais desde facebook/react#26395 (projeto em
  // react 19).
  //
  // Mecânica extraída para `medicaoBarraVitrine.ts` (módulo neutro, testado em
  // `environment: node` com fakes injetados) — aqui só o fio com o DOM real.
  useLayoutEffect(() => {
    const raiz = document.documentElement;
    const barra = barraRef.current;
    if (!barra) {
      raiz.style.removeProperty(VAR_ALTURA_BARRA);
      return;
    }
    return medirEObservarBarra(barra, {
      raiz,
      ResizeObserverCtor:
        typeof ResizeObserver === "undefined" ? undefined : ResizeObserver,
      aoMedir: setAlturaBarra,
    });
  }, [temBarra]);

  return (
    <>
      {temBarra ? (
        <div
          ref={barraRef}
          className="sticky top-0 z-30 border-b border-borda-nav bg-[var(--cor-fundo)] shadow-[0_2px_8px_rgba(0,0,0,0.06)]"
        >
          <div className={ESCADA_LARGURA_VITRINE}>
            {/* A barra NÃO tem padding vertical próprio: cada slot traz o seu. */}
            <BuscaProdutos
              termo={termo}
              aoMudar={setTermo}
              aoLimpar={limpar}
              inputRef={inputRef}
              idRegiaoViva={idRegiaoViva}
            />
            {/* D2 — em modo busca a nav é DESMONTADA, nunca oculta por CSS: o
                resumo ocupa o lugar do trilho (RN-5). Ocultar manteria o
                IntersectionObserver vivo observando <section> que
                `filtrarCatalogo` tirou do DOM — observer sobre nó órfão não
                dispara, o chip ativo congelaria no valor velho e o scrollspy
                voltaria errado ao limpar. Desmontar roda o cleanup de
                `criarScrollspy` e reconstrói do zero. A nav também some sozinha
                com menos de 3 categorias (RN-4). A troca muda a altura da barra
                e `medirEObservarBarra` republica `--altura-barra`. */}
            {emBusca ? (
              <ResumoBusca total={total} termo={termo} aoLimpar={limpar} />
            ) : (
              <NavCategorias
                categorias={categorias}
                alturaBarra={alturaBarra}
              />
            )}
          </div>
        </div>
      ) : null}

      {/* D3 — região viva ÚNICA e FORA do `barraRef`, irmã da barra (como no
          mockup). Mesmo sendo `sr-only`, mantê-la fora do nó medido elimina
          qualquer chance de o `ResizeObserver` da 201 reagir ao texto
          anunciado. Nunca aninhar uma segunda (4.1.3). */}
      <p
        id={idRegiaoViva}
        className="sr-only"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {anuncio}
      </p>

      {/* `id` + `tabIndex={-1}`: alvo do `destinoFoco` do `ModalPromocoes`
          (234). Sem ser focável, o foco do modal fechado cairia no `<body>`. */}
      <main
        id={ID_MAIN_VITRINE}
        tabIndex={-1}
        className={`${CLASSES_MAIN_VITRINE} focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[var(--cor-primaria)]`}
      >
        {semResultado ? (
          // Nunca tela em branco.
          <EstadoVazioBusca termo={termo} aoLimpar={limpar} />
        ) : (
          <SecaoCatalogo
            categorias={filtradas}
            opcionaisPorCategoria={opcionaisPorCategoria}
            rotulosVigencia={rotulosVigencia}
            termo={termo}
          />
        )}
      </main>
    </>
  );
}
