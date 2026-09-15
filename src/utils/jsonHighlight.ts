const NUMBER_CHAR_RE = /[0-9eE+\-.]/u;
const LOWER_ALPHA_RE = /[a-z]/u;
const WHITESPACE_RE = /\s/u;

export type TokenKind = 'key' | 'string' | 'number' | 'boolean' | 'null' | 'punct';

export interface Token {
  kind: TokenKind;
  text: string;
}

/**
 * Tiny JSON tokenizer. Returns an array of tokens with semantic kinds.
 * No external dependencies — hand-rolled state machine.
 */
export function tokenizeJson(json: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const len = json.length;

  // Track whether we just emitted a colon (next string is a value, not a key)
  let expectValue = false;

  function peek(): string {
    return json[i] ?? '';
  }

  function readString(): string {
    let s = '"';
    i++; // skip opening "
    while (i < len) {
      const c = json[i];
      s += c;
      if (c === '\\') {
        i++;
        if (i < len) {
          s += json[i];
          i++;
        }
        continue;
      }
      if (c === '"') {
        i++;
        break;
      }
      i++;
    }
    return s;
  }

  function readNumber(): string {
    let s = '';
    while (i < len) {
      const c = json[i];
      if (NUMBER_CHAR_RE.test(c)) {
        s += c;
        i++;
      } else {
        break;
      }
    }
    return s;
  }

  function readLiteral(word: string): string {
    if (json.slice(i, i + word.length) === word) {
      i += word.length;
      return word;
    }
    // Fallback: read until non-alpha
    let s = '';
    while (i < len && LOWER_ALPHA_RE.test(json[i] ?? '')) {
      s += json[i];
      i++;
    }
    return s;
  }

  while (i < len) {
    const c = peek();

    // Whitespace
    if (WHITESPACE_RE.test(c)) {
      tokens.push({ kind: 'punct', text: c });
      i++;
      continue;
    }

    // Punctuation
    if ('{}[],'.includes(c)) {
      tokens.push({ kind: 'punct', text: c });
      i++;
      expectValue = false;
      continue;
    }

    if (c === ':') {
      tokens.push({ kind: 'punct', text: c });
      i++;
      expectValue = true;
      continue;
    }

    // String
    if (c === '"') {
      const raw = readString();
      if (!expectValue) {
        // Check if it's followed by ':' (it's a key)
        let j = i;
        while (j < len && WHITESPACE_RE.test(json[j] ?? '')) j++;
        if (json[j] === ':') {
          tokens.push({ kind: 'key', text: raw });
        } else {
          tokens.push({ kind: 'string', text: raw });
        }
      } else {
        tokens.push({ kind: 'string', text: raw });
        expectValue = false;
      }
      continue;
    }

    // Number
    if (/[-0-9]/u.test(c)) {
      const num = readNumber();
      tokens.push({ kind: 'number', text: num });
      expectValue = false;
      continue;
    }

    // Boolean / null
    if (c === 't' || c === 'f') {
      const word = readLiteral(c === 't' ? 'true' : 'false');
      tokens.push({ kind: 'boolean', text: word });
      expectValue = false;
      continue;
    }

    if (c === 'n') {
      const word = readLiteral('null');
      tokens.push({ kind: 'null', text: word });
      expectValue = false;
      continue;
    }

    // Fallback: emit as punct
    tokens.push({ kind: 'punct', text: c });
    i++;
  }

  return tokens;
}
