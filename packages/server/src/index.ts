import express from 'express';
import cors from 'cors';
import { fileCollection } from './storage.js';
import { nanoid } from 'nanoid';
import {
  buildSchemaFromText,
  emptyDocument,
  computeDocument,
  validateDocument,
  validateWithRuleSet,
  parseDocument,
  serializeDocument,
  validateRuleDefinition,
  validateComputationDefinition,
} from '@rule-engine/core';
import type { RuleSet, Rule, Computation, DisplaySettings, SchemaDefinition, StoredDocument } from '@rule-engine/core';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function wrap(fn: (req: express.Request, res: express.Response, next: express.NextFunction) => unknown) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

function now() {
  return new Date().toISOString();
}

function id() {
  return nanoid(12);
}

const app = express();
app.use(express.json({ limit: '20mb' }));
app.use(cors());
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');
const schemasCol = fileCollection<SchemaDefinition>(path.join(DATA_DIR, 'schemas'));
const rulesetsCol = fileCollection<RuleSet>(path.join(DATA_DIR, 'rulesets'));
const documentsCol = fileCollection<StoredDocument>(path.join(DATA_DIR, 'documents'));

const optStr = (v: unknown) => (typeof v === 'string' ? v : undefined);

function sanitizeRules(rules: unknown): Rule[] {
  if (!Array.isArray(rules)) throw new HttpError(400, 'rules must be an array');
  const problems: string[] = [];
  const out = rules.map((raw, i) => {
    const r = (raw && typeof raw === 'object' ? raw : {}) as any;
    const rule: Rule = {
      id: typeof r.id === 'string' && r.id ? r.id : id(),
      name: String(r.name ?? ''),
      target: String(r.target ?? ''),
      check: r.check,
      condition: r.condition,
      severity: r.severity === 'warning' ? 'warning' : 'error',
      message: optStr(r.message),
      enabled: r.enabled !== false,
      ref: optStr(r.ref), notes: optStr(r.notes), group: optStr(r.group),
    };
    for (const p of validateRuleDefinition(rule)) problems.push(`Rule ${i + 1} (${rule.name || 'unnamed'}): ${p}`);
    return rule;
  });
  if (problems.length) throw new HttpError(400, problems.join('; '));
  return out;
}

function sanitizeComputations(list: unknown): Computation[] {
  if (list === undefined || list === null) return [];
  if (!Array.isArray(list)) throw new HttpError(400, 'computations must be an array');
  const problems: string[] = [];
  const out = list.map((raw, i) => {
    const c = (raw && typeof raw === 'object' ? raw : {}) as any;
    const comp: Computation = {
      id: typeof c.id === 'string' && c.id ? c.id : id(),
      name: String(c.name ?? ''),
      target: String(c.target ?? ''),
      expression: String(c.expression ?? ''),
      condition: typeof c.condition === 'string' && c.condition.trim() ? c.condition : undefined,
      enabled: c.enabled !== false,
      ref: optStr(c.ref), notes: optStr(c.notes), group: optStr(c.group),
    };
    for (const p of validateComputationDefinition(comp)) problems.push(`Computation ${i + 1} (${comp.name || comp.target}): ${p}`);
    return comp;
  });
  if (problems.length) throw new HttpError(400, problems.join('; '));
  return out;
}

function sanitizeDisplay(d: unknown): DisplaySettings | undefined {
  if (d === undefined || d === null) return undefined;
  if (typeof d !== 'object' || Array.isArray(d)) throw new HttpError(400, 'display must be an object');
  const list = (v: unknown, name: string) => {
    if (v === undefined) return undefined;
    if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) throw new HttpError(400, `display.${name} must be an array of paths`);
    return (v as string[]).map((x) => x.trim()).filter(Boolean);
  };
  const o = d as Record<string, unknown>;
  return { readOnly: list(o.readOnly, 'readOnly'), collapsed: list(o.collapsed, 'collapsed') };
}

app.get('/api/schemas', wrap(async (req, res) => {
  const schemas = await schemasCol.list();
  schemas.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  const summaries = schemas.map(s => ({
    id: s.id,
    name: s.name,
    format: s.format,
    source: s.source,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  }));
  res.json(summaries);
}));

app.post('/api/schemas', upload.single('file'), wrap(async (req, res) => {
  if (!req.file) throw new HttpError(400, 'Missing file');
  const text = req.file.buffer.toString();
  const schemaDef = buildSchemaFromText(text, req.file.originalname);
  const format = req.file.originalname?.toLowerCase().endsWith('.json') ? 'json' : 'xml';
  const schema: SchemaDefinition = {
    id: id(),
    name: (typeof req.body?.name === 'string' && req.body.name.trim()) || req.file.originalname,
    format: schemaDef.format as SchemaDefinition["format"],
    source: schemaDef.source as SchemaDefinition["source"],
    sourceText: text,
    root: schemaDef.root,
    createdAt: now(),
    updatedAt: now(),
  };
  const saved = await schemasCol.put(schema);
  res.status(201).json(saved);
}));

app.get('/api/schemas/:id', wrap(async (req, res) => {
  const schema = await schemasCol.get(req.params.id);
  if (!schema) throw new HttpError(404, 'Schema not found');
  res.json(schema);
}));

app.patch('/api/schemas/:id', upload.any(), wrap(async (req, res) => {
  const schema = await schemasCol.get(req.params.id);
  if (!schema) throw new HttpError(404, 'Schema not found');
  if (req.body.name !== undefined) schema.name = req.body.name;
  await schemasCol.put(schema);
  res.json(schema);
}));

app.delete('/api/schemas/:id', wrap(async (req, res) => {
  const schema = await schemasCol.get(req.params.id);
  if (!schema) throw new HttpError(404, 'Schema not found');
  const ruleSets = await rulesetsCol.list();
  const dependent = ruleSets.some(rs => rs.schemaId === schema.id);
  if (dependent && req.query.force !== 'true') {
    throw new HttpError(409, 'Schema has dependent rule sets');
  }
  for (const rs of ruleSets.filter(rs => rs.schemaId === schema.id)) await rulesetsCol.remove(rs.id);
  for (const d of (await documentsCol.list()).filter(d => d.schemaId === schema.id)) await documentsCol.remove(d.id);
  await schemasCol.remove(schema.id);
  res.status(204).send();
}));

app.get('/api/schemas/:id/empty-document', wrap(async (req, res) => {
  const schema = await schemasCol.get(req.params.id);
  if (!schema) throw new HttpError(404, 'Schema not found');
  const empty = emptyDocument(schema.root);
  res.json({ format: schema.format, data: empty });
}));

app.get('/api/rulesets', wrap(async (req, res) => {
  const schemaId = req.query.schemaId as string;
  let ruleSets = await rulesetsCol.list();
  if (schemaId) {
    ruleSets = ruleSets.filter(rs => rs.schemaId === schemaId);
  }
  ruleSets.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  res.json(ruleSets);
}));

app.post('/api/rulesets', wrap(async (req, res) => {
  const { name, description, schemaId, rules, computations, display } = req.body ?? {};
  if (typeof name !== 'string' || !name.trim()) throw new HttpError(400, 'name is required');
  const schema = await schemasCol.get(String(schemaId));
  if (!schema) throw new HttpError(400, 'Schema not found');
  const ruleSet: RuleSet = {
    id: id(),
    name: name.trim(),
    description: optStr(description),
    schemaId: schema.id,
    rules: sanitizeRules(rules ?? []),
    computations: sanitizeComputations(computations),
    display: sanitizeDisplay(display),
    createdAt: now(),
    updatedAt: now(),
  };
  res.status(201).json(await rulesetsCol.put(ruleSet));
}));

app.get('/api/rulesets/:id', wrap(async (req, res) => {
  const ruleSet = await rulesetsCol.get(req.params.id);
  if (!ruleSet) throw new HttpError(404, 'Rule set not found');
  res.json(ruleSet);
}));

app.put('/api/rulesets/:id', wrap(async (req, res) => {
  const ruleSet = await rulesetsCol.get(req.params.id);
  if (!ruleSet) throw new HttpError(404, 'Rule set not found');
  const body = req.body ?? {};
  if (body.name !== undefined) {
    if (typeof body.name !== 'string' || !body.name.trim()) throw new HttpError(400, 'name must be a non-empty string');
    ruleSet.name = body.name.trim();
  }
  if (body.description !== undefined) ruleSet.description = optStr(body.description);
  if (body.rules !== undefined) ruleSet.rules = sanitizeRules(body.rules);
  if (body.computations !== undefined) ruleSet.computations = sanitizeComputations(body.computations);
  if (body.display !== undefined) ruleSet.display = sanitizeDisplay(body.display);
  ruleSet.updatedAt = now();
  res.json(await rulesetsCol.put(ruleSet));
}));

app.delete('/api/rulesets/:id', wrap(async (req, res) => {
  const ruleSet = await rulesetsCol.get(req.params.id);
  if (!ruleSet) throw new HttpError(404, 'Rule set not found');
  const documents = await documentsCol.list();
  const hasDocs = documents.some(d => d.ruleSetId === ruleSet.id);
  if (hasDocs && req.query.force !== 'true') {
    throw new HttpError(409, 'Rule set has documents');
  }
  if (hasDocs) {
    for (const d of documents.filter(d => d.ruleSetId === ruleSet.id)) {
      await documentsCol.remove(d.id);
    }
  }
  await rulesetsCol.remove(ruleSet.id);
  res.status(204).send();
}));

app.get('/api/rulesets/:id/export', wrap(async (req, res) => {
  const ruleSet = await rulesetsCol.get(req.params.id);
  if (!ruleSet) throw new HttpError(404, 'Rule set not found');
  const schema = await schemasCol.get(ruleSet.schemaId);
  const out: Record<string, unknown> = { name: ruleSet.name, description: ruleSet.description, schemaName: schema?.name ?? '', rules: ruleSet.rules };
  if (ruleSet.computations?.length) out.computations = ruleSet.computations;
  if (ruleSet.display) out.display = ruleSet.display;
  res.setHeader('Content-Disposition', `attachment; filename="${ruleSet.name.replace(/[^\w.-]+/g, '_')}.ruleset.json"`);
  res.json(out);
}));

app.post('/api/validate', wrap(async (req, res) => {
  const { data, ruleSetId, rules, computations } = req.body ?? {};
  let ruleList: Rule[];
  let comps: Computation[];
  if (ruleSetId) {
    const rs = await rulesetsCol.get(String(ruleSetId));
    if (!rs) throw new HttpError(404, 'Rule set not found');
    ruleList = rs.rules;
    comps = rs.computations ?? [];
  } else {
    ruleList = sanitizeRules(rules ?? []);
    comps = sanitizeComputations(computations);
  }
  const computeResult = computeDocument(data, comps);
  res.json({
    ...validateDocument(computeResult.data, ruleList),
    data: computeResult.data,
    computedFields: [...computeResult.computed.keys()],
    computeErrors: computeResult.errors,
  });
}));

app.post('/api/documents/parse', upload.single('file'), wrap(async (req, res) => {
  const schema = await schemasCol.get(String(req.body?.schemaId));
  if (!schema) throw new HttpError(404, 'Schema not found');
  if (!req.file) throw new HttpError(400, 'Missing file');
  const text = req.file.buffer.toString('utf8');
  const format: 'json' | 'xml' = text.trimStart().startsWith('<') ? 'xml' : 'json';
  if (format !== schema.format) throw new HttpError(400, `Schema expects ${schema.format.toUpperCase()} but file is ${format.toUpperCase()}`);
  let data: unknown;
  try { data = parseDocument(text, format, schema.root); }
  catch (e) { throw new HttpError(400, `Could not parse file: ${(e as Error).message}`); }
  res.json({ name: req.file.originalname.replace(/\.[^.]+$/, ''), format, data });
}));

app.get('/api/documents', wrap(async (req, res) => {
  let docs: StoredDocument[] = await documentsCol.list();
  if (typeof req.query.schemaId === 'string') docs = docs.filter(d => d.schemaId === req.query.schemaId);
  res.json(docs
    .map(({ id, name, schemaId, ruleSetId, format, createdAt, updatedAt }) => ({ id, name, schemaId, ruleSetId, format, createdAt, updatedAt }))
    .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || '')));
}));

app.post('/api/documents', wrap(async (req, res) => {
  const { id: docId, name, schemaId, ruleSetId, data } = req.body ?? {};
  const schema = await schemasCol.get(String(schemaId));
  if (!schema) throw new HttpError(400, 'Schema not found');
  if (typeof name !== 'string' || !name.trim()) throw new HttpError(400, 'name is required');
  if (data === undefined) throw new HttpError(400, 'data is required');
  let stored = data;
  if (ruleSetId) {
    const ruleSet = await rulesetsCol.get(String(ruleSetId));
    if (!ruleSet) throw new HttpError(404, 'Rule set not found');
    if (ruleSet.computations?.length) stored = computeDocument(data, ruleSet.computations).data;
  }
  const previous = typeof docId === 'string' && docId ? await documentsCol.get(docId) : undefined;
  const doc: StoredDocument = {
    id: previous?.id ?? id(),
    name: name.trim(),
    schemaId: schema.id,
    ruleSetId: ruleSetId ? String(ruleSetId) : undefined,
    format: schema.format,
    data: stored,
    createdAt: previous?.createdAt ?? now(),
    updatedAt: now(),
  };
  await documentsCol.put(doc);
  res.status(previous ? 200 : 201).json(doc);
}));

app.get('/api/documents/:id', wrap(async (req, res) => {
  const doc = await documentsCol.get(req.params.id);
  if (!doc) throw new HttpError(404, 'Document not found');
  res.json(doc);
}));

app.delete('/api/documents/:id', wrap(async (req, res) => {
  const doc = await documentsCol.get(req.params.id);
  if (!doc) throw new HttpError(404, 'Document not found');
  await documentsCol.remove(doc.id);
  res.status(204).send();
}));

app.get('/api/documents/:id/export', wrap(async (req, res) => {
  const doc = await documentsCol.get(req.params.id);
  if (!doc) throw new HttpError(404, 'Document not found');
  const text = serializeDocument(doc.data, doc.format);
  res.setHeader('Content-Disposition', `attachment; filename="${doc.name}.doc"`);
  res.send(text);
}));

app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err instanceof HttpError) res.status(err.status).json({ error: err.message });
  else { console.error(err); res.status(500).json({ error: (err as Error)?.message ?? 'Internal Server Error' }); }
});


const clientDist = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..', 'client', 'dist'); // packages/server/dist → packages/client/dist
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get('*', wrap(async (req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  }));
}

const port = Number(process.env.PORT ?? 4000);
app.listen(port, () => {
  console.log(`Server listening at http://localhost:${port}`);
});
