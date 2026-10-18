"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { ModalidadesEntrega } from "@/components/painel/ModalidadesEntrega";
import { SeletorFormaFrete } from "@/components/painel/SeletorFormaFrete";
import { TabelaBairrosEntrega } from "@/components/painel/TabelaBairrosEntrega";
import { TabelaFaixasCep } from "@/components/painel/TabelaFaixasCep";
import { TabelaFaixasEntrega } from "@/components/painel/TabelaFaixasEntrega";
import { criarGravadorComVersao, type GravadorComVersao } from "@/components/painel/gravacaoZonas";
import { AvisoConflitoZonas, type PropsEditorZonas } from "@/components/painel/pecasEntrega";
import type {
  salvarModalidadesEntrega as salvarModalidadesLojista,
  salvarZonasEntrega as salvarZonasLojista,
} from "@/lib/actions/entrega";
import type { DadosModalidadesEntrega } from "@/lib/validacoes/entrega";
import type { ZonaVitrine } from "@/lib/supabase/queries/entregaPagamento";
import {
  formaGravadaDasZonas,
  formaInicialDaTela,
  type FormaFrete,
  type FormaGravada,
} from "@/lib/utils/formaFrete";

export type EntregasClientProps = {
  zonas: ZonaVitrine[];
  /** `lojas.versao_zonas_entrega`, lida junto das zonas (issue 328). */
  versao: number;
  /**
   * A loja tem endereço geocodificado? Boolean derivado no servidor — o par
   * de coordenadas nunca chega ao client (seguranca.md §19, issue 327).
   */
  temCoordenadas: boolean;
  /** Rota de Perfil (painel ou hub admin) para o aviso de endereço. */
  hrefPerfil: string;
  /** Modalidades GRAVADAS da loja (spec modalidades-entrega-loja). */
  modalidades: DadosModalidadesEntrega;
  /** `lojas.taxa_entrega_fora_zona` — aviso D4 das modalidades e copy do limite (326, D7). */
  taxaForaZona: number | null;
  /**
   * Actions injetadas. OBRIGATÓRIAS (issue 160): a page do painel passa as do
   * lojista, a via admin passa as variantes escopadas por `lojaId`. Sem default —
   * omitir uma prop aqui quebra o build em vez de gravar na loja errada.
   */
  acoes: {
    salvarModalidades: typeof salvarModalidadesLojista;
    salvarZonas: typeof salvarZonasLojista;
  };
};

/**
 * Tela de entregas (issues 325/327/328). O lojista escolhe UMA forma de cobrar
 * (faixas de km, faixas de CEP ou bairros) e edita só ela; a primeira gravação
 * numa forma diferente da que vale hoje pede confirmação e a RPC substitui todas
 * as zonas da loja. Nada é apagado ao abrir nem ao trocar de opção.
 *
 * Os três editores ficam MONTADOS (só o visível sem `hidden`): trocar de opção
 * não perde o estado local já gravado nem reabre com zonas velhas da carga.
 */
export function EntregasClient({
  zonas,
  versao,
  temCoordenadas,
  hrefPerfil,
  modalidades,
  taxaForaZona,
  acoes,
}: EntregasClientProps) {
  const gravadaNaCarga = useMemo(() => formaGravadaDasZonas(zonas), [zonas]);

  const [formaVisivel, setFormaVisivel] = useState<FormaFrete>(() => formaInicialDaTela(gravadaNaCarga));
  const [formaGravada, setFormaGravada] = useState<FormaGravada>(gravadaNaCarga);
  const [gravouNestaSessao, setGravouNestaSessao] = useState(false);
  const [conflito, setConflito] = useState(false);

  const acoesRef = useRef(acoes);
  useEffect(() => {
    acoesRef.current = acoes;
  }, [acoes]);

  // Versão otimista corrente: cada gravação sai com a versão devolvida pela
  // anterior; no conflito o gravador para de chamar o servidor. A comparação é
  // no banco (RPC), não aqui. Criado na 1ª gravação (sempre num handler, nunca
  // no render) e reusado pelos três editores: uma versão só para a tela.
  const versaoDaCarga = useRef(versao);
  const gravadorRef = useRef<GravadorComVersao | null>(null);
  const salvarZonas: PropsEditorZonas["salvar"] = (dados) => {
    gravadorRef.current ??= criarGravadorComVersao({
      acao: (p) => acoesRef.current.salvarZonas(p),
      versaoInicial: versaoDaCarga.current,
      aoConflito: () => setConflito(true),
    });
    return gravadorRef.current.salvar(dados);
  };

  const zonasDaForma = useMemo(
    () => ({
      raio_km: gravadaNaCarga === "raio_km" || gravadaNaCarga === "mista" ? zonas : [],
      faixa_cep: gravadaNaCarga === "faixa_cep" ? zonas : [],
      bairro: gravadaNaCarga === "bairro" ? zonas : [],
    }),
    [gravadaNaCarga, zonas],
  );
  const zonasParaConfirmacao = useMemo(() => (gravouNestaSessao ? [] : zonas), [gravouNestaSessao, zonas]);

  function aoGravar(forma: FormaFrete, itens: number) {
    setFormaGravada(itens === 0 ? "nenhuma" : forma);
    setGravouNestaSessao(true);
  }

  const comuns: Omit<PropsEditorZonas, "zonasIniciais"> = {
    formaGravada,
    zonasParaConfirmacao,
    salvar: salvarZonas,
    aoGravar,
    bloqueado: conflito,
    taxaForaZona,
  };

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-6">
      <ModalidadesEntrega
        inicial={modalidades}
        zonas={zonas}
        taxaForaZona={taxaForaZona}
        salvar={acoes.salvarModalidades}
      />

      <h1 className="mb-2 font-heading text-xl font-semibold text-foreground">
        Zonas de entrega
      </h1>
      {/* As zonas ficam guardadas mesmo quando não são usadas: religar a
          entrega ou voltar ao frete calculado não exige recadastrar nada. */}
      <p className="mb-6 text-sm text-muted-foreground">
        {!modalidades.aceita_entrega
          ? "A entrega está desligada. As zonas ficam guardadas para quando você religar."
          : modalidades.modo_frete === "a_combinar"
            ? "O frete está sendo combinado no WhatsApp. As zonas ficam guardadas para quando você voltar ao frete calculado."
            : "O frete de cada pedido é calculado por estas zonas."}
      </p>

      <SeletorFormaFrete valor={formaVisivel} gravada={formaGravada} aoMudar={setFormaVisivel} />

      {conflito && <AvisoConflitoZonas />}

      <div hidden={formaVisivel !== "raio_km"}>
        <TabelaFaixasEntrega
          {...comuns}
          zonasIniciais={zonasDaForma.raio_km}
          temCoordenadas={temCoordenadas}
          hrefPerfil={hrefPerfil}
        />
      </div>
      <div hidden={formaVisivel !== "faixa_cep"}>
        <TabelaFaixasCep {...comuns} zonasIniciais={zonasDaForma.faixa_cep} />
      </div>
      <div hidden={formaVisivel !== "bairro"}>
        <TabelaBairrosEntrega {...comuns} zonasIniciais={zonasDaForma.bairro} />
      </div>
    </main>
  );
}
