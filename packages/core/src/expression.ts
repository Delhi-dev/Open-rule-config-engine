import type { Expr } from './expr-parse.js';
import { parseExpression, compileExpression, AGGREGATES, CONDITIONAL, SCALAR_FNS, EXPRESSION_FUNCTIONS, checkExpression, expressionPaths } from './expr-parse.js';
import type { Value } from './expr-values.js';
import { isBlankValue, toNumber, toDate, truthy, looseEquals, compareValues, flatten, numbers, arithmetic, toValue, monthsBetween } from './expr-values.js';
import { aggregate, callScalar } from './expr-functions.js';
import { resolvePath, parsePath } from './path.js';

export type EvalContext = { data: unknown; bindings: Record<string, number>; now?: Date };

export function hasUnboundWildcard(path: string, bindings: Record<string, number>): boolean {
  const segments = parsePath(path);
  let concrete = '';
  for (const seg of segments) {
    if ('key' in seg) {
      concrete = concrete ? concrete + '.' + seg.key : seg.key;
    } else if (seg.index === '*') {
      const bound = bindings[concrete];
      if (bound === undefined) return true;
      concrete += `[${bound}]`;
    } else {
      concrete += `[${seg.index}]`;
    }
  }
  return false;
}

export function evaluate(src: string, ctx: EvalContext): Value {
  const ast: Expr = compileExpression(src);
  const evaluateExpr = (e: Expr, bindings: Record<string, number>): Value => {
    switch (e.k) {
      case 'num':
      case 'str':
      case 'bool':
      case 'null':
        return e.k === 'null' ? null : e.v;
      case 'path': {
        const matches = resolvePath(ctx.data, e.path, bindings);
        if (matches.length === 0) return null;
        if (matches.length === 1 && !hasUnboundWildcard(e.path, bindings)) {
          const m = matches[0];
          return m.exists ? toValue(m.value) : null;
        }
        return matches.filter(m => m.exists).map(m => toValue(m.value));
      }
      case 'neg': {
        const v = evaluateExpr(e.e, bindings);
        const n = toNumber(v);
        return n === null ? null : -n;
      }
      case 'not': {
        const v = evaluateExpr(e.e, bindings);
        return !truthy(v);
      }
      case 'bin': {
        const l = evaluateExpr(e.l, bindings);
        const r = evaluateExpr(e.r, bindings);
        if (e.op === 'and') return truthy(l) && truthy(r);
        if (e.op === 'or') return truthy(l) || truthy(r);
        let left = l;
        let right = r;
        if (['==', '!=', '<', '<=', '>', '>='].includes(e.op)) {
          if (isBlankValue(left) && typeof right === 'number') left = 0;
          else if (isBlankValue(right) && typeof left === 'number') right = 0;
        }
        switch (e.op) {
          case '==': return looseEquals(left, right);
          case '!=': return !looseEquals(left, right);
          case '<': case '<=': case '>': case '>=': {
            const c = compareValues(left, right);
            if (c === null) return false;
            switch (e.op) {
              case '<': return c < 0;
              case '<=': return c <= 0;
              case '>': return c > 0;
              case '>=': return c >= 0;
            }
          }
          default: {
            return arithmetic(e.op, left, right);
          }
        }
      }
      case 'call': {
        const args = e.args.map(arg => evaluateExpr(arg, bindings));
        // Handle exists function separately
        if (e.fn === 'exists') {
          if (e.args.length !== 1 || e.args[0].k !== 'path') {
            throw new Error('exists() takes exactly one field path');
          }
          const path = e.args[0].path;
          const matches = resolvePath(ctx.data, path, bindings);
          return matches.some(m => m.exists && !isBlankValue(m.value));
        }
        if (AGGREGATES.has(e.fn)) {
          if (e.args.length === 1 && e.args[0].k === 'path') {
            const path = e.args[0].path;
            const matches = resolvePath(ctx.data, path, bindings);
            const values = matches.filter(m => m.exists).map(m => toValue(m.value));
            return aggregate(e.fn, values);
          } else {
            return aggregate(e.fn, args);
          }
        }
        if (CONDITIONAL.has(e.fn)) {
          const pArg = e.args[0];
          if (pArg.k !== 'path') throw new Error(`${e.fn}() requires a path argument`);
          const path = pArg.path;
          const condArg = e.args[1];
          const matches = resolvePath(ctx.data, path, bindings);
          const kept: Value[] = [];
          for (const m of matches) {
            if (!m.exists) continue;
            const rowBindings = { ...bindings, ...m.bindings };
            const condVal = evaluateExpr(condArg, rowBindings);
            if (truthy(condVal)) {
              kept.push(toValue(m.value));
            }
          }
          switch (e.fn) {
            case 'sumif': {
              const nums = kept.map(v => toNumber(v)).filter(n => n !== null);
              return nums.reduce((a, b) => a + b, 0);
            }
            case 'countif': return kept.length;
            case 'anyif': return kept.length > 0;
            case 'allif': {
              const totalMatches = matches.filter(m => m.exists).length;
              return kept.length === totalMatches;
            }
            default: throw new Error(`Unknown conditional ${e.fn}`);
          }
        }
        // scalar function
        return callScalar(e.fn, args, ctx.now);
      }
      default:
        throw new Error(`Unknown expression node type`);
    }
  };
  return evaluateExpr(ast, ctx.bindings);
}

export function evaluateExpression(src: string, data: unknown, bindings: Record<string, number> = {}): Value | undefined {
  const ctx: EvalContext = { data, bindings };
  const v = evaluate(src, ctx);
  // If result is a list, collapse to sum of numeric members
  if (Array.isArray(v)) {
    const nums = numbers(v);
    if (nums.length === 0) return undefined;
    let sum = 0;
    for (const n of nums) sum += n;
    return sum as unknown as Value;
  }
  if (v === null) return undefined;
  return v;
}

export function evaluateBoolean(src: string, data: unknown, bindings: Record<string, number> = {}): boolean {
  const v = evaluateExpression(src, data, bindings);
  if (v === undefined) return false;
  return truthy(v);
}

// Re-exports
export { parseExpression, compileExpression, EXPRESSION_FUNCTIONS, checkExpression, expressionPaths } from './expr-parse.js';
export { isBlankValue, looseEquals, compareValues } from './expr-values.js';
