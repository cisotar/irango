import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Fase RED (issue 136, crítica: TDD red-first — RN-M1 server-autoritativo).
 *
 * Prova que a page `/painel/pedidos/[id]` resolve o ENTITLEMENT DE IMPRESSÃO no
 * servidor (SSR) e o repassa PRONTO a `DetalhePedido` via `modulosImpressao`.
 * O entitlement é decidido a partir do banco (2ª leitura de `lojas` sob RLS por
 * `dono_id`), NUNCA no cliente. Fail-closed: loja `null` → `[]` (sem seletor),
 * sem quebrar a página. Um bug aqui (não passar a lista, ou passar as flags cruas)
 * reabriria o vetor de entitlement — motivo da criticidade.
 *
 * Padrão de teste espelha `admin/assinantes/[lojaId]/pedidos/[id]/page.test.tsx`:
 * invoca o default export async da page e inspeciona o elemento retornado (com
 * `DetalhePedido` mockado como `() => null`), sem renderizar. Ambiente `node`.
 *
 * `variantesHabilitadas` NÃO é mockada: usamos a fonte real de decisão (issue 130,
 * pura e já testada) — o teste prova o caminho ponta-a-ponta flags→lista, e a
 * asserção crava a lista CONCRETA esperada (não reproduz a fórmula da produção).
 */

const PEDIDO_ID = "33333333-3333-3333-3333-333333333333";

// Client sentinela: provamos que a page passa ESTE mesmo client autenticado às
// queries (reuso sob RLS — a 2ª leitura de `lojas` herda o escopo por dono).
const supabaseFake = { __tag: "supabase-autenticado" } as const;
const createClient = vi.fn(async () => supabaseFake as unknown);
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => createClient(),
}));

// Pedido do dono: o loader já é testado à parte; aqui é fixo e não-nulo (nunca
// aciona `notFound`), para isolar a prova no entitlement.
const pedidoFake = { id: PEDIDO_ID, status: "pendente", itens_pedido: [] };
const buscarPedidoDoDono = vi.fn(async (_c: unknown, _id: string) => pedidoFake);
vi.mock("@/lib/supabase/queries/pedidos", () => ({
  buscarPedidoDoDono: (c: unknown, id: string) => buscarPedidoDoDono(c, id),
}));

// buscarLojaDoDono: a 2ª leitura sob RLS (reuso da query — `architecture.md §8`,
// NUNCA `.from('lojas')` inline). Configurável por teste: loja com flags | null.
const buscarLojaDoDono = vi.fn(async (_c: unknown) => null as unknown);
vi.mock("@/lib/supabase/queries/lojas", () => ({
  buscarLojaDoDono: (c: unknown) => buscarLojaDoDono(c),
}));

// DetalhePedido mockado → a page devolve o elemento SEM renderizar; lemos as
// props que a page montou (o default `[]` do componente NÃO se aplica aqui, então
// "não passar a prop" aparece como `undefined` e reprova as asserções de lista).
vi.mock("@/components/painel/DetalhePedido", () => ({
  DetalhePedido: () => null,
}));

// notFound() real LANÇA (NEXT_NOT_FOUND). Mockado só para não abortar caso a
// fiação do pedido regrida — aqui o pedido é sempre não-nulo, não deve ser chamado.
const NEXT_NOT_FOUND = "NEXT_NOT_FOUND";
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error(NEXT_NOT_FOUND);
  },
}));

// Import APÓS os vi.mock(). A page já existe; o RED é por ASSERÇÃO (ela ainda não
// lê a loja nem passa `modulosImpressao`).
import DetalhePedidoPage from "./page";

type PropsDetalhe = {
  pedido: unknown;
  modulosImpressao?: string[];
  nomeLoja?: string;
};

async function renderizarProps(): Promise<PropsDetalhe> {
  const elemento = await DetalhePedidoPage({
    params: Promise.resolve({ id: PEDIDO_ID }),
  });
  return (elemento as { props: PropsDetalhe }).props;
}

beforeEach(() => {
  vi.clearAllMocks();
  createClient.mockResolvedValue(supabaseFake as unknown);
  buscarPedidoDoDono.mockResolvedValue(pedidoFake);
});

describe("page painel /painel/pedidos/[id] — entitlement server-autoritativo (RED)", () => {
  it("(1) loja com só térmica → DetalhePedido recebe modulosImpressao=['cozinha','recibo']", async () => {
    buscarLojaDoDono.mockResolvedValueOnce({
      modulo_impressao_termica: true,
      modulo_impressao_a4: false,
    });

    const props = await renderizarProps();

    expect(props.modulosImpressao).toEqual(["cozinha", "recibo"]);
  });

  it("(2) loja sem módulo (ambas false) → modulosImpressao=[] (sem seletor)", async () => {
    buscarLojaDoDono.mockResolvedValueOnce({
      modulo_impressao_termica: false,
      modulo_impressao_a4: false,
    });

    const props = await renderizarProps();

    expect(props.modulosImpressao).toEqual([]);
  });

  it("(3) buscarLojaDoDono → null → modulosImpressao=[] (fail-closed) e o pedido ainda renderiza", async () => {
    buscarLojaDoDono.mockResolvedValueOnce(null);

    const props = await renderizarProps();

    // Fail-closed: sem loja, sem impressão — mas a página NÃO quebra: o pedido
    // continua sendo repassado a DetalhePedido.
    expect(props.modulosImpressao).toEqual([]);
    expect(props.pedido).toBe(pedidoFake);
  });

  it("(4) resolve o entitlement lendo a loja via buscarLojaDoDono com o MESMO client autenticado (reuso sob RLS, sem .from('lojas') inline)", async () => {
    buscarLojaDoDono.mockResolvedValueOnce(null);

    await renderizarProps();

    expect(buscarLojaDoDono).toHaveBeenCalledTimes(1);
    expect(buscarLojaDoDono).toHaveBeenCalledWith(supabaseFake);
  });

  it("(5) loja com só A4 → modulosImpressao=['a4'] E nomeLoja=loja.nome (recibo precisa do nome real, não um placeholder)", async () => {
    buscarLojaDoDono.mockResolvedValueOnce({
      modulo_impressao_a4: true,
      modulo_impressao_termica: false,
      nome: "Pizzaria Dona Rosa",
    });

    const props = await renderizarProps();

    // Borda do mapa RN-M2: só A4 habilitado NÃO deve trazer "cozinha"/"recibo"
    // junto — prova que a página não está sempre habilitando as duas variantes
    // térmicas independente da flag.
    expect(props.modulosImpressao).toEqual(["a4"]);
    expect(props.nomeLoja).toBe("Pizzaria Dona Rosa");
  });

  it("(6) buscarLojaDoDono → null → nomeLoja='' (fail-closed também no nome, nunca undefined)", async () => {
    buscarLojaDoDono.mockResolvedValueOnce(null);

    const props = await renderizarProps();

    // Sem loja, `loja?.nome` é undefined — a página precisa normalizar para
    // string vazia (não repassar `undefined`, que apareceria como "undefined"
    // literal se algum consumidor fizer interpolação direta em template).
    expect(props.nomeLoja).toBe("");
  });
});
