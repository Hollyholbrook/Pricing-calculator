const assert = require('node:assert/strict');
const test = require('node:test');

const { calculateQuote } = require('./calculator');
const rules = require('./pricingRules');

const baseInput = {
  termMonths: 12,
  paymentFrequency: 'annual_in_advance',
  volumes: {},
  supportLevel: 'basic',
  onboardingPackage: 'quick_launch',
  professionalServices: [],
  addOns: [],
};

test('rate card is an exact transcription of the workbook', () => {
  assert.deepEqual(
    Object.fromEntries(rules.products.map(({ key, bands }) => [key, bands])),
    {
      connect_ca: [
        [0, 500, 1.7], [500, 1_000, 1.6], [1_000, 2_000, 1.5],
        [2_000, 5_000, 1.3], [5_000, 10_000, 1.1], [10_000, 20_000, 1],
        [20_000, 50_000, 0.9], [50_000, 100_000, 0.8],
        [100_000, 200_000, 0.7], [200_000, 500_000, 0.6],
        [500_000, 1_100_000, 0.5], [1_100_000, null, 0.4],
      ],
      calendar_ca: [
        [0, 500, 1.3], [500, 1_000, 1.2], [1_000, 2_000, 1],
        [2_000, 5_000, 0.8], [5_000, 10_000, 0.7], [10_000, 20_000, 0.6],
        [20_000, 50_000, 0.5], [50_000, 100_000, 0.4],
        [100_000, 200_000, 0.3], [200_000, 500_000, 0.2],
        [500_000, 1_100_000, 0.1], [1_100_000, null, 0.05],
      ],
      notetaker_bot_hours: [
        [0, 1_000, 0.6], [1_000, 2_000, 0.5], [2_000, 5_000, 0.4],
        [5_000, 10_000, 0.35], [10_000, null, 0.3],
      ],
      agent_accounts: [[0, null, 0.2]],
      agent_email_thousands: [
        [0, 50, 1], [50, 100, 0.75], [100, 500, 0.35], [500, null, 0.25],
      ],
      agent_storage_gb: [[0, null, 0.2]],
      agent_bandwidth_gb: [[0, null, 0.5]],
    },
  );
});

test('workbook modifiers and fixed charges are exact', () => {
  assert.deepEqual(rules.termRules, [
    { months: 12, discount: 0 },
    { months: 24, discount: 0.025 },
    { months: 36, discount: 0.05 },
  ]);
  assert.deepEqual(rules.paymentRules.map(({ key, premium }) => [key, premium]), [
    ['annual_in_advance', 0],
    ['semi_annual_in_advance', 0.04],
    ['quarterly_in_advance', 0.06],
    ['monthly_in_advance', 0.08],
  ]);
  assert.deepEqual(
    rules.supportRules.map(({ key, percentOfPlatformArr, annualCap }) => [
      key, percentOfPlatformArr, annualCap,
    ]),
    [['basic', 0, 0], ['full', 0.1, 10_000], ['premium', 0.2, 20_000]],
  );
  assert.deepEqual(
    rules.onboardingRules.map(({ key, oneTimeAmount }) => [key, oneTimeAmount]),
    [['quick_launch', 0], ['quick_launch_plus', 5_000], ['strategic', 10_000]],
  );
  assert.deepEqual(
    rules.professionalServicesRules.map(({ itemCount, oneTimeAmount }) => [
      itemCount, oneTimeAmount,
    ]),
    [[0, 0], [1, 2_000], [2, 3_800], [3, 5_500], [4, 7_200], [5, 8_800]],
  );
  assert.deepEqual(
    rules.addOnRules.map(({ key, annualAmount }) => [key, annualAmount]),
    [['enterprise_accelerator', 2_400], ['privacy_filter', 6_000], ['verified_oauth', 5_000]],
  );
});

test('every product uses workbook quantity times monthly rate times 12', () => {
  const volumes = {
    connect_ca: 500,
    calendar_ca: 500,
    notetaker_bot_hours: 1_000,
    agent_accounts: 1_000,
    agent_email_thousands: 50,
    agent_storage_gb: 1_000,
    agent_bandwidth_gb: 1_000,
  };
  const expectedAnnual = {
    connect_ca: 10_200,
    calendar_ca: 7_800,
    notetaker_bot_hours: 7_200,
    agent_accounts: 2_400,
    agent_email_thousands: 600,
    agent_storage_gb: 2_400,
    agent_bandwidth_gb: 6_000,
  };
  const result = calculateQuote({ ...baseInput, volumes });

  for (const line of result.lines) {
    assert.equal(line.annualCommitment, expectedAnnual[line.productKey], line.productKey);
    assert.equal(line.annualCommitment, line.proposedMrr * 12, line.productKey);
  }
  assert.equal(result.proposedPlatformArr, 36_600);
});

test('support, recurring add-ons, onboarding, professional services, ARR, and TCV roll up once', () => {
  const result = calculateQuote({
    ...baseInput,
    volumes: { connect_ca: 1_000 },
    supportLevel: 'full',
    onboardingPackage: 'quick_launch_plus',
    professionalServices: ['google_verification_review', 'gtm_review'],
    addOns: ['enterprise_accelerator', 'privacy_filter'],
  });

  assert.equal(result.proposedPlatformArr, 19_800);
  assert.equal(result.supportAnnual, 1_980);
  assert.equal(result.annualAddOns, 8_400);
  assert.equal(result.professionalServicesAmount, 3_800);
  assert.equal(result.onboardingAmount, 5_000);
  assert.equal(result.committedArr, 30_180);
  assert.equal(result.oneTime, 8_800);
  assert.equal(result.tcv, 38_980);
});
