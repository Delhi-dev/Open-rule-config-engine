// T2 — expression language (M2). Copy verbatim to packages/core/src/t2-expression.test.ts
import { describe, expect, it } from 'vitest';
import { evaluateExpression, evaluateBoolean, checkExpression, expressionPaths } from './index.js';

const ev = (e: string, data: unknown = {}, b: Record<string, number> = {}) => evaluateExpression(e, data, b);
const evb = (e: string, data: unknown = {}, b: Record<string, number> = {}) => evaluateBoolean(e, data, b);

const doc = {
  a: 5,
  s: ' Hi ',
  'PartB-ATI': { x: 5 },
  rows: [
    { amt: 100, type: 'CG' },
    { amt: 50, type: 'OS' },
    { amt: 25, type: 'CG' },
  ],
  items: [
    { qty: 2, price: 5 },
    { qty: 3, price: 10 },
  ],
  d1: '2024-03-31',
  d2: '15/06/2024',
};

describe('T2 expressions', () => {
  it('arithmetic, precedence, modulo, unary minus', () => {
    expect(ev('2 + 3 * 4')).toBe(14);
    expect(ev('(2 + 3) * 4')).toBe(20);
    expect(ev('7 % 3')).toBe(1);
    expect(ev('-a + 1', doc)).toBe(-4);
  });

  it('blank counts as 0 in arithmetic; division by zero is blank', () => {
    expect(ev('a + missing', doc)).toBe(5);
    expect(ev('a / 0', doc)).toBeUndefined(); // null collapses to undefined
  });

  it('hyphen is an identifier character: subtraction needs spaces', () => {
    expect(ev('PartB-ATI.x + 1', doc)).toBe(6);
    expect(expressionPaths('a - b')).toEqual(['a', 'b']);
    expect(expressionPaths('a-b')).toEqual(['a-b']); // ONE path, not a subtraction
  });

  it('comparisons: blank side of a numeric comparison counts as 0; loose equality', () => {
    expect(evb('missing >= 0', doc)).toBe(true);
    expect(evb('missing > 0', doc)).toBe(false);
    expect(evb('"5" == 5')).toBe(true);
    expect(evb('missing == ""', doc)).toBe(true); // blank equals blank
    expect(evb('a != 4', doc)).toBe(true);
    expect(evb('a <> 4', doc)).toBe(true); // <> is !=
  });

  it('aggregates over wildcard paths; a bare list collapses to its sum', () => {
    expect(ev('sum(rows[*].amt)', doc)).toBe(175);
    expect(ev('rows[*].amt', doc)).toBe(175); // list → sum in evaluateExpression
    expect(ev('count(rows[*].amt)', doc)).toBe(3);
    expect(ev('max(rows[*].amt)', doc)).toBe(100);
    expect(ev('avg(rows[*].amt)', doc)).toBe(175 / 3);
    expect(ev('unique(rows[*].type)', doc)).toBe(2);
    expect(ev('first(rows[*].type)', doc)).toBe('CG');
    expect(ev('max(2, 9, 4)')).toBe(9); // variadic scalars too
    expect(ev('sum(nothing[*].x)', doc)).toBe(0); // missing array sums to 0
    expect(ev('min(nothing[*].x)', doc)).toBeUndefined(); // but min/max of nothing are blank
  });

  it('sumif / countif / anyif / allif iterate rows with the row bound in the condition', () => {
    expect(ev('sumif(rows[*].amt, rows[*].type == "CG")', doc)).toBe(125);
    expect(ev('countif(rows[*].amt, rows[*].amt > 30)', doc)).toBe(2);
    expect(ev('anyif(rows[*].amt, rows[*].type == "XX")', doc)).toBe(false);
    expect(ev('allif(rows[*].amt, rows[*].amt > 10)', doc)).toBe(true);
  });

  it('a bound wildcard reads the same row', () => {
    expect(ev('items[*].qty * items[*].price', doc, { items: 1 })).toBe(30);
  });

  it('scalar functions', () => {
    expect(ev('round(2.5)')).toBe(3);
    expect(ev('round(2.346, 2)')).toBe(2.35);
    expect(ev('floor(7 / 2)')).toBe(3);
    expect(ev('ceil(7 / 2)')).toBe(4);
    expect(ev('abs(0 - 4)')).toBe(4);
    expect(ev('if(a > 3, "big", "small")', doc)).toBe('big');
    expect(ev('nvl(missing, a, 9)', doc)).toBe(5);
    expect(ev('min(12500, a * 1000)', doc)).toBe(5000);
  });

  it('presence and membership', () => {
    expect(evb('exists(rows)', doc)).toBe(true);
    expect(evb('exists(nothing)', doc)).toBe(false);
    expect(evb('isblank(missing)', doc)).toBe(true);
    expect(evb('not isblank(a)', doc)).toBe(true);
    expect(evb('in(first(rows[*].type), "CG", "OS")', doc)).toBe(true);
    expect(evb('in(a, "1", "2")', doc)).toBe(false);
  });

  it('strings', () => {
    expect(ev('len(trim(s))', doc)).toBe(2);
    expect(ev('upper(trim(s))', doc)).toBe('HI');
    expect(ev('left("ABCDE", 2)')).toBe('AB');
    expect(ev('right("ABCDE", 2)')).toBe('DE');
    expect(evb('contains("DELA12345B", "A123")')).toBe(true);
    expect(evb('matches("DELA12345B", "^[A-Z]{4}[0-9]{5}[A-Z]$")')).toBe(true);
  });

  it('dates: ISO and DD/MM/YYYY, differences, parts', () => {
    expect(ev('days_between(d1, "2024-04-02")', doc)).toBe(2);
    expect(ev('date(d2)', doc)).toBe('2024-06-15');
    expect(ev('year(d1)', doc)).toBe(2024);
    expect(ev('month(d1)', doc)).toBe(3);
    expect(ev('day(d1)', doc)).toBe(31);
    expect(ev('months_between("2023-04-15", "2024-03-14")')).toBe(10);
    expect(ev('years_between("1964-04-01", "2024-03-31")')).toBe(59);
    expect(evb('d1 <= "2024-03-31"', doc)).toBe(true);
  });

  it('checkExpression validates without evaluating', () => {
    expect(() => checkExpression('nosuchfn(1)')).toThrow(/Unknown function/);
    expect(() => checkExpression('sumif(1, 2)')).toThrow();
    expect(() => checkExpression('a + ')).toThrow();
    expect(() => checkExpression('round(sum(items[*].amount) * 1.18, 2)')).not.toThrow();
  });
});
