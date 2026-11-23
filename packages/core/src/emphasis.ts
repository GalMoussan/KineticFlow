export interface Run {
  text: string;
  emphasis: boolean;
}

/**
 * Splits `*word*` emphasis markers into runs. `\*` is a literal asterisk; an unmatched `*` stays literal.
 * Output text is NFC-normalised so niqqud sequences compare equal regardless of input order.
 */
export function parseEmphasis(source: string): Run[] {
  const runs: Run[] = [];
  let buf = '';
  let open = -1; // index in `buf` where the current emphasis started
  const flush = (text: string, emphasis: boolean) => {
    if (!text) return;
    const last = runs.at(-1);
    if (last && last.emphasis === emphasis) last.text += text;
    else runs.push({ text, emphasis });
  };
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (c === '\\' && source[i + 1] === '*') {
      buf += '*';
      i++;
    } else if (c === '*' && open === -1 && source.indexOf('*', i + 1) > i + 1) {
      flush(buf, false);
      buf = '';
      open = 0;
    } else if (c === '*' && open !== -1) {
      flush(buf, true);
      buf = '';
      open = -1;
    } else {
      buf += c;
    }
  }
  if (open !== -1) buf = '*' + buf;
  flush(buf, false);
  return runs.map((r) => ({ ...r, text: r.text.normalize('NFC') }));
}

export function plainText(source: string): string {
  return parseEmphasis(source)
    .map((r) => r.text)
    .join('');
}
