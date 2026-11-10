// AD-3 check 2 of 3 — packages/core/src/expr-parse.ts.  Run: npx tsx addenda-tests/ad3-parse.check.ts
import { checker } from './_check.js';
import {
  parseExpression, compileExpression, checkExpression, expressionPaths, EXPRESSION_FUNCTIONS, AGGREGATES, CONDITIONAL, SCALAR_FNS,
} from '../packages/core/src/expr-parse.js';

const c = checker('expr-parse.ts');
const P = (s: string) => () => parseExpression(s);
const num = (v: number) => ({ k: 'num', v });
const path = (p: string) => ({ k: 'path', path: p });
// literals, paths, precedence
c.eq("'1 + 2 * 3'", P('1 + 2 * 3'), { k: 'bin', op: '+', l: num(1), r: { k: 'bin', op: '*', l: num(2), r: num(3) } });
c.eq("'(1 + 2) * 3'", P('(1 + 2) * 3'), { k: 'bin', op: '*', l: { k: 'bin', op: '+', l: num(1), r: num(2) }, r: num(3) });
c.eq("'PartB-ATI.x - 1' (hyphenated key is one path; spaced minus subtracts)", P('PartB-ATI.x - 1'), { k: 'bin', op: '-', l: path('PartB-ATI.x'), r: num(1) });
c.eq("'true'", P('true'), { k: 'bool', v: true });
c.eq("'null'", P('null'), { k: 'null' });
c.eq(`'"a\\"b"' (escaped quote)`, P('"a\\"b"'), { k: 'str', v: 'a"b' });
c.eq("'-x'", P('-x'), { k: 'neg', e: path('x') });
// function calls: name followed by '(' → call, name lowercased, arguments are full expressions
c.eq("'sum(a[*].b)'", P('sum(a[*].b)'), { k: 'call', fn: 'sum', args: [path('a[*].b')] });
c.eq("'SUM(x)' (name lowercased)", P('SUM(x)'), { k: 'call', fn: 'sum', args: [path('x')] });
c.eq("'f(1, g(2 + 3))'", P('f(1, g(2 + 3))'), { k: 'call', fn: 'f', args: [num(1), { k: 'call', fn: 'g', args: [{ k: 'bin', op: '+', l: num(2), r: num(3) }] }] });
c.eq("'today()'", P('today()'), { k: 'call', fn: 'today', args: [] });
// word and symbol operators — op names: 'and', 'or'; all others their symbol; '=' → '==', '<>' → '!='
c.eq("'a and b'", P('a and b'), { k: 'bin', op: 'and', l: path('a'), r: path('b') });
c.eq("'a AND b'", P('a AND b'), { k: 'bin', op: 'and', l: path('a'), r: path('b') });
c.eq("'a && b'", P('a && b'), { k: 'bin', op: 'and', l: path('a'), r: path('b') });
c.eq("'a or b'", P('a or b'), { k: 'bin', op: 'or', l: path('a'), r: path('b') });
c.eq("'not a'", P('not a'), { k: 'not', e: path('a') });
c.eq("'!a'", P('!a'), { k: 'not', e: path('a') });
c.eq("'a = 1'", P('a = 1'), { k: 'bin', op: '==', l: path('a'), r: num(1) });
c.eq("'a <> 1'", P('a <> 1'), { k: 'bin', op: '!=', l: path('a'), r: num(1) });
c.eq("'a == 1 or b > 2 and c'", P('a == 1 or b > 2 and c'),
  { k: 'bin', op: 'or', l: { k: 'bin', op: '==', l: path('a'), r: num(1) }, r: { k: 'bin', op: 'and', l: { k: 'bin', op: '>', l: path('b'), r: num(2) }, r: path('c') } });
// errors
c.throws("'1 2' (trailing tokens)", P('1 2'), /./);
c.throws(`'"abc' (unterminated string)`, P('"abc'), /./);
c.throws("'1 ^ 2' (unexpected character)", P('1 ^ 2'), /Unexpected character/);
c.throws("'(1 + 2' (missing ')')", P('(1 + 2'), /./);
// cache
c.eq('compileExpression caches (same object twice)', () => compileExpression('a + 1') === compileExpression('a + 1'), true);
// checkExpression
c.eq("checkExpression('sum(a[*].b) + 1') passes", () => checkExpression('sum(a[*].b) + 1'), undefined);
c.throws("checkExpression('nosuch(1)')", () => checkExpression('nosuch(1)'), /Unknown function/);
c.throws("checkExpression('sumif(1, 2)') — first arg must be a path", () => checkExpression('sumif(1, 2)'), /./);
c.throws("checkExpression('sumif(a[*].x)') — needs 2 args", () => checkExpression('sumif(a[*].x)'), /./);
c.throws("checkExpression('exists(1)')", () => checkExpression('exists(1)'), /./);
c.throws("checkExpression('exists(a, b)')", () => checkExpression('exists(a, b)'), /./);
c.throws("checkExpression('1 +')", () => checkExpression('1 +'), /./);
// expressionPaths
c.eq("expressionPaths('a.b + sum(c[*].d)')", () => expressionPaths('a.b + sum(c[*].d)'), ['a.b', 'c[*].d']);
c.eq("expressionPaths('1 +') → []", () => expressionPaths('1 +'), []);
// function-name sets
c.eq('AGGREGATES', () => [...AGGREGATES].sort(), ['avg', 'count', 'first', 'max', 'min', 'sum', 'unique']);
c.eq('CONDITIONAL', () => [...CONDITIONAL].sort(), ['allif', 'anyif', 'countif', 'sumif']);
c.eq('SCALAR_FNS has 30 names incl. exists, if, today', () => [SCALAR_FNS.size, SCALAR_FNS.has('exists'), SCALAR_FNS.has('if'), SCALAR_FNS.has('today')], [30, true, true, true]);
c.eq('EXPRESSION_FUNCTIONS = all 41, sorted', () => [EXPRESSION_FUNCTIONS.length, [...EXPRESSION_FUNCTIONS].sort().join() === EXPRESSION_FUNCTIONS.join()], [41, true]);
c.done();
