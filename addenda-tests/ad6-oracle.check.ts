// AD-6 check — the whole expression engine against the reference results for every expression in the
// ITR-1 starter rule set, on the sample return, the T8 scenarios and an empty return.
// Run: npx tsx addenda-tests/ad6-oracle.check.ts      (fixed data in ad6-oracle.json — never edit)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateExpression, evaluateBoolean, checkExpression, expressionPaths } from '../packages/core/src/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const oracle = JSON.parse(fs.readFileSync(path.join(here, 'ad6-oracle.json'), 'utf8'));
const show = (v: unknown) => (v === undefined ? '«undefined»' : JSON.stringify(v));
let passes = 0;
const fails: string[] = [];
const seen = new Set<string>();
const fail = (src: string, msg: string) => {
  if (seen.has(src)) { fails.push(''); return; } // report each expression once; count every failure
  seen.add(src);
  fails.push(`FAIL  expression.ts: ${msg}\n      expression: ${src}`);
};
for (const c of oracle.cases) {
  try { checkExpression(c.src); passes++; } catch (e) { fail(c.src, `checkExpression rejected a valid expression: ${(e as Error).message}`); }
  const p = expressionPaths(c.src);
  if (JSON.stringify(p) === JSON.stringify(c.paths)) passes++; else fail(c.src, `expressionPaths — expected ${show(c.paths)}, got ${show(p)}`);
  for (const ev of c.evals) {
    const doc = oracle.docs[ev.doc];
    const where = `on ${ev.doc}${Object.keys(ev.bindings).length ? ' ' + JSON.stringify(ev.bindings) : ''}`;
    try {
      const v = evaluateExpression(c.src, doc, ev.bindings);
      if (show(v) === show(ev.value === '«undefined»' ? undefined : ev.value)) passes++;
      else fail(c.src, `evaluateExpression ${where} — expected ${show(ev.value === '«undefined»' ? undefined : ev.value)}, got ${show(v)}`);
      const b = evaluateBoolean(c.src, doc, ev.bindings);
      if (b === ev.bool) passes++; else fail(c.src, `evaluateBoolean ${where} — expected ${ev.bool}, got ${b}`);
    } catch (e) {
      fail(c.src, `evaluateExpression ${where} threw: ${(e as Error).message}`);
    }
  }
}
const shown = fails.filter(Boolean);
console.log(shown.slice(0, 25).join('\n'));
if (shown.length > 25) console.log(`… and ${shown.length - 25} more failing expressions`);
console.log(fails.length ? `\n${fails.length} expression-engine check(s) failed (${seen.size} expressions), ${passes} passed` : `\nAll ${passes} expression-engine checks passed`);
process.exit(fails.length ? 1 : 0);
