import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactElement } from "react";

/**
 * Issue 368 (P8) — páginas de etapa do assistente (perfil, horarios, entregas,
 * pagamentos, produtos, opcionais). Cada uma: (1) chama o guard ANTES de
 * produzir qualquer conteúdo (a página do painel reusada não pode vazar para
 * loja já publicada, pois o layout não re-roda em navegação); (2) reusa a tela
 * do painel; (3) fecha com a NavegacaoEtapas da própria etapa.
 */

const NEXT_REDIRECT = "NEXT_REDIRECT";
const exigirAssistente = vi.fn();
vi.mock("./guard", () => ({ exigirAssistente: () => exigirAssistente() }));

function Nav() {
  return null;
}
vi.mock("./NavegacaoEtapas", () => ({ NavegacaoEtapas: Nav }));

function tela(nome: string) {
  const f = function Tela() {
    return null;
  };
  Object.defineProperty(f, "name", { value: nome });
  return f;
}
const HorariosPage = tela("HorariosPage");
const PagamentosPage = tela("PagamentosPage");
const ProdutosPage = tela("ProdutosPage");
const OpcionaisPage = tela("OpcionaisPage");
const EntregasConteudo = tela("EntregasConteudo");
const PerfilClient = tela("PerfilClient");

vi.mock("@/app/(painel)/painel/(bloqueavel)/configuracoes/horarios/page", () => ({ default: HorariosPage }));
vi.mock("@/app/(painel)/painel/(bloqueavel)/configuracoes/pagamentos/page", () => ({ default: PagamentosPage }));
vi.mock("@/app/(painel)/painel/(bloqueavel)/produtos/page", () => ({ default: ProdutosPage }));
vi.mock("@/app/(painel)/painel/(bloqueavel)/produtos/opcionais/page", () => ({ default: OpcionaisPage }));
vi.mock("@/app/(painel)/painel/(bloqueavel)/configuracoes/entregas/EntregasConteudo", () => ({ EntregasConteudo }));
vi.mock("@/app/(painel)/painel/(bloqueavel)/configuracoes/perfil/PerfilClient", () => ({ PerfilClient }));
vi.mock("@/lib/actions/loja", () => ({ salvarPerfil: "ACAO_SALVAR_PERFIL" }));
vi.mock("@/lib/actions/logo", () => ({ salvarLogoLoja: "ACAO_LOGO", removerLogoLoja: "ACAO_REMOVER_LOGO" }));
vi.mock("@/lib/actions/galeria", () => ({
  enviarImagemGaleria: "ACAO_GALERIA_ENVIAR",
  listarImagensGaleria: "ACAO_GALERIA_LISTAR",
}));

const LOJA = {
  nome: "Loja Y",
  slug: "loja-y",
  telefone: null,
  whatsapp: "11999990000",
  whatsapp_envio_automatico: false,
  modal_promocoes: true,
  endereco_cep: null,
  endereco_rua: null,
  endereco_numero: null,
  endereco_bairro: null,
  endereco_cidade: null,
  endereco_estado: null,
  logo_url: "https://cdn.exemplo.test/logo.png",
  latitude: -1.5,
  longitude: -2.5,
};

type Pagina = () => Promise<ReactElement>;
type Fragmento = ReactElement<{ children: ReactElement[] }>;
const filhos = (el: ReactElement) => (el as Fragmento).props.children;

const CASOS: { etapa: string; carregar: () => Promise<{ default: Pagina }>; tela: unknown }[] = [
  { etapa: "horarios", carregar: () => import("./horarios/page"), tela: HorariosPage },
  { etapa: "pagamentos", carregar: () => import("./pagamentos/page"), tela: PagamentosPage },
  { etapa: "produtos", carregar: () => import("./produtos/page"), tela: ProdutosPage },
  { etapa: "opcionais", carregar: () => import("./opcionais/page"), tela: OpcionaisPage },
  { etapa: "entregas", carregar: () => import("./entregas/page"), tela: EntregasConteudo },
  { etapa: "perfil", carregar: () => import("./perfil/page"), tela: PerfilClient },
];

beforeEach(() => {
  vi.clearAllMocks();
  exigirAssistente.mockResolvedValue({ loja: LOJA, estado: {} });
});

describe.each(CASOS)("etapa $etapa", ({ etapa, carregar, tela: Esperada }) => {
  it("renderiza a tela reusada seguida da NavegacaoEtapas da própria etapa", async () => {
    const { default: Pagina } = await carregar();
    const el = await Pagina();
    const [conteudo, nav] = filhos(el);
    expect(conteudo.type).toBe(Esperada);
    expect(nav.type).toBe(Nav);
    expect(nav.props).toEqual({ etapa });
  });

  it("guard que redireciona (loja publicada / sem sessão) rejeita a página", async () => {
    exigirAssistente.mockRejectedValue(new Error(NEXT_REDIRECT));
    const { default: Pagina } = await carregar();
    await expect(Pagina()).rejects.toThrow(NEXT_REDIRECT);
  });
});

describe("etapa entregas — link de perfil", () => {
  it("o aviso de coordenadas aponta para a etapa perfil do assistente, não para o painel", async () => {
    const { default: Pagina } = await import("./entregas/page");
    const [conteudo] = filhos(await Pagina());
    expect(conteudo.props).toEqual({ hrefPerfil: "/painel/primeiros-passos/perfil" });
  });
});

describe("etapa perfil — wiring", () => {
  it("usa as actions do LOJISTA, sem 'topo' de publicação (publicar só em revisar)", async () => {
    const { default: Pagina } = await import("./perfil/page");
    const [conteudo] = filhos(await Pagina());
    const p = conteudo.props as unknown as Record<string, unknown>;
    expect(p.topo).toBeNull();
    expect(p.onSalvar).toBe("ACAO_SALVAR_PERFIL");
    expect(p.onSalvarLogo).toBe("ACAO_LOGO");
    expect(p.onRemoverLogo).toBe("ACAO_REMOVER_LOGO");
    expect(p.onListarGaleria).toBe("ACAO_GALERIA_LISTAR");
    expect(p.onEnviarParaGaleria).toBe("ACAO_GALERIA_ENVIAR");
    expect(p.logoUrlInicial).toBe(LOJA.logo_url);
  });

  it("inicial vem do loader do guard e nunca carrega coordenadas", async () => {
    const { default: Pagina } = await import("./perfil/page");
    const [conteudo] = filhos(await Pagina());
    const inicial = (conteudo.props as unknown as { inicial: Record<string, unknown> }).inicial;
    expect(inicial.nome).toBe("Loja Y");
    expect(inicial.modal_promocoes).toBe(true);
    expect("latitude" in inicial || "longitude" in inicial).toBe(false);
  });
});
