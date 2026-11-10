// SUPPLIED BY THE REVIEWER (AD-5) — copied in by the harness like the tests; do not regenerate.
// Tokenizer (§7.1), precedence-ladder parser (§7.2, AD-4), function-name sets, cache and static checks (§7.5).

type Tok =
  | { t: 'num'; v: number }
  | { t: 'str'; v: string }
  | { t: 'id'; v: string }
  | { t: 'op'; v: string }
  | { t: '('; v: '(' }
  | { t: ')'; v: ')' }
  | { t: ','; v: ',' };

export type Expr =
  | { k: 'num'; v: number }
  | { k: 'str'; v: string }
  | { k: 'bool'; v: boolean }
  | { k: 'null' }
  | { k: 'path'; path: string }
  | { k: 'bin'; op: string; l: Expr; r: Expr }
  | { k: 'neg'; e: Expr }
  | { k: 'not'; e: Expr }
  | { k: 'call'; fn: string; args: Expr[] };


const PATH_CHARS = /[A-Za-z0-9_@#:\-\.\[\]\*]/;
const KEYWORDS: Record<string, Expr> = {
  true: { k: 'bool', v: true },
  false: { k: 'bool', v: false },
  null: { k: 'null' },
};

function tokenize(src: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      let j = i + 1;
      while (j < src.length && /[0-9.]/.test(src[j])) j++;
      if (/[eE]/.test(src[j] ?? '') && /[0-9+-]/.test(src[j + 1] ?? '')) {
        j += 2;
        while (j < src.length && /[0-9]/.test(src[j])) j++;
      }
      toks.push({ t: 'num', v: Number(src.slice(i, j)) });
      i = j;
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      let s = '';
      while (j < src.length && src[j] !== c) {
        if (src[j] === '\\' && j + 1 < src.length) {
          s += src[j + 1];
          j += 2;
        } else s += src[j++];
      }
      if (j >= src.length) throw new Error(`Unterminated string starting at position ${i}`);
      toks.push({ t: 'str', v: s });
      i = j + 1;
      continue;
    }
    if (/[A-Za-z_@$#]/.test(c)) {
      let j = i + 1;
      while (j < src.length && PATH_CHARS.test(src[j])) {
        if (src[j] === '-' && !/[A-Za-z0-9_]/.test(src[j + 1] ?? '')) break;
        j++;
      }
      toks.push({ t: 'id', v: src.slice(i, j) });
      i = j;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (['==', '!=', '<=', '>=', '&&', '||', '<>'].includes(two)) {
      toks.push({ t: 'op', v: two === '<>' ? '!=' : two });
      i += 2;
      continue;
    }
    if ('+-*/%<>!='.includes(c)) {
      toks.push({ t: 'op', v: c === '=' ? '==' : c });
      i++;
      continue;
    }
    if (c === '(' || c === ')' || c === ',') {
      toks.push({ t: c, v: c } as Tok);
      i++;
      continue;
    }
    throw new Error(`Unexpected character "${c}" at position ${i}`);
  }
  return toks;
}

export function parseExpression(src: string): Expr {
  const toks = tokenize(src);
  let pos = 0;
  const peek = (): Tok | undefined => toks[pos];
  const next = (): Tok => {
    const t = toks[pos++];
    if (!t) throw new Error('Unexpected end of expression');
    return t;
  };
  const isOp = (...ops: string[]): boolean => {
    const t = peek();
    return t?.t === 'op' && ops.includes(t.v);
  };
  const isWord = (...words: string[]): boolean => {
    const t = peek();
    return t?.t === 'id' && words.includes(t.v.toLowerCase());
  };
  const expect = (kind: '(' | ')' | ','): void => {
    const t = next();
    if (t.t !== kind) throw new Error(`Expected '${kind}'`);
  };

  // One function per precedence level, loosest first; each calls the next tighter level.
  const orExpr = (): Expr => {
    let l = andExpr();
    while (isOp('||') || isWord('or')) { next(); l = { k: 'bin', op: 'or', l, r: andExpr() }; }
    return l;
  };
  const andExpr = (): Expr => {
    let l = equality();
    while (isOp('&&') || isWord('and')) { next(); l = { k: 'bin', op: 'and', l, r: equality() }; }
    return l;
  };
  const equality = (): Expr => {
    let l = comparison();
    while (isOp('==', '!=')) { const op = String(next().v); l = { k: 'bin', op, l, r: comparison() }; }
    return l;
  };
  const comparison = (): Expr => {
    let l = additive();
    while (isOp('<', '<=', '>', '>=')) { const op = String(next().v); l = { k: 'bin', op, l, r: additive() }; }
    return l;
  };
  const additive = (): Expr => {
    let l = multiplicative();
    while (isOp('+', '-')) { const op = String(next().v); l = { k: 'bin', op, l, r: multiplicative() }; }
    return l;
  };
  const multiplicative = (): Expr => {
    let l = unary();
    while (isOp('*', '/', '%')) { const op = String(next().v); l = { k: 'bin', op, l, r: unary() }; }
    return l;
  };
  const unary = (): Expr => {
    if (isOp('-')) { next(); return { k: 'neg', e: unary() }; }
    if (isOp('+')) { next(); return unary(); }
    if (isOp('!') || isWord('not')) { next(); return { k: 'not', e: unary() }; }
    return primary();
  };
  const primary = (): Expr => {
    const t = next();
    if (t.t === 'num') return { k: 'num', v: t.v };
    if (t.t === 'str') return { k: 'str', v: t.v };
    if (t.t === '(') { const e = orExpr(); expect(')'); return e; }
    if (t.t === 'id') {
      if (peek()?.t === '(') {            // the name is already consumed: the NEXT token is '(' → a call
        next();
        const args: Expr[] = [];
        if (peek()?.t !== ')') {
          args.push(orExpr());             // arguments are full expressions: the loosest level
          while (peek()?.t === ',') { next(); args.push(orExpr()); }
        }
        expect(')');
        return { k: 'call', fn: t.v.toLowerCase(), args };
      }
      const w = t.v.toLowerCase();
      if (w === 'true') return { k: 'bool', v: true };
      if (w === 'false') return { k: 'bool', v: false };
      if (w === 'null') return { k: 'null' };
      return { k: 'path', path: t.v };
    }
    throw new Error(`Unexpected token '${String(t.v)}'`);
  };

  const e = orExpr();
  if (pos < toks.length) throw new Error('Unexpected tokens after expression');
  return e;
}

export const AGGREGATES = new Set(['sum', 'count', 'min', 'max', 'avg', 'unique', 'first']);
export const CONDITIONAL = new Set(['sumif', 'countif', 'anyif', 'allif']);
export const SCALAR_FNS = new Set([
  'abs', 'round', 'floor', 'ceil', 'if', 'nvl', 'coalesce', 'exists', 'isblank', 'len', 'lower', 'upper', 'trim',
  'str', 'num', 'left', 'right', 'contains', 'startswith', 'endswith', 'matches', 'in', 'date', 'days_between',
  'months_between', 'years_between', 'year', 'month', 'day', 'today',
]);
export const EXPRESSION_FUNCTIONS = [...AGGREGATES, ...CONDITIONAL, ...SCALAR_FNS].sort();

const cache = new Map<string, Expr>();

export function compileExpression(src: string): Expr {
  let ast = cache.get(src);
  if (!ast) {
    ast = parseExpression(src);
    cache.set(src, ast);
  }
  return ast;
}


export function checkExpression(src: string): void {
  const walk = (e: Expr): void => {
    if (e.k === 'bin') { walk(e.l); walk(e.r); return; }
    if (e.k === 'neg' || e.k === 'not') { walk(e.e); return; }
    if (e.k !== 'call') return;
    if (!AGGREGATES.has(e.fn) && !CONDITIONAL.has(e.fn) && !SCALAR_FNS.has(e.fn)) throw new Error(`Unknown function ${e.fn}()`);
    if (CONDITIONAL.has(e.fn) && (e.args.length < 2 || e.args[0].k !== 'path')) throw new Error(`${e.fn}() takes a field path and a condition`);
    if (e.fn === 'exists' && (e.args.length !== 1 || e.args[0].k !== 'path')) throw new Error('exists() takes exactly one field path');
    e.args.forEach(walk);
  };
  walk(parseExpression(src)); // syntax errors throw from here
}

export function expressionPaths(src: string): string[] {
  const out: string[] = [];
  const walk = (e: Expr): void => {
    if (e.k === 'path') out.push(e.path);
    else if (e.k === 'bin') { walk(e.l); walk(e.r); }
    else if (e.k === 'neg' || e.k === 'not') walk(e.e);
    else if (e.k === 'call') e.args.forEach(walk);
  };
  try { walk(parseExpression(src)); } catch { return []; }
  return out;
}
