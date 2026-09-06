/**
 * Montagem do payload de perfil (issue 040 / 123).
 *
 * Função PURA extraída do `PerfilClient` para ser testável sem DOM: o projeto
 * não tem jsdom/@testing-library, então enquanto ela vivia dentro do componente
 * (fechando sobre o `useState` e só executando no submit do form) a regra mais
 * valiosa do arquivo — o booleano do envio automático SEMPRE presente — não
 * tinha como ser coberta. Aqui os campos entram como argumento e o componente
 * só passa o estado; o comportamento é idêntico.
 *
 * A saída é entrada de `schemaPerfil.safeParse` (mesmo schema do servidor) —
 * o `.strict()` de lá é quem reprova chave extra.
 */

/** Mantém apenas dígitos. */
export function apenasDigitos(s: string): string {
  return s.replace(/\D/g, "");
}

/** Campos do form de perfil, como o usuário digitou (mascarados, sem trim). */
export type CamposPerfil = {
  nome: string;
  slug: string;
  /** Telefone como está na máscara; normalizado para dígitos aqui. */
  telefone: string;
  /** WhatsApp NACIONAL como está na máscara; ganha o prefixo `55` aqui. */
  whatsapp: string;
  envioAutomatico: boolean;
  enderecoCep: string;
  enderecoRua: string;
  enderecoNumero: string;
  enderecoBairro: string;
  enderecoCidade: string;
  enderecoEstado: string;
};

/**
 * Monta o payload enviado à Server Action de perfil.
 *
 * Campos de texto vazios são OMITIDOS (spread condicional): o schema os trata
 * como `.optional()` e a action preserva o valor gravado.
 */
export function montarPayloadPerfil(campos: CamposPerfil) {
  const whatsappDigitos = apenasDigitos(campos.whatsapp);
  const telefoneDigitos = apenasDigitos(campos.telefone);
  return {
    nome: campos.nome.trim(),
    slug: campos.slug.trim(),
    ...(telefoneDigitos ? { telefone: telefoneDigitos } : {}),
    ...(whatsappDigitos ? { whatsapp: `55${whatsappDigitos}` } : {}),
    // Booleano SEMPRE presente (nunca spread condicional): com `...(x ? … : {})`
    // o `false` seria omitido e o lojista jamais conseguiria DESLIGAR o envio.
    whatsapp_envio_automatico: campos.envioAutomatico,
    ...(campos.enderecoCep.trim() ? { endereco_cep: campos.enderecoCep.trim() } : {}),
    ...(campos.enderecoRua.trim() ? { endereco_rua: campos.enderecoRua.trim() } : {}),
    ...(campos.enderecoNumero.trim()
      ? { endereco_numero: campos.enderecoNumero.trim() }
      : {}),
    ...(campos.enderecoBairro.trim()
      ? { endereco_bairro: campos.enderecoBairro.trim() }
      : {}),
    ...(campos.enderecoCidade.trim()
      ? { endereco_cidade: campos.enderecoCidade.trim() }
      : {}),
    ...(campos.enderecoEstado.trim()
      ? { endereco_estado: campos.enderecoEstado.trim() }
      : {}),
  };
}
