/**
 * A small, safe expression evaluator for the calculator (no eval).
 *
 * Supports: + - * / ^, × ÷ x as operators, parentheses, unary minus, implicit multiplication like
 * 2(3+4), `ans` for the last result, sqrt()/round()/floor()/ceil()/abs(), pi, and commas as
 * thousands separators (1,200).
 *
 * Percent works like a normal calculator: 60 × 250% = 150, and 200 + 10% = 220 (adds 10% of 200).
 */

type Tok = { t: 'num'; v: number } | { t: 'op'; v: string } | { t: 'fn'; v: string };

const FNS: Record<string, (x: number) => number> = {
  sqrt: Math.sqrt,
  round: Math.round,
  floor: Math.floor,
  ceil: Math.ceil,
  abs: Math.abs,
};

export class CalcError extends Error {}

function tokenize(src: string, ans: number): Tok[] {
  const s = src
    .replace(/(\d),(?=\d{3}\b)/g, '$1') // 1,200 → 1200
    .replace(/[×xX*]/g, '*')
    .replace(/[÷/]/g, '/')
    .replace(/[−–]/g, '-')
    .replace(/√/g, 'sqrt');
  const out: Tok[] = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === ' ') {
      i++;
      continue;
    }
    if (/[\d.]/.test(c)) {
      let j = i;
      while (j < s.length && /[\d.]/.test(s[j])) j++;
      if (s[j] === 'e' && /[\d+-]/.test(s[j + 1] ?? '')) {
        j += 2;
        while (j < s.length && /\d/.test(s[j])) j++;
      }
      const text = s.slice(i, j);
      const v = Number(text);
      if (!Number.isFinite(v) || (text.match(/\./g)?.length ?? 0) > 1) throw new CalcError(`“${text}” isn’t a number`);
      out.push({ t: 'num', v });
      i = j;
      continue;
    }
    if (/[a-z]/i.test(c)) {
      let j = i;
      while (j < s.length && /[a-z]/i.test(s[j])) j++;
      const word = s.slice(i, j).toLowerCase();
      if (word === 'ans') out.push({ t: 'num', v: ans });
      else if (word === 'pi') out.push({ t: 'num', v: Math.PI });
      else if (FNS[word]) out.push({ t: 'fn', v: word });
      else throw new CalcError(`Unknown word “${word}”`);
      i = j;
      continue;
    }
    if ('+-*/^%()'.includes(c)) {
      out.push({ t: 'op', v: c });
      i++;
      continue;
    }
    throw new CalcError(`Unexpected “${c}”`);
  }
  return out;
}

/** Recursive-descent parser: expr → term (+|- term)*, term → unary (*|/ unary)*, unary → -unary | power, power → postfix (^ unary)? */
export function evaluate(src: string, ans = 0): number {
  const toks = tokenize(src, ans);
  if (!toks.length) throw new CalcError('Empty');
  let p = 0;
  const peek = () => toks[p];
  const isOp = (v: string) => peek()?.t === 'op' && peek()!.v === v;
  /** set by postfix() when the factor it just read ended in %, so `a + b%` can mean a + a×b% */
  let lastPct = false;

  function expr(): number {
    let v = term().v;
    while (isOp('+') || isOp('-')) {
      const op = (toks[p++] as { v: string }).v;
      const r = term();
      const amount = r.pct ? v * r.v : r.v; // 200 + 10% → 200 + 20
      v = op === '+' ? v + amount : v - amount;
    }
    return v;
  }
  function term(): { v: number; pct: boolean } {
    let v = unary();
    let pct = lastPct;
    for (;;) {
      if (isOp('*') || isOp('/')) {
        const op = (toks[p++] as { v: string }).v;
        const r = unary();
        if (op === '/' && r === 0) throw new CalcError('Can’t divide by zero');
        v = op === '*' ? v * r : v / r;
      } else if (peek()?.t === 'fn' || isOp('(')) {
        v *= unary(); // implicit multiplication: 2(3+4), 3 sqrt(4)
      } else return { v, pct };
      pct = false;
    }
  }
  function unary(): number {
    if (isOp('-')) {
      p++;
      return -unary(); // lastPct carries through: 200 - -10% is still a percent
    }
    if (isOp('+')) {
      p++;
      return unary();
    }
    return power();
  }
  function power(): number {
    const base = postfix();
    if (isOp('^')) {
      p++;
      const v = Math.pow(base, unary());
      lastPct = false;
      return v;
    }
    return base;
  }
  function postfix(): number {
    let v = primary();
    lastPct = false;
    while (isOp('%')) {
      p++;
      v /= 100;
      lastPct = true;
    }
    return v;
  }
  function primary(): number {
    const tok = toks[p];
    if (!tok) throw new CalcError('Incomplete');
    if (tok.t === 'num') {
      p++;
      return tok.v;
    }
    if (tok.t === 'fn') {
      p++;
      if (!isOp('(')) throw new CalcError(`${tok.v} needs brackets, like ${tok.v}(9)`);
      return FNS[tok.v](primary());
    }
    if (tok.v === '(') {
      p++;
      const v = expr();
      if (isOp(')')) p++;
      // a missing closing bracket at the very end is forgiven: "2*(3+4" → 14
      else if (p < toks.length) throw new CalcError('Missing )');
      return v;
    }
    throw new CalcError(tok.v === ')' ? 'Unmatched )' : `“${tok.v}” needs a number`);
  }

  const v = expr();
  if (p < toks.length) {
    const t = toks[p];
    throw new CalcError(t.t === 'op' && t.v === ')' ? 'Unmatched )' : 'Couldn’t read that');
  }
  if (!Number.isFinite(v)) throw new CalcError('Too big');
  return v;
}

/** Tidy floating-point noise (0.1+0.2 → 0.3) and show up to 10 decimals. */
export function formatResult(v: number): string {
  if (Object.is(v, -0)) v = 0;
  const tidy = Number(v.toPrecision(12));
  if (Math.abs(tidy) >= 1e15 || (tidy !== 0 && Math.abs(tidy) < 1e-9)) return tidy.toExponential(6).replace(/\.?0+e/, 'e');
  return tidy.toFixed(10).replace(/\.?0+$/, '');
}

/** Same as formatResult but with thousands separators, for display. */
export function displayResult(v: number): string {
  const s = formatResult(v);
  if (s.includes('e')) return s;
  const [int, dec] = s.split('.');
  return int.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (dec ? '.' + dec : '');
}
