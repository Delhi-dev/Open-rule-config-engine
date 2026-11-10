// Loads the ITR-1 starter schema + rule set into a running server (idempotent).
//   node rulesets/itr1-ay2024-25/install.mjs [http://localhost:4000]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const base = (process.argv[2] ?? 'http://localhost:4000').replace(/\/$/, '');
const rs = JSON.parse(fs.readFileSync(path.join(here, 'starter.ruleset.json'), 'utf8'));
const schemaFile = path.join(here, 'ITR-1_2024_Main_V1.4.json');

const j = async (url, init) => {
  const r = await fetch(base + url, init);
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${init?.method ?? 'GET'} ${url} -> ${r.status}: ${body.error ?? ''}`);
  return body;
};

let schema = (await j('/api/schemas')).find((s) => s.name === rs.schemaName);
if (!schema) {
  const fd = new FormData();
  fd.append('file', new Blob([fs.readFileSync(schemaFile)], { type: 'application/json' }), path.basename(schemaFile));
  fd.append('name', rs.schemaName);
  schema = await j('/api/schemas', { method: 'POST', body: fd });
  console.log(`Uploaded schema "${schema.name}" (${schema.id})`);
} else console.log(`Using existing schema "${schema.name}" (${schema.id})`);

const payload = { name: rs.name, description: rs.description, schemaId: schema.id, rules: rs.rules, computations: rs.computations ?? [], display: rs.display ?? null };
const existing = (await j(`/api/rulesets?schemaId=${schema.id}`)).find((r) => r.name === rs.name);
const saved = existing
  ? await j(`/api/rulesets/${existing.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
  : await j('/api/rulesets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
console.log(`${existing ? 'Updated' : 'Created'} rule set "${saved.name}" with ${saved.rules.length} rules and ${saved.computations?.length ?? 0} computed fields`);
console.log('Open the app -> Documents -> schema "' + rs.schemaName + '".');
