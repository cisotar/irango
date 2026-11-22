import type { LojaCompleta } from "@/lib/supabase/queries/lojas";
import type { PerfilInicial } from "./PerfilClient";

/**
 * Mapeamento loja → valores iniciais do form de perfil (issue 368, DD5). Fonte
 * única para a page do painel, a etapa perfil do assistente e a sub-rota admin.
 * Nenhuma coordenada entra aqui: o par é derivado no servidor (seguranca.md §19).
 */
export function perfilInicialDaLoja(loja: LojaCompleta): PerfilInicial {
  return {
    nome: loja.nome,
    slug: loja.slug,
    telefone: loja.telefone,
    whatsapp: loja.whatsapp,
    whatsapp_envio_automatico: loja.whatsapp_envio_automatico,
    modal_promocoes: loja.modal_promocoes,
    endereco_cep: loja.endereco_cep,
    endereco_rua: loja.endereco_rua,
    endereco_numero: loja.endereco_numero,
    endereco_bairro: loja.endereco_bairro,
    endereco_cidade: loja.endereco_cidade,
    endereco_estado: loja.endereco_estado,
  };
}
