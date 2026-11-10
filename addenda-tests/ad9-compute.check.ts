// AD-9 check — computeDocument (§9.2) against the reference results for the 52 ITR-1 starter computations on 11
// documents (the sample return, the T8 scenarios, an empty return, a bare skeleton, the sample with every optional
// schedule removed, and four edited returns): the computed document, the `computed` map, `changed`, the error ids,
// idempotence (computing the result again changes nothing) and purity (the input is never modified).
// Run: npx tsx addenda-tests/ad9-compute.check.ts      (fixed data in ad9-compute.json — never edit)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeDocument } from '../packages/core/src/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const oracle = JSON.parse(fs.readFileSync(path.join(here, 'ad9-compute.json'), 'utf8'));
let passes = 0;
const fails: string[] = [];
const ok = (cond: boolean, msg: string) => (cond ? passes++ : fails.push(`FAIL  compute.ts: ${msg}`));
const diffPaths = (a: any, b: any, p = ''): string[] => {
  if (JSON.stringify(a) === JSON.stringify(b)) return [];
  if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
    return [...new Set([...Object.keys(a), ...Object.keys(b)])].flatMap((k) => diffPaths(a[k], b[k], p ? `${p}.${k}` : k));
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    return Array.from({ length: Math.max(a.length, b.length) }, (_, i) => diffPaths(a[i], b[i], `${p}[${i}]`)).flat();
  }
  return [`${p}: expected ${JSON.stringify(a)}, got ${JSON.stringify(b)}`];
};
for (const c of oracle.cases) {
  const before = JSON.stringify(c.doc);
  let r: any;
  try { r = computeDocument(c.doc, oracle.computations); } catch (e) { ok(false, `${c.name}: computeDocument threw (${(e as Error).message}) — it must never throw`); continue; }
  ok(JSON.stringify(c.doc) === before, `${c.name}: the input document was modified — computeDocument must be pure`);
  const d = diffPaths(c.data, r.data);
  ok(d.length === 0, `${c.name}: computed document differs in ${d.length} place(s): ${d.slice(0, 6).join('; ')}`);
  const comp = [...(r.computed?.entries?.() ?? [])].sort();
  const missing = c.computed.filter(([p]: [string]) => !r.computed?.has?.(p)).map(([p]: [string]) => p);
  const extra = comp.filter(([p]: [string]) => !c.computed.some(([q]: [string]) => q === p)).map(([p]: [string]) => p);
  ok(missing.length === 0 && extra.length === 0, `${c.name}: \`computed\` map — expected ${c.computed.length} concrete paths; missing ${JSON.stringify(missing.slice(0, 6))}, unexpected ${JSON.stringify(extra.slice(0, 6))} (record every computed field, changed or not, by its CONCRETE path; never a field whose parent is absent)`);
  ok(JSON.stringify([...(r.changed ?? [])].sort()) === JSON.stringify(c.changed), `${c.name}: \`changed\` — expected ${JSON.stringify(c.changed.slice(0, 8))}…, got ${JSON.stringify([...(r.changed ?? [])].sort().slice(0, 8))}…`);
  ok(JSON.stringify((r.errors ?? []).map((e: any) => e.id).sort()) === JSON.stringify(c.errorIds), `${c.name}: error ids — expected ${JSON.stringify(c.errorIds)}, got ${JSON.stringify((r.errors ?? []).map((e: any) => e.id).sort())}`);
  if (c.sameObjectIfUnchanged) ok(r.data === c.doc, `${c.name}: nothing changed, so computeDocument must return the very same input object`);
  try { const again = computeDocument(r.data, oracle.computations); ok(again.changed.length === 0, `${c.name}: not idempotent — computing the result again changed ${JSON.stringify(again.changed.slice(0, 6))}`); }
  catch (e) { ok(false, `${c.name}: second computeDocument threw (${(e as Error).message})`); }
}
console.log(fails.slice(0, 25).join('\n'));
console.log(fails.length ? `\n${fails.length} compute check(s) failed, ${passes} passed` : `\nAll ${passes} compute checks passed`);
process.exit(fails.length ? 1 : 0);
