// T4 — computed fields (M4). Copy verbatim to packages/core/src/t4-compute.test.ts
import { describe, expect, it } from 'vitest';
import { computeDocument, computedTemplatePaths, orderComputations, underAnyPath, validateComputationDefinition, validateDocument, type Computation, type Rule } from './index.js';

const c = (id: string, target: string, expression: string, extra: Partial<Computation> = {}): Computation => ({ id, name: id, target, expression, ...extra });

describe('computeDocument', () => {
  it('evaluates in dependency order regardless of listed order', () => {
    const comps = [c('total', 'inv.total', 'inv.net + inv.tax'), c('tax', 'inv.tax', 'round(inv.net * 0.18)'), c('net', 'inv.net', 'sum(inv.lines[*].amount)')];
    const { order } = orderComputations(comps);
    expect(order.map((x) => x.id)).toEqual(['net', 'tax', 'total']);
    const r = computeDocument({ inv: { lines: [{ amount: 100 }, { amount: 50 }] } }, comps);
    expect(r.data).toEqual({ inv: { lines: [{ amount: 100 }, { amount: 50 }], net: 150, tax: 27, total: 177 } });
    expect([...r.computed.keys()].sort()).toEqual(['inv.net', 'inv.tax', 'inv.total']);
    expect(r.errors).toEqual([]);
  });

  it('computes row-level targets per row with same-row bindings, before the column total', () => {
    const comps = [c('sum', 'o.total', 'sum(o.items[*].amount)'), c('row', 'o.items[*].amount', 'o.items[*].qty * o.items[*].price')];
    const r = computeDocument({ o: { items: [{ qty: 2, price: 5 }, { qty: 3, price: 1.1 }] } }, comps);
    expect(r.data).toEqual({ o: { items: [{ qty: 2, price: 5, amount: 10 }, { qty: 3, price: 1.1, amount: 3.3 }], total: 13.3 } });
    expect(r.computed.has('o.items[1].amount')).toBe(true);
  });

  it('does not create absent parents (optional schedules stay absent) and writes blank results as 0', () => {
    const comps = [c('a', 'sch.total', 'sum(sch.rows[*].x)'), c('b', 'main.total', 'sum(main.rows[*].x)')];
    const r = computeDocument({ main: {} }, comps);
    expect(r.data).toEqual({ main: { total: 0 } });
    expect(r.computed.has('sch.total')).toBe(false);
  });

  it('leaves a field as entered (not computed) when the condition is false', () => {
    const comps = [c('a', 'x.out', 'x.in * 2', { condition: 'x.mode == "auto"' })];
    expect(computeDocument({ x: { in: 4, out: 1, mode: 'manual' } }, comps).data).toEqual({ x: { in: 4, out: 1, mode: 'manual' } });
    const r = computeDocument({ x: { in: 4, out: 1, mode: 'auto' } }, comps);
    expect(r.data).toEqual({ x: { in: 4, out: 8, mode: 'auto' } });
    expect(r.changed).toEqual(['x.out']);
  });

  it('skips disabled computations and reports cycles and bad expressions without throwing', () => {
    const comps = [c('a', 'x.a', 'x.b + 1'), c('b', 'x.b', 'x.a + 1'), c('off', 'x.c', '99', { enabled: false }), c('bad', 'x.d', 'nosuchfn(1)')];
    const r = computeDocument({ x: {} }, comps);
    expect(r.errors.map((e) => e.id).sort()).toEqual(['a', 'b', 'bad']);
    expect((r.data as { x: Record<string, unknown> }).x.c).toBeUndefined();
    expect(computedTemplatePaths(comps).has('x.c')).toBe(false);
  });

  it('is pure and returns the same object when nothing changes', () => {
    const doc = { x: { a: 1, b: 2 } };
    const r = computeDocument(doc, [c('b', 'x.b', 'x.a * 2')]);
    expect(r.data).toBe(doc);
    expect(r.changed).toEqual([]);
  });

  it('removes floating-point noise', () => {
    expect(computeDocument({ x: { a: 0.1, b: 0.2 } }, [c('s', 'x.s', 'x.a + x.b')]).data).toEqual({ x: { a: 0.1, b: 0.2, s: 0.3 } });
  });

  it('computed values satisfy the matching equality rules', () => {
    const comps = [c('gti', 'r.gti', 'r.sal + r.os'), c('ti', 'r.ti', 'max(0, r.gti - r.ded)')];
    const rules: Rule[] = [
      { id: 'R1', name: 'gti', target: 'r.gti', check: { kind: 'compare', operator: '==', rhs: { type: 'expression', expression: 'r.sal + r.os' }, blankAsZero: true }, severity: 'error' },
      { id: 'R2', name: 'ti', target: 'r.ti', check: { kind: 'compare', operator: '==', rhs: { type: 'expression', expression: 'max(0, r.gti - r.ded)' }, blankAsZero: true }, severity: 'error' },
    ];
    const doc = { r: { sal: 500, os: 20, ded: 600, gti: 1, ti: 7 } };
    expect(validateDocument(doc, rules).errors.length).toBe(2);
    expect(validateDocument(computeDocument(doc, comps).data, rules).errors).toEqual([]);
  });
});

describe('underAnyPath', () => {
  it('matches the path itself and everything under it, ignoring indices', () => {
    expect(underAnyPath('a.b', ['a.b'])).toBe(true);
    expect(underAnyPath('a.b.c', ['a.b'])).toBe(true);
    expect(underAnyPath('a.b[2].c', ['a.b'])).toBe(true);
    expect(underAnyPath('a.b[2].c', ['a.b[*].c'])).toBe(true);
    expect(underAnyPath('a.bc', ['a.b'])).toBe(false);
    expect(underAnyPath('a.b', undefined)).toBe(false);
  });
});

describe('validateComputationDefinition', () => {
  it('accepts a valid definition and reports each problem', () => {
    expect(validateComputationDefinition(c('a', 'x.a', 'x.b + 1'))).toEqual([]);
    expect(validateComputationDefinition({ id: '', name: '', target: '', expression: '' }).length).toBe(3);
    expect(validateComputationDefinition(c('a', 'x.a', 'foo(1)'))[0]).toMatch(/expression/);
    expect(validateComputationDefinition(c('a', 'x.a', '1', { condition: 'bar(' }))[0]).toMatch(/condition/);
  });
});
