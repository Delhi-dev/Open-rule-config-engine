// T1 — path module (M1). Copy verbatim to packages/core/src/t1-path.test.ts
import { describe, expect, it } from 'vitest';
import { parsePath, formatPath, normalizePath, resolvePath, getAtPath, setAtPath, deleteAtPath, toTemplatePath } from './index.js';

const doc = {
  order: {
    customer: { name: 'Asha' },
    'PartB-ATI': { x: 5 },
    items: [
      { sku: 'A', qty: 2, price: 5 },
      { sku: 'B', qty: 3 },
      { sku: 'A', qty: 1, price: 2 },
    ],
  },
};

describe('T1 path', () => {
  it('parses and formats paths, keeping hyphens and indices', () => {
    expect(formatPath(parsePath('a.b[2].c'))).toBe('a.b[2].c');
    expect(normalizePath(' order.items[*].qty ')).toBe('order.items[*].qty');
    expect(formatPath(parsePath('order.PartB-ATI.x'))).toBe('order.PartB-ATI.x');
  });

  it('resolves wildcards to one match per row with bindings keyed by the array path', () => {
    const m = resolvePath(doc, 'order.items[*].qty');
    expect(m.map((x) => x.value)).toEqual([2, 3, 1]);
    expect(m.map((x) => x.path)).toEqual(['order.items[0].qty', 'order.items[1].qty', 'order.items[2].qty']);
    expect(m[1].bindings).toEqual({ 'order.items': 1 });
  });

  it('pins a wildcard with a binding so a second path lines up with the same row', () => {
    const m = resolvePath(doc, 'order.items[*].price', { 'order.items': 1 });
    expect(m.length).toBe(1);
    expect(m[0].path).toBe('order.items[1].price');
    expect(m[0].exists).toBe(false); // row 1 has no price key
    expect(m[0].value).toBeUndefined();
  });

  it('a missing or empty array yields no matches for per-item paths', () => {
    expect(resolvePath(doc, 'order.lines[*].amount')).toEqual([]);
    expect(resolvePath({ order: { lines: [] } }, 'order.lines[*].amount')).toEqual([]);
  });

  it('a missing key resolves to a single non-existing match', () => {
    const m = resolvePath(doc, 'order.customer.phone');
    expect(m.length).toBe(1);
    expect(m[0].exists).toBe(false);
  });

  it('getAtPath / setAtPath / deleteAtPath are immutable and create containers on the way', () => {
    expect(getAtPath(doc, 'order.PartB-ATI.x')).toBe(5);
    const next = setAtPath(doc, 'order.meta.tags[1]', 'new');
    expect(getAtPath(next, 'order.meta.tags[1]')).toBe('new');
    expect((doc.order as Record<string, unknown>).meta).toBeUndefined(); // original untouched
    expect(next.order.items).toBe(doc.order.items); // untouched branches are shared
    const fewer = deleteAtPath(doc, 'order.items[1]');
    expect(resolvePath(fewer, 'order.items[*].sku').map((m) => m.value)).toEqual(['A', 'A']);
    expect(doc.order.items.length).toBe(3);
  });

  it('toTemplatePath replaces every index with [*]', () => {
    expect(toTemplatePath('a.items[2].b[0].c')).toBe('a.items[*].b[*].c');
  });
});
