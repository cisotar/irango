// Contrato NEUTRO da galeria de imagens da loja (specs/galeria-imagens-loja.md).
// Fonte única dos dois mundos (lojista e admin): constantes, montadores de
// caminho do Storage, trava de prefixo, reconhecedores de erro do banco,
// mensagens literais e tipos. Sem I/O e sem `'use server'` — arquivo
// `'use server'` só pode exportar função async (const/tipo quebra o build).

import type { Database } from "@/lib/database.types";

// ── Constantes do spec (D6, P11, P9, D7, D10) ────────────────────────────────

/** D6: teto de originais por loja (recortes e pendentes não contam). */
export const TETO_IMAGENS_POR_LOJA = 200;
/** P11/RN-G9: ids por chamada de remoção. */
export const MAXIMO_LOTE_REMOCAO = 50;
/** Página da grade (keyset). */
export const POR_PAGINA_GALERIA = 40;
/** P4: lado maior da original reduzida no cliente. */
export const LADO_MAXIMO_ORIGINAL = 2048;
/** D7/P9: lado maior da miniatura. */
export const LADO_MINIATURA = 400;
/** D10: abaixo disso o cropper avisa (sem bloquear). */
export const LARGURA_MINIMA_RECOMENDADA_PRODUTO = 800;
export const LARGURA_MINIMA_RECOMENDADA_LOGO = 400;

/** Campos do FormData (o arquivo principal segue em `CAMPO_ARQUIVO`). */
export const CAMPO_MINIATURA = "miniatura";
export const CAMPO_ORIGEM = "origem_id";

/** Bucket reusado pela galeria (P7: QR Pix fica fora, em `pix-qr`). */
export const BUCKET_IMAGENS = "produtos";

// ── Caminhos (RN-G16: relativos ao bucket, nome UUID, montados no servidor) ──

export function caminhoOriginal(lojaId: string, id: string, ext: string): string {
  return `${lojaId}/galeria/${id}.${ext}`;
}

/** Miniatura é sempre webp. */
export function caminhoMiniatura(lojaId: string, id: string): string {
  return `${lojaId}/galeria/mini/${id}.webp`;
}

export function caminhoRecorte(
  lojaId: string,
  destino: "produto" | "logo",
  id: string,
  ext: string,
): string {
  return destino === "logo" ? `${lojaId}/logo/${id}.${ext}` : `${lojaId}/${id}.${ext}`;
}

/**
 * Trava de prefixo antes de todo `storage.remove`: o caminho precisa estar
 * dentro da pasta da loja e sem `..` (espelha o CHECK `imagens_loja_caminho_da_loja`).
 * Sob service_role é a única amarra de isolamento no Storage.
 */
export function caminhoDaLoja(caminho: string, lojaId: string): boolean {
  if (typeof caminho !== "string" || lojaId.length === 0) return false;
  const prefixo = `${lojaId}/`;
  return (
    caminho.startsWith(prefixo) &&
    caminho.length > prefixo.length &&
    !caminho.includes("..")
  );
}

/** Separa os caminhos da loja dos alheios (o chamador loga os alheios). */
export function particionarCaminhos(
  caminhos: readonly unknown[],
  lojaId: string,
): { daLoja: string[]; alheios: unknown[] } {
  const daLoja: string[] = [];
  const alheios: unknown[] = [];
  for (const c of caminhos) {
    if (typeof c === "string" && caminhoDaLoja(c, lojaId)) daLoja.push(c);
    else alheios.push(c);
  }
  return { daLoja, alheios };
}

/**
 * URL que o service worker nunca guardou: a chave do cache inclui a query,
 * então o `fetch` com CORS do cropper sempre vai à rede (o Storage ignora a query).
 */
export function urlParaRecorte(url: string): string {
  const u = new URL(url);
  u.searchParams.set("recorte", "1");
  return u.toString();
}

// ── Reconhecedores de erro do banco (par errcode + fragmento literal) ────────

function codigoEMensagem(erro: unknown): { code?: unknown; message?: unknown } | null {
  if (erro == null || typeof erro !== "object") return null;
  return erro as { code?: unknown; message?: unknown };
}

/** Recusa dos triggers BEFORE de M4 (`produtos.foto_url` / `lojas.logo_url`). */
export function ehErroImagemForaDaGaleria(erro: unknown): boolean {
  const e = codigoEMensagem(erro);
  return (
    e?.code === "P0001" &&
    typeof e.message === "string" &&
    e.message.includes("imagem_fora_da_galeria")
  );
}

/** Trigger de `imagens_loja`: a origem do recorte ficou pendente/sumiu (corrida). */
export function ehErroOrigemIndisponivel(erro: unknown): boolean {
  const e = codigoEMensagem(erro);
  return (
    e?.code === "23503" &&
    typeof e.message === "string" &&
    e.message.includes("imagens_loja: origem indisponível")
  );
}

/** Deadlock entre o save e a RPC de remoção (troca entre cópias da mesma original). */
export function ehDeadlock(erro: unknown): boolean {
  return codigoEMensagem(erro)?.code === "40P01";
}

// ── Mensagens literais ───────────────────────────────────────────────────────

export const MSG_FOTO_REMOVIDA_DA_GALERIA =
  "A foto escolhida foi removida da galeria. Escolha outra.";
export const MSG_TENTE_DE_NOVO = "Não foi possível salvar. Tente de novo.";
export const MSG_TETO = `Você chegou a ${TETO_IMAGENS_POR_LOJA} imagens. Remova as que não usa para enviar novas.`;
export const MSG_ORIGEM_REMOVIDA = "Essa imagem foi removida da galeria.";
export const MSG_RECORTE_FALHOU =
  "A imagem foi para a galeria, mas o recorte falhou. Tente de novo pela galeria.";

// Genéricas (seguranca.md §14): o detalhe fica só no log do servidor.
export const MSG_ENVIO_FALHOU = "Não foi possível enviar a imagem.";
export const MSG_LISTAGEM_FALHOU = "Não foi possível carregar as imagens.";
export const MSG_USO_FALHOU = "Não foi possível consultar o uso das imagens.";
export const MSG_REMOCAO_FALHOU = "Não foi possível remover as imagens.";
export const MSG_SELECAO_INVALIDA = "Seleção inválida.";
export const MSG_MUITAS_TENTATIVAS = "Muitas tentativas. Aguarde um instante.";
export const MSG_NAO_AUTORIZADO = "Não autorizado.";
export const MSG_LOJA_INVALIDA = "Loja inválida.";
export const MSG_IMAGEM_INVALIDA = "Imagem inválida.";

/**
 * Erro de ESCRITA de `foto_url`/`logo_url` → mensagem para quem salvou. A
 * recusa do trigger de M4 e o deadlock com a remoção viram frases acionáveis;
 * todo o resto segue genérico, com o texto cru só no log.
 */
export function erroDeEscritaDeImagem(erro: unknown, generica: string): string {
  if (ehErroImagemForaDaGaleria(erro)) return MSG_FOTO_REMOVIDA_DA_GALERIA;
  if (ehDeadlock(erro)) return MSG_TENTE_DE_NOVO;
  return generica;
}

function plural(n: number, um: string, varios: string): string {
  return n === 1 ? um : varios;
}

/** Resultado da remoção com os números do servidor, nunca os da seleção local. */
export function mensagemResultadoRemocao(r: {
  removidas: number;
  ignoradas: number;
  produtosLimpos: number;
  logoLimpa: boolean;
}): string {
  if (r.removidas === 0) return "As imagens selecionadas já tinham sido removidas.";
  const partes = [
    `${r.removidas} ${plural(r.removidas, "imagem removida.", "imagens removidas.")}`,
  ];
  if (r.produtosLimpos > 0) {
    partes.push(
      `${r.produtosLimpos} ${plural(r.produtosLimpos, "produto ficou sem foto.", "produtos ficaram sem foto.")}`,
    );
  }
  if (r.logoLimpa) partes.push("A loja ficou sem logo.");
  if (r.ignoradas > 0) {
    partes.push(
      `${r.ignoradas} ${plural(r.ignoradas, "já tinha sido removida.", "já tinham sido removidas.")}`,
    );
  }
  return partes.join(" ");
}

// ── Tipos ────────────────────────────────────────────────────────────────────

/** Cursor keyset da grade (`criado_em desc, id desc`). Só posiciona a página. */
export type CursorGaleria = { criado_em: string; id: string };

/** Uma original na grade. `miniatura_url` é null em legadas (usam a própria URL). */
export type ImagemGaleria = {
  id: string;
  url: string;
  miniatura_url: string | null;
  criado_em: string;
};

export type PaginaGaleria = {
  imagens: ImagemGaleria[];
  proximo_cursor: CursorGaleria | null;
};

export type ResultadoEnvioGaleria =
  | { ok: true; imagem: ImagemGaleria }
  | { ok: false; erro: string };

export type ResultadoListagemGaleria =
  | ({ ok: true } & PaginaGaleria)
  | { ok: false; erro: string };

/** Linha de `uso_imagens_loja` (prévia; a conta que vale é a da remoção). */
export type UsoImagem =
  Database["public"]["Functions"]["uso_imagens_loja"]["Returns"][number];

export type ResultadoUsoImagens =
  | { ok: true; usos: UsoImagem[] }
  | { ok: false; erro: string };

export type ResultadoRemocao =
  | {
      ok: true;
      removidas: number;
      ignoradas: number;
      produtosLimpos: number;
      logoLimpa: boolean;
    }
  | { ok: false; erro: string };

/** Retorno de `remover_imagens_loja`, lido de forma defensiva (o tipo gerado é Json). */
export type RespostaRpcRemocao = {
  caminhos: unknown[];
  removidas: number;
  ignoradas: number;
  produtosLimpos: number;
  logoLimpa: boolean;
};

function numero(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/** Normaliza o jsonb da RPC de remoção; forma inesperada → null (o chamador falha genérico). */
export function lerRespostaRpcRemocao(data: unknown): RespostaRpcRemocao | null {
  if (data == null || typeof data !== "object" || Array.isArray(data)) return null;
  const d = data as Record<string, unknown>;
  return {
    caminhos: Array.isArray(d.caminhos) ? d.caminhos : [],
    removidas: numero(d.removidas),
    ignoradas: numero(d.ignoradas),
    produtosLimpos: numero(d.produtos_limpos),
    logoLimpa: d.logo_limpa === true,
  };
}
