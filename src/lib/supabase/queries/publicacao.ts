// Carga do estado de prontidão para publicar (issue 368, D7/DD2/DD3). Fonte
// ÚNICA das contagens do gate `podePublicarLoja` — chamada pelo lojista
// (`definirPublicacao`, client autenticado), pelo admin (`publicarLojaAdmin`,
// service_role) e pelos previews.
//
// ESCOPO: o `.eq("loja_id", loja.id)` é explícito nas duas contagens. A RLS de
// leitura pública expõe produtos/formas de QUALQUER loja ativa ao client
// autenticado, e o service_role não tem RLS: sem o `.eq`, a loja vizinha
// liberaria a publicação.
//
// Tratamento de erro (seguranca.md §14): PROPAGA o erro do PostgREST (throw);
// `count` nulo vira 0 (fail-closed: recusa publicar).
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import type { LojaCompleta } from "./lojas";
import type {
  CampoEnderecoLoja,
  EstadoProntidao,
} from "@/lib/utils/publicacao";

type Client = SupabaseClient<Database>;

export async function carregarProntidaoPublicacao(
  client: Client,
  loja: Pick<
    LojaCompleta,
    "id" | "nome" | "whatsapp" | CampoEnderecoLoja | "latitude" | "longitude"
  >,
): Promise<EstadoProntidao> {
  // "Produto disponível" (DD4) = disponivel AND NOT oculto. A frequência de
  // exibição depende do relógio e é avaliada só na vitrine.
  const [produtos, formas] = await Promise.all([
    client
      .from("produtos")
      .select("id", { count: "exact", head: true })
      .eq("loja_id", loja.id)
      .eq("disponivel", true)
      .eq("oculto", false),
    client
      .from("formas_pagamento")
      .select("id", { count: "exact", head: true })
      .eq("loja_id", loja.id),
  ]);
  if (produtos.error) throw produtos.error;
  if (formas.error) throw formas.error;

  return {
    nome: loja.nome,
    whatsapp: loja.whatsapp,
    endereco_cep: loja.endereco_cep,
    endereco_rua: loja.endereco_rua,
    endereco_numero: loja.endereco_numero,
    endereco_bairro: loja.endereco_bairro,
    endereco_cidade: loja.endereco_cidade,
    endereco_estado: loja.endereco_estado,
    latitude: loja.latitude,
    longitude: loja.longitude,
    produtosDisponiveis: produtos.count ?? 0,
    formasPagamento: formas.count ?? 0,
  };
}
