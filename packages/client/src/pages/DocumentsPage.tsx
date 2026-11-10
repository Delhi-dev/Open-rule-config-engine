import { useEffect, useMemo, useRef, useState } from 'react';
import {
  computeDocument,
  deleteAtPath,
  getAtPath,
  underAnyPath,
  pruneBlanks,
  serializeDocument,
  setAtPath,
  validateDocument,
  type RuleSet,
  type SchemaDefinition,
  type Violation,
} from '@rule-engine/core';
import { api, type DocumentSummary, type SchemaSummary } from '../api';
import { DocumentForm, type ComputedIndex, type ViolationIndex } from '../components/DocumentForm';
import { CompareForm } from '../components/CompareForm';

interface Draft {
  id?: string;
  name: string;
  data: unknown;
  /** Snapshot of the data as loaded (for the side-by-side view). */
  original: unknown;
}

export function DocumentsPage() {
  const [schemas, setSchemas] = useState<SchemaSummary[]>([]);
  const [schemaId, setSchemaId] = useState('');
  const [schema, setSchema] = useState<SchemaDefinition | null>(null);
  const [ruleSets, setRuleSets] = useState<RuleSet[]>([]);
  const [ruleSetId, setRuleSetId] = useState('');
  const [docs, setDocs] = useState<DocumentSummary[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [dirty, setDirty] = useState(false);
  const [view, setView] = useState<'form' | 'compare' | 'raw'>('compare');
  const [cmpFilter, setCmpFilter] = useState<'all' | 'changed' | 'errors' | 'computed'>('all');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [leftHidden, setLeftHidden] = useState<boolean>(() => {
    try {
      return localStorage.getItem('documents.leftHidden') === '1';
    } catch {
      return false;
    }
  });
  const toggleLeft = () =>
    setLeftHidden((h) => {
      try {
        localStorage.setItem('documents.leftHidden', h ? '0' : '1');
      } catch {
        /* storage unavailable */
      }
      return !h;
    });

  useEffect(() => {
    api.schemas.list().then((s) => {
      setSchemas(s);
      if (s.length) setSchemaId((id) => id || s[0].id);
    });
  }, []);

  useEffect(() => {
    if (!schemaId) return;
    setDraft(null);
    setDirty(false);
    setError(null);
    api.schemas.get(schemaId).then(setSchema).catch((e) => setError(e.message));
    api.ruleSets.list(schemaId).then((rs) => {
      setRuleSets(rs);
      // Remember the rule set last used with this schema (the schema + rule set pair decides which rules and computed fields apply).
      let last = '';
      try {
        last = localStorage.getItem(`ruleSetFor:${schemaId}`) ?? '';
      } catch {
        /* storage unavailable */
      }
      setRuleSetId(rs.some((r) => r.id === last) ? last : (rs[0]?.id ?? ''));
    });
    api.documents.list(schemaId).then(setDocs);
  }, [schemaId]);

  const ruleSet = ruleSets.find((r) => r.id === ruleSetId);
  const chooseRuleSet = (id: string) => {
    setRuleSetId(id);
    try {
      localStorage.setItem(`ruleSetFor:${schemaId}`, id);
    } catch {
      /* storage unavailable */
    }
  };

  // Computed fields are recalculated from the entered values on every change, before validation.
  // `effective` is what the user sees on the editable side, what is validated, saved and downloaded.
  const computedRun = useMemo(() => (draft ? computeDocument(draft.data, ruleSet?.computations ?? []) : null), [draft, ruleSet]);
  const effective = computedRun?.data;
  const computedIndex = useMemo<ComputedIndex>(() => {
    const byId = new Map((ruleSet?.computations ?? []).map((c) => [c.id, c]));
    const m: ComputedIndex = new Map();
    for (const [p, id] of computedRun?.computed ?? []) {
      const c = byId.get(id);
      if (c) m.set(p, c);
    }
    return m;
  }, [computedRun, ruleSet]);
  const activeComputations = (ruleSet?.computations ?? []).filter((c) => c.enabled !== false).length;

  const result = useMemo(() => (draft && ruleSet ? validateDocument(effective, ruleSet.rules) : null), [effective, draft, ruleSet]);
  const violationIndex = useMemo<ViolationIndex>(() => {
    const m = new Map<string, Violation[]>();
    for (const v of result?.violations ?? []) m.set(v.path, [...(m.get(v.path) ?? []), v]);
    return m;
  }, [result]);

  const changedCount = useMemo(() => {
    if (!draft) return 0;
    let n = 0;
    const walk = (a: unknown, b: unknown) => {
      const norm = (v: unknown) => (v === undefined || v === null || v === '' ? '' : v);
      if (Array.isArray(a) || Array.isArray(b)) {
        const x = Array.isArray(a) ? a : [];
        const y = Array.isArray(b) ? b : [];
        for (let i = 0; i < Math.max(x.length, y.length); i++) walk(x[i], y[i]);
        return;
      }
      if ((typeof a === 'object' && a) || (typeof b === 'object' && b)) {
        const keys = new Set([...Object.keys((a as object) ?? {}), ...Object.keys((b as object) ?? {})]);
        for (const k of keys) walk((a as Record<string, unknown>)?.[k], (b as Record<string, unknown>)?.[k]);
        return;
      }
      if (JSON.stringify(norm(a)) !== JSON.stringify(norm(b))) n++;
    };
    walk(draft.original, effective);
    return n;
  }, [draft, effective]);

  const confirmDiscard = () => !dirty || confirm('Discard unsaved changes to the current document?');

  const newDocument = async () => {
    if (!schema || !confirmDiscard()) return;
    const { data } = await api.schemas.emptyDocument(schema.id);
    setDraft({ name: `new-${schema.name}`, data, original: data });
    setDirty(true);
    setNotice(null);
  };

  const openDocument = async (id: string) => {
    if (!confirmDiscard()) return;
    const d = await api.documents.get(id);
    setDraft({ id: d.id, name: d.name, data: d.data, original: d.data });
    if (d.ruleSetId && ruleSets.some((r) => r.id === d.ruleSetId)) setRuleSetId(d.ruleSetId);
    setDirty(false);
    setNotice(null);
  };

  const uploadDocument = async (files: FileList | null) => {
    if (!files?.length || !schema || !confirmDiscard()) return;
    setError(null);
    try {
      const parsed = await api.documents.parse(files[0], schema.id);
      setDraft({ name: parsed.name, data: parsed.data, original: parsed.data });
      setDirty(true);
      setNotice(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const readOnly = ruleSet?.display?.readOnly;
  const onChange = (path: string, value: unknown) => {
    if (underAnyPath(path, readOnly)) return; // read-only block (rule set display settings)
    setDraft((d) => (d ? { ...d, data: setAtPath(d.data, path, value) } : d));
    setDirty(true);
  };
  const onRemove = (path: string) => {
    if (underAnyPath(path, readOnly)) return;
    setDraft((d) => (d ? { ...d, data: deleteAtPath(d.data, path) } : d));
    setDirty(true);
  };

  const save = async () => {
    if (!draft || !schema) return;
    if (result && !result.valid) {
      setError(`Cannot save: ${result.errors.length} rule error(s) must be fixed first.`);
      return;
    }
    setError(null);
    try {
      const saved = await api.documents.save({ id: draft.id, name: draft.name, schemaId: schema.id, ruleSetId: ruleSetId || undefined, data: pruneBlanks(effective) });
      setDraft({ id: saved.id, name: saved.name, data: saved.data, original: saved.data });
      setDirty(false);
      setDocs(await api.documents.list(schema.id));
      setNotice(`Saved "${saved.name}" (${new Date(saved.updatedAt).toLocaleTimeString()})`);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const download = () => {
    if (!draft || !schema) return;
    const text = serializeDocument(pruneBlanks(effective), schema.format);
    const blob = new Blob([text], { type: schema.format === 'json' ? 'application/json' : 'application/xml' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${draft.name.replace(/[^\w.-]+/g, '_')}.${schema.format}`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const removeDoc = async (d: DocumentSummary) => {
    if (!confirm(`Delete document "${d.name}"?`)) return;
    await api.documents.remove(d.id);
    if (draft?.id === d.id) setDraft(null);
    setDocs(await api.documents.list(schemaId));
  };

  const jumpTo = (path: string) => {
    // Stay in the side-by-side view (its rows carry the same ids); show all rows so the target is not filtered out.
    if (view === 'raw') setView('form');
    if (view === 'compare') setCmpFilter('all');
    setTimeout(() => {
      // Walk up until an element exists (missing leaves live inside their parent section).
      let p = path;
      while (p) {
        const el = document.getElementById(`f-${p}`);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          el.classList.remove('highlight');
          void el.offsetWidth;
          el.classList.add('highlight');
          return;
        }
        p = p.replace(/(\.[^.\[\]]+|\[\d+\])$/, '');
      }
    }, 50);
  };

  return (
    <div className={`layout three ${leftHidden ? 'left-hidden' : ''}`}>
      <div className="left-pane" hidden={leftHidden}>
        <div className="panel">
          <h2>Schema &amp; rule set</h2>
          <div className="stack">
            <label className="field">
              Schema
              <select value={schemaId} onChange={(e) => confirmDiscard() && setSchemaId(e.target.value)}>
                {schemas.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.format})
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Rule set
              <select value={ruleSetId} onChange={(e) => chooseRuleSet(e.target.value)}>
                <option value="">(none — no validation)</option>
                {ruleSets.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name} ({r.rules.length} rules{r.computations?.length ? `, ${r.computations.length} computed` : ''})
                  </option>
                ))}
              </select>
            </label>
            {ruleSet && (
              <div className="small muted" data-testid="ruleset-summary">
                Applying <strong>{ruleSet.rules.filter((r) => r.enabled !== false).length}</strong> rules
                {activeComputations > 0 ? (
                  <>
                    {' '}and <strong>{activeComputations}</strong> computed fields. Computed fields (<span className="badge computed">ƒ</span>) are read-only and recalculated from the entered values on every edit.
                  </>
                ) : (
                  '. This rule set has no computed fields; every field is editable.'
                )}
              </div>
            )}
            {computedRun && computedRun.errors.length > 0 && (
              <div className="alert error small">
                {computedRun.errors.length} computed field(s) could not be evaluated: {computedRun.errors.slice(0, 3).map((e) => `${e.id}: ${e.message}`).join('; ')}
              </div>
            )}
          </div>
        </div>
        <div className="panel">
          <h2>Open</h2>
          <div className="row">
            <button className="primary" onClick={newDocument} disabled={!schema}>
              + New from schema
            </button>
            <button onClick={() => fileInput.current?.click()} disabled={!schema}>
              Upload {schema?.format.toUpperCase() ?? ''}…
            </button>
            <input ref={fileInput} type="file" hidden accept=".json,.xml" onChange={(e) => uploadDocument(e.target.files)} />
          </div>
          <h3 style={{ marginTop: 14 }}>Saved documents</h3>
          <ul className="list">
            {docs.map((d) => (
              <li key={d.id} className={draft?.id === d.id ? 'active' : ''} onClick={() => openDocument(d.id)}>
                <span className="title grow">{d.name}</span>
                <a className="small" href={api.documents.exportUrl(d.id)} onClick={(e) => e.stopPropagation()} title="Download">
                  ⤓
                </a>
                <button
                  className="ghost danger"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeDoc(d);
                  }}
                >
                  ✕
                </button>
              </li>
            ))}
            {docs.length === 0 && <li className="muted small">Nothing saved for this schema yet.</li>}
          </ul>
        </div>
      </div>

      <div>
        <button className="pane-toggle" onClick={toggleLeft} aria-expanded={!leftHidden} data-testid="toggle-left" title={leftHidden ? 'Show the schema, rule set and saved documents pane' : 'Hide the left pane to widen the side-by-side view'}>
          {leftHidden ? '▶ Show schema, rule set & documents' : '◀ Hide left pane'}
        </button>
        {leftHidden && schema && (
          <span className="small muted" style={{ marginLeft: 10 }}>
            {schema.name}
            {ruleSet ? ` · ${ruleSet.name}` : ' · no rule set'}
          </span>
        )}
        {!draft || !schema ? (
          <div className="panel empty">Create a new document from the schema, upload an existing file, or open a saved one.</div>
        ) : (
          <div className="panel">
            <div className="panel-header">
              <div className="row grow">
                <input value={draft.name} onChange={(e) => (setDraft({ ...draft, name: e.target.value }), setDirty(true))} style={{ fontWeight: 600 }} />
                <span className={`badge ${schema.format}`}>{schema.format}</span>
                {dirty && <span className="badge warning">unsaved</span>}
              </div>
              <div className="row">
                <nav className="viewswitch">
                  {(['compare', 'form', 'raw'] as const).map((v) => (
                    <button key={v} className={view === v ? 'active' : ''} onClick={() => setView(v)}>
                      {v === 'compare' ? 'Side by side' : v === 'form' ? 'Form' : 'Output'}
                    </button>
                  ))}
                </nav>
                <button onClick={download}>Download</button>
                <button className="primary" onClick={save} disabled={(!dirty && !!draft.id && changedCount === 0) || (result ? !result.valid : false)} title={result && !result.valid ? `${result.errors.length} error(s) must be fixed before saving` : ''}>
                  {draft.id ? 'Save' : 'Save to server'}
                </button>
              </div>
            </div>
            {error && <div className="alert error" style={{ marginBottom: 10 }}>{error}</div>}
            {notice && <div className="alert ok" style={{ marginBottom: 10 }}>{notice}</div>}
            {result && !result.valid && (
              <div className="alert error" style={{ marginBottom: 10 }}>
                {result.errors.length} error{result.errors.length === 1 ? '' : 's'} — the document can only be saved once all errors are resolved.
                {result.warnings.length > 0 && ` ${result.warnings.length} warning(s) do not block saving.`}
              </div>
            )}
            {view === 'raw' && <pre className="code">{serializeDocument(pruneBlanks(effective), schema.format)}</pre>}
            {view === 'form' && <DocumentForm root={schema.root} data={effective} violations={violationIndex} computed={computedIndex} readOnly={readOnly} onChange={onChange} onRemove={onRemove} />}
            {view === 'compare' && (
              <>
                <div className="row small" style={{ marginBottom: 8 }}>
                  <span className="muted">Show:</span>
                  {(['all', 'changed', 'errors', ...(computedIndex.size ? (['computed'] as const) : [])] as const).map((f) => (
                    <button key={f} className={cmpFilter === f ? 'active-filter' : ''} onClick={() => setCmpFilter(f)}>
                      {f === 'all' ? 'All fields' : f === 'changed' ? `Changed (${changedCount})` : f === 'computed' ? `Computed (${computedIndex.size})` : `With errors/warnings (${violationIndex.size})`}
                    </button>
                  ))}
                  <span className="grow" />
                  {changedCount > 0 && (
                    <button onClick={() => (setDraft({ ...draft, data: draft.original }), setDirty(false))} title="Discard all edits and go back to the original">
                      Revert all
                    </button>
                  )}
                </div>
                <CompareForm root={schema.root} original={draft.original} data={effective} violations={violationIndex} computed={computedIndex} readOnly={readOnly} collapsedDefault={ruleSet?.display?.collapsed} onChange={onChange} onRemove={onRemove} filter={cmpFilter} />
              </>
            )}
          </div>
        )}
      </div>

      <div>
        <div className="panel">
          <div className="panel-header">
            <h2>Validation</h2>
            {result && (
              <span className={`badge ${result.valid ? 'ok' : 'error'}`}>
                {result.valid ? 'valid' : `${result.errors.length} error${result.errors.length === 1 ? '' : 's'}`}
              </span>
            )}
          </div>
          {!ruleSet && <div className="muted small">Pick a rule set to validate against.</div>}
          {ruleSet && !draft && <div className="muted small">Open a document to see results.</div>}
          {result && result.violations.length === 0 && <div className="alert ok">All {ruleSet!.rules.filter((r) => r.enabled !== false).length} rules pass.</div>}
          {result && result.violations.length > 0 && (
            <div className="violations">
              {result.violations.map((v, i) => (
                <div key={i} className={`violation ${v.severity}`} onClick={() => jumpTo(v.path)}>
                  <div>
                    <span className={`badge ${v.severity}`}>{v.severity}</span> {v.message}
                  </div>
                  <div className="path">
                    {v.path} · {v.ruleName}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        {draft && computedIndex.size > 0 && <ComputedSummary index={computedIndex} data={effective} violations={violationIndex} onJump={jumpTo} />}
      </div>
    </div>
  );
}

/** Right-hand summary of the computed (non-row) fields, grouped as in the rule set: the computation trail from income to refund. */
function ComputedSummary({ index, data, violations, onJump }: { index: ComputedIndex; data: unknown; violations: ViolationIndex; onJump: (p: string) => void }) {
  const groups = new Map<string, { path: string; name: string; value: unknown }[]>();
  for (const [p, c] of index) {
    if (/\[\d+\]/.test(p)) continue; // row-level values are shown in the table itself
    const g = c.group ?? 'Computed';
    groups.set(g, [...(groups.get(g) ?? []), { path: p, name: c.name.replace(/\s*=.*$/, ''), value: getAtPath(data, p) }]);
  }
  const fmt = (v: unknown) => (typeof v === 'number' ? v.toLocaleString('en-IN') : v === undefined || v === null || v === '' ? '—' : String(v));
  return (
    <div className="panel computed-summary" style={{ marginTop: 12 }} data-testid="computed-summary">
      <h2>Computed values</h2>
      <div className="small muted" style={{ marginBottom: 6 }}>Recalculated from the entered values. Click a line to go to the field.</div>
      {[...groups].map(([g, items]) => (
        <details key={g} open={/tax|total income|refund/i.test(g)}>
          <summary>{g}</summary>
          {items.map((it) => (
            <div key={it.path} className={`kv ${violations.get(it.path)?.some((v) => v.severity === 'error') ? 'err' : ''}`} onClick={() => onJump(it.path)} style={{ cursor: 'pointer' }} title={it.path}>
              <span>{it.name}</span>
              <span className="v">{fmt(it.value)}</span>
            </div>
          ))}
        </details>
      ))}
    </div>
  );
}
