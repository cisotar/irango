import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";

import { HeaderLoja } from "@/components/vitrine/HeaderLoja";
import {
  SecaoCatalogo,
  type CategoriaComProdutos,
} from "@/components/vitrine/SecaoCatalogo";
import { VitrineClient } from "@/components/vitrine/VitrineClient";
import { createClient } from "@/lib/supabase/server";
import { buscarCategorias } from "@/lib/supabase/queries/categorias";
import { buscarLojaPorSlug, type LojaPublica } from "@/lib/supabase/queries/lojas";
import {
  buscarCatalogoPublico,
  buscarOpcionaisPorCategoria,
} from "@/lib/supabase/queries/produtos";
import { schemaTema } from "@/lib/validacoes/loja";
import { THEME_PADRAO, FUNDO_PADRAO, DESTAQUE_PADRAO } from "@/lib/utils/manifest";
import type { Horarios } from "@/lib/utils/lojaAberta";
import {
  assinaturaPermiteAcesso,
  type StatusAssinatura,
} from "@/lib/utils/assinatura";

type PageProps = { params: Promise<{ slug: string }> };

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
    const db = await createClient();
    const loja = await buscarLojaPorSlug(db, slug);
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
    const db = await createClient();
    const loja = await buscarLojaPorSlug(db, slug);
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
  const loja = await buscarLojaPorSlug(db, slug);
  if (!loja || !loja.id || !loja.nome) notFound();

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
          timezone={loja.timezone ?? "America/Sao_Paulo"}
          whatsapp={loja.whatsapp}
        />
        <main className="mx-auto w-full max-w-3xl px-4 py-6 pb-28 md:max-w-5xl lg:max-w-6xl xl:max-w-7xl">
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

  const categorias = await buscarCategorias(db, lojaId);
  const grupos = await buscarCatalogoPublico(db, lojaId, categorias);

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
    produtos: grupo.produtos.map((p) => ({
      id: p.id,
      nome: p.nome,
      descricao: p.descricao,
      preco: p.preco,
      foto_url: p.foto_url,
      categoria_id: p.categoria_id,
      disponivel: p.disponivel,
    })),
  }));

  const temVazio = categoriasComProdutos.every((c) => c.produtos.length === 0);

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
          timezone={loja.timezone ?? "America/Sao_Paulo"}
          whatsapp={loja.whatsapp}
        />

        <main className="mx-auto w-full max-w-3xl px-4 py-6 pb-28 md:max-w-5xl lg:max-w-6xl xl:max-w-7xl">
          {temVazio ? (
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
          ) : (
            <SecaoCatalogo
              categorias={categoriasComProdutos}
              opcionaisPorCategoria={opcionaisPorCategoria}
            />
          )}
        </main>

        <VitrineClient lojaSlug={slug} />
      </div>
    </>
  );
}
