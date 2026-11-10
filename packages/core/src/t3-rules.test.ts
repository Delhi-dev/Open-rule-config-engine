// T3 — checks, conditions, validateDocument (M3). Copy verbatim to packages/core/src/t3-rules.test.ts
import { describe, expect, it } from 'vitest';
import { validateDocument, validateRuleDefinition, describeRule, type Rule } from './index.js';

const r = (partial: Partial<Rule> & Pick<Rule, 'id' | 'target' | 'check'>): Rule => ({
  name: partial.id,
  severity: 'error',
  ...partial,
});

const doc = {
  form: {
    regime: 'Y',
    pan: 'ABCPR1234F',
    total: 175,
    rows: [
      { amt: 100, type: 'CG', pan: 'AAAPA1111A' },
      { amt: 50, type: 'OS', pan: 'AAAPA2222B' },
      { amt: 25, type: 'CG', pan: 'AAAPA1111A' },
    ],
    other: [{ pan: 'AAAPA1111A' }],
    emptyStr: '',
    dob: '1985-06-15',
  },
};

describe('T3 validation', () => {
  it('required fires on blank (empty string too) with {name} templating; concrete paths on wildcards', () => {
    const res = validateDocument(doc, [
      r({ id: 'R1', target: 'form.emptyStr', check: { kind: 'required' } }),
      r({ id: 'R2', target: 'form.missing', check: { kind: 'required' } }),
      r({ id: 'R3', target: 'form.rows[*].amt', check: { kind: 'required' } }),
    ]);
    expect(res.errors.map((v) => v.ruleId)).toEqual(['R1', 'R2']);
    expect(res.errors[0].message).toBe('emptyStr is required');
    expect(res.valid).toBe(false);
  });

  it('non-required checks skip blank targets; blankAsZero forces the comparison', () => {
    const rules = [
      r({ id: 'C1', target: 'form.missing', check: { kind: 'compare', operator: '==', rhs: { type: 'literal', value: 7 } } }),
      r({ id: 'C2', target: 'form.missing', check: { kind: 'compare', operator: '==', rhs: { type: 'expression', expression: 'form.total' }, blankAsZero: true } }),
      r({ id: 'C3', target: 'form.missing', check: { kind: 'min', value: 1 } }),
    ];
    const res = validateDocument(doc, rules);
    expect(res.errors.map((v) => v.ruleId)).toEqual(['C2']); // blank==7 skipped; blankAsZero 0 != 175 fires; min skipped
  });

  it('compare: expression rhs, tolerance, and blank-expression-as-0 for numeric targets', () => {
    const res = validateDocument(doc, [
      r({ id: 'E1', target: 'form.total', check: { kind: 'compare', operator: '==', rhs: { type: 'expression', expression: 'sum(form.rows[*].amt)' } } }),
      r({ id: 'E2', target: 'form.total', check: { kind: 'compare', operator: '==', rhs: { type: 'expression', expression: 'sum(form.rows[*].amt) + 8' }, tolerance: 10 } }),
      r({ id: 'E3', target: 'form.total', check: { kind: 'compare', operator: '<=', rhs: { type: 'expression', expression: 'min(form.nothing[*].x)' } } }),
    ]);
    // E3: blank expression rhs against a numeric target counts as 0 → 175 <= 0 fails
    expect(res.errors.map((v) => v.ruleId)).toEqual(['E3']);
  });

  it('type / pattern / enum / maxLength', () => {
    const res = validateDocument(doc, [
      r({ id: 'T1', target: 'form.dob', check: { kind: 'type', type: 'date' } }),
      r({ id: 'T2', target: 'form.pan', check: { kind: 'pattern', regex: '^[A-Z]{5}[0-9]{4}[A-Z]$' } }),
      r({ id: 'T3', target: 'form.pan', check: { kind: 'pattern', regex: '^[A-Z]{5}[0-9]{5}[A-Z]$' } }),
      r({ id: 'T4', target: 'form.regime', check: { kind: 'enum', values: ['Y', 'N'] } }),
      r({ id: 'T5', target: 'form.pan', check: { kind: 'maxLength', value: 5 } }),
    ]);
    expect(res.errors.map((v) => v.ruleId)).toEqual(['T3', 'T5']);
  });

  it('unique: document scope catches cross-table duplicates, parent scope does not', () => {
    const dup = [
      r({ id: 'U1', target: 'form.rows[*].pan', check: { kind: 'unique' } }),
      r({ id: 'U2', target: 'form.rows[*].type', check: { kind: 'unique', scope: 'parent' } }),
    ];
    const res = validateDocument(doc, dup);
    // U1 fires once, on the LATER duplicate (rows[2].pan); U2 fires on rows[2].type (CG repeats within the same parent)
    expect(res.errors.map((v) => `${v.ruleId}@${v.path}`)).toEqual(['U1@form.rows[2].pan', 'U2@form.rows[2].type']);
  });

  it('assert runs once per target match with that row bound', () => {
    const res = validateDocument(doc, [
      r({ id: 'A1', target: 'form.rows[*].amt', check: { kind: 'assert', expression: 'form.rows[*].amt >= 50 or form.rows[*].type == "CG"' } }),
    ]);
    expect(res.errors).toEqual([]);
  });

  it('conditions gate the check: leaf with in-list, expression, not', () => {
    const rules = [
      r({ id: 'G1', target: 'form.total', check: { kind: 'max', value: 0 }, condition: { path: 'form.regime', operator: 'in', rhs: { type: 'literal', value: 'N,X' } } }),
      r({ id: 'G2', target: 'form.total', check: { kind: 'max', value: 0 }, condition: { expression: 'form.regime == "Y" and form.total > 100' } }),
      r({ id: 'G3', target: 'form.total', check: { kind: 'max', value: 0 }, condition: { not: { path: 'form.regime', operator: '==', rhs: { type: 'literal', value: 'Y' } } } }),
    ];
    const res = validateDocument(doc, rules);
    expect(res.errors.map((v) => v.ruleId)).toEqual(['G2']); // only G2's condition holds
  });

  it('warnings do not block validity; disabled rules are skipped; eval errors become warnings', () => {
    const res = validateDocument(doc, [
      r({ id: 'W1', target: 'form.total', check: { kind: 'max', value: 1 }, severity: 'warning' }),
      r({ id: 'D1', target: 'form.total', check: { kind: 'max', value: 1 }, enabled: false }),
      r({ id: 'X1', target: 'form.total', check: { kind: 'assert', expression: 'nosuchfn(1)' } }),
    ]);
    expect(res.valid).toBe(true);
    expect(res.warnings.map((v) => v.ruleId).sort()).toEqual(['W1', 'X1']);
    expect(res.warnings.find((v) => v.ruleId === 'X1')!.message).toMatch(/could not be evaluated/);
  });

  it('custom message templating substitutes {path} {name} {value}', () => {
    const res = validateDocument(doc, [
      r({ id: 'M1', target: 'form.total', check: { kind: 'max', value: 1 }, message: '{name} at {path} is {value}' }),
    ]);
    expect(res.errors[0].message).toBe('total at form.total is 175');
  });

  it('validateRuleDefinition reports structural problems; describeRule renders English', () => {
    expect(validateRuleDefinition(r({ id: 'B1', target: 'form.total', check: { kind: 'compare', operator: '==', rhs: { type: 'expression', expression: 'sum(' } } })).length).toBeGreaterThan(0);
    expect(validateRuleDefinition(r({ id: 'B2', target: '', check: { kind: 'required' } })).length).toBeGreaterThan(0);
    expect(validateRuleDefinition(r({ id: 'B3', target: 'form.pan', check: { kind: 'pattern', regex: '(' } })).length).toBeGreaterThan(0);
    expect(typeof describeRule(r({ id: 'B4', target: 'form.total', check: { kind: 'required' } }))).toBe('string');
  });
});
