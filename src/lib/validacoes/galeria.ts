// Schemas zod da galeria de imagens (specs/galeria-imagens-loja.md, RN-G9).
// Camada de FORMA no servidor; a RPC repete as travas (T1) e o banco tem a
// palavra final sobre posse.
import { z } from "zod";
import { MAXIMO_LOTE_REMOCAO } from "@/lib/actions/galeria-contrato";

/** Lote de remoção/uso: 1..50 uuids distintos. */
export const schemaIdsImagens = z
  .array(z.guid())
  .min(1)
  .max(MAXIMO_LOTE_REMOCAO)
  .refine((ids) => new Set(ids).size === ids.length, "Ids repetidos.");

/** Cursor keyset (`criado_em desc, id desc`); ausente = primeira página. */
export const schemaCursorGaleria = z
  .object({
    criado_em: z.iso.datetime({ offset: true }),
    id: z.guid(),
  })
  .optional();

/** Original de onde sai o recorte (a posse é provada pela action + FK composta). */
export const schemaOrigemId = z.guid();
