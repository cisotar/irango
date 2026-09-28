"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";

import {
  criarRefreshCoalescido,
  type RefreshCoalescido,
} from "@/lib/utils/refresh-coalescido";

/**
 * Um refresh coalescido COMPARTILHADO por todos os selos de uma lista (issue 329,
 * spec "Volume alto"): 10 mudanças de status em linhas diferentes viram UM
 * `router.refresh()` quando a fila de Server Actions esvazia. Cada selo tem seu
 * próprio estado otimista; só o refresh é comum.
 *
 * O `router.refresh()` desta árvore só é chamado daqui (via o núcleo puro
 * `criarRefreshCoalescido`).
 */
const ContextoRefreshCoalescido = createContext<RefreshCoalescido | null>(null);

/** `null` fora de um provedor: quem consome trata como "sem refresh". */
export function useRefreshCoalescido(): RefreshCoalescido | null {
  return useContext(ContextoRefreshCoalescido);
}

const semInscricao = () => () => {};

/**
 * Coalescido cujo alvo (`router.refresh`) é ligado depois, só no cliente. Antes
 * de ligar, o refresh é no-op (não há o que recarregar sem App Router).
 */
function criarRefreshLigavel() {
  let alvo: () => void = () => {};
  return {
    coalescido: criarRefreshCoalescido({ refresh: () => alvo() }),
    ligar(refresh: () => void) {
      alvo = refresh;
    },
  };
}

export function ProvedorRefreshCoalescido({ children }: { children: ReactNode }) {
  const [{ coalescido, ligar }] = useState(criarRefreshLigavel);
  // O refresh só existe para o gesto do lojista, depois da hidratação. O
  // router é ligado só no cliente: no SSR e no render estático (testes em
  // `environment: node`) não há App Router montado e nada precisa dele.
  const noCliente = useSyncExternalStore(
    semInscricao,
    () => true,
    () => false,
  );

  return (
    <ContextoRefreshCoalescido.Provider value={coalescido}>
      {noCliente && <LigarRouter ligar={ligar} />}
      {children}
    </ContextoRefreshCoalescido.Provider>
  );
}

function LigarRouter({ ligar }: { ligar: (refresh: () => void) => void }) {
  const router = useRouter();
  useEffect(() => {
    ligar(() => router.refresh());
  }, [router, ligar]);
  return null;
}
