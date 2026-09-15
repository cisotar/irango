// [197] Fonte ÚNICA do endereço curto exibido ao COMPRADOR (RN-R1/RN-R2).
//
// Formato: `{rua}, {numero} · {bairro}` — sem cidade, estado ou CEP. Decisão do
// dono do produto em 2026-09-15: na tela e na mensagem de WhatsApp o comprador
// só precisa do que localiza fisicamente o ponto. As seis colunas continuam
// sendo coletadas e gravadas — muda só a EXIBIÇÃO (o CEP segue obrigatório no
// cálculo de frete).
//
// Dois adaptadores para o mesmo formato, porque os dois lados têm shapes
// diferentes: a loja vem em colunas `endereco_*` (`lojas` / `vitrine_lojas`) e o
// cliente vem no JSONB livre `pedidos.endereco_entrega` (`rua`/`numero`/...).
// Consolida as duas cópias de `formatarEndereco` que viviam em
// `whatsappPedido.ts` e em `confirmacao/page.tsx`.
//
// `null` (nunca "—", nunca "") quando não há nenhuma parte preenchida — RN-R5:
// quem chama decide o fallback, o util não inventa texto.
//
// O painel do lojista NÃO usa este util: lá o endereço completo (com cidade,
// estado e CEP) continua sendo necessário para entregar.

import { montarConsultaGeocoding } from "@/lib/actions/patches-loja";

/** Colunas de endereço de `lojas` / `vitrine_lojas` (todas nullable). */
export type EnderecoColunasLoja = {
  endereco_rua?: string | null;
  endereco_numero?: string | null;
  endereco_bairro?: string | null;
  endereco_cidade?: string | null;
  endereco_estado?: string | null;
  endereco_cep?: string | null;
};

/** Origem do link do Maps — LITERAL no código (RN-R6 / seguranca.md). */
const ORIGEM_MAPS = "https://www.google.com/maps/search/?api=1&query=";

/** String não vazia após trim, ou "" (trata null/undefined/não-string). */
function parte(valor: unknown): string {
  return typeof valor === "string" && valor.trim() !== "" ? valor.trim() : "";
}

/**
 * Junta as três partes no formato curto, sem separador órfão:
 * rua + numero por vírgula; o bairro entra depois de " · ".
 */
function formatarCurto(
  rua: string,
  numero: string,
  bairro: string,
): string | null {
  const ruaNumero = [rua, numero].filter(Boolean).join(", ");
  const texto = [ruaNumero, bairro].filter(Boolean).join(" · ");
  return texto || null;
}

/** Endereço da LOJA em uma linha (RN-R1). `null` sem partes suficientes. */
export function formatarEnderecoLoja(loja: EnderecoColunasLoja): string | null {
  return formatarCurto(
    parte(loja.endereco_rua),
    parte(loja.endereco_numero),
    parte(loja.endereco_bairro),
  );
}

/**
 * Endereço do CLIENTE (JSONB `pedidos.endereco_entrega`) no MESMO formato curto.
 * O JSONB é livre: só as chaves conhecidas são lidas, o resto é ignorado.
 */
export function formatarEnderecoCliente(endereco: unknown): string | null {
  if (endereco == null || typeof endereco !== "object") return null;
  if (Array.isArray(endereco)) return null;
  const e = endereco as Record<string, unknown>;
  return formatarCurto(parte(e.rua), parte(e.numero), parte(e.bairro));
}

/**
 * Href de busca do Google Maps para o endereço da loja (RN-R6).
 *
 * Esquema e domínio são LITERAIS (`ORIGEM_MAPS`): nenhum valor de banco ocupa
 * essa posição, então um lojista não transforma o link em `javascript:`. Só a
 * consulta é interpolada, sempre por `encodeURIComponent`.
 *
 * A consulta reusa `montarConsultaGeocoding` (patches-loja): ela já exclui o CEP
 * (token envenenador — issues 185/186) e devolve `null` sem cidade E estado, que
 * é exatamente a RN-R5 (sem âncora geográfica, sem link). Consulta ≠ exibição de
 * propósito: a tela mostra o curto, a busca precisa de cidade/UF/"Brasil".
 *
 * A função só lê colunas `endereco_*` — nada de `searchParams` da confirmação
 * (o `token_acesso` jamais pode chegar ao Google).
 */
export function montarHrefMapsLoja(loja: EnderecoColunasLoja): string | null {
  const consulta = montarConsultaGeocoding({
    endereco_rua: loja.endereco_rua,
    endereco_numero: loja.endereco_numero,
    endereco_bairro: loja.endereco_bairro,
    endereco_cidade: loja.endereco_cidade,
    endereco_estado: loja.endereco_estado,
  });
  if (!consulta) return null;
  return `${ORIGEM_MAPS}${encodeURIComponent(consulta)}`;
}
