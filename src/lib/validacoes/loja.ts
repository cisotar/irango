// Validações isomórficas da loja (issue 019, RN-07 / seguranca.md §6).
// O MESMO schema roda no form (client, UX) e na Server Action (servidor,
// segurança). O servidor NÃO confia no client — revalida tudo por regex.

import { z } from "zod";

const reSlug = /^[a-z0-9-]{3,60}$/;
const reWhatsapp = /^55\d{10,11}$/;
const reHex = /^#[0-9a-fA-F]{6}$/;
const reHora = /^([01]\d|2[0-3]):[0-5]\d$/;

// `.strict()` (defesa em profundidade, RN-A5 / seguranca.md §2/§10): chaves
// extras no payload (ex.: assinatura_status, hotmart_*, dono_id, ativo) fazem
// o safeParse FALHAR antes de qualquer I/O — o cliente nunca injeta coluna
// autoritativa no UPDATE. A allowlist na Server Action é a segunda barreira.
export const schemaPerfil = z
  .object({
    nome: z.string().trim().min(1),
    slug: z.string().regex(reSlug),
    telefone: z.string().optional(),
    whatsapp: z.string().regex(reWhatsapp).optional(),
  })
  .strict();

export const schemaTema = z
  .object({
    primaria: z.string().regex(reHex),
    fundo: z.string().regex(reHex),
    destaque: z.string().regex(reHex),
  })
  .strict();

const schemaDia = z
  .object({
    abre: z.string().regex(reHora),
    fecha: z.string().regex(reHora),
    ativo: z.boolean(),
  })
  .refine((d) => !d.ativo || d.abre < d.fecha, {
    message: "Horário de abertura deve ser anterior ao de fechamento",
    path: ["fecha"],
  });

export const schemaHorarios = z
  .object({
    seg: schemaDia,
    ter: schemaDia,
    qua: schemaDia,
    qui: schemaDia,
    sex: schemaDia,
    sab: schemaDia,
    dom: schemaDia,
  })
  .strict();

// Sugestão UX de slug a partir do nome. Invariante: a saída sempre passa
// no slug do schemaPerfil (paridade UX↔validação).
export function sanitizarSlug(nome: string): string {
  return nome
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // remove acentos (marcas combinantes)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-") // não-[a-z0-9] → hífen
    .replace(/-+/g, "-") // colapsa hífens
    .replace(/^-+|-+$/g, ""); // trim hífens
}
