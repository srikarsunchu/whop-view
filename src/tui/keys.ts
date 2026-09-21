// Raw-mode key input. Pure parser plus a small stdin wrapper. No dependency.

export interface Key {
  /** `char`, `enter`, `tab`, `backspace`, `delete`, `left`, `right`, `up`, `down`, `home`, `end`, `escape`, `paste`, or a letter for ctrl/meta chords. */
  name: string;
  /** The character for `char`, the text for `paste`. */
  ch?: string;
  ctrl?: boolean;
  meta?: boolean;
}

const CSI_FINAL: Record<string, string> = { A: "up", B: "down", C: "right", D: "left", H: "home", F: "end" };
const CSI_TILDE: Record<string, string> = { "1": "home", "7": "home", "4": "end", "8": "end", "3": "delete", "2": "insert", "5": "pageup", "6": "pagedown" };

/** Turns one stdin chunk into keys. Handles CSI, SS3, alt chords, ctrl chords, and bracketed paste. */
export function parseKeys(input: string): Key[] {
  const keys: Key[] = [];
  let i = 0;
  while (i < input.length) {
    const c = input[i];
    if (c === "\x1b") {
      const next = input[i + 1];
      if (next === "[") {
        // Bracketed paste: everything up to the closing sequence is one insert.
        if (input.startsWith("\x1b[200~", i)) {
          const end = input.indexOf("\x1b[201~", i + 6);
          const text = end < 0 ? input.slice(i + 6) : input.slice(i + 6, end);
          keys.push({ name: "paste", ch: text });
          i = end < 0 ? input.length : end + 6;
          continue;
        }
        let j = i + 2;
        while (j < input.length && !(input.charCodeAt(j) >= 0x40 && input.charCodeAt(j) <= 0x7e)) j++;
        if (j >= input.length) {
          keys.push({ name: "escape" });
          i = input.length;
          continue;
        }
        const params = input.slice(i + 2, j);
        const final = input[j];
        const mod = Number(params.split(";")[1] ?? "1");
        const chord = { ctrl: mod === 5 || mod === 6, meta: mod === 3 || mod === 4 };
        if (final === "~") {
          const name = CSI_TILDE[params.split(";")[0]];
          if (name) keys.push({ name, ...chord });
        } else if (CSI_FINAL[final]) keys.push({ name: CSI_FINAL[final], ...chord });
        i = j + 1;
        continue;
      }
      if (next === "O" && CSI_FINAL[input[i + 2] ?? ""]) {
        keys.push({ name: CSI_FINAL[input[i + 2]] });
        i += 3;
        continue;
      }
      if (next === undefined) {
        keys.push({ name: "escape" });
        i++;
        continue;
      }
      // Alt chord: ESC followed by a printable or a control byte.
      if (next === "\x7f" || next === "\b") keys.push({ name: "backspace", meta: true });
      else if (next === "\r" || next === "\n") keys.push({ name: "enter", meta: true });
      else keys.push({ name: next.toLowerCase(), meta: true });
      i += 2;
      continue;
    }
    const code = input.charCodeAt(i);
    if (c === "\r" || c === "\n") keys.push({ name: "enter" });
    else if (c === "\t") keys.push({ name: "tab" });
    else if (c === "\x7f" || c === "\b") keys.push({ name: "backspace" });
    else if (code < 32) keys.push({ name: String.fromCharCode(code + 96), ctrl: true });
    else {
      // Printable run: emit as one char at a time so the editor treats them uniformly.
      const cp = input.codePointAt(i)!;
      const ch = String.fromCodePoint(cp);
      keys.push({ name: "char", ch });
      i += ch.length;
      continue;
    }
    i++;
  }
  return keys;
}

export interface Keyboard {
  /** Start raw mode and deliver keys. */
  resume(): void;
  /** Leave raw mode and stop delivering keys, so a child process or readline can own the TTY. */
  pause(): void;
  close(): void;
}

/** Wraps stdin. Bracketed paste is enabled while resumed so pasted commands arrive as one insert. */
export function keyboard(onKey: (key: Key) => void, input: NodeJS.ReadStream = process.stdin, output: NodeJS.WriteStream = process.stdout): Keyboard {
  let active = false;
  const onData = (d: Buffer | string) => {
    if (!active) return;
    for (const k of parseKeys(d.toString())) onKey(k);
  };
  input.on("data", onData);
  return {
    resume() {
      if (active) return;
      active = true;
      if (input.isTTY) input.setRawMode(true);
      input.setEncoding("utf8");
      input.resume();
      output.write("\x1b[?2004h");
    },
    pause() {
      if (!active) return;
      active = false;
      output.write("\x1b[?2004l");
      if (input.isTTY) input.setRawMode(false);
      input.pause();
    },
    close() {
      this.pause();
      input.off("data", onData);
    },
  };
}
