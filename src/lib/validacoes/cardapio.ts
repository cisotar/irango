import { z } from "zod";

import { TETO_LOTE } from "@/lib/validacoes/produto";

/**
 * Schemas do CARDÁPIO SAZONAL (Spec B) — um zod, vários consumidores.
 *
 * Este módulo é o único lugar onde a FORMA do que o cliente manda sobre
 * cardápio é decidida: as Server Actions de lote (issue 251) e o formulário de
 * cardápio (issue 255) leem daqui, nunca de um schema paralelo.
 *
 * Forma herdada de `schemaReordenacaoCategorias` (src/lib/validacoes/produto.ts:166):
 *  - `.strict()` no objeto: propriedade hostil pendurada no payload (ex.: um
 *    `loja_id` de outra loja) não sobrevive ao parse e jamais chega a uma
 *    coluna — `loja_id` é SEMPRE derivado de `auth.uid()` na Server Action;
 *  - `z.guid()` em todo id: lixo não vira ida ao banco;
 *  - `.max(200)` na lista: teto de cardinalidade (CWE-770);
 *  - sem duplicata: a lista é um CONJUNTO de produtos, não uma sequência;
 *  - o parse devolve um array/objeto NOVO, então nada do cliente é reusado por
 *    referência.
 *
 * `.min(1)`: aplicar cardápio a zero produto é chamada sem efeito — recusada
 * antes de qualquer I/O, não no banco.
 */
const listaDeProdutos = z
  .array(z.guid())
  .min(1)
  .max(TETO_LOTE)
  .refine((ids) => new Set(ids).size === ids.length, {
    message: "Ids repetidos na seleção",
  });

/**
 * [274 · 287] O DOMÍNIO da agenda de um VÍNCULO: inteiros 0..6 (0=dom..6=sab,
 * mesma convenção de `partesNoFuso`) com teto de cardinalidade `.max(7)`
 * (CWE-770) avaliado ANTES da dedup — oito elementos são recusados mesmo que
 * normalizassem para um só.
 *
 * Declarado UMA vez porque DOIS schemas o consomem: `schemaDiasDoVinculo`
 * (editar a agenda de um vínculo existente) e `schemaLoteDeProdutosComDias`
 * (adicionar ao cardápio já com agenda). Uma segunda declaração da mesma regra
 * de domínio é exatamente o drift que a paridade fecha.
 */
const diasDaSemanaDoVinculo = z.array(z.number().int().min(0).max(6)).max(7);

/** Aplicar/tirar por SELEÇÃO EXPLÍCITA de produtos (RN-09). */
export const schemaLoteDeProdutos = z
  .object({
    cardapio_id: z.guid(),
    produto_ids: listaDeProdutos,
  })
  .strict();

/**
 * [287] O MESMO lote, mais a agenda opcional do vínculo — a forma que
 * `aplicarCardapioEmProdutos` / `aplicarCardapioEmProdutosAdmin` aceitam desde
 * que o lojista escolhe os dias no ato de adicionar.
 *
 * DERIVADO em vez de somado ao `schemaLoteDeProdutos`: aquele também é o schema
 * de `tirarDeCardapio` / `tirarDeCardapioAdmin`, onde `dias_semana` tem de
 * continuar sendo chave desconhecida — um DELETE que aceita e ignora em
 * silêncio uma agenda é payload confuso que o `.strict()` hoje recusa.
 *
 * O schema NÃO deduplica e NÃO ordena: quem decide a REPRESENTAÇÃO é
 * `normalizarDiasDoVinculo`, no servidor. `nullish()` porque ausente, `null` e
 * `[]` dizem a mesma coisa — "todos os dias do cardápio" (RN-11).
 */
export const schemaLoteDeProdutosComDias = schemaLoteDeProdutos
  .extend({
    dias_semana: diasDaSemanaDoVinculo.nullish(),
    /**
     * [289] A agenda POR LINHA do lote — ADITIVA e OPCIONAL: ausente, o lote
     * inteiro segue `dias_semana`, que é o payload da barra de lote de
     * `/painel/produtos`, intacto. O MESMO `diasDaSemanaDoVinculo` por valor:
     * o domínio da agenda é declarado uma vez só.
     */
    dias_por_produto: z.record(z.guid(), diasDaSemanaDoVinculo).optional(),
  })
  .strict()
  /**
   * A TRAVA do campo novo: chave que não está em `produto_ids` derruba o lote
   * INTEIRO, nunca é podada em silêncio. Um mapa que aceita id desconhecido é
   * superfície de escrita a mais para enumerar — e "ignorado" é
   * indistinguível de "aceito" para quem sonda.
   */
  .refine(
    (v) =>
      v.dias_por_produto == null ||
      Object.keys(v.dias_por_produto).every((id) =>
        v.produto_ids.includes(id),
      ),
    { message: "Agenda de produto fora da seleção", path: ["dias_por_produto"] },
  );

/** Aplicar por CATEGORIA INTEIRA — expandida dentro da RPC, nunca em JS (RN-10). */
export const schemaLoteDeCategoria = z
  .object({
    cardapio_id: z.guid(),
    categoria_id: z.guid(),
  })
  .strict();

/**
 * Prévia do servidor para o diálogo de confirmação (RN-09-a): a MESMA forma da
 * gravação, sem `cardapio_id` — prever não escreve, então não precisa saber em
 * qual cardápio o lote vai cair.
 */
export const schemaPreviaDeLote = z.union([
  z.object({ produto_ids: listaDeProdutos }).strict(),
  z.object({ categoria_id: z.guid() }).strict(),
]);

/**
 * O `id` da ENTIDADE cardápio, quando ele chega sozinho (sem objeto de
 * payload): `atualizarCardapio`, `ligarDesligarCardapio`, `removerCardapio` e
 * `converterExclusivosParaMenu`. Mesmo contrato das actions de lote — lixo não
 * vira ida ao banco —, só que aqui o argumento é um escalar.
 */
export const schemaIdCardapio = z.guid();

/**
 * [284 · RN-01] O modo de remoção do cardápio quando há exclusivos órfãos.
 * UMA declaração, isomórfica entre o diálogo do painel e as duas Server Actions
 * (lojista e hub admin): qualquer valor fora dos três literais — ausente sob
 * cast, `null`, string arbitrária, objeto — falha o parse e a action recusa com
 * `MSG_INVALIDO` ANTES de qualquer I/O. O tipo correspondente é
 * `ModoRemocaoExclusivos`, em `lib/actions/cardapio-contrato.ts`.
 */
export const schemaModoRemocao = z.enum(["manter", "arquivar", "cascata"]);

export type LoteDeProdutos = z.infer<typeof schemaLoteDeProdutos>;
export type LoteDeProdutosComDias = z.infer<typeof schemaLoteDeProdutosComDias>;
export type LoteDeCategoria = z.infer<typeof schemaLoteDeCategoria>;
export type PreviaDeLote = z.infer<typeof schemaPreviaDeLote>;

// ═══════════════════════════════════════════ CRUD do cardápio (issue 255) ═══
//
// `schemaCardapio` é a barreira LEGÍVEL dos CHECKs de 20260920128000: o banco
// recusa a mesma configuração com `23514`, que não diz nada ao lojista. Um zod,
// dois consumidores — `FormVigencia` (react-hook-form) e as Server Actions de
// `src/lib/actions/cardapio.ts`. Nada de schema paralelo (`design-system.md` §6).
//
// O schema NÃO conhece `lojas.timezone` e por isso NÃO converte prazo: ele roda
// antes de qualquer I/O, nos dois lados. `prazo_inicio`/`prazo_fim` saem daqui
// como HORA LOCAL (`"YYYY-MM-DDTHH:MM"`, o value nativo do `datetime-local`),
// exatamente como `schemaProduto` faz com `desconto_inicio`/`desconto_fim`
// (RN-03 do Spec A). Quem converte para instante é a Server Action, com o fuso
// da LOJA lido do banco — nunca um fuso vindo do cliente.

/** As frases de `plan/design-promocoes-e-vigencia.md` §9.6, literais. */
export const MSG_SEM_EIXO =
  "Escolha pelo menos um dia da semana, um dia do mês ou um horário. Sem nada marcado, este cardápio aparece sempre e não é sazonal.";
export const MSG_HORA_PAR =
  "Informe o horário de início e o de fim.";
export const MSG_HORA_ORDEM =
  "O horário de fim precisa ser depois do de início.";
export const MSG_PRAZO_FIM_AUSENTE =
  "Informe a data de fim do período.";
export const MSG_PRAZO_ORDEM =
  "A data de fim precisa ser depois da de início.";

/**
 * As únicas mensagens de validação de vigência que a Server Action promove
 * LITERALMENTE para a UI (`seguranca.md` §14). São frases sobre o que o próprio
 * lojista acabou de digitar — não revelam nada do banco e não viram oráculo.
 * Qualquer outra issue do zod vira a genérica.
 */
const MENSAGENS_DE_VIGENCIA: ReadonlySet<string> = new Set([
  MSG_SEM_EIXO,
  MSG_HORA_PAR,
  MSG_HORA_ORDEM,
  MSG_PRAZO_FIM_AUSENTE,
  MSG_PRAZO_ORDEM,
]);

export function ehMensagemDeVigencia(mensagem: string): boolean {
  return MENSAGENS_DE_VIGENCIA.has(mensagem);
}

/** `"HH:MM"` — o value nativo de `<input type="time">`. */
const horaDoDia = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Horário inválido");

/** Hora LOCAL da loja (`<input type="datetime-local">`), nunca um ISO com offset. */
const prazoLocal = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/, "Data e hora inválidas");

const nome = z.string().trim().min(1, "Dê um nome ao cardápio").max(80);

/**
 * Modo RECORRENTE (D3-a). `.strict()` faz a disjunção de RN-01 pela FORMA:
 * mandar `prazo_inicio` aqui não é "ignorado", é recusado — o mesmo que os
 * CHECKs `cardapios_recorrente_exclusivo`/`cardapios_prazo_exclusivo` fazem no
 * banco, uma camada antes.
 */
const cardapioRecorrente = z
  .object({
    nome,
    modo: z.literal("recorrente"),
    /** 0=dom..6=sab, mesma convenção de `partesNoFuso`. */
    dias_semana: z.array(z.number().int().min(0).max(6)).max(7).nullish(),
    dias_mes: z.array(z.number().int().min(1).max(31)).max(31).nullish(),
    hora_inicio: horaDoDia.nullish(),
    hora_fim: horaDoDia.nullish(),
  })
  .strict();

/** Modo PRAZO FIXO (D3-b). Mesmo `.strict()`, espelho do outro CHECK. */
const cardapioPrazoFixo = z
  .object({
    nome,
    modo: z.literal("prazo_fixo"),
    prazo_inicio: prazoLocal,
    /**
     * Opcional de propósito: com preset `diario`/`semanal`/`mensal` o fim é
     * RECALCULADO no servidor e o que vier daqui é descartado (RN-04). Exigi-lo
     * obrigaria o form a mandar um valor que o servidor joga fora.
     */
    prazo_fim: prazoLocal.nullish(),
    prazo_preset: z.enum(["diario", "semanal", "mensal", "customizado"]),
  })
  .strict();

/** O que sai do parse: a linha do banco, menos `loja_id`, `ordem` e `ativo`. */
export type DadosCardapio = {
  nome: string;
  modo: "recorrente" | "prazo_fixo";
  dias_semana: number[] | null;
  dias_mes: number[] | null;
  hora_inicio: string | null;
  hora_fim: string | null;
  /** HORA LOCAL da loja — a Server Action converte para instante. */
  prazo_inicio: string | null;
  prazo_fim: string | null;
  prazo_preset: "diario" | "semanal" | "mensal" | "customizado" | null;
};

/**
 * RN-02 (cardápio) / RN-11 (274, vínculo): "sem restrição" tem UMA
 * representação no banco — NULL, nunca `'{}'`.
 *
 * Exportada desde a 274 porque os DOIS mundos de escrita da agenda do VÍNCULO
 * (`definirDiasDoVinculo` e `definirDiasDoVinculoAdmin`) precisam exatamente
 * desta regra — dedup, ordem numérica, `[]`/`null` → `null`. Ela já existia
 * aqui como a normalização do eixo do CARDÁPIO; reescrevê-la em
 * `cardapio-contrato.ts` seria uma segunda cópia da mesma decisão (e um ciclo
 * de import, porque o contrato já importa deste módulo).
 *
 * `[1,1,3]` → `[1,3]` · `[3,1]` → `[1,3]` · `[]` → `null` · `null` → `null`.
 * Devolve SEMPRE um array novo: o array recebido não é mutado.
 */
export function normalizarDiasDoVinculo(
  dias: number[] | null | undefined,
): number[] | null {
  if (dias == null || dias.length === 0) return null;
  return [...new Set(dias)].sort((a, b) => a - b);
}

export const schemaCardapio = z
  .discriminatedUnion("modo", [cardapioRecorrente, cardapioPrazoFixo])
  .superRefine((v, ctx) => {
    if (v.modo === "recorrente") {
      // Par tudo-ou-nada e sem cruzar a meia-noite — `cardapios_hora_par` e
      // `cardapios_hora_ordem`. Comparação lexicográfica basta em "HH:MM".
      const temInicio = v.hora_inicio != null;
      const temFim = v.hora_fim != null;
      if (temInicio !== temFim) {
        ctx.addIssue({
          code: "custom",
          path: [temInicio ? "hora_fim" : "hora_inicio"],
          message: MSG_HORA_PAR,
        });
      } else if (temInicio && v.hora_fim! <= v.hora_inicio!) {
        ctx.addIssue({
          code: "custom",
          path: ["hora_fim"],
          message: MSG_HORA_ORDEM,
        });
      }

      // `cardapios_recorrente_tem_eixo`: os três eixos vazios ao mesmo tempo
      // é o estado que o lojista não consegue diagnosticar olhando a vitrine.
      const semEixo =
        normalizarDiasDoVinculo(v.dias_semana) == null &&
        normalizarDiasDoVinculo(v.dias_mes) == null &&
        v.hora_inicio == null;
      if (semEixo) {
        ctx.addIssue({
          code: "custom",
          path: ["dias_semana"],
          message: MSG_SEM_EIXO,
        });
      }
      return;
    }

    // prazo_fixo — só `customizado` tem fim digitado para validar; nos presets
    // o fim é do servidor (RN-04) e um `prazo_fim` incoerente aqui seria
    // recusa por um valor que nem vai ser usado.
    if (v.prazo_preset !== "customizado") return;
    if (v.prazo_fim == null) {
      ctx.addIssue({
        code: "custom",
        path: ["prazo_fim"],
        message: MSG_PRAZO_FIM_AUSENTE,
      });
      return;
    }
    if (v.prazo_fim <= v.prazo_inicio) {
      ctx.addIssue({
        code: "custom",
        path: ["prazo_fim"],
        message: MSG_PRAZO_ORDEM,
      });
    }
  })
  .transform((v): DadosCardapio => {
    // Os campos do modo OPOSTO saem explicitamente NULL: o UPDATE que troca de
    // modo precisa APAGAR as colunas do modo anterior, senão a linha nova
    // carregaria a vigência velha e o CHECK de disjunção a recusaria.
    if (v.modo === "recorrente") {
      return {
        nome: v.nome,
        modo: "recorrente",
        dias_semana: normalizarDiasDoVinculo(v.dias_semana),
        dias_mes: normalizarDiasDoVinculo(v.dias_mes),
        hora_inicio: v.hora_inicio ?? null,
        hora_fim: v.hora_fim ?? null,
        prazo_inicio: null,
        prazo_fim: null,
        prazo_preset: null,
      };
    }
    return {
      nome: v.nome,
      modo: "prazo_fixo",
      dias_semana: null,
      dias_mes: null,
      hora_inicio: null,
      hora_fim: null,
      prazo_inicio: v.prazo_inicio,
      prazo_fim: v.prazo_fim ?? null,
      prazo_preset: v.prazo_preset,
    };
  });

export type EntradaCardapio = z.input<typeof schemaCardapio>;

// ═══════════════════ [274] dias por VÍNCULO — RN-10, RN-11, RN-12 ═══════════

/**
 * A FORMA do payload que define a agenda de UM item dentro de UM cardápio
 * (D1). Mesmo molde dos schemas de lote acima:
 *  - `.strict()`: um `loja_id` pendurado no payload não é ignorado, é RECUSADO
 *    antes de qualquer I/O — `loja_id` é SEMPRE derivado no servidor (RN-10);
 *  - `z.guid()` nos dois ids: lixo não vira ida ao banco;
 *  - `dias_semana` é lista de inteiros 0..6 (mesma convenção de `partesNoFuso`)
 *    com teto de cardinalidade `.max(7)` (CWE-770), avaliado ANTES da dedup:
 *    oito elementos são recusados mesmo que normalizassem para um só.
 *
 * O schema NÃO deduplica e NÃO ordena — quem decide a REPRESENTAÇÃO é
 * `normalizarDiasDoVinculo`, no servidor. `[1,1,3]` e `[1,3]` dizem a mesma
 * coisa ("segunda e quarta"); recusar a repetição viraria uma frase de erro
 * que quem salvou não sabe corrigir.
 */
export const schemaDiasDoVinculo = z
  .object({
    cardapio_id: z.guid(),
    produto_id: z.guid(),
    dias_semana: diasDaSemanaDoVinculo,
  })
  .strict();

export type DiasDoVinculo = z.infer<typeof schemaDiasDoVinculo>;
