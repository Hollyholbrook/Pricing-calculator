const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const { QuoteValidationError, calculateQuote, normalizeInput } = require('./calculator');

const goldenTests = require(path.resolve(
  __dirname,
  '../../../../../outputs/quote-agent-hub/quote_calculator_golden_tests_v1.json',
));

const expectedLineFields = [
  'productKey',
  'volume',
  'baseBlendedRate',
  'listUnitRate',
  'proposedUnitRate',
  'listMrr',
  'proposedMrr',
];

const assertEquivalent = (actual, expected, label) => {
  if (typeof expected === 'number') {
    assert.ok(Math.abs(actual - expected) < 1e-9, `${label}: ${actual} !== ${expected}`);
    return;
  }
  assert.equal(actual, expected, label);
};

for (const golden of goldenTests) {
  test(`golden: ${golden.name}`, () => {
    const actual = calculateQuote(golden.input, { calculationMethod: 'rounded_unit_rate' });
    for (const field of [
      'termDiscount',
      'paymentPremium',
      'listPlatformArr',
      'proposedPlatformArr',
      'supportAnnual',
      'annualAddOns',
      'committedArr',
      'oneTime',
      'tcv',
      'approvalStatus',
    ]) {
      assertEquivalent(actual[field], golden.expected[field], field);
    }
    assert.equal(actual.lines.length, golden.expected.lines.length);
    actual.lines.forEach((line, index) => {
      for (const field of expectedLineFields) {
        assertEquivalent(line[field], golden.expected.lines[index][field], `${index}.${field}`);
      }
    });
  });
}

test('routes New Business discount approval tiers', () => {
  const base = {
    termMonths: 12,
    paymentFrequency: 'annual_in_advance',
    volumes: { connect_ca: 2_000 },
    supportLevel: 'basic',
    onboardingPackage: 'quick_launch',
    professionalServices: [],
    addOns: [],
  };
  assert.equal(calculateQuote({ ...base, discretionaryDiscount: 0 }).approvalTierRequired, 'none');
  assert.equal(
    calculateQuote({ ...base, discretionaryDiscount: 0.1 }).approvalTierRequired,
    'sales_director',
  );
  assert.equal(
    calculateQuote({ ...base, discretionaryDiscount: 0.2 }).approvalTierRequired,
    'head_sales',
  );
  assert.equal(
    calculateQuote({ ...base, discretionaryDiscount: 0.31 }).approvalTierRequired,
    'finance',
  );
});

test('derives contract and renewal dates', () => {
  const result = calculateQuote({
    startDate: '2026-08-15',
    termMonths: 24,
    paymentFrequency: 'annual_in_advance',
    volumes: { connect_ca: 1_000 },
    supportLevel: 'basic',
    onboardingPackage: 'quick_launch',
    discretionaryDiscount: 0,
    professionalServices: [],
    addOns: [],
    autoRenewal: true,
    renewalTermMonths: 12,
    nonRenewalNoticeDays: 60,
  });
  assert.deepEqual(result.dates, {
    contractStartDate: '2026-08-15',
    contractEndDate: '2028-08-14',
    renewalDate: '2028-08-15',
    nonRenewalNoticeDate: '2028-06-16',
  });
});

test('enforces the standard 12-month renewal term and 60-day notice period', () => {
  const base = {
    startDate: '2026-08-15',
    termMonths: 12,
    paymentFrequency: 'annual_in_advance',
    volumes: { connect_ca: 1_000 },
    supportLevel: 'basic',
    onboardingPackage: 'quick_launch',
    professionalServices: [],
    addOns: [],
  };

  const renewingInput = {
    ...base,
    autoRenewal: true,
    renewalTermMonths: 24,
    nonRenewalNoticeDays: 30,
  };
  const renewing = normalizeInput(renewingInput);
  assert.equal(renewing.renewalTermMonths, 12);
  assert.equal(renewing.nonRenewalNoticeDays, 60);

  const nonRenewingInput = {
    ...base,
    autoRenewal: false,
    renewalTermMonths: 24,
    nonRenewalNoticeDays: 30,
  };
  const nonRenewing = normalizeInput(nonRenewingInput);
  assert.equal(nonRenewing.renewalTermMonths, 0);
  assert.equal(nonRenewing.nonRenewalNoticeDays, 60);

  const nonRenewingResult = calculateQuote(nonRenewingInput);
  assert.equal(nonRenewingResult.dates.renewalDate, null);
  assert.equal(nonRenewingResult.dates.nonRenewalNoticeDate, '2027-06-16');
});

test('fails closed on unsupported fields', () => {
  assert.throws(
    () =>
      calculateQuote({
        termMonths: 18,
        paymentFrequency: 'annual_in_advance',
        volumes: {},
        supportLevel: 'basic',
        onboardingPackage: 'quick_launch',
        discretionaryDiscount: 0,
      }),
    (error) => error instanceof QuoteValidationError && error.code === 'UNSUPPORTED_TERM',
  );
});

test('applies account pricing overrides and records the settings version', () => {
  const input = {
    termMonths: 24,
    paymentFrequency: 'annual_in_advance',
    volumes: { connect_ca: 10_000 },
    supportLevel: 'full',
    onboardingPackage: 'quick_launch_plus',
    discretionaryDiscount: 0.15,
    professionalServices: [],
    addOns: [],
  };
  const result = calculateQuote(input, {
    minimumCommittedArr: 0,
    salesDirectorDiscountMax: 0.2,
    headSalesDiscountMax: 0.35,
    termDiscounts: { '24': 0.1 },
    support: { full: { percent: 0.05, cap: 8_000 } },
    onboardingAmounts: { quick_launch_plus: 7_500 },
  }, 7);

  assert.equal(result.settingsVersion, 7);
  assert.equal(result.termDiscount, 0.1);
  assert.equal(result.approvalTierRequired, 'sales_director');
  assert.equal(result.onboardingAmount, 7_500);
  assertEquivalent(
    result.supportAnnual,
    Math.min(result.proposedPlatformArr * 0.05, 8_000),
    'supportAnnual',
  );
});

test('Excel-compatible regression: screenshot quote displays $95,250 TCV', () => {
  const result = calculateQuote({
    startDate: '2026-09-01',
    termMonths: 12,
    paymentFrequency: 'monthly_in_advance',
    volumes: {
      connect_ca: 2_800,
      calendar_ca: 2_800,
      notetaker_bot_hours: 150,
    },
    productDiscounts: { connect_ca: 0.2 },
    supportLevel: 'full',
    onboardingPackage: 'quick_launch_plus',
    professionalServices: [],
    addOns: [],
    autoRenewal: true,
    renewalTermMonths: 12,
    nonRenewalNoticeDays: 60,
  });

  assert.equal(result.calculationMethod, 'excel_compatible');
  assert.equal(result.lines.find(({ productKey }) => productKey === 'connect_ca').proposedUnitRate, 1.29);
  assert.equal(result.proposedPlatformArr, 82_045.09);
  assert.equal(result.supportAnnual, 8_204.51);
  assert.equal(result.committedArr, 90_249.6);
  assert.equal(result.tcv, 95_249.6);
  assert.equal(Math.round(result.tcv), 95_250);
  assert.equal(result.approvalTierRequired, 'head_sales');
});

test('calculation method is explicit and changes multi-year non-annual pricing', () => {
  const input = {
    termMonths: 24,
    paymentFrequency: 'semi_annual_in_advance',
    volumes: { connect_ca: 100 },
    supportLevel: 'basic',
    onboardingPackage: 'quick_launch',
    professionalServices: [],
    addOns: [],
  };
  const excel = calculateQuote(input);
  const rounded = calculateQuote(input, { calculationMethod: 'rounded_unit_rate' });

  assert.equal(excel.lines[0].listUnitRate, 1.73);
  assert.equal(rounded.lines[0].listUnitRate, 1.72);
  assert.match(excel.calculationVersion, /excel_compatible/);
  assert.match(rounded.calculationVersion, /rounded_unit_rate/);
});

test('preserves precise display rates and product-level term commitments', () => {
  const result = calculateQuote({
    termMonths: 12,
    paymentFrequency: 'monthly_in_advance',
    volumes: { agent_accounts: 500 },
    productDiscounts: { agent_accounts: 0.1 },
    supportLevel: 'basic',
    onboardingPackage: 'quick_launch',
    professionalServices: [],
    addOns: [],
  });
  const agentAccounts = result.lines.find(({ productKey }) => productKey === 'agent_accounts');

  assert.equal(agentAccounts.displayListUnitRate, 0.216);
  assert.equal(agentAccounts.displayProposedUnitRate, 0.1944);
  assert.equal(agentAccounts.listTermCommitment, 1_296);
  assert.equal(agentAccounts.termCommitment, 1_166.4);
});

test('ignores the retired non-standard-terms option', () => {
  const result = calculateQuote({
    termMonths: 12,
    paymentFrequency: 'annual_in_advance',
    volumes: { connect_ca: 2_000 },
    supportLevel: 'basic',
    onboardingPackage: 'quick_launch',
    professionalServices: [],
    addOns: [],
    nonStandardTerms: true,
  });

  assert.equal(result.approvalTierRequired, 'none');
  assert.equal(result.approvalReasons.includes('Contract includes non-standard terms.'), false);
});

test('uses the largest line discount for approval and discounts each charge independently', () => {
  const result = calculateQuote({
    termMonths: 12,
    paymentFrequency: 'annual_in_advance',
    volumes: { connect_ca: 2_000 },
    productDiscounts: { connect_ca: 0.05 },
    supportLevel: 'full',
    supportDiscount: 0.15,
    onboardingPackage: 'quick_launch_plus',
    onboardingDiscount: 0.35,
    professionalServices: ['google_verification_review'],
    professionalServicesDiscount: 0.1,
    addOns: ['enterprise_accelerator'],
    addOnDiscounts: { enterprise_accelerator: 0.2 },
  });

  assert.equal(result.largestDiscretionaryDiscount, 0.35);
  assert.equal(result.approvalTierRequired, 'finance');
  assert.equal(result.onboardingAmount, 3_250);
  assert.equal(result.professionalServicesAmount, 1_800);
  assert.equal(result.selectedAddOns[0].annualAmount, 1_920);
  assert.equal(result.supportAnnual, result.listSupportAnnual * 0.85);
});

test('uses editable product band rates without changing protected band boundaries', () => {
  const input = {
    termMonths: 12,
    paymentFrequency: 'annual_in_advance',
    volumes: { agent_accounts: 1_000 },
    supportLevel: 'basic',
    onboardingPackage: 'quick_launch',
    professionalServices: [],
    addOns: [],
  };
  const result = calculateQuote(input, { productBandRates: { agent_accounts: [0.35] } }, 2);
  const line = result.lines.find(({ productKey }) => productKey === 'agent_accounts');
  assert.equal(line.baseBlendedRate, 0.35);
  assert.equal(line.proposedUnitRate, 0.35);
  assert.equal(result.settingsVersion, 2);
});
