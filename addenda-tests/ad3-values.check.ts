// AD-3 check 1 of 3 — packages/core/src/expr-values.ts.  Run: npx tsx addenda-tests/ad3-values.check.ts
import { checker } from './_check.js';
import {
  isBlankValue, toNumber, toDate, truthy, looseEquals, compareValues, flatten, numbers, arithmetic, toValue, monthsBetween,
} from '../packages/core/src/expr-values.js';

const c = checker('expr-values.ts');
// isBlankValue
c.eq('isBlankValue(undefined)', () => isBlankValue(undefined), true);
c.eq('isBlankValue(null)', () => isBlankValue(null), true);
c.eq("isBlankValue('  ')", () => isBlankValue('  '), true);
c.eq('isBlankValue([])', () => isBlankValue([]), true);
c.eq('isBlankValue({})', () => isBlankValue({}), true);
c.eq('isBlankValue(0)', () => isBlankValue(0), false);
c.eq('isBlankValue(false)', () => isBlankValue(false), false);
// toNumber
c.eq("toNumber('12.5')", () => toNumber('12.5'), 12.5);
c.eq('toNumber(true)', () => toNumber(true), 1);
c.eq("toNumber('x')", () => toNumber('x'), null);
c.eq('toNumber(NaN)', () => toNumber(NaN), null);
c.eq('toNumber(null)', () => toNumber(null), null);
// toDate — epoch ms, date-only as UTC midnight
c.eq("toDate('2024-03-31')", () => toDate('2024-03-31'), Date.UTC(2024, 2, 31));
c.eq("toDate('31/03/2024')", () => toDate('31/03/2024'), Date.UTC(2024, 2, 31));
c.eq("toDate('31-03-2024')", () => toDate('31-03-2024'), Date.UTC(2024, 2, 31));
c.eq("toDate('hello')", () => toDate('hello'), null);
// truthy
c.eq("truthy('false')", () => truthy('false'), false);
c.eq("truthy('0')", () => truthy('0'), false);
c.eq("truthy(' ')", () => truthy(' '), false);
c.eq('truthy([])', () => truthy([]), false);
c.eq('truthy([0])', () => truthy([0]), true);
c.eq('truthy(0)', () => truthy(0), false);
c.eq("truthy('Y')", () => truthy('Y'), true);
// looseEquals
c.eq("looseEquals('', null)", () => looseEquals('', null), true);
c.eq("looseEquals('', 'a')", () => looseEquals('', 'a'), false);
c.eq("looseEquals('5', 5)", () => looseEquals('5', 5), true);
c.eq("looseEquals('2024-03-31', '31/03/2024')", () => looseEquals('2024-03-31', '31/03/2024'), true);
c.eq("looseEquals('a', 'A')", () => looseEquals('a', 'A'), false);
// compareValues
c.eq('compareValues(1, 2)', () => compareValues(1, 2), -1);
c.eq("compareValues('b', 'a')", () => compareValues('b', 'a'), 1);
c.eq("compareValues('10', 9)", () => compareValues('10', 9), 1);
c.eq('compareValues(null, 1)', () => compareValues(null, 1), null);
c.eq('compareValues([1], 1)', () => compareValues([1], 1), null);
// flatten / numbers
c.eq('flatten([1, [2, [3]]])', () => flatten([1, [2, [3]]]), [1, 2, 3]);
c.eq("numbers([1, '2', 'x', null])", () => numbers([1, '2', 'x', null]), [1, 2]);
// arithmetic — blanks as 0, division/modulo by zero → null
c.eq("arithmetic('+', null, 2)", () => arithmetic('+', null, 2), 2);
c.eq("arithmetic('-', 5, '2')", () => arithmetic('-', 5, '2'), 3);
c.eq("arithmetic('/', 1, 0)", () => arithmetic('/', 1, 0), null);
c.eq("arithmetic('%', 5, 0)", () => arithmetic('%', 5, 0), null);
c.eq("arithmetic('%', 7, 3)", () => arithmetic('%', 7, 3), 1);
c.eq("arithmetic('+', [1, 2], 3) — a list counts as 0 (AD-6)", () => arithmetic('+', [1, 2], 3), 3);
c.eq("arithmetic('+', 'abc', 2) — non-numeric counts as 0 (AD-6)", () => arithmetic('+', 'abc', 2), 2);
// toValue — document data → Value
c.eq('toValue(undefined)', () => toValue(undefined), null);
c.eq('toValue({})', () => toValue({}), null);
c.eq('toValue({ a: 1 })', () => toValue({ a: 1 }), 'object');
c.eq('toValue([1, {}])', () => toValue([1, {}]), [1, null]);
// monthsBetween — UTC calendar months, minus 1 when day(b) < day(a)
c.eq('monthsBetween(31 Jan 2024, 30 Mar 2024)', () => monthsBetween(Date.UTC(2024, 0, 31), Date.UTC(2024, 2, 30)), 1);
c.eq('monthsBetween(15 Jan 2020, 15 Jan 2024)', () => monthsBetween(Date.UTC(2020, 0, 15), Date.UTC(2024, 0, 15)), 48);
c.done();
