/**
 * Ponte entre um timestamp ISO (com offset, vindo do banco) e o valor cru de um
 * `<input type="datetime-local">` (`"YYYY-MM-DDTHH:MM"`, SEM fuso).
 *
 * Função PURA de apresentação para os forms do painel (cupom, modal sazonal):
 * preenche o campo com a data/hora no fuso LOCAL do navegador do lojista, que é
 * como o `datetime-local` a exibe e a devolve. O caminho de volta (local → ISO)
 * é `new Date(local).toISOString()`, resolvido no `montarPayload` de cada form.
 *
 * Nulo/vazio/inválido → "" (o campo fica em branco; o schema reprova o envio).
 */
export function isoParaDatetimeLocal(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
