// Loads every bundled form into a running server: for each rulesets/<form>/ folder, its official
// schema (ITR-n_..._Main_Vx.y.json) and every *.ruleset.json in it.
//   node rulesets/install-all.mjs [http://localhost:4000] [--only-missing]
// Without --only-missing, existing rule sets with the same name are updated (your edits to them are replaced).
// With --only-missing, existing rule sets are left untouched and only absent ones are created.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const onlyMissing = args.includes('--only-missing');
const base = (args.find((a) => !a.startsWith('--')) ?? 'http://localhost:4000').replace(/\/$/, '');

const j = async (url, init) => {
  const r = await fetch(base + url, init);
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${init?.method ?? 'GET'} ${url} -> ${r.status}: ${body.error ?? ''}`);
  return body;
};
const json = (method, body) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

// "ITR-1_2024_Main_V1.4.json" -> "ITR-1 AY 2024-25 (V1.4)" (the name install.mjs uses for ITR-1)
const schemaNameFor = (file) => {
  const m = path.basename(file).match(/^(ITR-\d+)_(\d{4})_Main_(V[\d.]+?)\.?json$/i);
  return m ? `${m[1]} AY ${m[2]}-${String(Number(m[2]) + 1).slice(2)} (${m[3]})` : path.basename(file, '.json');
};

const folders = fs.readdirSync(here, { withFileTypes: true }).filter((d) => d.isDirectory() && d.name !== 'test').map((d) => d.name).sort();
let created = 0, updated = 0, kept = 0;
for (const folder of folders) {
  const dir = path.join(here, folder);
  const files = fs.readdirSync(dir);
  const schemaFile = files.find((f) => /_Main_.*\.json$/i.test(f));
  const ruleSetFiles = files.filter((f) => f.endsWith('.ruleset.json')).sort();
  if (!schemaFile || !ruleSetFiles.length) continue;

  const name = schemaNameFor(schemaFile);
  let schema = (await j('/api/schemas')).find((s) => s.name === name);
  if (!schema) {
    const fd = new FormData();
    fd.append('file', new Blob([fs.readFileSync(path.join(dir, schemaFile))], { type: 'application/json' }), schemaFile);
    fd.append('name', name);
    schema = await j('/api/schemas', { method: 'POST', body: fd });
    console.log(`Uploaded schema "${name}"`);
  }

  const existingSets = await j(`/api/rulesets?schemaId=${schema.id}`);
  for (const f of ruleSetFiles) {
    const rs = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    const payload = { name: rs.name, description: rs.description, schemaId: schema.id, rules: rs.rules, computations: rs.computations ?? [], display: rs.display ?? null };
    const existing = existingSets.find((r) => r.name === rs.name);
    if (existing && onlyMissing) { kept++; continue; }
    const saved = existing
      ? await j(`/api/rulesets/${existing.id}`, json('PUT', payload))
      : await j('/api/rulesets', json('POST', payload));
    existing ? updated++ : created++;
    console.log(`  ${existing ? 'Updated' : 'Created'} "${saved.name}": ${saved.rules.length} rules, ${saved.computations?.length ?? 0} computed`);
  }
}
console.log(`Done: ${created} created, ${updated} updated, ${kept} left as they were.`);
