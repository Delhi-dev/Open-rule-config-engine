// Side-by-side view: every field of the document in two aligned columns —
// the original (read-only) and the editable copy — with violations shown on the
// editable side. Rows can be filtered to changed / failing / computed fields.
// Computed (system-calculated) fields are read-only on the editable side and show the formula on hover.
import { useEffect, useMemo, useState } from 'react';
import { coerceValue, emptyArrayItem, emptyValueFor, getAtPath, toTemplatePath, underAnyPath, type SchemaNode, type Violation } from '@rule-engine/core';
import type { ComputedIndex, ViolationIndex } from './DocumentForm';
import { ComputedValue } from './DocumentForm';

interface Props {
  root: SchemaNode;
  original: unknown;
  data: unknown;
  violations: ViolationIndex;
  onChange: (path: string, value: unknown) => void;
  onRemove: (path: string) => void;
  filter: 'all' | 'changed' | 'errors' | 'computed';
  computed?: ComputedIndex;
  /** Blocks/fields shown read-only (rule set display settings). */
  readOnly?: string[];
  /** Blocks collapsed when the document is opened (rule set display settings). */
  collapsedDefault?: string[];
}

type Row =
  | { kind: 'section'; path: string; label: string; depth: number; status?: 'error' | 'warning'; vs?: Violation[]; changed: boolean; arrayNode?: SchemaNode; count?: number; item?: boolean }
  | { kind: 'field'; path: string; label: string; depth: number; node: SchemaNode; orig: unknown; cur: unknown; changed: boolean; vs?: Violation[]; removable?: string; removed?: boolean; added?: boolean; parentPresent: boolean };

function childPath(parent: string, name: string) {
  return parent ? `${parent}.${name}` : name;
}
function same(a: unknown, b: unknown) {
  const na = a === undefined || a === null || a === '' ? '' : a;
  const nb = b === undefined || b === null || b === '' ? '' : b;
  return JSON.stringify(na) === JSON.stringify(nb);
}
function worst(vs: Violation[] | undefined): 'error' | 'warning' | undefined {
  if (!vs?.length) return undefined;
  return vs.some((v) => v.severity === 'error') ? 'error' : 'warning';
}
function fmt(v: unknown): string {
  if (v === undefined || v === null || v === '') return '—';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

/** Flatten schema + both documents into aligned rows. */
function buildRows(root: SchemaNode, original: unknown, data: unknown, violations: ViolationIndex): Row[] {
  const rows: Row[] = [];
  // Violations on paths deeper than the fields we render (e.g. on array items) are attached to the nearest row.
  const vAt = (p: string) => violations.get(p);

  // `present`: the block that holds the field exists in the document (a field the schema marks required is
  // only mandatory when its block is in use, e.g. Part B-ATI only in an updated return).
  const walkObject = (node: SchemaNode, path: string, orig: unknown, cur: unknown, depth: number, present: boolean) => {
    const o = (orig ?? {}) as Record<string, unknown>;
    const c = (cur ?? {}) as Record<string, unknown>;
    const here = present && typeof cur === 'object' && cur !== null;
    for (const child of node.children ?? []) walkNode(child, childPath(path, child.name), o[child.name], c[child.name], depth, here);
  };

  const walkNode = (node: SchemaNode, path: string, orig: unknown, cur: unknown, depth: number, present = true) => {
    const label = node.attribute ? `@${node.name.slice(2)}` : node.name === '#text' ? '(text)' : node.name;
    if (node.type === 'object') {
      const changed = !same(orig, cur);
      rows.push({ kind: 'section', path, label, depth, status: worst(vAt(path)), vs: vAt(path), changed });
      walkObject(node, path, orig, cur, depth + 1, present);
      return;
    }
    if (node.type === 'array') {
      const oi = Array.isArray(orig) ? orig : orig === undefined || orig === null ? [] : [orig];
      const ci = Array.isArray(cur) ? cur : cur === undefined || cur === null ? [] : [cur];
      rows.push({ kind: 'section', path, label: `${label}[]`, depth, status: worst(vAt(path)), vs: vAt(path), changed: !same(orig, cur), arrayNode: node, count: ci.length });
      const children = node.children ?? [];
      const primitive = children.length === 1 && children[0].name === '[*]' ? children[0] : undefined;
      const n = Math.max(oi.length, ci.length);
      for (let i = 0; i < n; i++) {
        const ip = `${path}[${i}]`;
        const removed = i >= ci.length;
        const added = i >= oi.length;
        rows.push({ kind: 'section', path: ip, label: `${label}[${i}]${removed ? ' (removed)' : added ? ' (added)' : ''}`, depth: depth + 1, status: worst(vAt(ip)), vs: vAt(ip), changed: removed || added || !same(oi[i], ci[i]) });
        if (primitive) {
          rows.push({ kind: 'field', path: ip, label: `[${i}]`, depth: depth + 2, node: primitive, orig: oi[i], cur: ci[i], changed: !same(oi[i], ci[i]), vs: vAt(ip), removable: removed ? undefined : ip, removed, added, parentPresent: !removed });
        } else {
          if (!removed) rows[rows.length - 1] = { ...(rows[rows.length - 1] as Row & { kind: 'section' }), arrayNode: undefined, item: true };
          walkObject({ ...node, type: 'object' }, ip, oi[i], removed ? undefined : ci[i], depth + 2, present);
          if (removed) for (let k = rows.length - 1; k >= 0 && rows[k].path.startsWith(ip); k--) (rows[k] as { removed?: boolean }).removed = true;
        }
      }
      return;
    }
    rows.push({ kind: 'field', path, label, depth, node, orig, cur, changed: !same(orig, cur), vs: vAt(path), parentPresent: present });
  };

  if (!root.path) {
    if (root.type === 'array') walkNode(root, '', original, data, 0);
    else walkObject(root, '', original, data, 0, true);
  } else walkNode(root, root.path, original, data, 0);
  return rows;
}

function Input({ node, value, status, onChange, disabled }: { node: SchemaNode; value: unknown; status?: string; onChange: (v: unknown) => void; disabled?: boolean }) {
  const cls = status === 'error' ? 'invalid' : status === 'warning' ? 'warn' : '';
  const str = value === undefined || value === null ? '' : String(value);
  if (node.enum) {
    return (
      <select className={cls} value={str} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
        <option value="">—</option>
        {node.enum.map((v) => (
          <option key={v} value={v}>
            {v}
          </option>
        ))}
        {str && !node.enum.includes(str) && <option value={str}>{str} (not allowed)</option>}
      </select>
    );
  }
  if (node.type === 'boolean') {
    return (
      <select className={cls} disabled={disabled} value={value === true ? 'true' : value === false ? 'false' : ''} onChange={(e) => onChange(e.target.value === '' ? null : e.target.value === 'true')}>
        <option value="">—</option>
        <option value="true">true</option>
        <option value="false">false</option>
      </select>
    );
  }
  if (node.type === 'number' || node.type === 'integer') {
    return <input className={cls} disabled={disabled} type="number" step={node.type === 'integer' ? 1 : 'any'} value={str} onChange={(e) => onChange(coerceValue(e.target.value, node))} />;
  }
  if (node.type === 'date' && /^(\d{4}-\d{2}-\d{2})?$/.test(str)) return <input className={cls} disabled={disabled} type="date" value={str} onChange={(e) => onChange(e.target.value)} />;
  return <input className={cls} disabled={disabled} type="text" value={str} onChange={(e) => onChange(coerceValue(e.target.value, node))} />;
}

export function CompareForm({ root, original, data, violations, onChange, onRemove, filter, computed, readOnly, collapsedDefault }: Props) {
  const rows = useMemo(() => buildRows(root, original, data, violations), [root, original, data, violations]);
  const isComputed = (p: string) => computed?.has(p) ?? false;
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  // Collapse the rule set's default blocks whenever a schema / rule set is (re)applied.
  const collapsedKey = (collapsedDefault ?? []).join('|');
  useEffect(() => {
    const t = new Set((collapsedDefault ?? []).map((p) => toTemplatePath(p)));
    setCollapsed(new Set(rows.filter((r) => r.kind === 'section' && t.has(toTemplatePath(r.path))).map((r) => r.path)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [root, collapsedKey]);

  // Which section rows have visible descendants under the current filter?
  const visible = useMemo(() => {
    const keep = new Set<number>();
    const matches = (r: Row) => filter === 'all' || (filter === 'changed' ? r.changed : filter === 'computed' ? isComputed(r.path) : (r.vs?.length ?? 0) > 0);
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (r.kind === 'field' ? matches(r) : filter === 'all' || (r.vs?.length ?? 0) > 0 || (filter === 'changed' && r.changed && r.arrayNode)) {
        keep.add(i);
        // keep ancestors
        for (let j = i - 1; j >= 0; j--) {
          const a = rows[j];
          if (a.kind === 'section' && r.path.startsWith(a.path) && a.depth < r.depth) keep.add(j);
        }
      }
    }
    // collapse handling
    const out: Row[] = [];
    let hide: string | null = null;
    rows.forEach((r, i) => {
      if (hide !== null && r.path.startsWith(hide) && r.path !== hide) return;
      hide = null;
      if (!keep.has(i)) return;
      out.push(r);
      if (r.kind === 'section' && collapsed.has(r.path)) hide = r.path;
    });
    return out;
  }, [rows, filter, collapsed, computed]);

  const toggle = (p: string) =>
    setCollapsed((s) => {
      const n = new Set(s);
      n.has(p) ? n.delete(p) : n.add(p);
      return n;
    });

  return (
    <div className="compare">
      <div className="compare-head">
        <div>Field</div>
        <div>Original (read-only)</div>
        <div>Editable copy</div>
      </div>
      {visible.map((r) => {
        const indent = { paddingLeft: 8 + r.depth * 14 };
        if (r.kind === 'section') {
          return (
            <div key={'s' + r.path} className={`compare-row section ${r.changed ? 'changed' : ''}`} id={`f-${r.path}`}>
              <div style={indent} className="label">
                <button className="ghost" onClick={() => toggle(r.path)} title={collapsed.has(r.path) ? 'Expand' : 'Collapse'}>
                  {collapsed.has(r.path) ? '▸' : '▾'}
                </button>
                <strong>{r.label}</strong>
                {r.count !== undefined && <span className="badge">{r.count}</span>}
                {r.status && <span className={`badge ${r.status}`}>{r.status}</span>}
                {underAnyPath(r.path, readOnly) && !underAnyPath(r.path.replace(/(\.[^.\[\]]+|\[\d+\])$/, ''), readOnly) && (
                  <span className="badge locked" title="Read-only in this rule set (Rule sets → Display)">read-only</span>
                )}
              </div>
              <div className="muted small">{r.vs?.length ? '' : ''}</div>
              <div>
                {r.vs?.map((v, i) => (
                  <div key={i} className={`msg ${v.severity}`}>
                    {v.message}
                  </div>
                ))}
                {r.arrayNode && !underAnyPath(r.path, readOnly) && (
                  <button className="small" onClick={() => onChange(r.path, [...(((getAtPath(data, r.path) as unknown[]) ?? []) as unknown[]), emptyArrayItem(r.arrayNode!)])}>
                    + Add item
                  </button>
                )}
                {r.item && !underAnyPath(r.path, readOnly) && (
                  <button className="ghost danger" title="Remove item" onClick={() => onRemove(r.path)}>
                    ✕
                  </button>
                )}
              </div>
            </div>
          );
        }
        const status = worst(r.vs);
        const comp = computed?.get(r.path);
        const locked = !comp && underAnyPath(r.path, readOnly);
        return (
          <div key={'f' + r.path} className={`compare-row ${r.changed ? 'changed' : ''} ${r.removed ? 'removed' : ''} ${comp ? 'computed' : ''} ${locked ? 'locked' : ''}`} id={`f-${r.path}`}>
            <div style={indent} className="label">
              {r.label}
              {r.node.required &&
                (r.parentPresent ? (
                  <span style={{ color: 'var(--error)' }} title="Mandatory">
                    {' '}
                    *
                  </span>
                ) : (
                  <span className="req-if-used" title="Mandatory only when this block is filled in (the block is not used in this document)">
                    {' '}
                    *
                  </span>
                ))}
              {comp && (
                <span className="badge computed" title={`Computed: ${comp.name}`}>
                  ƒ computed
                </span>
              )}
              <span className="path">{r.path}</span>
            </div>
            <div className={`orig ${r.added ? 'muted' : ''}`}>{r.added ? '(new)' : fmt(r.orig)}</div>
            <div>
              {r.removed ? (
                <span className="muted small">removed</span>
              ) : comp ? (
                <ComputedValue value={r.cur} computation={comp} status={status} />
              ) : locked ? (
                <div className={`locked-value ${status === 'error' ? 'invalid' : ''}`} title="Read-only in this rule set (Rule sets → Display)" aria-readonly="true">
                  {fmt(r.cur)}
                </div>
              ) : (
                <div className="row" style={{ flexWrap: 'nowrap' }}>
                  <div className="grow">
                    <Input node={r.node} value={r.cur} status={status} onChange={(v) => onChange(r.path, v)} />
                  </div>
                  {r.changed && !r.added && (
                    <button className="ghost" title="Revert to original" onClick={() => onChange(r.path, r.orig === undefined ? emptyValueFor(r.node) : r.orig)}>
                      ↺
                    </button>
                  )}
                  {r.removable && (
                    <button className="ghost danger" title="Remove item" onClick={() => onRemove(r.removable!)}>
                      ✕
                    </button>
                  )}
                </div>
              )}
              {r.vs?.map((v, i) => (
                <div key={i} className={`msg ${v.severity}`}>
                  {v.message}
                </div>
              ))}
            </div>
          </div>
        );
      })}
      {visible.length === 0 && <div className="empty">Nothing to show for this filter.</div>}
    </div>
  );
}
