import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";

import { CatalogoVitrine } from "@/components/vitrine/CatalogoVitrine";
import { HeaderLoja } from "@/components/vitrine/HeaderLoja";
import {
  CLASSES_MAIN_VITRINE,
  ID_MAIN_VITRINE,
} from "@/components/vitrine/layoutVitrine";
// `import type` explícito: é TIPO, apagado na compilação. Importar um VALOR de
// um módulo 'use client' aqui viraria referência de cliente (issue 201, D1).
import type { CategoriaComProdutos } from "@/components/vitrine/SecaoCatalogo";
import { VitrineClient } from "@/components/vitrine/VitrineClient";
import { createClient } from "@/lib/supabase/server";
import { buscarCardapiosComProdutos } from "@/lib/supabase/queries/cardapios";
import { buscarCategorias } from "@/lib/supabase/queries/categorias";
import { buscarLojaPorSlug, type LojaPublica } from "@/lib/supabase/queries/lojas";
import {
  agruparCatalogo,
  buscarOpcionaisPorCategoria,
  buscarProdutosPublicos,
} from "@/lib/supabase/queries/produtos";
import { projetarCatalogoVitrine } from "@/lib/utils/catalogoVitrine";
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
  const [categorias, produtos, { cardapiosPorProduto }] = await Promise.all([
    buscarCategorias(db, lojaId),
    buscarProdutosPublicos(db, lojaId),
    buscarCardapiosComProdutos(db, lojaId),
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
  const agora = new Date();
  const { produtos: produtosVitrine } = projetarCatalogoVitrine({
    produtos,
    cardapiosPorProduto,
    agora,
    timezone: timezoneLoja,
  });
  const grupos = agruparCatalogo(produtosVitrine, categorias);

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

  const categoriasComProdutos: CategoriaComProdutos[] = grupos.map((grupo) => ({
    id: grupo.id,
    nome: grupo.nome,
    // exibir_imagens decide grid (true) vs. lista textual (false) na vitrine.
    // Grupo "Outros" (categoria null) cai em true → grid (RN-5).
    exibir_imagens: grupo.categoria?.exibir_imagens ?? true,
    // O `ProdutoVitrine` INTEIRO desce às superfícies (225) — sem remontar campo
    // a campo, que era onde comprabilidade e preço efetivo caíam no chão (D13).
    produtos: grupo.produtos.map((p) => ({
      ...p,
      // RN-3 (issue 201) — NÃO é adaptador: em categoria "ocultar", a foto não
      // trafega ao cliente. Zerada aqui no SSR, não só escondida no render (o
      // payload RSC não carrega a URL).
      foto_url: grupo.categoria?.exibir_imagens === false ? null : p.foto_url,
    })),
  }));

  // RN-15: "pratos promocionais" é DERIVADO do catálogo que a página já
  // carregou — zero query nova, zero tabela nova. Filtra sobre
  // `categoriasComProdutos`, e não sobre `produtosVitrine`, porque é ali que a
  // RN-3 já zerou a `foto_url` de categoria com `exibir_imagens = false`: o
  // modal (234) mostra foto, e a lista crua faria a URL que o catálogo esconde
  // trafegar ao cliente por outra porta.
  const promocionais = categoriasComProdutos
    .flatMap((c) => c.produtos)
    .filter((p) => p.temDesconto);

  // "Hoje" da LOJA (RN-16), no servidor: o cliente que vira a meia-noite no
  // próprio fuso não reabre o modal de uma loja onde ainda é o mesmo dia.
  const diaDeHojeNaLoja = diaNoFuso(agora, timezoneLoja);

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
          />
        )}

        <VitrineClient
          lojaSlug={slug}
          lojaId={lojaId}
          promocoes={promocionais}
          modalPromocoes={loja.modal_promocoes ?? true}
          diaDeHojeNaLoja={diaDeHojeNaLoja}
        />
      </div>
    </>
  );
}
