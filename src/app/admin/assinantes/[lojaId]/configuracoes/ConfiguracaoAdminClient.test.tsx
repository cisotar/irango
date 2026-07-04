/**
 * Teste RED de FIAÇÃO (issue 119 — crítica, TDD red-first) do
 * `ConfiguracaoAdminClient`. Prova que o wrapper admin injeta as actions admin
 * de logo (`salvarLogoAdmin`/`removerLogoAdmin`) no `PerfilClient` com o `lojaId`
 * da URL fixado por closure — e que os defaults do LOJISTA
 * (`salvarLogoLoja`/`removerLogoLoja`) NUNCA são referenciados no caminho admin.
 *
 * Por que isto é invariante de SEGURANÇA (specs/fix-logo-admin-cross-tenant.md §Cenários 2/3):
 * se o `ConfiguracaoAdminClient` recair no default do lojista, `salvarLogoLoja`
 * derivaria a loja pelo AUTH do admin (buscarLojaDoDono) e gravaria a logo na
 * loja DO ADMIN, não na loja-alvo — escrita cross-tenant errada e silenciosa.
 * A fiação correta (loja_id = lojaId da URL → action admin) fecha esse vetor.
 *
 * Ambiente: environment=node, sem jsdom/@testing-library (padrão do projeto —
 * ver ProdutosClient.test.tsx). Não há clique DOM real; a prova de wiring é
 * feita CAPTURANDO as props que o `ConfiguracaoAdminClient` injeta no
 * `PerfilClient` (stub) e INVOCANDO-as, então asserindo qual action foi chamada.
 *
 * Estratégia de mock (evita arrastar `server-only` das actions/child clients):
 *  - `PerfilClient` → stub que captura `onSalvarLogo`/`onRemoverLogo` e retorna null;
 *  - demais child clients (Horarios/Tema/Entregas/Pagamentos) → stubs vazios;
 *  - TODOS os módulos de action admin importados pelo wrapper → `vi.fn()`
 *    (inclusive `admin-logo`, ainda não importado pela produção — mockar módulo
 *    não-importado é inócuo e deixa o teste falhar na ASSERÇÃO, não no import);
 *  - `@/lib/actions/logo` (defaults do lojista) → `vi.fn()` para asserir que
 *    NUNCA são chamados no caminho admin.
 *
 * RED esperado HOJE: a produção não passa `onSalvarLogo`/`onRemoverLogo` ao
 * `PerfilClient` → as props capturadas são `undefined` → asserções falham.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { CAMPO_ARQUIVO } from "@/lib/actions/upload-contrato";

const LOJA_ALVO = "11111111-1111-4111-8111-111111111111";

// Captura das props injetadas no PerfilClient. `vi.hoisted` roda antes dos
// `vi.mock` hoisted, então a referência existe quando o factory do mock executa.
const capturado = vi.hoisted(() => ({
  onSalvarLogo: undefined as
    | ((formData: FormData) => unknown)
    | undefined,
  onRemoverLogo: undefined as (() => unknown) | undefined,
}));

// --- child clients: stubs que não renderizam a árvore real (sem server-only) ---
vi.mock(
  "@/app/(painel)/painel/configuracoes/perfil/PerfilClient",
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
vi.mock("@/app/(painel)/painel/configuracoes/horarios/HorariosClient", () => ({
  HorariosClient: () => null,
}));
vi.mock("@/app/(painel)/painel/configuracoes/tema/TemaClient", () => ({
  TemaClient: () => null,
}));
vi.mock("@/app/(painel)/painel/configuracoes/entregas/EntregasClient", () => ({
  EntregasClient: () => null,
}));
vi.mock("@/app/(painel)/painel/configuracoes/pagamentos/PagamentosClient", () => ({
  PagamentosClient: () => null,
}));

// --- módulos de action admin importados pelo wrapper (todos mockados) ---
vi.mock("@/app/admin/assinantes/actions/admin-perfil", () => ({
  salvarPerfilAdmin: vi.fn(),
}));
vi.mock("@/app/admin/assinantes/actions/admin-publicar", () => ({
  publicarLojaAdmin: vi.fn(),
}));
vi.mock("@/app/admin/assinantes/actions/admin-horarios-tema", () => ({
  salvarHorariosAdmin: vi.fn(),
  salvarTemaAdmin: vi.fn(),
}));
vi.mock("@/app/admin/assinantes/actions/admin-entrega", () => ({
  criarZonaAdmin: vi.fn(),
  atualizarZonaAdmin: vi.fn(),
  removerZonaAdmin: vi.fn(),
}));
vi.mock("@/app/admin/assinantes/actions/admin-pagamento", () => ({
  salvarFormaPagamentoAdmin: vi.fn(),
  atualizarFormaPagamentoAdmin: vi.fn(),
  removerFormaPagamentoAdmin: vi.fn(),
  salvarQrPixAdmin: vi.fn(),
  enviarQrPixAdmin: vi.fn(),
}));

// --- actions admin de logo (alvo do wiring desta issue) ---
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

import { ConfiguracaoAdminClient } from "./ConfiguracaoAdminClient";
import {
  salvarLogoAdmin,
  removerLogoAdmin,
} from "@/app/admin/assinantes/actions/admin-logo";
import { salvarLogoLoja, removerLogoLoja } from "@/lib/actions/logo";

function renderizar(lojaId = LOJA_ALVO) {
  // Props do wrapper: como os child clients são stubs, os dados são irrelevantes
  // ao wiring — só o `lojaId` importa (é a autoridade de escopo por closure).
  renderToStaticMarkup(
    <ConfiguracaoAdminClient
      lojaId={lojaId}
      perfilInicial={{} as never}
      publicado={false}
      podePublicar
      logoUrlInicial={null}
      horariosInicial={null}
      timezone="America/Sao_Paulo"
      temaInicial={{} as never}
      nomeLoja="Loja Alvo"
      zonas={[]}
      formasPagamento={[]}
    />,
  );
}

describe("ConfiguracaoAdminClient — fiação das actions admin de logo (issue 119)", () => {
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
