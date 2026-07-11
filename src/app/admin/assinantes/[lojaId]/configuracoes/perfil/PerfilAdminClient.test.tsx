/**
 * Teste de FIAÇÃO do `PerfilAdminClient` — invariante de SEGURANÇA da issue 119
 * (specs/fix-logo-admin-cross-tenant.md §Cenários 2/3). Migrado da
 * antiga suíte da página consolidada de configurações quando ela foi
 * aposentada (154): a cobertura de wiring do logo agora vive co-locada com o
 * wrapper de Perfil que a implementa (152).
 *
 * Prova que o wrapper admin injeta as actions admin de logo
 * (`salvarLogoAdmin`/`removerLogoAdmin`) no `PerfilClient` com o `lojaId` da URL
 * fixado por closure — e que os defaults do LOJISTA
 * (`salvarLogoLoja`/`removerLogoLoja`) NUNCA são referenciados no caminho admin.
 *
 * Por que é invariante de SEGURANÇA: se o `PerfilAdminClient` recair no default
 * do lojista, `salvarLogoLoja` derivaria a loja pelo AUTH do admin
 * (buscarLojaDoDono) e gravaria a logo na loja DO ADMIN, não na loja-alvo —
 * escrita cross-tenant errada e silenciosa. A fiação correta
 * (loja_id = lojaId da URL → action admin) fecha esse vetor.
 *
 * Ambiente: environment=node, sem jsdom/@testing-library (padrão do projeto —
 * ver CuponsAdminClient.test.tsx). Não há clique DOM real; a prova de wiring é
 * feita CAPTURANDO as props que o `PerfilAdminClient` injeta no `PerfilClient`
 * (stub) e INVOCANDO-as, então asserindo qual action foi chamada.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { CAMPO_ARQUIVO } from "@/lib/actions/upload-contrato";

const LOJA_ALVO = "11111111-1111-4111-8111-111111111111";

// Captura das props injetadas no PerfilClient. `vi.hoisted` roda antes dos
// `vi.mock` hoisted, então a referência existe quando o factory do mock executa.
const capturado = vi.hoisted(() => ({
  onSalvarLogo: undefined as ((formData: FormData) => unknown) | undefined,
  onRemoverLogo: undefined as (() => unknown) | undefined,
}));

// --- child client do painel: stub que captura as props e não renderiza árvore real ---
vi.mock(
  "@/app/(painel)/painel/(bloqueavel)/configuracoes/perfil/PerfilClient",
  () => ({
    PerfilClient: (props: {
      onSalvarLogo?: (formData: FormData) => unknown;
      onRemoverLogo?: () => unknown;
    }) => {
      capturado.onSalvarLogo = props.onSalvarLogo;
      capturado.onRemoverLogo = props.onRemoverLogo;
      return null;
    },
  }),
);

// --- actions admin importadas pelo wrapper (todas mockadas) ---
vi.mock("@/app/admin/assinantes/actions/admin-perfil", () => ({
  salvarPerfilAdmin: vi.fn(),
}));
vi.mock("@/app/admin/assinantes/actions/admin-publicar", () => ({
  publicarLojaAdmin: vi.fn(),
}));
vi.mock("@/app/admin/assinantes/actions/admin-logo", () => ({
  salvarLogoAdmin: vi.fn(async () => ({
    ok: true,
    logo_url: "https://storage.local/loja/logo/x.webp",
  })),
  removerLogoAdmin: vi.fn(async () => ({ ok: true })),
}));

// --- defaults do LOJISTA: devem permanecer intocados no caminho admin ---
vi.mock("@/lib/actions/logo", () => ({
  salvarLogoLoja: vi.fn(async () => ({
    ok: true,
    logo_url: "https://storage.local/lojista/logo/y.webp",
  })),
  removerLogoLoja: vi.fn(async () => ({ ok: true })),
}));

import { PerfilAdminClient } from "./PerfilAdminClient";
import {
  salvarLogoAdmin,
  removerLogoAdmin,
} from "@/app/admin/assinantes/actions/admin-logo";
import { salvarLogoLoja, removerLogoLoja } from "@/lib/actions/logo";

function renderizar(lojaId = LOJA_ALVO) {
  // Como o `PerfilClient` é stub, os dados de perfil são irrelevantes ao wiring —
  // só o `lojaId` importa (é a autoridade de escopo por closure).
  renderToStaticMarkup(
    <PerfilAdminClient
      lojaId={lojaId}
      inicial={{} as never}
      publicado={false}
      podePublicar
      logoUrlInicial={null}
    />,
  );
}

describe("PerfilAdminClient — fiação das actions admin de logo (issue 119, migrado em 154)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturado.onSalvarLogo = undefined;
    capturado.onRemoverLogo = undefined;
  });

  it("injeta onSalvarLogo/onRemoverLogo no PerfilClient (props definidas)", () => {
    renderizar();
    expect(capturado.onSalvarLogo).toBeTypeOf("function");
    expect(capturado.onRemoverLogo).toBeTypeOf("function");
  });

  it("onSalvarLogo(fd) fixa loja_id=lojaId da URL e chama salvarLogoAdmin — nunca salvarLogoLoja", async () => {
    renderizar();
    expect(capturado.onSalvarLogo).toBeTypeOf("function");

    // UploadLogoLoja JÁ monta o FormData com o arquivo em CAMPO_ARQUIVO; o
    // adapter só injeta loja_id e encaminha.
    const fd = new FormData();
    fd.set(CAMPO_ARQUIVO, new Blob(["x"], { type: "image/webp" }), "logo.webp");

    await capturado.onSalvarLogo!(fd);

    expect(salvarLogoAdmin).toHaveBeenCalledTimes(1);
    const fdRecebido = vi.mocked(salvarLogoAdmin).mock.calls[0][0];
    expect(fdRecebido.get("loja_id")).toBe(LOJA_ALVO);

    // vetor cross-tenant fechado: default do lojista NUNCA é chamado.
    expect(salvarLogoLoja).not.toHaveBeenCalled();
  });

  it("onRemoverLogo() chama removerLogoAdmin(lojaId) — nunca removerLogoLoja", async () => {
    renderizar();
    expect(capturado.onRemoverLogo).toBeTypeOf("function");

    await capturado.onRemoverLogo!();

    expect(removerLogoAdmin).toHaveBeenCalledTimes(1);
    expect(removerLogoAdmin).toHaveBeenCalledWith(LOJA_ALVO);
    expect(removerLogoLoja).not.toHaveBeenCalled();
  });

  it("loja_id vem da closure/URL: adapter SOBRESCREVE qualquer loja_id pré-existente no FormData", async () => {
    renderizar();
    expect(capturado.onSalvarLogo).toBeTypeOf("function");

    // Cliente hostil/estado sujo: FormData chega com loja_id de OUTRA loja.
    const OUTRA_LOJA = "99999999-9999-4999-8999-999999999999";
    const fd = new FormData();
    fd.set("loja_id", OUTRA_LOJA);
    fd.set(CAMPO_ARQUIVO, new Blob(["x"], { type: "image/webp" }), "logo.webp");

    await capturado.onSalvarLogo!(fd);

    const fdRecebido = vi.mocked(salvarLogoAdmin).mock.calls[0][0];
    // O client nunca é autoridade do escopo: o loja_id da URL prevalece.
    expect(fdRecebido.get("loja_id")).toBe(LOJA_ALVO);
    expect(fdRecebido.get("loja_id")).not.toBe(OUTRA_LOJA);
  });
});
