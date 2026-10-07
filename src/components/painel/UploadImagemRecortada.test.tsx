import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";

import { UploadFotoProduto } from "./UploadFotoProduto";
import { UploadLogoLoja } from "./UploadLogoLoja";
import { CLASSE_DIALOG_TELA_CHEIA } from "@/components/shared/dialogTelaCheia";

/**
 * Markup estático dos uploaders depois da extração da casca
 * (specs/galeria-imagens-loja.md, páginas 3 e 4). Sem jsdom: o clique, o
 * cropper e o seletor aberto ficam para a verificação no navegador. O que dá
 * para provar aqui: as DUAS saídas no estado vazio e no "Substituir", a prévia
 * passando por `fotoSegura`, e que o fluxo mora numa casca só.
 */

const listar = vi.fn(async () => ({ ok: true as const, imagens: [], proximo_cursor: null }));
const enviarParaGaleria = vi.fn(async () => ({ ok: false as const, erro: "stub" }));
const URL_HTTPS = "https://exemplo.supabase.co/storage/v1/object/public/produtos/l/x.webp";

function foto(urlAtual: string | null): string {
  return renderToStaticMarkup(
    <UploadFotoProduto
      urlAtual={urlAtual}
      onUploadConcluido={vi.fn()}
      onEnviar={vi.fn(async () => ({ ok: true as const, foto_url: URL_HTTPS }))}
      onListarGaleria={listar}
      onEnviarParaGaleria={enviarParaGaleria}
    />,
  );
}

function logo(logoUrlInicial: string | null): string {
  return renderToStaticMarkup(
    <UploadLogoLoja
      logoUrlInicial={logoUrlInicial}
      onSalvar={vi.fn(async () => ({ ok: true as const, logo_url: URL_HTTPS }))}
      onRemover={vi.fn(async () => ({ ok: true as const }))}
      onListarGaleria={listar}
      onEnviarParaGaleria={enviarParaGaleria}
    />,
  );
}

describe("UploadFotoProduto / UploadLogoLoja — duas saídas de origem", () => {
  it("estado vazio oferece 'Enviar nova' e 'Escolher da galeria' (foto e logo)", () => {
    for (const html of [foto(null), logo(null)]) {
      expect(html).toContain("Enviar nova");
      expect(html).toContain("Escolher da galeria");
    }
  });

  it("com imagem, o grupo 'Substituir' oferece as mesmas duas saídas", () => {
    const f = foto(URL_HTTPS);
    expect(f).toContain('aria-label="Substituir foto"');
    expect(f).toContain("Enviar nova");
    expect(f).toContain("Escolher da galeria");
    const l = logo(URL_HTTPS);
    expect(l).toContain('aria-label="Substituir logo"');
    expect(l).toContain("Escolher da galeria");
  });

  it("a prévia passa por fotoSegura: URL não-https não vira <img>", () => {
    const html = foto("javascript:alert(1)");
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("<img");
    expect(foto(URL_HTTPS)).toContain("<img");
  });

  it("logo mantém a prévia redonda; foto, retangular", () => {
    expect(logo(URL_HTTPS)).toContain("rounded-full");
    expect(foto(URL_HTTPS)).not.toContain("size-32 rounded-full");
  });

  it("o seletor fechado não renderiza nada (nenhum dialog aberto sobre o form)", () => {
    expect(foto(null)).not.toContain('role="dialog"');
  });
});

describe("extração da casca e do dialog de tela cheia", () => {
  const ler = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");

  it("os wrappers não têm cropper próprio: o fluxo existe UMA vez, na casca", () => {
    for (const rel of [
      "src/components/painel/UploadFotoProduto.tsx",
      "src/components/painel/UploadLogoLoja.tsx",
    ]) {
      const fonte = ler(rel);
      expect(fonte, rel).not.toContain("react-easy-crop");
      expect(fonte, rel).not.toContain("exportarCrop(");
      expect(fonte, rel).toContain("<UploadImagemRecortada");
    }
  });

  it("ProdutoModal e SeletorGaleria consomem a MESMA constante, sem copiar a string", () => {
    const trecho = "rounded-none md:top-1/2";
    expect(CLASSE_DIALOG_TELA_CHEIA).toContain(trecho);
    for (const rel of [
      "src/components/vitrine/ProdutoModal.tsx",
      "src/components/painel/SeletorGaleria.tsx",
    ]) {
      const fonte = ler(rel);
      expect(fonte, rel).toContain("CLASSE_DIALOG_TELA_CHEIA");
      expect(fonte, rel).not.toContain(trecho);
    }
  });
});
