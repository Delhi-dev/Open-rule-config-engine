// End-to-end test of computed (system-calculated) fields with the ITR-1 AY 2024-25 rule set.
//   npm run build && node packages/client/e2e/computed.e2e.mjs
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  try {
    ({ chromium } = require(process.env.PLAYWRIGHT_PATH ?? '/opt/npm-tools/node_modules/playwright'));
  } catch {
    console.log('SKIP  playwright not installed (npm i -D playwright && npx playwright install chromium)');
    process.exit(0);
  }
}
const root = path.resolve(process.argv[2] ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..'));
const port = 4600 + Math.floor(Math.random() * 300);
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-c-'));
const server = spawn('node', [path.join(root, 'packages/server/dist/index.js')], { env: { ...process.env, PORT: String(port), DATA_DIR: dataDir }, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 1500));
let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
};
const id = (p) => `#f-${p.replace(/\./g, '\\.').replace(/\[/g, '\\[').replace(/\]/g, '\\]')}`;
const P = 'ITR.ITR1.';
try {
  const base = `http://localhost:${port}`;
  const dir = path.join(root, 'rulesets/itr1-ay2024-25');
  const fd = new FormData();
  fd.append('file', new Blob([fs.readFileSync(path.join(dir, 'ITR-1_2024_Main_V1.4.json'))]), 'ITR-1.json');
  fd.append('name', 'ITR-1 AY 2024-25');
  const schema = await (await fetch(`${base}/api/schemas`, { method: 'POST', body: fd })).json();
  const rs = JSON.parse(fs.readFileSync(path.join(dir, 'starter.ruleset.json'), 'utf8'));
  const post = (body) => fetch(`${base}/api/rulesets`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
  const full = await post({ name: 'ITR-1 with computation', schemaId: schema.id, rules: rs.rules, computations: rs.computations, display: rs.display });
  await post({ name: 'ITR-1 validation only', schemaId: schema.id, rules: rs.rules });
  check('server stores the computations with the rule set', full.computations?.length === rs.computations.length, `${full.computations?.length}`);

  // API: validate computes first
  const sample = JSON.parse(fs.readFileSync(path.join(dir, 'examples/sample-return.json'), 'utf8'));
  const bumped = structuredClone(sample);
  bumped.ITR.ITR1.ITR1_IncomeDeductions.Salary = 1000000;
  const api = await (await fetch(`${base}/api/validate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: bumped, ruleSetId: full.id }) })).json();
  check('POST /api/validate recomputes before validating', api.valid && api.data.ITR.ITR1.ITR1_TaxComputation.TotalTaxPayable === 68500, `tax ${api.data?.ITR?.ITR1?.ITR1_TaxComputation?.TotalTaxPayable}, ${api.errors?.length} errors`);

  const browser = await chromium.launch();
  const pg = await browser.newPage({ viewport: { width: 1500, height: 950 } });
  const errors = [];
  pg.on('pageerror', (e) => errors.push(e.message));
  await pg.goto(base);
  await pg.getByRole('button', { name: '3. Documents' }).click();
  await pg.waitForSelector('select');
  await pg.waitForTimeout(400);
  const rsSelect = pg.locator('label.field', { hasText: 'Rule set' }).locator('select');
  await rsSelect.selectOption({ label: /with computation/.test(await rsSelect.locator('option').nth(1).textContent()) ? await rsSelect.locator('option').nth(1).textContent() : await rsSelect.locator('option').nth(2).textContent() });
  await pg.waitForTimeout(200);
  check('rule set picker shows the computed-field count', new RegExp(`${rs.computations.length} computed`).test(await rsSelect.locator('option:checked').textContent()));
  check('summary names rules and computed fields for the chosen schema + rule set', new RegExp(`${rs.rules.length}.*rules.*${rs.computations.length}.*computed`, "s").test(await pg.getByTestId('ruleset-summary').textContent()));

  const [chooser] = await Promise.all([pg.waitForEvent('filechooser'), pg.getByRole('button', { name: /Upload JSON/ }).click()]);
  await chooser.setFiles(path.join(dir, 'examples/sample-return.json'));
  await pg.waitForSelector('.compare-row', { timeout: 20000 });
  await pg.waitForTimeout(400);
  check('consistent ITR-1 sample is valid', (await pg.locator('.panel-header .badge.ok').first().textContent()) === 'valid');

  const gti = pg.locator(id(`${P}ITR1_IncomeDeductions.GrossTotIncome`));
  check('computed field (GTI) has no input on the editable side', (await gti.locator('input').count()) === 0 && (await gti.locator('.computed-value').count()) === 1);
  check('computed field is badged', (await gti.locator('.badge.computed').count()) === 1);
  check('entered field (Salary) stays editable', (await pg.locator(`${id(`${P}ITR1_IncomeDeductions.Salary`)} input`).count()) === 1);
  const val = async (p) => (await pg.locator(`${id(P + p)} .computed-value`).textContent()).replace(/,/g, '');

  // display settings: read-only + collapsed blocks, conditional mandatory marker, left-pane toggle
  check('PersonalInfo block starts collapsed', (await pg.locator(id(`${P}PersonalInfo.PAN`)).count()) === 0 && (await pg.locator(id(`${P}PersonalInfo`)).count()) === 1);
  await pg.locator(`${id(`${P}PersonalInfo`)} button.ghost`).first().click();
  await pg.waitForTimeout(150);
  const pan = pg.locator(id(`${P}PersonalInfo.PAN`));
  check('expanded PersonalInfo fields are read-only (no input)', (await pan.locator('input').count()) === 0 && (await pan.locator('.locked-value').textContent()) === 'ABCPR1234F');
  check('CreationInfo and Form_ITR1 start collapsed', (await pg.locator(id(`${P}CreationInfo.SWVersionNo`)).count()) === 0 && (await pg.locator(id(`${P}Form_ITR1.FormName`)).count()) === 0);
  const ack = pg.locator(id(`${P}PartA_139_8A.Applicable_139_8A.AcknowledgementNo`));
  check('mandatory marker in an unused block (Part A 139(8A)) is muted, not red', (await ack.locator('.req-if-used').count()) === 1);
  check('mandatory marker in a used block stays red', (await pg.locator(`${id(`${P}ITR1_IncomeDeductions.GrossSalary`)} .req-if-used`).count()) === 0);
  await pg.getByTestId('toggle-left').click();
  await pg.waitForTimeout(150);
  check('left pane can be hidden', !(await pg.locator('.left-pane').isVisible()));
  await pg.getByTestId('toggle-left').click();
  await pg.waitForTimeout(150);
  check('left pane can be shown again', await pg.locator('.left-pane').isVisible());

  const sal = pg.locator(`${id(`${P}ITR1_IncomeDeductions.Salary`)} input`);
  await sal.scrollIntoViewIfNeeded();
  await sal.fill('1000000');
  await pg.waitForTimeout(300);
  check('editing salary recomputes gross salary, GTI and total income', (await val('ITR1_IncomeDeductions.GrossSalary')) === '1000000' && (await val('ITR1_IncomeDeductions.GrossTotIncome')) === '965000' && (await val('ITR1_IncomeDeductions.TotalIncome')) === '780000');
  check('tax recomputed at old-regime slab rates (D1 68,500; cess 2,740; payable 41,240)', (await val('ITR1_TaxComputation.TotalTaxPayable')) === '68500' && (await val('ITR1_TaxComputation.EducationCess')) === '2740' && (await val('TaxPaid.BalTaxPayable')) === '41240' && (await val('Refund.RefundDue')) === '0');
  check('document is still valid after the edit (computed fields consistent)', (await pg.locator('.panel-header .badge.ok').first().textContent()) === 'valid');
  check('computed values panel shows the tax trail', /Tax payable on total income[\s\S]*68,500/.test(await pg.getByTestId('computed-summary').textContent()));

  const regime = pg.locator(`${id(`${P}FilingStatus.OptOutNewTaxRegime`)} input`);
  await regime.scrollIntoViewIfNeeded();
  await regime.fill('N');
  await pg.waitForTimeout(300);
  check('switching to the new regime drops Chapter VI-A and applies 115BAC slabs (D1 54,750)', (await val('ITR1_IncomeDeductions.DeductUndChapVIA.TotalChapVIADeductions')) === '0' && (await val('ITR1_TaxComputation.TotalTaxPayable')) === '54750');
  await regime.fill('Y');
  await pg.waitForTimeout(200);

  await pg.getByRole('button', { name: /Computed \(\d+\)/ }).click();
  await pg.waitForTimeout(200);
  const shown = await pg.locator('.compare-row:not(.section)').count();
  check('"Computed" filter lists only computed fields (49)', shown === 49 && shown === (await pg.locator('.compare-row.computed').count()), `${shown}`);
  await pg.getByRole('button', { name: 'All fields' }).click();

  // switch to the rule set without computations: the same field becomes editable
  await rsSelect.selectOption({ label: await rsSelect.locator('option', { hasText: 'validation only' }).textContent() });
  await pg.waitForTimeout(300);
  check('another rule set for the same schema: GTI becomes an editable input', (await gti.locator('input').count()) === 1 && (await gti.locator('.computed-value').count()) === 0);
  await rsSelect.selectOption({ label: await rsSelect.locator('option', { hasText: 'with computation' }).textContent() });
  await pg.waitForTimeout(300);

  await pg.locator('button.primary', { hasText: /Save/ }).click();
  await pg.locator('.alert.ok', { hasText: /^Saved/ }).waitFor({ timeout: 10000 });
  const docs = await (await fetch(`${base}/api/documents`)).json();
  const stored = await (await fetch(`${base}/api/documents/${docs[0].id}`)).json();
  check('saved document carries the computed values', stored.data.ITR.ITR1.ITR1_TaxComputation.TotalTaxPayable === 68500 && stored.data.ITR.ITR1.TaxPaid.BalTaxPayable === 41240);

  // E9: break an entered field -> A192, Save disabled, banner, click scrolls
  const docsN = (await (await fetch(`${base}/api/documents`)).json()).length;
  const claim = pg.locator(`${id(`${P}TDSonOthThanSals.TDSonOthThanSal[0].ClaimOutOfTotTDSOnAmtPaid`)} input`);
  await claim.scrollIntoViewIfNeeded(); const claimWas = await claim.inputValue();
  await claim.fill('5000'); await pg.waitForTimeout(300);
  const errCards = await pg.locator('.violation, .viol').count();
  const saveBtn = pg.locator('button.primary', { hasText: /Save/ });
  const panelTxt = await pg.locator('body').innerText();
  check('E9: one error A192 shown, Save disabled with banner', /Schedule TDS2: TDS claimed this year/.test(panelTxt) && await saveBtn.isDisabled() && /can only be saved once all errors are resolved/.test(panelTxt), `cards ${errCards}`);
  await claim.fill(claimWas); await pg.waitForTimeout(300);
  check('E9: fixing it clears the error', (await pg.locator('.panel-header .badge.ok').first().textContent()) === 'valid');
  // E10: duplicate SAV row -> A38, remove -> valid
  const oth = `${P}ITR1_IncomeDeductions.OthersInc.OthersIncDtlsOthSrc`;
  const rowsBefore = await pg.locator(`[id^="f-${oth}["][id$="].OthSrcNatureDesc"]`).count();
  await pg.locator(id(oth)).getByRole('button', { name: /Add item/ }).click(); await pg.waitForTimeout(300);
  const nat = pg.locator(id(`${oth}[${rowsBefore}].OthSrcNatureDesc`)).locator('select, input').first();
  if (await nat.evaluate((e) => e.tagName) === 'SELECT') await nat.selectOption('SAV'); else await nat.fill('SAV');
  await pg.waitForTimeout(300);
  check('E10: duplicate SAV row fires A38', /cannot be selected more than once/.test(await pg.locator('body').innerText()));
  await pg.locator(id(`${oth}[${rowsBefore}]`)).getByRole('button', { name: /✕/ }).first().click(); await pg.waitForTimeout(300);
  check('E10: removing the row makes it valid again', (await pg.locator('.panel-header .badge.ok').first().textContent()) === 'valid');

  // Rule Sets page lists the computed fields with enable toggles
  await pg.getByRole('button', { name: '2. Rule sets' }).click();
  await pg.waitForTimeout(400);
  const li = pg.locator('ul.list li', { hasText: 'with computation' });
  check('E12: rule-set list badges 73 and ƒ 52', /73/.test(await li.innerText()) && /[ƒƑ]\s*52/i.test(await li.innerText()), await li.innerText());
  await li.click();
  await pg.getByTestId('tab-computed').click();
  await pg.waitForTimeout(200);
  check('Rule Sets page shows the computed fields', (await pg.locator('.rule-card').count()) === rs.computations.length);
  const exp = await (await fetch(`${base}/api/rulesets/${full.id}/export`)).json();
  const re = await post({ ...exp, name: 'reimported', schemaId: schema.id });
  check('E12: export re-imports intact', re.rules?.length === 73 && re.computations?.length === 52 && re.display?.readOnly?.length === 3 && exp.schemaName === 'ITR-1 AY 2024-25', JSON.stringify({ r: re.rules?.length, c: re.computations?.length, s: exp.schemaName }));
  check('no page errors', errors.length === 0, errors.join('; '));
  await browser.close();
} catch (e) {
  check('e2e run', false, e.stack);
} finally {
  server.kill();
}
console.log(failures ? `\n${failures} check(s) failed` : '\nAll computed-field e2e checks passed');
process.exit(failures ? 1 : 0);
