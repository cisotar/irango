// Schemas de ENTREGA — validam a FORMA da config de entrega do lojista
// (lojista é cliente não-confiável tanto quanto o comprador):
//   - valorFrete            → regra única de valor de frete (≥ 0, centavos)
//   - schemaModalidadesEntrega / schemaRegistroFreteCombinado
//   - schemaFaixasEntrega   → gate da tela de faixas de km (issue 326)
//   - schemaZonasEntrega    → autoridade das Server Actions que gravam as zonas
//                             numa forma só, com versão otimista (issues 325/328)
//   - schemaDefinirFormaFrete → autoridade das Server Actions que ATIVAM a forma
//                             (botão "Usar esta forma", mesma versão otimista)
// FORA daqui: cálculo de frete, match de zona por endereço, RLS/unicidade.
import { z } from "zod";
import type { Json } from "@/lib/database.types";
import { normalizarBairro } from "@/lib/utils/calcularFrete";

/**
 * Valor de frete em reais: não-negativo e com centavos. CRÍTICO: taxa negativa
 * abriria valor de entrega que reduz o total. Regra única, reusada pela taxa da
 * zona e por quem mais gravar um valor de frete (frete combinado, spec
 * modalidades-entrega-loja), que só acrescenta o próprio teto.
 */
export const valorFrete = z.number().min(0).multipleOf(0.01);

// ─── Modalidades de entrega da loja (spec modalidades-entrega-loja) ─────────
// ISOMÓRFICO: gate de UX no form e autoridade na Server Action (lojista e
// admin). Espelha no zod os dois CHECKs de `lojas` para recusar ANTES de
// qualquer I/O: `lojas_modo_frete_check` (enum) e
// `lojas_ao_menos_uma_modalidade` (superRefine). Chave extra é descartada pelo
// zod e, de novo, pela allowlist `montarPatchModalidades` (patches-loja.ts).
export const MODOS_FRETE = ["automatico", "a_combinar"] as const;
export type ModoFrete = (typeof MODOS_FRETE)[number];

export const MENSAGEM_AO_MENOS_UMA_MODALIDADE =
  "Deixe ligada pelo menos a retirada ou a entrega.";

export const schemaModalidadesEntrega = z
  .object({
    aceita_retirada: z.boolean(),
    aceita_entrega: z.boolean(),
    modo_frete: z.enum(MODOS_FRETE),
  })
  .superRefine((m, ctx) => {
    if (!m.aceita_retirada && !m.aceita_entrega) {
      ctx.addIssue({
        code: "custom",
        path: ["aceita_entrega"],
        message: MENSAGEM_AO_MENOS_UMA_MODALIDADE,
      });
    }
  });

export type DadosModalidadesEntrega = z.infer<typeof schemaModalidadesEntrega>;

// ─── Registro do frete combinado (spec modalidades-entrega-loja, D1/D2/D3) ──
// ISOMÓRFICO: gate de UX no form do detalhe e autoridade nas duas Server
// Actions (lojista `registrarFreteCombinado` e admin
// `registrarFreteCombinadoAdmin`). `.strict()`: o payload só pode carregar o
// pedido e o valor — `desconto`/`subtotal`/`total`/`frete_a_combinar` extras
// são RECUSADOS (não descartados), porque o total é recalculado do banco.
/** D3: teto de sanidade do frete combinado, em reais. */
export const TETO_FRETE_COMBINADO = 1000;

export const schemaRegistroFreteCombinado = z
  .object({
    pedidoId: z.guid(),
    valor: valorFrete.max(TETO_FRETE_COMBINADO),
  })
  .strict();

// ─── Tabela de faixas de entrega (issue 326, D2/C2') ────────────────────────
// ISOMÓRFICO: gate de UX na tela e autoridade nas Server Actions (lojista e
// admin), antes de qualquer I/O. O cliente manda SÓ `incremento` e, por faixa,
// `taxa`, `pedido_minimo_gratis` e `ativo`; teto, nome, tipo, loja e zona são
// derivados na RPC `salvar_faixas_entrega`. `.strict()` nos dois níveis: chave
// extra é RECUSADA, não descartada. Teto de 30 e invariante de prefixo das
// ativas espelham a RPC (20260930120000).
export const TETO_FAIXAS_ENTREGA = 30;

export const MENSAGEM_FAIXA_ATIVA_DEPOIS_DE_DESLIGADA =
  "Ligue as faixas de cima antes desta: a entrega não pode pular distância.";

export const schemaFaixaEntrega = z
  .object({
    taxa: valorFrete,
    pedido_minimo_gratis: valorFrete.nullable(),
    ativo: z.boolean(),
  })
  .strict();

type ItemAtivo = { ativo: boolean };

/** C2': ativas formam um prefixo — nenhuma ativa depois de uma desligada. */
function refinarPrefixo({ faixas }: { faixas: ItemAtivo[] }, ctx: z.RefinementCtx) {
  const primeiraDesligada = faixas.findIndex((f) => !f.ativo);
  if (primeiraDesligada === -1) return;
  const buraco = faixas.findIndex((f, i) => i > primeiraDesligada && f.ativo);
  if (buraco === -1) return;
  ctx.addIssue({
    code: "custom",
    path: ["faixas", buraco, "ativo"],
    message: MENSAGEM_FAIXA_ATIVA_DEPOIS_DE_DESLIGADA,
  });
}

const camposKm = {
  incremento: z.union([z.literal(1), z.literal(2)]),
  faixas: z.array(schemaFaixaEntrega).max(TETO_FAIXAS_ENTREGA),
};

export const schemaFaixasEntrega = z.object(camposKm).strict().superRefine(refinarPrefixo);

export type DadosFaixasEntrega = z.infer<typeof schemaFaixasEntrega>;

// ─── Zonas de entrega numa forma só, com versão (issues 325/328) ────────────
// ISOMÓRFICO: autoridade das Server Actions (lojista e admin), antes de
// qualquer I/O; os gates sem versão servem às telas. Regras de valor
// espelham a RPC `salvar_zonas_entrega` (20261018120000), que segue sendo a
// autoridade final. `.strict()` em todo nível: o cliente nunca manda
// `loja_id`, `tipo`, `nome`, `raio_max_km` nem `id` — o servidor deriva.
export const TETO_FAIXAS_CEP = 50;
export const TETO_GRUPOS_BAIRRO = 30;
export const TETO_BAIRROS_POR_GRUPO = 100;
export const TETO_BAIRROS_TOTAL = 300;

export const MENSAGEM_CONFLITO_ZONAS =
  "Recarregue a página para ver as entregas atuais: elas foram alteradas em outra aba ou por outra pessoa, e esta mudança não foi salva.";

/** Erro genérico da gravação de zonas: actions lojista/admin e tela (detalhe só no log do servidor). */
export const MENSAGEM_ERRO_ZONAS = "Não foi possível salvar as zonas de entrega. Tente de novo.";
export const MENSAGEM_ERRO_FORMA_FRETE = "Não foi possível trocar a forma de cobrar a entrega. Tente de novo.";

/** CEP como inteiro de 8 dígitos ("01000-000" → 1000000), como em taxas_entrega.cep_*. */
const cepInteiro = z.number().int().min(0).max(99999999);

export const schemaFaixaCep = z
  .object({
    cep_inicio: cepInteiro,
    cep_fim: cepInteiro,
    taxa: valorFrete,
    pedido_minimo_gratis: valorFrete.nullable(),
    ativo: z.boolean(),
  })
  .strict();

export const schemaGrupoBairros = z
  .object({
    bairros: z
      .array(z.string().trim().min(1).max(120))
      .min(1, "Adicione pelo menos um bairro a este preço.")
      .max(TETO_BAIRROS_POR_GRUPO),
    taxa: valorFrete,
    pedido_minimo_gratis: valorFrete.nullable(),
    ativo: z.boolean(),
  })
  .strict();

/** Inteiro (1000000) → "01000-000", só para mensagem de erro. */
function mascaraCep(valor: number): string {
  const digitos = String(valor).padStart(8, "0");
  return `${digitos.slice(0, 5)}-${digitos.slice(5)}`;
}

type FaixaCepRefino = { cep_inicio: number; cep_fim: number };

/** Início ≤ fim e nenhuma faixa cruzando outra (desligada também conta: pode voltar). */
function refinarCep({ faixas }: { faixas: FaixaCepRefino[] }, ctx: z.RefinementCtx) {
  faixas.forEach((f, i) => {
    if (f.cep_inicio > f.cep_fim) {
      ctx.addIssue({
        code: "custom",
        path: ["faixas", i, "cep_fim"],
        message: "O CEP final deve ser maior ou igual ao CEP inicial.",
      });
    }
  });
  faixas.forEach((f, j) => {
    if (f.cep_inicio > f.cep_fim) return;
    const outra = faixas.find(
      (g, i) => i < j && g.cep_inicio <= g.cep_fim && f.cep_inicio <= g.cep_fim && g.cep_inicio <= f.cep_fim,
    );
    if (outra == null) return;
    ctx.addIssue({
      code: "custom",
      path: ["faixas", j, "cep_inicio"],
      message: `A faixa de ${mascaraCep(f.cep_inicio)} a ${mascaraCep(f.cep_fim)} cruza com a de ${mascaraCep(outra.cep_inicio)} a ${mascaraCep(outra.cep_fim)}. Ajuste uma delas.`,
    });
  });
}

/** Teto total e bairro repetido em qualquer grupo, pela MESMA normalização da vitrine. */
function refinarBairros({ grupos }: { grupos: { bairros: string[] }[] }, ctx: z.RefinementCtx) {
  const total = grupos.reduce((n, g) => n + g.bairros.length, 0);
  if (total > TETO_BAIRROS_TOTAL) {
    ctx.addIssue({
      code: "custom",
      path: ["grupos"],
      message: `Cadastre no máximo ${TETO_BAIRROS_TOTAL} bairros.`,
    });
  }
  const vistos = new Set<string>();
  grupos.forEach((g, gi) => {
    g.bairros.forEach((bairro, bi) => {
      const chave = normalizarBairro(bairro);
      if (vistos.has(chave)) {
        ctx.addIssue({
          code: "custom",
          path: ["grupos", gi, "bairros", bi],
          message: `${bairro} já está em outro preço.`,
        });
        return;
      }
      vistos.add(chave);
    });
  });
}

const camposCep = { faixas: z.array(schemaFaixaCep).max(TETO_FAIXAS_CEP) };
const camposBairro = { grupos: z.array(schemaGrupoBairros).max(TETO_GRUPOS_BAIRRO) };

/** Gates sem versão, para as telas de CEP e bairro. */
export const schemaFaixasCep = z.object(camposCep).strict().superRefine(refinarCep);
export const schemaGruposBairro = z.object(camposBairro).strict().superRefine(refinarBairros);

const versaoZonas = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);

export const schemaZonasEntrega = z.discriminatedUnion("forma", [
  z
    .object({ forma: z.literal("raio_km"), versao: versaoZonas, ...camposKm })
    .strict()
    .superRefine(refinarPrefixo),
  z
    .object({ forma: z.literal("faixa_cep"), versao: versaoZonas, ...camposCep })
    .strict()
    .superRefine(refinarCep),
  z
    .object({ forma: z.literal("bairro"), versao: versaoZonas, ...camposBairro })
    .strict()
    .superRefine(refinarBairros),
]);

export type DadosZonasEntrega = z.infer<typeof schemaZonasEntrega>;
export type FormaZonasEntrega = DadosZonasEntrega["forma"];
export type DadosZonasSemVersao = DadosZonasEntrega extends infer D
  ? D extends unknown
    ? Omit<D, "versao">
    : never
  : never;

/** Argumentos da RPC `salvar_zonas_entrega` (sem `p_loja_id`, que a action deriva). */
export function argsSalvarZonas(d: DadosZonasEntrega): {
  p_versao: number;
  p_forma: FormaZonasEntrega;
  p_dados: Json;
} {
  switch (d.forma) {
    case "raio_km":
      return {
        p_versao: d.versao,
        p_forma: d.forma,
        p_dados: { incremento: d.incremento, faixas: d.faixas },
      };
    case "faixa_cep":
      return { p_versao: d.versao, p_forma: d.forma, p_dados: { faixas: d.faixas } };
    case "bairro":
      return { p_versao: d.versao, p_forma: d.forma, p_dados: { grupos: d.grupos } };
  }
}

/** Número de faixas ou grupos (auditoria do admin e aviso da tela): aceita payload com ou sem versão. */
export function itensDasZonas(d: DadosZonasSemVersao): number {
  return d.forma === "bairro" ? d.grupos.length : d.faixas.length;
}

type ErroRpc = { code?: string; message?: string };

/**
 * Gate das actions de ativação da forma (`definir_forma_frete`), ANTES de I/O.
 * Só `{ forma, versao }`: o tenant (`p_loja_id`) vem do servidor.
 */
export const schemaDefinirFormaFrete = z
  .object({
    forma: z.enum(["raio_km", "faixa_cep", "bairro"] as const satisfies readonly FormaZonasEntrega[]),
    versao: versaoZonas,
  })
  .strict();

export type DadosDefinirFormaFrete = z.infer<typeof schemaDefinirFormaFrete>;

/** A forma não tem zona ligada com preço: a RPC recusa a ativação. */
export const MENSAGEM_FORMA_SEM_ZONA =
  "Cadastre e salve pelo menos uma zona ligada com preço nesta forma antes de usá-la.";

const PREFIXOS_CONFLITO = [
  "salvar_zonas_entrega: versao desatualizada",
  "definir_forma_frete: versao desatualizada",
] as const;

/** P0001 + 'versao desatualizada' de uma das duas RPCs: o contrato estável. */
export function ehConflitoDeVersao(error: ErroRpc | null): boolean {
  if (error?.code !== "P0001") return false;
  const msg = error.message ?? "";
  return PREFIXOS_CONFLITO.some((p) => msg.includes(p));
}

/** Resultado das actions de zonas (lojista e admin), consumido pela tela. */
export type ResultadoZonas =
  | { ok: true; versao: number }
  | { ok: false; erro: string; conflito?: true };

/**
 * Gate das actions de zonas, ANTES de qualquer I/O: `schemaZonasEntrega`
 * (`.strict()` em todo nível). Recusa devolve a primeira regra de negócio
 * (mensagem `custom`) ou uma genérica, nunca o detalhe do zod.
 */
export function validarPayloadZonas(
  payload: unknown,
): { ok: true; data: DadosZonasEntrega } | { ok: false; erro: string } {
  const parsed = schemaZonasEntrega.safeParse(payload);
  if (parsed.success) return { ok: true, data: parsed.data };
  const regra = parsed.error.issues.find((i) => i.code === "custom");
  return { ok: false, erro: regra?.message ?? "Confira as zonas de entrega." };
}

/**
 * Resposta da RPC `salvar_zonas_entrega` → `ResultadoZonas`. Conflito de versão
 * → `conflito` com a mensagem de recarregar; outro erro, ou versão que não é
 * inteiro seguro → genérica. O texto do banco nunca vai para o cliente: só para
 * o log do servidor, com o `rotulo` da action.
 */
export function resultadoDaRpcZonas(
  rotulo: string,
  resposta: { data: unknown; error: ErroRpc | null },
): ResultadoZonas {
  return traduzirRespostaComVersao(rotulo, resposta, MENSAGEM_ERRO_ZONAS);
}

/** Conflito → `conflito`; erro ou versão que não é inteiro seguro → `generica`; ok → versão. */
function traduzirRespostaComVersao(
  rotulo: string,
  { data, error }: { data: unknown; error: ErroRpc | null },
  generica: string,
): ResultadoZonas {
  if (ehConflitoDeVersao(error)) {
    console.warn(`[${rotulo}] conflito de versão`);
    return { ok: false, conflito: true, erro: MENSAGEM_CONFLITO_ZONAS };
  }
  if (error || typeof data !== "number" || !Number.isSafeInteger(data)) {
    console.error(`[${rotulo}]`, error ?? "versão inválida devolvida pela RPC");
    return { ok: false, erro: generica };
  }
  return { ok: true, versao: data };
}

/**
 * Resposta da RPC `definir_forma_frete` → `ResultadoZonas`. Conflito de versão
 * → `conflito`; forma sem zona ligada com preço → `MENSAGEM_FORMA_SEM_ZONA`;
 * resto → `MENSAGEM_ERRO_FORMA_FRETE`. O texto do banco só vai para o log do
 * servidor.
 */
export function resultadoDaRpcFormaFrete(
  rotulo: string,
  resposta: { data: unknown; error: ErroRpc | null },
): ResultadoZonas {
  const { error } = resposta;
  if (error?.code === "P0001" && (error.message ?? "").includes("definir_forma_frete: forma sem zona ativa")) {
    console.warn(`[${rotulo}] forma sem zona ativa`);
    return { ok: false, erro: MENSAGEM_FORMA_SEM_ZONA };
  }
  return traduzirRespostaComVersao(rotulo, resposta, MENSAGEM_ERRO_FORMA_FRETE);
}
