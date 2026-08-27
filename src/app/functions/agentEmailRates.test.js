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
  const result = calculateEmail(120);
  const line = result.lines.find(({ productKey }) => productKey === 'agent_email_thousands');

  assert.deepEqual(line.proposedBandRates, [
    { lower: 0, upper: 50, rate: 1.01 },
    { lower: 50, upper: 100, rate: 0.76 },
    { lower: 100, upper: 500, rate: 0.35 },
    { lower: 500, upper: null, rate: 0.25 },
  ]);
  assert.equal(line.proposedMrr, 95.5);
  assert.equal(line.annualCommitment, 1_146);
  assert.equal(line.billingUnitRate, 0.795833333);
});

test('Agent Email mirrors the workbook formula after the 500-thousand tier', () => {
  const result = calculateEmail(600, {
    paymentFrequency: 'monthly_in_advance',
    productDiscounts: { agent_email_thousands: 0 },
  });
  const line = result.lines.find(({ productKey }) => productKey === 'agent_email_thousands');

  assert.deepEqual(line.proposedBandRates, [
    { lower: 0, upper: 50, rate: 1.08 },
    { lower: 50, upper: 100, rate: 0.81 },
    { lower: 100, upper: 500, rate: 0.38 },
    { lower: 500, upper: null, rate: 0.27 },
  ]);
  assert.equal(line.proposedMrr, 273.5);
  assert.equal(line.annualCommitment, 3_282);
});

test('Agent Email band boundaries are contiguous', () => {
  const atBoundary = calculateEmail(50, {
    paymentFrequency: 'annual_in_advance',
    productDiscounts: { agent_email_thousands: 0 },
  });
  const overBoundary = calculateEmail(51, {
    paymentFrequency: 'annual_in_advance',
    productDiscounts: { agent_email_thousands: 0 },
  });
  const first = atBoundary.lines.find(({ productKey }) => productKey === 'agent_email_thousands');
  const second = overBoundary.lines.find(({ productKey }) => productKey === 'agent_email_thousands');
  assert.equal(first.proposedMrr, 50);
  assert.equal(second.proposedMrr, 50.75);
});
