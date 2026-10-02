import type { EnderecoEntrega } from "@/components/vitrine/FormEndereco";

/**
 * (343) Dados do cliente logado para PRÉ-PREENCHER o checkout. Só UX: o payload
 * segue revalidado no servidor como o do convidado (RN-C18) e o frete é
 * recalculado do CEP. Sem prop = checkout de convidado, idêntico a hoje.
 */
export type PerfilClienteCheckout = { nome: string; telefone: string };

export type EnderecoClienteCheckout = {
  id: string;
  rotulo: string;
  padrao: boolean;
  endereco: EnderecoEntrega;
};

/** Valor do seletor para "Usar outro endereço". */
export const OUTRO_ENDERECO = "outro";
