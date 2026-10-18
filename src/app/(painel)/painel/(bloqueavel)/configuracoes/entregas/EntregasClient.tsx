"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { ModalidadesEntrega } from "@/components/painel/ModalidadesEntrega";
import { SeletorFormaFrete } from "@/components/painel/SeletorFormaFrete";
import { TabelaBairrosEntrega } from "@/components/painel/TabelaBairrosEntrega";
import { TabelaFaixasCep } from "@/components/painel/TabelaFaixasCep";
import { TabelaFaixasEntrega } from "@/components/painel/TabelaFaixasEntrega";
import { criarGravadorComVersao, type GravadorComVersao } from "@/components/painel/gravacaoZonas";
import { AvisoConflitoZonas, AvisoUsarForma, type PropsEditorZonas } from "@/components/painel/pecasEntrega";
import type {
  salvarModalidadesEntrega as salvarModalidadesLojista,
  salvarZonasEntrega as salvarZonasLojista,
} from "@/lib/actions/entrega";
import type { DadosModalidadesEntrega } from "@/lib/validacoes/entrega";
import type { ZonaVitrine } from "@/lib/supabase/queries/entregaPagamento";
import { formaInicialDaTela, zonasDaForma, type FormaFrete } from "@/lib/utils/formaFrete";

export type EntregasClientProps = {
  /** Zonas guardadas das TRÊS formas (`listarZonasParaEdicao`, issue 325). */
  zonas: ZonaVitrine[];
  /** `lojas.forma_frete`: a forma que a vitrine cobra hoje, lida junto das zonas. */
  forma: FormaFrete;
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
 * (faixas de km, faixas de CEP ou bairros) e edita só ela. Salvar numa forma
 * ativa essa forma na vitrine; as zonas das outras formas ficam guardadas e
 * voltam intactas quando o lojista volta para elas. Nada é apagado ao abrir,
 * ao trocar de opção nem ao salvar outra forma.
 *
 * Os três editores ficam MONTADOS (só o visível sem `hidden`): trocar de opção
 * não perde o estado local já gravado nem reabre com zonas velhas da carga.
 */
export function EntregasClient({
  zonas,
  forma,
  versao,
  temCoordenadas,
  hrefPerfil,
  modalidades,
  taxaForaZona,
  acoes,
}: EntregasClientProps) {
  const [formaVisivel, setFormaVisivel] = useState<FormaFrete>(() => formaInicialDaTela(forma));
  // Forma que a vitrine cobra: a da carga e, depois de cada gravação, a salva
  // (a RPC grava `forma_frete = p_forma` no mesmo UPDATE da versão).
  const [formaAtiva, setFormaAtiva] = useState<FormaFrete>(forma);
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

  // Cada editor abre com as zonas guardadas da SUA forma (325).
  const zonasPorForma = useMemo(
    () => ({
      raio_km: zonasDaForma(zonas, "raio_km"),
      faixa_cep: zonasDaForma(zonas, "faixa_cep"),
      bairro: zonasDaForma(zonas, "bairro"),
    }),
    [zonas],
  );

  const comuns: Omit<PropsEditorZonas, "zonasIniciais"> = {
    salvar: salvarZonas,
    aoGravar: setFormaAtiva,
    bloqueado: conflito,
    taxaForaZona,
  };

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-6">
      <ModalidadesEntrega
        inicial={modalidades}
        // Só as zonas da forma ATIVA dizem se a entrega está disponível.
        zonas={zonasPorForma[formaAtiva]}
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

      <SeletorFormaFrete valor={formaVisivel} ativa={formaAtiva} aoMudar={setFormaVisivel} />

      {conflito && <AvisoConflitoZonas />}

      <AvisoUsarForma forma={formaVisivel} formaAtiva={formaAtiva} />

      <div hidden={formaVisivel !== "raio_km"}>
        <TabelaFaixasEntrega
          {...comuns}
          zonasIniciais={zonasPorForma.raio_km}
          temCoordenadas={temCoordenadas}
          hrefPerfil={hrefPerfil}
        />
      </div>
      <div hidden={formaVisivel !== "faixa_cep"}>
        <TabelaFaixasCep {...comuns} zonasIniciais={zonasPorForma.faixa_cep} />
      </div>
      <div hidden={formaVisivel !== "bairro"}>
        <TabelaBairrosEntrega {...comuns} zonasIniciais={zonasPorForma.bairro} />
      </div>
    </main>
  );
}
