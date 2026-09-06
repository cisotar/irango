/**
 * Teste de FIAÇÃO do `PerfilClient` — cenário 3 da spec
 * (specs/fix-logo-admin-cross-tenant.md §Cenários de Teste): "Lojista
 * inalterado: `UploadLogoLoja` sem props usa os defaults; lojista salva/remove
 * a própria logo sob RLS como antes."
 *
 * Lacuna que este arquivo fecha: nenhum teste existente prova o REPASSE de
 * `onSalvarLogo`/`onRemoverLogo` dentro do próprio `PerfilClient`.
 * `PerfilAdminClient.test.tsx` (issue 119, migrado em 154) stuba `PerfilClient` — prova
 * só a fiação ACIMA dele (wrapper admin → PerfilClient), nunca executa o corpo
 * real do `PerfilClient`. `logo.test.ts` (issue 003) testa `salvarLogoLoja`/
 * `removerLogoLoja` isoladas, sem passar pelo `PerfilClient`. Faltava provar
 * que o `PerfilClient`:
 *   (a) no fluxo do LOJISTA (`/painel/configuracoes/perfil/page.tsx`, que NÃO
 *       passa `onSalvarLogo`/`onRemoverLogo` — ver page.tsx:24), repassa
 *       `undefined` ao `UploadLogoLoja` — nunca substitui por outra função —
 *       para que os defaults REAIS do componente (`salvarLogoLoja`/
 *       `removerLogoLoja`, ver UploadLogoLoja.tsx:65-66) sejam o que executa;
 *   (b) no fluxo ADMIN (`PerfilAdminClient`, que passa as duas props),
 *       repassa exatamente as MESMAS referências recebidas — sem trocar
 *       `onSalvarLogo` por `onRemoverLogo` nem inventar um wrapper que perca
 *       a identidade da closure fixada pelo `lojaId` da URL.
 *
 * Por que é invariante de SEGURANÇA: se o `PerfilClient` grudasse um valor
 * não-undefined no caminho do lojista (ex.: por engano herdasse uma action
 * admin), a loja errada seria escrita. Se trocasse salvar↔remover no repasse
 * admin, o botão de salvar removeria a logo (ou vice-versa) na loja-alvo.
 *
 * Ambiente: node (padrão do projeto — nem jsdom nem @testing-library/react
 * estão instalados, ver ProdutosClient.test.tsx). `UploadLogoLoja` é
 * stubado para CAPTURAR as props recebidas — não clicamos em nada; a prova é
 * por CAPTURA + comparação de referência, mesmo molde de
 * PerfilAdminClient.test.tsx.
 *
 * Lacuna que PERMANECE (fora do alcance deste arquivo, documentada como em
 * ProdutosClient.test.tsx): provar que os defaults internos do
 * `UploadLogoLoja` (`onSalvar = salvarLogoLoja`, `onRemover = removerLogoLoja`)
 * de fato EXECUTAM ao clicar "Confirmar e salvar"/"Remover logo" exige
 * simular um clique DOM real — infraestrutura (jsdom/@testing-library/react)
 * que o projeto não tem hoje. A correção do binding do default em si é
 * verificável por leitura de código (UploadLogoLoja.tsx:65-66) e por
 * `verificar` manual no painel do lojista.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// PerfilClient chama useRouter() no topo — SSR estático não tem App Router
// montado (mesmo padrão de ProdutosClient.test.tsx).
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

// Actions do lojista importadas por PerfilClient para nome/publicação — não é
// o alvo deste teste; mock para não arrastar `server-only`/Supabase.
vi.mock("@/lib/actions/loja", () => ({
  salvarPerfil: vi.fn(),
  definirPublicacao: vi.fn(),
}));

// UploadLogoLoja: stub que CAPTURA as props recebidas de PerfilClient (não
// renderiza a árvore real — evita puxar react-easy-crop/canvas).
const capturado = vi.hoisted(() => ({
  onSalvar: undefined as ((formData: FormData) => unknown) | undefined,
  onRemover: undefined as (() => unknown) | undefined,
}));
vi.mock("@/components/painel/UploadLogoLoja", () => ({
  UploadLogoLoja: (props: {
    onSalvar?: (formData: FormData) => unknown;
    onRemover?: () => unknown;
  }) => {
    capturado.onSalvar = props.onSalvar;
    capturado.onRemover = props.onRemover;
    return null;
  },
}));

// import type é apagado na compilação — não conflita com o vi.mock acima.
import type { UploadLogoLojaProps } from "@/components/painel/UploadLogoLoja";
import { PerfilClient, type PerfilInicial } from "./PerfilClient";

const INICIAL: PerfilInicial = {
  nome: "Loja Teste",
  slug: "loja-teste",
  telefone: null,
  whatsapp: null,
  whatsapp_envio_automatico: true,
  endereco_cep: null,
  endereco_rua: null,
  endereco_numero: null,
  endereco_bairro: null,
  endereco_cidade: null,
  endereco_estado: null,
};

function renderizar(
  extra: {
    onSalvarLogo?: UploadLogoLojaProps["onSalvar"];
    onRemoverLogo?: UploadLogoLojaProps["onRemover"];
    inicial?: Partial<PerfilInicial>;
  } = {},
): string {
  const { inicial, ...props } = extra;
  return renderToStaticMarkup(
    <PerfilClient
      inicial={{ ...INICIAL, ...inicial }}
      publicado={false}
      podePublicar
      logoUrlInicial={null}
      {...props}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  capturado.onSalvar = undefined;
  capturado.onRemover = undefined;
});

describe("PerfilClient — repasse das actions de logo ao UploadLogoLoja (cenário 3, spec fix-logo-admin-cross-tenant)", () => {
  it("fluxo do LOJISTA (sem onSalvarLogo/onRemoverLogo, como em page.tsx): repassa undefined — nunca inventa uma função — para que os defaults REAIS do UploadLogoLoja (ações do lojista) sejam o que executa", () => {
    renderizar(); // exatamente como PerfilPage usa: sem props de logo

    expect(capturado.onSalvar).toBeUndefined();
    expect(capturado.onRemover).toBeUndefined();
  });

  it("fluxo ADMIN (com onSalvarLogo/onRemoverLogo): repassa a MESMA referência recebida ao UploadLogoLoja — sem trocar salvar↔remover", () => {
    const onSalvarLogo = vi.fn(async (_fd: FormData) => ({
      ok: true as const,
      logo_url: "https://storage.local/loja-alvo/logo/x.webp",
    }));
    const onRemoverLogo = vi.fn(async () => ({ ok: true as const }));

    renderizar({ onSalvarLogo, onRemoverLogo });

    // Identidade preservada — não é "uma função que chama a certa", é a MESMA
    // referência (prova que não há wrapper acidental nem swap).
    expect(capturado.onSalvar).toBe(onSalvarLogo);
    expect(capturado.onRemover).toBe(onRemoverLogo);
    expect(capturado.onSalvar).not.toBe(onRemoverLogo);
    expect(capturado.onRemover).not.toBe(onSalvarLogo);
  });
});

/**
 * Toggle de envio automático do WhatsApp (issue 123, spec 5).
 *
 * Alcance possível sem DOM real (o projeto não tem jsdom/@testing-library —
 * ver cabeçalho): asserts sobre o MARKUP ESTÁTICO — presença do `role="switch"`,
 * do `aria-checked` refletindo o SSR, do estado desabilitado e da dica.
 *
 * Lacuna que PERMANECE (mesma razão do bloco de logo acima): provar
 * clique → `setEnvioAutomatico` → `montarPayload` inclui
 * `whatsapp_envio_automatico: false` exige clique DOM real. A gravação do
 * booleano já está coberta a montante em `patches-loja.test.ts` /
 * `admin-perfil.test.ts` (issue 122); o resto se prova em `/verificar` manual.
 */
describe("PerfilClient — toggle de envio automático do WhatsApp (issue 123)", () => {
  it("reflete a coluna LIGADA quando há WhatsApp válido: switch marcado e habilitado, sem a dica de bloqueio", () => {
    const markup = renderizar({
      inicial: { whatsapp: "5511999999999", whatsapp_envio_automatico: true },
    });

    expect(markup).toContain('role="switch"');
    expect(markup).toContain('aria-checked="true"');
    expect(markup).not.toContain("Cadastre um WhatsApp para ativar o envio automático.");
    // Habilitado: nem `aria-disabled` no `role="switch"`, nem `disabled` no
    // `<input type="checkbox">` oculto que o Base UI renderiza com o nosso `id`.
    expect(markup).not.toContain('aria-disabled="true"');
    expect(markup).not.toContain('<input disabled="" id="perfil-whatsapp-envio-automatico"');
    // A11y (design: "a string é montada condicionalmente e nunca deve
    // referenciar um id que não está no DOM"): habilitado, o describedby cita
    // SÓ o id da ajuda (sem o id do motivo, que não existe aqui) — e esse id
    // realmente existe como elemento no markup.
    expect(markup).toContain(
      'aria-describedby="perfil-whatsapp-envio-automatico-ajuda"',
    );
    expect(markup).toContain('id="perfil-whatsapp-envio-automatico-ajuda"');
    expect(markup).not.toContain("perfil-whatsapp-envio-automatico-motivo");
  });

  it("reflete a coluna DESLIGADA (prova que `false` do SSR não vira `true` por default no cliente)", () => {
    const markup = renderizar({
      inicial: { whatsapp: "5511999999999", whatsapp_envio_automatico: false },
    });

    expect(markup).toContain('aria-checked="false"');
    expect(markup).toContain("Desligado");
  });

  it("sem WhatsApp cadastrado: switch desabilitado + dica (RN-A3), sem zerar a preferência gravada", () => {
    const markup = renderizar({
      inicial: { whatsapp: null, whatsapp_envio_automatico: true },
    });

    expect(markup).toContain("Cadastre um WhatsApp para ativar o envio automático.");
    expect(markup).toContain('id="perfil-whatsapp-envio-automatico-motivo"');
    // Desabilitado de fato: o root `role="switch"` sai da tabulação e o input
    // oculto carrega `disabled` — nada é submetível/alternável.
    expect(markup).toContain('aria-disabled="true"');
    expect(markup).toContain('<input disabled="" id="perfil-whatsapp-envio-automatico"');
    // A dica de bloqueio é anunciada junto do texto auxiliar.
    expect(markup).toContain(
      'aria-describedby="perfil-whatsapp-envio-automatico-ajuda perfil-whatsapp-envio-automatico-motivo"',
    );
    // Os DOIS ids citados no describedby existem de fato no DOM (design:
    // nunca referenciar um id ausente) — a dica auxiliar continua presente
    // mesmo desabilitado, não só o motivo.
    expect(markup).toContain('id="perfil-whatsapp-envio-automatico-ajuda"');
    expect(markup).toContain('id="perfil-whatsapp-envio-automatico-motivo"');
    // O valor da coluna NÃO é zerado ao desabilitar — só o controle trava.
    expect(markup).toContain('aria-checked="true"');
  });

  it("WhatsApp incompleto (menos dígitos que o `reWhatsapp` do servidor) mantém o switch travado", () => {
    const markup = renderizar({
      inicial: { whatsapp: "5511999", whatsapp_envio_automatico: true },
    });

    expect(markup).toContain("Cadastre um WhatsApp para ativar o envio automático.");
  });

  it("associa o rótulo ao controle por `htmlFor` (o `id` do Base UI vai para o input oculto) e não duplica com `aria-label`", () => {
    const markup = renderizar({
      inicial: { whatsapp: "5511999999999", whatsapp_envio_automatico: true },
    });

    expect(markup).toContain('for="perfil-whatsapp-envio-automatico"');
    expect(markup).toContain(
      "Enviar a mensagem de WhatsApp automaticamente ao confirmar o pedido",
    );
    expect(markup).not.toContain("aria-label=\"Enviar a mensagem");
  });
});
