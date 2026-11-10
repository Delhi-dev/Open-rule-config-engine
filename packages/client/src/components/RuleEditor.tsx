import { useMemo, useState } from 'react';
import {
  checkExpression,
  describeRule,
  validateRuleDefinition,
  type Check,
  type Condition,
  type ConditionLeaf,
  type ConditionOperator,
  type Operand,
  type Rule,
  type SchemaNode,
} from '@rule-engine/core';

const CHECK_KINDS: { kind: Check['kind']; label: string }[] = [
  { kind: 'required', label: 'Required' },
  { kind: 'type', label: 'Type' },
  { kind: 'min', label: 'Minimum value' },
  { kind: 'max', label: 'Maximum value' },
  { kind: 'minLength', label: 'Min length / items' },
  { kind: 'maxLength', label: 'Max length / items' },
  { kind: 'pattern', label: 'Pattern (regex)' },
  { kind: 'enum', label: 'Allowed values' },
  { kind: 'compare', label: 'Compare with another field / value' },
  { kind: 'empty', label: 'Must be blank / not filled' },
  { kind: 'unique', label: 'No duplicates (repeated field)' },
  { kind: 'assert', label: 'Formula must be true (assertion)' },
];

const COND_OPS: ConditionOperator[] = ['==', '!=', '<', '<=', '>', '>=', 'exists', 'notExists', 'isEmpty', 'isNotEmpty', 'in', 'notIn', 'matches'];
const NO_RHS: ConditionOperator[] = ['exists', 'notExists', 'isEmpty', 'isNotEmpty'];

function defaultCheck(kind: Check['kind']): Check {
  switch (kind) {
    case 'required':
      return { kind };
    case 'type':
      return { kind, type: 'string' };
    case 'min':
    case 'max':
    case 'minLength':
    case 'maxLength':
      return { kind, value: 0 };
    case 'pattern':
      return { kind, regex: '' };
    case 'enum':
      return { kind, values: [] };
    case 'compare':
      return { kind, operator: '==', rhs: { type: 'path', path: '' } };
    case 'empty':
      return { kind };
    case 'unique':
      return { kind };
    case 'assert':
      return { kind, expression: '' };
  }
}

function literalFromText(text: string): Operand {
  const t = text.trim();
  if (t === 'true') return { type: 'literal', value: true };
  if (t === 'false') return { type: 'literal', value: false };
  if (t === 'null') return { type: 'literal', value: null };
  if (t !== '' && !Number.isNaN(Number(t))) return { type: 'literal', value: Number(t) };
  return { type: 'literal', value: text };
}

function ExpressionStatus({ expression }: { expression: string }) {
  if (!expression.trim()) return null;
  try {
    checkExpression(expression);
    return <span className="small" style={{ color: 'var(--ok)' }}>✓ formula parses</span>;
  } catch (e) {
    return <span className="small" style={{ color: 'var(--error)' }}>{(e as Error).message}</span>;
  }
}

/** Choose a sensible path list: an aggregate makes sense only over repeated fields. */
function PathSelect({ value, onChange, paths, placeholder }: { value: string; onChange: (v: string) => void; paths: string[]; placeholder?: string }) {
  const known = paths.includes(value);
  return (
    <div className="row" style={{ gap: 4 }}>
      <select value={known ? value : '__custom'} onChange={(e) => onChange(e.target.value === '__custom' ? value : e.target.value)} className="grow">
        <option value="__custom">(type a path…)</option>
        {paths.map((p) => (
          <option key={p} value={p}>
            {p}
          </option>
        ))}
      </select>
      {!known && <input className="grow mono" placeholder={placeholder ?? 'a.b[*].c'} value={value} onChange={(e) => onChange(e.target.value)} />}
    </div>
  );
}

function OperandEditor({ value, onChange, paths }: { value: Operand; onChange: (o: Operand) => void; paths: string[] }) {
  const [literalText, setLiteralText] = useState(value.type === 'literal' ? String(value.value ?? '') : '');
  return (
    <div className="stack">
      <select
        value={value.type}
        onChange={(e) => {
          const t = e.target.value as Operand['type'];
          if (t === 'literal') onChange(literalFromText(literalText));
          else if (t === 'path') onChange({ type: 'path', path: '' });
          else if (t === 'expression') onChange({ type: 'expression', expression: '' });
          else onChange({ type: 'aggregate', fn: 'sum', path: '' });
        }}
      >
        <option value="literal">Constant value</option>
        <option value="path">Another field</option>
        <option value="aggregate">Aggregate of a repeated field</option>
        <option value="expression">Formula (arithmetic over fields)</option>
      </select>
      {value.type === 'expression' && (
        <div className="stack" style={{ gap: 4 }}>
          <input
            className="mono"
            placeholder="e.g. items[*].quantity * items[*].unitPrice   or   sum(lines[*].amount) * 1.18"
            value={value.expression}
            onChange={(e) => onChange({ type: 'expression', expression: e.target.value })}
            list="expr-paths"
          />
          <datalist id="expr-paths">
            {paths.map((p) => (
              <option key={p} value={p} />
            ))}
          </datalist>
          <ExpressionStatus expression={value.expression} />
          <span className="small muted">
            Operators + − × ÷ % and parentheses; functions sum/count/min/max/avg(path), abs, round(x, digits), floor, ceil. Use <code>[*]</code> in paths for
            per-item values.
          </span>
        </div>
      )}
      {value.type === 'literal' && (
        <input
          placeholder="value (numbers, true/false and null are detected)"
          value={literalText}
          onChange={(e) => {
            setLiteralText(e.target.value);
            onChange(literalFromText(e.target.value));
          }}
        />
      )}
      {value.type === 'path' && <PathSelect value={value.path} onChange={(path) => onChange({ type: 'path', path })} paths={paths} />}
      {value.type === 'aggregate' && (
        <div className="row">
          <select value={value.fn} onChange={(e) => onChange({ ...value, fn: e.target.value as typeof value.fn })}>
            {['sum', 'count', 'min', 'max', 'avg'].map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
          <div className="grow">
            <PathSelect value={value.path} onChange={(path) => onChange({ ...value, path })} paths={paths.filter((p) => p.includes('[*]'))} />
          </div>
        </div>
      )}
    </div>
  );
}

function CheckEditor({ check, onChange, paths, node }: { check: Check; onChange: (c: Check) => void; paths: string[]; node?: SchemaNode }) {
  const [enumText, setEnumText] = useState(check.kind === 'enum' ? check.values.join(', ') : '');
  return (
    <div className="stack">
      <select
        value={check.kind}
        onChange={(e) => {
          const k = e.target.value as Check['kind'];
          const next = defaultCheck(k);
          if (next.kind === 'enum' && node?.enum) {
            next.values = node.enum;
            setEnumText(node.enum.join(', '));
          }
          if (next.kind === 'type' && node && node.type !== 'object' && node.type !== 'array' && node.type !== 'unknown') next.type = node.type;
          onChange(next);
        }}
      >
        {CHECK_KINDS.map((k) => (
          <option key={k.kind} value={k.kind}>
            {k.label}
          </option>
        ))}
      </select>
      {check.kind === 'type' && (
        <select value={check.type} onChange={(e) => onChange({ ...check, type: e.target.value as typeof check.type })}>
          {['string', 'number', 'integer', 'boolean', 'date'].map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      )}
      {(check.kind === 'min' || check.kind === 'max' || check.kind === 'minLength' || check.kind === 'maxLength') && (
        <input
          type="number"
          value={Number.isFinite(check.value) ? check.value : ''}
          onChange={(e) => onChange({ ...check, value: Number(e.target.value) })}
          placeholder={check.kind === 'min' || check.kind === 'max' ? 'number or date comparison value' : 'count'}
        />
      )}
      {check.kind === 'pattern' && (
        <div className="row">
          <input className="grow mono" placeholder="^[A-Z]{3}-\d+$" value={check.regex} onChange={(e) => onChange({ ...check, regex: e.target.value })} />
          <input className="mono" style={{ width: 60 }} placeholder="flags" value={check.flags ?? ''} onChange={(e) => onChange({ ...check, flags: e.target.value || undefined })} />
        </div>
      )}
      {check.kind === 'enum' && (
        <input
          placeholder="comma-separated allowed values"
          value={enumText}
          onChange={(e) => {
            setEnumText(e.target.value);
            onChange({ ...check, values: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) });
          }}
        />
      )}
      {check.kind === 'unique' && (
        <select value={check.scope ?? 'document'} onChange={(e) => onChange({ ...check, scope: e.target.value === 'parent' ? 'parent' : undefined })}>
          <option value="document">across the whole document</option>
          <option value="parent">within the same list</option>
        </select>
      )}
      {check.kind === 'assert' && (
        <div className="stack" style={{ gap: 4 }}>
          <input className="mono" placeholder='e.g. countif(items[*].type, items[*].type == "G") <= 1' value={check.expression} onChange={(e) => onChange({ ...check, expression: e.target.value })} />
          <ExpressionStatus expression={check.expression} />
          <span className="small muted">Comparison (== != &lt; &gt;), logic (and, or, not), arithmetic, sum/count/sumif/countif/unique/exists/if/min/max/round, months_between. Evaluated once per match of the target.</span>
        </div>
      )}
      {check.kind === 'compare' && (
        <div className="row" style={{ alignItems: 'flex-start' }}>
          <label className="field" style={{ width: 90 }}>
            tolerance
            <input type="number" min={0} value={check.tolerance ?? ''} placeholder="0" onChange={(e) => onChange({ ...check, tolerance: e.target.value === '' ? undefined : Number(e.target.value) })} />
          </label>
          <label className="field" style={{ width: 110 }}>
            blank target
            <select value={check.blankAsZero ? 'zero' : 'skip'} onChange={(e) => onChange({ ...check, blankAsZero: e.target.value === 'zero' ? true : undefined })}>
              <option value="skip">skip check</option>
              <option value="zero">treat as 0</option>
            </select>
          </label>
          <select value={check.operator} onChange={(e) => onChange({ ...check, operator: e.target.value as typeof check.operator })}>
            {['==', '!=', '<', '<=', '>', '>='].map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
          <div className="grow">
            <OperandEditor value={check.rhs} onChange={(rhs) => onChange({ ...check, rhs })} paths={paths} />
          </div>
        </div>
      )}
    </div>
  );
}

function LeafEditor({ leaf, onChange, onRemove, paths }: { leaf: ConditionLeaf; onChange: (l: ConditionLeaf) => void; onRemove: () => void; paths: string[] }) {
  const needsRhs = !NO_RHS.includes(leaf.operator);
  const rhs = leaf.rhs ?? { type: 'literal', value: '' };
  const [text, setText] = useState(rhs.type === 'literal' ? String(rhs.value ?? '') : '');
  return (
    <div className="cond-leaf">
      <PathSelect value={leaf.path} onChange={(path) => onChange({ ...leaf, path })} paths={paths} />
      <select value={leaf.operator} onChange={(e) => onChange({ ...leaf, operator: e.target.value as ConditionOperator })}>
        {COND_OPS.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
      {needsRhs ? (
        <select
          value={rhs.type === 'path' ? 'path' : 'literal'}
          onChange={(e) =>
            onChange({ ...leaf, rhs: e.target.value === 'path' ? { type: 'path', path: '' } : literalFromText(text) })
          }
        >
          <option value="literal">value</option>
          <option value="path">field</option>
        </select>
      ) : (
        <span />
      )}
      {needsRhs ? (
        rhs.type === 'path' ? (
          <PathSelect value={rhs.path} onChange={(path) => onChange({ ...leaf, rhs: { type: 'path', path } })} paths={paths} />
        ) : (
          <input
            placeholder={leaf.operator === 'in' || leaf.operator === 'notIn' ? 'a, b, c' : leaf.operator === 'matches' ? 'regex' : 'value'}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              onChange({ ...leaf, rhs: leaf.operator === 'in' || leaf.operator === 'notIn' || leaf.operator === 'matches' ? { type: 'literal', value: e.target.value } : literalFromText(e.target.value) });
            }}
          />
        )
      ) : (
        <span />
      )}
      <button className="ghost danger" onClick={onRemove} title="Remove condition">
        ✕
      </button>
    </div>
  );
}

/** One level of AND/OR over leaf conditions (the engine supports arbitrary nesting; the editor keeps it simple). */
function ConditionEditor({ condition, onChange, paths }: { condition: Condition | undefined; onChange: (c: Condition | undefined) => void; paths: string[] }) {
  const mode: 'all' | 'any' = condition && 'any' in condition ? 'any' : 'all';
  const leaves: ConditionLeaf[] = !condition ? [] : 'all' in condition ? (condition.all as ConditionLeaf[]) : 'any' in condition ? (condition.any as ConditionLeaf[]) : [condition as ConditionLeaf];
  const emit = (m: 'all' | 'any', ls: ConditionLeaf[]) => onChange(ls.length === 0 ? undefined : m === 'all' ? { all: ls } : { any: ls });
  return (
    <div className="stack">
      <div className="row">
        <span className="small muted">Only apply this rule when</span>
        <select value={mode} onChange={(e) => emit(e.target.value as 'all' | 'any', leaves)} disabled={leaves.length < 2}>
          <option value="all">ALL of these hold</option>
          <option value="any">ANY of these holds</option>
        </select>
        <button onClick={() => emit(mode, [...leaves, { path: '', operator: '==', rhs: { type: 'literal', value: '' } }])}>+ Condition</button>
        {leaves.length === 0 && <span className="small muted">(no condition — always applies)</span>}
      </div>
      {leaves.length > 0 && (
        <div className="cond-group">
          {leaves.map((leaf, i) => (
            <LeafEditor
              key={i}
              leaf={leaf}
              paths={paths}
              onChange={(l) => emit(mode, leaves.map((x, j) => (j === i ? l : x)))}
              onRemove={() => emit(mode, leaves.filter((_, j) => j !== i))}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function RuleEditor({
  rule,
  nodes,
  onSave,
  onCancel,
}: {
  rule: Rule;
  nodes: SchemaNode[];
  onSave: (r: Rule) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<Rule>(rule);
  const paths = useMemo(() => nodes.map((n) => (n.type === 'array' ? n.path : n.path)), [nodes]);
  const targetNode = nodes.find((n) => n.path === draft.target);
  const problems = validateRuleDefinition(draft);
  const set = <K extends keyof Rule>(k: K, v: Rule[K]) => setDraft((d) => ({ ...d, [k]: v }));

  return (
    <div className="rule-editor">
      <div className="grid2">
        <label className="field">
          Rule name
          <input value={draft.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. PAN required for Indian orders" />
        </label>
        <label className="field">
          Severity
          <select value={draft.severity} onChange={(e) => set('severity', e.target.value as Rule['severity'])}>
            <option value="error">Error — blocks saving</option>
            <option value="warning">Warning — shown but allowed</option>
          </select>
        </label>
      </div>
      <label className="field">
        Target field {targetNode && <span className="muted">({targetNode.type}{targetNode.enum ? `, allowed: ${targetNode.enum.join('|')}` : ''})</span>}
        <PathSelect value={draft.target} onChange={(t) => set('target', t)} paths={paths} />
      </label>
      <label className="field">
        Check
        <CheckEditor check={draft.check} onChange={(c) => set('check', c)} paths={paths} node={targetNode} />
      </label>
      <ConditionEditor condition={draft.condition} onChange={(c) => set('condition', c)} paths={paths} />
      <label className="field">
        Custom message (optional — placeholders: {'{name}'} {'{path}'} {'{value}'})
        <input value={draft.message ?? ''} onChange={(e) => set('message', e.target.value || undefined)} placeholder="leave blank for the default message" />
      </label>
      <div className="small mono muted">Preview: {describeRule(draft)}</div>
      {problems.length > 0 && <div className="alert error">{problems.join(' · ')}</div>}
      <div className="row">
        <button className="primary" disabled={problems.length > 0} onClick={() => onSave(draft)}>
          Done
        </button>
        <button onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
