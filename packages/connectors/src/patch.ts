// Aplica o diff da correção (etapa 10) sobre os arquivos da versão revisada, sem git: o rascunho é montado
// pela API do GitHub. Estrito: o contexto tem de bater na linha exata (a base é a mesma versão revisada), e
// só aceita o que `checkFixDiff` deixa passar: arquivo alterado ou arquivo novo de texto.

export class PatchError extends Error {
  override name = "PatchError";
}

export interface PatchedFile {
  path: string;
  /** Arquivo novo (não existia na base). */
  added: boolean;
  content: string;
}

interface Hunk {
  oldStart: number;
  oldLen: number;
  lines: { kind: " " | "-" | "+"; text: string; noEol: boolean }[];
}

interface FilePatch {
  path: string;
  added: boolean;
  hunks: Hunk[];
}

const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

function parse(patch: string): FilePatch[] {
  const files: FilePatch[] = [];
  let cur: FilePatch | null = null;
  let hunk: Hunk | null = null;
  for (const line of patch.replace(/\r?\n$/, "").split("\n")) {
    const header = /^diff --git "?a\/(.+?)"? "?b\/(.+?)"?$/.exec(line);
    if (header) {
      cur = { path: header[2]!, added: false, hunks: [] };
      files.push(cur);
      hunk = null;
      continue;
    }
    if (!cur) continue;
    const h = HUNK.exec(line);
    if (h) {
      hunk = { oldStart: Number(h[1]), oldLen: h[2] === undefined ? 1 : Number(h[2]), lines: [] };
      cur.hunks.push(hunk);
      continue;
    }
    if (hunk && (line[0] === " " || line[0] === "-" || line[0] === "+")) {
      hunk.lines.push({ kind: line[0], text: line.slice(1), noEol: false });
      continue;
    }
    if (hunk && line.startsWith("\\")) {
      const last = hunk.lines.at(-1);
      if (last) last.noEol = true;
      continue;
    }
    hunk = null;
    if (line.startsWith("new file mode") || line === "--- /dev/null") cur.added = true;
    else if (line.startsWith("deleted file mode") || line.startsWith("rename ") || line.startsWith("old mode") || line.startsWith("Binary files") || line.startsWith("GIT binary patch"))
      throw new PatchError(`mudança não suportada em ${cur.path}`);
    else if (line.startsWith("+++ ") && line.slice(4).trim() === "/dev/null") throw new PatchError(`remoção não suportada: ${cur.path}`);
  }
  return files;
}

function applyOne(original: string | null, fp: FilePatch): string {
  if (fp.added && original !== null) throw new PatchError(`${fp.path} já existe na base`);
  if (!fp.added && original === null) throw new PatchError(`${fp.path} não existe na base`);
  const src = original ?? "";
  const lines = src === "" ? [] : src.split("\n");
  let eol = true;
  if (lines.length && lines.at(-1) === "") lines.pop();
  else if (lines.length) eol = false;

  const out: string[] = [];
  let pos = 0; // próxima linha da base ainda não copiada (0-based)
  let newEol = eol;
  for (const h of fp.hunks) {
    const start = h.oldLen === 0 ? h.oldStart : h.oldStart - 1;
    if (start < pos || start > lines.length) throw new PatchError(`trecho fora de ordem em ${fp.path}`);
    out.push(...lines.slice(pos, start));
    pos = start;
    let lastNoEol = false;
    for (const l of h.lines) {
      if (l.kind !== "+") {
        if (lines[pos] !== l.text) throw new PatchError(`o contexto não bate em ${fp.path}, linha ${pos + 1}`);
        pos++;
      }
      if (l.kind !== "-") {
        out.push(l.text);
        lastNoEol = l.noEol;
      }
    }
    // O trecho que chega ao fim do arquivo decide se o arquivo novo termina com quebra de linha.
    if (pos === lines.length) newEol = !lastNoEol;
  }
  out.push(...lines.slice(pos));
  if (out.length === 0) return "";
  return out.join("\n") + (newEol ? "\n" : "");
}

/**
 * Aplica um diff unificado do git. `read` devolve o conteúdo do arquivo na base, ou null se não existir.
 * Qualquer divergência falha com PatchError: nunca aplica pela metade nem "aproxima" o contexto.
 */
export async function applyPatch(patch: string, read: (path: string) => Promise<string | null>): Promise<PatchedFile[]> {
  const files = parse(patch);
  if (files.length === 0) throw new PatchError("diff vazio");
  const out: PatchedFile[] = [];
  for (const fp of files) {
    if (fp.hunks.length === 0) throw new PatchError(`sem alterações em ${fp.path}`);
    const original = await read(fp.path);
    out.push({ path: fp.path, added: fp.added, content: applyOne(original, fp) });
  }
  return out;
}
