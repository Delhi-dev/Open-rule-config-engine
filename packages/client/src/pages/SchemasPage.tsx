import { useEffect, useRef, useState } from 'react';
import type { SchemaDefinition } from '@rule-engine/core';
import { api, type SchemaSummary } from '../api';
import { SchemaTree } from '../components/SchemaTree';

export function SchemasPage() {
  const [schemas, setSchemas] = useState<SchemaSummary[]>([]);
  const [selected, setSelected] = useState<SchemaDefinition | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showSource, setShowSource] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const refresh = () => api.schemas.list().then(setSchemas).catch((e) => setError(e.message));
  useEffect(() => {
    refresh();
  }, []);

  const open = async (id: string) => {
    setError(null);
    try {
      setSelected(await api.schemas.get(id));
      setShowSource(false);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const uploadFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    setError(null);
    try {
      let last: SchemaDefinition | null = null;
      for (const f of Array.from(files)) last = await api.schemas.upload(f);
      await refresh();
      if (last) setSelected(last);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const remove = async (s: SchemaSummary) => {
    if (!confirm(`Delete schema "${s.name}"? Rule sets and documents bound to it will be deleted too.`)) return;
    try {
      await api.schemas.remove(s.id, true);
      if (selected?.id === s.id) setSelected(null);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const rename = async () => {
    if (!selected) return;
    const name = prompt('Schema name', selected.name);
    if (!name?.trim()) return;
    const updated = await api.schemas.rename(selected.id, name);
    setSelected(updated);
    refresh();
  };

  return (
    <div className="layout">
      <div>
        <div className="panel">
          <div className="panel-header">
            <h2>Schemas</h2>
          </div>
          <div
            className="dropzone"
            onClick={() => fileInput.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              uploadFiles(e.dataTransfer.files);
            }}
          >
            {busy ? 'Uploading…' : 'Drop a file or click to upload'}
            <div className="small" style={{ marginTop: 4 }}>JSON sample · JSON Schema · XML sample · XSD</div>
            <input ref={fileInput} type="file" multiple hidden accept=".json,.xml,.xsd" onChange={(e) => uploadFiles(e.target.files)} />
          </div>
          {error && <div className="alert error" style={{ marginTop: 10 }}>{error}</div>}
          <ul className="list" style={{ marginTop: 10 }}>
            {schemas.map((s) => (
              <li key={s.id} className={selected?.id === s.id ? 'active' : ''} onClick={() => open(s.id)}>
                <span className={`badge ${s.format}`}>{s.format}</span>
                <span className="title grow">{s.name}</span>
                <button
                  className="ghost danger"
                  title="Delete"
                  onClick={(e) => {
                    e.stopPropagation();
                    remove(s);
                  }}
                >
                  ✕
                </button>
              </li>
            ))}
            {schemas.length === 0 && <li className="muted small">No schemas yet — upload one above.</li>}
          </ul>
        </div>
      </div>
      <div>
        {selected ? (
          <div className="panel">
            <div className="panel-header">
              <div>
                <h2>{selected.name}</h2>
                <div className="small muted">
                  <span className={`badge ${selected.format}`}>{selected.format}</span> from {sourceLabel(selected.source)} ·
                  updated {new Date(selected.updatedAt).toLocaleString()}
                </div>
              </div>
              <div className="row">
                <button onClick={() => setShowSource((v) => !v)}>{showSource ? 'Show tree' : 'Show source'}</button>
                <button onClick={rename}>Rename</button>
              </div>
            </div>
            {showSource ? (
              <pre className="code">{selected.sourceText}</pre>
            ) : (
              <>
                <p className="small muted">
                  Element paths below are what rules target. <code>name[]</code> marks a repeated element; <code>*</code> is
                  required in the source schema; <code>{'{a|b}'}</code> lists allowed values.
                </p>
                <SchemaTree root={selected.root} />
              </>
            )}
          </div>
        ) : (
          <div className="panel empty">Select a schema to inspect its structure, or upload a new one.</div>
        )}
      </div>
    </div>
  );
}

export function sourceLabel(source: SchemaDefinition['source']): string {
  return { 'json-sample': 'JSON sample', 'json-schema': 'JSON Schema', 'xml-sample': 'XML sample', xsd: 'XSD' }[source];
}
