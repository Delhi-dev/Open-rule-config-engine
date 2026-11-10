# Open Rule Config Engine

**Configurable validation and computation rules for structured documents**

A schema-driven engine for checking and completing structured documents. You upload a schema, attach a
**rule set** (validation rules plus computed fields, kept as plain JSON), and open documents against it:
every edit recomputes the derived fields and re-runs the rules instantly, side by side with the original.

It ships with the official JSON schemas and validation rule sets for the Indian income-tax return forms
**ITR-1 to ITR-7, AY 2024-25**, translated from the CBDT's published validation rules. ITR-1 also comes
with its tax arithmetic as computed fields, and a smaller starter set with tests that pin exact rupee figures.

> **Not tax advice.** The rule sets are an independent translation of the CBDT validation-rules
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

## Deploy to Railway

The repository deploys to [Railway](https://railway.com) as one service: `railway.json` builds all
packages and starts the server, which serves both the app and the API on Railway's `PORT`.

1. In Railway: **New Project → Deploy from GitHub repo** → choose this repository.
2. Add a **Volume** to the service, mounted at `/data`, and set the variable `DATA_DIR=/data`.
   Without a volume, schemas, rule sets and documents are lost on every redeploy.
3. Under **Settings → Networking**, click **Generate Domain** to get a public URL.
4. Load the ITR-1 starter data from your own machine: `node rulesets/itr1-ay2024-25/install.mjs https://<your-domain>`.

> The app has no login. Anyone with the URL can view, change or delete data, so don't load real
> taxpayer returns into a public deployment.

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
| `rulesets/itr1-ay2024-25` | Official ITR-1 schema, the full rule set, the **starter** set, a sample return and `install.mjs`. |
| `rulesets/itr2…itr7-ay2024-25` | Official schema and full validation rule set for each form. |
| `rulesets/test` | The ITR-1 oracle test. |
| `docs/build-plan.md` | The design document the code was built from. |

### Included rule sets (AY 2024-25)

| Form | Schema | Rule set | Rules | Computed fields |
| --- | --- | --- | --- | --- |
| ITR-1 (starter) | V1.4 | `itr1-ay2024-25/starter.ruleset.json` | 73 | 52 |
| ITR-1 (full) | V1.4 | `itr1-ay2024-25/itr1-ay2024-25.ruleset.json` | 301 | 116 |
| ITR-2 | V1.5 | `itr2-ay2024-25/itr2-ay2024-25.ruleset.json` | 884 | — |
| ITR-3 | V1.4 | `itr3-ay2024-25/itr3-ay2024-25.ruleset.json` | 1,415 | — |
| ITR-4 | V1.4 | `itr4-ay2024-25/itr4-ay2024-25.ruleset.json` | 373 | — |
| ITR-5 | V1.3 | `itr5-ay2024-25/itr5-ay2024-25.ruleset.json` | 1,285 | — |
| ITR-6 | V1.3 | `itr6-ay2024-25/itr6-ay2024-25.ruleset.json` | 1,316 | — |
| ITR-7 | V1.4 | `itr7-ay2024-25/itr7-ay2024-25.ruleset.json` | 832 | — |

Only the ITR-1 starter set is covered by the exact-figure tests; the others are checked to import cleanly.
For ITR-2 to ITR-7 the totals and tax are validated, not computed.

To load a form: upload its schema on **1. Schemas** (use the rule set's `schemaName` as the name), then
**Import…** its `.ruleset.json` on **2. Rule sets**. Other forms and years are data, not code: write or
import a `.ruleset.json` for any JSON schema.

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

## License

This project is open source under the **Apache License 2.0**. You are free to use, modify and
redistribute it, including in government and internal settings, without asking for permission.
See the [LICENSE](LICENSE) file for the full terms.

The ITR JSON schemas under `rulesets/` are published by the Income Tax Department, Government of
India, and are included unchanged for convenience.
