import { z } from "zod";

/** Formato uuid sem exigir versão RFC-4122 (convenção de pedido.ts). Único schema de UUID compartilhado. */
export const schemaUuid = z.guid();
