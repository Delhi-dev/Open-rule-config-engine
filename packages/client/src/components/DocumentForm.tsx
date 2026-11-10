import { coerceValue, emptyArrayItem, emptyValueFor, underAnyPath, type Computation, type SchemaNode, type Violation } from '@rule-engine/core';

export type ViolationIndex = Map<string, Violation[]>;
/** Concrete path → computation that produces it (read-only fields). */
export type ComputedIndex = Map<string, Computation>;

/** Read-only display of a computed field; the formula and its source are shown on hover. */
export function ComputedValue({ value, computation, status }: { value: unknown; computation: Computation; status?: string }) {
  const cls = status === 'error' ? 'invalid' : status === 'warning' ? 'warn' : '';
  const shown = value === undefined || value === null || value === '' ? '—' : typeof value === 'number' ? value.toLocaleString('en-IN') : String(value);
  return (
    <div
      className={`computed-value ${cls}`}
      title={`${computation.name}\n= ${computation.expression.replace(/\bITR\.\w+\./g, '')}${computation.ref ? `\nSource: ${computation.ref}` : ''}${computation.notes ? `\n${computation.notes}` : ''}`}
      aria-readonly="true"
      data-computed={computation.id}
    >
      {shown}
    </div>
  );
}

interface Common {
  violations: ViolationIndex;
  computed?: ComputedIndex;
  readOnly?: string[];
  onChange: (path: string, value: unknown) => void;
  onRemove: (path: string) => void;
}

function childPath(parent: string, name: string) {
  return parent ? `${parent}.${name}` : name;
}

function worst(vs: Violation[] | undefined): 'error' | 'warning' | undefined {
  if (!vs?.length) return undefined;
  return vs.some((v) => v.severity === 'error') ? 'error' : 'warning';
}

export function DocumentForm({ root, data, ...common }: { root: SchemaNode; data: unknown } & Common) {
  // The virtual root ('' path) renders its children directly.
  if (!root.path) {
    if (root.type === 'array') return <ArrayField node={root} path="" value={data} {...common} />;
    return <ObjectFields node={root} path="" value={data} {...common} />;
  }
  return <Field node={root} path={root.path} value={data} {...common} />;
}

function ObjectFields({ node, path, value, ...common }: { node: SchemaNode; path: string; value: unknown } & Common) {
  const obj = (value ?? {}) as Record<string, unknown>;
  return (
    <>
      {(node.children ?? []).map((c) => (
        <Field key={c.name} node={c} path={childPath(path, c.name)} value={obj[c.name]} {...common} />
      ))}
    </>
  );
}

function Messages({ vs }: { vs: Violation[] | undefined }) {
  if (!vs?.length) return null;
  return (
    <>
      {vs.map((v, i) => (
        <div key={i} className={`msg ${v.severity}`}>
          {v.message}
        </div>
      ))}
    </>
  );
}

function Field({ node, path, value, ...common }: { node: SchemaNode; path: string; value: unknown } & Common) {
  const vs = common.violations.get(path);
  const status = worst(vs);
  const label = node.attribute ? `@${node.name.slice(2)}` : node.name === '#text' ? '(text)' : node.name;
  const comp = common.computed?.get(path);

  if (node.type === 'object') {
    return (
      <div className="form-section" id={`f-${path}`}>
        <div className="form-section-title">
          {label}
          {status && <span className={`badge ${status}`}>{status}</span>}
        </div>
        <Messages vs={vs} />
        <ObjectFields node={node} path={path} value={value} {...common} />
      </div>
    );
  }
  if (node.type === 'array') return <ArrayField node={node} path={path} value={value} {...common} />;

  return (
    <div className="form-field" id={`f-${path}`}>
      <div className="label">
        {label}
        {node.required && <span style={{ color: 'var(--error)' }}> *</span>}
        {comp && <span className="badge computed">ƒ computed</span>}
        <span className="path">{path}</span>
      </div>
      <div>
        {comp ? (
          <ComputedValue value={value} computation={comp} status={status} />
        ) : underAnyPath(path, common.readOnly) ? (
          <div className="locked-value" aria-readonly="true" title="Read-only in this rule set">
            {value === undefined || value === null || value === '' ? '—' : String(value)}
          </div>
        ) : (
          <LeafInput node={node} value={value} status={status} onChange={(v) => common.onChange(path, v)} />
        )}
        <Messages vs={vs} />
      </div>
    </div>
  );
}

function LeafInput({ node, value, status, onChange }: { node: SchemaNode; value: unknown; status?: string; onChange: (v: unknown) => void }) {
  const cls = status === 'error' ? 'invalid' : status === 'warning' ? 'warn' : '';
  const str = value === undefined || value === null ? '' : String(value);
  if (node.enum) {
    return (
      <select className={cls} value={str} onChange={(e) => onChange(e.target.value)} style={{ width: '100%' }}>
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
      <select className={cls} value={value === true ? 'true' : value === false ? 'false' : ''} onChange={(e) => onChange(e.target.value === '' ? null : e.target.value === 'true')}>
        <option value="">—</option>
        <option value="true">true</option>
        <option value="false">false</option>
      </select>
    );
  }
  if (node.type === 'date' && /^(\d{4}-\d{2}-\d{2})?$/.test(str)) {
    return <input className={cls} type="date" value={str} onChange={(e) => onChange(e.target.value)} />;
  }
  if (node.type === 'number' || node.type === 'integer') {
    return (
      <input
        className={cls}
        type="number"
        step={node.type === 'integer' ? 1 : 'any'}
        value={str}
        onChange={(e) => onChange(coerceValue(e.target.value, node))}
        style={{ width: '100%' }}
      />
    );
  }
  return <input className={cls} type="text" value={str} onChange={(e) => onChange(coerceValue(e.target.value, node))} style={{ width: '100%' }} />;
}

function ArrayField({ node, path, value, ...common }: { node: SchemaNode; path: string; value: unknown } & Common) {
  const items = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
  const vs = common.violations.get(path);
  const status = worst(vs);
  const children = node.children ?? [];
  const primitiveItem = children.length === 1 && children[0].name === '[*]' ? children[0] : undefined;
  const label = node.name;

  return (
    <div className="form-section" id={`f-${path}`}>
      <div className="form-section-title">
        {label}
        <span className="badge">{items.length} item{items.length === 1 ? '' : 's'}</span>
        {status && <span className={`badge ${status}`}>{status}</span>}
        <span className="grow" />
        {!underAnyPath(path, common.readOnly) && <button onClick={() => common.onChange(path, [...items, emptyArrayItem(node)])}>+ Add</button>}
      </div>
      <Messages vs={vs} />
      {items.map((item, i) => {
        const itemPath = `${path}[${i}]`;
        const ivs = common.violations.get(itemPath);
        return (
          <div className="array-item" key={i} id={`f-${itemPath}`}>
            <div className="array-item-header">
              <span className="mono">{itemPath}</span>
              {!underAnyPath(itemPath, common.readOnly) && (
                <button className="ghost danger" onClick={() => common.onRemove(itemPath)}>
                  remove
                </button>
              )}
            </div>
            <Messages vs={ivs} />
            {primitiveItem ? (
              <LeafInput node={primitiveItem} value={item} status={worst(ivs)} onChange={(v) => common.onChange(itemPath, v)} />
            ) : (
              <ObjectFields node={node} path={itemPath} value={item ?? emptyValueFor({ ...node, type: 'object' })} {...common} />
            )}
          </div>
        );
      })}
    </div>
  );
}
