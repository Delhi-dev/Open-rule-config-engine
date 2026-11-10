import type { Computation } from './types.js';
import {
  resolvePath,
  setAtPath,
  toTemplatePath,
  parsePath,
  formatPath,
} from './path.js';
import {
  evaluateExpression,
  evaluateBoolean,
  expressionPaths,
  checkExpression,
} from './expression.js';

export interface ComputeResult {
  data: unknown;
  computed: Map<string, string>;
  changed: string[];
  errors: { id: string; message: string }[];
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function parentExists(data: unknown, path: string): boolean {
  const segs = parsePath(path);
  if (segs.length <= 1) {
    // root: parent is the data itself
    return isPlainObject(data) || data === null || typeof data === 'object';
  }
  const parentSegs = segs.slice(0, -1);
  const parentPath = formatPath(parentSegs);
  const parentMatches = resolvePath(data, parentPath);
  if (parentMatches.length === 0) return false;
  const parentVal = parentMatches[0].value;
  return parentVal !== undefined && parentVal !== null && isPlainObject(parentVal);
}

function normalise(v: unknown): unknown {
  if (v === undefined || v === null) return 0;
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return 0;
    let n = Math.round(v * 100) / 100;
    if (n === 0 && v < 0) n = 0;
    return n;
  }
  return v;
}

function sameValue(a: unknown, b: unknown): boolean {
  const isBlank = (v: unknown) => v === undefined || v === null || (typeof v === 'number' && isNaN(v));
  if (isBlank(a) && isBlank(b)) return true;
  return a === b || JSON.stringify(a) === JSON.stringify(b);
}

export function orderComputations(computations: Computation[]) {
  const enabled = computations.filter((c) => c.enabled !== false);
  const map = new Map<string, Computation>();
  enabled.forEach((c) => map.set(c.id, c));
  const indegree = new Map<string, number>();
  const adj: Record<string, string[]> = {};
  enabled.forEach((c) => {
    indegree.set(c.id, 0);
    adj[c.id] = [];
  });

  enabled.forEach((c) => {
    const inputs = new Set<string>();
    const exprPaths = expressionPaths(c.expression);
    exprPaths.forEach((p) => inputs.add(toTemplatePath(p)));
    if (c.condition) {
      const condPaths = expressionPaths(c.condition);
      condPaths.forEach((p) => inputs.add(toTemplatePath(p)));
    }
    const product = toTemplatePath(c.target);

    enabled.forEach((b) => {
      if (b.id === c.id) return;
      const bInputs = new Set<string>();
      const bExprPaths = expressionPaths(b.expression);
      bExprPaths.forEach((p) => bInputs.add(toTemplatePath(p)));
      if (b.condition) {
        const bCondPaths = expressionPaths(b.condition);
        bCondPaths.forEach((p) => bInputs.add(toTemplatePath(p)));
      }
      const bProduct = toTemplatePath(b.target);
      if (inputs.has(bProduct)) {
        if (!adj[b.id]) adj[b.id] = [];
        adj[b.id].push(c.id);
        indegree.set(c.id, (indegree.get(c.id) || 0) + 1);
      }
    });
  });

  const queue: string[] = [];
  enabled.forEach((c) => {
    if (indegree.get(c.id) === 0) queue.push(c.id);
  });

  const sorted: Computation[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    const c = map.get(id)!;
    sorted.push(c);
    (adj[id] || []).forEach((depId) => {
      const deg = indegree.get(depId)! - 1;
      indegree.set(depId, deg);
      if (deg === 0) queue.push(depId);
    });
  }

  const cyclic: Computation[] = [];
  enabled.forEach((c) => {
    if (!sorted.some((x) => x.id === c.id)) {
      cyclic.push(c);
    }
  });

  return { order: [...sorted, ...cyclic], cyclic: cyclic.map((c) => c.id) };
}

export function computeDocument(input: unknown, computations: Computation[]): ComputeResult {
  const computed: Map<string, string> = new Map();
  const changed: Set<string> = new Set();
  const errors: { id: string; message: string }[] = [];

  if (!computations?.length) {
    return { data: input, computed, changed: [], errors };
  }

  const { order, cyclic } = orderComputations(computations);

  // Add cyclic errors
  for (const id of cyclic) {
    errors.push({ id, message: 'Circular dependency' });
  }

  let data = input;

  for (const c of order) {
    if (c.enabled === false) continue;

    const matches = resolvePath(data, c.target);

    if (matches.length === 0) {
      // No matches, check parent exists
      if (!parentExists(data, c.target)) {
        continue;
      }
      // Evaluate condition if present (root, no bindings)
      let conditionOk = true;
      if (c.condition !== undefined) {
        try {
          const condVal = evaluateBoolean(c.condition, data);
          if (!condVal) {
            continue;
          }
        } catch (e) {
          errors.push({ id: c.id, message: `Condition evaluation failed: ${(e as Error).message}` });
          continue;
        }
      }
      try {
        const exprVal = evaluateExpression(c.expression, data);
        const normalized = normalise(exprVal);
        const currentVal = resolvePath(data, c.target)[0]?.value;
        computed.set(c.target, c.id);
        if (!sameValue(currentVal, normalized)) {
          data = setAtPath(data, c.target, normalized);
          changed.add(c.target);
        }
      } catch (e) {
        errors.push({ id: c.id, message: `Expression evaluation failed: ${(e as Error).message}` });
      }
      continue;
    }

    // There are matches
    for (const match of matches) {
      // Parent guard
      if (!parentExists(data, match.path)) {
        continue;
      }
      // Condition check with bindings
      let conditionOk = true;
      if (c.condition !== undefined) {
        try {
          const condVal = evaluateBoolean(c.condition, data, match.bindings);
          if (!condVal) {
            continue;
          }
        } catch (e) {
          errors.push({ id: c.id, message: `Condition evaluation failed: ${(e as Error).message}` });
          continue;
        }
      }
      try {
        const exprVal = evaluateExpression(c.expression, data, match.bindings);
        const normalized = normalise(exprVal);
        const currentVal = resolvePath(data, match.path)[0]?.value;
        computed.set(match.path, c.id);
        if (!sameValue(currentVal, normalized)) {
          data = setAtPath(data, match.path, normalized);
          changed.add(match.path);
        }
      } catch (e) {
        errors.push({ id: c.id, message: `Expression evaluation failed: ${(e as Error).message}` });
      }
    }
  }

  return { data, computed, changed: [...changed], errors };
}

export function computedTemplatePaths(computations: Computation[]): Set<string> {
  const set = new Set<string>();
  computations.forEach((c) => {
    if (c.enabled !== false) {
      set.add(toTemplatePath(c.target));
    }
  });
  return set;
}

export function underAnyPath(path: string, prefixes?: string[]): boolean {
  if (!prefixes || prefixes.length === 0) return false;
  const templatePath = toTemplatePath(path);
  return prefixes.some((p) => {
    const tp = toTemplatePath(p);
    if (tp === templatePath) return true;
    if (templatePath.startsWith(tp + '.') || templatePath.startsWith(tp + '[')) return true;
    return false;
  });
}

export function validateComputationDefinition(c: Computation): string[] {
  const errors: string[] = [];
  if (!c.id) errors.push('Missing id');
  if (!c.target) errors.push('Missing target');
  if (!c.expression) errors.push('Missing expression');
  else {
    try {
      checkExpression(c.expression);
    } catch (e) {
      errors.push(`Invalid expression: ${e}`);
    }
  }
  if (c.condition) {
    try {
      checkExpression(c.condition);
    } catch (e) {
      errors.push(`Invalid condition: ${e}`);
    }
  }
  return errors;
}
