import { useState } from 'react';
import { SchemasPage } from './pages/SchemasPage';
import { RuleSetsPage } from './pages/RuleSetsPage';
import { DocumentsPage } from './pages/DocumentsPage';

type Page = 'schemas' | 'rulesets' | 'documents';

const PAGES: { id: Page; label: string }[] = [
  { id: 'schemas', label: '1. Schemas' },
  { id: 'rulesets', label: '2. Rule sets' },
  { id: 'documents', label: '3. Documents' },
];

export function App() {
  const [page, setPage] = useState<Page>('schemas');
  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">Rule Engine</span>
        <nav>
          {PAGES.map((p) => (
            <button key={p.id} className={page === p.id ? 'active' : ''} onClick={() => setPage(p.id)}>
              {p.label}
            </button>
          ))}
        </nav>
      </header>
      <main className="content">
        {page === 'schemas' && <SchemasPage />}
        {page === 'rulesets' && <RuleSetsPage key="rs" />}
        {page === 'documents' && <DocumentsPage key="docs" />}
      </main>
    </div>
  );
}
