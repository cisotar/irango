import "server-only";

import { notFound } from "next/navigation";

import { validarLojaIdAdmin } from "@/lib/actions/admin-loja";
import type { PaginaGaleria, UsoImagem } from "@/lib/actions/galeria-contrato";
import { verificarAdminSaaS } from "@/lib/auth/admin";
import { createServiceClient } from "@/lib/supabase/service";
import {
  buscarUsoDasImagens,
  contarOriginaisDaLoja,
  listarImagensDaLojaAdmin,
} from "@/lib/supabase/queries/imagens";

export type GaleriaAdminAgregado = {
  pagina: PaginaGaleria;
  /** Originais não pendentes (prévia do teto; a autoritativa é a da action). */
  total: number;
  /** Uso da primeira página, para o selo "Em uso". */
  usos: UsoImagem[];
};

/**
 * Loader server-only (NÃO `'use server'`) da galeria da loja-alvo via
 * service_role, ESCOPADO por `lojaId` (specs/galeria-imagens-loja.md, página
 * 2). Nome `carga*.ts` de propósito: cai no auto-discovery do
 * `enforcement-escopo-admin.test.ts`.
 *
 * Ordem inegociável (fail-closed), espelhando `carga-cupons.ts`:
 *  1. `validarLojaIdAdmin(lojaId)` (z.guid()) — não-UUID → `notFound()` ANTES de
 *     qualquer leitura;
 *  2. `verificarAdminSaaS()` ANTES de `createServiceClient()` — a falha PROPAGA;
 *  3. leituras escopadas pela `lojaId` validada. Sob service_role (BYPASSRLS) a
 *     barreira é o `.eq("loja_id", lojaId)` das queries e o `p_loja_id` da RPC
 *     de uso, que filtra `loja_id = p_loja_id`.
 */
export async function carregarGaleriaAdmin(lojaId: string): Promise<GaleriaAdminAgregado> {
  const validacao = validarLojaIdAdmin(lojaId);
  if (!validacao.ok) {
    notFound();
  }
  const idValidado = validacao.lojaId;

  // Prova de admin ANTES de elevar a service_role; a falha PROPAGA (nenhuma leitura).
  await verificarAdminSaaS();

  const svc = createServiceClient();

  const [pagina, total] = await Promise.all([
    listarImagensDaLojaAdmin(svc, idValidado),
    contarOriginaisDaLoja(svc, idValidado),
  ]);

  // O selo é prévia: sem ele a página segue, e a remoção reconsulta o uso.
  const usos = await buscarUsoDasImagens(
    svc,
    idValidado,
    pagina.imagens.map((i) => i.id),
  ).catch((e: unknown): UsoImagem[] => {
    console.error("[carregarGaleriaAdmin] uso da primeira página", e);
    return [];
  });

  return { pagina, total, usos };
}
