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
  // Issue 124: a fiação de `onSalvar` é a MESMA classe de vetor do bug de logo
  // da 119 — se a prop sumir, `PerfilClient` cai no default do LOJISTA.
  onSalvar: undefined as ((payload: unknown) => unknown) | undefined,
  // Galeria (specs/galeria-imagens-loja.md, página 4): sem a injeção admin, o
  // seletor da logo listaria/gravaria na galeria do ADMIN logado.
  onListarGaleria: undefined as ((cursor?: unknown) => unknown) | undefined,
  onEnviarParaGaleria: undefined as ((formData: FormData) => unknown) | undefined,
  // Issue 368: todas as props, para o slot `topo` e para renderizar o
  // PerfilClient REAL com a mesma fiação (markup dos `required`).
  props: undefined as Record<string, unknown> | undefined,
}));

// Issue 368 (DD6): `CartaoPublicacao` (novo, GREEN cria) — identidade estável
// para reconhecer o elemento no slot `topo` sem renderizá-lo.
const cartao = vi.hoisted(() => ({
  CartaoPublicacao: (_p: Record<string, unknown>) => null,
}));
vi.mock("@/components/painel/CartaoPublicacao", () => ({
  CartaoPublicacao: cartao.CartaoPublicacao,
  default: cartao.CartaoPublicacao,
}));
// Para o PerfilClient REAL (caso dos `required`): sem App Router nem cropper.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/components/painel/UploadLogoLoja", () => ({ UploadLogoLoja: () => null }));

// --- child client do painel: stub que captura as props e não renderiza árvore real ---
vi.mock(
  "@/app/(painel)/painel/(bloqueavel)/configuracoes/perfil/PerfilClient",
  () => ({
    PerfilClient: (props: {
      onSalvarLogo?: (formData: FormData) => unknown;
      onRemoverLogo?: () => unknown;
      onSalvar?: (payload: unknown) => unknown;
      onListarGaleria?: (cursor?: unknown) => unknown;
      onEnviarParaGaleria?: (formData: FormData) => unknown;
    }) => {
      capturado.onListarGaleria = props.onListarGaleria;
      capturado.onEnviarParaGaleria = props.onEnviarParaGaleria;
      capturado.onSalvarLogo = props.onSalvarLogo;
      capturado.onRemoverLogo = props.onRemoverLogo;
      capturado.onSalvar = props.onSalvar;
      capturado.props = props as Record<string, unknown>;
      return null;
    },
  }),
);

// --- actions admin importadas pelo wrapper (todas mockadas) ---
vi.mock("@/app/admin/assinantes/actions/admin-perfil", () => ({
  salvarPerfilAdmin: vi.fn(async () => ({ ok: true, geocodificado: false })),
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
vi.mock("@/app/admin/assinantes/actions/admin-galeria", () => ({
  listarImagensGaleriaAdmin: vi.fn(async () => ({ ok: true, imagens: [], proximo_cursor: null })),
  enviarImagemGaleriaAdmin: vi.fn(async () => ({ ok: false, erro: "stub" })),
}));
// Galeria do LOJISTA: resolve a loja pelo auth — nunca no caminho admin.
vi.mock("@/lib/actions/galeria", () => ({
  listarImagensGaleria: vi.fn(async () => ({ ok: true, imagens: [], proximo_cursor: null })),
  enviarImagemGaleria: vi.fn(async () => ({ ok: false, erro: "stub" })),
}));

// --- defaults do LOJISTA: devem permanecer intocados no caminho admin ---
// `salvarPerfil`/`definirPublicacao` derivam a loja pelo AUTH (buscarLojaDoDono):
// se o wrapper admin não injetar `onSalvar`, o perfil da loja DO ADMIN é que
// seria gravado. Mockados aqui para poder asserir que NUNCA são chamados.
vi.mock("@/lib/actions/loja", () => ({
  salvarPerfil: vi.fn(async () => ({ ok: true, geocodificado: false })),
  definirPublicacao: vi.fn(async () => ({ ok: true })),
}));
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
import {
  enviarImagemGaleriaAdmin,
  listarImagensGaleriaAdmin,
} from "@/app/admin/assinantes/actions/admin-galeria";
import { enviarImagemGaleria, listarImagensGaleria } from "@/lib/actions/galeria";
import { salvarPerfilAdmin } from "@/app/admin/assinantes/actions/admin-perfil";
import { salvarPerfil, definirPublicacao } from "@/lib/actions/loja";
import { publicarLojaAdmin } from "@/app/admin/assinantes/actions/admin-publicar";

function renderizar(lojaId = LOJA_ALVO) {
  // Como o `PerfilClient` é stub, os dados de perfil são irrelevantes ao wiring —
  // só o `lojaId` importa (é a autoridade de escopo por closure).
  renderToStaticMarkup(
    <PerfilAdminClient
      lojaId={lojaId}
      inicial={{} as never}
      publicado={false}
      bloqueio={null}
      logoUrlInicial={null}
    />,
  );
}

describe("PerfilAdminClient — fiação da galeria admin no seletor da logo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturado.onListarGaleria = undefined;
    capturado.onEnviarParaGaleria = undefined;
  });

  it("onListarGaleria(cursor) chama listarImagensGaleriaAdmin(lojaId, cursor) — nunca a do lojista", async () => {
    renderizar();
    expect(capturado.onListarGaleria).toBeTypeOf("function");
    const cursor = { criado_em: "2026-10-01T00:00:00.000Z", id: "22222222-2222-4222-8222-222222222222" };

    await capturado.onListarGaleria!(cursor);

    expect(listarImagensGaleriaAdmin).toHaveBeenCalledWith(LOJA_ALVO, cursor);
    expect(listarImagensGaleria).not.toHaveBeenCalled();
  });

  it("onEnviarParaGaleria(fd) SOBRESCREVE loja_id com o da URL e chama enviarImagemGaleriaAdmin — nunca a do lojista", async () => {
    renderizar();
    expect(capturado.onEnviarParaGaleria).toBeTypeOf("function");
    const fd = new FormData();
    fd.set("loja_id", "99999999-9999-4999-8999-999999999999");
    fd.set(CAMPO_ARQUIVO, new Blob(["x"], { type: "image/webp" }), "original.webp");

    await capturado.onEnviarParaGaleria!(fd);

    expect(enviarImagemGaleriaAdmin).toHaveBeenCalledTimes(1);
    const recebido = vi.mocked(enviarImagemGaleriaAdmin).mock.calls[0][0];
    expect(recebido.getAll("loja_id")).toEqual([LOJA_ALVO]);
    expect(enviarImagemGaleria).not.toHaveBeenCalled();
  });
});

describe("PerfilAdminClient — fiação das actions admin de logo (issue 119, migrado em 154)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturado.onSalvarLogo = undefined;
    capturado.onRemoverLogo = undefined;
    capturado.onSalvar = undefined;
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

// ─────────────────────────────────────────────────────────────────────────────
// Issue 124 — fiação de `onSalvar`. Lacuna real: o arquivo cobria só a logo.
// `PerfilClient` tem `onSalvar = salvarPerfilLojista` como DEFAULT de prop; um
// wrapper admin que esqueça de injetar a variante admin não quebra o build nem
// a UI — grava silenciosamente no perfil da loja DO ADMIN. Mesma forma do bug
// da 119, agora sobre o perfil (e sobre `whatsapp_envio_automatico`).
const PAYLOAD_MIN = {
  nome: "Pizzaria Alvo",
  slug: "pizzaria-alvo",
  whatsapp: "5511999998888",
  // Issue 368 (D12): perfil válido leva o endereço completo.
  endereco_cep: "01310-100",
  endereco_rua: "Avenida Paulista",
  endereco_numero: "1000",
  endereco_bairro: "Bela Vista",
  endereco_cidade: "São Paulo",
  endereco_estado: "SP",
};
const LOJA_HOSTIL = "99999999-9999-4999-8999-999999999999";

describe("PerfilAdminClient — fiação de onSalvar (issue 124)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturado.onSalvar = undefined;
  });

  it("C3.1 — injeta onSalvar no PerfilClient (prop definida, não cai no default do lojista)", () => {
    renderizar();
    expect(capturado.onSalvar).toBeTypeOf("function");
  });

  it("C3.2 — onSalvar(payload) chama salvarPerfilAdmin(lojaId da URL, payload intacto) — nunca salvarPerfil", async () => {
    renderizar();
    expect(capturado.onSalvar).toBeTypeOf("function");

    const payload = { ...PAYLOAD_MIN, whatsapp_envio_automatico: false };
    await capturado.onSalvar!(payload);

    expect(salvarPerfilAdmin).toHaveBeenCalledTimes(1);
    // 1º arg = tenant da URL (closure); 2º arg = payload NÃO reescrito pelo wrapper.
    expect(salvarPerfilAdmin).toHaveBeenCalledWith(LOJA_ALVO, payload);

    // AC-4 (metade cliente): o default do lojista fecharia a escrita na loja do admin.
    expect(salvarPerfil).not.toHaveBeenCalled();
  });

  it("C3.3 — tenant vem da URL, nunca do payload: `id`/`loja_id` hostis não mudam o 1º argumento", async () => {
    renderizar(LOJA_ALVO);
    expect(capturado.onSalvar).toBeTypeOf("function");

    await capturado.onSalvar!({
      ...PAYLOAD_MIN,
      whatsapp_envio_automatico: false,
      id: LOJA_HOSTIL,
      loja_id: LOJA_HOSTIL,
    });

    expect(vi.mocked(salvarPerfilAdmin).mock.calls[0][0]).toBe(LOJA_ALVO);
    expect(vi.mocked(salvarPerfilAdmin).mock.calls[0][0]).not.toBe(LOJA_HOSTIL);
    // A defesa final contra o payload hostil é do SERVIDOR (C1.3 em
    // admin-loja.binding.test.ts); aqui provamos só que o wrapper não lê tenant
    // do payload.
    expect(salvarPerfil).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Issue 368 (RED) — DD6: o cartão de publicação sai do PerfilClient e entra pelo
// slot `topo`; no admin, `onDefinirPublicacao` aponta para `publicarLojaAdmin`
// com o `lojaId` da URL (o gate D7 é revalidado lá). DD7: os 6 `required`.

describe("PerfilAdminClient — slot topo com CartaoPublicacao (issue 368)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturado.props = undefined;
  });

  it("topo é um CartaoPublicacao cujo onDefinirPublicacao chama publicarLojaAdmin(lojaId, publicar)", async () => {
    renderToStaticMarkup(
      <PerfilAdminClient
        lojaId={LOJA_ALVO}
        inicial={{} as never}
        publicado={false}
        bloqueio="Cadastre ao menos um produto disponível antes de publicar a loja."
        logoUrlInicial={null}
      />,
    );
    const topo = capturado.props?.topo as { type?: unknown; props?: Record<string, unknown> } | undefined;
    expect(topo?.type).toBe(cartao.CartaoPublicacao);
    expect(topo?.props?.publicado).toBe(false);
    expect(topo?.props?.bloqueio).toBe("Cadastre ao menos um produto disponível antes de publicar a loja.");
    expect(topo?.props?.destinoAposPublicar).toBeNull();
    // O PerfilClient não recebe mais o cartão por props soltas (DD6).
    expect(capturado.props).not.toHaveProperty("onDefinirPublicacao");
    expect(capturado.props).not.toHaveProperty("podePublicar");

    const onDefinir = topo?.props?.onDefinirPublicacao as (p: boolean) => Promise<unknown>;
    await onDefinir(true);
    expect(publicarLojaAdmin).toHaveBeenCalledWith(LOJA_ALVO, true);
    expect(definirPublicacao).not.toHaveBeenCalled();
  });

  it("markup do wrapper admin traz os 6 required", async () => {
    renderizar();
    expect(capturado.props).toBeDefined();
    const { PerfilClient: Real } = await vi.importActual<
      typeof import("@/app/(painel)/painel/(bloqueavel)/configuracoes/perfil/PerfilClient")
    >("@/app/(painel)/painel/(bloqueavel)/configuracoes/perfil/PerfilClient");
    const inicial = {
      nome: "Loja Alvo",
      slug: "loja-alvo",
      telefone: null,
      whatsapp: null,
      whatsapp_envio_automatico: true,
      modal_promocoes: true,
      endereco_cep: null,
      endereco_rua: null,
      endereco_numero: null,
      endereco_bairro: null,
      endereco_cidade: null,
      endereco_estado: null,
    };
    const props = { ...(capturado.props as Record<string, unknown>), inicial } as unknown as Parameters<typeof Real>[0];
    const markup = renderToStaticMarkup(<Real {...props} />);
    for (const id of [
      "perfil-endereco-cep",
      "perfil-endereco-rua",
      "perfil-endereco-numero",
      "perfil-endereco-bairro",
      "perfil-endereco-cidade",
      "perfil-endereco-estado",
    ]) {
      const i = markup.indexOf(`id="${id}"`);
      expect(i, id).toBeGreaterThan(-1);
      const tag = markup.slice(markup.lastIndexOf("<input", i), markup.indexOf(">", i) + 1);
      expect(tag, id).toMatch(/\srequired(=""|\s|>|\/)/);
    }
  });
});
