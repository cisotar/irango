import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";

import { CatalogoVitrine } from "@/components/vitrine/CatalogoVitrine";
import { HeaderLoja } from "@/components/vitrine/HeaderLoja";
import {
  CLASSES_MAIN_VITRINE,
  ID_MAIN_VITRINE,
} from "@/components/vitrine/layoutVitrine";

import { VitrineClient } from "@/components/vitrine/VitrineClient";
import { createClient } from "@/lib/supabase/server";
import { buscarCardapiosComProdutos } from "@/lib/supabase/queries/cardapios";
import { buscarCategorias } from "@/lib/supabase/queries/categorias";
import { buscarLojaPorSlug, type LojaPublica } from "@/lib/supabase/queries/lojas";
import { buscarModalSazonalAtivo } from "@/lib/supabase/queries/modaisSazonais";
import {
  agruparCatalogo,
  buscarOpcionaisPorCategoria,
  buscarProdutosPublicos,
} from "@/lib/supabase/queries/produtos";
import {
  agruparPorCardapio,
  derivarProdutosDoModalSazonal,
  derivarPromocionaisParaModal,
  projetarCatalogoVitrine,
  type SecaoVitrine,
} from "@/lib/utils/catalogoVitrine";
import { dentroDaJanelaExibicao } from "@/lib/utils/janelaModalSazonal";
import { rotuloJanelaDestaque } from "@/lib/utils/descreverVigencia";
import { schemaTema } from "@/lib/validacoes/loja";
import { THEME_PADRAO, FUNDO_PADRAO, DESTAQUE_PADRAO } from "@/lib/utils/manifest";
import { diaNoFuso } from "@/lib/utils/fusoLoja";
import type { Horarios } from "@/lib/utils/lojaAberta";
import {
  assinaturaPermiteAcesso,
  type StatusAssinatura,
} from "@/lib/utils/assinatura";

type PageProps = { params: Promise<{ slug: string }> };

/**
 * Dedup por REQUEST (`cache()` do React), não entre requests: `generateMetadata`,
 * `generateViewport` e o render da página leem a MESMA linha de `vitrine_lojas`.
 * A chave é só o `slug` — `createClient()` devolve um objeto novo a cada chamada,
 * então passar o client como argumento daria cache miss em todas (issue 207).
 * `createClient()` não faz I/O de rede (só lê cookies), criá-lo aqui dentro é barato.
 * NÃO é ISR/`revalidate`/`'use cache'`: a vitrine carrega dado vivo (`disponivel`
 * e o gate de assinatura), que não pode ser cacheado entre requisições.
 */
const carregarLoja = cache(async (slug: string) => {
  const db = await createClient();
  return buscarLojaPorSlug(db, slug);
});

type Tema = { primaria: string; fundo: string; destaque: string };

const TEMA_PADRAO: Tema = {
  primaria: THEME_PADRAO,
  fundo: FUNDO_PADRAO,
  destaque: DESTAQUE_PADRAO,
};

/**
 * Extrai o tema da loja validando com o mesmo schema da Server Action de config
 * (`#RRGGBB`). Tema ausente/malformado → defaults. Os valores já são validados
 * na escrita, então a injeção SSR via `<style>` não tem risco de injeção.
 */
function resolverTema(tema: LojaPublica["tema"]): Tema {
  const parsed = schemaTema.safeParse(tema);
  return parsed.success ? parsed.data : TEMA_PADRAO;
}

/** Horários do JSONB → shape esperado por HeaderLoja/useLojaAberta (fail-safe). */
function resolverHorarios(horarios: LojaPublica["horarios"]): Horarios {
  return (horarios ?? {}) as Horarios;
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { slug } = await params;
  try {
    const loja = await carregarLoja(slug);
    // Loja inexistente/inativa: só title, SEM manifest (não há app instalável
    // de loja que não existe). `apple-touch-icon` é genérico, fica.
    if (!loja || !loja.nome) {
      return {
        title: "Loja não encontrada — iRango",
        icons: { apple: "/icons/apple-touch-icon.png" },
      };
    }
    return {
      title: `${loja.nome} — iRango`,
      description: `Faça seu pedido na ${loja.nome}.`,
      manifest: `/loja/${slug}/manifest.webmanifest`,
      icons: { apple: "/icons/apple-touch-icon.png" },
    };
  } catch (e) {
    // Falha de banco/rede: degrada para metadata mínimo, nunca vaza detalhe
    // ao cliente (seguranca.md §14). Sem manifest fantasma.
    console.error("[metadataVitrine]", e);
    return { title: "iRango" };
  }
}

export async function generateViewport({
  params,
}: PageProps): Promise<Viewport> {
  const { slug } = await params;
  try {
    const loja = await carregarLoja(slug);
    const parsed = schemaTema.safeParse(loja?.tema);
    return { themeColor: parsed.success ? parsed.data.primaria : THEME_PADRAO };
  } catch (e) {
    console.error("[viewportVitrine]", e);
    return { themeColor: THEME_PADRAO };
  }
}

export default async function VitrinePage({ params }: PageProps) {
  const { slug } = await params;
  const db = await createClient();

  // Vitrine pública (role anon): a view `vitrine_lojas` já filtra `ativo = true`.
  const loja = await carregarLoja(slug);
  if (!loja || !loja.id || !loja.nome) notFound();

  // Fuso da LOJA — nunca o do browser: é ele que decide horário de
  // funcionamento (222), "hoje" do modal (RN-16) e a janela do cardápio (246).
  const timezoneLoja = loja.timezone ?? "America/Sao_Paulo";

  // Gate de assinatura (RN-A7) — SEMPRE server-side, mesma fonte de verdade do
  // guard do painel e do `criarPedido` (issue 056). Loja com assinatura inválida
  // (suspensa ou fora da carência) renderiza "temporariamente indisponível",
  // sem catálogo/carrinho/botão de pedido. NÃO usa `notFound()` — preserva
  // slug/SEO (decisão da issue 058).
  const assinaturaOk = assinaturaPermiteAcesso(
    (loja.assinatura_status ?? "suspensa") as StatusAssinatura,
    new Date(loja.assinatura_fim_periodo ?? 0),
    new Date(),
  );
  if (!assinaturaOk) {
    return (
      <div className="min-h-screen bg-[var(--cor-fundo)]">
        <HeaderLoja
          nome={loja.nome}
          logoUrl={loja.logo_url ?? undefined}
          horarios={resolverHorarios(loja.horarios)}
          timezone={timezoneLoja}
          whatsapp={loja.whatsapp}
        />
        <main className={CLASSES_MAIN_VITRINE}>
          <div className="flex flex-col items-center gap-3 py-20 text-center">
            <span aria-hidden className="text-4xl">
              🔒
            </span>
            <p className="font-medium text-texto">
              Loja temporariamente indisponível
            </p>
            <p className="text-sm text-texto-muted">
              Esta loja está temporariamente indisponível. Volte em breve.
            </p>
          </div>
        </main>
      </div>
    );
  }

  const lojaId = loja.id;

  // Categorias e produtos só dependem de `lojaId` — buscados em paralelo, e o
  // agrupamento (em memória) acontece depois (issue 207, F4). Ambos DEPOIS do
  // gate de assinatura: loja inválida não dispara query de catálogo.
  // 265: `buscarProdutosPublicos` lê a view definer `public.vitrine_produtos`,
  // que já projeta as colunas públicas e mascara desconto não-vigente (RN-03) —
  // a tabela base não é mais legível por anon/authenticated.
  // 247: a 5ª query entra na MESMA onda — `cardapios` ⋈ `cardapio_produtos` num
  // round trip só, sem custo de latência de parede.
  // [303] O modal sazonal ATIVO entra na MESMA onda: a query filtra `ativo` e
  // escopa por `loja_id`, mas a JANELA de exibição NÃO é avaliada em SQL (RN-02)
  // — é decidida abaixo pela função pura, no instante do request. Sob role anon
  // a RLS `modais_sazonais_leitura_publica` só revela o ativo de loja ativa.
  const [categorias, produtos, { vinculosPorProduto }, modalSazonalAtivo] =
    await Promise.all([
      buscarCategorias(db, lojaId),
      buscarProdutosPublicos(db, lojaId),
      buscarCardapiosComProdutos(db, lojaId),
      buscarModalSazonalAtivo(db, lojaId),
    ]);
  // Contrato de catálogo (224): UM objeto por produto, produzido no servidor e
  // fonte única de preço/selo/comprabilidade. `agora` injetado — a vigência da
  // promoção é avaliada por request, e é por isso que esta página NÃO pode ser
  // cacheada (ver o bloco de `carregarLoja`): catálogo cacheado serve promoção
  // expirada.
  //
  // 247: a ordem é PROJETAR → AGRUPAR, invertida de propósito. O produto fora
  // de temporada (RN-13) some dentro de `projetarCatalogoVitrine`, enquanto a
  // lista ainda é uma lista — e a regra "grupo sem produto visível não é
  // devolvido" (issue 177, dentro de `agruparCatalogo`) passa a cobrir a
  // categoria esvaziada pela temporada de graça, sem código de agrupamento novo.
  //
  // 248/RN-06: o zeramento de `foto_url` em categoria "ocultar" entra AQUI, na
  // projeção, e não mais por grupo depois do agrupamento. A URL escondida vira
  // PROPRIEDADE DO PRODUTO: ele viaja com um `foto_url` só para onde for
  // (categoria, lista de promocionais, seção de destaque da 263), e nenhuma
  // superfície nova pode reintroduzir o vazamento que a issue 201 fechou.
  const agora = new Date();
  const exibirImagensPorCategoria = new Map(
    categorias.map((c) => [c.id, c.exibir_imagens !== false]),
  );
  const {
    produtos: produtosVitrine,
    rotulosVigencia,
    cardapiosAbertos,
  } = projetarCatalogoVitrine({
    produtos,
    vinculosPorProduto,
    agora,
    timezone: timezoneLoja,
    exibirImagensPorCategoria,
  });
  const grupos = agruparCatalogo(produtosVitrine, categorias);

  // [263/D16/RN-15] As seções de DESTAQUE saem da MESMA lista projetada que as
  // categorias — é isso que faz os dois cards do mesmo produto carregarem a
  // MESMA referência de objeto e, portanto, dizerem sempre a mesma coisa.
  // A janela do CARDÁPIO não é reavaliada aqui: `cardapiosAbertos` já veio
  // decidido uma vez por request, e `agruparPorCardapio` (248) já ordena e já
  // descarta seção vazia. Cardápio que fecha ⇒ a seção some sozinha, sem
  // ninguém publicar nada — e, desde [279], o mesmo vale para o cardápio cujo
  // nenhum item é do dia de hoje.
  // [279/RN-05] `agora` e o fuso da LOJA entram porque a seção lista só os
  // ITENS DO DIA: o cardápio aberto cujo nenhum item é de hoje não vira seção.
  const secoesDestaque = agruparPorCardapio(
    produtosVitrine,
    cardapiosAbertos,
    vinculosPorProduto,
    agora,
    timezoneLoja,
  );
  // O rótulo de janela do cabeçalho (design §13.1 item 3), redigido pelo mesmo
  // módulo das outras três frases de vigência (M6) — no fuso da LOJA.
  const rotulosJanela: Record<string, string> = Object.fromEntries(
    cardapiosAbertos.map((c) => [
      c.id,
      rotuloJanelaDestaque(c, agora, timezoneLoja),
    ]),
  );

  // Opcionais (issue 087): SSR sob role anon — a RLS pública (080) só revela
  // opcionais ativos de loja ativa. Buscados pelas categorias do catálogo.
  // NUNCA buscado no client. Preços aqui são PREVIEW (servidor recalcula — §10).
  const categoriaIds = grupos
    .map((g) => g.id)
    .filter((id): id is string => id !== null);
  const opcionaisPorCategoria = await buscarOpcionaisPorCategoria(
    db,
    categoriaIds,
  );

  const tema = resolverTema(loja.tema);

  // [263] `SecaoVitrine`, não mais `CategoriaComProdutos`: um campo a mais
  // (`tipo`), que é o que permite ao despachante `ancoraSecao` pedir a âncora
  // certa sem que ninguém precise adivinhar a espécie da seção.
  const categoriasComProdutos: SecaoVitrine[] = grupos.map((grupo) => ({
    id: grupo.id,
    nome: grupo.nome,
    tipo: "categoria",
    // exibir_imagens decide grid (true) vs. lista textual (false) na vitrine.
    // Grupo "Outros" (categoria null) cai em true → grid (RN-5).
    exibir_imagens: grupo.categoria?.exibir_imagens ?? true,
    // O `ProdutoVitrine` INTEIRO desce às superfícies (225) — sem remontar campo
    // a campo, que era onde comprabilidade e preço efetivo caíam no chão (D13).
    // 248: a MESMA referência que saiu da projeção, sem cópia e sem remendo de
    // `foto_url` — a URL de categoria "ocultar" já veio `null` de lá.
    produtos: grupo.produtos,
  }));

  // RN-15: "pratos promocionais" é DERIVADO do catálogo que a página já
  // carregou — zero query nova, zero tabela nova.
  //
  // 248: a passagem por `categoriasComProdutos` deixou de ser a GUARDA da RN-3
  // (a `foto_url` de categoria "ocultar" já está `null` no PRODUTO, dentro da
  // projeção) e passou a ser só a ordem de exibição do modal — agrupada por
  // categoria, como o cliente vê o cardápio. A URL escondida não volta por
  // aqui nem por nenhuma superfície futura.
  //
  // [289/RN-9] E já ENRIQUECIDOS para o detalhe: o modal de promoções abre o
  // `ProdutoModal` do prato tocado, então opcionais e frase de vigência saem
  // daqui prontos, pelos mapas que esta página já tem em escopo. Nada é
  // buscado no caminho do modal, e as referências são as MESMAS que já descem
  // pelo ramo do catálogo — o Flight serializa uma vez.
  const promocionais = derivarPromocionaisParaModal(
    categoriasComProdutos,
    opcionaisPorCategoria,
    rotulosVigencia,
  );

  // "Hoje" da LOJA (RN-16/RN-07), no servidor: o cliente que vira a meia-noite
  // no próprio fuso não reabre o modal de uma loja onde ainda é o mesmo dia.
  const diaDeHojeNaLoja = diaNoFuso(agora, timezoneLoja);

  // [303] MODAL SAZONAL — existência, janela e produtos resolvidos no SSR, no
  // fuso da loja. O cliente nunca avalia janela nem existência (RN-02/RN-04).
  //
  // O modal só desce se estiver ATIVO (a query já filtrou), DENTRO DA JANELA de
  // exibição (RN-02, instante × instante) E tiver ao menos um produto curado
  // depois da derivação (categoria vazia + cardápio fora de vigência ⇒ nada a
  // mostrar). A derivação é ZERO query nova (RN-10): filtra sobre as seções que
  // a página já projetou.
  const modalSazonalNaJanela =
    modalSazonalAtivo !== null &&
    dentroDaJanelaExibicao(modalSazonalAtivo, agora)
      ? modalSazonalAtivo
      : null;

  const produtosDoModalSazonal = modalSazonalNaJanela
    ? derivarProdutosDoModalSazonal(
        categoriasComProdutos,
        secoesDestaque,
        opcionaisPorCategoria,
        rotulosVigencia,
        {
          categorias: modalSazonalNaJanela.categorias,
          cardapios: modalSazonalNaJanela.cardapios,
        },
      )
    : [];

  // O modal sazonal só EXISTE para o cliente se, resolvida a janela E a
  // curadoria, sobrou algo a mostrar. Título vem do lojista, renderizado como
  // texto (RN-01) no componente.
  const modalSazonal =
    modalSazonalNaJanela !== null && produtosDoModalSazonal.length > 0
      ? { titulo: modalSazonalNaJanela.titulo, produtos: produtosDoModalSazonal }
      : null;

  // [303/RN-09] PRECEDÊNCIA decidida no SERVIDOR: com um sazonal no ar cujo
  // lojista NÃO ligou "mostrar promoções junto", o `ModalPromocoes` é suprimido.
  // Desce PRONTA — o cliente nunca resolve qual modal abre. Sem sazonal no ar,
  // `false`: o `ModalPromocoes` segue como hoje.
  const suprimirPromocoes =
    modalSazonalNaJanela !== null &&
    !modalSazonalNaJanela.mostrar_promocoes_junto;

  // Grupo sem produto visível já não vem de `agruparCatalogo` (issue 177),
  // então lista vazia = loja sem nada a mostrar.
  const temVazio = categoriasComProdutos.length === 0;

  return (
    <>
      {/* Tema da loja injetado via CSS custom properties no SSR (design-system §4).
          Valores validados como #RRGGBB na escrita — sem risco de injeção. */}
      <style>{`:root{--cor-primaria:${tema.primaria};--cor-fundo:${tema.fundo};--cor-destaque:${tema.destaque};}`}</style>

      <div className="min-h-screen bg-[var(--cor-fundo)]">
        <HeaderLoja
          nome={loja.nome}
          logoUrl={loja.logo_url ?? undefined}
          horarios={resolverHorarios(loja.horarios)}
          timezone={timezoneLoja}
          whatsapp={loja.whatsapp}
        />

        {/* Catálogo vazio (RN-4): sem barra e sem wrapper client — o `<main>`
            fica aqui. Com catálogo, `CatalogoVitrine` é o dono do `<main>` e da
            barra sticky, que precisa correr de ponta a ponta da viewport (fora
            do `px-4`/escada do main) — issue 201, D5. Exatamente UM `<main>`
            por render em cada ramo. */}
        {temVazio ? (
          <main id={ID_MAIN_VITRINE} tabIndex={-1} className={CLASSES_MAIN_VITRINE}>
            <div className="flex flex-col items-center gap-3 py-20 text-center">
              <span aria-hidden className="text-4xl">
                📦
              </span>
              <p className="font-medium text-texto">
                Esta loja ainda não tem produtos.
              </p>
              <p className="text-sm text-texto-muted">
                Volte em breve para fazer seu pedido.
              </p>
            </div>
          </main>
        ) : (
          <CatalogoVitrine
            categorias={categoriasComProdutos}
            opcionaisPorCategoria={opcionaisPorCategoria}
            // [262/RN-06] O mapa desce junto com os produtos, do MESMO retorno:
            // é o que garante que nenhum produto marcado chegue à tela sem a
            // frase que diz quando ele volta.
            rotulosVigencia={rotulosVigencia}
            // [263/RN-16] Lista SEPARADA: `filtrarCatalogo` e `contarProdutos`
            // nunca a recebem, então a busca não pode duplicar card nem o
            // `ResumoBusca` passar a mentir. Não é filtro — é ausência.
            secoesDestaque={secoesDestaque}
            rotulosJanela={rotulosJanela}
          />
        )}

        <VitrineClient
          lojaSlug={slug}
          lojaId={lojaId}
          promocoes={promocionais}
          modalPromocoes={loja.modal_promocoes ?? true}
          diaDeHojeNaLoja={diaDeHojeNaLoja}
          // [303] Repasse puro: título + produtos curados (ou `null`) e a
          // decisão de supressão, ambos já resolvidos no SSR (RN-09).
          modalSazonal={modalSazonal}
          suprimirPromocoes={suprimirPromocoes}
        />
      </div>
    </>
  );
}
