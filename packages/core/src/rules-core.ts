// SUPPLIED BY THE REVIEWER (AD-8) — copied in by the harness like the tests; do not regenerate.
// The validation core of §8: operands (§8.1), conditions (§8.2), applyOperator (§8.3), checks (§8.4) and
// validateDocument / validateWithRuleSet (§8.5), plus describeOperand (used in check messages). rules.ts re-exports the public part and adds §8.6.
import {
  compareValues,
  isBlankValue as isBlank,
  evaluateBoolean,
  evaluateExpression,
  looseEquals,
} from './expression.js';
import { resolvePath, type Bindings, type PathMatch } from './path.js';
import type {
  Check,
  ComparisonOperator,
  Condition,
  ConditionLeaf,
  Operand,
  Rule,
  RuleSet,
  ValidationResult,
  Violation,
} from './types.js';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?)?$/;

// ---- value helpers ---------------------------------------------------------

function asNumber(v: unknown): number | undefined {
  if (typeof v === 'number') return Number.isNaN(v) ? undefined : v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) return Number(v);
  return undefined;
}

function asDate(v: unknown): number | undefined {
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'string' && ISO_DATE.test(v)) {
    const t = Date.parse(v);
    return Number.isNaN(t) ? undefined : t;
  }
  return undefined;
}

export function applyOperator(op: ComparisonOperator, a: unknown, b: unknown, tolerance = 0): boolean {
  if (tolerance > 0 && (op === '==' || op === '!=')) {
    const na = asNumber(a);
    const nb = asNumber(b);
    if (na !== undefined && nb !== undefined) {
      const eq = Math.abs(na - nb) <= tolerance;
      return op === '==' ? eq : !eq;
    }
  }
  switch (op) {
    case '==':
      return looseEquals(a, b);
    case '!=':
      return !looseEquals(a, b);
    default: {
      const c = compareValues(a, b);
      if (c === null) return false;
      switch (op) {
        case '<':
          return c < 0;
        case '<=':
          return c <= 0;
        case '>':
          return c > 0;
        case '>=':
          return c >= 0;
      }
    }
  }
  return false;
}

function listOf(v: unknown): unknown[] {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') {
    const t = v.trim();
    if (t.startsWith('[')) {
      try {
        const arr = JSON.parse(t);
        if (Array.isArray(arr)) return arr;
      } catch {
        /* fall through */
      }
    }
    return t.split(',').map((s) => s.trim()).filter((s) => s !== '');
  }
  return [v];
}

// ---- operands & conditions -------------------------------------------------

export function resolveOperand(data: unknown, operand: Operand, bindings: Bindings): unknown {
  switch (operand.type) {
    case 'literal':
      return operand.value;
    case 'path': {
      const m = resolvePath(data, operand.path, bindings);
      if (m.length <= 1) return m[0]?.exists ? m[0].value : undefined;
      return m.filter((x) => x.exists).map((x) => x.value);
    }
    case 'expression':
      return evaluateExpression(operand.expression, data, bindings);
    case 'aggregate': {
      const values = resolvePath(data, operand.path, bindings)
        .filter((m) => m.exists)
        .map((m) => m.value);
      if (operand.fn === 'count') return values.filter((v) => !isBlank(v)).length;
      const nums = values.map(asNumber).filter((n): n is number => n !== undefined);
      if (nums.length === 0) return operand.fn === 'sum' ? 0 : undefined;
      switch (operand.fn) {
        case 'sum':
          return nums.reduce((a, b) => a + b, 0);
        case 'min':
          return Math.min(...nums);
        case 'max':
          return Math.max(...nums);
        case 'avg':
          return nums.reduce((a, b) => a + b, 0) / nums.length;
      }
    }
  }
}

function evalLeaf(data: unknown, leaf: ConditionLeaf, bindings: Bindings): boolean {
  const matches = resolvePath(data, leaf.path, bindings);
  // With wildcards still unbound the leaf is true if ANY match satisfies it.
  const check = (value: unknown, exists: boolean): boolean => {
    switch (leaf.operator) {
      case 'exists':
        return exists && !isBlank(value);
      case 'notExists':
        return !exists || isBlank(value);
      case 'isEmpty':
        return isBlank(value);
      case 'isNotEmpty':
        return !isBlank(value);
      case 'in': {
        const rhs = leaf.rhs ? resolveOperand(data, leaf.rhs, bindings) : [];
        return listOf(rhs).some((x) => looseEquals(x, value));
      }
      case 'notIn': {
        const rhs = leaf.rhs ? resolveOperand(data, leaf.rhs, bindings) : [];
        return !listOf(rhs).some((x) => looseEquals(x, value));
      }
      case 'matches': {
        const rhs = leaf.rhs ? resolveOperand(data, leaf.rhs, bindings) : '';
        try {
          return new RegExp(String(rhs)).test(String(value ?? ''));
        } catch {
          return false;
        }
      }
      default: {
        const rhs = leaf.rhs ? resolveOperand(data, leaf.rhs, bindings) : undefined;
        if (leaf.operator === '==' || leaf.operator === '!=') return applyOperator(leaf.operator, value, rhs);
        if (value === undefined) return false;
        return applyOperator(leaf.operator, value, rhs);
      }
    }
  };
  if (matches.length === 0) return check(undefined, false);
  return matches.some((m) => check(m.value, m.exists));
}

export function evaluateCondition(data: unknown, cond: Condition, bindings: Bindings): boolean {
  if ('all' in cond) return cond.all.every((c) => evaluateCondition(data, c, bindings));
  if ('any' in cond) return cond.any.some((c) => evaluateCondition(data, c, bindings));
  if ('not' in cond) return !evaluateCondition(data, cond.not, bindings);
  if ('expression' in cond) return evaluateBoolean((cond as { expression: string }).expression, data, bindings);
  return evalLeaf(data, cond, bindings);
}

// ---- checks ----------------------------------------------------------------

interface CheckResult {
  ok: boolean;
  /** Default message when the rule has none. */
  message?: string;
}

function runCheck(data: unknown, check: Check, m: PathMatch, allMatches: PathMatch[]): CheckResult {
  const { value, exists, bindings } = m;

  switch (check.kind) {
    case 'required':
      return exists && !isBlank(value) ? { ok: true } : { ok: false, message: '{name} is required' };
    case 'empty':
      return !exists || isBlank(value) ? { ok: true } : { ok: false, message: '{name} must not be filled in this case' };
    case 'assert':
      return evaluateBoolean(check.expression, data, bindings)
        ? { ok: true }
        : { ok: false, message: `Condition not satisfied at {path}: ${check.expression}` };
    case 'unique': {
      if (!exists || isBlank(value)) return { ok: true };
      const peers = check.scope === 'parent' ? allMatches.filter((x) => sameParent(x.path, m.path)) : allMatches;
      const dupes = peers.filter((x) => x !== m && x.exists && !isBlank(x.value) && looseEquals(x.value, value));
      // Report only on the later duplicate so each duplicate pair yields one violation.
      const earlier = dupes.some((x) => allMatches.indexOf(x) < allMatches.indexOf(m));
      return earlier ? { ok: false, message: '{name} "{value}" is entered more than once' } : { ok: true };
    }
  }

  // Remaining checks are skipped on blank values; combine with `required` to force presence.
  const blank = !exists || isBlank(value);
  if (blank && !(check.kind === 'compare' && check.blankAsZero)) return { ok: true };
  const v = blank ? 0 : value;

  switch (check.kind) {
    case 'type': {
      let ok: boolean;
      switch (check.type) {
        case 'string':
          ok = typeof v === 'string';
          break;
        case 'number':
          ok = asNumber(v) !== undefined && typeof v !== 'boolean';
          break;
        case 'integer': {
          const n = asNumber(v);
          ok = n !== undefined && Number.isInteger(n) && typeof v !== 'boolean';
          break;
        }
        case 'boolean':
          ok = typeof v === 'boolean' || v === 'true' || v === 'false';
          break;
        case 'date':
          ok = asDate(v) !== undefined;
          break;
      }
      return ok ? { ok } : { ok, message: `{name} must be a ${check.type} (got "{value}")` };
    }
    case 'min': {
      if (asNumber(v) === undefined && asDate(v) === undefined) return { ok: false, message: '{name} must be numeric to check minimum' };
      return (compareValues(v, check.value) ?? -1) >= 0
        ? { ok: true }
        : { ok: false, message: `{name} must be at least ${check.value} (got {value})` };
    }
    case 'max': {
      if (asNumber(v) === undefined && asDate(v) === undefined) return { ok: false, message: '{name} must be numeric to check maximum' };
      return (compareValues(v, check.value) ?? 1) <= 0
        ? { ok: true }
        : { ok: false, message: `{name} must be at most ${check.value} (got {value})` };
    }
    case 'minLength': {
      const len = Array.isArray(v) ? v.length : String(v).length;
      return len >= check.value
        ? { ok: true }
        : { ok: false, message: `{name} must have at least ${check.value} ${Array.isArray(v) ? 'items' : 'characters'} (has ${len})` };
    }
    case 'maxLength': {
      const len = Array.isArray(v) ? v.length : String(v).length;
      return len <= check.value
        ? { ok: true }
        : { ok: false, message: `{name} must have at most ${check.value} ${Array.isArray(v) ? 'items' : 'characters'} (has ${len})` };
    }
    case 'pattern': {
      let re: RegExp;
      try {
        re = new RegExp(check.regex, check.flags);
      } catch (e) {
        return { ok: false, message: `Invalid pattern in rule: ${(e as Error).message}` };
      }
      return re.test(String(v))
        ? { ok: true }
        : { ok: false, message: `{name} does not match pattern /${check.regex}/ (got "{value}")` };
    }
    case 'enum': {
      return check.values.some((x) => looseEquals(x, v))
        ? { ok: true }
        : { ok: false, message: `{name} must be one of [${check.values.join(', ')}] (got "{value}")` };
    }
    case 'compare': {
      let rhs = resolveOperand(data, check.rhs, bindings);
      // A blank formula/field compared with a numeric target counts as 0 (an absent schedule total is nil);
      // a blank literal/path compared with text means "nothing to compare against".
      if (rhs === undefined) {
        if (typeof v === 'number' && (check.rhs.type === 'expression' || check.rhs.type === 'aggregate')) rhs = 0;
        else return { ok: true };
      }
      return applyOperator(check.operator, v, rhs, check.tolerance)
        ? { ok: true }
        : {
            ok: false,
            message: `{name} must be ${check.operator} ${describeOperand(check.rhs)}${check.tolerance ? ` (±${check.tolerance})` : ''} (got {value}, expected ${formatValue(rhs)})`,
          };
    }
  }
  return { ok: true };
}

/** Same containing array/object: strip the last key and then the last index (`a.rows[3].pan` → `a.rows`). */
function sameParent(a: string, b: string): boolean {
  const parent = (p: string) => p.replace(/\.[^.\[\]]+$/, '').replace(/\[\d+\]$/, '');
  return parent(a) === parent(b);
}

function formatValue(v: unknown): string {
  if (v === undefined) return 'nothing';
  if (v === null) return 'null';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(2);
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

function fillTemplate(template: string, path: string, value: unknown): string {
  const name = path.split('.').pop() ?? path;
  return template
    .replace(/\{path\}/g, path)
    .replace(/\{name\}/g, name)
    .replace(/\{value\}/g, formatValue(value));
}

export function describeOperand(o: Operand): string {
  switch (o.type) {
    case 'literal':
      return typeof o.value === 'string' ? `"${o.value}"` : String(o.value);
    case 'path':
      return o.path;
    case 'aggregate':
      return `${o.fn}(${o.path})`;
    case 'expression':
      return o.expression;
  }
}

export function validateDocument(data: unknown, rules: Rule[]): ValidationResult {
  const violations: Violation[] = [];

  for (const rule of rules) {
    if (rule.enabled === false) continue;
    let matches: PathMatch[];
    try {
      matches = resolvePath(data, rule.target);
    } catch {
      continue;
    }
    for (const m of matches) {
      try {
        if (rule.condition && !evaluateCondition(data, rule.condition, m.bindings)) continue;
        const result = runCheck(data, rule.check, m, matches);
        if (result.ok) continue;
        violations.push({
          ruleId: rule.id,
          ruleName: rule.name,
          severity: rule.severity,
          path: m.path,
          message: fillTemplate(rule.message?.trim() || result.message || 'Rule violated', m.path, m.value),
          value: m.value,
        });
      } catch (e) {
        violations.push({
          ruleId: rule.id,
          ruleName: rule.name,
          severity: 'warning',
          path: m.path,
          message: `Rule could not be evaluated: ${(e as Error).message}`,
          value: m.value,
        });
      }
    }
  }

  const errors = violations.filter((v) => v.severity === 'error');
  const warnings = violations.filter((v) => v.severity === 'warning');
  return { valid: errors.length === 0, errors, warnings, violations };
}

export function validateWithRuleSet(data: unknown, ruleSet: RuleSet): ValidationResult {
  return validateDocument(data, ruleSet.rules);
}

// ---- human-readable descriptions (shared by UI) ---------------------------

