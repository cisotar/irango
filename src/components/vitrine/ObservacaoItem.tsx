// [197] Observação livre que o COMPRADOR escreve por item ("sem cebola",
// "ponto da carne"). O dado já existe ponta a ponta (`itens_pedido.observacao`,
// issues 167/168) e até aqui só aparecia na mensagem de WhatsApp — nunca nas
// três telas do comprador: gaveta (`Carrinho`), checkout (`EtapaItens`) e
// confirmação.
//
// Espelha `ListaOpcionaisItem`: puramente apresentacional, recebe o texto já
// pronto e não sabe de onde vem (preview do carrinho ou snapshot lido por
// token). Vazia / só espaços / só quebras → não renderiza NADA, para não
// deixar um rótulo "Obs" órfão.
//
// SEGURANÇA (seguranca.md §15): texto do cliente entra como FILHO de JSX —
// o React escapa. Nunca `dangerouslySetInnerHTML`, nunca em href/src/atributo.

export type ObservacaoItemProps = {
  observacao: string | null | undefined;
  className?: string;
};

export function ObservacaoItem({ observacao, className }: ObservacaoItemProps) {
  const texto = observacao?.trim() ?? "";
  if (texto === "") return null;

  return (
    <p
      className={[
        "mt-0.5 whitespace-pre-line text-xs text-muted-foreground",
        className ?? "",
      ].join(" ")}
    >
      <span className="font-medium">Obs:</span> {texto}
    </p>
  );
}
