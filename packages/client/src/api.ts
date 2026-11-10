import type { DocFormat, RuleSet, SchemaDefinition, StoredDocument, ValidationResult, Rule, Computation, DisplaySettings } from '@rule-engine/core';

export interface SchemaSummary {
  id: string;
  name: string;
  format: DocFormat;
  source: SchemaDefinition['source'];
  createdAt: string;
  updatedAt: string;
}

export interface DocumentSummary {
  id: string;
  name: string;
  schemaId: string;
  ruleSetId?: string;
  format: DocFormat;
  createdAt: string;
  updatedAt: string;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `${res.status} ${res.statusText}`);
  return body as T;
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

export const api = {
  schemas: {
    list: () => request<SchemaSummary[]>('/api/schemas'),
    get: (id: string) => request<SchemaDefinition>(`/api/schemas/${id}`),
    upload: (file: File, name?: string) => {
      const fd = new FormData();
      fd.append('file', file);
      if (name) fd.append('name', name);
      return request<SchemaDefinition>('/api/schemas', { method: 'POST', body: fd });
    },
    rename: (id: string, name: string) => request<SchemaDefinition>(`/api/schemas/${id}`, json('PATCH', { name })),
    remove: (id: string, force = false) => request<void>(`/api/schemas/${id}${force ? '?force=true' : ''}`, { method: 'DELETE' }),
    emptyDocument: (id: string) => request<{ format: DocFormat; data: unknown }>(`/api/schemas/${id}/empty-document`),
  },
  ruleSets: {
    list: (schemaId?: string) => request<RuleSet[]>(`/api/rulesets${schemaId ? `?schemaId=${schemaId}` : ''}`),
    get: (id: string) => request<RuleSet>(`/api/rulesets/${id}`),
    create: (body: { name: string; description?: string; schemaId: string; rules: Rule[]; computations?: Computation[]; display?: DisplaySettings | null }) =>
      request<RuleSet>('/api/rulesets', json('POST', body)),
    update: (id: string, body: { name?: string; description?: string; rules?: Rule[]; computations?: Computation[]; display?: DisplaySettings | null }) =>
      request<RuleSet>(`/api/rulesets/${id}`, json('PUT', body)),
    remove: (id: string) => request<void>(`/api/rulesets/${id}`, { method: 'DELETE' }),
    exportUrl: (id: string) => `/api/rulesets/${id}/export`,
  },
  documents: {
    list: (schemaId?: string) => request<DocumentSummary[]>(`/api/documents${schemaId ? `?schemaId=${schemaId}` : ''}`),
    get: (id: string) => request<StoredDocument>(`/api/documents/${id}`),
    parse: (file: File, schemaId: string) => {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('schemaId', schemaId);
      return request<{ name: string; format: DocFormat; data: unknown }>('/api/documents/parse', { method: 'POST', body: fd });
    },
    save: (body: { id?: string; name: string; schemaId: string; ruleSetId?: string; data: unknown }) =>
      request<StoredDocument>('/api/documents', json('POST', body)),
    remove: (id: string) => request<void>(`/api/documents/${id}`, { method: 'DELETE' }),
    exportUrl: (id: string) => `/api/documents/${id}/export`,
  },
  validate: (data: unknown, ruleSetId: string) => request<ValidationResult & { data: unknown; computedFields: string[] }>('/api/validate', json('POST', { data, ruleSetId })),
};
