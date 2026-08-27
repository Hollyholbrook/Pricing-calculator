const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const {
  QuoteValidationError,
  calculateQuote,
  normalizeInput,
  normalizeStoredInput,
  round,
} = require('./calculator');

const goldenTests = require(path.resolve(
  __dirname,
  'fixtures/quote_calculator_golden_tests_v1.json',
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
    renewalDate: '2028-09-01',
    nonRenewalNoticeDate: '2028-06-15',
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
  assert.equal(nonRenewingResult.dates.nonRenewalNoticeDate, '2027-06-15');
});

test('calculates notice deadlines from contract end across month and leap-year boundaries', () => {
  const base = {
    termMonths: 12,
    paymentFrequency: 'annual_in_advance',
    volumes: { connect_ca: 1_000 },
    supportLevel: 'basic',
    onboardingPackage: 'quick_launch',
    professionalServices: [],
    addOns: [],
    autoRenewal: true,
  };

  const monthEnd = calculateQuote({ ...base, startDate: '2026-09-01' });
  assert.equal(monthEnd.dates.contractEndDate, '2027-08-31');
  assert.equal(monthEnd.dates.renewalDate, '2027-09-01');
  assert.equal(monthEnd.dates.nonRenewalNoticeDate, '2027-07-02');

  const leapYear = calculateQuote({ ...base, startDate: '2023-03-01' });
  assert.equal(leapYear.dates.contractEndDate, '2024-02-29');
  assert.equal(leapYear.dates.renewalDate, '2024-03-01');
  assert.equal(leapYear.dates.nonRenewalNoticeDate, '2023-12-31');

  const multiYear = calculateQuote({ ...base, startDate: '2024-02-29', termMonths: 36 });
  assert.equal(multiYear.dates.contractEndDate, '2027-02-27');
  assert.equal(multiYear.dates.renewalDate, '2027-03-01');
  assert.equal(multiYear.dates.nonRenewalNoticeDate, '2026-12-29');
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

// The recurring half is still the workbook screenshot, unchanged, and remains the guard on the
// Excel-compatible rate maths. Only the one-time half moved: Quick Launch + went $5,000 -> $10,000
// on 2026-08-27, lifting TCV by exactly that. The screenshot's own TCV was $95,250.
test('Excel-compatible regression: screenshot quote recurring figures, corrected onboarding', () => {
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
  assert.equal(result.onboardingAmount, 10_000);
  assert.equal(result.tcv, 100_249.6);
  // The screenshot showed $95,250; the gap is the onboarding correction and nothing else.
  assert.equal(Math.round(result.tcv) - 5_000, 95_250);
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
  // Quick Launch + at $10,000 less its own 35%.
  assert.equal(result.onboardingAmount, 6_500);
  assert.equal(result.professionalServicesAmount, 1_800);
  assert.equal(result.selectedAddOns[0].annualAmount, 1_920);

  // Support is charged as a percentage of the ARR the customer actually pays, so the 5% product
  // discount flows through to it, and the 15% support discount applies on top of that.
  // listSupportAnnual is the list-price counterpart and must stay derived from listPlatformArr —
  // asserting supportAnnual === listSupportAnnual * 0.85 previously passed only because the
  // "list" figure was itself computed from the discounted ARR, which understated the blended
  // effective discount written to the Deal.
  const supportPercent = result.listSupportAnnual / result.listPlatformArr;
  assert.equal(result.supportAnnual, round(result.proposedPlatformArr * supportPercent * 0.85, 2));
  assert.ok(result.listSupportAnnual > result.supportAnnual / 0.85);
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

test('discounts on items that are not quoted do not escalate the approval tier', () => {
  const base = {
    termMonths: 12,
    paymentFrequency: 'annual_in_advance',
    volumes: { connect_ca: 20_000 },
    supportLevel: 'basic',
    // Must be "None": Quick Launch used to be $0, so the onboarding discount below moved no money
    // by accident rather than by the guard. It is $5,000 now, so "None" is the only $0 package.
    onboardingPackage: 'none',
    professionalServices: [],
    addOns: [],
  };
  const baseline = calculateQuote(base);
  assert.equal(baseline.approvalTierRequired, 'none');

  // A discount typed against a product with no volume, an add-on that was deselected, or a $0
  // support/onboarding line moves no money. It must not route the deal for approval.
  const phantom = calculateQuote({
    ...base,
    productDiscounts: { notetaker_bot_hours: 0.4 },
    addOnDiscounts: { privacy_filter: 1 },
    supportDiscount: 0.35,
    onboardingDiscount: 0.2,
    professionalServicesDiscount: 0.5,
  });
  assert.equal(phantom.committedArr, baseline.committedArr);
  assert.equal(phantom.tcv, baseline.tcv);
  assert.equal(phantom.largestDiscretionaryDiscount, 0);
  assert.equal(phantom.approvalTierRequired, 'none');

  // A discount on a product that is actually quoted still routes normally.
  const real = calculateQuote({ ...base, productDiscounts: { connect_ca: 0.4 } });
  assert.equal(real.largestDiscretionaryDiscount, 0.4);
  assert.notEqual(real.approvalTierRequired, 'none');
});

test('graduated list band rates come from the calculator, not from a UI reimplementation', () => {
  const result = calculateQuote({
    termMonths: 36,
    paymentFrequency: 'monthly_in_advance',
    volumes: { agent_email_thousands: 600 },
    supportLevel: 'basic',
    onboardingPackage: 'quick_launch',
    professionalServices: [],
    addOns: [],
  });
  const line = result.lines.find(({ productKey }) => productKey === 'agent_email_thousands');

  assert.equal(line.listBandRates.length, line.baseBandRates.length);
  // The adjustment is additive and rounded to cents. The multiplicative form the card used to
  // compute, rate * (1 - termDiscount) * (1 + paymentPremium), understates every band.
  for (const [index, band] of line.baseBandRates.entries()) {
    assert.equal(
      line.listBandRates[index].rate,
      round(band.rate * (1 - result.termDiscount + result.paymentPremium), 2),
    );
    assert.equal(line.listBandRates[index].lower, band.lower);
    assert.equal(line.listBandRates[index].upper, band.upper);
  }
  // The published list rates must reproduce the list MRR the quote totals are built from.
  const rebuiltListMrr = line.listBandRates.reduce((total, band, index) => {
    const upper = band.upper == null ? line.volume : Math.min(line.volume, band.upper);
    return total + Math.max(upper - band.lower, 0) * band.rate;
  }, 0);
  assert.equal(round(rebuiltListMrr, 2), line.listMrr);
});

test('stored input is normalized to catalog keys and drops retracted redline text', () => {
  const stored = normalizeStoredInput({
    termMonths: 12,
    paymentFrequency: 'Annual In Advance',
    volumes: { connect_ca: 1_000 },
    supportLevel: 'Full Support',
    onboardingPackage: 'Quick Launch +',
    professionalServices: ['gtm_review', 'gtm_review'],
    addOns: [],
    redliningRequested: false,
    specialTerms: 'INTERNAL: customer demands uncapped liability',
  });

  // Human labels calculate fine but are not CATALOG keys, and would fail later with
  // PRODUCT_MAPPING_REQUIRED once they were persisted verbatim.
  assert.equal(stored.paymentFrequency, 'annual_in_advance');
  assert.equal(stored.supportLevel, 'full');
  assert.equal(stored.onboardingPackage, 'quick_launch_plus');
  // Duplicates would otherwise become duplicate line items on the Deal and the Quote.
  assert.deepEqual(stored.professionalServices, ['gtm_review']);
  // Retracted redlines must never survive into a customer-facing Quote.
  assert.equal(stored.specialTerms, '');
});

// Credit card is not permitted on an invoice above $25,000 -- ACH/Bank Transfer (wire) is
// required. Holly, 2026-08-27, a hard requirement rather than an approval step.
//
// The subtlety worth protecting: the limit is judged on the largest single INVOICE, not on ARR and
// not on TCV. Those three differ by an order of magnitude on the same deal, and picking the wrong
// one silently lets a barred credit card through.
test('the credit card limit is judged on the largest invoice, not on ARR or TCV', () => {
  const base = {
    termMonths: 12,
    paymentFrequency: 'monthly_in_advance',
    volumes: { connect_ca: 20_000 },
    supportLevel: 'basic',
    onboardingPackage: 'none',
    professionalServices: [],
    addOns: [],
  };
  const monthly = calculateQuote(base);

  // ARR is nearly $300K and TCV the same, but the customer is invoiced monthly, and one month is
  // under the limit. Testing ARR here would demand ACH on a $24K invoice.
  assert.ok(monthly.committedArr > 250_000, 'ARR is far above the limit');
  assert.ok(monthly.recurringInvoiceAmount < 25_000, 'but a monthly invoice is not');
  assert.equal(monthly.requiresBankTransfer, false);

  // Same deal, plus onboarding. The recurring payment has not moved, but the FIRST invoice now
  // carries the one-time charge as well and crosses the limit. This is the case a naive
  // "recurringPerPeriod > limit" check gets wrong.
  const withOnboarding = calculateQuote({ ...base, onboardingPackage: 'strategic' });
  assert.equal(
    withOnboarding.recurringInvoiceAmount,
    monthly.recurringInvoiceAmount,
    'the recurring payment is unchanged',
  );
  assert.ok(withOnboarding.firstInvoiceAmount > 25_000, 'the first invoice crosses the limit');
  assert.equal(withOnboarding.requiresBankTransfer, true);
  assert.equal(
    withOnboarding.largestInvoiceAmount,
    withOnboarding.firstInvoiceAmount,
    'the largest invoice is the first one',
  );
});

test('a single large annual invoice requires bank transfer', () => {
  const annual = calculateQuote({
    termMonths: 12,
    paymentFrequency: 'annual_in_advance',
    volumes: { connect_ca: 20_000 },
    supportLevel: 'basic',
    onboardingPackage: 'none',
    professionalServices: [],
    addOns: [],
  });
  assert.equal(annual.requiresBankTransfer, true);
  // Billed once a year, so the invoice IS the ARR and the two coincide. That they agree here is
  // why the monthly case above is the one that actually proves the rule.
  assert.equal(annual.recurringInvoiceAmount, annual.committedArr);
});

test('a small deal is left on credit card', () => {
  const small = calculateQuote({
    termMonths: 12,
    paymentFrequency: 'annual_in_advance',
    volumes: { connect_ca: 1_200 },
    supportLevel: 'basic',
    onboardingPackage: 'none',
    professionalServices: [],
    addOns: [],
  });
  assert.ok(small.largestInvoiceAmount < 25_000);
  assert.equal(small.requiresBankTransfer, false);
});

test('the invoice figures reconcile to the recurring payment and the one-time total', () => {
  const result = calculateQuote({
    termMonths: 24,
    paymentFrequency: 'quarterly_in_advance',
    volumes: { connect_ca: 5_000 },
    supportLevel: 'full',
    onboardingPackage: 'quick_launch_plus',
    professionalServices: ['gtm_review'],
    addOns: ['privacy_filter'],
  });
  // No independent arithmetic: the invoice figures must be the calculation's own numbers, or the
  // rule is judged on something the Contract Summary never showed.
  assert.equal(result.recurringInvoiceAmount, result.recurringPerPeriod);
  assert.equal(
    result.firstInvoiceAmount,
    round(result.recurringPerPeriod + result.oneTime, 2),
  );
  assert.equal(
    result.largestInvoiceAmount,
    Math.max(result.firstInvoiceAmount, result.recurringInvoiceAmount),
  );
});

test('the credit card limit is exclusive, so exactly the limit is still allowed', () => {
  // "> $25K" -- an invoice of exactly $25,000 is permitted. An off-by-one here silently changes
  // the policy for every deal that lands on the boundary.
  const atLimit = calculateQuote(
    {
      termMonths: 12,
      paymentFrequency: 'annual_in_advance',
      volumes: { connect_ca: 1_000 },
      supportLevel: 'basic',
      onboardingPackage: 'none',
      professionalServices: [],
      addOns: [],
    },
    { minimumCommittedArr: 0, creditCardMaximumInvoice: 19_800 },
  );
  assert.equal(atLimit.largestInvoiceAmount, 19_800, 'fixture must sit exactly on the limit');
  assert.equal(atLimit.requiresBankTransfer, false);

  const overLimit = calculateQuote(
    {
      termMonths: 12,
      paymentFrequency: 'annual_in_advance',
      volumes: { connect_ca: 1_000 },
      supportLevel: 'basic',
      onboardingPackage: 'none',
      professionalServices: [],
      addOns: [],
    },
    { minimumCommittedArr: 0, creditCardMaximumInvoice: 19_799.99 },
  );
  assert.equal(overLimit.requiresBankTransfer, true);
});
