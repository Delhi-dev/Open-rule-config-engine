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
