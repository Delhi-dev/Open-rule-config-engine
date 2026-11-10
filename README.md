# Open Rule Config Engine

A schema-driven engine for checking and completing structured documents. You upload a schema, attach a
**rule set** (validation rules plus computed fields, kept as plain JSON), and open documents against it:
every edit recomputes the derived fields and re-runs the rules instantly, side by side with the original.

It ships with the official **ITR-1 (AY 2024-25) JSON schema** and a starter rule set of 73 validation
rules and 52 computed fields, translated from the CBDT's published validation rules and the form's tax
arithmetic, with tests that pin exact rupee figures.

> **Not tax advice.** The rule set is an independent translation of the CBDT validation-rules
> documents, not official files. A "valid" result here does not guarantee the department's utility
> will accept a return. Check anything important against the official documents.

## Quick start

Requires Node.js 20 or later.

```bash
npm install
npm run build
npm run dev                                    # server on :4000, app on http://localhost:5173
node rulesets/itr1-ay2024-25/install.mjs       # in a second terminal: loads the ITR-1 starter set
```

Open http://localhost:5173 → **3. Documents** → schema `ITR-1 AY 2024-25 (V1.4)`, rule set `… (starter)` →
**Upload JSON…** → `rulesets/itr1-ay2024-25/examples/sample-return.json`.

For production, `npm run build && npm start` serves the built app and the API together on port 4000
(`PORT` and `DATA_DIR` environment variables override the defaults).

## How it works

| Tab | What you do |
| --- | --- |
| **1. Schemas** | Upload a JSON Schema or a sample JSON document; it becomes a field tree. |
| **2. Rule sets** | Write or import rules (required, type, range, pattern, enum, comparisons, uniqueness, free-form expressions, with conditions) and computed fields (formulas), and choose which blocks are read-only or start collapsed. Import/Export as `.ruleset.json`. |
| **3. Documents** | Open or create a document for a schema + rule set. Computed fields fill in automatically; violations appear beside the field and in a side panel; Save is blocked while errors remain (warnings don't block). |

The server recomputes every document before storing it, so stored data is always consistent.
Storage is one JSON file per record under `packages/server/data/` (or `DATA_DIR`).

## Repository layout

| Path | Contents |
| --- | --- |
| `packages/core` | The engine: paths, expression language, rules, computations, schema inference, document helpers (TypeScript, no UI). |
| `packages/server` | Express REST API (`/api/schemas`, `/api/rulesets`, `/api/validate`, `/api/documents`). |
| `packages/client` | React + Vite user interface. |
| `rulesets/itr1-ay2024-25` | Official ITR-1 V1.4 schema, the 73-rule / 52-computation **starter** set, a sample return and `install.mjs`. |
| `rulesets/test` | The ITR-1 oracle test. |
| `docs/build-plan.md` | The design document the code was built from. |

Other forms and years are data, not code: upload the form's JSON schema on **1. Schemas**, then write or
**Import…** a `.ruleset.json` for it on **2. Rule sets**.

## Tests

| Command | What it checks |
| --- | --- |
| `npm test` | Core unit tests (45) and the ITR-1 oracle (47 checks: four tax scenarios with exact figures, eight single-defect returns, display settings). |
| `npm run test:api` | REST API smoke test (16 checks) and API contract probes (24 checks). Run after `npm run build`. |
| `npm run test:addenda` | Differential checks of the expression engine, rules and computations (about 7,000 cases). |
| `npm run test:e2e` | Browser walk of the ITR-1 acceptance checklist (31 checks). Needs Playwright: `npm i -D playwright && npx playwright install chromium`. |

## How it was built

The code was written by a local model (JetBrains Mellum 2.1) following `docs/build-plan.md`, with Claude
reviewing at each checkpoint. Some parts were supplied or patched by the reviewer where the local model
could not meet the tests: the expression parser, the rules core, the user interface, and fixes to the
server and schema inference.
