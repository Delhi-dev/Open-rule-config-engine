import { SchemaNode } from './types.js';

export function parseDocument(text: string, format: 'json' | 'xml', schemaRoot?: SchemaNode): unknown {
  if (format === 'json') {
    return JSON.parse(text);
  }
  throw new Error('XML support not implemented');
}

export function serializeDocument(data: unknown, format: 'json' | 'xml'): string {
  if (format === 'json') {
    return JSON.stringify(data, null, 2) + '\n';
  }
  throw new Error('XML support not implemented');
}

export function emptyValueFor(node: SchemaNode): unknown {
  switch (node.type) {
    case 'object':
      const obj: Record<string, unknown> = {};
      if (node.children) {
        for (const child of node.children) {
          obj[child.name] = emptyValueFor(child);
        }
      }
      return obj;
    case 'array':
      return [];
    case 'boolean':
      return false;
    case 'number':
    case 'integer':
      return null;
    case 'string':
    case 'date':
      return '';
    default:
      return '';
  }
}

export function emptyArrayItem(arrayNode: SchemaNode): unknown {
  const itemChild = arrayNode.children?.find(c => c.name === '[*]');
  if (itemChild) {
    return emptyValueFor(itemChild);
  } else {
    const obj: Record<string, unknown> = {};
    if (arrayNode.children) {
      for (const child of arrayNode.children) {
        if (child.name !== '[*]') {
          obj[child.name] = emptyValueFor(child);
        }
      }
    }
    return obj;
  }
}

export function emptyDocument(schemaRoot: SchemaNode): unknown {
  return emptyValueFor(schemaRoot);
}

export function isBlank(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (value === false) return true;
  if (typeof value === 'string' && value === '') return true;
  if (Array.isArray(value) && value.length === 0) return true;
  return false;
}

export function pruneBlanks(data: unknown): unknown {
  function isDropBlank(v: unknown): boolean {
    if (v === null || v === undefined) return true;
    if (typeof v === 'string' && v.trim() === '') return true;
    return false;
  }

  if (Array.isArray(data)) {
    return data.map(item => pruneBlanks(item));
  }
  if (typeof data === 'object' && data !== null) {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      const pruned = pruneBlanks(value);
      if (!isDropBlank(pruned)) {
        result[key] = pruned;
      }
    }
    return result;
  }
  if (typeof data === 'string' && data.trim() === '') {
    return undefined;
  }
  return data;
}

export function coerceValue(raw: unknown, node: SchemaNode): unknown {
  if (node.type === 'integer' || node.type === 'number') {
    if (typeof raw === 'string') {
      if (raw === '') return null;
      const num = Number(raw);
      if (!Number.isNaN(num) && Number.isFinite(num)) {
        return num;
      }
      return raw;
    }
    if (typeof raw === 'number') {
      return raw;
    }
    return raw;
  }
  if (node.type === 'boolean') {
    if (typeof raw === 'string') {
      if (raw === 'true' || raw === '1') return true;
      if (raw === 'false' || raw === '0') return false;
    }
    if (raw === true || raw === false) return raw;
    return false;
  }
  if (typeof raw === 'string') {
    return raw;
  }
  return String(raw);
}
