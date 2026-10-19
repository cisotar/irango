"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { ModalidadesEntrega } from "@/components/painel/ModalidadesEntrega";
import { SeletorFormaFrete } from "@/components/painel/SeletorFormaFrete";
import { EditorBairros } from "@/components/painel/EditorBairros";
import { TabelaFaixasCep } from "@/components/painel/TabelaFaixasCep";
import { TabelaFaixasEntrega } from "@/components/painel/TabelaFaixasEntrega";
import { criarGravadorComVersao, type GravadorComVersao } from "@/components/painel/gravacaoZonas";
import { AvisoConflitoZonas, AvisoUsarForma, type PropsEditorZonas } from "@/components/painel/pecasEntrega";
import type {
  definirFormaFrete as definirFormaLojista,
  salvarModalidadesEntrega as salvarModalidadesLojista,
  salvarZonasEntrega as salvarZonasLojista,
} from "@/lib/actions/entrega";
import { MENSAGEM_ERRO_FORMA_FRETE, type DadosModalidadesEntrega } from "@/lib/validacoes/entrega";
import type { ZonaVitrine } from "@/lib/supabase/queries/entregaPagamento";
import { temZonaQueCobra, type ZonaResumo } from "@/lib/utils/modalidadesEntrega";
import { zonasDaForma, zonasResumoDoPayload, type FormaFrete } from "@/lib/utils/formaFrete";

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
    /** Ativa a forma (botão "Usar esta forma", RPC `definir_forma_frete`). */
    definirForma: typeof definirFormaLojista;
  };
};

/**
 * Tela de entregas (issues 325/327/328). O lojista escolhe UMA forma de cobrar
 * (faixas de km, faixas de CEP ou bairros) e edita só ela. Salvar numa forma só
 * guarda as zonas dela; a vitrine passa a cobrar por ela quando o lojista
 * clica "Usar esta forma" (mesma versão otimista). As zonas das outras formas
 * ficam guardadas e voltar para uma delas é só clicar o botão. Nada é apagado
 * ao abrir, ao trocar de opção nem ao salvar outra forma.
 *
 * Os três editores ficam MONTADOS (só o visível sem `hidden`): trocar de opção
 * não perde o estado local já gravado nem reabre com zonas velhas da carga. O
 * de bairros (`EditorBairros`) tem duas vistas e remonta a escolhida com as
 * zonas já salvas.
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
  const [formaVisivel, setFormaVisivel] = useState<FormaFrete>(forma);
  // Forma que a vitrine cobra: a da carga e, depois, só a que o botão "Usar
  // esta forma" ativou com sucesso. Gravar zonas NUNCA muda a forma ativa.
  const [formaAtiva, setFormaAtiva] = useState<FormaFrete>(forma);
  // Resumo das zonas de CADA forma: o da carga e, depois de cada gravação, o
  // do payload aceito (a RPC regrava as zonas da forma com ele). Lido pelo
  // aviso das modalidades (forma ativa) e pelo bloqueio do botão (forma
  // visível), sem esperar recarregar a página.
  const [resumoPorForma, setResumoPorForma] = useState<Record<FormaFrete, ZonaResumo[]>>(() => ({
    raio_km: zonasDaForma(zonas, "raio_km"),
    faixa_cep: zonasDaForma(zonas, "faixa_cep"),
    bairro: zonasDaForma(zonas, "bairro"),
  }));
  // Escolha de entrega/frete na tela (salva ou não): decide se as zonas aparecem.
  const [escolha, setEscolha] = useState(modalidades);
  const [conflito, setConflito] = useState(false);
  const [ativando, setAtivando] = useState(false);

  const acoesRef = useRef(acoes);
  useEffect(() => {
    acoesRef.current = acoes;
  }, [acoes]);

  // Versão otimista corrente: cada gravação sai com a versão devolvida pela
  // anterior; no conflito o gravador para de chamar o servidor. A comparação é
  // no banco (RPC), não aqui. Criado na 1ª gravação ou ativação (sempre num
  // handler, nunca no render) e reusado pelos três editores e pelo botão "Usar
  // esta forma": uma versão e uma fila só para a tela.
  const versaoDaCarga = useRef(versao);
  const gravadorRef = useRef<GravadorComVersao | null>(null);
  function gravador(): GravadorComVersao {
    gravadorRef.current ??= criarGravadorComVersao({
      acao: (p) => acoesRef.current.salvarZonas(p),
      acaoAtivar: (p) => acoesRef.current.definirForma(p),
      versaoInicial: versaoDaCarga.current,
      aoConflito: () => setConflito(true),
    });
    return gravadorRef.current;
  }
  const salvarZonas: PropsEditorZonas["salvar"] = (dados) => gravador().salvar(dados);

  // Botão "Usar esta forma": conflito é coberto pelo AvisoConflitoZonas; outro
  // erro (forma sem zona, falha) vira toast com a mensagem da action.
  async function usarForma() {
    if (ativando) return;
    const alvo = formaVisivel;
    setAtivando(true);
    try {
      const resultado = await gravador().ativar(alvo);
      if (resultado.ok) setFormaAtiva(alvo);
      else if (!resultado.conflito) toast.error(resultado.erro);
    } catch {
      toast.error(MENSAGEM_ERRO_FORMA_FRETE);
    } finally {
      setAtivando(false);
    }
  }

  // Cada editor abre com as zonas guardadas da SUA forma (325).
  const zonasPorForma = useMemo(
    () => ({
      raio_km: zonasDaForma(zonas, "raio_km"),
      faixa_cep: zonasDaForma(zonas, "faixa_cep"),
      bairro: zonasDaForma(zonas, "bairro"),
    }),
    [zonas],
  );

  const comuns: Omit<PropsEditorZonas, "zonasIniciais" | "ehAtiva"> = {
    salvar: salvarZonas,
    // Atualiza só o resumo da forma do payload; a forma ativa NÃO muda.
    aoGravar: (payload) =>
      setResumoPorForma((atual) => ({ ...atual, [payload.forma]: zonasResumoDoPayload(payload) })),
    bloqueado: conflito,
    taxaForaZona,
  };

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-6">
      <ModalidadesEntrega
        inicial={modalidades}
        // Só as zonas da forma ATIVA dizem se a entrega está disponível.
        zonas={resumoPorForma[formaAtiva]}
        taxaForaZona={taxaForaZona}
        salvar={acoes.salvarModalidades}
        aoMudar={setEscolha}
      />

      {/* Sem entrega ou com frete a combinar, as zonas não são usadas: a
          configuração some da tela assim que o lojista escolhe, mas continua
          montada e guardada; religar não exige recadastrar nada. */}
      <div hidden={!escolha.aceita_entrega || escolha.modo_frete === "a_combinar"}>
        <h1 className="mb-2 font-heading text-xl font-semibold text-foreground">
          Zonas de entrega
        </h1>
        <p className="mb-6 text-sm text-muted-foreground">
          O frete de cada pedido é calculado por estas zonas.
        </p>

        <SeletorFormaFrete valor={formaVisivel} ativa={formaAtiva} aoMudar={setFormaVisivel} />

        {conflito && <AvisoConflitoZonas />}

        <AvisoUsarForma
          forma={formaVisivel}
          formaAtiva={formaAtiva}
          podeUsar={temZonaQueCobra(resumoPorForma[formaVisivel])}
          ativando={ativando}
          aoUsar={() => void usarForma()}
          bloqueado={conflito}
        />

        <div hidden={formaVisivel !== "raio_km"}>
          <TabelaFaixasEntrega
            {...comuns}
            zonasIniciais={zonasPorForma.raio_km}
            ehAtiva={formaAtiva === "raio_km"}
            temCoordenadas={temCoordenadas}
            hrefPerfil={hrefPerfil}
          />
        </div>
        <div hidden={formaVisivel !== "faixa_cep"}>
          <TabelaFaixasCep
            {...comuns}
            zonasIniciais={zonasPorForma.faixa_cep}
            ehAtiva={formaAtiva === "faixa_cep"}
          />
        </div>
        <div hidden={formaVisivel !== "bairro"}>
          <EditorBairros
            {...comuns}
            zonasIniciais={zonasPorForma.bairro}
            ehAtiva={formaAtiva === "bairro"}
          />
        </div>
      </div>
    </main>
  );
}
