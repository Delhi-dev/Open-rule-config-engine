// AD-7 check — exports, row bindings, lists, blanks, dates and strings: the Builder's expression engine against the
// reference results for 296 edge-case and random expressions under 6 different row bindings.
// Run: npx tsx addenda-tests/ad7-edge.check.ts      (fixed data in ad7-edge.json — never edit)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as core from '../packages/core/src/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const oracle = JSON.parse(fs.readFileSync(path.join(here, 'ad7-edge.json'), 'utf8'));
const lines: string[] = [];
let passes = 0, failures = 0;
// 1. the public expression API exported through index.ts (§7, AD-3 file 4)
const required = ['evaluate', 'evaluateExpression', 'evaluateBoolean', 'parseExpression', 'compileExpression', 'checkExpression',
  'expressionPaths', 'EXPRESSION_FUNCTIONS', 'isBlankValue', 'looseEquals', 'compareValues'];
for (const name of required) {
  if ((core as Record<string, unknown>)[name] === undefined) { failures++; lines.push(`FAIL  expression.ts: '${name}' is not exported (re-export it from expression.ts)`); }
  else passes++;
}
// 1b. errors propagate (§7.5, AD-8): the evaluators must NOT catch — validateDocument turns a throw into a warning
for (const [fn, call] of [
  ['evaluateExpression', () => (core as any).evaluateExpression('nosuchfn(1)', {}, {})],
  ['evaluateBoolean', () => (core as any).evaluateBoolean('nosuchfn(1)', {}, {})],
  ['evaluate', () => (core as any).evaluate('nosuchfn(1)', { data: {}, bindings: {} })],
  ['evaluateExpression (syntax error)', () => (core as any).evaluateExpression('1 +', {}, {})],
] as const) {
  let threw = false;
  try { (call as () => unknown)(); } catch { threw = true; }
  if (threw) passes++;
  else { failures++; lines.push(`FAIL  expression.ts: ${fn} must THROW on an invalid expression (an unknown function or a syntax error) — do not catch errors inside evaluateExpression / evaluateBoolean / evaluate`); }
}
// 2. values
const show = (v: unknown) => JSON.stringify(v);
const seen = new Set<string>();
const run = (f: () => unknown) => { try { const v = f(); return v === undefined ? '«undefined»' : v; } catch { return '«throws»'; } };
const c = core as any;
for (const k of oracle.cases) {
  const got = {
    value: run(() => c.evaluateExpression(k.src, oracle.doc, k.bindings)),
    bool: run(() => c.evaluateBoolean(k.src, oracle.doc, k.bindings)),
    raw: run(() => c.evaluate(k.src, { data: oracle.doc, bindings: k.bindings, now: new Date(oracle.now) })),
  };
  for (const field of ['value', 'bool', 'raw'] as const) {
    if (show(got[field]) === show(k[field])) { passes++; continue; }
    failures++;
    const key = `${k.src}|${field}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const fn = field === 'value' ? 'evaluateExpression' : field === 'bool' ? 'evaluateBoolean' : 'evaluate';
    lines.push(`FAIL  expression.ts: ${fn} with bindings ${show(k.bindings)} — expected ${show(k[field])}, got ${show(got[field])}\n      expression: ${k.src}`);
  }
}
console.log(lines.slice(0, 25).join('\n'));
if (lines.length > 25) console.log(`… and ${lines.length - 25} more`);
console.log(failures ? `\n${failures} edge-case check(s) failed, ${passes} passed` : `\nAll ${passes} edge-case checks passed`);
process.exit(failures ? 1 : 0);
