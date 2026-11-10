# Rule Engine — Technical Design & Build Plan

Oct 30, 2026 · @Nisheeth

This document specifies the Computation-Processing rule engine — schema upload, rule sets, computed fields and a side-by-side document editor, with ITR-1 AY 2024-25 as the worked example — in enough detail for a code-generation LLM to build it unaided, in nine milestones gated by embedded test suites and four review checkpoints.

## 1. How to use this document

Two parties execute this document. The **Builder** is a code-generation LLM: it writes all code, strictly one milestone at a time, in order (M0 → M8; M9 is optional). The **Reviewer** is a supervising assistant that holds the reference implementation: at each of four checkpoints it receives the codebase, runs the gate commands, inspects the code, and either replies `CHECKPOINT <X>: PROCEED` or publishes a numbered addendum in §20. The Builder must not continue past a checkpoint until one of those two arrives.

**Rules of engagement for the Builder**

1. Everything named in this document is normative: file paths, package names, exported function names and signatures, TypeScript interfaces, REST routes, JSON shapes, CSS class names used by tests. Do not rename, reorganise or “improve” them.
2. Each milestone ends with a test suite printed in this document. Copy test files **verbatim** into the repository and run them. Tests and oracle data are never edited to make them pass — fix the implementation instead. If you are convinced a test itself is wrong, stop work on that test, record the case in `QUESTIONS.md` (test name, your reasoning, the output you get), and raise it at the next checkpoint; the Reviewer settles it by addendum.
3. A milestone is done only when: `npx tsc --noEmit` is clean in every package touched, all test suites from this and every earlier milestone pass, and no stubbed (`TODO`, `throw new Error('not implemented')`) code remains in files the milestone specifies.
4. Where this document is silent, choose the simplest behaviour consistent with the tests, and log every such choice in `DECISIONS.md` (one line each: what was unspecified, what you chose). The Reviewer reads this file at every checkpoint.
5. Use only the dependencies listed in §3. Do not add packages, build tools, linters or frameworks beyond them.
6. Addenda in §20 override the base text of the sections they name. Before starting any milestone, re-read §20 and apply all addenda that touch it.

**Checkpoint procedure** (applies at Checkpoints A, B, C, D — placed after M2, M4, M6, M8)

1. Stop coding. Produce `CHECKPOINT-<X>.md` in the repository root containing: (a) the exact commands you ran and their complete verbatim output for every test suite due so far; (b) a file listing (`ls -R` or equivalent, excluding `node_modules` and `dist`); (c) the current contents of `DECISIONS.md` and `QUESTIONS.md`; (d) any deviations from this document, however small.
2. Package the repository as a zip **excluding** `node_modules`, `dist` and `.git`, and hand it, with `CHECKPOINT-<X>.md`, to the human operator, who passes it to the Reviewer.
3. Resume only on `CHECKPOINT <X>: PROCEED`. If an addendum arrives instead, apply it (it may require rework of earlier milestones), re-run all tests, and re-submit the same checkpoint.

**What the Reviewer does** at each checkpoint is spelled out in a box at the end of the milestone that precedes it: the commands it will run (which must pass exactly as printed) and the code passages it will read. The Reviewer also diffs behaviour against the reference implementation on the oracle data of §13–§18, so matching the printed expected outputs, not merely “tests green”, is the bar.

**Running the Builder on a small local model (8–12B class — e.g. Mellum 2.1 12B-A2.5B, a 9B Qwen-class model).** This document is written so a modest code-generation model can execute it; the rules below keep the work inside such a model's limits. They bind the human operator as much as the Builder, and apply whenever the Builder runs on roughly 16 GB of memory or under \~15B parameters.

1. **Context discipline.** Never load this whole document into the model. Per milestone, supply only: this §1, the current milestone's section, and any §20 addenda that name it. Keep the model's runtime context at or under 32K tokens — on a 16 GB machine the KV cache, not the weights, is what runs out.
2. **Appendices are data, not reading material.** The Appendix A table and the Appendix B/C/D payloads must never pass through the model's context: the operator copies them into the repository as files (§13.2, payload pack). A small model retyping long JSON will corrupt it silently.
3. **One file per prompt.** Ask the Builder for exactly one named file at a time, in the order the milestone lists them. Run `npx tsc --noEmit` after each file; run the milestone's test gate after the last.
4. **Thinking models** emit reasoning (e.g. `<think>…</think>`) before the answer. The operator's harness must discard everything before the final fenced code block; reasoning must never end up inside a source file.
5. **Failure loop.** When a gate fails, re-prompt with only the failing test's name, its verbatim output, and the spec paragraph it tests — not the whole milestone. After two consecutive failures on the same test, stop: record it in `QUESTIONS.md` and either continue with an independent file or submit the checkpoint early for an addendum.
6. **Expectation setting.** M1–M6 are pure, exactly-specified functions and suit this model class well. M7 (client UI) is the hardest milestone at this size: build one component per prompt against the §12 contract, and treat addenda at Checkpoint D as the process working, not failing.

## 2. Product overview

The application validates and auto-computes structured documents (tax returns, or any JSON/XML form) against configurable rule sets. A user uploads a **schema** (for ITR-1, the Income Tax Department's official JSON Schema), builds or imports a **rule set** bound to that schema, then opens, edits and saves **documents** against the schema + rule set pair. It is a web application: an Express JSON API with file storage, and a React single-page client served beside it.

The client has three pages:

1. **Schemas** — upload a schema file; the server parses it into a uniform field tree (path, type, required, enum, description per node) that the other pages consume.
2. **Rule sets** — per schema, manage three things: **validation rules** (each: target path, check, optional condition, severity error/warning); **computed fields** (each: target path, formula, optional condition — fields the user never types, recalculated from entered values); **display settings** (blocks shown read-only, blocks collapsed on open). Rule sets import/export as portable JSON.
3. **Documents** — pick schema and rule set, then create a blank document from the schema, upload one, or open a saved one. The main view is **side-by-side**: every field as a row — label | original value (read-only) | editable copy. On every keystroke the client recomputes all computed fields, then validates; violations appear under the offending field and in a panel listing all of them. **Save is disabled while any error-severity violation exists**, so only a correct document can be stored. Computed fields render as read-only values badged “ƒ computed” (formula on hover); display-setting blocks render read-only and start collapsed; filters show all / changed / with-errors / computed rows; a left-pane toggle widens the editor.

**Glossary** (used throughout; the Builder should keep these meanings exactly)

| Term | Meaning |
| --- | --- |
| path | Dot + index address of a value, e.g. `ITR.ITR1.TaxPaid.TaxesPaid.TDS`, `items[2].amount` |
| template path | Path with `[*]` for every index, e.g. `items[*].amount`; names a column across rows |
| schema node | One node of the uniform field tree: `name`, `path`, `type`, `children`, `required`, `enum`, `description` |
| rule | Named check on a target path, optionally guarded by a condition; severity `error` or `warning` |
| check | The predicate kind: required, type, min, max, minLength, maxLength, pattern, enum, compare, empty, unique, assert |
| condition | Boolean guard: leaf comparison, `all`/`any`/`not` combinators, or a free-form boolean expression |
| computation | `target` + `expression` (+ optional `condition`): the engine writes the evaluated expression into the target; such fields are read-only in the editor |
| display settings | `readOnly: string[]`, `collapsed: string[]` — template paths of blocks the editor locks or collapses |
| rule set | `{ id, name, schemaId, rules[], computations[], display? }` — bound to exactly one schema |
| violation | One failed rule instance: ruleId, concrete path, message, severity |
| blank | `undefined`, `null`, `''`, empty array, object with no keys — see the blank-semantics table in §7 |
| oracle | A document plus the exact numbers/violations the engine must produce for it (§13, §18) |

## 3. Architecture and repository layout

An npm-workspaces monorepo of three packages. All engine logic lives in `@rule-engine/core`, a dependency-light TypeScript library that runs identically in Node and the browser; the server and the client both import it, so validation and computation behave the same on either side. The server adds persistence and HTTP; the client adds React UI. Rule-set *content* (the ITR-1 data of §13) is data under `rulesets/`, not code.

```
rule-engine/
├─ package.json              # workspaces root (scripts: build, test, dev, start, test:e2e)
├─ packages/
│  ├─ core/                  # @rule-engine/core — pure engine library (ESM, type: module)
│  │  ├─ src/types.ts        # every shared interface (§6)
│  │  ├─ src/path.ts         # path parse/resolve/get/set/delete (§6)
│  │  ├─ src/expression.ts   # expression language (§7)
│  │  ├─ src/rules.ts        # checks, conditions, validateDocument (§8)
│  │  ├─ src/compute.ts      # computed fields (§9)
│  │  ├─ src/document.ts     # blank/prune/empty-doc/coerce/parse/serialize (§10)
│  │  ├─ src/schema.ts       # schema building + flatten/find (§10)
│  │  ├─ src/index.ts        # re-exports: export * from each module
│  │  └─ src/*.test.ts       # vitest suites T1–T5 (copied verbatim from this document)
│  ├─ server/                # @rule-engine/server — Express API (§11)
│  │  └─ src/index.ts, src/storage.ts
│  └─ client/                # @rule-engine/client — React + Vite SPA (§12)
│     ├─ index.html, vite.config.ts
│     ├─ src/main.tsx, src/App.tsx, src/api.ts, src/styles.css
│     ├─ src/pages/{SchemasPage,RuleSetsPage,DocumentsPage}.tsx
│     └─ src/components/{SchemaTree,RuleEditor,DocumentForm,CompareForm}.tsx
├─ rulesets/
│  ├─ itr1-ay2024-25/        # starter data (§13, §15–§18): schema copy, ruleset JSON, sample, install script
│  └─ test/                  # oracle test scripts (plain node, no framework)
└─ server-tests/             # T6 HTTP smoke script
```

**Tech stack (exact; do not substitute)**

| Where | Dependency | Version |
| --- | --- | --- |
| root devDependencies | typescript | ^5.6.3 |
| root devDependencies | concurrently | ^9.1.2 |
| core dependencies | fast-xml-parser (only used by optional M9; still install it) | ^4.5.1 |
| core devDependencies | vitest | ^2.1.8 |
| server dependencies | express ^4.21.2 · cors ^2.8.5 · multer ^1.4.5-lts.1 · nanoid ^5.0.9 · @rule-engine/core 0.1.0 | — |
| server devDependencies | tsx ^4.19.2 · @types/express ^4.17.21 · @types/cors ^2.8.17 · @types/multer ^1.4.12 · @types/node ^22.10.2 | — |
| client dependencies | react ^18.3.1 · react-dom ^18.3.1 · @rule-engine/core 0.1.0 | — |
| client devDependencies | vite ^5.4.11 · @vitejs/plugin-react ^4.3.4 · @types/react ^18.3.12 · @types/react-dom ^18.3.1 | — |

Node ≥ 20 is assumed. Every package is ESM (`"type": "module"`). Core's tsconfig: target ES2022, module ESNext, moduleResolution Bundler, strict true, declaration true, outDir `dist`, rootDir `src`, lib ES2022 + DOM, test files excluded from the build. Core modules import each other with explicit `.js` extensions (`from './path.js'`) so the compiled output resolves under Node ESM. The client dev server is Vite on port 5173 proxying `/api` to `http://localhost:4000`; the server listens on `PORT` (default 4000), serves JSON bodies up to 50 MB, and in production serves `packages/client/dist` statically with an SPA fallback.

**Data flow**: client edits document → `computeDocument(data, ruleSet.computations)` → `validateDocument(computedData, ruleSet.rules)` → render violations; Save POSTs the computed, blank-pruned data; the server recomputes with the same functions before storing (the server is authoritative). Storage is one JSON file per record under `DATA_DIR` (default `<server pkg>/data`): `schemas/`, `rulesets/`, `documents/`.

## 4. Milestone plan and checkpoint map

Build strictly in this order; each milestone depends on everything above it. “Gate” names the test suite that must pass (cumulatively — at M6, suites T1–T6 all run) before the milestone is called done.

| # | Milestone | Deliverable | Gate | Checkpoint after |
| --- | --- | --- | --- | --- |
| M0 | Scaffold | Workspace root, three packages, configs; everything builds empty | `npm install` + `npm run build` clean | — |
| M1 | Types + paths | `types.ts`, `path.ts` | T1 (`vitest`) | — |
| M2 | Expression language | `expression.ts` | T2 | **A** |
| M3 | Rules + validation | `rules.ts` | T3 | — |
| M4 | Computed fields | `compute.ts` | T4 | **B** |
| M5 | Documents + schemas | `document.ts`, `schema.ts` | T5 | — |
| M6 | REST server | `server/src/*` | T6 (HTTP smoke) | **C** |
| M7 | Client UI | `client/src/*` | manual run + §19 checklist items 1–6 | — |
| M8 | ITR-1 starter data | `rulesets/itr1-ay2024-25/*` | T8 (oracle + mutations) + full §19 checklist | **D** |
| M9 | Optional extras | XML/XSD schemas, XML documents | T9 (inside §14) | — |

Two standing habits: after every milestone, re-run all earlier gates (regressions are cheapest caught at once), and keep `DECISIONS.md` / `QUESTIONS.md` current — the checkpoints read them.

## 5. M0 — Scaffold

Create the tree of §3 with empty-but-compiling sources.

1. Root `package.json`: name `rule-engine`, private, version 0.1.0, `workspaces: ["packages/core", "packages/server", "packages/client"]`, scripts exactly:

```json
{
  "build": "npm run build -w @rule-engine/core && npm run build -w @rule-engine/server && npm run build -w @rule-engine/client",
  "test": "npm run test -w @rule-engine/core && node rulesets/test/run-all.mjs",
  "dev": "concurrently -n server,client -c blue,green \"npm run dev -w @rule-engine/server\" \"npm run dev -w @rule-engine/client\"",
  "start": "npm run start -w @rule-engine/server",
  "prepare": "npm run build -w @rule-engine/core",
  "test:e2e": "node packages/client/e2e/compare.e2e.mjs"
}
```

(`rulesets/test/run-all.mjs` does not exist until M8 — create it now as a stub that prints `no rule sets yet` and exits 0, so `npm test` works from M1.)

2. `packages/core`: package.json per §3 (`main`/`types`/`exports` → `./dist/index.js` + `.d.ts`, scripts `build: tsc -p tsconfig.json`, `test: vitest run`, `dev: tsc --watch`); tsconfig per §3; `src/index.ts` containing a placeholder `export {};` for now.
3. `packages/server`: package.json per §3 (scripts `build: tsc -p tsconfig.json`, `dev: tsx watch src/index.ts`, `start: node dist/index.js`); same tsconfig shape (lib ES2022 only, no DOM); `src/index.ts` that starts Express on `process.env.PORT ?? 4000` and answers `GET /api/health` with `{ ok: true }`.
4. `packages/client`: package.json, `vite.config.ts` (react plugin; dev port 5173; proxy `'/api' → 'http://localhost:4000'`; `build.outDir: 'dist'`), `index.html` with `<div id="root">` + module script `/src/main.tsx`, `src/main.tsx` rendering `<App/>`, `src/App.tsx` rendering a top bar with the app name and three page buttons labelled exactly `1. Schemas`, `2. Rule sets`, `3. Documents` (the e2e tests click them by these labels), and empty page stubs. Client tsconfig: `noEmit: true`, `jsx: react-jsx`, strict, moduleResolution Bundler (its build script runs `tsc -p` for type-checking only, then `vite build`).

**Gate M0**: `npm install` then `npm run build` completes with no errors; `node packages/server/dist/index.js` starts and `curl localhost:4000/api/health` returns `{"ok":true}`.

## 6. M1 — Core types and the path module

**Files**: `packages/core/src/types.ts`, `packages/core/src/path.ts`; re-export both from `src/index.ts` (`export * from './types.js'; export * from './path.js';`).

### 6.1 types.ts — copy these interfaces exactly

```ts
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
```

### 6.2 path.ts — behaviour specification

Exports: `Segment`, `Bindings`, `PathMatch`, `parsePath`, `formatPath`, `normalizePath`, `pathWithBindings`, `resolvePath`, `getAtPath`, `setAtPath`, `deleteAtPath`, `toTemplatePath`.

```ts
export type Segment = { key: string } | { index: number | '*' };
export type Bindings = Record<string, number>;      // array path → chosen index, e.g. { 'order.items': 2 }
export interface PathMatch { path: string; value: unknown; exists: boolean; bindings: Bindings }
```

- `parsePath('a.b[2].c')` → segments via the regex `/([^.\[\]]+)|\[(\*|\d+)\]/g` applied to the trimmed path — note a key may contain any character except `.` `[` `]` (so `PartB-ATI` and `@_id` are single keys). `formatPath` joins keys with `.` and indices as `[n]`; `normalizePath = formatPath ∘ parsePath`. `toTemplatePath` replaces every `{index}` segment (numeric or `*`) with `{index: '*'}`.
- `resolvePath(data, path, bindings = {})` walks the segments and returns **every** match:
  1. Key segment: if the current value is a plain object owning the key → descend with `exists` unchanged; otherwise descend with `value = undefined, exists = false` (the walk continues so a missing leaf still yields one non-existing match).
  2. Index segment: the current value is coerced to an array (`undefined`/`null` → `[]`; a non-array scalar → `[value]`). A numeric index past the end → one match with `exists = false`.
  3. `[*]` segment: let `arrayPath` = the concrete path built so far. If `bindings[arrayPath]` exists, take exactly that index (out of range → `exists = false`); otherwise fan out to one walk per element, adding `{[arrayPath]: i}` to that walk's bindings. **A missing or empty array fans out to nothing** — per-row paths simply have no matches. Each result carries the concrete `path` (indices substituted) and the accumulated `bindings`.
- `getAtPath` = first match's value. `setAtPath` is **immutable**: copies only the spine it walks (untouched branches keep identity — T1 asserts this), creates missing objects/arrays on the way (array padded with `undefined`, or `{}` when the next segment is a key); a `[*]` segment writes index 0. `deleteAtPath` removes an object key or splices an array element, also immutably. `pathWithBindings(path, bindings)` substitutes each `[*]` with its bound index (unbound → 0).

### 6.3 Test suite T1

Save as `packages/core/src/t1-path.test.ts`; run `npx vitest run src/t1-path.test.ts` inside `packages/core`. Expected: **7 tests, all passing**.

```ts
// T1 — path module (M1). Copy verbatim to packages/core/src/t1-path.test.ts
import { describe, expect, it } from 'vitest';
import { parsePath, formatPath, normalizePath, resolvePath, getAtPath, setAtPath, deleteAtPath, toTemplatePath } from './index.js';

const doc = {
  order: {
    customer: { name: 'Asha' },
    'PartB-ATI': { x: 5 },
    items: [
      { sku: 'A', qty: 2, price: 5 },
      { sku: 'B', qty: 3 },
      { sku: 'A', qty: 1, price: 2 },
    ],
  },
};

describe('T1 path', () => {
  it('parses and formats paths, keeping hyphens and indices', () => {
    expect(formatPath(parsePath('a.b[2].c'))).toBe('a.b[2].c');
    expect(normalizePath(' order.items[*].qty ')).toBe('order.items[*].qty');
    expect(formatPath(parsePath('order.PartB-ATI.x'))).toBe('order.PartB-ATI.x');
  });

  it('resolves wildcards to one match per row with bindings keyed by the array path', () => {
    const m = resolvePath(doc, 'order.items[*].qty');
    expect(m.map((x) => x.value)).toEqual([2, 3, 1]);
    expect(m.map((x) => x.path)).toEqual(['order.items[0].qty', 'order.items[1].qty', 'order.items[2].qty']);
    expect(m[1].bindings).toEqual({ 'order.items': 1 });
  });

  it('pins a wildcard with a binding so a second path lines up with the same row', () => {
    const m = resolvePath(doc, 'order.items[*].price', { 'order.items': 1 });
    expect(m.length).toBe(1);
    expect(m[0].path).toBe('order.items[1].price');
    expect(m[0].exists).toBe(false); // row 1 has no price key
    expect(m[0].value).toBeUndefined();
  });

  it('a missing or empty array yields no matches for per-item paths', () => {
    expect(resolvePath(doc, 'order.lines[*].amount')).toEqual([]);
    expect(resolvePath({ order: { lines: [] } }, 'order.lines[*].amount')).toEqual([]);
  });

  it('a missing key resolves to a single non-existing match', () => {
    const m = resolvePath(doc, 'order.customer.phone');
    expect(m.length).toBe(1);
    expect(m[0].exists).toBe(false);
  });

  it('getAtPath / setAtPath / deleteAtPath are immutable and create containers on the way', () => {
    expect(getAtPath(doc, 'order.PartB-ATI.x')).toBe(5);
    const next = setAtPath(doc, 'order.meta.tags[1]', 'new');
    expect(getAtPath(next, 'order.meta.tags[1]')).toBe('new');
    expect((doc.order as Record<string, unknown>).meta).toBeUndefined(); // original untouched
    expect(next.order.items).toBe(doc.order.items); // untouched branches are shared
    const fewer = deleteAtPath(doc, 'order.items[1]');
    expect(resolvePath(fewer, 'order.items[*].sku').map((m) => m.value)).toEqual(['A', 'A']);
    expect(doc.order.items.length).toBe(3);
  });

  it('toTemplatePath replaces every index with [*]', () => {
    expect(toTemplatePath('a.items[2].b[0].c')).toBe('a.items[*].b[*].c');
  });
});
```

**If T1 fails**: the three usual causes are treating a hyphen as a separator (it is part of the key), creating matches for rows of a missing array (there must be none), and `setAtPath` mutating its input. Fix the implementation until the suite passes unmodified.

## 7. M2 — Expression language · Checkpoint A

**File**: `packages/core/src/expression.ts` (re-export from index). This language is used by rule operands, assertions, conditions and every computed field; a mistake here poisons everything downstream, which is why Checkpoint A sits right after it.

Exports: `Expr`, `Value`, `parseExpression`, `compileExpression` (memoised parse via a `Map` cache), `isBlankValue`, `looseEquals`, `compareValues`, `EXPRESSION_FUNCTIONS` (sorted list of all function names), `EvalContext`, `evaluate`, `evaluateExpression`, `evaluateBoolean`, `checkExpression`, `expressionPaths`.

```ts
export type Value = number | string | boolean | null | Value[];
export type Expr =
  | { k: 'num'; v: number } | { k: 'str'; v: string } | { k: 'bool'; v: boolean } | { k: 'null' }
  | { k: 'path'; path: string }
  | { k: 'bin'; op: string; l: Expr; r: Expr }
  | { k: 'neg'; e: Expr } | { k: 'not'; e: Expr }
  | { k: 'call'; fn: string; args: Expr[] };
export interface EvalContext { data: unknown; bindings: Bindings; now?: Date }
```

### 7.1 Tokenizer — exact rules

| Input | Token |
| --- | --- |
| whitespace | skipped |
| digit, or `.` followed by a digit | number: `[0-9.]*` then optional exponent `[eE][0-9+-]` + digits |
| `"…"` or `'…'` | string; `\x` inside takes `x` literally; unterminated → throw |
| first char `[A-Za-z_@$#]` | identifier: continue while char matches `[A-Za-z0-9_@#:\-\.\[\]\*]`, **but a `-` is taken only when the next char matches `[A-Za-z0-9_]`** — this makes `a-b` ONE identifier while `a - b` and `a -b` are subtractions. Consequence for all rule authors: **subtraction requires spaces**; hyphenated keys like `PartB-ATI.x` are single path tokens |
| `==` `!=` `<=` `>=` `&&` `\|\|` `<>` | two-char operator; `<>` becomes `!=` |
| `+ - * / % < > !` and `=` | one-char operator; bare `=` becomes `==` |
| `(` `)` `,` | punctuation |
| anything else | throw `Unexpected character` |

### 7.2 Grammar (recursive descent, loosest to tightest)

`or` (word `or` or `\|\|`) ← `and` (word `and` or `&&`) ← equality `== !=` ← comparison `< <= > >=` ← additive `+ -` ← multiplicative `* / %` ← unary ← primary. Word operators are case-insensitive. Unary: leading `-` → `neg`, leading `+` ignored, `!` or word `not` → `not`. Primary: number, string, parenthesised expression, identifier. An identifier is: the keyword `true`/`false`/`null` (when not followed by `(`); a **function call** when followed by `(` (name lowercased, comma-separated args); otherwise a **path** literal. Trailing tokens after a complete expression → throw.

### 7.3 Values and coercion

- `isBlankValue(v)`: `undefined`, `null`, whitespace-only string, empty array, object with no keys.
- `toNumber`: number (NaN→null) · boolean→1/0 · numeric string · else null. `toDate`: ISO `YYYY-MM-DD[THH:MM…]` (date-only parsed as UTC midnight) or `DD/MM/YYYY` / `DD-MM-YYYY` → epoch ms, else null.
- `truthy`: null→false; array→length>0; string→ trimmed non-empty and not `'false'`/`'0'`; else Boolean.
- `looseEquals(a,b)`: blank==blank is true, blank==non-blank false; then numeric if both coerce, then date if both coerce, else `String(a)===String(b)`.
- `compareValues(a,b)` → -1/0/1, or **null** when either side is blank or an array (ordering is then meaningless); numeric, then date, then string comparison.

### 7.4 Evaluation — `evaluate(src, {data, bindings, now})`

**Path node**: `resolvePath(data, path, bindings)`. No matches → `null`. Exactly one match **and** no unbound wildcard in the path → that value (`null` if `exists` is false), with objects mapped to `'object'` if non-empty else null. Otherwise → the list of existing values. (An unbound `[*]` therefore yields a list; a wildcard bound through `bindings` reads the same row.)

**Binary nodes**: `and`/`or` evaluate both sides as truthy (short-circuit allowed). For `== != < <= > >=`: first, **if one side is blank and the other is a number, the blank side becomes 0** (optional amounts behave like 0 on the paper form); then `==`/`!=` use `looseEquals`, the orderings use `compareValues` with null → `false`. For `+ - * / %`: each side → `toNumber` (arrays → null) → `?? 0`; division or modulo by zero → `null`.

**Functions** (name sets: AGGREGATES `sum count min max avg unique first`; CONDITIONAL `sumif countif anyif allif`; SCALAR the rest):

| Function | Behaviour |
| --- | --- |
| `sum(p)` · `count(p)` · `min/max/avg(p)` · `unique(p)` · `first(p)` | With a single path argument: iterate the rows of the (first unbound) wildcard — outer bindings stay in force. With several/non-path args: flatten the evaluated args. Blanks are dropped first. `count` = number of present values; `first` = first or null; `unique` = number of distinct values under `looseEquals`. The rest use the numeric values only: `sum` of none → **0**; `min`/`max`/`avg` of none → **null** |
| `sumif(p, cond)` · `countif(p, cond)` · `anyif(p, cond)` · `allif(p, cond)` | Resolve `p` row by row; for each row evaluate `cond` with that row's bindings merged over the outer ones; keep rows where truthy. sumif = sum of kept numerics; countif = kept count; anyif = kept > 0; allif = kept count equals total row count |
| `abs(n)` `floor(n)` `ceil(n)` | null in → null out |
| `round(n, d?)` | `Math.round(n·10^d)/10^d`, d defaults 0 (note `Math.round(2.5)=3`) |
| `if(c, a, b)` | truthy(c) ? a : b (b omitted → null) |
| `nvl(…)` / `coalesce(…)` | first non-blank argument, else null |
| `exists(path)` | true when any resolved match exists with a non-blank value (argument must be a path — enforced by checkExpression) |
| `isblank(v)` | isBlankValue |
| `len(v)` | array length, else string length |
| `lower/upper/trim/str(v)` | string ops; null → `''` |
| `num(v)` | toNumber |
| `left(s,k)` / `right(s,k)` | slice; `right(s,0)` → `''` |
| `contains/startswith/endswith(s,t)` | string tests |
| `matches(s, re, flags?)` | RegExp test; invalid regex → false |
| `in(v, a, b, …)` | true if any argument looseEquals v; an array argument matches if any element does |
| `date(v)` | toDate → `YYYY-MM-DD` string, else null |
| `today()` | `(now ?? new Date())` as `YYYY-MM-DD` |
| `year/month/day(v)` | UTC parts (month 1-12) |
| `days_between(a,b)` | `Math.round((b−a)/86400000)` |
| `months_between(a,b)` | calendar-month difference, minus 1 when day(b) < day(a) |
| `years_between(a,b)` | `Math.trunc(months/12)` |
| anything else | throw `Unknown function` |

### 7.5 Public wrappers — contracts the rest of the system relies on

- `evaluateExpression(src, data, bindings): Value | undefined` — evaluate; **a list result collapses to the sum of its numeric members** (so a bare `items[*].amount` means the total), an empty numeric list → `undefined`; `null` → `undefined`.
- `evaluateBoolean(src, data, bindings)` — truthy(evaluate).
- `checkExpression(src)` — parse and walk without data; throws on: unknown function name, a CONDITIONAL call with fewer than 2 args or a non-path first arg, `exists()` without exactly one path arg, or any syntax error. (Used to reject bad rule sets at the API boundary.)
- `expressionPaths(src)` — every `path` node in source order; `[]` if the source does not parse.

### 7.6 Blank-semantics table (memorise; T2 asserts each line)

| Situation | Result |
| --- | --- |
| blank in `+ - * / %` | treated as 0 |
| `x / 0`, `x % 0` | null (→ `undefined` from evaluateExpression) |
| blank vs number in any comparison | blank side becomes 0 first |
| blank `==` blank (`missing == ""`) | true |
| `compareValues` with a blank or array side | null → ordering comparisons are false |
| `sum` over a missing/empty array | 0 |
| `min`/`max`/`avg` over none | null |
| aggregates | drop blank members before counting |

### 7.7 Test suite T2

Save as `packages/core/src/t2-expression.test.ts`; run `npx vitest run src/t2-expression.test.ts`. Expected: **12 tests, all passing**. (File printed in Appendix D would crowd this section — it is short enough to sit here.)

```ts
// T2 — expression language (M2). Copy verbatim to packages/core/src/t2-expression.test.ts
import { describe, expect, it } from 'vitest';
import { evaluateExpression, evaluateBoolean, checkExpression, expressionPaths } from './index.js';

const ev = (e: string, data: unknown = {}, b: Record<string, number> = {}) => evaluateExpression(e, data, b);
const evb = (e: string, data: unknown = {}, b: Record<string, number> = {}) => evaluateBoolean(e, data, b);

const doc = {
  a: 5,
  s: ' Hi ',
  'PartB-ATI': { x: 5 },
  rows: [
    { amt: 100, type: 'CG' },
    { amt: 50, type: 'OS' },
    { amt: 25, type: 'CG' },
  ],
  items: [
    { qty: 2, price: 5 },
    { qty: 3, price: 10 },
  ],
  d1: '2024-03-31',
  d2: '15/06/2024',
};

describe('T2 expressions', () => {
  it('arithmetic, precedence, modulo, unary minus', () => {
    expect(ev('2 + 3 * 4')).toBe(14);
    expect(ev('(2 + 3) * 4')).toBe(20);
    expect(ev('7 % 3')).toBe(1);
    expect(ev('-a + 1', doc)).toBe(-4);
  });

  it('blank counts as 0 in arithmetic; division by zero is blank', () => {
    expect(ev('a + missing', doc)).toBe(5);
    expect(ev('a / 0', doc)).toBeUndefined(); // null collapses to undefined
  });

  it('hyphen is an identifier character: subtraction needs spaces', () => {
    expect(ev('PartB-ATI.x + 1', doc)).toBe(6);
    expect(expressionPaths('a - b')).toEqual(['a', 'b']);
    expect(expressionPaths('a-b')).toEqual(['a-b']); // ONE path, not a subtraction
  });

  it('comparisons: blank side of a numeric comparison counts as 0; loose equality', () => {
    expect(evb('missing >= 0', doc)).toBe(true);
    expect(evb('missing > 0', doc)).toBe(false);
    expect(evb('"5" == 5')).toBe(true);
    expect(evb('missing == ""', doc)).toBe(true); // blank equals blank
    expect(evb('a != 4', doc)).toBe(true);
    expect(evb('a <> 4', doc)).toBe(true); // <> is !=
  });

  it('aggregates over wildcard paths; a bare list collapses to its sum', () => {
    expect(ev('sum(rows[*].amt)', doc)).toBe(175);
    expect(ev('rows[*].amt', doc)).toBe(175); // list → sum in evaluateExpression
    expect(ev('count(rows[*].amt)', doc)).toBe(3);
    expect(ev('max(rows[*].amt)', doc)).toBe(100);
    expect(ev('avg(rows[*].amt)', doc)).toBe(175 / 3);
    expect(ev('unique(rows[*].type)', doc)).toBe(2);
    expect(ev('first(rows[*].type)', doc)).toBe('CG');
    expect(ev('max(2, 9, 4)')).toBe(9); // variadic scalars too
    expect(ev('sum(nothing[*].x)', doc)).toBe(0); // missing array sums to 0
    expect(ev('min(nothing[*].x)', doc)).toBeUndefined(); // but min/max of nothing are blank
  });

  it('sumif / countif / anyif / allif iterate rows with the row bound in the condition', () => {
    expect(ev('sumif(rows[*].amt, rows[*].type == "CG")', doc)).toBe(125);
    expect(ev('countif(rows[*].amt, rows[*].amt > 30)', doc)).toBe(2);
    expect(ev('anyif(rows[*].amt, rows[*].type == "XX")', doc)).toBe(false);
    expect(ev('allif(rows[*].amt, rows[*].amt > 10)', doc)).toBe(true);
  });

  it('a bound wildcard reads the same row', () => {
    expect(ev('items[*].qty * items[*].price', doc, { items: 1 })).toBe(30);
  });

  it('scalar functions', () => {
    expect(ev('round(2.5)')).toBe(3);
    expect(ev('round(2.346, 2)')).toBe(2.35);
    expect(ev('floor(7 / 2)')).toBe(3);
    expect(ev('ceil(7 / 2)')).toBe(4);
    expect(ev('abs(0 - 4)')).toBe(4);
    expect(ev('if(a > 3, "big", "small")', doc)).toBe('big');
    expect(ev('nvl(missing, a, 9)', doc)).toBe(5);
    expect(ev('min(12500, a * 1000)', doc)).toBe(5000);
  });

  it('presence and membership', () => {
    expect(evb('exists(rows)', doc)).toBe(true);
    expect(evb('exists(nothing)', doc)).toBe(false);
    expect(evb('isblank(missing)', doc)).toBe(true);
    expect(evb('not isblank(a)', doc)).toBe(true);
    expect(evb('in(first(rows[*].type), "CG", "OS")', doc)).toBe(true);
    expect(evb('in(a, "1", "2")', doc)).toBe(false);
  });

  it('strings', () => {
    expect(ev('len(trim(s))', doc)).toBe(2);
    expect(ev('upper(trim(s))', doc)).toBe('HI');
    expect(ev('left("ABCDE", 2)')).toBe('AB');
    expect(ev('right("ABCDE", 2)')).toBe('DE');
    expect(evb('contains("DELA12345B", "A123")')).toBe(true);
    expect(evb('matches("DELA12345B", "^[A-Z]{4}[0-9]{5}[A-Z]$")')).toBe(true);
  });

  it('dates: ISO and DD/MM/YYYY, differences, parts', () => {
    expect(ev('days_between(d1, "2024-04-02")', doc)).toBe(2);
    expect(ev('date(d2)', doc)).toBe('2024-06-15');
    expect(ev('year(d1)', doc)).toBe(2024);
    expect(ev('month(d1)', doc)).toBe(3);
    expect(ev('day(d1)', doc)).toBe(31);
    expect(ev('months_between("2023-04-15", "2024-03-14")')).toBe(10);
    expect(ev('years_between("1964-04-01", "2024-03-31")')).toBe(59);
    expect(evb('d1 <= "2024-03-31"', doc)).toBe(true);
  });

  it('checkExpression validates without evaluating', () => {
    expect(() => checkExpression('nosuchfn(1)')).toThrow(/Unknown function/);
    expect(() => checkExpression('sumif(1, 2)')).toThrow();
    expect(() => checkExpression('a + ')).toThrow();
    expect(() => checkExpression('round(sum(items[*].amount) * 1.18, 2)')).not.toThrow();
  });
});
```

---

> ### 🛑 CHECKPOINT A (after M2)
>
> Stop; follow the procedure of §1. **The Reviewer will run**: `npm install`, `npm run build`, then in `packages/core`: `npx vitest run` — expecting T1 (7 tests) and T2 (12 tests) green, exactly as printed. **The Reviewer will read**: the tokenizer's hyphen lookahead; the blank-semantics table of §7.6 against the code; `evaluateExpression`'s list-collapse contract; immutability of `setAtPath`. **It will also spot-check in a Node REPL**, expecting precisely: `evaluateExpression('PartB-ATI.x - 1', {'PartB-ATI':{x:5}}, {})` → `4`; `evaluateExpression('sumif(r[*].a, r[*].t == "X")', {r:[{a:1,t:'X'},{a:2,t:'Y'}]}, {})` → `1`; `evaluateBoolean('missing <= 0', {}, {})` → `true`. Divergence here produces an addendum rather than a PROCEED, because every later milestone builds on these exact semantics.

## 8. M3 — Checks, conditions and validation

**File**: `packages/core/src/rules.ts`. Exports: `resolveOperand`, `evaluateCondition`, `validateDocument`, `validateWithRuleSet`, `describeOperand`, `describeCheck`, `describeCondition`, `describeRule`, `validateRuleDefinition`.

### 8.1 Operands

`resolveOperand(data, operand, bindings)`: `literal` → its value · `path` → resolve with bindings; ≤1 match → the value (or `undefined` when not existing); several → list of existing values · `expression` → `evaluateExpression` (so `undefined` when blank) · `aggregate` → resolve path, take existing values; `count` counts non-blank; the numeric aggregates use numeric members only, with **`sum` of none → 0** and the others → `undefined`.

### 8.2 Conditions

`evaluateCondition` recurses over `all` (every) / `any` (some) / `not` / `{expression}` (→ `evaluateBoolean`) / leaf. A leaf resolves its `path` with the rule's bindings and is **true when any match satisfies it** (no matches → tested once with `value = undefined, exists = false`): `exists` = exists && non-blank; `notExists` = its negation; `isEmpty`/`isNotEmpty` on blankness; `in`/`notIn` resolve `rhs` then compare with `looseEquals` against the list — where a string rhs is split on commas (a JSON array string like `["A","B"]` is parsed first); `matches` = RegExp test (invalid → false); the six comparison operators resolve `rhs` and use the same `applyOperator` as checks, except that for `< <= > >=` an `undefined` target makes the leaf false.

### 8.3 `applyOperator(op, a, b, tolerance = 0)`

With tolerance > 0 and `==`/`!=`: when both sides coerce to numbers, equal means `|a−b| ≤ tolerance`. Otherwise `==`/`!=` → `looseEquals`; orderings → `compareValues`, null → false. (Local helpers `asNumber`/`asDate` mirror §7.3 but return `undefined` instead of null, and `asDate` accepts ISO only.)

### 8.4 `runCheck` — per-kind semantics

Evaluated once per target match `m` (`value`, `exists`, `bindings`), with `allMatches` available for `unique`.

1. **Always run** (even on blanks): `required` — fails unless exists && non-blank, default message `{name} is required` · `empty` — fails when exists && non-blank · `assert` — `evaluateBoolean(expression)` with the match's bindings (the target is only an anchor) · `unique` — blank values pass; peers = all matches (`scope: 'document'`, default) or matches sharing the same parent container (strip trailing key, then trailing index); fails **only on the later duplicate**, so each duplicate pair yields one violation, message `{name} "{value}" is entered more than once`.
2. **Everything else skips blank targets** — `{ ok: true }` when !exists or blank — **except** `compare` with `blankAsZero: true`, which substitutes 0 and carries on.
3. `type` — string/number/integer/boolean/date with numeric strings accepted as numbers, `'true'/'false'` as booleans, ISO strings as dates; booleans are not numbers. `min`/`max` — numeric or date comparison via `compareValues`; a non-numeric non-date value fails with `{name} must be numeric…`. `minLength`/`maxLength` — array length or string length. `pattern` — RegExp(regex, flags) test of `String(v)`; an **invalid regex fails the check** with `Invalid pattern in rule: …`. `enum` — some value `looseEquals` v.
4. `compare` — resolve `rhs` with the match's bindings. If rhs is `undefined`: when the target value is a number **and** rhs is an `expression`/`aggregate`, use 0 (an absent schedule total is nil); otherwise pass (nothing to compare against). Then `applyOperator(operator, v, rhs, tolerance)`; the default failure message is `{name} must be <op> <describeOperand(rhs)>[ (±tol)] (got {value}, expected <rhs>)`.

### 8.5 `validateDocument(data, rules)`

For each rule with `enabled !== false`: resolve `rule.target` (a resolve throw skips the rule); for each match — if a condition exists and is false, continue; run the check; on failure push a Violation `{ruleId, ruleName, severity, path: m.path, message, value}` where `message` is the rule's own `message` (if non-blank) else the check's default, with `{path}`, `{name}` (last dot-segment of the concrete path) and `{value}` substituted (`undefined` → `nothing`, numbers plain, objects JSON). **Any exception from condition or check becomes a `warning` violation** with message `Rule could not be evaluated: …` — one bad rule must never abort validation. Finally: `errors` = severity error, `warnings` = the rest, `valid` = `errors.length === 0`. `validateWithRuleSet(data, rs)` = `validateDocument(data, rs.rules)`.

### 8.6 Definition hygiene

`validateRuleDefinition(rule)` returns a list of problems (empty = sound): missing id/name/target; unparsable target; `pattern` whose regex does not compile; `compare` whose expression operand fails `checkExpression` or whose path operand does not parse; `assert` whose expression fails `checkExpression`; conditions checked recursively the same way. `describeRule` renders one English sentence (`describeCheck` + `when …` from `describeCondition`) — wording free, but it must never throw. The server (M6) rejects any rule set containing problems, so be strict here.

### 8.7 Test suite T3

Save as `packages/core/src/t3-rules.test.ts`; run `npx vitest run src/t3-rules.test.ts`. Expected: **10 tests, all passing**. The suite asserts, among others: required fires on `''` but min/compare skip blanks; `blankAsZero` forces a failure where the plain compare passed; blank expression rhs against a numeric target counts as 0; unique document- vs parent-scope and the “later duplicate” rule; eval errors demoted to warnings; `{name} at {path} is {value}` templating. Full file in Appendix D (D.1).

## 9. M4 — Computed fields · Checkpoint B

**File**: `packages/core/src/compute.ts`. Exports: `ComputeResult`, `orderComputations`, `computeDocument`, `computedTemplatePaths`, `underAnyPath`, `validateComputationDefinition`.

```ts
export interface ComputeResult {
  data: unknown;                      // document with every computed field written
  computed: Map<string, string>;      // concrete path → computation id (only fields actually computed)
  changed: string[];                  // concrete paths whose value differs from the input
  errors: { id: string; message: string }[];
}
```

### 9.1 Dependency ordering — `orderComputations(computations)`

Only `enabled !== false` computations participate. For each, its **inputs** are `expressionPaths(expression)` plus `expressionPaths(condition)` mapped through `toTemplatePath`; its **product** is `toTemplatePath(target)`. Build edges “A depends on B” when one of A's inputs equals B's product (A ≠ B). Topologically sort by repeated sweeps (take everything whose dependencies are all taken); anything never taken is **cyclic** — return `{ order: [...sorted, ...cyclic], cyclic: ids }` so cyclic ones still run last, in listed order.

### 9.2 `computeDocument(input, computations)` — the contract

Pure (the input object is never mutated; untouched branches keep identity, and **if nothing changes the very same input object is returned**). For each computation in dependency order (a cycle contributes one error entry per trapped id, message mentioning `Circular dependency`):

1. `resolvePath(data, target)` — a throw records an error and skips the computation. A `[*]` target therefore computes once per existing row, with that row's bindings in force for the expression (same-row semantics).
2. **Parent guard**: skip a match whose parent container does not exist as a plain object (`resolvePath` the path minus its last segment; root targets check the document itself). An absent optional schedule is never created by computing into it.
3. If `condition` is present and `evaluateBoolean` is false → the field keeps whatever was entered (and is **not** recorded in `computed`, so the editor leaves it editable).
4. `value = normalise(evaluateExpression(expression, data, bindings))` where `normalise`: `undefined`/`null`/non-finite → **0**; numbers rounded to 2 decimals (`Math.round(v*100)/100`, `-0` → `0`) to kill floating-point noise; everything else passes through. Record `computed.set(concretePath, id)`.
5. If the value differs (`!==`) from what is there, `setAtPath` it; add to `changed` unless old and new are both blank / JSON-equal.
6. Exceptions from condition or expression → an `errors` entry; never a throw.

Consequences the tests pin down: computing twice changes nothing (**idempotence**); computed values can never disagree with the equality rules that share their formulas; blank sums become explicit `0`s.

### 9.3 Helpers

- `computedTemplatePaths(comps)` → `Set` of `toTemplatePath(target)` of enabled computations (UI asks “is this field computed?” without a document).
- `underAnyPath(path, prefixes?)` — true when `toTemplatePath(path)` equals some `toTemplatePath(prefix)` or extends it at a `.` or `[` boundary (`a.bc` is NOT under `a.b`). Drives the read-only / collapsed display settings.
- `validateComputationDefinition(c)` → problems list: missing id / target / expression; unparsable target; expression or condition failing `checkExpression`.

### 9.4 Test suite T4

Save as `packages/core/src/t4-compute.test.ts`; run `npx vitest run src/t4-compute.test.ts`. Expected: **10 tests, all passing**.

```ts
// T4 — computed fields (M4). Copy verbatim to packages/core/src/t4-compute.test.ts
import { describe, expect, it } from 'vitest';
import { computeDocument, computedTemplatePaths, orderComputations, underAnyPath, validateComputationDefinition, validateDocument, type Computation, type Rule } from './index.js';

const c = (id: string, target: string, expression: string, extra: Partial<Computation> = {}): Computation => ({ id, name: id, target, expression, ...extra });

describe('computeDocument', () => {
  it('evaluates in dependency order regardless of listed order', () => {
    const comps = [c('total', 'inv.total', 'inv.net + inv.tax'), c('tax', 'inv.tax', 'round(inv.net * 0.18)'), c('net', 'inv.net', 'sum(inv.lines[*].amount)')];
    const { order } = orderComputations(comps);
    expect(order.map((x) => x.id)).toEqual(['net', 'tax', 'total']);
    const r = computeDocument({ inv: { lines: [{ amount: 100 }, { amount: 50 }] } }, comps);
    expect(r.data).toEqual({ inv: { lines: [{ amount: 100 }, { amount: 50 }], net: 150, tax: 27, total: 177 } });
    expect([...r.computed.keys()].sort()).toEqual(['inv.net', 'inv.tax', 'inv.total']);
    expect(r.errors).toEqual([]);
  });

  it('computes row-level targets per row with same-row bindings, before the column total', () => {
    const comps = [c('sum', 'o.total', 'sum(o.items[*].amount)'), c('row', 'o.items[*].amount', 'o.items[*].qty * o.items[*].price')];
    const r = computeDocument({ o: { items: [{ qty: 2, price: 5 }, { qty: 3, price: 1.1 }] } }, comps);
    expect(r.data).toEqual({ o: { items: [{ qty: 2, price: 5, amount: 10 }, { qty: 3, price: 1.1, amount: 3.3 }], total: 13.3 } });
    expect(r.computed.has('o.items[1].amount')).toBe(true);
  });

  it('does not create absent parents (optional schedules stay absent) and writes blank results as 0', () => {
    const comps = [c('a', 'sch.total', 'sum(sch.rows[*].x)'), c('b', 'main.total', 'sum(main.rows[*].x)')];
    const r = computeDocument({ main: {} }, comps);
    expect(r.data).toEqual({ main: { total: 0 } });
    expect(r.computed.has('sch.total')).toBe(false);
  });

  it('leaves a field as entered (not computed) when the condition is false', () => {
    const comps = [c('a', 'x.out', 'x.in * 2', { condition: 'x.mode == "auto"' })];
    expect(computeDocument({ x: { in: 4, out: 1, mode: 'manual' } }, comps).data).toEqual({ x: { in: 4, out: 1, mode: 'manual' } });
    const r = computeDocument({ x: { in: 4, out: 1, mode: 'auto' } }, comps);
    expect(r.data).toEqual({ x: { in: 4, out: 8, mode: 'auto' } });
    expect(r.changed).toEqual(['x.out']);
  });

  it('skips disabled computations and reports cycles and bad expressions without throwing', () => {
    const comps = [c('a', 'x.a', 'x.b + 1'), c('b', 'x.b', 'x.a + 1'), c('off', 'x.c', '99', { enabled: false }), c('bad', 'x.d', 'nosuchfn(1)')];
    const r = computeDocument({ x: {} }, comps);
    expect(r.errors.map((e) => e.id).sort()).toEqual(['a', 'b', 'bad']);
    expect((r.data as { x: Record<string, unknown> }).x.c).toBeUndefined();
    expect(computedTemplatePaths(comps).has('x.c')).toBe(false);
  });

  it('is pure and returns the same object when nothing changes', () => {
    const doc = { x: { a: 1, b: 2 } };
    const r = computeDocument(doc, [c('b', 'x.b', 'x.a * 2')]);
    expect(r.data).toBe(doc);
    expect(r.changed).toEqual([]);
  });

  it('removes floating-point noise', () => {
    expect(computeDocument({ x: { a: 0.1, b: 0.2 } }, [c('s', 'x.s', 'x.a + x.b')]).data).toEqual({ x: { a: 0.1, b: 0.2, s: 0.3 } });
  });

  it('computed values satisfy the matching equality rules', () => {
    const comps = [c('gti', 'r.gti', 'r.sal + r.os'), c('ti', 'r.ti', 'max(0, r.gti - r.ded)')];
    const rules: Rule[] = [
      { id: 'R1', name: 'gti', target: 'r.gti', check: { kind: 'compare', operator: '==', rhs: { type: 'expression', expression: 'r.sal + r.os' }, blankAsZero: true }, severity: 'error' },
      { id: 'R2', name: 'ti', target: 'r.ti', check: { kind: 'compare', operator: '==', rhs: { type: 'expression', expression: 'max(0, r.gti - r.ded)' }, blankAsZero: true }, severity: 'error' },
    ];
    const doc = { r: { sal: 500, os: 20, ded: 600, gti: 1, ti: 7 } };
    expect(validateDocument(doc, rules).errors.length).toBe(2);
    expect(validateDocument(computeDocument(doc, comps).data, rules).errors).toEqual([]);
  });
});

describe('underAnyPath', () => {
  it('matches the path itself and everything under it, ignoring indices', () => {
    expect(underAnyPath('a.b', ['a.b'])).toBe(true);
    expect(underAnyPath('a.b.c', ['a.b'])).toBe(true);
    expect(underAnyPath('a.b[2].c', ['a.b'])).toBe(true);
    expect(underAnyPath('a.b[2].c', ['a.b[*].c'])).toBe(true);
    expect(underAnyPath('a.bc', ['a.b'])).toBe(false);
    expect(underAnyPath('a.b', undefined)).toBe(false);
  });
});

describe('validateComputationDefinition', () => {
  it('accepts a valid definition and reports each problem', () => {
    expect(validateComputationDefinition(c('a', 'x.a', 'x.b + 1'))).toEqual([]);
    expect(validateComputationDefinition({ id: '', name: '', target: '', expression: '' }).length).toBe(3);
    expect(validateComputationDefinition(c('a', 'x.a', 'foo(1)'))[0]).toMatch(/expression/);
    expect(validateComputationDefinition(c('a', 'x.a', '1', { condition: 'bar(' }))[0]).toMatch(/condition/);
  });
});
```

---

> ### 🛑 CHECKPOINT B (after M4)
>
> Stop; follow §1. **The Reviewer runs** `npx vitest run` in `packages/core` — T1 + T2 + T3 + T4 all green (7 + 12 + 10 + 10 tests). **Reads**: the parent guard (step 2 of §9.2 — the single most-missed behaviour), purity/identity return, normalise (blank → 0, 2-decimal rounding), and that a false condition removes the field from `computed` (the editor depends on it to re-enable the input). **Spot-checks**: `computeDocument(doc, comps).data === doc` for an already-consistent doc; a row-level target over 3 rows produces 3 `computed` entries.

## 10. M5 — Document utilities and schema building

**Files**: `packages/core/src/document.ts`, `packages/core/src/schema.ts`. M5 implements the JSON side completely; the XML/XSD halves of both files are **stubs until M9** (they must exist and type-check: `parseDocument`/`serializeDocument` throw a clear `XML support not implemented` for `format: 'xml'`, and `buildSchemaFromText` recognises XML/XSD input only to throw the same way — unless you proceed to M9 later).

### 10.1 document.ts

Exports: `parseDocument(text, format, schemaRoot?)` (JSON → `JSON.parse`), `serializeDocument(data, format)` (JSON → `JSON.stringify(data, null, 2) + '\n'`), `emptyValueFor(node)`, `emptyArrayItem(arrayNode)`, `emptyDocument(schemaRoot)`, `isBlank(value)`, `pruneBlanks(data)`, `coerceValue(raw, node)`.

- `emptyValueFor`: object → `{child.name: emptyValueFor(child), …}` · array → `[]` · boolean → `false` · number/integer → `null` · string/date/unknown → `''`. `emptyArrayItem`: for a primitive-item array (single child named `[*]`) the item's empty value, else an object from the children. `emptyDocument = emptyValueFor(root)`.
- `isBlank`: same five blanks as `isBlankValue` (§7.3) — duplicated here so document.ts does not import expression.ts.
- `pruneBlanks` (applied before saving/downloading): recursively drop object entries whose value is `null`/`undefined`/whitespace-only string; keep empty objects and arrays (structure survives); arrays map their members. Numbers — including 0 — and booleans always survive.
- `coerceValue(raw, node)`: integer/number → `''`→`null`, numeric text → number, non-numeric text kept as-is (validation will flag it); boolean → `raw === 'true' || raw === '1'`; everything else → raw string.

### 10.2 schema.ts

Exports: `ATTR_PREFIX = '@_'`, `TEXT_NODE = '#text'`, `schemaFromJsonSample`, `schemaFromJsonSchema`, `looksLikeJsonSchema`, `buildSchemaFromText`, `flattenSchema`, `findSchemaNode`, `arrayPathsOf`, `formatOfFile` (+ `makeXmlParser`, `schemaFromXmlSample`, `schemaFromXsd` in M9).

- `formatOfFile(fileName, text)`: `.xml`/`.xsd` extension or text starting `<` → `'xml'`, else `'json'`.
- `buildSchemaFromText(text, fileName)` → `{ format, source, sourceText, root }`: JSON input is parsed; it is a **JSON Schema** when `looksLikeJsonSchema` (has `$schema`, or `type` plus `properties`/`items`) → `source: 'json-schema'`, else a **sample** → `source: 'json-sample'`.
- **JSON Schema → tree** (`fromJsonSchema(root, s, name, path)`, depth-capped at 30):
  1. `$ref` → resolve against `#/definitions/…` or `#/$defs/…` and merge (ref'd first, local overrides).
  2. `allOf` → merge every part's `properties` and `required` (resolving `$ref` parts), first `type` wins.
  3. No `type`/`properties` but `oneOf`/`anyOf` → take the first variant.
  4. Node type: declared `type` (array of types → first non-null); `string` with `format` `date`/`date-time` → `date`; inferred `object` from `properties`, `array` from `items`, `string` from bare `enum`; else `unknown`.
  5. Copy `description` (stringified) and `enum` (members stringified). An object's children come from `properties`, each child getting `required: true` when listed in the parent's `required`. An array's item schema (first of a tuple) becomes: object item → the node's `children` directly; primitive item → one child named `'[*]'`. Array item paths append `[*]`.
  6. Root call: `fromJsonSchema(schema, schema, '$', '')` — the virtual root has path `''`.
- **JSON sample → tree**: types from `typeof` (integer when `Number.isInteger`; ISO `YYYY-MM-DD` strings → `date`); arrays: **merge the keys of every element** so `[{x},{x,y}]` yields both `x` and `y` children; path building as above.
- `flattenSchema(root)` → depth-first list of all nodes with a non-empty `path`. `findSchemaNode(root, path)` → exact template-path match. `arrayPathsOf(root)` → set of template paths of every array node (M9 uses it to force single XML elements into arrays).

### 10.3 Test suite T5

Save as `packages/core/src/t5-schema.test.ts`; run `npx vitest run src/t5-schema.test.ts`. Expected: **6 tests, all passing**. Full file in Appendix D (D.2) — it pins down: `$ref`+`definitions` resolution, `allOf` merge with `required` propagation, `format: 'date'`, enum capture, `ITR.Amounts[*].amt` flattening, sample-inference key-merging across array elements, `emptyDocument` shapes, `pruneBlanks` keeping `0`/containers and dropping blanks, `coerceValue`, JSON round-trip, `formatOfFile`.

**Gate M5**: T1–T5 all green: `npx vitest run` in `packages/core` → **45 tests passed** (7+12+10+10+6).

## 11. M6 — REST server · Checkpoint C

**Files**: `packages/server/src/storage.ts`, `packages/server/src/index.ts`.

### 11.1 storage.ts — file collections

```ts
export interface Collection<T extends { id: string }> {
  list(): Promise<T[]>; get(id: string): Promise<T | undefined>;
  put(record: T): Promise<T>; remove(id: string): Promise<boolean>;
}
export function fileCollection<T extends { id: string }>(dir: string): Collection<T>
```

One pretty-printed JSON file per record at `dir/<id>.json`; `mkdir -p` on first use; ids must match `/^[A-Za-z0-9_-]+$/` (reject anything else — path traversal guard); `put` writes to `<file>.tmp` then renames (atomic); `list` skips unreadable files; `get`/`remove` of a missing id → `undefined`/`false`. Swapping this module for a database is the only persistence change the design permits.

### 11.2 index.ts — app skeleton

`DATA_DIR = env.DATA_DIR ?? '<server pkg>/data'`; collections `schemas/`, `rulesets/`, `documents/`. Express with `cors()`, `express.json({ limit: '20mb' })`, multer memory storage (20 MB). Helpers: `HttpError(status, message)`; `wrap(fn)` to funnel async errors; `now()` ISO; `id()` = 12-char nanoid over `[0-9a-zA-Z]`. A final error middleware answers `{ error: message }` with the `HttpError` status (500 otherwise); unknown `/api/*` routes → 404 `{ error: 'Not found' }`. In production (`dist` of the client exists), serve it statically with an SPA fallback to `index.html` for non-`/api` GETs. `app.listen(PORT)`.

### 11.3 Sanitizers — the API trusts nothing

- `sanitizeRules(rules)` — must be an array; each rule rebuilt field by field (id kept when a non-empty string, else freshly minted; name/target stringified; severity `'warning'` only when exactly that, else `'error'`; `enabled = r.enabled !== false`; optional strings kept only when strings). Then `validateRuleDefinition` on each; **any problem → 400** listing `Rule <n> (<name>): <problem>` joined with ` ;  `.
- `sanitizeComputations(list)` — same pattern over `validateComputationDefinition`; `undefined`/`null` → `[]`.
- `sanitizeDisplay(d)` — `undefined`/`null` → `undefined`; must be an object; `readOnly`/`collapsed` must be string arrays (trimmed, blanks dropped) → else 400.

### 11.4 Routes (all under `/api`; bodies and answers JSON unless noted)

| Route | Behaviour |
| --- | --- |
| GET `/schemas` | summaries (id, name, format, source, createdAt, updatedAt) — never the tree — newest first |
| POST `/schemas` | multipart `file` (+ optional `name`): `buildSchemaFromText`; parse failure → 400; 201 with the full SchemaDefinition |
| GET `/schemas/:id` | full definition or 404 |
| PATCH `/schemas/:id` | rename |
| DELETE `/schemas/:id` | with dependent rule sets → 409 unless `?force=true`, which cascades to its rule sets and documents; 204 |
| GET `/schemas/:id/empty-document` | `{ format, data: emptyDocument(root) }` |
| GET `/rulesets?schemaId=` | full rule sets, newest first |
| POST `/rulesets` | `{name, schemaId, rules?, computations?, display?}` → sanitize everything, schema must exist, 201 |
| GET / PUT / DELETE `/rulesets/:id` | fetch · update name/description/rules/computations/display (fields absent from the body keep their stored value) · delete |
| GET `/rulesets/:id/export` | download `{name, description, schemaName, rules[, computations][, display]}` with Content-Disposition `….ruleset.json` |
| POST `/validate` | `{data, ruleSetId}` or `{data, rules[, computations]}` → **compute first**, then validate: `{...ValidationResult, data: <computed doc>, computedFields: string[], computeErrors }` |
| POST `/documents/parse` | multipart `file` + `schemaId` → `{name, format, data}` — parsed, not stored |
| GET `/documents?schemaId=` | summaries (no data) |
| POST `/documents` | `{id?, name, schemaId, ruleSetId?, data}` — **when the rule set has computations, store `computeDocument(data).data`** (the server is authoritative); 201 new / 200 update |
| GET / DELETE `/documents/:id` | fetch · 204 |
| GET `/documents/:id/export` | serialized file download |

### 11.5 Test suite T6

Save as `server-tests/t6-api.mjs` (full file in Appendix D (D.3)); run from the repo root after `npm run build`: `node server-tests/t6-api.mjs`. It spawns the built server on a random port with a temp `DATA_DIR` and must print **exactly 16 PASS lines** ending `All T6 checks passed` — covering schema upload/list, rule-set storage of computations + display, 400s on a bad rule and a bad computation, compute-before-validate (`total === 177`), warnings not blocking validity, compute-on-save (`net === 150`), empty-document, parse, export round-trip shape, 204/404/409/force-cascade.

---

> ### 🛑 CHECKPOINT C (after M6)
>
> Stop; follow §1. **The Reviewer runs**: `npm run build`; `npx vitest run` in core (45 tests); `node server-tests/t6-api.mjs` (16 PASS). **Reads**: the three sanitizers (above all that a 400 names the offending rule and that PUT keeps absent fields), compute-on-save, the id guard in storage.ts, and that `/validate` returns the computed document — the client depends on that exact response shape. **Spot-check**: `curl -s localhost:PORT/api/rulesets/does-not-exist` → `404 {"error":"Rule set not found"}`.

## 12. M7 — Client UI

**Files**: `client/src/api.ts` (thin typed fetch wrapper mirroring §11.4 — every page talks only through it), `App.tsx` (top bar + page switch), `pages/SchemasPage.tsx`, `pages/RuleSetsPage.tsx`, `pages/DocumentsPage.tsx`, `components/SchemaTree.tsx`, `components/RuleEditor.tsx`, `components/DocumentForm.tsx`, `components/CompareForm.tsx`, `styles.css`. Plain React state — no router, no state library. Class names and `data-testid`s named below are **contractual** (the e2e checks and the Reviewer's script select by them).

### 12.1 Schemas page

Upload box (file input → `POST /api/schemas`, optional name), list of schemas (rename inline, delete with confirm — surface the 409 message and offer force), and a read-only `SchemaTree` of the selected schema: an indented, collapsible tree of `flattenSchema`-style nodes showing name, type badge, `*` when required, enum values and description on hover.

### 12.2 Rule sets page

Three columns: (left) schema picker + rule-set list with per-set badges for rule count and `ƒ n` computed count, plus **Import…** (reads a `.ruleset.json` file: `{name?, description?, rules, computations?, display?}` or a bare rules array → `POST /api/rulesets`) and **Export** (link to the export route); (middle) the open rule set; (right) the schema field tree — clicking a field starts a new rule (or computation, on that tab) targeting its path.

The middle column has a three-tab switch, `nav.viewswitch` with buttons: `Validation rules (N)`, `Computed fields (N)` (**`data-testid="tab-computed"`**), `Display` (**`data-testid="tab-display"`**).

- **Validation rules**: searchable (name/target/ref/group/describeRule text), “enabled only” filter, grouped by `group` with headings; each rule a card (enable checkbox, name, severity badge, `describeRule` text, message/ref/notes, Edit, Delete). `RuleEditor`: name, target (free text), severity, check-kind dropdown revealing the kind's fields (value / regex+flags / enum values / operator+operand editor with literal│path│aggregate│expression tabs / expression textarea / tolerance + blankAsZero for compare), one AND/OR level of condition leaves plus a free-form expression option, message, group, ref, notes. Done is disabled while `validateRuleDefinition` reports problems (show them).
- **Computed fields**: same list pattern; each card shows `target = expression` (+ `when <condition>`), `ƒ` badge, enable checkbox, Edit/Delete; editor fields: name, target, formula textarea, optional condition, group, source/ref — gated by `validateComputationDefinition`. An explainer line: unticking a computed field makes it editable again.
- **Display**: two textareas (one template path per line) for `readOnly` and `collapsed`, saved as `display`.

Save (`PUT`/`POST`) sends name, description, rules, computations and display together; “unsaved” badge on dirty; errors shown inline.

### 12.3 Documents page — the heart of the app

Layout `div.layout.three`: left pane (`div.left-pane`), centre document panel, right validation panel.

1. **Left pane**: Schema picker; **Rule set picker** listing `name (N rules[, M computed])`; the chosen pair decides everything downstream. Remember the last rule set per schema in `localStorage` (`ruleSetFor:<schemaId>`), restore on schema switch, and wrap all storage access in try/catch. Under the pickers a summary (**`data-testid="ruleset-summary"`**): “Applying **N** rules and **M** computed fields…” plus a computation-error alert when `computeErrors` is non-empty. Below: New from schema (`empty-document`), Upload (→ `/documents/parse`), and the saved-document list (open / download / delete).
2. **Pane toggle**: a rectangular button above the document panel (**`data-testid="toggle-left"`**, class `pane-toggle`), label `◀ Hide left pane` / `▶ Show schema, rule set & documents`; hiding adds `left-hidden` to the layout (grid drops the first column) and persists in `localStorage` (`documents.leftHidden`); while hidden, show `<schema> · <rule set>` beside the button.
3. **Compute-then-validate on every edit**: `computedRun = useMemo(() => computeDocument(draft.data, ruleSet?.computations), [draft, ruleSet])`; `effective = computedRun.data`; `result = validateDocument(effective, ruleSet.rules)`. Build `computedIndex: Map<concretePath, Computation>` from `computedRun.computed`. **Everything shown, saved and downloaded is `effective`** (blank-pruned on save/download); edits land in `draft.data` via `setAtPath`, and `onChange` ignores paths under `display.readOnly` (`underAnyPath`).
4. **Views** (`compare` default, `form`, `raw` = serialized output). The **side-by-side** `CompareForm` renders one grid row per schema field: label cell (name, red `*` when required **and** its block is present in the document, muted grey `*` with explanatory title otherwise, `ƒ computed` badge, template path in small mono), **original** cell (read-only value as loaded, struck through when changed), **editable** cell (input/select by node type; enum → dropdown with a `(not allowed)` extra option for off-enum stored values; revert-one button `↺` on changed rows; array sections get `+ Add item` / per-row `✕` unless read-only). Violations render under the editable cell (`.msg.error`/`.msg.warning`) and section rows carry error/warning badges. Visual contract: sticky 3-column header `Field | Original (read-only) | Editable copy`, strong vertical borders between the three columns (original column grey-tinted, editable white), changed rows amber-tinted, row ids `id="f-<path>"` for scroll-to-violation.
5. **Computed fields** render as `div.computed-value` (read-only, right-aligned mono, dashed border, violet tint, `ƒ computed` badge in the label; `title` = name + formula + source) — never an input. Fields under `display.readOnly` render as `div.locked-value` with a `read-only` badge on their block heading; blocks under `display.collapsed` start collapsed (re-applied when schema/rule set changes).
6. **Filters** row: `All fields` · `Changed (n)` · `With errors/warnings (n)` · `Computed (n)` (the last only when computedIndex is non-empty), plus **Revert all**.
7. **Validation panel** (right): valid/error-count badge, every violation as a clickable card (severity badge, message, concrete path + rule name) that scrolls to and flashes the row (walk up the path until an element `f-<path>` exists; switch filter to All first). Below it a **Computed values** panel (**`data-testid="computed-summary"`**): non-row computed fields grouped by `group` as collapsible `<details>` (tax-related groups open), each line name + formatted value, click → jump; flag lines whose path carries an error.
8. **Save**: button disabled while `result.errors.length > 0` (title explains) or nothing changed; alert above the grid “N errors — the document can only be saved once all errors are resolved (warnings do not block)”. Save POSTs `pruneBlanks(effective)` with `ruleSetId`; Download serializes the same. Guard unsaved changes with a confirm on navigation/open/new.

### 12.4 Styling

One `styles.css`, CSS variables (`--accent`, `--error`, `--warning`, `--computed: #6d28d9`, soft variants), system font stack, 13px base. Keep it modest — the layout/behaviour contract above matters; pixel-perfection does not.

**Gate M7**: `npm run dev`, then walk §19 checklist items 1–6 by hand with the mini invoice schema of T6 (upload it, build a small rule set with the three computations in the Rule Sets page, open a document). Automated coverage of this page arrives with M8's data.

## 13. M8 — ITR-1 AY 2024-25 starter data · Checkpoint D

This milestone is **data, not code**: a working ITR-1 rule set wired into the app, proving the whole machine end to end on real tax arithmetic.

### 13.1 Inputs

- **The official schema file** `ITR-1_2024_Main_V1.4.json` (a JSON Schema published by the Income Tax Department). It is too large to embed here; the human operator supplies it next to this document. Verify you have the right file: **97,398 bytes, SHA-256 `b76ab6320b443d856afa177488d9257eeb9523bb8b81a7725cf615c459dd07b4`**. Place it at `rulesets/itr1-ay2024-25/ITR-1_2024_Main_V1.4.json`.
- Appendices B (rules, computations, display), C (sample return) and D.4 (oracle test) of this document.

### 13.2 Files to create

**Payload pack shortcut.** If the operator supplies the companion `payload-pack.zip` — it carries `starter.ruleset.json`, `examples/sample-return.json`, `install.mjs`, the four Appendix D test files and the Appendix A path table as real files — copy its files verbatim into the repository paths named below instead of assembling them from Appendices B–D, then verify the shape: 73 rules, 52 computations, 3 `readOnly` roots. If the pack and this document ever disagree, stop and record it in `QUESTIONS.md` — this document is normative.

1. `rulesets/itr1-ay2024-25/starter.ruleset.json` — assemble exactly:

```json
{
  "name": "CBDT ITR-1 Validation Rules AY 2024-25 (starter)",
  "description": "Representative subset of the ITR-1 AY 2024-25 rule set: full Part B/C/D computation chain, Schedule 80D, Schedule 80GGC, taxes paid, identity formats. Severity: Category A scenarios → error.",
  "schemaName": "ITR-1 AY 2024-25 (V1.4)",
  "rules": [ …Appendix B.1, all 73, in order… ],
  "computations": [ …Appendix B.2, all 52, in order… ],
  "display": { …Appendix B.3… }
}
```

2. `rulesets/itr1-ay2024-25/examples/sample-return.json` — Appendix C verbatim.
3. `rulesets/itr1-ay2024-25/install.mjs` — loads the pair into a running server (idempotent):
   - read `starter.ruleset.json`; `GET /api/schemas`; if no schema named `schemaName`, upload the schema file under that name; find a rule set with the starter's `name` for that schema → `PUT` (rules + computations + display), else `POST`; print what happened. Base URL = argv\[2\] or `http://localhost:4000`.
4. `rulesets/test/t8-oracle.mjs` — Appendix D.4 verbatim; replace the M0 stub `rulesets/test/run-all.mjs` with one that runs it (spawn `node rulesets/test/t8-oracle.mjs`, propagate the exit code).

### 13.3 What the starter rule set contains (and why it is trusted)

73 rules + 52 computations + display settings, extracted verbatim from a reference implementation whose full set (301 rules, 116 computations) was built from the CBDT validation-rules document and passes build/mutation/harness suites there. The subset is closed: every field a computation reads is either entered in the sample or computed by another member. Groups:

| Area | Computed | Rules |
| --- | --- | --- |
| Part B salary chain (17(1)→gross→net→16(ia)→income) | 6 | 6 |
| Part B house property (annual value → 30% → income) | 3 | 4 |
| Part B other sources + 57(iia) family-pension cap | 2 | 4 |
| Gross total income (regime-aware HP-loss handling) + exempt income | 2 | 4 |
| Schedule 80D (four limbs + eligible total) | 5 | 10 |
| Schedule 80GGC (row-level: cash barred, GTI cap) | 6 | 4 |
| Part C — claimed column total, allowed 80C/80D/80TTA, allowed total, total income (§288A · rounding to ₹10) | 7 | 10 |
| Part D — slab tax old & new regime, 87A rebate (both regimes, marginal relief), 4% cess, D5/D7/D8/D9 | 8 | 11 |
| Taxes paid — five schedule totals, advance/self-assessment split by challan date, TDS/TCS roll-ups, D10, payable, refund (§288B) | 13 | 14 |
| Identity formats, uniqueness, verification PAN, 234F | 0 | 6 |

Domain facts encoded (do not “correct” them): old-regime basic exemption ₹2.5 L (₹3 L for DOB ≤ 1964-04-01, ₹5 L for DOB ≤ 1944-04-01) with 5%/20%/30% slabs at 5 L/10 L; new-regime (default, `OptOutNewTaxRegime == "N"`) slabs 0/5/10/15/20/30% at 3/6/9/12/15 L; 87A rebate ≤ ₹12,500 when TI ≤ ₹5 L (old) and ≤ ₹25,000 when TI ≤ ₹7 L with marginal relief above (new); cess 4%; advance tax = challans dated 2023-04-01…2024-03-31, self-assessment = later; total income, payable and refund round to the nearest ₹10.

### 13.4 Gate T8 and the e2e pass

`npm run build`, then `node rulesets/test/t8-oracle.mjs` → **47 PASS lines**, ending `All T8 oracle checks passed`: four scenarios with exact rupee figures (sample · salary ₹10 L · new regime · senior citizen), idempotence each time, eight single-defect mutations firing exactly their named rules, and the display-settings assertions. Then the live pass: start the app, `node rulesets/itr1-ay2024-25/install.mjs`, and complete the full §19 checklist in the browser with `examples/sample-return.json`.

---

> ### 🛑 CHECKPOINT D (after M8 — final)
>
> Stop; follow §1. **The Reviewer runs the whole battery**: `npm install` · `npm run build` · core `npx vitest run` (45) · `node server-tests/t6-api.mjs` (16) · `node rulesets/test/t8-oracle.mjs` (47) — all exactly as printed — then installs the starter data against a clean `DATA_DIR`, opens the app and walks Appendix E's checklist, comparing screens and numbers against the reference implementation (same sample, same edits, same violations, same computed trail). **Reads**: `DECISIONS.md` end to end. PROCEED here means the build is accepted; otherwise a final addendum lists the exact deltas.

*A note on scope*: the full production rule set (301 rules / 116 computations, and six more ITR forms) is **data** import-compatible with this application — the operator can load it through the same import path later; nothing in the code should special-case the starter subset.

## 14. M9 (optional) — XML/XSD support and other extensions

Build only if the operator asks; nothing earlier depends on it.

1. **XML documents**: implement the stubs of §10 with `fast-xml-parser`: attributes prefixed `@_`, text nodes `#text`; `makeXmlParser(arrayPaths)` forces elements whose template path is a schema array into arrays (single `<item>` round-trips as `[item]`); `serializeDocument` uses XMLBuilder (`format: true`, `indentBy: '  '`, XML declaration). Acceptance: a round-trip test — parse → serialize → parse is deep-equal — plus one rule evaluated on an XML-derived document.
2. **XML sample / XSD → schema**: `schemaFromXmlSample` infers the tree (repeated siblings → arrays); `schemaFromXsd` handles named complex/simple types, `ref=`, sequence/all/choice, attributes (`use="required"`), enumerations, `minOccurs`/`maxOccurs`, simple/complexContent extension. Wire both into `buildSchemaFromText` (`source: 'xml-sample' | 'xsd'`).
3. **Browser e2e harness** (Playwright): automate Appendix E — upload schema, install starter data over the API, drive the Documents page (salary edit → 68,500; regime switch → 54,750; computed filter count 49; left-pane toggle; read-only PersonalInfo) and assert the Save gating.
4. **More forms/years**: further rule sets are pure data; import them through the UI or an install script. No code changes.

## 15. Appendix A — ITR-1 field path reference

Every template path the starter data touches (targets, formulas, conditions), generated against the official schema — all 138 verify against it. `computed` marks targets of Appendix B.2 computations (read-only in the editor); `entered` fields are typed by the user. Prefix every path with `ITR.ITR1.`.

| Path (under ITR.ITR1.) | Type | Role | Schema description |
| --- | --- | --- | --- |
| `FilingStatus.OptOutNewTaxRegime` | string | entered | Y = old regime, N = default (new) regime |
| `FilingStatus.ReturnFileSec` | integer | entered | 11 : 139(1)-On or before due date, 12 : 139(4)-After due date, … 21 : 139(8A) |
| `ITR1_IncomeDeductions.AllwncExemptUs10.AllwncExemptUs10Dtls[*].SalOthAmount` | integer | entered |  |
| `ITR1_IncomeDeductions.AllwncExemptUs10.TotalAllwncExemptUs10` | integer | computed |  |
| `ITR1_IncomeDeductions.AnnualValue` | integer | computed |  |
| `ITR1_IncomeDeductions.ArrearsUnrealizedRentRcvd` | integer | entered |  |
| `ITR1_IncomeDeductions.DeductUndChapVIA` | object | entered | Deductions from income (the “allowed” column) |
| `ITR1_IncomeDeductions.DeductUndChapVIA.AnyOthSec80CCH` | integer | entered |  |
| `ITR1_IncomeDeductions.DeductUndChapVIA.Section80C` | integer | computed |  |
| `ITR1_IncomeDeductions.DeductUndChapVIA.Section80CCC` | integer | entered |  |
| `ITR1_IncomeDeductions.DeductUndChapVIA.Section80CCD1B` | integer | entered |  |
| `ITR1_IncomeDeductions.DeductUndChapVIA.Section80CCDEmployeeOrSE` | integer | entered | For Employee/SelfEmployed |
| `ITR1_IncomeDeductions.DeductUndChapVIA.Section80CCDEmployer` | integer | entered |  |
| `ITR1_IncomeDeductions.DeductUndChapVIA.Section80D` | integer | computed |  |
| `ITR1_IncomeDeductions.DeductUndChapVIA.Section80DD` | integer | entered |  |
| `ITR1_IncomeDeductions.DeductUndChapVIA.Section80DDB` | integer | entered |  |
| `ITR1_IncomeDeductions.DeductUndChapVIA.Section80E` | integer | entered |  |
| `ITR1_IncomeDeductions.DeductUndChapVIA.Section80EE` | integer | entered |  |
| `ITR1_IncomeDeductions.DeductUndChapVIA.Section80EEA` | integer | entered |  |
| `ITR1_IncomeDeductions.DeductUndChapVIA.Section80EEB` | integer | entered |  |
| `ITR1_IncomeDeductions.DeductUndChapVIA.Section80G` | integer | entered |  |
| `ITR1_IncomeDeductions.DeductUndChapVIA.Section80GG` | integer | entered |  |
| `ITR1_IncomeDeductions.DeductUndChapVIA.Section80GGA` | integer | entered |  |
| `ITR1_IncomeDeductions.DeductUndChapVIA.Section80GGC` | integer | computed |  |
| `ITR1_IncomeDeductions.DeductUndChapVIA.Section80TTA` | integer | computed |  |
| `ITR1_IncomeDeductions.DeductUndChapVIA.Section80TTB` | integer | entered |  |
| `ITR1_IncomeDeductions.DeductUndChapVIA.Section80U` | integer | entered |  |
| `ITR1_IncomeDeductions.DeductUndChapVIA.TotalChapVIADeductions` | integer | computed |  |
| `ITR1_IncomeDeductions.DeductionUs16` | integer | computed |  |
| `ITR1_IncomeDeductions.DeductionUs16ia` | integer | computed |  |
| `ITR1_IncomeDeductions.DeductionUs57iia` | integer | computed |  |
| `ITR1_IncomeDeductions.EntertainmentAlw16ii` | integer | entered |  |
| `ITR1_IncomeDeductions.ExemptIncAgriOthUs10.ExemptIncAgriOthUs10Dtls[*].OthAmount` | integer | entered |  |
| `ITR1_IncomeDeductions.ExemptIncAgriOthUs10.ExemptIncAgriOthUs10Total` | integer | computed |  |
| `ITR1_IncomeDeductions.GrossRentReceived` | integer | entered |  |
| `ITR1_IncomeDeductions.GrossSalary` | integer | computed |  |
| `ITR1_IncomeDeductions.GrossTotIncome` | integer | computed |  |
| `ITR1_IncomeDeductions.IncomeFromSal` | integer | computed |  |
| `ITR1_IncomeDeductions.IncomeNotified89A` | integer | entered |  |
| `ITR1_IncomeDeductions.IncomeNotifiedOther89A` | integer | entered |  |
| `ITR1_IncomeDeductions.IncomeOthSrc` | integer | computed |  |
| `ITR1_IncomeDeductions.Increliefus89A` | integer | entered |  |
| `ITR1_IncomeDeductions.Increliefus89AOS` | integer | entered |  |
| `ITR1_IncomeDeductions.InterestPayable` | integer | entered |  |
| `ITR1_IncomeDeductions.NetSalary` | integer | computed |  |
| `ITR1_IncomeDeductions.OthersInc.OthersIncDtlsOthSrc[*].OthSrcNatureDesc` | string | entered | SAV : Interest from Saving Account; IFD : Interest from Deposits; TAX : Interest from Income Tax Refund; FAP : Family pension; … |
| `ITR1_IncomeDeductions.OthersInc.OthersIncDtlsOthSrc[*].OthSrcOthAmount` | integer | entered |  |
| `ITR1_IncomeDeductions.PerquisitesValue` | integer | entered |  |
| `ITR1_IncomeDeductions.ProfessionalTaxUs16iii` | integer | entered |  |
| `ITR1_IncomeDeductions.ProfitsInSalary` | integer | entered |  |
| `ITR1_IncomeDeductions.Salary` | integer | entered |  |
| `ITR1_IncomeDeductions.StandardDeduction` | integer | computed | Part-B B2 iv — 30% of Annual Value |
| `ITR1_IncomeDeductions.TaxPaidlocalAuth` | integer | entered |  |
| `ITR1_IncomeDeductions.TotalIncome` | integer | computed |  |
| `ITR1_IncomeDeductions.TotalIncomeOfHP` | integer | computed | House Property income |
| `ITR1_IncomeDeductions.UsrDeductUndChapVIA.AnyOthSec80CCH` | integer | entered |  |
| `ITR1_IncomeDeductions.UsrDeductUndChapVIA.Section80C` | integer | entered |  |
| `ITR1_IncomeDeductions.UsrDeductUndChapVIA.Section80CCC` | integer | entered |  |
| `ITR1_IncomeDeductions.UsrDeductUndChapVIA.Section80CCD1B` | integer | entered |  |
| `ITR1_IncomeDeductions.UsrDeductUndChapVIA.Section80CCDEmployeeOrSE` | integer | entered | For Employee/SelfEmployed |
| `ITR1_IncomeDeductions.UsrDeductUndChapVIA.Section80CCDEmployer` | integer | entered |  |
| `ITR1_IncomeDeductions.UsrDeductUndChapVIA.Section80D` | integer | entered |  |
| `ITR1_IncomeDeductions.UsrDeductUndChapVIA.Section80DD` | integer | entered |  |
| `ITR1_IncomeDeductions.UsrDeductUndChapVIA.Section80DDB` | integer | entered |  |
| `ITR1_IncomeDeductions.UsrDeductUndChapVIA.Section80E` | integer | entered |  |
| `ITR1_IncomeDeductions.UsrDeductUndChapVIA.Section80EE` | integer | entered |  |
| `ITR1_IncomeDeductions.UsrDeductUndChapVIA.Section80EEA` | integer | entered |  |
| `ITR1_IncomeDeductions.UsrDeductUndChapVIA.Section80EEB` | integer | entered |  |
| `ITR1_IncomeDeductions.UsrDeductUndChapVIA.Section80G` | integer | entered |  |
| `ITR1_IncomeDeductions.UsrDeductUndChapVIA.Section80GG` | integer | entered |  |
| `ITR1_IncomeDeductions.UsrDeductUndChapVIA.Section80GGA` | integer | entered |  |
| `ITR1_IncomeDeductions.UsrDeductUndChapVIA.Section80GGC` | integer | entered |  |
| `ITR1_IncomeDeductions.UsrDeductUndChapVIA.Section80TTA` | integer | entered |  |
| `ITR1_IncomeDeductions.UsrDeductUndChapVIA.Section80TTB` | integer | entered |  |
| `ITR1_IncomeDeductions.UsrDeductUndChapVIA.Section80U` | integer | entered |  |
| `ITR1_IncomeDeductions.UsrDeductUndChapVIA.TotalChapVIADeductions` | integer | computed |  |
| `ITR1_TaxComputation.EducationCess` | integer | computed |  |
| `ITR1_TaxComputation.GrossTaxLiability` | integer | computed |  |
| `ITR1_TaxComputation.IntrstPay.IntrstPayUs234A` | integer | entered |  |
| `ITR1_TaxComputation.IntrstPay.IntrstPayUs234B` | integer | entered |  |
| `ITR1_TaxComputation.IntrstPay.IntrstPayUs234C` | integer | entered |  |
| `ITR1_TaxComputation.IntrstPay.LateFilingFee234F` | integer | entered |  |
| `ITR1_TaxComputation.NetTaxLiability` | integer | computed | Balance Tax After Relief |
| `ITR1_TaxComputation.Rebate87A` | integer | computed |  |
| `ITR1_TaxComputation.Section89` | integer | entered |  |
| `ITR1_TaxComputation.TaxPayableOnRebate` | integer | computed |  |
| `ITR1_TaxComputation.TotTaxPlusIntrstPay` | integer | computed |  |
| `ITR1_TaxComputation.TotalIntrstPay` | integer | computed |  |
| `ITR1_TaxComputation.TotalTaxPayable` | integer | computed |  |
| `PartB-ATI.AmtPayable` | integer | computed | Only in an updated return (condition `ReturnFileSec == 21`); otherwise left as entered and its absent parent is never created |
| `PersonalInfo.DOB` | string | entered | Date of Birth, YYYY-MM-DD |
| `PersonalInfo.PAN` | string | entered |  |
| `Refund.BankAccountDtls.AddtnlBankDetails[*].IFSCCode` | string | entered |  |
| `Refund.RefundDue` | integer | computed | Refund due if Total Taxes Paid exceeds the aggregate liability |
| `Schedule80D.Sec80DSelfFamSrCtznHealth` | object | entered |  |
| `Schedule80D.Sec80DSelfFamSrCtznHealth.EligibleAmountOfDedn` | integer | computed |  |
| `Schedule80D.Sec80DSelfFamSrCtznHealth.HealthInsPremSlfFam` | integer | entered |  |
| `Schedule80D.Sec80DSelfFamSrCtznHealth.HlthInsPremParents` | integer | entered |  |
| `Schedule80D.Sec80DSelfFamSrCtznHealth.HlthInsPremParentsSrCtzn` | integer | entered |  |
| `Schedule80D.Sec80DSelfFamSrCtznHealth.HlthInsPremSlfFamSrCtzn` | integer | entered |  |
| `Schedule80D.Sec80DSelfFamSrCtznHealth.MedicalExpParentsSrCtzn` | integer | entered |  |
| `Schedule80D.Sec80DSelfFamSrCtznHealth.MedicalExpSlfFamSrCtzn` | integer | entered |  |
| `Schedule80D.Sec80DSelfFamSrCtznHealth.Parents` | integer | computed |  |
| `Schedule80D.Sec80DSelfFamSrCtznHealth.ParentsSeniorCitizen` | integer | computed |  |
| `Schedule80D.Sec80DSelfFamSrCtznHealth.PrevHlthChckUpParents` | integer | entered |  |
| `Schedule80D.Sec80DSelfFamSrCtznHealth.PrevHlthChckUpParentsSrCtzn` | integer | entered |  |
| `Schedule80D.Sec80DSelfFamSrCtznHealth.PrevHlthChckUpSlfFam` | integer | entered |  |
| `Schedule80D.Sec80DSelfFamSrCtznHealth.PrevHlthChckUpSlfFamSrCtzn` | integer | entered |  |
| `Schedule80D.Sec80DSelfFamSrCtznHealth.SelfAndFamily` | integer | computed |  |
| `Schedule80D.Sec80DSelfFamSrCtznHealth.SelfAndFamilySeniorCitizen` | integer | computed |  |
| `Schedule80GGC.Schedule80GGCDetails[*].DonationAmt` | integer | computed | row-level |
| `Schedule80GGC.Schedule80GGCDetails[*].DonationAmtCash` | integer | entered |  |
| `Schedule80GGC.Schedule80GGCDetails[*].DonationAmtOtherMode` | integer | entered |  |
| `Schedule80GGC.Schedule80GGCDetails[*].EligibleDonationAmt` | integer | computed | row-level |
| `Schedule80GGC.TotalDonationAmtCash80GGC` | integer | computed |  |
| `Schedule80GGC.TotalDonationAmtOtherMode80GGC` | integer | computed |  |
| `Schedule80GGC.TotalDonationsUs80GGC` | integer | computed |  |
| `Schedule80GGC.TotalEligibleDonationAmt80GGC` | integer | computed |  |
| `ScheduleTCS.TCS[*].AmtTCSClaimedThisYear` | integer | entered | Amount out of (5) claimed for this year |
| `ScheduleTCS.TotalSchTCS` | integer | computed |  |
| `ScheduleTDS3Dtls.TDS3Details[*].TDSClaimed` | integer | entered |  |
| `ScheduleTDS3Dtls.TotalTDS3Details` | integer | computed |  |
| `TDSonOthThanSals.TDSonOthThanSal[*].ClaimOutOfTotTDSOnAmtPaid` | integer | entered |  |
| `TDSonOthThanSals.TDSonOthThanSal[*].TotTDSOnAmtPaid` | integer | entered |  |
| `TDSonOthThanSals.TotalTDSonOthThanSals` | integer | computed |  |
| `TDSonSalaries.TDSonSalary[*].TotalTDSSal` | integer | entered |  |
| `TDSonSalaries.TotalTDSonSalaries` | integer | computed |  |
| `TaxPaid.BalTaxPayable` | integer | computed |  |
| `TaxPaid.TaxesPaid.AdvanceTax` | integer | computed |  |
| `TaxPaid.TaxesPaid.SelfAssessmentTax` | integer | computed |  |
| `TaxPaid.TaxesPaid.TCS` | integer | computed |  |
| `TaxPaid.TaxesPaid.TDS` | integer | computed |  |
| `TaxPaid.TaxesPaid.TotalTaxesPaid` | integer | computed |  |
| `TaxPayments.TaxPayment[*].Amt` | integer | entered |  |
| `TaxPayments.TaxPayment[*].DateDep` | string | entered | Date of deposit, on or after 2023-04-01, YYYY-MM-DD |
| `TaxPayments.TotalTaxPayments` | integer | computed |  |
| `Verification.Capacity` | string | entered | S : Self ; R : Representative |
| `Verification.Declaration.AssesseeVerPAN` | string | entered |  |

## 16. Appendix B — Starter rule set (JSON)

Three arrays, one item per line for faithful copying; assemble into `starter.ruleset.json` as §13.2 shows. Copy **character-for-character** — ids, expressions (spaces around every `-`!), tolerances and conditions are all load-bearing; T8 fails on any drift. B.1 = `rules` (73), B.2 = `computations` (52), B.3 = `display`.

### B.1 Validation rules (73)

```json
[
{"id":"A47","name":"Gross salary (B1(i)) = 17(1) + 17(2) + 17(3) + 89A notified country + 89A other country","target":"ITR.ITR1.ITR1_IncomeDeductions.GrossSalary","check":{"kind":"compare","operator":"==","rhs":{"type":"expression","expression":"ITR.ITR1.ITR1_IncomeDeductions.Salary + ITR.ITR1.ITR1_IncomeDeductions.PerquisitesValue + ITR.ITR1.ITR1_IncomeDeductions.ProfitsInSalary + ITR.ITR1.ITR1_IncomeDeductions.IncomeNotified89A + ITR.ITR1.ITR1_IncomeDeductions.IncomeNotifiedOther89A"},"blankAsZero":true},"severity":"error","enabled":true,"ref":"CBDT ITR-1 AY2024-25 Sl. 47","group":"Part B – Salary and other sources (dropdowns)"},
{"id":"A62","name":"Allowances exempt u/s 10 (B1ii) = sum of the individual exempt allowances","target":"ITR.ITR1.ITR1_IncomeDeductions.AllwncExemptUs10.TotalAllwncExemptUs10","check":{"kind":"compare","operator":"==","rhs":{"type":"expression","expression":"sum(ITR.ITR1.ITR1_IncomeDeductions.AllwncExemptUs10.AllwncExemptUs10Dtls[*].SalOthAmount)"},"blankAsZero":true},"severity":"error","enabled":true,"ref":"CBDT ITR-1 AY2024-25 Sl. 62","group":"Part B – Salary"},
{"id":"A48","name":"Net salary (B1iii) = gross salary (B1i) − allowances exempt u/s 10 (B1ii) − relief u/s 89A (B1iia)","target":"ITR.ITR1.ITR1_IncomeDeductions.NetSalary","check":{"kind":"compare","operator":"==","rhs":{"type":"expression","expression":"ITR.ITR1.ITR1_IncomeDeductions.GrossSalary - ITR.ITR1.ITR1_IncomeDeductions.AllwncExemptUs10.TotalAllwncExemptUs10 - ITR.ITR1.ITR1_IncomeDeductions.Increliefus89A"},"blankAsZero":true},"severity":"error","enabled":true,"ref":"CBDT ITR-1 AY2024-25 Sl. 48","notes":"Income claimed for relief u/s 89A (B1iia) is also subtracted, as per the form (iii = i − ii − iia).","group":"Part B – Salary"},
{"id":"A63","name":"Standard deduction u/s 16(ia) ≤ lower of Rs 50,000 and net salary","target":"ITR.ITR1.ITR1_IncomeDeductions.DeductionUs16ia","check":{"kind":"compare","operator":"<=","rhs":{"type":"expression","expression":"min(50000, ITR.ITR1.ITR1_IncomeDeductions.NetSalary)"},"blankAsZero":false},"severity":"error","enabled":true,"ref":"CBDT ITR-1 AY2024-25 Sl. 63","notes":"\"Total salary\" read as net salary (B1iii), the amount from which the deduction is made.","group":"Part B – Salary"},
{"id":"A49","name":"Deductions u/s 16 (B1 iv) = standard deduction + entertainment allowance + professional tax","target":"ITR.ITR1.ITR1_IncomeDeductions.DeductionUs16","check":{"kind":"compare","operator":"==","rhs":{"type":"expression","expression":"ITR.ITR1.ITR1_IncomeDeductions.DeductionUs16ia + ITR.ITR1.ITR1_IncomeDeductions.EntertainmentAlw16ii + ITR.ITR1.ITR1_IncomeDeductions.ProfessionalTaxUs16iii"},"blankAsZero":true},"severity":"error","enabled":true,"ref":"CBDT ITR-1 AY2024-25 Sl. 49","group":"Part B/C – totals"},
{"id":"A50","name":"Income chargeable under Salaries (B1v) = net salary (B1iii) − deductions u/s 16 (B1iv)","target":"ITR.ITR1.ITR1_IncomeDeductions.IncomeFromSal","check":{"kind":"compare","operator":"==","rhs":{"type":"expression","expression":"ITR.ITR1.ITR1_IncomeDeductions.NetSalary - ITR.ITR1.ITR1_IncomeDeductions.DeductionUs16"},"blankAsZero":true},"severity":"error","enabled":true,"ref":"CBDT ITR-1 AY2024-25 Sl. 50","group":"Part B – Salary"},
{"id":"A34","name":"Annual value (B2iii) = gross rent (B2i) − tax paid to local authorities (B2ii)","target":"ITR.ITR1.ITR1_IncomeDeductions.AnnualValue","check":{"kind":"compare","operator":"==","rhs":{"type":"expression","expression":"ITR.ITR1.ITR1_IncomeDeductions.GrossRentReceived - ITR.ITR1.ITR1_IncomeDeductions.TaxPaidlocalAuth"},"blankAsZero":true},"severity":"error","enabled":true,"ref":"CBDT ITR-1 AY2024-25 Sl. 34","group":"Part B – House Property"},
{"id":"A31","name":"Standard deduction (B2iv) = 30% of annual value (B2iii)","target":"ITR.ITR1.ITR1_IncomeDeductions.StandardDeduction","check":{"kind":"compare","operator":"==","rhs":{"type":"expression","expression":"round(0.3 * max(0, ITR.ITR1.ITR1_IncomeDeductions.AnnualValue))"},"blankAsZero":true,"tolerance":1},"severity":"error","enabled":true,"ref":"CBDT ITR-1 AY2024-25 Sl. 31","notes":"A negative annual value gives no 30% deduction.","group":"Part B – House Property"},
{"id":"A35","name":"Income under House Property (B2vii) = B2iii − B2iv − B2v + B2vi","target":"ITR.ITR1.ITR1_IncomeDeductions.TotalIncomeOfHP","check":{"kind":"compare","operator":"==","rhs":{"type":"expression","expression":"ITR.ITR1.ITR1_IncomeDeductions.AnnualValue - ITR.ITR1.ITR1_IncomeDeductions.StandardDeduction - ITR.ITR1.ITR1_IncomeDeductions.InterestPayable + ITR.ITR1.ITR1_IncomeDeductions.ArrearsUnrealizedRentRcvd"},"blankAsZero":true},"severity":"error","enabled":true,"ref":"CBDT ITR-1 AY2024-25 Sl. 35","group":"Part B – House Property"},
{"id":"A40","name":"Income from other sources (B3) = sum of the individual other-source incomes","target":"ITR.ITR1.ITR1_IncomeDeductions.IncomeOthSrc","check":{"kind":"compare","operator":"==","rhs":{"type":"expression","expression":"sum(ITR.ITR1.ITR1_IncomeDeductions.OthersInc.OthersIncDtlsOthSrc[*].OthSrcOthAmount)"},"blankAsZero":true},"severity":"error","enabled":true,"ref":"CBDT ITR-1 AY2024-25 Sl. 40","group":"Part B – Other Sources"},
{"id":"A41","name":"Deduction u/s 57(iia) only when family pension is offered under other sources","target":"ITR.ITR1.ITR1_IncomeDeductions.DeductionUs57iia","check":{"kind":"compare","operator":"<=","rhs":{"type":"literal","value":0}},"severity":"error","enabled":true,"ref":"CBDT ITR-1 AY2024-25 Sl. 41","condition":{"expression":"(sumif(ITR.ITR1.ITR1_IncomeDeductions.OthersInc.OthersIncDtlsOthSrc[*].OthSrcOthAmount, ITR.ITR1.ITR1_IncomeDeductions.OthersInc.OthersIncDtlsOthSrc[*].OthSrcNatureDesc == \"FAP\") <= 0)"},"notes":"Family pension = other-sources rows with nature FAP.","group":"Part B/C – totals"},
{"id":"A42","name":"Deduction u/s 57(iia) ≤ lower of 1/3rd of family pension and Rs 15,000","target":"ITR.ITR1.ITR1_IncomeDeductions.DeductionUs57iia","check":{"kind":"compare","operator":"<=","rhs":{"type":"expression","expression":"min(floor(sumif(ITR.ITR1.ITR1_IncomeDeductions.OthersInc.OthersIncDtlsOthSrc[*].OthSrcOthAmount, ITR.ITR1.ITR1_IncomeDeductions.OthersInc.OthersIncDtlsOthSrc[*].OthSrcNatureDesc == \"FAP\") / 3) + 1, 15000)"},"blankAsZero":false},"severity":"error","enabled":true,"ref":"CBDT ITR-1 AY2024-25 Sl. 42","notes":"+1 rounding allowance on the one-third.","group":"Part B/C – totals"},
{"id":"A7","name":"Old regime: gross total income = salary + house property + other sources","target":"ITR.ITR1.ITR1_IncomeDeductions.GrossTotIncome","check":{"kind":"compare","operator":"==","rhs":{"type":"expression","expression":"ITR.ITR1.ITR1_IncomeDeductions.IncomeFromSal + ITR.ITR1.ITR1_IncomeDeductions.TotalIncomeOfHP + (ITR.ITR1.ITR1_IncomeDeductions.IncomeOthSrc - ITR.ITR1.ITR1_IncomeDeductions.DeductionUs57iia - ITR.ITR1.ITR1_IncomeDeductions.Increliefus89AOS)"},"blankAsZero":true},"severity":"error","enabled":true,"ref":"CBDT ITR-1 AY2024-25 Sl. 7","condition":{"expression":"(ITR.ITR1.FilingStatus.OptOutNewTaxRegime == \"Y\")"},"notes":"Other sources taken net of deduction u/s 57(iia) and relief u/s 89A (the two \"Less\" lines under B3), because B3 itself is the gross dropdown total (Sl. 40).","group":"Part B – Gross Total Income"},
{"id":"A8","name":"Default (new) regime with house property loss: gross total income = salary + other sources (loss ignored)","target":"ITR.ITR1.ITR1_IncomeDeductions.GrossTotIncome","check":{"kind":"compare","operator":"==","rhs":{"type":"expression","expression":"ITR.ITR1.ITR1_IncomeDeductions.IncomeFromSal + (ITR.ITR1.ITR1_IncomeDeductions.IncomeOthSrc - ITR.ITR1.ITR1_IncomeDeductions.DeductionUs57iia - ITR.ITR1.ITR1_IncomeDeductions.Increliefus89AOS)"},"blankAsZero":true},"severity":"error","enabled":true,"ref":"CBDT ITR-1 AY2024-25 Sl. 8","condition":{"expression":"(ITR.ITR1.FilingStatus.OptOutNewTaxRegime == \"N\") and (ITR.ITR1.ITR1_IncomeDeductions.TotalIncomeOfHP < 0)"},"notes":"Loss under house property cannot be set off against other heads u/s 115BAC. Other sources net of 57(iia) and 89A relief (see Sl. 7).","group":"Part B – Gross Total Income"},
{"id":"A83","name":"Default (new) regime with positive house property income: gross total income = salary + house property + other sources","target":"ITR.ITR1.ITR1_IncomeDeductions.GrossTotIncome","check":{"kind":"compare","operator":"==","rhs":{"type":"expression","expression":"ITR.ITR1.ITR1_IncomeDeductions.IncomeFromSal + ITR.ITR1.ITR1_IncomeDeductions.TotalIncomeOfHP + (ITR.ITR1.ITR1_IncomeDeductions.IncomeOthSrc - ITR.ITR1.ITR1_IncomeDeductions.DeductionUs57iia - ITR.ITR1.ITR1_IncomeDeductions.Increliefus89AOS)"},"blankAsZero":true},"severity":"error","enabled":true,"ref":"CBDT ITR-1 AY2024-25 Sl. 83","condition":{"expression":"(ITR.ITR1.FilingStatus.OptOutNewTaxRegime == \"N\") and (ITR.ITR1.ITR1_IncomeDeductions.TotalIncomeOfHP >= 0)"},"notes":"Other sources net of 57(iia) and 89A relief (see Sl. 7).","group":"Part B – Gross Total Income"},
{"id":"A18","name":"Exempt income total = sum of the individual exempt incomes","target":"ITR.ITR1.ITR1_IncomeDeductions.ExemptIncAgriOthUs10.ExemptIncAgriOthUs10Total","check":{"kind":"compare","operator":"==","rhs":{"type":"expression","expression":"sum(ITR.ITR1.ITR1_IncomeDeductions.ExemptIncAgriOthUs10.ExemptIncAgriOthUs10Dtls[*].OthAmount)"},"blankAsZero":true},"severity":"error","enabled":true,"ref":"CBDT ITR-1 AY2024-25 Sl. 18","group":"Exempt Income"},
{"id":"A90","name":"80D: preventive health check-up (all four fields together) ≤ Rs 5,000","target":"ITR.ITR1.Schedule80D.Sec80DSelfFamSrCtznHealth","check":{"kind":"assert","expression":"ITR.ITR1.Schedule80D.Sec80DSelfFamSrCtznHealth.PrevHlthChckUpSlfFam + ITR.ITR1.Schedule80D.Sec80DSelfFamSrCtznHealth.PrevHlthChckUpSlfFamSrCtzn + ITR.ITR1.Schedule80D.Sec80DSelfFamSrCtznHealth.PrevHlthChckUpParents + ITR.ITR1.Schedule80D.Sec80DSelfFamSrCtznHealth.PrevHlthChckUpParentsSrCtzn <= 5000"},"severity":"error","enabled":true,"ref":"CBDT ITR-1 AY2024-25 Sl. 90","group":"Schedule 80D"},
{"id":"A141","name":"80D 1a = health insurance premium (i) + preventive check-up (ii), capped at Rs 25,000","target":"ITR.ITR1.Schedule80D.Sec80DSelfFamSrCtznHealth.SelfAndFamily","check":{"kind":"compare","operator":"==","rhs":{"type":"expression","expression":"min(ITR.ITR1.Schedule80D.Sec80DSelfFamSrCtznHealth.HealthInsPremSlfFam + ITR.ITR1.Schedule80D.Sec80DSelfFamSrCtznHealth.PrevHlthChckUpSlfFam, 25000)"},"blankAsZero":true},"severity":"error","enabled":true,"ref":"CBDT ITR-1 AY2024-25 Sl. 141","notes":"The cap is folded into the equality so an above-cap break-up with a capped 1a passes.","group":"Schedule 80D"},
{"id":"A142","name":"80D 1b (self & family, senior citizen) ≤ Rs 50,000","target":"ITR.ITR1.Schedule80D.Sec80DSelfFamSrCtznHealth.SelfAndFamilySeniorCitizen","check":{"kind":"compare","operator":"<=","rhs":{"type":"literal","value":50000}},"severity":"error","enabled":true,"ref":"CBDT ITR-1 AY2024-25 Sl. 142","group":"Schedule 80D"},
{"id":"A143","name":"80D 1b = premium (i) + check-up (ii) + medical expenditure (iii), capped at Rs 50,000","target":"ITR.ITR1.Schedule80D.Sec80DSelfFamSrCtznHealth.SelfAndFamilySeniorCitizen","check":{"kind":"compare","operator":"==","rhs":{"type":"expression","expression":"min(ITR.ITR1.Schedule80D.Sec80DSelfFamSrCtznHealth.HlthInsPremSlfFamSrCtzn + ITR.ITR1.Schedule80D.Sec80DSelfFamSrCtznHealth.PrevHlthChckUpSlfFamSrCtzn + ITR.ITR1.Schedule80D.Sec80DSelfFamSrCtznHealth.MedicalExpSlfFamSrCtzn, 50000)"},"blankAsZero":true},"severity":"error","enabled":true,"ref":"CBDT ITR-1 AY2024-25 Sl. 143","group":"Schedule 80D"},
{"id":"A144","name":"80D 2a (parents) ≤ Rs 25,000","target":"ITR.ITR1.Schedule80D.Sec80DSelfFamSrCtznHealth.Parents","check":{"kind":"compare","operator":"<=","rhs":{"type":"literal","value":25000}},"severity":"error","enabled":true,"ref":"CBDT ITR-1 AY2024-25 Sl. 144","group":"Schedule 80D"},
{"id":"A145","name":"80D 2a = premium (i) + preventive check-up (ii), capped at Rs 25,000","target":"ITR.ITR1.Schedule80D.Sec80DSelfFamSrCtznHealth.Parents","check":{"kind":"compare","operator":"==","rhs":{"type":"expression","expression":"min(ITR.ITR1.Schedule80D.Sec80DSelfFamSrCtznHealth.HlthInsPremParents + ITR.ITR1.Schedule80D.Sec80DSelfFamSrCtznHealth.PrevHlthChckUpParents, 25000)"},"blankAsZero":true},"severity":"error","enabled":true,"ref":"CBDT ITR-1 AY2024-25 Sl. 145","group":"Schedule 80D"},
{"id":"A146","name":"80D 2b (parents, senior citizen) ≤ Rs 50,000","target":"ITR.ITR1.Schedule80D.Sec80DSelfFamSrCtznHealth.ParentsSeniorCitizen","check":{"kind":"compare","operator":"<=","rhs":{"type":"literal","value":50000}},"severity":"error","enabled":true,"ref":"CBDT ITR-1 AY2024-25 Sl. 146","group":"Schedule 80D"},
{"id":"A147","name":"80D 2b = premium (i) + check-up (ii) + medical expenditure (iii), capped at Rs 50,000","target":"ITR.ITR1.Schedule80D.Sec80DSelfFamSrCtznHealth.ParentsSeniorCitizen","check":{"kind":"compare","operator":"==","rhs":{"type":"expression","expression":"min(ITR.ITR1.Schedule80D.Sec80DSelfFamSrCtznHealth.HlthInsPremParentsSrCtzn + ITR.ITR1.Schedule80D.Sec80DSelfFamSrCtznHealth.PrevHlthChckUpParentsSrCtzn + ITR.ITR1.Schedule80D.Sec80DSelfFamSrCtznHealth.MedicalExpParentsSrCtzn, 50000)"},"blankAsZero":true},"severity":"error","enabled":true,"ref":"CBDT ITR-1 AY2024-25 Sl. 147","notes":"The document checks the equality only below Rs 50,000; folding the cap into min() is equivalent.","group":"Schedule 80D"},
{"id":"A148","name":"80D 3 eligible amount ≤ Rs 1,00,000","target":"ITR.ITR1.Schedule80D.Sec80DSelfFamSrCtznHealth.EligibleAmountOfDedn","check":{"kind":"compare","operator":"<=","rhs":{"type":"literal","value":100000}},"severity":"error","enabled":true,"ref":"CBDT ITR-1 AY2024-25 Sl. 148","group":"Schedule 80D"},
{"id":"A149","name":"80D 3 eligible amount = 1a + 1b + 2a + 2b, capped at Rs 1,00,000 and at gross total income","target":"ITR.ITR1.Schedule80D.Sec80DSelfFamSrCtznHealth.EligibleAmountOfDedn","check":{"kind":"compare","operator":"==","rhs":{"type":"expression","expression":"min(ITR.ITR1.Schedule80D.Sec80DSelfFamSrCtznHealth.SelfAndFamily + ITR.ITR1.Schedule80D.Sec80DSelfFamSrCtznHealth.SelfAndFamilySeniorCitizen + ITR.ITR1.Schedule80D.Sec80DSelfFamSrCtznHealth.Parents + ITR.ITR1.Schedule80D.Sec80DSelfFamSrCtznHealth.ParentsSeniorCitizen, 100000, if(exists(ITR.ITR1.ITR1_IncomeDeductions.GrossTotIncome), max(0, ITR.ITR1.ITR1_IncomeDeductions.GrossTotIncome), 99999999999999))"},"blankAsZero":true},"severity":"error","enabled":true,"ref":"CBDT ITR-1 AY2024-25 Sl. 149","group":"Schedule 80D"},
{"id":"A179","name":"Deduction u/s 80GGC in Part C = eligible amount of contribution in Schedule 80GGC","target":"ITR.ITR1.ITR1_IncomeDeductions.DeductUndChapVIA.Section80GGC","check":{"kind":"compare","operator":"==","rhs":{"type":"expression","expression":"ITR.ITR1.Schedule80GGC.TotalEligibleDonationAmt80GGC"},"blankAsZero":true},"severity":"error","enabled":true,"ref":"CBDT ITR-1 AY2024-25 Sl. 179","condition":{"expression":"(ITR.ITR1.FilingStatus.OptOutNewTaxRegime == \"Y\")"},"notes":"Old regime only (s.115BAC(2)); see rule Aderived80GGC-sch.","group":"Schedule 80GGC"},
{"id":"A180","name":"80GGC: eligible amount per row = lower of contribution in other mode and gross total income","target":"ITR.ITR1.Schedule80GGC.Schedule80GGCDetails[*].EligibleDonationAmt","check":{"kind":"compare","operator":"==","rhs":{"type":"expression","expression":"min(ITR.ITR1.Schedule80GGC.Schedule80GGCDetails[*].DonationAmtOtherMode, if(exists(ITR.ITR1.ITR1_IncomeDeductions.GrossTotIncome), max(0, ITR.ITR1.ITR1_IncomeDeductions.GrossTotIncome), 99999999999999))"},"blankAsZero":true},"severity":"error","enabled":true,"ref":"CBDT ITR-1 AY2024-25 Sl. 180","group":"Schedule 80GGC"},
{"id":"A181","name":"80GGC: total contribution = contribution in cash + contribution in other mode","target":"ITR.ITR1.Schedule80GGC.Schedule80GGCDetails[*].DonationAmt","check":{"kind":"compare","operator":"==","rhs":{"type":"expression","expression":"ITR.ITR1.Schedule80GGC.Schedule80GGCDetails[*].DonationAmtCash + ITR.ITR1.Schedule80GGC.Schedule80GGCDetails[*].DonationAmtOtherMode"},"blankAsZero":true},"severity":"error","enabled":true,"ref":"CBDT ITR-1 AY2024-25 Sl. 181","group":"Schedule 80GGC"},
{"id":"A182","name":"80GGC: total eligible amount = sum of the rows’ eligible amounts, restricted to gross total income","target":"ITR.ITR1.Schedule80GGC.TotalEligibleDonationAmt80GGC","check":{"kind":"compare","operator":"==","rhs":{"type":"expression","expression":"min(sum(ITR.ITR1.Schedule80GGC.Schedule80GGCDetails[*].EligibleDonationAmt), if(exists(ITR.ITR1.ITR1_IncomeDeductions.GrossTotIncome), max(0, ITR.ITR1.ITR1_IncomeDeductions.GrossTotIncome), 99999999999999))"},"blankAsZero":true},"severity":"error","enabled":true,"ref":"CBDT ITR-1 AY2024-25 Sl. 182","group":"Schedule 80GGC"}
]
```

*(B.1 continues — rules 31–73 — in the next block; concatenate the two blocks into one array, replacing the closing `]` above with a comma.)*

```json
[
{"id":"AderivedVIA-usr-total","name":"Total of deductions claimed (user block) = sum of the individual claimed amounts","target":"ITR.ITR1.ITR1_IncomeDeductions.UsrDeductUndChapVIA.TotalChapVIADeductions","check":{"kind":"compare","operator":"==","rhs":{"type":"expression","expression":"ITR.ITR1.ITR1_IncomeDeductions.UsrDeductUndChapVIA.Section80C + ITR.ITR1.ITR1_IncomeDeductions.UsrDeductUndChapVIA.Section80CCC + ITR.ITR1.ITR1_IncomeDeductions.UsrDeductUndChapVIA.Section80CCDEmployeeOrSE + ITR.ITR1.ITR1_IncomeDeductions.UsrDeductUndChapVIA.Section80CCD1B + ITR.ITR1.ITR1_IncomeDeductions.UsrDeductUndChapVIA.Section80CCDEmployer + ITR.ITR1.ITR1_IncomeDeductions.UsrDeductUndChapVIA.Section80D + ITR.ITR1.ITR1_IncomeDeductions.UsrDeductUndChapVIA.Section80DD + ITR.ITR1.ITR1_IncomeDeductions.UsrDeductUndChapVIA.Section80DDB + ITR.ITR1.ITR1_IncomeDeductions.UsrDeductUndChapVIA.Section80E + ITR.ITR1.ITR1_IncomeDeductions.UsrDeductUndChapVIA.Section80EE + ITR.ITR1.ITR1_IncomeDeductions.UsrDeductUndChapVIA.Section80EEA + ITR.ITR1.ITR1_IncomeDeductions.UsrDeductUndChapVIA.Section80EEB + ITR.ITR1.ITR1_IncomeDeductions.UsrDeductUndChapVIA.Section80G + ITR.ITR1.ITR1_IncomeDeductions.UsrDeductUndChapVIA.Section80GG + ITR.ITR1.ITR1_IncomeDeductions.UsrDeductUndChapVIA.Section80GGA + ITR.ITR1.ITR1_IncomeDeductions.UsrDeductUndChapVIA.Section80GGC + ITR.ITR1.ITR1_IncomeDeductions.UsrDeductUndChapVIA.Section80TTA + ITR.ITR1.ITR1_IncomeDeductions.UsrDeductUndChapVIA.Section80TTB + ITR.ITR1.ITR1_IncomeDeductions.UsrDeductUndChapVIA.Section80U + ITR.ITR1.ITR1_IncomeDeductions.UsrDeductUndChapVIA.AnyOthSec80CCH"},"blankAsZero":true},"severity":"error","enabled":true,"ref":"Derived from form arithmetic / schema","notes":"UsrDeductUndChapVIA holds the amounts as typed; its total is a plain sum (the GTI restriction applies to DeductUndChapVIA, Sl. 112).","group":"Part B/C – totals"},
{"id":"A91","name":"Deductions u/s 80C + 80CCC + 80CCD(1) ≤ Rs 1,50,000","target":"ITR.ITR1.ITR1_IncomeDeductions.DeductUndChapVIA","check":{"kind":"assert","expression":"ITR.ITR1.ITR1_IncomeDeductions.DeductUndChapVIA.Section80C + ITR.ITR1.ITR1_IncomeDeductions.DeductUndChapVIA.Section80CCC + ITR.ITR1.ITR1_IncomeDeductions.DeductUndChapVIA.Section80CCDEmployeeOrSE <= 150000"},"severity":"error","enabled":true,"ref":"CBDT ITR-1 AY2024-25 Sl. 91","group":"Part C – Chapter VI-A caps"},
{"id":"A104","name":"Deduction u/s 80TTA ≤ Rs 10,000","target":"ITR.ITR1.ITR1_IncomeDeductions.DeductUndChapVIA.Section80TTA","check":{"kind":"compare","operator":"<=","rhs":{"type":"literal","value":10000}},"severity":"error","enabled":true,"ref":"CBDT ITR-1 AY2024-25 Sl. 104","group":"Part C – Chapter VI-A caps"},
{"id":"A105","name":"Deduction u/s 80TTA ≤ interest from savings account under other sources","target":"ITR.ITR1.ITR1_IncomeDeductions.DeductUndChapVIA.Section80TTA","check":{"kind":"compare","operator":"<=","rhs":{"type":"expression","expression":"sumif(ITR.ITR1.ITR1_IncomeDeductions.OthersInc.OthersIncDtlsOthSrc[*].OthSrcOthAmount, ITR.ITR1.ITR1_IncomeDeductions.OthersInc.OthersIncDtlsOthSrc[*].OthSrcNatureDesc == \"SAV\")"},"blankAsZero":false},"severity":"error","enabled":true,"ref":"CBDT ITR-1 AY2024-25 Sl. 105","notes":"Savings interest = other-sources rows with nature SAV.","group":"Part C – Chapter VI-A caps"},
{"id":"A106","name":"Senior citizen cannot claim deduction u/s 80TTA (80TTB applies instead)","target":"ITR.ITR1.ITR1_IncomeDeductions.DeductUndChapVIA.Section80TTA","check":{"kind":"compare","operator":"<=","rhs":{"type":"literal","value":0}},"severity":"error","enabled":true,"ref":"CBDT ITR-1 AY2024-25 Sl. 106","condition":{"expression":"(ITR.ITR1.PersonalInfo.DOB <= \"1964-04-01\")"},"notes":"Senior = 60 or more during FY 2023-24, i.e. DOB on or before 1964-04-01 (the document's \"on or after 02.04.1964\" is the non-senior side).","group":"Part C – Chapter VI-A caps"},
{"id":"A107","name":"Deduction u/s 80TTB ≤ Rs 50,000","target":"ITR.ITR1.ITR1_IncomeDeductions.DeductUndChapVIA.Section80TTB","check":{"kind":"compare","operator":"<=","rhs":{"type":"literal","value":50000}},"severity":"error","enabled":true,"ref":"CBDT ITR-1 AY2024-25 Sl. 107","group":"Part C – Chapter VI-A caps"},
{"id":"A108","name":"Deduction u/s 80TTB only for senior citizens (DOB on or before 1964-04-01)","target":"ITR.ITR1.ITR1_IncomeDeductions.DeductUndChapVIA.Section80TTB","check":{"kind":"compare","operator":"<=","rhs":{"type":"literal","value":0}},"severity":"error","enabled":true,"ref":"CBDT ITR-1 AY2024-25 Sl. 108","condition":{"expression":"(ITR.ITR1.PersonalInfo.DOB > \"1964-04-01\")"},"group":"Part C – Chapter VI-A caps"},
{"id":"A112","name":"Total Chapter VI-A deductions (B5) = sum of the individual deductions, restricted to gross total income","target":"ITR.ITR1.ITR1_IncomeDeductions.DeductUndChapVIA.TotalChapVIADeductions","check":{"kind":"compare","operator":"==","rhs":{"type":"expression","expression":"min(ITR.ITR1.ITR1_IncomeDeductions.DeductUndChapVIA.Section80C + ITR.ITR1.ITR1_IncomeDeductions.DeductUndChapVIA.Section80CCC + ITR.ITR1.ITR1_IncomeDeductions.DeductUndChapVIA.Section80CCDEmployeeOrSE + ITR.ITR1.ITR1_IncomeDeductions.DeductUndChapVIA.Section80CCD1B + ITR.ITR1.ITR1_IncomeDeductions.DeductUndChapVIA.Section80CCDEmployer + ITR.ITR1.ITR1_IncomeDeductions.DeductUndChapVIA.Section80D + ITR.ITR1.ITR1_IncomeDeductions.DeductUndChapVIA.Section80DD + ITR.ITR1.ITR1_IncomeDeductions.DeductUndChapVIA.Section80DDB + ITR.ITR1.ITR1_IncomeDeductions.DeductUndChapVIA.Section80E + ITR.ITR1.ITR1_IncomeDeductions.DeductUndChapVIA.Section80EE + ITR.ITR1.ITR1_IncomeDeductions.DeductUndChapVIA.Section80EEA + ITR.ITR1.ITR1_IncomeDeductions.DeductUndChapVIA.Section80EEB + ITR.ITR1.ITR1_IncomeDeductions.DeductUndChapVIA.Section80G + ITR.ITR1.ITR1_IncomeDeductions.DeductUndChapVIA.Section80GG + ITR.ITR1.ITR1_IncomeDeductions.DeductUndChapVIA.Section80GGA + ITR.ITR1.ITR1_IncomeDeductions.DeductUndChapVIA.Section80GGC + ITR.ITR1.ITR1_IncomeDeductions.DeductUndChapVIA.Section80TTA + ITR.ITR1.ITR1_IncomeDeductions.DeductUndChapVIA.Section80TTB + ITR.ITR1.ITR1_IncomeDeductions.DeductUndChapVIA.Section80U + ITR.ITR1.ITR1_IncomeDeductions.DeductUndChapVIA.AnyOthSec80CCH, if(exists(ITR.ITR1.ITR1_IncomeDeductions.GrossTotIncome), max(0, ITR.ITR1.ITR1_IncomeDeductions.GrossTotIncome), 99999999999999))"},"blankAsZero":true},"severity":"error","enabled":true,"ref":"CBDT ITR-1 AY2024-25 Sl. 112","group":"Part B/C – totals"},
{"id":"A12","name":"Total income = Gross total income − total Chapter VI-A deductions (not below zero)","target":"ITR.ITR1.ITR1_IncomeDeductions.TotalIncome","check":{"kind":"compare","operator":"==","rhs":{"type":"expression","expression":"max(0, ITR.ITR1.ITR1_IncomeDeductions.GrossTotIncome - ITR.ITR1.ITR1_IncomeDeductions.DeductUndChapVIA.TotalChapVIADeductions)"},"blankAsZero":true,"tolerance":5},"severity":"error","enabled":true,"ref":"CBDT ITR-1 AY2024-25 Sl. 12","notes":"Tolerance ±5: total income is rounded to the nearest Rs 10 (s.288A).","group":"Part B/C – totals"},
{"id":"A64","name":"Total income cannot exceed Rs 50 lakh in ITR-1","target":"ITR.ITR1.ITR1_IncomeDeductions.TotalIncome","check":{"kind":"compare","operator":"<=","rhs":{"type":"literal","value":5000000}},"severity":"error","enabled":true,"ref":"CBDT ITR-1 AY2024-25 Sl. 64","group":"Part B – Gross Total Income"}
]
```

*(B.1 continues — rules 42–73, Part D and schedules — in the third block, same concatenation rule.)*

```json
[
{"id":"A9","name":"Old regime: rebate u/s 87A not available when total income exceeds Rs 5,00,000","target":"ITR.ITR1.ITR1_TaxComputation.Rebate87A","check":{"kind":"compare","operator":"<=","rhs":{"type":"literal","value":0}},"severity":"error","enabled":true,"ref":"CBDT ITR-1 AY2024-25 Sl. 9","condition":{"expression":"(ITR.ITR1.FilingStatus.OptOutNewTaxRegime == \"Y\") and (ITR.ITR1.ITR1_IncomeDeductions.TotalIncome > 500000)"},"group":"Part D – Tax computation"},
{"id":"A10","name":"Old regime: rebate u/s 87A cannot exceed Rs 12,500 (nor the tax payable)","target":"ITR.ITR1.ITR1_TaxComputation.Rebate87A","check":{"kind":"compare","operator":"<=","rhs":{"type":"expression","expression":"min(12500, ITR.ITR1.ITR1_TaxComputation.TotalTaxPayable)"},"blankAsZero":false},"severity":"error","enabled":true,"ref":"CBDT ITR-1 AY2024-25 Sl. 10","condition":{"expression":"(ITR.ITR1.FilingStatus.OptOutNewTaxRegime == \"Y\")"},"notes":"The rebate is also capped at the tax payable on total income (D1) since it cannot create a negative tax.","group":"Part D – Tax computation"},
{"id":"A11","name":"New regime: rebate u/s 87A above Rs 7,00,000 limited to marginal relief (tax − excess income over 7 lakh)","target":"ITR.ITR1.ITR1_TaxComputation.Rebate87A","check":{"kind":"compare","operator":"<=","rhs":{"type":"expression","expression":"max(0, ITR.ITR1.ITR1_TaxComputation.TotalTaxPayable - (ITR.ITR1.ITR1_IncomeDeductions.TotalIncome - 700000))"},"blankAsZero":false},"severity":"error","enabled":true,"ref":"CBDT ITR-1 AY2024-25 Sl. 11","condition":{"expression":"(ITR.ITR1.FilingStatus.OptOutNewTaxRegime == \"N\") and (ITR.ITR1.ITR1_IncomeDeductions.TotalIncome > 700000)"},"notes":"Marginal rebate (proviso to s.87A): when total income exceeds 7 lakh the rebate cannot exceed tax payable minus the excess of income over 7 lakh; beyond ~7.28 lakh this forces the rebate to zero.","group":"Part D – Tax computation"},
{"id":"A11cap","name":"New regime: rebate u/s 87A cannot exceed Rs 25,000 (nor the tax payable)","target":"ITR.ITR1.ITR1_TaxComputation.Rebate87A","check":{"kind":"compare","operator":"<=","rhs":{"type":"expression","expression":"min(25000, ITR.ITR1.ITR1_TaxComputation.TotalTaxPayable)"},"blankAsZero":false},"severity":"error","enabled":true,"ref":"CBDT ITR-1 AY2024-25 Sl. 11","condition":{"expression":"(ITR.ITR1.FilingStatus.OptOutNewTaxRegime == \"N\")"},"group":"Part D – Tax computation"},
{"id":"A13","name":"Tax after rebate (D3) = tax payable on total income (D1) − rebate u/s 87A (D2)","target":"ITR.ITR1.ITR1_TaxComputation.TaxPayableOnRebate","check":{"kind":"compare","operator":"==","rhs":{"type":"expression","expression":"ITR.ITR1.ITR1_TaxComputation.TotalTaxPayable - ITR.ITR1.ITR1_TaxComputation.Rebate87A"},"blankAsZero":true},"severity":"error","enabled":true,"ref":"CBDT ITR-1 AY2024-25 Sl. 13","group":"Part D – Tax computation"},
{"id":"Aderivedcess","name":"Health & education cess (D4) = 4% of tax after rebate (D3)","target":"ITR.ITR1.ITR1_TaxComputation.EducationCess","check":{"kind":"compare","operator":"==","rhs":{"type":"expression","expression":"round(0.04 * ITR.ITR1.ITR1_TaxComputation.TaxPayableOnRebate)"},"blankAsZero":true,"tolerance":1},"severity":"error","enabled":true,"ref":"Derived from form arithmetic / schema","notes":"Derived from the form: ITR-1 has no surcharge, so cess is 4% of D3 (±1 for rounding).","group":"Part D – Tax computation"},
{"id":"A14","name":"Total tax and cess (D5) = tax after rebate (D3) + health & education cess (D4)","target":"ITR.ITR1.ITR1_TaxComputation.GrossTaxLiability","check":{"kind":"compare","operator":"==","rhs":{"type":"expression","expression":"ITR.ITR1.ITR1_TaxComputation.TaxPayableOnRebate + ITR.ITR1.ITR1_TaxComputation.EducationCess"},"blankAsZero":true},"severity":"error","enabled":true,"ref":"CBDT ITR-1 AY2024-25 Sl. 14","group":"Part D – Tax computation"},
{"id":"AderivedD7","name":"Balance tax after relief (D7) = total tax and cess (D5) − relief u/s 89 (D6)","target":"ITR.ITR1.ITR1_TaxComputation.NetTaxLiability","check":{"kind":"compare","operator":"==","rhs":{"type":"expression","expression":"ITR.ITR1.ITR1_TaxComputation.GrossTaxLiability - ITR.ITR1.ITR1_TaxComputation.Section89"},"blankAsZero":true},"severity":"error","enabled":true,"ref":"Derived from form arithmetic / schema","notes":"Derived from the form arithmetic; together with Sl. 15 and Sl. 66 this keeps D5–D9 consistent.","group":"Part D – Tax computation"},
{"id":"A16","name":"Total interest and fee payable (D8) = 234A + 234B + 234C + 234F","target":"ITR.ITR1.ITR1_TaxComputation.TotalIntrstPay","check":{"kind":"compare","operator":"==","rhs":{"type":"expression","expression":"ITR.ITR1.ITR1_TaxComputation.IntrstPay.IntrstPayUs234A + ITR.ITR1.ITR1_TaxComputation.IntrstPay.IntrstPayUs234B + ITR.ITR1.ITR1_TaxComputation.IntrstPay.IntrstPayUs234C + ITR.ITR1.ITR1_TaxComputation.IntrstPay.LateFilingFee234F"},"blankAsZero":true},"severity":"error","enabled":true,"ref":"CBDT ITR-1 AY2024-25 Sl. 16","group":"Part D – Tax computation"},
{"id":"A15","name":"Total tax, fee and interest (D9) = D5 + 234A + 234B + 234C + 234F − relief u/s 89 (D6)","target":"ITR.ITR1.ITR1_TaxComputation.TotTaxPlusIntrstPay","check":{"kind":"compare","operator":"==","rhs":{"type":"expression","expression":"ITR.ITR1.ITR1_TaxComputation.GrossTaxLiability + ITR.ITR1.ITR1_TaxComputation.IntrstPay.IntrstPayUs234A + ITR.ITR1.ITR1_TaxComputation.IntrstPay.IntrstPayUs234B + ITR.ITR1.ITR1_TaxComputation.IntrstPay.IntrstPayUs234C + ITR.ITR1.ITR1_TaxComputation.IntrstPay.LateFilingFee234F - ITR.ITR1.ITR1_TaxComputation.Section89"},"blankAsZero":true},"severity":"error","enabled":true,"ref":"CBDT ITR-1 AY2024-25 Sl. 15","group":"Part D – Tax computation"},
{"id":"A66","name":"Total tax, fee and interest (D9) = balance tax after relief (D7) + total interest and fee (D8)","target":"ITR.ITR1.ITR1_TaxComputation.TotTaxPlusIntrstPay","check":{"kind":"compare","operator":"==","rhs":{"type":"expression","expression":"ITR.ITR1.ITR1_TaxComputation.NetTaxLiability + ITR.ITR1.ITR1_TaxComputation.TotalIntrstPay"},"blankAsZero":true},"severity":"error","enabled":true,"ref":"CBDT ITR-1 AY2024-25 Sl. 66","group":"Part D – Tax computation"},
{"id":"Aderived234F-ontime","name":"No late filing fee u/s 234F when the return is filed within the due date (139(1))","target":"ITR.ITR1.ITR1_TaxComputation.IntrstPay.LateFilingFee234F","check":{"kind":"compare","operator":"<=","rhs":{"type":"literal","value":0}},"severity":"error","enabled":true,"ref":"Derived from form arithmetic / schema","condition":{"expression":"(ITR.ITR1.FilingStatus.ReturnFileSec == 11)"},"group":"Part D – Tax computation"},
{"id":"Aderived234F-cap","name":"Late filing fee u/s 234F cannot exceed Rs 5,000 (Rs 1,000 when total income ≤ Rs 5 lakh)","target":"ITR.ITR1.ITR1_TaxComputation.IntrstPay.LateFilingFee234F","check":{"kind":"compare","operator":"<=","rhs":{"type":"expression","expression":"if(ITR.ITR1.ITR1_IncomeDeductions.TotalIncome <= 500000, 1000, 5000)"},"blankAsZero":false},"severity":"error","enabled":true,"ref":"Derived from form arithmetic / schema","group":"Part D – Tax computation"},
{"id":"A187","name":"Schedule IT: total tax paid = sum of col 4 of all challans","target":"ITR.ITR1.TaxPayments.TotalTaxPayments","check":{"kind":"compare","operator":"==","rhs":{"type":"expression","expression":"sum(ITR.ITR1.TaxPayments.TaxPayment[*].Amt)"},"blankAsZero":true},"severity":"error","enabled":true,"ref":"CBDT ITR-1 AY2024-25 Sl. 187","group":"Schedules IT / TDS / TCS – Taxes paid details"},
{"id":"A195","name":"Schedule TDS1: total tax deducted = sum of the rows","target":"ITR.ITR1.TDSonSalaries.TotalTDSonSalaries","check":{"kind":"compare","operator":"==","rhs":{"type":"expression","expression":"sum(ITR.ITR1.TDSonSalaries.TDSonSalary[*].TotalTDSSal)"},"blankAsZero":true},"severity":"error","enabled":true,"ref":"CBDT ITR-1 AY2024-25 Sl. 195","group":"Schedules IT / TDS / TCS – Taxes paid details"},
{"id":"A196","name":"Schedule TDS2: total TDS credit claimed this year (col 6) = sum of the rows","target":"ITR.ITR1.TDSonOthThanSals.TotalTDSonOthThanSals","check":{"kind":"compare","operator":"==","rhs":{"type":"expression","expression":"sum(ITR.ITR1.TDSonOthThanSals.TDSonOthThanSal[*].ClaimOutOfTotTDSOnAmtPaid)"},"blankAsZero":true},"severity":"error","enabled":true,"ref":"CBDT ITR-1 AY2024-25 Sl. 196","group":"Schedules IT / TDS / TCS – Taxes paid details"},
{"id":"A197","name":"Schedule TDS3: total TDS credit claimed this year (col 6) = sum of the rows","target":"ITR.ITR1.ScheduleTDS3Dtls.TotalTDS3Details","check":{"kind":"compare","operator":"==","rhs":{"type":"expression","expression":"sum(ITR.ITR1.ScheduleTDS3Dtls.TDS3Details[*].TDSClaimed)"},"blankAsZero":true},"severity":"error","enabled":true,"ref":"CBDT ITR-1 AY2024-25 Sl. 197","group":"Schedules IT / TDS / TCS – Taxes paid details"},
{"id":"A191","name":"Schedule TCS: total TCS credit claimed this year (col 6) = sum of the rows","target":"ITR.ITR1.ScheduleTCS.TotalSchTCS","check":{"kind":"compare","operator":"==","rhs":{"type":"expression","expression":"sum(ITR.ITR1.ScheduleTCS.TCS[*].AmtTCSClaimedThisYear)"},"blankAsZero":true},"severity":"error","enabled":true,"ref":"CBDT ITR-1 AY2024-25 Sl. 191","group":"Schedules IT / TDS / TCS – Taxes paid details"},
{"id":"A205","name":"Advance tax (D10a) = Schedule IT payments dated 01-04-2023 to 31-03-2024","target":"ITR.ITR1.TaxPaid.TaxesPaid.AdvanceTax","check":{"kind":"compare","operator":"==","rhs":{"type":"expression","expression":"sumif(ITR.ITR1.TaxPayments.TaxPayment[*].Amt, ITR.ITR1.TaxPayments.TaxPayment[*].DateDep >= \"2023-04-01\" and ITR.ITR1.TaxPayments.TaxPayment[*].DateDep <= \"2024-03-31\")"},"blankAsZero":true},"severity":"error","enabled":true,"ref":"CBDT ITR-1 AY2024-25 Sl. 205","group":"Part D – Taxes paid and refund"},
{"id":"A206","name":"Self-assessment tax (D10d) = Schedule IT payments dated after 31-03-2024","target":"ITR.ITR1.TaxPaid.TaxesPaid.SelfAssessmentTax","check":{"kind":"compare","operator":"==","rhs":{"type":"expression","expression":"sumif(ITR.ITR1.TaxPayments.TaxPayment[*].Amt, ITR.ITR1.TaxPayments.TaxPayment[*].DateDep > \"2024-03-31\")"},"blankAsZero":true},"severity":"error","enabled":true,"ref":"CBDT ITR-1 AY2024-25 Sl. 206","group":"Part D – Taxes paid and refund"},
{"id":"A203","name":"TDS claimed (D10b) = total TDS claimed in Schedules TDS1 + TDS2 + TDS3","target":"ITR.ITR1.TaxPaid.TaxesPaid.TDS","check":{"kind":"compare","operator":"==","rhs":{"type":"expression","expression":"ITR.ITR1.TDSonSalaries.TotalTDSonSalaries + ITR.ITR1.TDSonOthThanSals.TotalTDSonOthThanSals + ITR.ITR1.ScheduleTDS3Dtls.TotalTDS3Details"},"blankAsZero":true},"severity":"error","enabled":true,"ref":"CBDT ITR-1 AY2024-25 Sl. 203","group":"Part D – Taxes paid and refund"},
{"id":"A204","name":"TCS claimed (D10c) = total TCS claimed in Schedule TCS","target":"ITR.ITR1.TaxPaid.TaxesPaid.TCS","check":{"kind":"compare","operator":"==","rhs":{"type":"expression","expression":"ITR.ITR1.ScheduleTCS.TotalSchTCS"},"blankAsZero":true},"severity":"error","enabled":true,"ref":"CBDT ITR-1 AY2024-25 Sl. 204","group":"Part D – Taxes paid and refund"},
{"id":"A199","name":"Total taxes paid (D10) = advance tax + TDS + TCS + self-assessment tax","target":"ITR.ITR1.TaxPaid.TaxesPaid.TotalTaxesPaid","check":{"kind":"compare","operator":"==","rhs":{"type":"expression","expression":"ITR.ITR1.TaxPaid.TaxesPaid.AdvanceTax + ITR.ITR1.TaxPaid.TaxesPaid.TDS + ITR.ITR1.TaxPaid.TaxesPaid.TCS + ITR.ITR1.TaxPaid.TaxesPaid.SelfAssessmentTax"},"blankAsZero":true},"severity":"error","enabled":true,"ref":"CBDT ITR-1 AY2024-25 Sl. 199","group":"Part D – Taxes paid and refund"},
{"id":"A198","name":"Total taxes paid (D10) = Schedule IT + TDS1 + TDS2 + TDS3 + TCS totals","target":"ITR.ITR1.TaxPaid.TaxesPaid.TotalTaxesPaid","check":{"kind":"compare","operator":"==","rhs":{"type":"expression","expression":"ITR.ITR1.TaxPayments.TotalTaxPayments + ITR.ITR1.TDSonSalaries.TotalTDSonSalaries + ITR.ITR1.TDSonOthThanSals.TotalTDSonOthThanSals + ITR.ITR1.ScheduleTDS3Dtls.TotalTDS3Details + ITR.ITR1.ScheduleTCS.TotalSchTCS"},"blankAsZero":true},"severity":"error","enabled":true,"ref":"CBDT ITR-1 AY2024-25 Sl. 198","notes":"The scenario text lists IT, TDS1, TDS2 and TCS; Schedule TDS3 (Form 26QC) is also part of the TDS claimed in ITR-1 and is included so that the totals reconcile.","group":"Part D – Taxes paid and refund"},
{"id":"A200","name":"Refund (D12) = total taxes paid (D10) − total tax, fee and interest (D9), when positive","target":"ITR.ITR1.Refund.RefundDue","check":{"kind":"compare","operator":"==","rhs":{"type":"expression","expression":"max(0, ITR.ITR1.TaxPaid.TaxesPaid.TotalTaxesPaid - ITR.ITR1.ITR1_TaxComputation.TotTaxPlusIntrstPay)"},"blankAsZero":true,"tolerance":5},"severity":"error","enabled":true,"ref":"CBDT ITR-1 AY2024-25 Sl. 200","notes":"Refund is 0 (not negative) when taxes paid fall short of the liability. Tolerance ±5: the refund is rounded to the nearest Rs 10 (s.288B).","group":"Part D – Taxes paid and refund"},
{"id":"A201","name":"Amount payable (D11) = total tax, fee and interest (D9) − total taxes paid (D10), when positive","target":"ITR.ITR1.TaxPaid.BalTaxPayable","check":{"kind":"compare","operator":"==","rhs":{"type":"expression","expression":"max(0, ITR.ITR1.ITR1_TaxComputation.TotTaxPlusIntrstPay - ITR.ITR1.TaxPaid.TaxesPaid.TotalTaxesPaid)"},"blankAsZero":true,"tolerance":5},"severity":"error","enabled":true,"ref":"CBDT ITR-1 AY2024-25 Sl. 201","notes":"Amount payable is 0 (not negative) when taxes paid exceed the liability. Tolerance ±5: the amount is rounded to the nearest Rs 10 (s.288B).","group":"Part D – Taxes paid and refund"},
{"id":"AderivedIT-date","name":"Schedule IT: a challan for AY 2024-25 cannot be dated before 01-04-2023","target":"ITR.ITR1.TaxPayments.TaxPayment[*].DateDep","check":{"kind":"assert","expression":"ITR.ITR1.TaxPayments.TaxPayment[*].DateDep >= \"2023-04-01\""},"severity":"error","enabled":true,"ref":"Derived from form arithmetic / schema","notes":"Implied by Sl. 205/206: a payment dated before the previous year is neither advance tax nor self-assessment tax, so Sl. 198 (D10 = Schedule IT + TDS + TCS) could not hold.","group":"Part D – Taxes paid and refund"},
{"id":"A208","name":"PAN must be an individual PAN (4th character P) – ITR-1 is for individuals only","target":"ITR.ITR1.PersonalInfo.PAN","check":{"kind":"pattern","regex":"^[A-Z]{3}P[A-Z][0-9]{4}[A-Z]$"},"severity":"error","enabled":true,"ref":"CBDT ITR-1 AY2024-25 Sl. 208","notes":"The \"role CD\" of the PAN is its 4th character (P = individual). Full role check against the PAN master is external.","group":"Part A – General"},
{"id":"A202","name":"IFSC must be in the RBI format (4 letters, 0, 6 alphanumerics)","target":"ITR.ITR1.Refund.BankAccountDtls.AddtnlBankDetails[*].IFSCCode","check":{"kind":"pattern","regex":"^[A-Z]{4}0[A-Z0-9]{6}$"},"severity":"error","enabled":true,"ref":"CBDT ITR-1 AY2024-25 Sl. 202","notes":"Partial: matching against the RBI IFSC master needs external data; only the format is checked offline.","group":"Part D – Taxes paid and refund"},
{"id":"A38","name":"Other sources: \"Interest from savings bank account\" cannot be selected more than once","target":"ITR.ITR1.ITR1_IncomeDeductions.OthersInc.OthersIncDtlsOthSrc[*].OthSrcNatureDesc","check":{"kind":"unique"},"severity":"error","enabled":true,"ref":"CBDT ITR-1 AY2024-25 Sl. 38","condition":{"expression":"(ITR.ITR1.ITR1_IncomeDeductions.OthersInc.OthersIncDtlsOthSrc[*].OthSrcNatureDesc == \"SAV\")"},"notes":"Dropdown code SAV; the condition restricts the uniqueness check to that code so \"OTH\" rows may repeat.","group":"Part B – Salary and other sources (dropdowns)"},
{"id":"A39","name":"Other sources: \"Interest from deposits (bank / post office / co-operative society)\" cannot be selected more than once","target":"ITR.ITR1.ITR1_IncomeDeductions.OthersInc.OthersIncDtlsOthSrc[*].OthSrcNatureDesc","check":{"kind":"unique"},"severity":"error","enabled":true,"ref":"CBDT ITR-1 AY2024-25 Sl. 39","condition":{"expression":"(ITR.ITR1.ITR1_IncomeDeductions.OthersInc.OthersIncDtlsOthSrc[*].OthSrcNatureDesc == \"IFD\")"},"notes":"Dropdown code IFD; the condition restricts the uniqueness check to that code so \"OTH\" rows may repeat.","group":"Part B – Salary and other sources (dropdowns)"},
{"id":"A192","name":"Schedule TDS2: TDS claimed this year (col 6) cannot exceed tax deducted (col 5)","target":"ITR.ITR1.TDSonOthThanSals.TDSonOthThanSal[*].ClaimOutOfTotTDSOnAmtPaid","check":{"kind":"compare","operator":"<=","rhs":{"type":"expression","expression":"ITR.ITR1.TDSonOthThanSals.TDSonOthThanSal[*].TotTDSOnAmtPaid"},"blankAsZero":false},"severity":"error","enabled":true,"ref":"CBDT ITR-1 AY2024-25 Sl. 192","group":"Schedules IT / TDS / TCS – Taxes paid details"},
{"id":"Aderivedverpan","name":"PAN in verification must equal the assessee PAN when verifying as Self","target":"ITR.ITR1.Verification.Declaration.AssesseeVerPAN","check":{"kind":"compare","operator":"==","rhs":{"type":"expression","expression":"ITR.ITR1.PersonalInfo.PAN"},"blankAsZero":false},"severity":"error","enabled":true,"ref":"Derived from form arithmetic / schema","condition":{"expression":"(ITR.ITR1.Verification.Capacity == \"S\")"},"group":"Schedule 80GGA / Verification"}
]
```

**Caution on two characters**: rule names above use the typographic minus `−` and en-dash `–` *inside display names only*; every **expression** uses the ASCII hyphen `-` with spaces. Copy as-is and do not normalise either way.

### B.2 Computations (52)

Ids are not consecutive (they keep the numbering of the full production set); that is intentional — do not renumber.

```json
[
{"id":"C1","name":"Gross salary (B1i) = 17(1) + 17(2) + 17(3) + 89A income","target":"ITR.ITR1.ITR1_IncomeDeductions.GrossSalary","expression":"ITR.ITR1.ITR1_IncomeDeductions.Salary + ITR.ITR1.ITR1_IncomeDeductions.PerquisitesValue + ITR.ITR1.ITR1_IncomeDeductions.ProfitsInSalary + ITR.ITR1.ITR1_IncomeDeductions.IncomeNotified89A + ITR.ITR1.ITR1_IncomeDeductions.IncomeNotifiedOther89A","enabled":true,"ref":"CBDT ITR-1 AY2024-25 Sl. 47","group":"Part B – Salary"},
{"id":"C2","name":"Total exempt allowances u/s 10 (B1ii) = sum of the dropdown rows","target":"ITR.ITR1.ITR1_IncomeDeductions.AllwncExemptUs10.TotalAllwncExemptUs10","expression":"sum(ITR.ITR1.ITR1_IncomeDeductions.AllwncExemptUs10.AllwncExemptUs10Dtls[*].SalOthAmount)","enabled":true,"ref":"CBDT ITR-1 AY2024-25 Sl. 62","group":"Part B – Salary"},
{"id":"C3","name":"Net salary (B1iv) = gross salary − exempt allowances − relief 89A","target":"ITR.ITR1.ITR1_IncomeDeductions.NetSalary","expression":"ITR.ITR1.ITR1_IncomeDeductions.GrossSalary - ITR.ITR1.ITR1_IncomeDeductions.AllwncExemptUs10.TotalAllwncExemptUs10 - ITR.ITR1.ITR1_IncomeDeductions.Increliefus89A","enabled":true,"ref":"CBDT ITR-1 AY2024-25 Sl. 48","group":"Part B – Salary"},
{"id":"C4","name":"Standard deduction u/s 16(ia) = lower of Rs 50,000 and net salary","target":"ITR.ITR1.ITR1_IncomeDeductions.DeductionUs16ia","expression":"min(50000, max(0, ITR.ITR1.ITR1_IncomeDeductions.NetSalary))","enabled":true,"ref":"CBDT ITR-1 AY2024-25 Sl. 63","notes":"Sl. 63 sets the ceiling; the utility always allows the full ceiling, so it is computed.","group":"Part B – Salary"},
{"id":"C5","name":"Deductions u/s 16 (B1v) = 16(ia) + 16(ii) + 16(iii)","target":"ITR.ITR1.ITR1_IncomeDeductions.DeductionUs16","expression":"ITR.ITR1.ITR1_IncomeDeductions.DeductionUs16ia + ITR.ITR1.ITR1_IncomeDeductions.EntertainmentAlw16ii + ITR.ITR1.ITR1_IncomeDeductions.ProfessionalTaxUs16iii","enabled":true,"ref":"CBDT ITR-1 AY2024-25 Sl. 49","group":"Part B – Salary"},
{"id":"C6","name":"Income chargeable under Salaries (B1vi) = net salary − deductions u/s 16","target":"ITR.ITR1.ITR1_IncomeDeductions.IncomeFromSal","expression":"ITR.ITR1.ITR1_IncomeDeductions.NetSalary - ITR.ITR1.ITR1_IncomeDeductions.DeductionUs16","enabled":true,"ref":"CBDT ITR-1 AY2024-25 Sl. 50","group":"Part B – Salary"},
{"id":"C7","name":"Annual value (B2iii) = gross rent − tax paid to local authorities","target":"ITR.ITR1.ITR1_IncomeDeductions.AnnualValue","expression":"ITR.ITR1.ITR1_IncomeDeductions.GrossRentReceived - ITR.ITR1.ITR1_IncomeDeductions.TaxPaidlocalAuth","enabled":true,"ref":"CBDT ITR-1 AY2024-25 Sl. 34","group":"Part B – House Property"},
{"id":"C8","name":"Standard deduction u/s 24(a) (B2iv) = 30% of annual value","target":"ITR.ITR1.ITR1_IncomeDeductions.StandardDeduction","expression":"round(0.3 * max(0, ITR.ITR1.ITR1_IncomeDeductions.AnnualValue))","enabled":true,"ref":"CBDT ITR-1 AY2024-25 Sl. 31","notes":"A negative annual value gives no 30% deduction.","group":"Part B – House Property"},
{"id":"C9","name":"Income from house property (B2) = annual value − 30% − interest + arrears/unrealised rent","target":"ITR.ITR1.ITR1_IncomeDeductions.TotalIncomeOfHP","expression":"ITR.ITR1.ITR1_IncomeDeductions.AnnualValue - ITR.ITR1.ITR1_IncomeDeductions.StandardDeduction - ITR.ITR1.ITR1_IncomeDeductions.InterestPayable + ITR.ITR1.ITR1_IncomeDeductions.ArrearsUnrealizedRentRcvd","enabled":true,"ref":"CBDT ITR-1 AY2024-25 Sl. 35","group":"Part B – House Property"},
{"id":"C10","name":"Income from other sources (B3) = sum of the dropdown rows","target":"ITR.ITR1.ITR1_IncomeDeductions.IncomeOthSrc","expression":"sum(ITR.ITR1.ITR1_IncomeDeductions.OthersInc.OthersIncDtlsOthSrc[*].OthSrcOthAmount)","enabled":true,"ref":"CBDT ITR-1 AY2024-25 Sl. 40","group":"Part B – Other Sources"},
{"id":"C11","name":"Deduction u/s 57(iia) = lower of one-third of family pension and Rs 15,000","target":"ITR.ITR1.ITR1_IncomeDeductions.DeductionUs57iia","expression":"min(floor(sumif(ITR.ITR1.ITR1_IncomeDeductions.OthersInc.OthersIncDtlsOthSrc[*].OthSrcOthAmount, ITR.ITR1.ITR1_IncomeDeductions.OthersInc.OthersIncDtlsOthSrc[*].OthSrcNatureDesc == \"FAP\") / 3), 15000)","enabled":true,"ref":"CBDT ITR-1 AY2024-25 Sl. 42","notes":"Sl. 41/42 set the limits (nil without family pension, ≤ 1/3 and ≤ 15,000); the utility allows the full limit.","group":"Part B – Other Sources"},
{"id":"C12","name":"Gross total income (B4) = salary + house property + other sources (a house-property loss is ignored in the new regime)","target":"ITR.ITR1.ITR1_IncomeDeductions.GrossTotIncome","expression":"ITR.ITR1.ITR1_IncomeDeductions.IncomeFromSal + if(ITR.ITR1.FilingStatus.OptOutNewTaxRegime == \"Y\" or ITR.ITR1.ITR1_IncomeDeductions.TotalIncomeOfHP >= 0, ITR.ITR1.ITR1_IncomeDeductions.TotalIncomeOfHP, 0) + (ITR.ITR1.ITR1_IncomeDeductions.IncomeOthSrc - ITR.ITR1.ITR1_IncomeDeductions.DeductionUs57iia - ITR.ITR1.ITR1_IncomeDeductions.Increliefus89AOS)","enabled":true,"ref":"CBDT ITR-1 AY2024-25 Sl. 7 / 8 / 83","group":"Part B – Gross Total Income"},
{"id":"C13","name":"Total exempt income (agricultural / others) = sum of rows","target":"ITR.ITR1.ITR1_IncomeDeductions.ExemptIncAgriOthUs10.ExemptIncAgriOthUs10Total","expression":"sum(ITR.ITR1.ITR1_IncomeDeductions.ExemptIncAgriOthUs10.ExemptIncAgriOthUs10Dtls[*].OthAmount)","enabled":true,"ref":"CBDT ITR-1 AY2024-25 Sl. 18","group":"Exempt Income"},
{"id":"C14","name":"80D self & family (non-senior) = premium + check-up, max Rs 25,000","target":"ITR.ITR1.Schedule80D.Sec80DSelfFamSrCtznHealth.SelfAndFamily","expression":"min(ITR.ITR1.Schedule80D.Sec80DSelfFamSrCtznHealth.HealthInsPremSlfFam + ITR.ITR1.Schedule80D.Sec80DSelfFamSrCtznHealth.PrevHlthChckUpSlfFam, 25000)","enabled":true,"ref":"CBDT ITR-1 AY2024-25 Sl. 141","group":"Schedule 80D"},
{"id":"C15","name":"80D self & family (senior) = premium + check-up + medical expenditure, max Rs 50,000","target":"ITR.ITR1.Schedule80D.Sec80DSelfFamSrCtznHealth.SelfAndFamilySeniorCitizen","expression":"min(ITR.ITR1.Schedule80D.Sec80DSelfFamSrCtznHealth.HlthInsPremSlfFamSrCtzn + ITR.ITR1.Schedule80D.Sec80DSelfFamSrCtznHealth.PrevHlthChckUpSlfFamSrCtzn + ITR.ITR1.Schedule80D.Sec80DSelfFamSrCtznHealth.MedicalExpSlfFamSrCtzn, 50000)","enabled":true,"ref":"CBDT ITR-1 AY2024-25 Sl. 143","group":"Schedule 80D"},
{"id":"C16","name":"80D parents (non-senior) = premium + check-up, max Rs 25,000","target":"ITR.ITR1.Schedule80D.Sec80DSelfFamSrCtznHealth.Parents","expression":"min(ITR.ITR1.Schedule80D.Sec80DSelfFamSrCtznHealth.HlthInsPremParents + ITR.ITR1.Schedule80D.Sec80DSelfFamSrCtznHealth.PrevHlthChckUpParents, 25000)","enabled":true,"ref":"CBDT ITR-1 AY2024-25 Sl. 145","group":"Schedule 80D"},
{"id":"C17","name":"80D parents (senior) = premium + check-up + medical expenditure, max Rs 50,000","target":"ITR.ITR1.Schedule80D.Sec80DSelfFamSrCtznHealth.ParentsSeniorCitizen","expression":"min(ITR.ITR1.Schedule80D.Sec80DSelfFamSrCtznHealth.HlthInsPremParentsSrCtzn + ITR.ITR1.Schedule80D.Sec80DSelfFamSrCtznHealth.PrevHlthChckUpParentsSrCtzn + ITR.ITR1.Schedule80D.Sec80DSelfFamSrCtznHealth.MedicalExpParentsSrCtzn, 50000)","enabled":true,"ref":"CBDT ITR-1 AY2024-25 Sl. 147","group":"Schedule 80D"},
{"id":"C18","name":"80D eligible amount = sum of the four limbs, max Rs 1,00,000 and GTI","target":"ITR.ITR1.Schedule80D.Sec80DSelfFamSrCtznHealth.EligibleAmountOfDedn","expression":"min(ITR.ITR1.Schedule80D.Sec80DSelfFamSrCtznHealth.SelfAndFamily + ITR.ITR1.Schedule80D.Sec80DSelfFamSrCtznHealth.SelfAndFamilySeniorCitizen + ITR.ITR1.Schedule80D.Sec80DSelfFamSrCtznHealth.Parents + ITR.ITR1.Schedule80D.Sec80DSelfFamSrCtznHealth.ParentsSeniorCitizen, 100000, max(0, ITR.ITR1.ITR1_IncomeDeductions.GrossTotIncome))","enabled":true,"ref":"CBDT ITR-1 AY2024-25 Sl. 149","group":"Schedule 80D"},
{"id":"C55","name":"80GGC row: total contribution = cash + other mode","target":"ITR.ITR1.Schedule80GGC.Schedule80GGCDetails[*].DonationAmt","expression":"ITR.ITR1.Schedule80GGC.Schedule80GGCDetails[*].DonationAmtCash + ITR.ITR1.Schedule80GGC.Schedule80GGCDetails[*].DonationAmtOtherMode","enabled":true,"ref":"CBDT ITR-1 AY2024-25 Sl. 181","group":"Schedule 80GGC"},
{"id":"C56","name":"80GGC row: eligible amount = contribution in other mode (cash not allowed), max GTI","target":"ITR.ITR1.Schedule80GGC.Schedule80GGCDetails[*].EligibleDonationAmt","expression":"min(ITR.ITR1.Schedule80GGC.Schedule80GGCDetails[*].DonationAmtOtherMode, max(0, ITR.ITR1.ITR1_IncomeDeductions.GrossTotIncome))","enabled":true,"ref":"CBDT ITR-1 AY2024-25 Sl. 180","group":"Schedule 80GGC"},
{"id":"C57","name":"80GGC total in cash = sum of rows","target":"ITR.ITR1.Schedule80GGC.TotalDonationAmtCash80GGC","expression":"sum(ITR.ITR1.Schedule80GGC.Schedule80GGCDetails[*].DonationAmtCash)","enabled":true,"ref":"Derived from form arithmetic / schema","group":"Schedule 80GGC"},
{"id":"C58","name":"80GGC total in other mode = sum of rows","target":"ITR.ITR1.Schedule80GGC.TotalDonationAmtOtherMode80GGC","expression":"sum(ITR.ITR1.Schedule80GGC.Schedule80GGCDetails[*].DonationAmtOtherMode)","enabled":true,"ref":"Derived from form arithmetic / schema","group":"Schedule 80GGC"},
{"id":"C59","name":"80GGC total contributions = sum of rows","target":"ITR.ITR1.Schedule80GGC.TotalDonationsUs80GGC","expression":"sum(ITR.ITR1.Schedule80GGC.Schedule80GGCDetails[*].DonationAmt)","enabled":true,"ref":"Derived from form arithmetic / schema","group":"Schedule 80GGC"},
{"id":"C60","name":"80GGC total eligible = sum of rows, max GTI","target":"ITR.ITR1.Schedule80GGC.TotalEligibleDonationAmt80GGC","expression":"min(sum(ITR.ITR1.Schedule80GGC.Schedule80GGCDetails[*].EligibleDonationAmt), max(0, ITR.ITR1.ITR1_IncomeDeductions.GrossTotIncome))","enabled":true,"ref":"CBDT ITR-1 AY2024-25 Sl. 182","group":"Schedule 80GGC"},
{"id":"C61","name":"Total deductions claimed (user column) = sum of sections","target":"ITR.ITR1.ITR1_IncomeDeductions.UsrDeductUndChapVIA.TotalChapVIADeductions","expression":"ITR.ITR1.ITR1_IncomeDeductions.UsrDeductUndChapVIA.Section80C + ITR.ITR1.ITR1_IncomeDeductions.UsrDeductUndChapVIA.Section80CCC + ITR.ITR1.ITR1_IncomeDeductions.UsrDeductUndChapVIA.Section80CCDEmployeeOrSE + ITR.ITR1.ITR1_IncomeDeductions.UsrDeductUndChapVIA.Section80CCD1B + ITR.ITR1.ITR1_IncomeDeductions.UsrDeductUndChapVIA.Section80CCDEmployer + ITR.ITR1.ITR1_IncomeDeductions.UsrDeductUndChapVIA.Section80D + ITR.ITR1.ITR1_IncomeDeductions.UsrDeductUndChapVIA.Section80DD + ITR.ITR1.ITR1_IncomeDeductions.UsrDeductUndChapVIA.Section80DDB + ITR.ITR1.ITR1_IncomeDeductions.UsrDeductUndChapVIA.Section80E + ITR.ITR1.ITR1_IncomeDeductions.UsrDeductUndChapVIA.Section80EE + ITR.ITR1.ITR1_IncomeDeductions.UsrDeductUndChapVIA.Section80EEA + ITR.ITR1.ITR1_IncomeDeductions.UsrDeductUndChapVIA.Section80EEB + ITR.ITR1.ITR1_IncomeDeductions.UsrDeductUndChapVIA.Section80G + ITR.ITR1.ITR1_IncomeDeductions.UsrDeductUndChapVIA.Section80GG + ITR.ITR1.ITR1_IncomeDeductions.UsrDeductUndChapVIA.Section80GGA + ITR.ITR1.ITR1_IncomeDeductions.UsrDeductUndChapVIA.Section80GGC + ITR.ITR1.ITR1_IncomeDeductions.UsrDeductUndChapVIA.Section80U + ITR.ITR1.ITR1_IncomeDeductions.UsrDeductUndChapVIA.Section80TTA + ITR.ITR1.ITR1_IncomeDeductions.UsrDeductUndChapVIA.Section80TTB + ITR.ITR1.ITR1_IncomeDeductions.UsrDeductUndChapVIA.AnyOthSec80CCH","enabled":true,"ref":"Derived from form arithmetic / schema","group":"Part C – Deductions allowed"},
{"id":"C62","name":"80C allowed = claim, max Rs 1,50,000 (old regime only)","target":"ITR.ITR1.ITR1_IncomeDeductions.DeductUndChapVIA.Section80C","expression":"if(ITR.ITR1.FilingStatus.OptOutNewTaxRegime == \"Y\", min(ITR.ITR1.ITR1_IncomeDeductions.UsrDeductUndChapVIA.Section80C, 150000), 0)","enabled":true,"ref":"CBDT ITR-1 AY2024-25 Sl. 91; statutory allocation 80C → 80CCC → 80CCD(1)","group":"Part C – Deductions allowed"},
{"id":"C67","name":"80D allowed = claim, max eligible amount in Schedule 80D (old regime only)","target":"ITR.ITR1.ITR1_IncomeDeductions.DeductUndChapVIA.Section80D","expression":"if(ITR.ITR1.FilingStatus.OptOutNewTaxRegime == \"Y\", min(ITR.ITR1.ITR1_IncomeDeductions.UsrDeductUndChapVIA.Section80D, ITR.ITR1.Schedule80D.Sec80DSelfFamSrCtznHealth.EligibleAmountOfDedn), 0)","enabled":true,"ref":"Derived from form arithmetic / schema","group":"Part C – Deductions allowed"},
{"id":"C76","name":"80GGC allowed = total eligible in Schedule 80GGC (old regime only)","target":"ITR.ITR1.ITR1_IncomeDeductions.DeductUndChapVIA.Section80GGC","expression":"if(ITR.ITR1.FilingStatus.OptOutNewTaxRegime == \"Y\", ITR.ITR1.Schedule80GGC.TotalEligibleDonationAmt80GGC, 0)","enabled":true,"ref":"CBDT ITR-1 AY2024-25 Sl. 179","notes":"Old regime only (s.115BAC(2)); in the default regime the schedule must be blank.","group":"Part C – Deductions allowed"},
{"id":"C77","name":"80TTA allowed = claim, max Rs 10,000 and savings interest; not for senior citizens (old regime only)","target":"ITR.ITR1.ITR1_IncomeDeductions.DeductUndChapVIA.Section80TTA","expression":"if(ITR.ITR1.FilingStatus.OptOutNewTaxRegime == \"Y\", if(ITR.ITR1.PersonalInfo.DOB <= \"1964-04-01\", 0, min(ITR.ITR1.ITR1_IncomeDeductions.UsrDeductUndChapVIA.Section80TTA, 10000, sumif(ITR.ITR1.ITR1_IncomeDeductions.OthersInc.OthersIncDtlsOthSrc[*].OthSrcOthAmount, ITR.ITR1.ITR1_IncomeDeductions.OthersInc.OthersIncDtlsOthSrc[*].OthSrcNatureDesc == \"SAV\"))), 0)","enabled":true,"ref":"CBDT ITR-1 AY2024-25 Sl. 104 / 105 / 106","group":"Part C – Deductions allowed"}
]
```

*(B.2 continues — C82–C106 — in the next block, same concatenation rule.)*

```json
[
{"id":"C82","name":"Total deductions allowed (C20) = sum of sections, max GTI","target":"ITR.ITR1.ITR1_IncomeDeductions.DeductUndChapVIA.TotalChapVIADeductions","expression":"min(ITR.ITR1.ITR1_IncomeDeductions.DeductUndChapVIA.Section80C + ITR.ITR1.ITR1_IncomeDeductions.DeductUndChapVIA.Section80CCC + ITR.ITR1.ITR1_IncomeDeductions.DeductUndChapVIA.Section80CCDEmployeeOrSE + ITR.ITR1.ITR1_IncomeDeductions.DeductUndChapVIA.Section80CCD1B + ITR.ITR1.ITR1_IncomeDeductions.DeductUndChapVIA.Section80CCDEmployer + ITR.ITR1.ITR1_IncomeDeductions.DeductUndChapVIA.Section80D + ITR.ITR1.ITR1_IncomeDeductions.DeductUndChapVIA.Section80DD + ITR.ITR1.ITR1_IncomeDeductions.DeductUndChapVIA.Section80DDB + ITR.ITR1.ITR1_IncomeDeductions.DeductUndChapVIA.Section80E + ITR.ITR1.ITR1_IncomeDeductions.DeductUndChapVIA.Section80EE + ITR.ITR1.ITR1_IncomeDeductions.DeductUndChapVIA.Section80EEA + ITR.ITR1.ITR1_IncomeDeductions.DeductUndChapVIA.Section80EEB + ITR.ITR1.ITR1_IncomeDeductions.DeductUndChapVIA.Section80G + ITR.ITR1.ITR1_IncomeDeductions.DeductUndChapVIA.Section80GGA + ITR.ITR1.ITR1_IncomeDeductions.DeductUndChapVIA.Section80GGC + ITR.ITR1.ITR1_IncomeDeductions.DeductUndChapVIA.Section80U + ITR.ITR1.ITR1_IncomeDeductions.DeductUndChapVIA.Section80TTA + ITR.ITR1.ITR1_IncomeDeductions.DeductUndChapVIA.Section80TTB + ITR.ITR1.ITR1_IncomeDeductions.DeductUndChapVIA.AnyOthSec80CCH + ITR.ITR1.ITR1_IncomeDeductions.DeductUndChapVIA.Section80GG, max(0, ITR.ITR1.ITR1_IncomeDeductions.GrossTotIncome))","enabled":true,"ref":"CBDT ITR-1 AY2024-25 Sl. 112","group":"Part C – Deductions allowed"},
{"id":"C83","name":"Total income (C21) = gross total income − deductions allowed","target":"ITR.ITR1.ITR1_IncomeDeductions.TotalIncome","expression":"round(max(0, ITR.ITR1.ITR1_IncomeDeductions.GrossTotIncome - ITR.ITR1.ITR1_IncomeDeductions.DeductUndChapVIA.TotalChapVIADeductions) / 10) * 10","enabled":true,"ref":"CBDT ITR-1 AY2024-25 Sl. 12","notes":"Rounded to the nearest Rs 10 (s.288A).","group":"Part C – Total income"},
{"id":"C84","name":"Tax payable on total income (D1) at slab rates for the chosen regime","target":"ITR.ITR1.ITR1_TaxComputation.TotalTaxPayable","expression":"round(if(ITR.ITR1.FilingStatus.OptOutNewTaxRegime == \"Y\", if(ITR.ITR1.ITR1_IncomeDeductions.TotalIncome <= if(ITR.ITR1.PersonalInfo.DOB <= \"1944-04-01\", 500000, if(ITR.ITR1.PersonalInfo.DOB <= \"1964-04-01\", 300000, 250000)), 0, if(ITR.ITR1.ITR1_IncomeDeductions.TotalIncome <= 500000, 0.05 * (ITR.ITR1.ITR1_IncomeDeductions.TotalIncome - if(ITR.ITR1.PersonalInfo.DOB <= \"1944-04-01\", 500000, if(ITR.ITR1.PersonalInfo.DOB <= \"1964-04-01\", 300000, 250000))), if(ITR.ITR1.ITR1_IncomeDeductions.TotalIncome <= 1000000, 0.05 * (500000 - if(ITR.ITR1.PersonalInfo.DOB <= \"1944-04-01\", 500000, if(ITR.ITR1.PersonalInfo.DOB <= \"1964-04-01\", 300000, 250000))) + 0.2 * (ITR.ITR1.ITR1_IncomeDeductions.TotalIncome - 500000), 0.05 * (500000 - if(ITR.ITR1.PersonalInfo.DOB <= \"1944-04-01\", 500000, if(ITR.ITR1.PersonalInfo.DOB <= \"1964-04-01\", 300000, 250000))) + 100000 + 0.3 * (ITR.ITR1.ITR1_IncomeDeductions.TotalIncome - 1000000)))), if(ITR.ITR1.ITR1_IncomeDeductions.TotalIncome <= 300000, 0, if(ITR.ITR1.ITR1_IncomeDeductions.TotalIncome <= 600000, 0.05 * (ITR.ITR1.ITR1_IncomeDeductions.TotalIncome - 300000), if(ITR.ITR1.ITR1_IncomeDeductions.TotalIncome <= 900000, 15000 + 0.1 * (ITR.ITR1.ITR1_IncomeDeductions.TotalIncome - 600000), if(ITR.ITR1.ITR1_IncomeDeductions.TotalIncome <= 1200000, 45000 + 0.15 * (ITR.ITR1.ITR1_IncomeDeductions.TotalIncome - 900000), if(ITR.ITR1.ITR1_IncomeDeductions.TotalIncome <= 1500000, 90000 + 0.2 * (ITR.ITR1.ITR1_IncomeDeductions.TotalIncome - 1200000), 150000 + 0.3 * (ITR.ITR1.ITR1_IncomeDeductions.TotalIncome - 1500000))))))))","enabled":true,"ref":"Statutory slab rates (Finance Act 2023, s.115BAC); rule Aderivedslab-old / -new","notes":"Old regime: basic exemption Rs 2.5 lakh (3 lakh senior, 5 lakh super senior), 5% / 20% / 30%. New regime: 0–3 lakh nil, 5% / 10% / 15% / 20% / 30%. ITR-1 has no special-rate income and no surcharge (total income ≤ 50 lakh).","group":"Part D – Tax computation"},
{"id":"C85","name":"Rebate u/s 87A (D2): old regime up to Rs 12,500 if total income ≤ 5 lakh; new regime up to Rs 25,000 if ≤ 7 lakh, with marginal relief above 7 lakh","target":"ITR.ITR1.ITR1_TaxComputation.Rebate87A","expression":"if(ITR.ITR1.FilingStatus.OptOutNewTaxRegime == \"Y\", if(ITR.ITR1.ITR1_IncomeDeductions.TotalIncome <= 500000, min(12500, ITR.ITR1.ITR1_TaxComputation.TotalTaxPayable), 0), if(ITR.ITR1.ITR1_IncomeDeductions.TotalIncome <= 700000, min(25000, ITR.ITR1.ITR1_TaxComputation.TotalTaxPayable), min(25000, max(0, ITR.ITR1.ITR1_TaxComputation.TotalTaxPayable - (ITR.ITR1.ITR1_IncomeDeductions.TotalIncome - 700000)))))","enabled":true,"ref":"CBDT ITR-1 AY2024-25 Sl. 9 / 10 / 11","group":"Part D – Tax computation"},
{"id":"C86","name":"Tax after rebate (D3) = D1 − D2","target":"ITR.ITR1.ITR1_TaxComputation.TaxPayableOnRebate","expression":"ITR.ITR1.ITR1_TaxComputation.TotalTaxPayable - ITR.ITR1.ITR1_TaxComputation.Rebate87A","enabled":true,"ref":"CBDT ITR-1 AY2024-25 Sl. 13","group":"Part D – Tax computation"},
{"id":"C87","name":"Health & education cess (D4) = 4% of D3","target":"ITR.ITR1.ITR1_TaxComputation.EducationCess","expression":"round(0.04 * ITR.ITR1.ITR1_TaxComputation.TaxPayableOnRebate)","enabled":true,"ref":"Derived from form arithmetic / schema","group":"Part D – Tax computation"},
{"id":"C88","name":"Total tax and cess (D5) = D3 + D4","target":"ITR.ITR1.ITR1_TaxComputation.GrossTaxLiability","expression":"ITR.ITR1.ITR1_TaxComputation.TaxPayableOnRebate + ITR.ITR1.ITR1_TaxComputation.EducationCess","enabled":true,"ref":"CBDT ITR-1 AY2024-25 Sl. 14","group":"Part D – Tax computation"},
{"id":"C89","name":"Balance tax after relief (D7) = D5 − relief u/s 89 (D6)","target":"ITR.ITR1.ITR1_TaxComputation.NetTaxLiability","expression":"ITR.ITR1.ITR1_TaxComputation.GrossTaxLiability - ITR.ITR1.ITR1_TaxComputation.Section89","enabled":true,"ref":"Derived from form arithmetic / schema","group":"Part D – Tax computation"},
{"id":"C90","name":"Total interest and fee (D8) = 234A + 234B + 234C + 234F","target":"ITR.ITR1.ITR1_TaxComputation.TotalIntrstPay","expression":"ITR.ITR1.ITR1_TaxComputation.IntrstPay.IntrstPayUs234A + ITR.ITR1.ITR1_TaxComputation.IntrstPay.IntrstPayUs234B + ITR.ITR1.ITR1_TaxComputation.IntrstPay.IntrstPayUs234C + ITR.ITR1.ITR1_TaxComputation.IntrstPay.LateFilingFee234F","enabled":true,"ref":"CBDT ITR-1 AY2024-25 Sl. 16","group":"Part D – Tax computation"},
{"id":"C91","name":"Total tax, fee and interest (D9) = D7 + D8","target":"ITR.ITR1.ITR1_TaxComputation.TotTaxPlusIntrstPay","expression":"ITR.ITR1.ITR1_TaxComputation.NetTaxLiability + ITR.ITR1.ITR1_TaxComputation.TotalIntrstPay","enabled":true,"ref":"CBDT ITR-1 AY2024-25 Sl. 66","group":"Part D – Tax computation"},
{"id":"C92","name":"Schedule IT total = sum of challans","target":"ITR.ITR1.TaxPayments.TotalTaxPayments","expression":"sum(ITR.ITR1.TaxPayments.TaxPayment[*].Amt)","enabled":true,"ref":"CBDT ITR-1 AY2024-25 Sl. 187","group":"Part D – Taxes paid and refund"},
{"id":"C93","name":"Schedule TDS1 total = sum of TDS on salary","target":"ITR.ITR1.TDSonSalaries.TotalTDSonSalaries","expression":"sum(ITR.ITR1.TDSonSalaries.TDSonSalary[*].TotalTDSSal)","enabled":true,"ref":"CBDT ITR-1 AY2024-25 Sl. 195","group":"Part D – Taxes paid and refund"},
{"id":"C94","name":"Schedule TDS2 total = sum of TDS claimed this year","target":"ITR.ITR1.TDSonOthThanSals.TotalTDSonOthThanSals","expression":"sum(ITR.ITR1.TDSonOthThanSals.TDSonOthThanSal[*].ClaimOutOfTotTDSOnAmtPaid)","enabled":true,"ref":"CBDT ITR-1 AY2024-25 Sl. 196","group":"Part D – Taxes paid and refund"},
{"id":"C95","name":"Schedule TDS3 total = sum of TDS claimed","target":"ITR.ITR1.ScheduleTDS3Dtls.TotalTDS3Details","expression":"sum(ITR.ITR1.ScheduleTDS3Dtls.TDS3Details[*].TDSClaimed)","enabled":true,"ref":"CBDT ITR-1 AY2024-25 Sl. 197","group":"Part D – Taxes paid and refund"},
{"id":"C96","name":"Schedule TCS total = sum of TCS claimed this year","target":"ITR.ITR1.ScheduleTCS.TotalSchTCS","expression":"sum(ITR.ITR1.ScheduleTCS.TCS[*].AmtTCSClaimedThisYear)","enabled":true,"ref":"CBDT ITR-1 AY2024-25 Sl. 191","group":"Part D – Taxes paid and refund"},
{"id":"C97","name":"Advance tax (D10a) = challans deposited 01-04-2023 to 31-03-2024","target":"ITR.ITR1.TaxPaid.TaxesPaid.AdvanceTax","expression":"sumif(ITR.ITR1.TaxPayments.TaxPayment[*].Amt, ITR.ITR1.TaxPayments.TaxPayment[*].DateDep >= \"2023-04-01\" and ITR.ITR1.TaxPayments.TaxPayment[*].DateDep <= \"2024-03-31\")","enabled":true,"ref":"CBDT ITR-1 AY2024-25 Sl. 205","group":"Part D – Taxes paid and refund"},
{"id":"C98","name":"TDS (D10b) = TDS1 + TDS2 + TDS3 totals","target":"ITR.ITR1.TaxPaid.TaxesPaid.TDS","expression":"ITR.ITR1.TDSonSalaries.TotalTDSonSalaries + ITR.ITR1.TDSonOthThanSals.TotalTDSonOthThanSals + ITR.ITR1.ScheduleTDS3Dtls.TotalTDS3Details","enabled":true,"ref":"CBDT ITR-1 AY2024-25 Sl. 203","group":"Part D – Taxes paid and refund"},
{"id":"C99","name":"TCS (D10c) = Schedule TCS total","target":"ITR.ITR1.TaxPaid.TaxesPaid.TCS","expression":"ITR.ITR1.ScheduleTCS.TotalSchTCS","enabled":true,"ref":"CBDT ITR-1 AY2024-25 Sl. 204","group":"Part D – Taxes paid and refund"},
{"id":"C100","name":"Self-assessment tax (D10d) = challans deposited after 31-03-2024","target":"ITR.ITR1.TaxPaid.TaxesPaid.SelfAssessmentTax","expression":"sumif(ITR.ITR1.TaxPayments.TaxPayment[*].Amt, ITR.ITR1.TaxPayments.TaxPayment[*].DateDep > \"2024-03-31\")","enabled":true,"ref":"CBDT ITR-1 AY2024-25 Sl. 206","group":"Part D – Taxes paid and refund"},
{"id":"C101","name":"Total taxes paid (D10) = D10a + D10b + D10c + D10d","target":"ITR.ITR1.TaxPaid.TaxesPaid.TotalTaxesPaid","expression":"ITR.ITR1.TaxPaid.TaxesPaid.AdvanceTax + ITR.ITR1.TaxPaid.TaxesPaid.TDS + ITR.ITR1.TaxPaid.TaxesPaid.TCS + ITR.ITR1.TaxPaid.TaxesPaid.SelfAssessmentTax","enabled":true,"ref":"CBDT ITR-1 AY2024-25 Sl. 199","group":"Part D – Taxes paid and refund"},
{"id":"C102","name":"Amount payable (D11) = D9 − D10, if positive","target":"ITR.ITR1.TaxPaid.BalTaxPayable","expression":"round(max(0, ITR.ITR1.ITR1_TaxComputation.TotTaxPlusIntrstPay - ITR.ITR1.TaxPaid.TaxesPaid.TotalTaxesPaid) / 10) * 10","enabled":true,"ref":"CBDT ITR-1 AY2024-25 Sl. 201","notes":"Rounded to the nearest Rs 10 (s.288B).","group":"Part D – Taxes paid and refund"},
{"id":"C103","name":"Refund (D12) = D10 − D9, if positive","target":"ITR.ITR1.Refund.RefundDue","expression":"round(max(0, ITR.ITR1.TaxPaid.TaxesPaid.TotalTaxesPaid - ITR.ITR1.ITR1_TaxComputation.TotTaxPlusIntrstPay) / 10) * 10","enabled":true,"ref":"CBDT ITR-1 AY2024-25 Sl. 200","notes":"Rounded to the nearest Rs 10 (s.288B).","group":"Part D – Taxes paid and refund"},
{"id":"C106","name":"Amount payable as per this updated return (3) = amount payable (Part D)","target":"ITR.ITR1.PartB-ATI.AmtPayable","expression":"ITR.ITR1.TaxPaid.BalTaxPayable","enabled":true,"condition":"ITR.ITR1.FilingStatus.ReturnFileSec == 21","ref":"Form ITR-1 Part B-ATI (s.139(8A) / 140B)","group":"Part B-ATI – Updated return (139(8A))"}
]
```

### B.3 Display settings

```json
{
  "readOnly": [
    "ITR.ITR1.CreationInfo",
    "ITR.ITR1.Form_ITR1",
    "ITR.ITR1.PersonalInfo"
  ],
  "collapsed": [
    "ITR.ITR1.CreationInfo",
    "ITR.ITR1.Form_ITR1",
    "ITR.ITR1.PersonalInfo"
  ]
}
```

## 17. Appendix C — Sample return (JSON)

Save verbatim as `rulesets/itr1-ay2024-25/examples/sample-return.json`. It is internally consistent: computing it changes nothing, and it passes all 73 rules. Its headline figures (the S1 oracle): salary 8,00,000 · 16(ia) 50,000 · savings interest 15,000 · GTI 7,65,000 · VI-A 1,85,000 (80C 1,50,000 + 80D 25,000 + 80TTA 10,000) · total income 5,80,000 · old-regime tax 28,500 · cess 1,140 · D9 29,640 · TDS 30,000 · refund 360.

```json
{
  "ITR": {
    "ITR1": {
      "CreationInfo": {
        "SWVersionNo": "1.0",
        "SWCreatedBy": "SW00000000",
        "JSONCreatedBy": "SW00000000",
        "JSONCreationDate": "2024-07-15",
        "IntermediaryCity": "Delhi",
        "Digest": "-"
      },
      "Form_ITR1": {
        "FormName": "ITR-1",
        "Description": "Sample ITR-1 return",
        "AssessmentYear": "2024",
        "SchemaVer": "Ver1.0",
        "FormVer": "Ver1.0"
      },
      "PersonalInfo": {
        "AssesseeName": {
          "FirstName": "Asha",
          "SurNameOrOrgName": "Rao"
        },
        "PAN": "ABCPR1234F",
        "Address": {
          "ResidenceNo": "12",
          "LocalityOrArea": "Sector 17",
          "CityOrTownOrDistrict": "Chandigarh",
          "StateCode": "06",
          "CountryCode": "91",
          "PinCode": 160017,
          "CountryCodeMobile": 91,
          "MobileNo": 9876543210,
          "EmailAddress": "asha@example.com"
        },
        "DOB": "1985-06-15",
        "AadhaarCardNo": "123412341234",
        "EmployerCategory": "OTH"
      },
      "FilingStatus": {
        "ReturnFileSec": 11,
        "OptOutNewTaxRegime": "Y",
        "SeventhProvisio139": "N",
        "ItrFilingDueDate": "2024-07-31"
      },
      "Verification": {
        "Declaration": {
          "AssesseeVerName": "Asha Rao",
          "FatherName": "Mohan Rao",
          "AssesseeVerPAN": "ABCPR1234F"
        },
        "Capacity": "S",
        "Place": "Chandigarh"
      },
      "Schedule80D": {
        "Sec80DSelfFamSrCtznHealth": {
          "SeniorCitizenFlag": "N",
          "SelfAndFamily": 25000,
          "HealthInsPremSlfFam": 21000,
          "PrevHlthChckUpSlfFam": 4000,
          "SelfAndFamilySeniorCitizen": 0,
          "HlthInsPremSlfFamSrCtzn": 0,
          "PrevHlthChckUpSlfFamSrCtzn": 0,
          "MedicalExpSlfFamSrCtzn": 0,
          "ParentsSeniorCitizenFlag": "P",
          "Parents": 0,
          "HlthInsPremParents": 0,
          "PrevHlthChckUpParents": 0,
          "ParentsSeniorCitizen": 0,
          "HlthInsPremParentsSrCtzn": 0,
          "PrevHlthChckUpParentsSrCtzn": 0,
          "MedicalExpParentsSrCtzn": 0,
          "EligibleAmountOfDedn": 25000
        }
      },
      "Schedule80G": {
        "TotalDonationsUs80GCash": 0,
        "TotalDonationsUs80GOtherMode": 0,
        "TotalDonationsUs80G": 0,
        "TotalEligibleDonationsUs80G": 0
      },
      "Schedule80GGA": {
        "TotalDonationAmtCash80GGA": 0,
        "TotalDonationAmtOtherMode80GGA": 0,
        "TotalDonationsUs80GGA": 0,
        "TotalEligibleDonationAmt80GGA": 0
      },
      "Schedule80GGC": {
        "TotalDonationAmtCash80GGC": 0,
        "TotalDonationAmtOtherMode80GGC": 0,
        "TotalDonationsUs80GGC": 0,
        "TotalEligibleDonationAmt80GGC": 0
      },
      "ITR1_IncomeDeductions": {
        "GrossSalary": 800000,
        "Salary": 800000,
        "PerquisitesValue": 0,
        "ProfitsInSalary": 0,
        "IncomeNotified89A": 0,
        "IncomeNotifiedOther89A": 0,
        "AllwncExemptUs10": {
          "TotalAllwncExemptUs10": 0
        },
        "Increliefus89A": 0,
        "NetSalary": 800000,
        "DeductionUs16": 50000,
        "DeductionUs16ia": 50000,
        "EntertainmentAlw16ii": 0,
        "ProfessionalTaxUs16iii": 0,
        "IncomeFromSal": 750000,
        "TypeOfHP": "S",
        "GrossRentReceived": 0,
        "TaxPaidlocalAuth": 0,
        "AnnualValue": 0,
        "StandardDeduction": 0,
        "InterestPayable": 0,
        "ArrearsUnrealizedRentRcvd": 0,
        "TotalIncomeOfHP": 0,
        "IncomeOthSrc": 15000,
        "OthersInc": {
          "OthersIncDtlsOthSrc": [
            {
              "OthSrcNatureDesc": "SAV",
              "OthSrcOthAmount": 15000
            }
          ]
        },
        "DeductionUs57iia": 0,
        "Increliefus89AOS": 0,
        "GrossTotIncome": 765000,
        "UsrDeductUndChapVIA": {
          "Section80C": 150000,
          "Section80CCC": 0,
          "Section80CCDEmployeeOrSE": 0,
          "Section80CCD1B": 0,
          "Section80CCDEmployer": 0,
          "Section80D": 25000,
          "Section80DD": 0,
          "Section80DDB": 0,
          "Section80E": 0,
          "Section80EE": 0,
          "Section80EEA": 0,
          "Section80EEB": 0,
          "Section80G": 0,
          "Section80GG": 0,
          "Section80GGA": 0,
          "Section80GGC": 0,
          "Section80U": 0,
          "Section80TTA": 10000,
          "Section80TTB": 0,
          "AnyOthSec80CCH": 0,
          "TotalChapVIADeductions": 185000
        },
        "DeductUndChapVIA": {
          "Section80C": 150000,
          "Section80CCC": 0,
          "Section80CCDEmployeeOrSE": 0,
          "Section80CCD1B": 0,
          "Section80CCDEmployer": 0,
          "Section80D": 25000,
          "Section80DD": 0,
          "Section80DDB": 0,
          "Section80E": 0,
          "Section80EE": 0,
          "Section80EEA": 0,
          "Section80EEB": 0,
          "Section80G": 0,
          "Section80GG": 0,
          "Section80GGA": 0,
          "Section80GGC": 0,
          "Section80U": 0,
          "Section80TTA": 10000,
          "Section80TTB": 0,
          "AnyOthSec80CCH": 0,
          "TotalChapVIADeductions": 185000
        },
        "TotalIncome": 580000,
        "ExemptIncAgriOthUs10": {
          "ExemptIncAgriOthUs10Dtls": [
            {
              "NatureDesc": "AGRI",
              "OthAmount": 4000
            }
          ],
          "ExemptIncAgriOthUs10Total": 4000
        }
      },
      "ITR1_TaxComputation": {
        "TotalTaxPayable": 28500,
        "Rebate87A": 0,
        "TaxPayableOnRebate": 28500,
        "EducationCess": 1140,
        "GrossTaxLiability": 29640,
        "Section89": 0,
        "NetTaxLiability": 29640,
        "TotalIntrstPay": 0,
        "IntrstPay": {
          "IntrstPayUs234A": 0,
          "IntrstPayUs234B": 0,
          "IntrstPayUs234C": 0,
          "LateFilingFee234F": 0
        },
        "TotTaxPlusIntrstPay": 29640
      },
      "TaxPaid": {
        "TaxesPaid": {
          "AdvanceTax": 0,
          "TDS": 30000,
          "TCS": 0,
          "SelfAssessmentTax": 0,
          "TotalTaxesPaid": 30000
        },
        "BalTaxPayable": 0
      },
      "Refund": {
        "RefundDue": 360,
        "BankAccountDtls": {
          "AddtnlBankDetails": [
            {
              "IFSCCode": "SBIN0001234",
              "BankName": "State Bank of India",
              "BankAccountNo": "30123456789",
              "AccountType": "SB"
            }
          ]
        }
      },
      "TDSonSalaries": {
        "TDSonSalary": [
          {
            "EmployerOrDeductorOrCollectDetl": {
              "TAN": "DELA12345B",
              "EmployerOrDeductorOrCollecterName": "Acme Technologies Pvt Ltd"
            },
            "IncChrgSal": 750000,
            "TotalTDSSal": 28500
          }
        ],
        "TotalTDSonSalaries": 28500
      },
      "TDSonOthThanSals": {
        "TDSonOthThanSal": [
          {
            "EmployerOrDeductorOrCollectDetl": {
              "TAN": "MUMS12345C",
              "EmployerOrDeductorOrCollecterName": "State Bank of India"
            },
            "AmtForTaxDeduct": 15000,
            "DeductedYr": "2023",
            "TotTDSOnAmtPaid": 1500,
            "ClaimOutOfTotTDSOnAmtPaid": 1500
          }
        ],
        "TotalTDSonOthThanSals": 1500
      },
      "ScheduleTDS3Dtls": {
        "TotalTDS3Details": 0
      },
      "ScheduleTCS": {
        "TotalSchTCS": 0
      },
      "TaxPayments": {
        "TotalTaxPayments": 0
      }
    }
  }
}
```

## 18. Appendix D — verbatim test files (T3, T5, T6, T8, install)

Copy each file below **character for character** into the path named in its first comment line. These files are oracles: if a test fails, fix the implementation, never the test (§1, rule 2). D.1 and D.2 are vitest suites that run with `npm test` from `packages/core`; D.3, D.4 and D.5 are plain Node scripts run from the repository root after `npm run build`.

### D.1 `packages/core/src/t3-rules.test.ts` — checks, conditions, validateDocument (10 tests, gates M3)

```ts
// T3 — checks, conditions, validateDocument (M3). Copy verbatim to packages/core/src/t3-rules.test.ts
import { describe, expect, it } from 'vitest';
import { validateDocument, validateRuleDefinition, describeRule, type Rule } from './index.js';

const r = (partial: Partial<Rule> & Pick<Rule, 'id' | 'target' | 'check'>): Rule => ({
  name: partial.id,
  severity: 'error',
  ...partial,
});

const doc = {
  form: {
    regime: 'Y',
    pan: 'ABCPR1234F',
    total: 175,
    rows: [
      { amt: 100, type: 'CG', pan: 'AAAPA1111A' },
      { amt: 50, type: 'OS', pan: 'AAAPA2222B' },
      { amt: 25, type: 'CG', pan: 'AAAPA1111A' },
    ],
    other: [{ pan: 'AAAPA1111A' }],
    emptyStr: '',
    dob: '1985-06-15',
  },
};

describe('T3 validation', () => {
  it('required fires on blank (empty string too) with {name} templating; concrete paths on wildcards', () => {
    const res = validateDocument(doc, [
      r({ id: 'R1', target: 'form.emptyStr', check: { kind: 'required' } }),
      r({ id: 'R2', target: 'form.missing', check: { kind: 'required' } }),
      r({ id: 'R3', target: 'form.rows[*].amt', check: { kind: 'required' } }),
    ]);
    expect(res.errors.map((v) => v.ruleId)).toEqual(['R1', 'R2']);
    expect(res.errors[0].message).toBe('emptyStr is required');
    expect(res.valid).toBe(false);
  });

  it('non-required checks skip blank targets; blankAsZero forces the comparison', () => {
    const rules = [
      r({ id: 'C1', target: 'form.missing', check: { kind: 'compare', operator: '==', rhs: { type: 'literal', value: 7 } } }),
      r({ id: 'C2', target: 'form.missing', check: { kind: 'compare', operator: '==', rhs: { type: 'expression', expression: 'form.total' }, blankAsZero: true } }),
      r({ id: 'C3', target: 'form.missing', check: { kind: 'min', value: 1 } }),
    ];
    const res = validateDocument(doc, rules);
    expect(res.errors.map((v) => v.ruleId)).toEqual(['C2']); // blank==7 skipped; blankAsZero 0 != 175 fires; min skipped
  });

  it('compare: expression rhs, tolerance, and blank-expression-as-0 for numeric targets', () => {
    const res = validateDocument(doc, [
      r({ id: 'E1', target: 'form.total', check: { kind: 'compare', operator: '==', rhs: { type: 'expression', expression: 'sum(form.rows[*].amt)' } } }),
      r({ id: 'E2', target: 'form.total', check: { kind: 'compare', operator: '==', rhs: { type: 'expression', expression: 'sum(form.rows[*].amt) + 8' }, tolerance: 10 } }),
      r({ id: 'E3', target: 'form.total', check: { kind: 'compare', operator: '<=', rhs: { type: 'expression', expression: 'min(form.nothing[*].x)' } } }),
    ]);
    // E3: blank expression rhs against a numeric target counts as 0 → 175 <= 0 fails
    expect(res.errors.map((v) => v.ruleId)).toEqual(['E3']);
  });

  it('type / pattern / enum / maxLength', () => {
    const res = validateDocument(doc, [
      r({ id: 'T1', target: 'form.dob', check: { kind: 'type', type: 'date' } }),
      r({ id: 'T2', target: 'form.pan', check: { kind: 'pattern', regex: '^[A-Z]{5}[0-9]{4}[A-Z]$' } }),
      r({ id: 'T3', target: 'form.pan', check: { kind: 'pattern', regex: '^[A-Z]{5}[0-9]{5}[A-Z]$' } }),
      r({ id: 'T4', target: 'form.regime', check: { kind: 'enum', values: ['Y', 'N'] } }),
      r({ id: 'T5', target: 'form.pan', check: { kind: 'maxLength', value: 5 } }),
    ]);
    expect(res.errors.map((v) => v.ruleId)).toEqual(['T3', 'T5']);
  });

  it('unique: document scope catches cross-table duplicates, parent scope does not', () => {
    const dup = [
      r({ id: 'U1', target: 'form.rows[*].pan', check: { kind: 'unique' } }),
      r({ id: 'U2', target: 'form.rows[*].type', check: { kind: 'unique', scope: 'parent' } }),
    ];
    const res = validateDocument(doc, dup);
    // U1 fires once, on the LATER duplicate (rows[2].pan); U2 fires on rows[2].type (CG repeats within the same parent)
    expect(res.errors.map((v) => `${v.ruleId}@${v.path}`)).toEqual(['U1@form.rows[2].pan', 'U2@form.rows[2].type']);
  });

  it('assert runs once per target match with that row bound', () => {
    const res = validateDocument(doc, [
      r({ id: 'A1', target: 'form.rows[*].amt', check: { kind: 'assert', expression: 'form.rows[*].amt >= 50 or form.rows[*].type == "CG"' } }),
    ]);
    expect(res.errors).toEqual([]);
  });

  it('conditions gate the check: leaf with in-list, expression, not', () => {
    const rules = [
      r({ id: 'G1', target: 'form.total', check: { kind: 'max', value: 0 }, condition: { path: 'form.regime', operator: 'in', rhs: { type: 'literal', value: 'N,X' } } }),
      r({ id: 'G2', target: 'form.total', check: { kind: 'max', value: 0 }, condition: { expression: 'form.regime == "Y" and form.total > 100' } }),
      r({ id: 'G3', target: 'form.total', check: { kind: 'max', value: 0 }, condition: { not: { path: 'form.regime', operator: '==', rhs: { type: 'literal', value: 'Y' } } } }),
    ];
    const res = validateDocument(doc, rules);
    expect(res.errors.map((v) => v.ruleId)).toEqual(['G2']); // only G2's condition holds
  });

  it('warnings do not block validity; disabled rules are skipped; eval errors become warnings', () => {
    const res = validateDocument(doc, [
      r({ id: 'W1', target: 'form.total', check: { kind: 'max', value: 1 }, severity: 'warning' }),
      r({ id: 'D1', target: 'form.total', check: { kind: 'max', value: 1 }, enabled: false }),
      r({ id: 'X1', target: 'form.total', check: { kind: 'assert', expression: 'nosuchfn(1)' } }),
    ]);
    expect(res.valid).toBe(true);
    expect(res.warnings.map((v) => v.ruleId).sort()).toEqual(['W1', 'X1']);
    expect(res.warnings.find((v) => v.ruleId === 'X1')!.message).toMatch(/could not be evaluated/);
  });

  it('custom message templating substitutes {path} {name} {value}', () => {
    const res = validateDocument(doc, [
      r({ id: 'M1', target: 'form.total', check: { kind: 'max', value: 1 }, message: '{name} at {path} is {value}' }),
    ]);
    expect(res.errors[0].message).toBe('total at form.total is 175');
  });

  it('validateRuleDefinition reports structural problems; describeRule renders English', () => {
    expect(validateRuleDefinition(r({ id: 'B1', target: 'form.total', check: { kind: 'compare', operator: '==', rhs: { type: 'expression', expression: 'sum(' } } })).length).toBeGreaterThan(0);
    expect(validateRuleDefinition(r({ id: 'B2', target: '', check: { kind: 'required' } })).length).toBeGreaterThan(0);
    expect(validateRuleDefinition(r({ id: 'B3', target: 'form.pan', check: { kind: 'pattern', regex: '(' } })).length).toBeGreaterThan(0);
    expect(typeof describeRule(r({ id: 'B4', target: 'form.total', check: { kind: 'required' } }))).toBe('string');
  });
});
```

### D.2 `packages/core/src/t5-schema.test.ts` — document utilities and schema building (6 tests, gates M5)

```ts
// T5 — document utilities and schema building (M5). Copy verbatim to packages/core/src/t5-schema.test.ts
import { describe, expect, it } from 'vitest';
import {
  buildSchemaFromText,
  flattenSchema,
  findSchemaNode,
  emptyDocument,
  pruneBlanks,
  coerceValue,
  isBlank,
  parseDocument,
  serializeDocument,
  formatOfFile,
} from './index.js';

const miniSchema = JSON.stringify({
  $schema: 'http://json-schema.org/draft-07/schema#',
  type: 'object',
  properties: { ITR: { $ref: '#/definitions/ITR' } },
  required: ['ITR'],
  definitions: {
    ITR: {
      type: 'object',
      properties: {
        Form: { type: 'object', properties: { Name: { type: 'string', enum: ['ITR-1'] }, Ver: { type: 'string' } }, required: ['Name'] },
        Dob: { type: 'string', format: 'date', description: 'Date of birth' },
        Amounts: { type: 'array', items: { $ref: '#/definitions/Row' } },
        Mixed: { allOf: [{ $ref: '#/definitions/Row' }, { type: 'object', properties: { extra: { type: 'integer' } }, required: ['extra'] }] },
      },
      required: ['Form'],
    },
    Row: { type: 'object', properties: { code: { type: 'string' }, amt: { type: 'integer' } }, required: ['amt'] },
  },
});

describe('T5 schema + document utilities', () => {
  const built = buildSchemaFromText(miniSchema, 'mini.json');

  it('detects a JSON Schema and builds the uniform tree', () => {
    expect(built.format).toBe('json');
    expect(built.source).toBe('json-schema');
    const paths = flattenSchema(built.root).map((n) => n.path);
    expect(paths).toContain('ITR.Form.Name');
    expect(paths).toContain('ITR.Amounts[*].amt');
    expect(paths).toContain('ITR.Mixed.extra');
    const name = findSchemaNode(built.root, 'ITR.Form.Name')!;
    expect(name.enum).toEqual(['ITR-1']);
    expect(name.required).toBe(true);
    expect(findSchemaNode(built.root, 'ITR.Dob')!.type).toBe('date');
    expect(findSchemaNode(built.root, 'ITR.Dob')!.description).toBe('Date of birth');
    expect(findSchemaNode(built.root, 'ITR.Amounts')!.type).toBe('array');
    expect(findSchemaNode(built.root, 'ITR.Amounts[*].amt')!.required).toBe(true);
    expect(findSchemaNode(built.root, 'ITR.Mixed.extra')!.required).toBe(true);
  });

  it('a plain JSON sample infers a schema instead', () => {
    const s = buildSchemaFromText(JSON.stringify({ a: 1, rows: [{ x: 'p' }, { x: 'q', y: 2 }] }), 'sample.json');
    expect(s.source).toBe('json-sample');
    const paths = flattenSchema(s.root).map((n) => n.path);
    expect(paths).toContain('rows[*].x');
    expect(paths).toContain('rows[*].y'); // array item keys are merged across samples
  });

  it('emptyDocument mirrors the schema shape with blank leaves', () => {
    const d = emptyDocument(built.root) as Record<string, any>;
    expect(d.ITR.Form).toEqual({ Name: '', Ver: '' });
    expect(d.ITR.Amounts).toEqual([]);
    expect(d.ITR.Dob).toBe('');
  });

  it('isBlank and pruneBlanks: blank leaves go, containers stay', () => {
    expect(isBlank('')).toBe(true);
    expect(isBlank(0)).toBe(false);
    expect(isBlank([])).toBe(true);
    expect(pruneBlanks({ a: '', b: null, c: 0, d: { e: '  x ' }, f: [] })).toEqual({ c: 0, d: { e: '  x ' }, f: [] });
  });

  it('coerceValue follows the node type', () => {
    expect(coerceValue('42', { name: 'n', path: 'n', type: 'integer' })).toBe(42);
    expect(coerceValue('', { name: 'n', path: 'n', type: 'number' })).toBeNull();
    expect(coerceValue('x', { name: 'n', path: 'n', type: 'number' })).toBe('x'); // non-numeric text kept for validation to flag
    expect(coerceValue('true', { name: 'n', path: 'n', type: 'boolean' })).toBe(true);
  });

  it('JSON documents round-trip; formatOfFile sniffs by name then content', () => {
    const data = { a: [1, 2] };
    expect(parseDocument(serializeDocument(data, 'json'), 'json')).toEqual(data);
    expect(formatOfFile('x.json', '{}')).toBe('json');
    expect(formatOfFile('x.xml', '<a/>')).toBe('xml');
  });
});
```

### D.3 `server-tests/t6-api.mjs` — REST API smoke test (16 PASS lines, gates M6)

```js
// T6 — REST API smoke test (M6). Copy verbatim to server-tests/t6-api.mjs
// Run from the repository root AFTER `npm run build`:  node server-tests/t6-api.mjs
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const port = 4300 + Math.floor(Math.random() * 500);
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 't6-'));
const server = spawn('node', ['packages/server/dist/index.js'], { env: { ...process.env, PORT: String(port), DATA_DIR: dataDir }, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 1200));
const base = `http://localhost:${port}`;
let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : ' — ' + detail}`);
  if (!ok) failures++;
};
const j = async (url, init) => {
  const r = await fetch(base + url, init);
  const body = r.status === 204 ? undefined : await r.json().catch(() => undefined);
  return { status: r.status, body };
};
const post = (url, body) => j(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

const miniSchema = {
  type: 'object',
  properties: {
    inv: {
      type: 'object',
      properties: {
        lines: { type: 'array', items: { type: 'object', properties: { amount: { type: 'integer' } }, required: ['amount'] } },
        net: { type: 'integer' },
        tax: { type: 'integer' },
        total: { type: 'integer' },
      },
      required: ['net'],
    },
  },
  required: ['inv'],
};

try {
  // schema upload (multipart)
  const fd = new FormData();
  fd.append('file', new Blob([JSON.stringify(miniSchema)], { type: 'application/json' }), 'mini.json');
  fd.append('name', 'Mini invoice');
  const up = await fetch(`${base}/api/schemas`, { method: 'POST', body: fd });
  const schema = await up.json();
  check('POST /api/schemas parses a JSON Schema', up.status === 201 && schema.source === 'json-schema' && schema.root, JSON.stringify(schema).slice(0, 120));
  const list = await j('/api/schemas');
  check('GET /api/schemas lists summaries without the tree', list.body.length === 1 && list.body[0].name === 'Mini invoice' && !list.body[0].root);

  // rule set create: valid, then invalid rule, then invalid computation
  const rules = [
    { id: 'net', name: 'net = sum of lines', target: 'inv.net', severity: 'error', check: { kind: 'compare', operator: '==', rhs: { type: 'expression', expression: 'sum(inv.lines[*].amount)' }, blankAsZero: true } },
    { id: 'cap', name: 'total cap', target: 'inv.total', severity: 'warning', check: { kind: 'max', value: 1000 } },
  ];
  const computations = [
    { id: 'c-net', name: 'net', target: 'inv.net', expression: 'sum(inv.lines[*].amount)' },
    { id: 'c-tax', name: 'tax', target: 'inv.tax', expression: 'round(inv.net * 0.18)' },
    { id: 'c-total', name: 'total', target: 'inv.total', expression: 'inv.net + inv.tax' },
  ];
  const display = { readOnly: ['inv.lines'], collapsed: ['inv.lines'] };
  const rsRes = await post('/api/rulesets', { name: 'Invoice rules', schemaId: schema.id, rules, computations, display });
  check('POST /api/rulesets stores rules + computations + display', rsRes.status === 201 && rsRes.body.computations.length === 3 && rsRes.body.display.readOnly[0] === 'inv.lines');
  const bad1 = await post('/api/rulesets', { name: 'bad', schemaId: schema.id, rules: [{ id: 'x', name: 'x', target: 'inv.net', severity: 'error', check: { kind: 'pattern', regex: '(' } }] });
  check('invalid rule definition → 400 with the problem named', bad1.status === 400 && /pattern|regex|Invalid/i.test(bad1.body.error ?? ''), JSON.stringify(bad1.body));
  const bad2 = await post('/api/rulesets', { name: 'bad2', schemaId: schema.id, rules: [], computations: [{ id: 'c', name: 'c', target: 'inv.net', expression: 'foo(' }] });
  check('invalid computation → 400', bad2.status === 400);

  // validate: computes first, returns computed doc + computedFields
  const val = await post('/api/validate', { data: { inv: { lines: [{ amount: 100 }, { amount: 50 }] } }, ruleSetId: rsRes.body.id });
  check('POST /api/validate computes then validates', val.body.valid === true && val.body.data.inv.total === 177 && val.body.computedFields.includes('inv.net'), JSON.stringify(val.body).slice(0, 200));
  const val2 = await post('/api/validate', { data: { inv: { lines: [{ amount: 900 }, { amount: 50 }] } }, ruleSetId: rsRes.body.id });
  check('warnings do not make the document invalid', val2.body.valid === true && val2.body.warnings.length === 1 && val2.body.warnings[0].ruleId === 'cap');

  // documents: save recomputes before storing; empty-document; parse; export
  const save = await post('/api/documents', { name: 'inv-1', schemaId: schema.id, ruleSetId: rsRes.body.id, data: { inv: { lines: [{ amount: 100 }, { amount: 50 }], net: 1, tax: 2, total: 3 } } });
  check('POST /api/documents recomputes computed fields before storing', save.status === 201 && save.body.data.inv.net === 150 && save.body.data.inv.total === 177);
  const got = await j(`/api/documents/${save.body.id}`);
  check('GET /api/documents/:id returns the stored document', got.body.name === 'inv-1' && got.body.data.inv.tax === 27);
  const empty = await j(`/api/schemas/${schema.id}/empty-document`);
  check('GET /api/schemas/:id/empty-document mirrors the schema', empty.body.data.inv.lines.length === 0 && empty.body.format === 'json');
  const pf = new FormData();
  pf.append('file', new Blob([JSON.stringify({ inv: { lines: [], net: 0 } })], { type: 'application/json' }), 'up.json');
  pf.append('schemaId', schema.id);
  const parsed = await (await fetch(`${base}/api/documents/parse`, { method: 'POST', body: pf })).json();
  check('POST /api/documents/parse parses without storing', parsed.name === 'up' && parsed.data.inv.net === 0);
  const exp = await fetch(`${base}/api/rulesets/${rsRes.body.id}/export`);
  const expBody = await exp.json();
  check('ruleset export carries rules + computations + display and re-imports', expBody.rules.length === 2 && expBody.computations.length === 3 && expBody.display.readOnly.length === 1);

  // deletes and 404s
  const del = await fetch(`${base}/api/documents/${save.body.id}`, { method: 'DELETE' });
  check('DELETE /api/documents/:id → 204', del.status === 204);
  const miss = await j('/api/rulesets/nope');
  check('unknown id → 404 JSON error', miss.status === 404 && typeof miss.body.error === 'string');
  const guard = await fetch(`${base}/api/schemas/${schema.id}`, { method: 'DELETE' });
  check('schema with dependent rule sets → 409 without force', guard.status === 409);
  const forced = await fetch(`${base}/api/schemas/${schema.id}?force=true`, { method: 'DELETE' });
  check('…and 204 with ?force=true (cascades)', forced.status === 204 && (await j('/api/rulesets')).body.length === 0);
} catch (e) {
  check('T6 run', false, e.stack);
} finally {
  server.kill();
}
console.log(failures ? `\n${failures} check(s) failed` : '\nAll T6 checks passed');
process.exit(failures ? 1 : 0);
```

### D.4 `rulesets/test/t8-oracle.mjs` — ITR-1 oracle and mutation tests (47 PASS lines, gates M8)

This file reads `rulesets/itr1-ay2024-25/starter.ruleset.json` (assembled per §13.2 from Appendix B) and `rulesets/itr1-ay2024-25/examples/sample-return.json` (Appendix C).

```js
// T8 — ITR-1 AY 2024-25 oracle (M8). Copy verbatim to rulesets/test/t8-oracle.mjs
// Run from the repository root AFTER `npm run build`:  node rulesets/test/t8-oracle.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeDocument, validateDocument, setAtPath, underAnyPath } from '../../packages/core/dist/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const rs = JSON.parse(fs.readFileSync(path.join(here, '..', 'itr1-ay2024-25', 'starter.ruleset.json'), 'utf8'));
const sample = JSON.parse(fs.readFileSync(path.join(here, '..', 'itr1-ay2024-25', 'examples', 'sample-return.json'), 'utf8'));

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : ' — ' + detail}`);
  if (!ok) failures++;
};
const P = 'ITR.ITR1.';
const g = (d, p) => (P + p).split('.').reduce((o, k) => o?.[k], d);
const run = (doc) => {
  const c = computeDocument(doc, rs.computations);
  return { c, v: validateDocument(c.data, rs.rules), d: c.data };
};
const scenario = (name, doc, expected, expectedErrors = []) => {
  const { c, v, d } = run(doc);
  for (const [p, want] of Object.entries(expected)) check(`${name}: ${p} = ${want}`, g(d, p) === want, `got ${g(d, p)}`);
  const ids = v.errors.map((e) => e.ruleId).sort();
  check(`${name}: errors [${expectedErrors.join(',') || 'none'}]`, JSON.stringify(ids) === JSON.stringify([...expectedErrors].sort()), `got [${ids.join(',')}]`);
  check(`${name}: idempotent`, computeDocument(d, rs.computations).changed.length === 0);
  return d;
};

check('starter rule set shape', rs.rules.length === 73 && rs.computations.length === 52 && rs.display.readOnly.length === 3);

// S1 — the sample return is internally consistent and fully valid
const d1 = run(sample);
check('S1: computing the sample changes nothing (it is consistent)', d1.c.changed.length === 0, d1.c.changed.join(','));
check('S1: 49 fields computed', d1.c.computed.size === 49, String(d1.c.computed.size));
check('S1: no computation errors', d1.c.errors.length === 0, JSON.stringify(d1.c.errors));
scenario('S1', sample, {
  'ITR1_IncomeDeductions.GrossTotIncome': 765000,
  'ITR1_IncomeDeductions.DeductUndChapVIA.TotalChapVIADeductions': 185000,
  'ITR1_IncomeDeductions.TotalIncome': 580000,
  'ITR1_TaxComputation.TotalTaxPayable': 28500,
  'ITR1_TaxComputation.EducationCess': 1140,
  'ITR1_TaxComputation.TotTaxPlusIntrstPay': 29640,
  'TaxPaid.TaxesPaid.TotalTaxesPaid': 30000,
  'TaxPaid.BalTaxPayable': 0,
  'Refund.RefundDue': 360,
});

// S2 — salary raised to 10,00,000 (old regime): slab 5%/20% + cess, payable not refund
const s2 = setAtPath(sample, P + 'ITR1_IncomeDeductions.Salary', 1000000);
scenario('S2 salary 10L', s2, {
  'ITR1_IncomeDeductions.GrossSalary': 1000000,
  'ITR1_IncomeDeductions.GrossTotIncome': 965000,
  'ITR1_IncomeDeductions.TotalIncome': 780000,
  'ITR1_TaxComputation.TotalTaxPayable': 68500,
  'ITR1_TaxComputation.EducationCess': 2740,
  'TaxPaid.BalTaxPayable': 41240,
  'Refund.RefundDue': 0,
});

// S3 — same, default (new) regime: Chapter VI-A drops to nil, 115BAC slabs
const s3 = setAtPath(s2, P + 'FilingStatus.OptOutNewTaxRegime', 'N');
scenario('S3 new regime', s3, {
  'ITR1_IncomeDeductions.DeductUndChapVIA.TotalChapVIADeductions': 0,
  'ITR1_IncomeDeductions.TotalIncome': 965000,
  'ITR1_TaxComputation.TotalTaxPayable': 54750,
  'ITR1_TaxComputation.Rebate87A': 0,
  'TaxPaid.BalTaxPayable': 26940,
});

// S4 — senior citizen (DOB 1960): 3L basic exemption, 80TTA allowed becomes nil
const s4 = setAtPath(sample, P + 'PersonalInfo.DOB', '1960-05-05');
scenario('S4 senior', s4, {
  'ITR1_IncomeDeductions.DeductUndChapVIA.TotalChapVIADeductions': 175000,
  'ITR1_IncomeDeductions.TotalIncome': 590000,
  'ITR1_TaxComputation.TotalTaxPayable': 28000,
  'Refund.RefundDue': 880,
});

// Mutations — each defect fires exactly the expected rule(s)
const mutations = [
  ['company PAN in ITR-1', [['PersonalInfo.PAN', 'ABCCR1234F']], ['A208', 'Aderivedverpan']],
  ['malformed IFSC', [['Refund.BankAccountDtls.AddtnlBankDetails[0].IFSCCode', 'SBIN11234']], ['A202']],
  ['savings-interest row duplicated', [['ITR1_IncomeDeductions.OthersInc.OthersIncDtlsOthSrc[1]', { OthSrcNatureDesc: 'SAV', OthSrcOthAmount: 1000 }]], ['A38']],
  ['challan dated before 01-04-2023', [['TaxPayments.TaxPayment[0]', { BSRCode: '0510308', DateDep: '2022-12-01', SrlNoOfChaln: 1, Amt: 500 }]], ['A198', 'AderivedIT-date']],
  ['verification PAN differs from assessee PAN', [['Verification.Declaration.AssesseeVerPAN', 'ZZZPZ9999Z']], ['Aderivedverpan']],
  ['80D preventive check-ups above 5,000', [['Schedule80D.Sec80DSelfFamSrCtznHealth.PrevHlthChckUpSlfFam', 6000]], ['A90']],
  ['234F fee entered though filed on time', [['ITR1_TaxComputation.IntrstPay.LateFilingFee234F', 1000]], ['Aderived234F-ontime']],
  ['TDS2 claim above tax deducted', [['TDSonOthThanSals.TDSonOthThanSal[0].ClaimOutOfTotTDSOnAmtPaid', 5000]], ['A192']],
];
for (const [name, edits, expected] of mutations) {
  let doc = sample;
  for (const [p, v] of edits) doc = setAtPath(doc, P + p, v);
  const ids = [...new Set(run(doc).v.errors.map((e) => e.ruleId))].sort();
  check(`mutation: ${name} → [${expected.join(',')}]`, JSON.stringify(ids) === JSON.stringify([...expected].sort()), `got [${ids.join(',')}]`);
}

// Display settings drive the editor: PersonalInfo is read-only, computed paths are known
check('display: PersonalInfo fields are read-only', underAnyPath(P + 'PersonalInfo.Address.PinCode', rs.display.readOnly));
check('display: income fields are not', !underAnyPath(P + 'ITR1_IncomeDeductions.Salary', rs.display.readOnly));

console.log(failures ? `\n${failures} check(s) failed` : '\nAll T8 oracle checks passed');
process.exit(failures ? 1 : 0);
```

### D.5 `rulesets/itr1-ay2024-25/install.mjs` — loads the schema + starter rule set into a running server

Idempotent: running it twice updates in place rather than duplicating. It expects `starter.ruleset.json` and the schema file `ITR-1_2024_Main_V1.4.json` (operator-supplied, §13.1) beside it.

```js
// Loads the ITR-1 starter schema + rule set into a running server (idempotent).
//   node rulesets/itr1-ay2024-25/install.mjs [http://localhost:4000]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const base = (process.argv[2] ?? 'http://localhost:4000').replace(/\/$/, '');
const rs = JSON.parse(fs.readFileSync(path.join(here, 'starter.ruleset.json'), 'utf8'));
const schemaFile = path.join(here, 'ITR-1_2024_Main_V1.4.json');

const j = async (url, init) => {
  const r = await fetch(base + url, init);
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${init?.method ?? 'GET'} ${url} -> ${r.status}: ${body.error ?? ''}`);
  return body;
};

let schema = (await j('/api/schemas')).find((s) => s.name === rs.schemaName);
if (!schema) {
  const fd = new FormData();
  fd.append('file', new Blob([fs.readFileSync(schemaFile)], { type: 'application/json' }), path.basename(schemaFile));
  fd.append('name', rs.schemaName);
  schema = await j('/api/schemas', { method: 'POST', body: fd });
  console.log(`Uploaded schema "${schema.name}" (${schema.id})`);
} else console.log(`Using existing schema "${schema.name}" (${schema.id})`);

const payload = { name: rs.name, description: rs.description, schemaId: schema.id, rules: rs.rules, computations: rs.computations ?? [], display: rs.display ?? null };
const existing = (await j(`/api/rulesets?schemaId=${schema.id}`)).find((r) => r.name === rs.name);
const saved = existing
  ? await j(`/api/rulesets/${existing.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
  : await j('/api/rulesets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
console.log(`${existing ? 'Updated' : 'Created'} rule set "${saved.name}" with ${saved.rules.length} rules and ${saved.computations?.length ?? 0} computed fields`);
console.log('Open the app -> Documents -> schema "' + rs.schemaName + '".');
```

Expected output on first run: `Uploaded schema …` then `Created rule set … with 73 rules and 52 computed fields`. On a second run: `Using existing schema …` then `Updated rule set …`.

## 19. Appendix E — UI acceptance checklist (Checkpoint D, run in the browser)

Setup: `npm run build && npm start`; in a second shell `node rulesets/itr1-ay2024-25/install.mjs`; open the app, Documents page, schema `ITR-1 AY 2024-25 (V1.4)`, rule set `… (starter)`, upload `rulesets/itr1-ay2024-25/examples/sample-return.json`.

1. Summary under the pickers reads “Applying **73** rules and **52** computed fields…”; switching the rule set to “(none)” removes all badges and locks nothing; switching back restores them (and is remembered after a reload).
2. The sample opens **valid** (green badge, “All 73 rules pass”), in side-by-side view with sticky three-column header and visible column borders.
3. `CreationInfo`, `Form_ITR1`, `PersonalInfo` start **collapsed** and badge `read-only`; expanding PersonalInfo shows grey locked values (no inputs); typing is impossible anywhere under them.
4. Computed fields (e.g. `GrossSalary`, `GrossTotIncome`, `TotalIncome`, `TotalTaxPayable`, `RefundDue`) render as violet read-only values badged `ƒ computed`; hover shows the formula and source; the **Computed (49)** filter lists exactly the computed rows.
5. Mandatory markers: `*` is red on fields of blocks present in the document (e.g. `ITR1_IncomeDeductions.GrossSalary`), muted grey with an explanatory tooltip in unused optional blocks (e.g. under `PartA_139_8A.Applicable_139_8A`).
6. The **◀ Hide left pane** toggle collapses the left column (layout widens, schema · rule-set names appear beside the button), persists across reload, and **▶ Show…** restores it.
7. Edit `Salary` 800000 → **1000000**: within a keystroke `GrossSalary` 10,00,000 · `GrossTotIncome` 9,65,000 · `TotalIncome` 7,80,000 · `TotalTaxPayable` 68,500 · `EducationCess` 2,740 · `BalTaxPayable` 41,240 · `RefundDue` 0; the document stays valid; original column shows struck-through 800000 on the changed row; **Changed** filter counts the edited + recomputed rows; the Computed values panel shows the new trail.
8. Set `FilingStatus.OptOutNewTaxRegime` to `N`: `TotalChapVIADeductions` 0, `TotalTaxPayable` 54,750; back to `Y` restores 68,500. Revert all returns to the loaded state (badge valid, changed count 0).
9. Break something entered: set `TDSonOthThanSals.TDSonOthThanSal[0].ClaimOutOfTotTDSOnAmtPaid` to 5000 → one error (A192) under the field and in the right panel; **Save is disabled** with the explanatory banner; clicking the violation scrolls to and flashes the row; fixing it re-enables Save.
10. Duplicate the SAV row in other sources (+ Add item on `OthersIncDtlsOthSrc`, nature `SAV`) → A38 fires on the later row; remove the row with ✕ → valid again.
11. Save: document stored; re-opening it shows the computed values persisted (server recomputed — numbers unchanged); Download produces pruned JSON whose `TotalTaxPayable` matches the screen.
12. Rule Sets page: the starter set shows `73` and `ƒ 52` badges; **Computed fields** tab lists 52 cards grouped by Part; unticking `Total income (C21)` and saving makes `TotalIncome` editable in Documents (and the equality rule A12 then fires when it disagrees); re-tick and save restores. **Display** tab shows the three read-only paths; Export downloads a `.ruleset.json` that re-imports intact (import → identical counts).

Every step must hold exactly; any deviation goes to `CHECKPOINT-D.md`.

## 20. Addendum log

This section is reserved for the Reviewer. It starts empty and is only ever appended to.

**No addenda yet.** The document above is the complete specification as of its initial issue.

How addenda work (binding on the Builder):

1. After each checkpoint (A–D, §4), the Reviewer inspects the submitted codebase and test results. If everything matches this document, the log gains one line — `Checkpoint X: no addendum` — and the Builder continues with the next milestone unchanged.
2. If something is off course, the Reviewer appends an addendum here, numbered **AD-1, AD-2, …** in order of issue. Each addendum names: the checkpoint that triggered it, the section(s) of this document it overrides or clarifies, what the Builder must change, and which tests to re-run to prove the correction (re-run every test gate from the earliest affected milestone onward).
3. **An addendum overrides the named section(s) of this document.** Where an addendum and the main text disagree, the addendum wins; where two addenda disagree, the later number wins. Everything not named in an addendum stays exactly as written above.
4. Addenda never change the verbatim test files (§6, §7, §9, Appendix D) or the Appendix B/C payloads, except by explicitly replacing a whole named file with a new full version. The Builder still never edits tests on its own authority (§1, rule 2).
5. The Builder acknowledges each addendum in `DECISIONS.md` (§1, rule 4) with one line — `AD-n applied: <what changed>` — before resuming milestone work.

| Addendum | Checkpoint | Overrides | Summary | Status |
| --- | --- | --- | --- | --- |
| — | — | — | none issued | — |
