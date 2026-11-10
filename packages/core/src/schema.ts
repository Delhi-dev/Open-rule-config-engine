import { SchemaNode } from './types.js';

let globalDefinitions: any = {};

function resolveRef(schema: any, parent: any): any {
  if (schema && typeof schema === 'object' && schema.$ref) {
    const ref = schema.$ref;
    if ((ref.startsWith('#/definitions/') || ref.startsWith('#/$defs/')) && (parent?.definitions || globalDefinitions)) {
      const defs = parent?.definitions || globalDefinitions;
      const key = ref.split('/').pop();
      return defs[key] || {};
    }
  }
  return schema;
}

function makeNode(
  name: string,
  path: string,
  type: any,
  children?: SchemaNode[],
  required?: boolean,
  enumVal?: string[],
  description?: string
): SchemaNode {
  return { name, path, type, children, required, enum: enumVal, description };
}

function fromJsonSchema(schema: any, parent: any, name: string, path: string): SchemaNode {
  let current = resolveRef(schema, parent) || schema;
  if (!current) {
    return makeNode(name, path, 'unknown');
  }

  // Merge allOf if present
  if (Array.isArray(current.allOf)) {
    const merged: any = { ...current };
    for (const item of current.allOf) {
      const itemSchema = resolveRef(item, current) || item;
      Object.assign(merged, itemSchema);
    }
    current = merged;
  }

  // Determine type
  let type: string = 'unknown';
  if (current.type) {
    if (Array.isArray(current.type)) {
      type = current.type.find((t: any) => t !== 'null') || 'unknown';
    } else {
      type = current.type;
    }
  }
  if (type === 'string' && (current.format === 'date' || current.format === 'date-time')) {
    type = 'date';
  }
  if (type === 'unknown') {
    if (current.properties) type = 'object';
    else if (current.items) type = 'array';
    else if (Array.isArray(current.enum)) type = 'string';
  }

  const children: SchemaNode[] = [];
  const requiredProps = new Set<string>(current.required || []);

  // Process properties
  if (current.properties && typeof current.properties === 'object') {
    for (const propName in current.properties) {
      if (propName === '__proto__') continue;
      const propSchema = current.properties[propName];
      const childPath = path ? `${path}.${propName}` : propName;
      const childNode = fromJsonSchema(propSchema, current, propName, childPath);
      if (requiredProps.has(propName)) {
        (childNode as any).required = true;
      }
      children.push(childNode);
    }
  }

  // Process array items
  if (type === 'array' && current.items) {
    const itemPath = path ? `${path}[*]` : '[*]';
    const itemSchema = Array.isArray(current.items) ? current.items[0] : current.items;
    const itemNode = fromJsonSchema(itemSchema, current, '[*]', itemPath);
    // §8.1 step 5: an object item's fields become the array node's children; a primitive item is one '[*]' child
    if (itemNode.type === 'object') children.push(...(itemNode.children ?? []));
    else children.push({ ...itemNode, required: undefined });
  }

  // Handle oneOf/anyOf: take first variant
  if (Array.isArray(current.oneOf) && current.oneOf.length) {
    current = current.oneOf[0];
  } else if (Array.isArray(current.anyOf) && current.anyOf.length) {
    current = current.anyOf[0];
  }

  const enumVal = Array.isArray(current.enum) ? current.enum.map((e: any) => String(e)) : undefined;

  return makeNode(name, path, type, children.length ? children : undefined, !!requiredProps.has(name), enumVal, current.description);
}

function fromJsonSample(sample: any, parent: any, name: string, path: string): SchemaNode {
  let type: string;

  if (sample === null) {
    type = 'unknown';
  } else if (Array.isArray(sample)) {
    type = 'array';
  } else if (typeof sample === 'object') {
    type = 'object';
  } else if (typeof sample === 'string') {
    if (/^\d{4}-\d{2}-\d{2}$/.test(sample)) {
      type = 'date';
    } else {
      type = 'string';
    }
  } else if (typeof sample === 'number') {
    if (Number.isInteger(sample)) {
      type = 'integer';
    } else {
      type = 'number';
    }
  } else if (typeof sample === 'boolean') {
    type = 'boolean';
  } else {
    type = 'unknown';
  }

  const children: SchemaNode[] = [];

  if (type === 'object' && typeof sample === 'object' && sample !== null) {
    // Collect all keys from all elements if array of objects
    const keys = new Set<string>();
    if (Array.isArray(sample)) {
      for (const item of sample) {
        if (typeof item === 'object' && item !== null) {
          Object.keys(item).forEach(k => keys.add(k));
        }
      }
    } else {
      Object.keys(sample).forEach(k => keys.add(k));
    }

    for (const key of keys) {
      let value: any = undefined;
      if (Array.isArray(sample)) {
        for (const item of sample) {
          if (typeof item === 'object' && item !== null && key in item) {
            value = item[key];
            break;
          }
        }
      } else {
        value = (sample as any)[key];
      }
      const childPath = path ? `${path}.${key}` : key;
      const childNode = fromJsonSample(value, null, key, childPath);
      children.push(childNode);
    }
  } else if (type === 'array' && Array.isArray(sample)) {
    if (sample.length > 0) {
      if (typeof sample[0] === 'object' && sample[0] !== null) {
        // Merge keys from all elements
        const allKeys = new Set<string>();
        for (const item of sample) {
          if (typeof item === 'object' && item !== null) {
            Object.keys(item).forEach(k => allKeys.add(k));
          }
        }
        for (const key of allKeys) {
          let value: any = undefined;
          for (const item of sample) {
            if (typeof item === 'object' && item !== null && key in item) {
              value = item[key];
              break;
            }
          }
          const childPath = path ? `${path}[*].${key}` : `[*].${key}`;
          const childNode = fromJsonSample(value, null, key, childPath);
          children.push(childNode);
        }
      } else {
        const itemPath = path ? `${path}[*]` : '[*]';
        const itemNode = fromJsonSample(sample[0], null, '[*]', itemPath);
        children.push(itemNode);
      }
    }
  }

  return makeNode(name, path, type, children.length ? children : undefined, false, undefined, undefined);
}

export function looksLikeJsonSchema(obj: any): boolean {
  if (obj && typeof obj === 'object') {
    if (obj.$schema !== undefined) return true;
    if (obj.type !== undefined && (obj.properties !== undefined || obj.items !== undefined)) return true;
  }
  return false;
}

export function buildSchemaFromText(text: string, fileName: string) {
  const format = formatOfFile(fileName, text);
  if (format === 'xml') {
    throw new Error('XML support not implemented');
  }
  const sourceText = text;
  let schemaObj: any;
  try {
    schemaObj = JSON.parse(text);
  } catch (e) {
    throw new Error('Invalid JSON');
  }

  // Capture definitions for ref resolution
  globalDefinitions = schemaObj.definitions || {};

  let root: SchemaNode;
  if (looksLikeJsonSchema(schemaObj)) {
    root = fromJsonSchema(schemaObj, schemaObj, '$', '');
  } else {
    root = fromJsonSample(schemaObj, null, '$', '');
  }

  return {
    format: 'json',
    source: looksLikeJsonSchema(schemaObj) ? 'json-schema' : 'json-sample',
    sourceText,
    root,
  };
}

export function schemaFromJsonSample(text: string) {
  return buildSchemaFromText(text, 'sample.json');
}

export function schemaFromJsonSchema(text: string) {
  return buildSchemaFromText(text, 'schema.json');
}

export function flattenSchema(root: SchemaNode): SchemaNode[] {
  const result: SchemaNode[] = [];
  const dfs = (node: SchemaNode) => {
    if (node.path) {
      result.push(node);
    }
    if (node.children && node.children.length) {
      node.children.forEach(dfs);
    }
  };
  dfs(root);
  return result;
}

export function findSchemaNode(root: SchemaNode, path: string): SchemaNode | undefined {
  const dfs = (node: SchemaNode): SchemaNode | undefined => {
    if (node.path === path) return node;
    if (node.children && node.children.length) {
      for (const child of node.children) {
        const found = dfs(child);
        if (found) return found;
      }
    }
    return undefined;
  };
  return dfs(root);
}

export function arrayPathsOf(root: SchemaNode): Set<string> {
  const paths = new Set<string>();
  const dfs = (node: SchemaNode) => {
    if (node.type === 'array' && node.path) {
      paths.add(node.path);
    }
    if (node.children && node.children.length) {
      node.children.forEach(dfs);
    }
  };
  dfs(root);
  return paths;
}

export function formatOfFile(fileName: string, text: string): 'json' | 'xml' {
  if (fileName.endsWith('.xml') || fileName.endsWith('.xsd') || text.startsWith('<')) {
    return 'xml';
  }
  return 'json';
}

export function makeXmlParser() {
  throw new Error('XML support not implemented');
}

export function schemaFromXmlSample(text: string, fileName: string) {
  throw new Error('XML support not implemented');
}

export function schemaFromXsd(text: string, fileName: string) {
  throw new Error('XML support not implemented');
}
