const assert = require('node:assert/strict');
const test = require('node:test');

const { calculateQuote } = require('./calculator');

const calculateEmail = (volume, overrides = {}) =>
  calculateQuote({
    termMonths: 12,
    paymentFrequency: 'quarterly_in_advance',
    volumes: { agent_email_thousands: volume },
    supportLevel: 'basic',
    onboardingPackage: 'quick_launch',
    professionalServices: [],
    addOns: [],
    productDiscounts: { agent_email_thousands: 0.05 },
    ...overrides,
  });

test('Agent Email matches workbook graduated rates and rounding', () => {
  const result = calculateEmail(120_000);
  const line = result.lines.find(({ productKey }) => productKey === 'agent_email_thousands');

  assert.deepEqual(line.proposedBandRates, [
    { lower: 0, upper: 50_000, rate: 1.01 },
    { lower: 50_000, upper: 100_000, rate: 0.76 },
    { lower: 100_000, upper: 500_000, rate: 0.35 },
    { lower: 500_000, upper: null, rate: 0.25 },
  ]);
  assert.equal(line.proposedMrr, 95_500);
  assert.equal(line.annualCommitment, 1_146_000);
  assert.equal(line.billingUnitRate, 0.795833333);
});

test('Agent Email band boundaries are contiguous', () => {
  const atBoundary = calculateEmail(50_000, {
    paymentFrequency: 'annual_in_advance',
    productDiscounts: { agent_email_thousands: 0 },
  });
  const overBoundary = calculateEmail(50_001, {
    paymentFrequency: 'annual_in_advance',
    productDiscounts: { agent_email_thousands: 0 },
  });
  const first = atBoundary.lines.find(({ productKey }) => productKey === 'agent_email_thousands');
  const second = overBoundary.lines.find(({ productKey }) => productKey === 'agent_email_thousands');
  assert.equal(first.proposedMrr, 50_000);
  assert.equal(second.proposedMrr, 50_000.75);
});
