// T6 — REST API smoke test (M6). Copy verbatim to server-tests/t6-api.mjs
// Run from the repository root AFTER `npm run build`:  node server-tests/t6-api.mjs
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const port = 4300 + Math.floor(Math.random() * 500);
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 't6-'));
const server = spawn('node', ['packages/server/dist/index.js'], { env: { ...process.env, PORT: String(port), DATA_DIR: dataDir }, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 1200));
const base = `http://localhost:${port}`;
let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : ' — ' + detail}`);
  if (!ok) failures++;
};
const j = async (url, init) => {
  const r = await fetch(base + url, init);
  const body = r.status === 204 ? undefined : await r.json().catch(() => undefined);
  return { status: r.status, body };
};
const post = (url, body) => j(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

const miniSchema = {
  type: 'object',
  properties: {
    inv: {
      type: 'object',
      properties: {
        lines: { type: 'array', items: { type: 'object', properties: { amount: { type: 'integer' } }, required: ['amount'] } },
        net: { type: 'integer' },
        tax: { type: 'integer' },
        total: { type: 'integer' },
      },
      required: ['net'],
    },
  },
  required: ['inv'],
};

try {
  // schema upload (multipart)
  const fd = new FormData();
  fd.append('file', new Blob([JSON.stringify(miniSchema)], { type: 'application/json' }), 'mini.json');
  fd.append('name', 'Mini invoice');
  const up = await fetch(`${base}/api/schemas`, { method: 'POST', body: fd });
  const schema = await up.json();
  check('POST /api/schemas parses a JSON Schema', up.status === 201 && schema.source === 'json-schema' && schema.root, JSON.stringify(schema).slice(0, 120));
  const list = await j('/api/schemas');
  check('GET /api/schemas lists summaries without the tree', list.body.length === 1 && list.body[0].name === 'Mini invoice' && !list.body[0].root);

  // rule set create: valid, then invalid rule, then invalid computation
  const rules = [
    { id: 'net', name: 'net = sum of lines', target: 'inv.net', severity: 'error', check: { kind: 'compare', operator: '==', rhs: { type: 'expression', expression: 'sum(inv.lines[*].amount)' }, blankAsZero: true } },
    { id: 'cap', name: 'total cap', target: 'inv.total', severity: 'warning', check: { kind: 'max', value: 1000 } },
  ];
  const computations = [
    { id: 'c-net', name: 'net', target: 'inv.net', expression: 'sum(inv.lines[*].amount)' },
    { id: 'c-tax', name: 'tax', target: 'inv.tax', expression: 'round(inv.net * 0.18)' },
    { id: 'c-total', name: 'total', target: 'inv.total', expression: 'inv.net + inv.tax' },
  ];
  const display = { readOnly: ['inv.lines'], collapsed: ['inv.lines'] };
  const rsRes = await post('/api/rulesets', { name: 'Invoice rules', schemaId: schema.id, rules, computations, display });
  check('POST /api/rulesets stores rules + computations + display', rsRes.status === 201 && rsRes.body.computations.length === 3 && rsRes.body.display.readOnly[0] === 'inv.lines');
  const bad1 = await post('/api/rulesets', { name: 'bad', schemaId: schema.id, rules: [{ id: 'x', name: 'x', target: 'inv.net', severity: 'error', check: { kind: 'pattern', regex: '(' } }] });
  check('invalid rule definition → 400 with the problem named', bad1.status === 400 && /pattern|regex|Invalid/i.test(bad1.body.error ?? ''), JSON.stringify(bad1.body));
  const bad2 = await post('/api/rulesets', { name: 'bad2', schemaId: schema.id, rules: [], computations: [{ id: 'c', name: 'c', target: 'inv.net', expression: 'foo(' }] });
  check('invalid computation → 400', bad2.status === 400);

  // validate: computes first, returns computed doc + computedFields
  const val = await post('/api/validate', { data: { inv: { lines: [{ amount: 100 }, { amount: 50 }] } }, ruleSetId: rsRes.body.id });
  check('POST /api/validate computes then validates', val.body.valid === true && val.body.data.inv.total === 177 && val.body.computedFields.includes('inv.net'), JSON.stringify(val.body).slice(0, 200));
  const val2 = await post('/api/validate', { data: { inv: { lines: [{ amount: 900 }, { amount: 50 }] } }, ruleSetId: rsRes.body.id });
  check('warnings do not make the document invalid', val2.body.valid === true && val2.body.warnings.length === 1 && val2.body.warnings[0].ruleId === 'cap');

  // documents: save recomputes before storing; empty-document; parse; export
  const save = await post('/api/documents', { name: 'inv-1', schemaId: schema.id, ruleSetId: rsRes.body.id, data: { inv: { lines: [{ amount: 100 }, { amount: 50 }], net: 1, tax: 2, total: 3 } } });
  check('POST /api/documents recomputes computed fields before storing', save.status === 201 && save.body.data.inv.net === 150 && save.body.data.inv.total === 177);
  const got = await j(`/api/documents/${save.body.id}`);
  check('GET /api/documents/:id returns the stored document', got.body.name === 'inv-1' && got.body.data.inv.tax === 27);
  const empty = await j(`/api/schemas/${schema.id}/empty-document`);
  check('GET /api/schemas/:id/empty-document mirrors the schema', empty.body.data.inv.lines.length === 0 && empty.body.format === 'json');
  const pf = new FormData();
  pf.append('file', new Blob([JSON.stringify({ inv: { lines: [], net: 0 } })], { type: 'application/json' }), 'up.json');
  pf.append('schemaId', schema.id);
  const parsed = await (await fetch(`${base}/api/documents/parse`, { method: 'POST', body: pf })).json();
  check('POST /api/documents/parse parses without storing', parsed.name === 'up' && parsed.data.inv.net === 0);
  const exp = await fetch(`${base}/api/rulesets/${rsRes.body.id}/export`);
  const expBody = await exp.json();
  check('ruleset export carries rules + computations + display and re-imports', expBody.rules.length === 2 && expBody.computations.length === 3 && expBody.display.readOnly.length === 1);

  // deletes and 404s
  const del = await fetch(`${base}/api/documents/${save.body.id}`, { method: 'DELETE' });
  check('DELETE /api/documents/:id → 204', del.status === 204);
  const miss = await j('/api/rulesets/nope');
  check('unknown id → 404 JSON error', miss.status === 404 && typeof miss.body.error === 'string');
  const guard = await fetch(`${base}/api/schemas/${schema.id}`, { method: 'DELETE' });
  check('schema with dependent rule sets → 409 without force', guard.status === 409);
  const forced = await fetch(`${base}/api/schemas/${schema.id}?force=true`, { method: 'DELETE' });
  check('…and 204 with ?force=true (cascades)', forced.status === 204 && (await j('/api/rulesets')).body.length === 0);
} catch (e) {
  check('T6 run', false, e.stack);
} finally {
  server.kill();
}
console.log(failures ? `\n${failures} check(s) failed` : '\nAll T6 checks passed');
process.exit(failures ? 1 : 0);
