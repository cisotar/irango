#!/usr/bin/env node
// Guarda PreToolUse (matcher Bash) do iRango. Impõe em código as regras de
// higiene do CLAUDE.md que, só em prosa, dependem de o modelo lembrar delas:
//   deny — git add em massa (-A, --all, ., :/, *, pathspec mágico)
//   deny — git add -f/--force (o .gitignore é o que protege .env* e o relatório)
//   deny — git add de .env* (exceto .env.example) ou plan/seguranca-auditoria-*
//   deny — git update-index --add (contorna o .gitignore)
//   deny — desligar o pre-commit: commit --no-verify/-n, git -c core.hooksPath=…, git config core.hooksPath
//   ask  — supabase db push|reset, migration up|repair (banco de produção, irreversível)
//   ask  — git add -u / git commit -a (stage de todos os rastreados de uma vez)
//
// Por que node e não regex em bash: o comando precisa ser lido como o shell lê
// (aspas, escapes, heredoc, $(...), prefixos como env/xargs/sudo). Texto dentro
// de aspas ou de heredoc não é comando, então mensagem de commit que cita estes
// comandos não é barrada. deny sempre vence ask, mesmo em segmento posterior.
//
// Falhas: erro interno bloqueia (exit 2). Payload ilegível libera, porque não há
// comando a julgar. Sem node no PATH o hook falha sem bloquear: o harness mostra
// o erro. Limite: é análise de texto. Não pega cópia de conteúdo para outro
// arquivo, variáveis, aliases nem scripts; a camada que vê o que está staged de
// fato é um hook de pre-commit do git. Regressão: guard-bash.test.mjs.

const MOTIVO = {
  massa: "git add em massa (-A, --all, ., :/, *, pathspec mágico) é proibido neste repo: liste os arquivos explicitamente (CLAUDE.md, Higiene).",
  force: "git add -f/--force ignora o .gitignore, que é o que protege .env* e plan/seguranca-auditoria-*: proibido para o agente.",
  env: "Nunca commitar .env* (só .env.example). CLAUDE.md, Higiene.",
  relatorio: "plan/seguranca-auditoria-*.md é relatório de pentest com PoC: fica só local, nunca vai para o git. CLAUDE.md, Higiene.",
  semHook: "Pular ou trocar o pre-commit (--no-verify, -n, core.hooksPath) é proibido para o agente: o hook em .githooks/ é a camada que impede .env* e relatório de pentest de entrar no git.",
  updateIndex: "git update-index --add contorna o .gitignore: use git add com caminhos explícitos.",
  rastreados: "Isto coloca no stage todos os arquivos rastreados modificados de uma vez: confirme que todos pertencem a este commit.",
  banco: (acao) => `supabase ${acao} altera o banco de produção e é irreversível: confirme a migration (aditiva/segura) e autorize explicitamente.`,
};

// Divide o comando em segmentos (listas de palavras já sem aspas), como o shell:
// corta em ; & | ( ) { } ` $( e quebra de linha fora de aspas, descarta corpo de
// heredoc e comentário, junta continuação de linha. Substituições $(...) e `...`
// dentro de aspas duplas são executadas pelo shell: vão para `extras` e são
// analisadas como comando.
function segmentar(cmd) {
  const segs = [];
  const extras = [];
  let palavras = [];
  let atual = null;
  let heredocs = [];
  const fecharPalavra = () => {
    if (atual !== null) palavras.push(atual);
    atual = null;
  };
  const fecharSeg = () => {
    fecharPalavra();
    if (palavras.length) segs.push(palavras);
    palavras = [];
  };
  const ate = (j, fechar) => {
    let prof = 1;
    let k = j;
    for (; k < cmd.length; k++) {
      if (fechar === ")" && cmd[k] === "(") prof++;
      if (cmd[k] === fechar && --prof === 0) break;
    }
    return k;
  };

  let i = 0;
  while (i < cmd.length) {
    const c = cmd[i];
    if (c === "\\") {
      if (cmd[i + 1] !== "\n") atual = (atual ?? "") + (cmd[i + 1] ?? "");
      i += 2;
      continue;
    }
    if (c === "'") {
      const f = cmd.indexOf("'", i + 1);
      const fim = f < 0 ? cmd.length : f;
      atual = (atual ?? "") + cmd.slice(i + 1, fim);
      i = fim + 1;
      continue;
    }
    if (c === '"') {
      let j = i + 1;
      let s = "";
      while (j < cmd.length && cmd[j] !== '"') {
        if (cmd[j] === "\\" && j + 1 < cmd.length && '"\\$`\n'.includes(cmd[j + 1])) {
          if (cmd[j + 1] !== "\n") s += cmd[j + 1];
          j += 2;
        } else if (cmd[j] === "$" && cmd[j + 1] === "(") {
          const k = ate(j + 2, ")");
          extras.push(cmd.slice(j + 2, k));
          s += "_";
          j = k + 1;
        } else if (cmd[j] === "`") {
          const k = ate(j + 1, "`");
          extras.push(cmd.slice(j + 1, k));
          s += "_";
          j = k + 1;
        } else {
          s += cmd[j++];
        }
      }
      atual = (atual ?? "") + s;
      i = j + 1;
      continue;
    }
    if (c === "<" && cmd[i + 1] === "<" && cmd[i + 2] !== "<") {
      fecharPalavra();
      let j = i + 2;
      const tiraTab = cmd[j] === "-";
      if (tiraTab) j++;
      while (cmd[j] === " " || cmd[j] === "\t") j++;
      let d = "";
      while (j < cmd.length && !/[\s;&|()<>]/.test(cmd[j])) {
        if (!`'"\\`.includes(cmd[j])) d += cmd[j];
        j++;
      }
      if (d) heredocs.push({ d, tiraTab });
      i = j;
      continue;
    }
    if (c === "\n") {
      fecharSeg();
      i++;
      for (const h of heredocs) {
        while (i < cmd.length) {
          let fim = cmd.indexOf("\n", i);
          if (fim < 0) fim = cmd.length;
          const linha = cmd.slice(i, fim);
          i = fim + 1;
          if ((h.tiraTab ? linha.replace(/^\t+/, "") : linha) === h.d) break;
        }
      }
      heredocs = [];
      continue;
    }
    if (c === "$" && cmd[i + 1] === "(") {
      fecharSeg();
      i += 2;
      continue;
    }
    if (";&|(){}`".includes(c)) {
      fecharSeg();
      i++;
      continue;
    }
    if (c === " " || c === "\t" || c === "\r") {
      fecharPalavra();
      i++;
      continue;
    }
    if (c === "#" && atual === null) {
      const f = cmd.indexOf("\n", i);
      i = f < 0 ? cmd.length : f;
      continue;
    }
    atual = (atual ?? "") + c;
    i++;
  }
  fecharSeg();
  return { segs, extras };
}

const PREFIXOS = new Set([
  "!", "then", "do", "else", "elif", "if", "while", "until", "command", "builtin",
  "exec", "sudo", "nohup", "time", "env", "xargs", "nice", "stdbuf", "timeout",
]);
const nomeBase = (s) => s.split("/").pop();
const ehAtribuicao = (s) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(s);

// Remove o que vem antes do comando de fato: VAR=x, env, xargs -0, timeout 30...
function tirarPrefixos(w) {
  let i = 0;
  while (i < w.length) {
    if (ehAtribuicao(w[i])) {
      i++;
    } else if (PREFIXOS.has(w[i])) {
      i++;
      while (i < w.length && (w[i].startsWith("-") || /^[\d.]+[smhd]?$/.test(w[i]))) i++;
    } else {
      break;
    }
  }
  return w.slice(i);
}

const ehGlob = (s) => /[*?[]/.test(s);
function casaGlob(padrao, nome) {
  let re = "";
  for (let i = 0; i < padrao.length; i++) {
    const c = padrao[i];
    if (c === "*") re += "[^/]*";
    else if (c === "?") re += "[^/]";
    else if (c === "[") {
      const f = padrao.indexOf("]", i + 1);
      if (f < 0) {
        re += "\\[";
        continue;
      }
      let classe = padrao.slice(i + 1, f);
      if (classe.startsWith("!")) classe = "^" + classe.slice(1);
      re += "[" + classe.replace(/\\/g, "\\\\") + "]";
      i = f;
    } else re += c.replace(/[.+^${}()|\\]/g, "\\$&");
  }
  try {
    return new RegExp("^" + re + "$", "i").test(nome);
  } catch {
    return true;
  }
}

function checarCaminho(p, out) {
  const c = p.toLowerCase().replace(/^(\.\/)+/, "");
  if (["", ".", "*"].includes(c) || c.startsWith(":")) return out.negar(MOTIVO.massa);
  const base = nomeBase(c.replace(/\/+$/, ""));
  if (base.startsWith(".env") && base !== ".env.example") return out.negar(MOTIVO.env);
  if (c.includes("seguranca-auditoria") || c.includes("seguranca\\-auditoria")) return out.negar(MOTIVO.relatorio);
  if (ehGlob(c)) {
    if (["plan/seguranca-auditoria-2026-01-01.md"].some((n) => casaGlob(c, n)) ||
        casaGlob(base, "seguranca-auditoria-2026-01-01.md")) return out.negar(MOTIVO.relatorio);
    if ([".env", ".env.local", ".env.production"].some((n) => casaGlob(base, n))) return out.negar(MOTIVO.env);
  }
}

function analisarAdd(args, out) {
  let opcoes = true;
  for (const a of args) {
    if (opcoes && a === "--") {
      opcoes = false;
    } else if (opcoes && a.startsWith("--")) {
      const nome = a.slice(2).split("=")[0];
      if (!nome) continue;
      if ("force".startsWith(nome)) out.negar(MOTIVO.force);
      else if ("all".startsWith(nome) || nome === "no-ignore-removal" || nome === "pathspec-from-file") out.negar(MOTIVO.massa);
      else if ("update".startsWith(nome)) out.pedir(MOTIVO.rastreados);
    } else if (opcoes && /^-[a-zA-Z]+$/.test(a)) {
      if (a.includes("f")) out.negar(MOTIVO.force);
      if (a.includes("A")) out.negar(MOTIVO.massa);
      if (a.includes("u")) out.pedir(MOTIVO.rastreados);
    } else {
      checarCaminho(a, out);
    }
  }
}

function analisarCommit(args, out) {
  const comValor = new Set(["m", "F", "C", "c", "t"]);
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--") break;
    if (a === "--all") out.pedir(MOTIVO.rastreados);
    else if (a === "--no-verify") out.negar(MOTIVO.semHook);
    else if (/^-[a-zA-Z]+$/.test(a)) {
      for (const ch of a.slice(1)) {
        if (ch === "a") out.pedir(MOTIVO.rastreados);
        if (ch === "n") out.negar(MOTIVO.semHook);
        if (comValor.has(ch)) {
          if (a.endsWith(ch)) i++;
          break;
        }
      }
    }
  }
}

function analisarGit(args, out) {
  let i = 0;
  while (i < args.length && args[i].startsWith("-")) {
    if (args[i] === "-c" && /^core\.hookspath=/i.test(args[i + 1] ?? "")) out.negar(MOTIVO.semHook);
    if (/^--config-env=core\.hookspath/i.test(args[i])) out.negar(MOTIVO.semHook);
    i += ["-C", "-c", "--git-dir", "--work-tree", "--namespace"].includes(args[i]) ? 2 : 1;
  }
  const sub = args[i];
  const resto = args.slice(i + 1);
  if (sub === "add") analisarAdd(resto, out);
  else if (sub === "commit") analisarCommit(resto, out);
  else if (sub === "update-index" && resto.includes("--add")) out.negar(MOTIVO.updateIndex);
  else if (sub === "config") {
    const k = resto.findIndex((a) => /^core\.hookspath$/i.test(a));
    const leitura = resto.some((a) => /^(--get|--get-all|--get-regexp|--list|-l)$/.test(a));
    const remove = resto.some((a) => /^--(unset|unset-all|remove-section|replace-all)$/.test(a));
    // Ativar o hook do próprio repo (valor exato .githooks) é o que o `prepare` faz: permitido.
    const ativaHookDoRepo = k >= 0 && resto[k + 1] === ".githooks" && resto.length === k + 2 && !remove;
    if (k >= 0 && !leitura && !ativaHookDoRepo) out.negar(MOTIVO.semHook);
  }
}

function analisarSupabase(args, out) {
  const comValor = new Set(["--workdir", "--profile", "--db-url", "--password", "-p", "--schema", "-s", "--output", "-o", "--status"]);
  const nomes = [];
  for (let i = 0; i < args.length; i++) {
    if (comValor.has(args[i])) i++;
    else if (!args[i].startsWith("-")) nomes.push(args[i]);
  }
  const [grupo, acao] = nomes;
  const destrutivo =
    (grupo === "db" && (acao === "push" || acao === "reset")) ||
    (grupo === "migration" && (acao === "up" || acao === "repair"));
  if (!destrutivo) return;
  const simulacao = args.some((a) => a === "--dry-run" || a === "--dry-run=true");
  if (grupo === "db" && acao === "push" && simulacao) return;
  out.pedir(MOTIVO.banco(`${grupo} ${acao}`));
}

const LANCADORES = new Set(["npx", "bunx", "pnpx", "pnpm", "yarn", "npm"]);

function analisarSegmento(w0, out, prof) {
  const w = tirarPrefixos(w0);
  if (!w.length) return;
  const cmd = nomeBase(w[0]);
  if (cmd === "git") return analisarGit(w.slice(1), out);
  if (/^supabase(@.*)?$/.test(cmd)) return analisarSupabase(w.slice(1), out);
  if (LANCADORES.has(cmd)) {
    let i = 1;
    while (i < w.length && (w[i].startsWith("-") || ["dlx", "exec", "x"].includes(w[i]))) i++;
    if (/^supabase(@.*)?$/.test(nomeBase(w[i] ?? ""))) return analisarSupabase(w.slice(i + 1), out);
    return;
  }
  if (["bash", "sh", "zsh", "dash"].includes(cmd)) {
    const k = w.findIndex((a, j) => j > 0 && /^-[a-zA-Z]*c[a-zA-Z]*$/.test(a));
    if (k > 0 && w[k + 1] !== undefined) analisar(w[k + 1], out, prof + 1);
    return;
  }
  if (cmd === "eval") analisar(w.slice(1).join(" "), out, prof + 1);
}

function analisar(cmd, out, prof = 0) {
  if (prof > 4) return;
  const { segs, extras } = segmentar(cmd);
  for (const w of segs) analisarSegmento(w, out, prof);
  for (const e of extras) analisar(e, out, prof + 1);
}

function decidir(cmd) {
  const out = {
    negado: null,
    pedidos: [],
    negar(m) {
      this.negado ??= m;
    },
    pedir(m) {
      if (!this.pedidos.includes(m)) this.pedidos.push(m);
    },
  };
  analisar(cmd, out);
  if (out.negado) return { decisao: "deny", motivo: out.negado };
  if (out.pedidos.length) return { decisao: "ask", motivo: out.pedidos.join(" ") };
  return null;
}

let entrada = "";
process.stdin.on("data", (d) => (entrada += d));
process.stdin.on("end", () => {
  let cmd;
  try {
    cmd = JSON.parse(entrada)?.tool_input?.command;
  } catch {
    process.exit(0);
  }
  if (typeof cmd !== "string" || !cmd) process.exit(0);
  try {
    const r = decidir(cmd);
    if (r) {
      process.stdout.write(JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: r.decisao,
          permissionDecisionReason: r.motivo,
        },
      }));
    }
    process.exit(0);
  } catch (e) {
    process.stderr.write(`guard-bash: erro interno, bloqueando por segurança: ${e?.message ?? e}\n`);
    process.exit(2);
  }
});
