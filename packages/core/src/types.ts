export type DocFormat = 'json' | 'xml';
export type NodeType = 'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean' | 'date' | 'unknown';

export interface SchemaNode {
  name: string;            // object key / element name; '[*]' for a primitive array item
  path: string;            // absolute template path, '' at the virtual root
  type: NodeType;
  children?: SchemaNode[]; // object children, or the array item's children
  required?: boolean;      // declared required in the source schema
  enum?: string[];
  attribute?: boolean;     // XML attribute (name starts with '@_') — used by M9
  description?: string;
}

export interface SchemaDefinition {
  id: string; name: string; format: DocFormat;
  source: 'json-sample' | 'json-schema' | 'xml-sample' | 'xsd';
  sourceText: string;      // the uploaded text, kept verbatim
  root: SchemaNode;
  createdAt: string; updatedAt: string;   // ISO timestamps
}

export type Severity = 'error' | 'warning';
export type ComparisonOperator = '==' | '!=' | '<' | '<=' | '>' | '>=';
export type AggregateFn = 'sum' | 'count' | 'min' | 'max' | 'avg';

export type Operand =
  | { type: 'literal'; value: string | number | boolean | null }
  | { type: 'path'; path: string }
  | { type: 'aggregate'; fn: AggregateFn; path: string }
  | { type: 'expression'; expression: string };

export type Check =
  | { kind: 'required' }
  | { kind: 'type'; type: 'string' | 'number' | 'integer' | 'boolean' | 'date' }
  | { kind: 'min'; value: number }
  | { kind: 'max'; value: number }
  | { kind: 'minLength'; value: number }
  | { kind: 'maxLength'; value: number }
  | { kind: 'pattern'; regex: string; flags?: string }
  | { kind: 'enum'; values: string[] }
  | { kind: 'compare'; operator: ComparisonOperator; rhs: Operand; tolerance?: number; blankAsZero?: boolean }
  | { kind: 'empty' }
  | { kind: 'unique'; scope?: 'document' | 'parent' }
  | { kind: 'assert'; expression: string };

export type ConditionOperator = ComparisonOperator | 'exists' | 'notExists' | 'isEmpty' | 'isNotEmpty' | 'in' | 'notIn' | 'matches';
export interface ConditionLeaf { path: string; operator: ConditionOperator; rhs?: Operand }
export type Condition = ConditionLeaf | { all: Condition[] } | { any: Condition[] } | { not: Condition } | { expression: string };

export interface Rule {
  id: string; name: string;
  target: string;          // may contain [*]
  check: Check;
  condition?: Condition;
  severity: Severity;
  message?: string;        // supports {path} {name} {value} placeholders
  enabled?: boolean;       // false = skipped entirely
  ref?: string; notes?: string; group?: string;   // free text, never evaluated
}

export interface Computation {
  id: string; name: string;
  target: string;          // may contain [*] (computes the column of every row)
  expression: string;      // expression language of §7
  condition?: string;      // boolean expression; false ⇒ field stays as entered
  enabled?: boolean;
  ref?: string; notes?: string; group?: string;
}

export interface DisplaySettings { readOnly?: string[]; collapsed?: string[] }  // template paths; cover their whole subtree

export interface RuleSet {
  id: string; name: string; description?: string;
  schemaId: string;        // a rule set is bound to exactly one schema
  rules: Rule[];
  computations?: Computation[];
  display?: DisplaySettings;
  createdAt: string; updatedAt: string;
}

export interface Violation { ruleId: string; ruleName: string; severity: Severity; path: string; message: string; value?: unknown }
export interface ValidationResult { valid: boolean; errors: Violation[]; warnings: Violation[]; violations: Violation[] }

export interface StoredDocument {
  id: string; name: string; schemaId: string; ruleSetId?: string;
  format: DocFormat; data: unknown;
  createdAt: string; updatedAt: string;
}
