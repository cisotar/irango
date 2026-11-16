import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { EstadoProntidao } from "@/lib/utils/publicacao";

/**
 * Issue 368 (P8) — etapa "Revisar e publicar". Checklist e bloqueio derivam da
 * MESMA `pendenciasPublicacao` do gate (real aqui); só guard, actions e
 * navegação/toast são mockados. O botão é preview: a autoridade é
 * `definirPublicacao`, que relê o banco.
 */

const exigirAssistente = vi.fn();
vi.mock("../guard", () => ({ exigirAssistente: () => exigirAssistente() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/actions/loja", () => ({
  definirPublicacao: vi.fn(),
  localizarEnderecoDeNovo: vi.fn(),
}));

import EtapaRevisarPage from "./page";
import {
  ERRO_PERFIL_INCOMPLETO,
  ERRO_SEM_LOCALIZACAO,
  ERRO_SEM_PAGAMENTO,
  ERRO_SEM_PRODUTO,
  ROTULO_LOCALIZAR_DE_NOVO,
} from "@/lib/utils/publicacao";

const PRONTO = {
  nome: "Loja Z",
  whatsapp: "11999990000",
  endereco_cep: "01310-100",
  endereco_rua: "Avenida Paulista",
  endereco_numero: "1000",
  endereco_bairro: "Bela Vista",
  endereco_cidade: "São Paulo",
  endereco_estado: "SP",
  latitude: -23.56,
  longitude: -46.65,
  produtosDisponiveis: 2,
  formasPagamento: 1,
} as EstadoProntidao;

async function pagina(extra: Partial<EstadoProntidao> = {}): Promise<string> {
  exigirAssistente.mockResolvedValue({ estado: { ...PRONTO, ...extra } });
  return renderToStaticMarkup(await EtapaRevisarPage());
}

/** Trecho do <li> cujo título é `titulo`. */
function linha(m: string, titulo: string): string {
  const i = m.indexOf(`>${titulo}<`);
  expect(i, `linha "${titulo}" ausente`).toBeGreaterThan(-1);
  const ini = m.lastIndexOf("<li", i);
  return m.slice(ini, m.indexOf("</li>", i));
}

function botaoPublicar(m: string): string {
  const i = m.indexOf("Publicar loja</button>");
  expect(i).toBeGreaterThan(-1);
  const ini = m.lastIndexOf("<button", i);
  return m.slice(ini, m.indexOf(">", ini) + 1);
}

const DESABILITADO = /\sdisabled(=""|\s|>)/;

beforeEach(() => vi.clearAllMocks());

describe("etapa revisar", () => {
  it("tudo pronto: 5 linhas 'Pronto', publicar habilitado, sem ação de correção", async () => {
    const m = await pagina();
    expect(m.split(">Pronto<").length - 1).toBe(5);
    expect(m).toContain("Tudo pronto. Publique");
    expect(m).not.toContain("(pendente)");
    expect(m).not.toContain(ROTULO_LOCALIZAR_DE_NOVO);
    expect(m).not.toContain("Ir para");
    expect(botaoPublicar(m)).not.toMatch(DESABILITADO);
    expect(m).toContain("Depois de publicar, você vai para o painel da loja.");
  });

  it("só falta o par: botão D14 na linha de localização, publicar bloqueado com a mensagem certa", async () => {
    const m = await pagina({ latitude: null, longitude: null });
    const l = linha(m, "Localização no mapa");
    expect(l).toContain(ROTULO_LOCALIZAR_DE_NOVO);
    expect(l).toContain(ERRO_SEM_LOCALIZACAO);
    expect(l).toContain("(pendente)");
    // o rótulo também aparece nas mensagens; só UM é botão
    const botoes = m.match(/<button(?:(?!<\/button>)[\s\S])*Localizar meu endereço de novo<\/button>/g);
    expect(botoes).toHaveLength(1);
    expect(m).toContain("Resolva o item marcado");
    expect(botaoPublicar(m)).toMatch(DESABILITADO);
  });

  it("endereço incompleto: localização fica 'aguardando' (sem botão D14), link vai ao perfil", async () => {
    const m = await pagina({ endereco_rua: null, endereco_cep: "", latitude: null, longitude: null });
    const end = linha(m, "Endereço");
    expect(end).toContain("Preencha CEP e rua do endereço da loja antes de publicar.");
    expect(end).toContain('href="/painel/primeiros-passos/perfil"');
    const loc = linha(m, "Localização no mapa");
    expect(loc).toContain("(aguardando)");
    expect(loc).toContain("Complete o endereço para localizar a loja no mapa.");
    expect(m).not.toContain(ROTULO_LOCALIZAR_DE_NOVO);
    expect(m).not.toContain(ERRO_SEM_LOCALIZACAO);
  });

  it("cada pendência aponta para a etapa que a resolve", async () => {
    expect(linha(await pagina({ nome: " " }), "Nome e WhatsApp")).toContain(
      'href="/painel/primeiros-passos/perfil"',
    );
    expect(linha(await pagina({ whatsapp: null }), "Nome e WhatsApp")).toContain(ERRO_PERFIL_INCOMPLETO);
    const pg = linha(await pagina({ formasPagamento: 0 }), "Forma de pagamento");
    expect(pg).toContain('href="/painel/primeiros-passos/pagamentos"');
    expect(pg).toContain(ERRO_SEM_PAGAMENTO);
    const pr = linha(await pagina({ produtosDisponiveis: 0 }), "Produto disponível");
    expect(pr).toContain('href="/painel/primeiros-passos/produtos"');
    expect(pr).toContain(ERRO_SEM_PRODUTO);
  });

  it("várias pendências: subtítulo no plural e o bloqueio é o da PRIMEIRA (ordem do gate)", async () => {
    const m = await pagina({ formasPagamento: 0, produtosDisponiveis: 0 });
    expect(m).toContain("Resolva os 2 itens marcados");
    expect(botaoPublicar(m)).toMatch(DESABILITADO);
    // bloqueio do cartão = pagamento (vem antes de produto no gate)
    const cartao = m.slice(m.indexOf("Status da vitrine"));
    expect(cartao).toContain(ERRO_SEM_PAGAMENTO);
    expect(cartao).not.toContain(ERRO_SEM_PRODUTO);
  });

  it("loja vazia: 4 linhas pendentes (localização aguardando), nada 'Pronto'", async () => {
    const m = await pagina({
      nome: "",
      whatsapp: null,
      endereco_cep: null,
      endereco_rua: null,
      endereco_numero: null,
      endereco_bairro: null,
      endereco_cidade: null,
      endereco_estado: null,
      latitude: null,
      longitude: null,
      produtosDisponiveis: 0,
      formasPagamento: 0,
    });
    expect(m).not.toContain(">Pronto<");
    expect(m.split("(pendente)").length - 1).toBe(4);
    expect(m.split("(aguardando)").length - 1).toBe(1);
    expect(m).toContain("Resolva os 4 itens marcados");
  });

  it("guard que redireciona rejeita a página (loja já publicada não vê o checklist)", async () => {
    exigirAssistente.mockRejectedValue(new Error("NEXT_REDIRECT"));
    await expect(EtapaRevisarPage()).rejects.toThrow("NEXT_REDIRECT");
  });
});
