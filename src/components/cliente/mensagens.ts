// Mensagens de campo compartilhadas pelos forms do cliente.
export const MSG_CAMPO = "Preencha este campo corretamente.";

/** Erro do campo senha (regra do cadastro: 8–72). */
export const mensagemErroSenha = (senha: string) =>
  senha.length < 8 ? "Mínimo de 8 caracteres." : MSG_CAMPO;
