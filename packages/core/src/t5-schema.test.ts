// T5 — document utilities and schema building (M5). Copy verbatim to packages/core/src/t5-schema.test.ts
import { describe, expect, it } from 'vitest';
import {
  buildSchemaFromText,
  flattenSchema,
  findSchemaNode,
  emptyDocument,
  pruneBlanks,
  coerceValue,
  isBlank,
  parseDocument,
  serializeDocument,
  formatOfFile,
} from './index.js';

const miniSchema = JSON.stringify({
  $schema: 'http://json-schema.org/draft-07/schema#',
  type: 'object',
  properties: { ITR: { $ref: '#/definitions/ITR' } },
  required: ['ITR'],
  definitions: {
    ITR: {
      type: 'object',
      properties: {
        Form: { type: 'object', properties: { Name: { type: 'string', enum: ['ITR-1'] }, Ver: { type: 'string' } }, required: ['Name'] },
        Dob: { type: 'string', format: 'date', description: 'Date of birth' },
        Amounts: { type: 'array', items: { $ref: '#/definitions/Row' } },
        Mixed: { allOf: [{ $ref: '#/definitions/Row' }, { type: 'object', properties: { extra: { type: 'integer' } }, required: ['extra'] }] },
      },
      required: ['Form'],
    },
    Row: { type: 'object', properties: { code: { type: 'string' }, amt: { type: 'integer' } }, required: ['amt'] },
  },
});

describe('T5 schema + document utilities', () => {
  const built = buildSchemaFromText(miniSchema, 'mini.json');

  it('detects a JSON Schema and builds the uniform tree', () => {
    expect(built.format).toBe('json');
    expect(built.source).toBe('json-schema');
    const paths = flattenSchema(built.root).map((n) => n.path);
    expect(paths).toContain('ITR.Form.Name');
    expect(paths).toContain('ITR.Amounts[*].amt');
    expect(paths).toContain('ITR.Mixed.extra');
    const name = findSchemaNode(built.root, 'ITR.Form.Name')!;
    expect(name.enum).toEqual(['ITR-1']);
    expect(name.required).toBe(true);
    expect(findSchemaNode(built.root, 'ITR.Dob')!.type).toBe('date');
    expect(findSchemaNode(built.root, 'ITR.Dob')!.description).toBe('Date of birth');
    expect(findSchemaNode(built.root, 'ITR.Amounts')!.type).toBe('array');
    expect(findSchemaNode(built.root, 'ITR.Amounts[*].amt')!.required).toBe(true);
    expect(findSchemaNode(built.root, 'ITR.Mixed.extra')!.required).toBe(true);
  });

  it('a plain JSON sample infers a schema instead', () => {
    const s = buildSchemaFromText(JSON.stringify({ a: 1, rows: [{ x: 'p' }, { x: 'q', y: 2 }] }), 'sample.json');
    expect(s.source).toBe('json-sample');
    const paths = flattenSchema(s.root).map((n) => n.path);
    expect(paths).toContain('rows[*].x');
    expect(paths).toContain('rows[*].y'); // array item keys are merged across samples
  });

  it('emptyDocument mirrors the schema shape with blank leaves', () => {
    const d = emptyDocument(built.root) as Record<string, any>;
    expect(d.ITR.Form).toEqual({ Name: '', Ver: '' });
    expect(d.ITR.Amounts).toEqual([]);
    expect(d.ITR.Dob).toBe('');
  });

  it('isBlank and pruneBlanks: blank leaves go, containers stay', () => {
    expect(isBlank('')).toBe(true);
    expect(isBlank(0)).toBe(false);
    expect(isBlank([])).toBe(true);
    expect(pruneBlanks({ a: '', b: null, c: 0, d: { e: '  x ' }, f: [] })).toEqual({ c: 0, d: { e: '  x ' }, f: [] });
  });

  it('coerceValue follows the node type', () => {
    expect(coerceValue('42', { name: 'n', path: 'n', type: 'integer' })).toBe(42);
    expect(coerceValue('', { name: 'n', path: 'n', type: 'number' })).toBeNull();
    expect(coerceValue('x', { name: 'n', path: 'n', type: 'number' })).toBe('x'); // non-numeric text kept for validation to flag
    expect(coerceValue('true', { name: 'n', path: 'n', type: 'boolean' })).toBe(true);
  });

  it('JSON documents round-trip; formatOfFile sniffs by name then content', () => {
    const data = { a: [1, 2] };
    expect(parseDocument(serializeDocument(data, 'json'), 'json')).toEqual(data);
    expect(formatOfFile('x.json', '{}')).toBe('json');
    expect(formatOfFile('x.xml', '<a/>')).toBe('xml');
  });
});
