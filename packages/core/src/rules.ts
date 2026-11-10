import {
  resolveOperand,
  evaluateCondition,
  validateDocument,
  validateWithRuleSet,
  describeOperand,
} from './rules-core.js';

import { checkExpression } from './expression.js';
import { parsePath } from './path.js';
import type {
  Check,
  Condition,
  ConditionLeaf,
  Operand,
  Rule,
  RuleSet,
  Severity,
  ComparisonOperator,
  AggregateFn,
} from './types.js';

export {
  resolveOperand,
  evaluateCondition,
  validateDocument,
  validateWithRuleSet,
  describeOperand,
};

export function describeCheck(check: Check): string {
  switch (check.kind) {
    case 'required':
      return 'is required';
    case 'empty':
      return 'must not be filled in this case';
    case 'assert':
      return 'condition not satisfied';
    case 'unique':
      return 'is entered more than once';
    case 'type':
      return `must be a ${check.type}`;
    case 'min':
      return `must be at least ${check.value}`;
    case 'max':
      return `must be at most ${check.value}`;
    case 'minLength':
      return `must have at least ${check.value} ${Array.isArray(check.value) ? 'items' : 'characters'}`;
    case 'maxLength':
      return `must have at most ${check.value} ${Array.isArray(check.value) ? 'items' : 'characters'}`;
    case 'pattern':
      return `does not match pattern`;
    case 'enum':
      return `must be one of`;
    case 'compare':
      return `must be ${check.operator} ${describeOperand(check.rhs)}`;
    default:
      return '';
  }
}

export function describeCondition(cond: Condition): string {
  if ('all' in cond) {
    const parts = cond.all.map(describeCondition);
    return parts.length === 1 ? parts[0] : `(${parts.join(' and ')})`;
  }
  if ('any' in cond) {
    const parts = cond.any.map(describeCondition);
    return parts.length === 1 ? parts[0] : `(${parts.join(' or ')})`;
  }
  if ('not' in cond) {
    const inner = describeCondition(cond.not);
    return `not (${inner})`;
  }
  if ('expression' in cond) {
    return 'expression evaluates to true';
  }
  const leaf = cond as ConditionLeaf;
  switch (leaf.operator) {
    case 'exists':
      return 'exists';
    case 'notExists':
      return 'does not exist';
    case 'isEmpty':
      return 'is empty';
    case 'isNotEmpty':
      return 'is not empty';
    case 'in':
      return `is in ${describeOperand(leaf.rhs!)}`;
    case 'notIn':
      return `is not in ${describeOperand(leaf.rhs!)}`;
    case 'matches':
      return `matches ${describeOperand(leaf.rhs!)}`;
    default:
      if (leaf.rhs) {
        return `${leaf.path} ${leaf.operator} ${describeOperand(leaf.rhs)}`;
      }
      return `${leaf.path} ${leaf.operator}`;
  }
}

export function describeRule(rule: Rule): string {
  const checkDesc = describeCheck(rule.check);
  const conditionDesc = rule.condition ? ` when ${describeCondition(rule.condition)}` : '';
  return `${rule.name} ${checkDesc}${conditionDesc}`;
}

export function validateRuleDefinition(rule: Rule): string[] {
  const problems: string[] = [];

  // Rule basic fields
  if (!rule?.id || typeof rule.id !== 'string' || rule.id.trim() === '') {
    problems.push('Rule must have an id');
  }
  if (!rule?.name || typeof rule.name !== 'string' || rule.name.trim() === '') {
    problems.push('Rule must have a name');
  }
  if (!rule?.target || typeof rule.target !== 'string' || rule.target.trim() === '') {
    problems.push('Rule must have a target');
  } else {
    try {
      parsePath(rule.target);
    } catch {
      problems.push('Unparsable target');
    }
  }
  if (!rule?.check) {
    problems.push('Rule must have a check');
  } else {
    const check = rule.check;
    switch (check.kind) {
      case 'required':
      case 'empty':
        // no additional validation
        break;
      case 'assert':
        if (!check.expression) {
          problems.push('Assert check must have expression');
        } else {
          try {
            checkExpression(check.expression);
          } catch {
            problems.push('Invalid expression in assert');
          }
        }
        break;
      case 'type':
        const validTypes = ['string', 'number', 'integer', 'boolean', 'date'];
        if (!validTypes.includes(check.type)) {
          problems.push(`Invalid type '${check.type}'`);
        }
        break;
      case 'min':
      case 'max':
        if (typeof check.value !== 'number') {
          problems.push(`Min/Max value must be numeric, got ${typeof check.value}`);
        }
        break;
      case 'minLength':
      case 'maxLength':
        if (typeof check.value !== 'number') {
          problems.push(`MinLength/MaxLength value must be numeric, got ${typeof check.value}`);
        }
        break;
      case 'pattern':
        if (!check.regex) {
          problems.push('Pattern check must have regex');
        } else {
          try {
            new RegExp(check.regex, check.flags || '');
          } catch {
            problems.push('Invalid regex in pattern');
          }
        }
        break;
      case 'enum':
        if (!check.values || !Array.isArray(check.values) || check.values.length === 0) {
          problems.push('Enum check must have non-empty values');
        }
        break;
      case 'compare':
        if (!check.rhs) {
          problems.push('Compare check must have rhs');
        } else {
          if (check.rhs.type === 'expression') {
            if (!check.rhs.expression) {
              problems.push('Compare rhs expression missing');
            } else {
              try {
                checkExpression(check.rhs.expression);
              } catch {
                problems.push('Invalid expression in compare rhs');
              }
            }
          } else if (check.rhs.type === 'path') {
            try {
              parsePath(check.rhs.path);
            } catch {
              problems.push('Unparsable path in compare rhs');
            }
          }
        }
        break;
      default:
        // Other check kinds require no additional validation here
        break;
    }
  }

  // Validate condition recursively
  const validateCondition = (cond: Condition) => {
    if ('all' in cond || 'any' in cond) {
      const list = 'all' in cond ? cond.all : cond.any;
      list.forEach(validateCondition);
    } else if ('not' in cond) {
      validateCondition(cond.not);
    } else if ('expression' in cond) {
      try {
        checkExpression(cond.expression);
      } catch {
        problems.push('Invalid expression in condition');
      }
    } else {
      const leaf = cond as ConditionLeaf;
      try {
        // Check for empty path
        if (leaf.path.trim() === '') {
          problems.push('Empty path in condition');
        } else {
          parsePath(leaf.path);
        }
      } catch {
        problems.push('Unparsable path in condition');
      }
      if (leaf.rhs && leaf.rhs.type === 'expression') {
        try {
          checkExpression(leaf.rhs.expression);
        } catch {
          problems.push('Invalid expression in condition rhs');
        }
      }
    }
  };

  if (rule?.condition) {
    try {
      validateCondition(rule.condition);
    } catch (e) {
      problems.push(`Condition validation error: ${(e as Error).message}`);
    }
  }

  return problems;
}
