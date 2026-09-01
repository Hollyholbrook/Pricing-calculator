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
const pricingRules = require('./pricingRules');
const { defaultSettings } = require('./appSettings');

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

// Professional services are priced by HOW MANY were selected, per the workbook's bundled ladder
// and Shane Tjin, 2026-08-27: "any combination of PS would result in the below pricing... it's not
// specific to any one selection."
//
// This is a regression test for a bug that reached production and was invisible from the code: the
// card showed three services selected and "List $0 one-time" beneath them. psItemCount used to be
// readable from the input and won over the selection, and normalizeStoredInput wrote it into every
// stored configuration -- so a config saved with no services pinned the fee at $0 forever after it
// was restored, however many services the rep then picked.
test('the professional services fee follows the selection, never a stale psItemCount', () => {
  const base = {
    termMonths: 12,
    paymentFrequency: 'annual_in_advance',
    volumes: { connect_ca: 5_000 },
    supportLevel: 'basic',
    onboardingPackage: 'none',
    addOns: [],
    professionalServices: [
      'gtm_review',
      'architecture_workflow_review',
      'google_verification_review',
    ],
  };
  // The ladder: 3 selected is $5,500, not 3 x $2,000.
  assert.equal(calculateQuote(base).professionalServicesAmount, 5_500);

  // The actual failure: a stale count riding along in the input must be ignored entirely.
  assert.equal(
    calculateQuote({ ...base, psItemCount: 0 }).professionalServicesAmount,
    5_500,
    'a stale psItemCount must not override the selected services',
  );
  // ...in either direction. An inflated count must not invent revenue that no line item backs.
  assert.equal(
    calculateQuote({ ...base, psItemCount: 5 }).professionalServicesAmount,
    5_500,
  );

  // And every rung of the ladder is driven by the selection alone.
  const ladder = [
    [[], 0],
    [['gtm_review'], 2_000],
    [['gtm_review', 'google_verification_review'], 3_800],
    [['gtm_review', 'google_verification_review', 'architecture_workflow_review'], 5_500],
    [
      [
        'gtm_review',
        'google_verification_review',
        'architecture_workflow_review',
        'provider_oauth_app_creation',
      ],
      7_200,
    ],
    [
      [
        'gtm_review',
        'google_verification_review',
        'architecture_workflow_review',
        'provider_oauth_app_creation',
        'notification_webhook_best_practices',
      ],
      8_800,
    ],
  ];
  for (const [services, expected] of ladder) {
    assert.equal(
      calculateQuote({ ...base, professionalServices: services, psItemCount: 0 })
        .professionalServicesAmount,
      expected,
      `${services.length} services must price at ${expected}`,
    );
  }
});

test('a stored configuration carries no psItemCount to go stale', () => {
  // normalizeStoredInput is what persists a locked configuration. It used to write psItemCount,
  // which is how the stale value outlived the selection that produced it.
  const stored = normalizeStoredInput({
    termMonths: 12,
    paymentFrequency: 'annual_in_advance',
    volumes: { connect_ca: 5_000 },
    supportLevel: 'basic',
    onboardingPackage: 'none',
    addOns: [],
    professionalServices: ['gtm_review', 'google_verification_review'],
  });
  assert.equal('psItemCount' in stored, false, 'psItemCount must not be persisted');
  assert.deepEqual(stored.professionalServices, ['gtm_review', 'google_verification_review']);
  // Round-trips to the right money with nothing else carried over.
  assert.equal(calculateQuote(stored).professionalServicesAmount, 3_800);
});

test('OAuth without professional services is blocked', () => {
  const base = {
    termMonths: 12,
    paymentFrequency: 'annual_in_advance',
    volumes: { connect_ca: 5_000 },
    supportLevel: 'basic',
    onboardingPackage: 'none',
    addOns: ['verified_oauth'],
  };
  // Turnkey Verified OAuth requires a professional-services item again. This test asserted the
  // OPPOSITE between 2026-08-28 and 2026-09-01, and the flip is deliberate both times.
  //
  // Removed 2026-08-28 on Holly's instruction. Reinstated 2026-09-01, also on Holly's instruction,
  // because Pricing Workbook v9 -- which postdates the removal -- names the add-on "Turnkey
  // Verified OAuth Projects (req. PS)" in all three places it appears. The workbook is the source
  // of truth for pricing rules; if IT is the stale one, lift the block rather than ignoring the
  // label.
  //
  // Both directions are checked, because this rule blocks real quotes in one direction and lets
  // unpriced work through in the other.
  const withNone = calculateQuote({ ...base, professionalServices: [], psItemCount: 3 });
  assert.equal(withNone.blockingReasons.length, 1, 'OAuth without services must be blocked');
  assert.match(withNone.blockingReasons[0], /Turnkey Verified OAuth Projects requires a Profession/);
  // A SENTENCE, not a code: the card renders these verbatim to the rep.
  assert.doesNotMatch(withNone.blockingReasons[0], /^[A-Z_]+$/);
  // psItemCount is a stale field and must not satisfy the rule -- only real selections do.
  assert.equal(withNone.blockingReasons.length, 1, 'psItemCount does not count as a selection');

  // ANY professional-services item satisfies it. The workbook says "req. PS" and never names one,
  // so a GTM Review -- nothing to do with OAuth -- is enough. Demanding a specific item would
  // refuse quotes the workbook permits.
  const withOne = calculateQuote({
    ...base,
    professionalServices: ['gtm_review'],
    psItemCount: 0,
  });
  assert.deepEqual(withOne.blockingReasons, []);

  // It BLOCKS; it does not route for approval. An approval reason nobody can act on is noise.
  assert.equal(
    withNone.approvalReasons.some((reason) => /OAuth/i.test(reason)),
    false,
    'blocking is the whole mechanism -- it must not also raise an approval reason',
  );
  assert.equal(/OAUTH/i.test(String(withNone.guardrailSummary || '')), false);
});

// Renewals route discounts to their own approver, configurable in Settings.
//
// Holly, 2026-08-28: a discount entered in the renewals flow needs CCSO approval, and the
// size-based Sales Director / Head of Sales / Finance ladder does not apply to renewals. Every
// value is a setting, because who signs off on a concession is policy, not arithmetic.
const renewalInput = (extra = {}) => ({
  startDate: '2026-09-01',
  termMonths: 12,
  paymentFrequency: 'annual_in_advance',
  volumes: {
    connect_ca: 6_000,
    calendar_ca: 0,
    notetaker_bot_hours: 0,
    agent_accounts: 0,
    agent_email_thousands: 0,
    agent_storage_gb: 0,
    agent_bandwidth_gb: 0,
  },
  supportLevel: 'basic',
  onboardingPackage: 'none',
  addOns: [],
  professionalServices: [],
  discretionaryDiscount: 0,
  autoRenewal: true,
  renewalTermMonths: 12,
  nonRenewalNoticeDays: 60,
  redliningRequested: false,
  nonStandardTerms: false,
  specialTerms: '',
  ...extra,
});

test('the approval matrix: same thresholds, different approver by deal type', () => {
  // Holly's table, 2026-08-28:
  //   0%            no approval                    all
  //   up to 10%     Sales Director / CS Director   new / renewal
  //   10% - 30%     Head of Sales / CCSO           new / renewal
  //   over 30%      Finance                        all
  const tier = (d, category) =>
    calculateQuote(renewalInput({ discretionaryDiscount: d }), {}, 0, category)
      .approvalTierRequired;
  const rows = [
    [0, 'none', 'none'],
    [0.05, 'sales_director', 'cs_director'],
    [0.1, 'sales_director', 'cs_director'],
    [0.101, 'head_sales', 'ccso'],
    [0.3, 'head_sales', 'ccso'],
    [0.301, 'finance', 'finance'],
    [1, 'finance', 'finance'],
  ];
  for (const [discount, newBusiness, renewal] of rows) {
    assert.equal(tier(discount, 'new_business'), newBusiness, `new business at ${discount}`);
    assert.equal(tier(discount, 'renewal'), renewal, `renewal at ${discount}`);
  }
  // The boundaries are inclusive at the top of each band: exactly 10% is still the first tier.
  assert.equal(tier(0.1, 'renewal'), 'cs_director');
  assert.equal(tier(0.3, 'renewal'), 'ccso');
});

test('term and payment adjustments are pre-approved and never escalate', () => {
  // A 36-month monthly-in-advance deal moves every rate, and must still need no approval.
  const adjusted = renewalInput({ termMonths: 36, paymentFrequency: 'monthly_in_advance' });
  for (const category of ['new_business', 'renewal']) {
    assert.equal(
      calculateQuote(adjusted, {}, 0, category).approvalTierRequired,
      'none',
      `${category}: term and frequency are not concessions`,
    );
  }
});

test('a 100%-off line goes to Finance even if the thresholds would allow it', () => {
  // Redundant at the default 30% ceiling, but a raised threshold must not let a free line through
  // at a lower tier.
  const policy = { salesDirectorDiscountMax: 1, headSalesDiscountMax: 1 };
  for (const category of ['new_business', 'renewal']) {
    assert.equal(
      calculateQuote(renewalInput({ discretionaryDiscount: 1 }), policy, 0, category)
        .approvalTierRequired,
      'finance',
      `${category}: a free line is Finance's call`,
    );
    // ...and a merely large discount does not trip THIS rule. Asserted on the reason rather than
    // the tier: at 90% off the ARR falls under the Enterprise minimum, which forces Finance for a
    // different and legitimate reason, so the tier alone cannot tell the two apart.
    const large = calculateQuote(renewalInput({ discretionaryDiscount: 0.9 }), policy, 0, category);
    assert.equal(
      large.approvalReasons.some((reason) => /discounted 100%/.test(reason)),
      false,
      `${category}: 90% is not a free line`,
    );
    const free = calculateQuote(renewalInput({ discretionaryDiscount: 1 }), policy, 0, category);
    assert.ok(free.approvalReasons.some((reason) => /discounted 100%/.test(reason)));
  }
});

test('the approvers for each rung come from Settings', () => {
  const policy = {
    newBusinessFirstApprovalTier: 'finance',
    renewalSecondApprovalTier: 'head_sales',
  };
  assert.equal(
    calculateQuote(renewalInput({ discretionaryDiscount: 0.05 }), policy, 0, 'new_business')
      .approvalTierRequired,
    'finance',
  );
  assert.equal(
    calculateQuote(renewalInput({ discretionaryDiscount: 0.2 }), policy, 0, 'renewal')
      .approvalTierRequired,
    'head_sales',
  );
});

test('new business still uses the size ladder', () => {
  const tier = (d) =>
    calculateQuote(renewalInput({ discretionaryDiscount: d }), {}, 0, 'new_business')
      .approvalTierRequired;
  assert.equal(tier(0.05), 'sales_director');
  assert.equal(tier(0.2), 'head_sales');
  assert.equal(tier(0.45), 'finance');
  // And the default category is new business, so nothing changes for existing callers.
  assert.equal(
    calculateQuote(renewalInput({ discretionaryDiscount: 0.05 })).approvalTierRequired,
    'sales_director',
  );
});

// Holly, 2026-08-31: "Just disable the arr minumum."
//
// The threshold itself is deliberately KEPT at $25,000 -- the workbook states it, and deleting the
// number would make re-enabling the rule a guess. This asserts the switch, not the number.
test('the Enterprise ARR minimum is disabled', () => {
  const tiny = renewalInput({ volumes: { ...renewalInput().volumes, connect_ca: 10 } });

  // The rate card alone, and the default settings policy, must agree -- otherwise the rule is off
  // in one path and on in the other, which is how a rep and the Deal end up disagreeing.
  for (const [label, policy] of [
    ['rate card', {}],
    ['default settings policy', defaultSettings().pricingPolicy],
  ]) {
    const quote = calculateQuote(tiny, policy, 0, 'new_business');
    assert.ok(
      quote.committedArr < pricingRules.minimumCommittedArr,
      `${label}: the fixture must actually be under the minimum or this proves nothing`,
    );
    assert.equal(
      quote.blockingReasons.includes('BELOW_ENTERPRISE_MINIMUM'),
      false,
      `${label}: a small deal must not be blocked`,
    );
    assert.equal(
      quote.approvalReasons.some((reason) => /Enterprise minimum/.test(reason)),
      false,
      `${label}: and must not be escalated for it either`,
    );
    // approvalStatus is the legacy guardrail list, joined. It writes to the Deal, so it has to
    // agree with the approval ladder or the record contradicts the card.
    assert.equal(
      /FINANCE_APPROVAL_BELOW_MINIMUM/.test(quote.approvalStatus),
      false,
      `${label}: the legacy guardrail list must agree with the approval ladder`,
    );
  }

  // The threshold survives being switched off, so turning it back on needs one checkbox.
  assert.equal(pricingRules.minimumCommittedArr, 25_000);
  assert.equal(defaultSettings().pricingPolicy.minimumCommittedArr, 25_000);
});

// The switch has to work in BOTH directions, or "disabled" is indistinguishable from "removed".
test('the ARR minimum can be switched back on', () => {
  const tiny = renewalInput({ volumes: { ...renewalInput().volumes, connect_ca: 10 } });

  const on = calculateQuote(tiny, { enforceMinimumCommittedArr: true }, 0, 'new_business');
  assert.ok(
    on.blockingReasons.includes('BELOW_ENTERPRISE_MINIMUM'),
    'switching it on must block a deal under the threshold',
  );
  assert.ok(
    on.approvalReasons.some((reason) => /\$25,000 Enterprise minimum/.test(reason)),
    'and must say which threshold it failed',
  );
  assert.ok(/FINANCE_APPROVAL_BELOW_MINIMUM/.test(on.approvalStatus));

  // The threshold is still the one that decides, once the rule is on: raise it and a deal that
  // cleared it stops clearing it.
  const comfortable = renewalInput();
  assert.deepEqual(
    calculateQuote(comfortable, { enforceMinimumCommittedArr: true }, 0, 'new_business')
      .blockingReasons,
    [],
    'a deal above the threshold is fine with the rule on',
  );
  assert.ok(
    calculateQuote(
      comfortable,
      { enforceMinimumCommittedArr: true, minimumCommittedArr: 10_000_000 },
      0,
      'new_business',
    ).blockingReasons.includes('BELOW_ENTERPRISE_MINIMUM'),
    'and is blocked once the threshold is raised above it',
  );
});

test('renewals skip the non-discount approvals that block new business', () => {
  // Far below the $25,000 Enterprise minimum. On new business this BLOCKS Lock in; a renewal is
  // expected to come in under it, so leaving that on would refuse every small renewal outright.
  //
  // The minimum is DISABLED by default (Holly, 2026-08-31), so it is switched on explicitly here.
  // The renewal relaxation is what this test is about, and it still has to work for whoever turns
  // the rule back on -- testing it against the disabled default would prove nothing.
  const enforcing = { enforceMinimumCommittedArr: true };
  const small = renewalInput({ volumes: { ...renewalInput().volumes, connect_ca: 10 } });
  const asNew = calculateQuote(small, enforcing, 0, 'new_business');
  assert.ok(asNew.blockingReasons.includes('BELOW_ENTERPRISE_MINIMUM'));

  const asRenewal = calculateQuote(small, enforcing, 0, 'renewal');
  assert.deepEqual(asRenewal.blockingReasons, [], 'a small renewal must not be blocked');
  assert.equal(asRenewal.approvalTierRequired, 'none');

  // Special terms below the ARR threshold: blocks new business, not renewals. The input key is
  // still redliningRequested -- renaming it would change the hash of every stored option -- but
  // everything a rep reads now says special terms.
  const redlined = { ...small, redliningRequested: true };
  assert.ok(
    calculateQuote(redlined, {}, 0, 'new_business').blockingReasons.includes(
      'SPECIAL_TERMS_BELOW_THRESHOLD',
    ),
  );
  assert.ok(
    calculateQuote(redlined, {}, 0, 'new_business').approvalReasons.some((r) =>
      /Special terms were requested below the \$50,000 ARR threshold\./.test(r),
    ),
  );
  // Nothing a rep sees may still say "redlin" -- that was the point of the rename.
  for (const line of [
    ...calculateQuote(redlined, {}, 0, 'new_business').blockingReasons,
    ...calculateQuote(redlined, {}, 0, 'new_business').approvalReasons,
  ]) {
    assert.equal(/redlin/i.test(line), false, `still says redlining: ${line}`);
  }
  assert.deepEqual(calculateQuote(redlined, {}, 0, 'renewal').blockingReasons, []);
  // The Legal note survives, because it informs rather than gates.
  assert.ok(
    calculateQuote(redlined, {}, 0, 'renewal').approvalReasons.some((r) => /Legal/.test(r)),
  );

  // Non-standard terms are NOT asserted here: the option is retired and normalizeInput strips it,
  // so it escalates nothing on either category. The renewal branch skips its check anyway; there
  // is just no way to reach it from an input, and a test that pretended otherwise would be
  // asserting against a fixture rather than against behaviour.
});

test('OAuth without professional services is blocked on a renewal too', () => {
  // NOT relaxed for renewals. renewalRelaxesNonDiscountApprovals waives approval THRESHOLDS -- the
  // ARR minimum and the redlining floor. This is a product dependency, not a threshold: a renewal
  // that sells the add-on needs the services exactly as a new deal does.
  const noServices = renewalInput({ addOns: ['verified_oauth'], professionalServices: [] });
  for (const category of ['new_business', 'renewal']) {
    const blocked = calculateQuote(noServices, {}, 0, category).blockingReasons;
    assert.equal(blocked.length, 1, `${category}: the OAuth dependency applies`);
    assert.match(blocked[0], /requires a Professional Services item/);
  }
  // And satisfied the same way on both.
  const withService = renewalInput({
    addOns: ['verified_oauth'],
    professionalServices: ['provider_oauth_app_creation'],
  });
  for (const category of ['new_business', 'renewal']) {
    assert.deepEqual(calculateQuote(withService, {}, 0, category).blockingReasons, []);
  }
});
