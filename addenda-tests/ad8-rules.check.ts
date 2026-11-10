// AD-8 check — packages/core/src/rules.ts (the part the Builder writes on top of the supplied rules-core.ts):
// the exports of §8, validateRuleDefinition (§8.6) on the 73 ITR-1 starter rules (all sound — the server will
// reject a rule set if this over-reports) and on synthetic sound/broken rules, and describe* never throwing.
// Run: npx tsx addenda-tests/ad8-rules.check.ts      (fixed data in ad8-rules.json — never edit)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as rules from '../packages/core/src/rules.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const { cases } = JSON.parse(fs.readFileSync(path.join(here, 'ad8-rules.json'), 'utf8'));
const r = rules as Record<string, any>;
let passes = 0;
const fails: string[] = [];
const ok = (cond: boolean, msg: string) => (cond ? passes++ : fails.push(`FAIL  rules.ts: ${msg}`));
for (const name of ['resolveOperand', 'evaluateCondition', 'validateDocument', 'validateWithRuleSet', 'describeOperand', 'describeCheck', 'describeCondition', 'describeRule', 'validateRuleDefinition'])
  ok(typeof r[name] === 'function', `'${name}' must be exported from rules.ts`);
for (const c of cases) {
  const label = `${c.source} rule ${JSON.stringify(c.rule).slice(0, 160)}`;
  let problems: unknown;
  try { problems = r.validateRuleDefinition?.(c.rule); } catch (e) { ok(false, `validateRuleDefinition threw (${(e as Error).message}) for ${label}`); continue; }
  if (!Array.isArray(problems)) { ok(false, `validateRuleDefinition must return a string[] — got ${JSON.stringify(problems)} for ${label}`); continue; }
  if (c.sound) ok(problems.length === 0, `validateRuleDefinition reported ${JSON.stringify(problems)} for a SOUND ${label}`);
  else ok(problems.length > 0, `validateRuleDefinition reported nothing for a BROKEN ${label}`);
  for (const fn of ['describeRule', 'describeCheck'] as const) {
    try {
      const s = fn === 'describeRule' ? r.describeRule(c.rule) : r.describeCheck(c.rule.check);
      ok(typeof s === 'string' && s.trim().length > 0, `${fn} returned ${JSON.stringify(s)} (must be a non-empty sentence) for ${label}`);
    } catch (e) { ok(false, `${fn} threw (${(e as Error).message}) — it must never throw — for ${label}`); }
  }
  if (c.rule.condition) {
    try { const s = r.describeCondition(c.rule.condition); ok(typeof s === 'string' && s.trim().length > 0, `describeCondition returned ${JSON.stringify(s)} for ${label}`); }
    catch (e) { ok(false, `describeCondition threw (${(e as Error).message}) for ${label}`); }
  }
}
console.log(fails.slice(0, 25).join('\n'));
if (fails.length > 25) console.log(`… and ${fails.length - 25} more`);
console.log(fails.length ? `\n${fails.length} rules.ts check(s) failed, ${passes} passed` : `\nAll ${passes} rules.ts checks passed`);
process.exit(fails.length ? 1 : 0);
