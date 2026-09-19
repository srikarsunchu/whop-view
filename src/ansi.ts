// A tiny layout engine: measure, pad, truncate, wrap. Escape-aware.

const ESC = /\x1b\[[0-9;]*m/g;

export const strip = (s: string) => s.replace(ESC, "");

/** Visible width. Treats East Asian wide and emoji as 2, combining marks as 0. */
export function width(s: string): number {
  let w = 0;
  for (const ch of strip(s)) {
    const cp = ch.codePointAt(0)!;
    if (cp < 32 || (cp >= 0x300 && cp <= 0x36f) || cp === 0x200d || (cp >= 0xfe00 && cp <= 0xfe0f)) continue;
    w += cp >= 0x1100 && (cp <= 0x115f || (cp >= 0x2e80 && cp <= 0xa4cf) || (cp >= 0xac00 && cp <= 0xd7a3) || (cp >= 0xf900 && cp <= 0xfaff) || (cp >= 0xfe30 && cp <= 0xfe4f) || (cp >= 0xff00 && cp <= 0xff60) || (cp >= 0xffe0 && cp <= 0xffe6) || (cp >= 0x1f300 && cp <= 0x1faff)) ? 2 : 1;
  }
  return w;
}

export function padEnd(s: string, n: number): string {
  const w = width(s);
  return w >= n ? s : s + " ".repeat(n - w);
}

export function padStart(s: string, n: number): string {
  const w = width(s);
  return w >= n ? s : " ".repeat(n - w) + s;
}

/** Truncate to n visible columns with an ellipsis. Keeps escapes balanced by re-painting outside. */
export function truncate(s: string, n: number): string {
  if (n <= 0) return "";
  const plain = strip(s);
  if (width(plain) <= n) return s;
  if (n === 1) return "…";
  let out = "";
  let w = 0;
  for (const ch of plain) {
    const cw = width(ch);
    if (w + cw > n - 1) break;
    out += ch;
    w += cw;
  }
  return out.trimEnd() + "…";
}

/** Word-wrap plain text to n columns. Long tokens are hard-broken. */
export function wrap(s: string, n: number): string[] {
  if (n <= 0) return [s];
  const lines: string[] = [];
  for (const para of s.split("\n")) {
    // Fits: keep it byte for byte, including deliberate double spaces.
    if (width(para) <= n) {
      lines.push(para);
      continue;
    }
    const indent = /^\s*/.exec(para)![0];
    let line = "";
    const push = (l: string) => lines.push(indent + l);
    for (const word of para.trim().split(/\s+/).filter(Boolean)) {
      const room = n - indent.length;
      if (width(word) > room) {
        if (line) push(line), (line = "");
        let rest = word;
        while (width(rest) > room) {
          push(rest.slice(0, room));
          rest = rest.slice(room);
        }
        line = rest;
        continue;
      }
      if (!line) line = word;
      else if (width(line) + 1 + width(word) <= room) line += " " + word;
      else push(line), (line = word);
    }
    push(line);
  }
  return lines;
}
