import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { describeRule, flattenSchema, validateComputationDefinition, type Computation, type Rule, type RuleSet, type SchemaDefinition } from '@rule-engine/core';
import { api, type SchemaSummary } from '../api';
import { RuleEditor } from '../components/RuleEditor';
import { SchemaTree } from '../components/SchemaTree';

const newId = () => Math.random().toString(36).slice(2, 10);

export function RuleSetsPage() {
  const [schemas, setSchemas] = useState<SchemaSummary[]>([]);
  const [schemaId, setSchemaId] = useState<string>('');
  const [schema, setSchema] = useState<SchemaDefinition | null>(null);
  const [ruleSets, setRuleSets] = useState<RuleSet[]>([]);
  const [current, setCurrent] = useState<RuleSet | null>(null); // working copy
  const [dirty, setDirty] = useState(false);
  const [editing, setEditing] = useState<Rule | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState('');
  const [onlyEnabled, setOnlyEnabled] = useState(false);
  const [tab, setTab] = useState<'rules' | 'computed' | 'display'>('rules');
  const [editingComp, setEditingComp] = useState<Computation | null>(null);
  const importInput = useRef<HTMLInputElement>(null);

  const importRuleSet = async (files: FileList | null) => {
    if (!files?.length || !schemaId) return;
    setError(null);
    try {
      const text = await files[0].text();
      const parsed = JSON.parse(text);
      const rules: Rule[] = Array.isArray(parsed) ? parsed : parsed.rules;
      if (!Array.isArray(rules)) throw new Error('File must be a rule set ({ name, rules: [...] }) or an array of rules');
      const name = parsed.name ?? files[0].name.replace(/\.(ruleset\.)?json$/i, '');
      const saved = await api.ruleSets.create({ name, description: parsed.description, schemaId, rules, computations: Array.isArray(parsed.computations) ? parsed.computations : undefined, display: parsed.display });
      setRuleSets(await api.ruleSets.list(schemaId));
      setCurrent(structuredClone(saved));
      setDirty(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      if (importInput.current) importInput.current.value = '';
    }
  };

  useEffect(() => {
    api.schemas.list().then((s) => {
      setSchemas(s);
      if (s.length && !schemaId) setSchemaId(s[0].id);
    });
  }, []);

  useEffect(() => {
    if (!schemaId) return;
    setCurrent(null);
    setEditing(null);
    api.schemas.get(schemaId).then(setSchema).catch((e) => setError(e.message));
    api.ruleSets.list(schemaId).then(setRuleSets).catch((e) => setError(e.message));
  }, [schemaId]);

  const nodes = useMemo(() => (schema ? flattenSchema(schema.root) : []), [schema]);

  const openRuleSet = (rs: RuleSet) => {
    if (dirty && !confirm('Discard unsaved changes?')) return;
    setCurrent(structuredClone(rs));
    setDirty(false);
    setEditing(null);
  };

  const createRuleSet = () => {
    if (dirty && !confirm('Discard unsaved changes?')) return;
    const ts = new Date().toISOString();
    setCurrent({ id: '', name: 'New rule set', schemaId, rules: [], createdAt: ts, updatedAt: ts });
    setDirty(true);
    setEditing(null);
  };

  const save = async () => {
    if (!current) return;
    setSaving(true);
    setError(null);
    try {
      const saved = current.id
        ? await api.ruleSets.update(current.id, { name: current.name, description: current.description, rules: current.rules, computations: current.computations ?? [], display: current.display ?? null })
        : await api.ruleSets.create({ name: current.name, description: current.description, schemaId, rules: current.rules, computations: current.computations ?? [], display: current.display ?? null });
      setCurrent(structuredClone(saved));
      setDirty(false);
      setRuleSets(await api.ruleSets.list(schemaId));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (rs: RuleSet) => {
    if (!confirm(`Delete rule set "${rs.name}"?`)) return;
    await api.ruleSets.remove(rs.id);
    if (current?.id === rs.id) setCurrent(null);
    setRuleSets(await api.ruleSets.list(schemaId));
  };

  const update = (patch: Partial<RuleSet>) => {
    setCurrent((c) => (c ? { ...c, ...patch } : c));
    setDirty(true);
  };

  const upsertRule = (r: Rule) => {
    const exists = current!.rules.some((x) => x.id === r.id);
    update({ rules: exists ? current!.rules.map((x) => (x.id === r.id ? r : x)) : [...current!.rules, r] });
    setEditing(null);
  };

  const addRule = (target = '') =>
    setEditing({ id: newId(), name: '', target, check: { kind: 'required' }, severity: 'error', enabled: true });


  const computations = current?.computations ?? [];
  const visibleComps = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return computations.filter((c) => (!onlyEnabled || c.enabled !== false) && (!q || [c.name, c.target, c.expression, c.ref, c.group, c.notes].join(' ').toLowerCase().includes(q)));
  }, [computations, filter, onlyEnabled]);
  const upsertComp = (c: Computation) => {
    const exists = computations.some((x) => x.id === c.id);
    update({ computations: exists ? computations.map((x) => (x.id === c.id ? c : x)) : [...computations, c] });
    setEditingComp(null);
  };
  const addComp = (target = '') => setEditingComp({ id: newId(), name: '', target, expression: '', enabled: true });

  const visibleRules = useMemo(() => {
    if (!current) return [] as Rule[];
    const q = filter.trim().toLowerCase();
    return current.rules.filter((r) => (!onlyEnabled || r.enabled !== false) && (!q || [r.name, r.target, r.ref, r.group, r.notes, describeRule(r)].join(' ').toLowerCase().includes(q)));
  }, [current, filter, onlyEnabled]);

  const renderRule = (r: Rule) =>

                editing?.id === r.id ? (
                  <RuleEditor key={r.id} rule={editing} nodes={nodes} onSave={upsertRule} onCancel={() => setEditing(null)} />
                ) : (
                  <div key={r.id} className={`rule-card ${r.enabled === false ? 'disabled' : ''}`}>
                    <input
                      type="checkbox"
                      title="Enabled"
                      checked={r.enabled !== false}
                      onChange={(e) => update({ rules: current!.rules.map((x) => (x.id === r.id ? { ...x, enabled: e.target.checked } : x)) })}
                    />
                    <div className="grow">
                      <div className="row">
                        <strong>{r.name}</strong>
                        <span className={`badge ${r.severity}`}>{r.severity}</span>
                      </div>
                      <div className="desc">{describeRule(r)}</div>
                      {r.message && <div className="small muted">“{r.message}”</div>}
                      {(r.ref || r.notes) && (
                        <div className="small muted">
                          {r.ref && <span className="badge" title={r.notes}>{r.ref}</span>} {r.notes}
                        </div>
                      )}
                    </div>
                    <button onClick={() => setEditing(structuredClone(r))}>Edit</button>
                    <button className="danger" onClick={() => update({ rules: current!.rules.filter((x) => x.id !== r.id) })}>
                      Delete
                    </button>
                  </div>
                );

  return (
    <div className="layout three">
      <div>
        <div className="panel">
          <h2>Schema</h2>
          <select value={schemaId} onChange={(e) => setSchemaId(e.target.value)} style={{ width: '100%' }}>
            {schemas.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({s.format})
              </option>
            ))}
          </select>
          {schemas.length === 0 && <p className="small muted">Upload a schema first.</p>}
        </div>
        <div className="panel">
          <div className="panel-header">
            <h2>Rule sets</h2>
            <div className="row">
              <button onClick={() => importInput.current?.click()} disabled={!schemaId} title="Import a .ruleset.json file for this schema">
                Import…
              </button>
              <input ref={importInput} type="file" hidden accept=".json" onChange={(e) => importRuleSet(e.target.files)} />
              <button className="primary" onClick={createRuleSet} disabled={!schemaId}>
                + New
              </button>
            </div>
          </div>
          {error && !current && <div className="alert error" style={{ marginBottom: 8 }}>{error}</div>}
          <ul className="list">
            {ruleSets.map((rs) => (
              <li key={rs.id} className={current?.id === rs.id ? 'active' : ''} onClick={() => openRuleSet(rs)}>
                <span className="title grow">{rs.name}</span>
                <span className="badge">{rs.rules.length}</span>
                {!!rs.computations?.length && <span className="badge computed" title="computed fields">ƒ {rs.computations.length}</span>}
                <button
                  className="ghost danger"
                  onClick={(e) => {
                    e.stopPropagation();
                    remove(rs);
                  }}
                >
                  ✕
                </button>
              </li>
            ))}
            {ruleSets.length === 0 && <li className="muted small">No rule sets for this schema yet.</li>}
          </ul>
        </div>
      </div>

      <div>
        {!current ? (
          <div className="panel empty">Pick a rule set on the left, or create a new one.</div>
        ) : (
          <div className="panel">
            <div className="panel-header">
              <div className="row grow">
                <input className="grow" value={current.name} onChange={(e) => update({ name: e.target.value })} style={{ fontWeight: 600 }} />
              </div>
              <div className="row">
                {dirty && <span className="badge warning">unsaved</span>}
                {current.id && (
                  <a className="btn" href={api.ruleSets.exportUrl(current.id)} title="Download as .ruleset.json">
                    Export
                  </a>
                )}
                <button className="primary" onClick={save} disabled={saving || !dirty || !current.name.trim()}>
                  {saving ? 'Saving…' : current.id ? 'Save changes' : 'Create rule set'}
                </button>
              </div>
            </div>
            <input
              placeholder="Description (optional)"
              value={current.description ?? ''}
              onChange={(e) => update({ description: e.target.value })}
              style={{ width: '100%', marginBottom: 12 }}
            />
            {error && <div className="alert error" style={{ marginBottom: 10 }}>{error}</div>}
            <nav className="viewswitch" style={{ marginBottom: 10 }}>
              <button className={tab === 'rules' ? 'active' : ''} onClick={() => setTab('rules')}>
                Validation rules ({current.rules.length})
              </button>
              <button className={tab === 'computed' ? 'active' : ''} onClick={() => setTab('computed')} data-testid="tab-computed">
                Computed fields ({computations.length})
              </button>
              <button className={tab === 'display' ? 'active' : ''} onClick={() => setTab('display')} data-testid="tab-display">
                Display
              </button>
            </nav>
            {tab === 'display' && (
              <div className="stack">
                <div className="small muted">How documents opened with this rule set are shown in the Documents tab. One path per line; a path covers the block and everything under it (indices are ignored, e.g. <span className="mono">a.rows[*].x</span>). Field paths are listed in the tree on the right.</div>
                {(['readOnly', 'collapsed'] as const).map((k) => (
                  <label key={k} className="field">
                    {k === 'readOnly' ? 'Read-only blocks / fields (e.g. pre-filled personal information)' : 'Collapsed when a document is opened'}
                    <textarea
                      className="mono"
                      rows={5}
                      data-display={k}
                      value={(current.display?.[k] ?? []).join('\n')}
                      onChange={(e) => update({ display: { ...current.display, [k]: e.target.value.split('\n').map((s) => s.trim()).filter((s, i, a) => s || i < a.length - 1) } })}
                    />
                  </label>
                ))}
              </div>
            )}
            {tab === 'computed' && (
              <div className="stack">
                <div className="small muted">
                  A computed field is calculated from other fields and is read-only in the Documents editor. Computed fields are evaluated in dependency order before the validation rules, every time the document changes. Untick a field to make it editable again.
                </div>
                <div className="row">
                  <input className="grow" placeholder="Search computed fields (name, path, formula, source)…" value={filter} onChange={(e) => setFilter(e.target.value)} />
                  <label className="row small muted" style={{ gap: 4 }}>
                    <input type="checkbox" checked={onlyEnabled} onChange={(e) => setOnlyEnabled(e.target.checked)} /> enabled only
                  </label>
                  <span className="badge">{visibleComps.length} / {computations.length}</span>
                </div>
                {visibleComps.map((c, i) => (
                  <Fragment key={c.id}>
                    {(i === 0 || visibleComps[i - 1].group !== c.group) && c.group && <h3 style={{ marginTop: 10 }}>{c.group}</h3>}
                    {editingComp?.id === c.id ? (
                      <ComputationEditor value={editingComp} onSave={upsertComp} onCancel={() => setEditingComp(null)} />
                    ) : (
                      <div className={`rule-card ${c.enabled === false ? 'disabled' : ''}`}>
                        <input type="checkbox" title="Enabled" checked={c.enabled !== false} onChange={(e) => update({ computations: computations.map((x) => (x.id === c.id ? { ...x, enabled: e.target.checked } : x)) })} />
                        <div className="grow">
                          <div className="row">
                            <strong>{c.name || c.target}</strong>
                            <span className="badge computed">ƒ</span>
                          </div>
                          <div className="desc mono small">
                            {c.target} = {c.expression}
                            {c.condition ? `   (when ${c.condition})` : ''}
                          </div>
                          {(c.ref || c.notes) && (
                            <div className="small muted">
                              {c.ref && <span className="badge">{c.ref}</span>} {c.notes}
                            </div>
                          )}
                        </div>
                        <button onClick={() => setEditingComp(structuredClone(c))}>Edit</button>
                        <button className="danger" onClick={() => update({ computations: computations.filter((x) => x.id !== c.id) })}>
                          Delete
                        </button>
                      </div>
                    )}
                  </Fragment>
                ))}
                {editingComp && !computations.some((c) => c.id === editingComp.id) && <ComputationEditor value={editingComp} onSave={upsertComp} onCancel={() => setEditingComp(null)} />}
                {!editingComp && (
                  <button onClick={() => addComp()} style={{ alignSelf: 'flex-start' }}>
                    + Add computed field
                  </button>
                )}
              </div>
            )}
            {tab === 'rules' && (
            <>
            <div className="row" style={{ marginBottom: 10 }}>
              <input className="grow" placeholder="Search rules (name, path, reference, group)…" value={filter} onChange={(e) => setFilter(e.target.value)} />
              <label className="row small muted" style={{ gap: 4 }}>
                <input type="checkbox" checked={onlyEnabled} onChange={(e) => setOnlyEnabled(e.target.checked)} /> enabled only
              </label>
              <span className="badge">{visibleRules.length} / {current.rules.length}</span>
            </div>

            <div className="stack">
              {visibleRules.map((r, i) => (
                <Fragment key={r.id}>
                  {(i === 0 || visibleRules[i - 1].group !== r.group) && r.group && <h3 style={{ marginTop: 10 }}>{r.group}</h3>}
                  {renderRule(r)}
                </Fragment>
              ))}
              {editing && !current.rules.some((r) => r.id === editing.id) && (
                <RuleEditor rule={editing} nodes={nodes} onSave={upsertRule} onCancel={() => setEditing(null)} />
              )}
              {!editing && (
                <button onClick={() => addRule()} style={{ alignSelf: 'flex-start' }}>
                  + Add rule
                </button>
              )}
              {current.rules.length === 0 && !editing && <div className="muted small">No rules yet. Click a field in the schema tree on the right to add a rule for it.</div>}
            </div>
            </>
            )}
          </div>
        )}
      </div>

      <div>
        <div className="panel">
          <h2>Fields</h2>
          <p className="small muted">Click a field to start a {tab === 'computed' ? 'computed field' : 'rule'} targeting it.</p>
          {schema ? <SchemaTree root={schema.root} onSelect={(n) => current && (tab === 'computed' ? !editingComp && addComp(n.path) : !editing && addRule(n.path))} /> : <span className="muted">—</span>}
        </div>
      </div>
    </div>
  );
}

/** Inline editor for one computed field. */
function ComputationEditor({ value, onSave, onCancel }: { value: Computation; onSave: (c: Computation) => void; onCancel: () => void }) {
  const [c, setC] = useState<Computation>(value);
  const problems = validateComputationDefinition(c);
  const set = (patch: Partial<Computation>) => setC((x) => ({ ...x, ...patch }));
  return (
    <div className="rule-editor stack" data-testid="computation-editor">
      <label className="field">
        Name
        <input value={c.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Gross total income (B4)" />
      </label>
      <label className="field">
        Target field (use [*] for a column of every row)
        <input className="mono" value={c.target} onChange={(e) => set({ target: e.target.value })} />
      </label>
      <label className="field">
        Formula
        <textarea className="mono" rows={3} value={c.expression} onChange={(e) => set({ expression: e.target.value })} placeholder="e.g. a.b + a.c   ·   sum(rows[*].amount)   ·   if(x > 0, x, 0)" />
      </label>
      <label className="field">
        Only when (optional condition; when false the field stays editable)
        <input className="mono" value={c.condition ?? ''} onChange={(e) => set({ condition: e.target.value || undefined })} />
      </label>
      <div className="row">
        <label className="field grow">
          Group
          <input value={c.group ?? ''} onChange={(e) => set({ group: e.target.value || undefined })} />
        </label>
        <label className="field grow">
          Source / reference
          <input value={c.ref ?? ''} onChange={(e) => set({ ref: e.target.value || undefined })} />
        </label>
      </div>
      {problems.length > 0 && <div className="alert error small">{problems.join('; ')}</div>}
      <div className="row">
        <button className="primary" disabled={problems.length > 0} onClick={() => onSave(c)}>
          Done
        </button>
        <button onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
