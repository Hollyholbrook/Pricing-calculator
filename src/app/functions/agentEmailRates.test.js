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

// Agent Email list rates come from the HubSpot product library, not the pricing workbook -- the
// two disagreed and Holly ruled for the library on 2026-08-27. See pricingRules.js. The figures
// below are therefore regression guards against silent drift, not a transcription of the workbook.
// Every other product in these suites is still workbook-sourced.

test('Agent Email applies the product-library graduated rates and rounding', () => {
  const result = calculateEmail(120);
  const line = result.lines.find(({ productKey }) => productKey === 'agent_email_thousands');

  // Quarterly premium (+6%) then a 5% discount, applied per band and rounded to the cent.
  assert.deepEqual(line.proposedBandRates, [
    { lower: 0, upper: 50, rate: 0 },
    { lower: 50, upper: 100, rate: 0.7 },
    { lower: 100, upper: 500, rate: 0.35 },
    { lower: 500, upper: null, rate: 0.25 },
  ]);
  // 50 free + 50 at $0.70 + 20 at $0.35.
  assert.equal(line.proposedMrr, 42);
  assert.equal(line.annualCommitment, 504);
  assert.equal(line.billingUnitRate, 0.35);
});

test('Agent Email mirrors the graduated formula after the 500-thousand tier', () => {
  const result = calculateEmail(600, {
    paymentFrequency: 'monthly_in_advance',
    productDiscounts: { agent_email_thousands: 0 },
  });
  const line = result.lines.find(({ productKey }) => productKey === 'agent_email_thousands');

  assert.deepEqual(line.proposedBandRates, [
    { lower: 0, upper: 50, rate: 0 },
    { lower: 50, upper: 100, rate: 0.76 },
    { lower: 100, upper: 500, rate: 0.38 },
    { lower: 500, upper: null, rate: 0.27 },
  ]);
  // 50 free + 50 at $0.76 + 400 at $0.38 + 100 at $0.27, all at the monthly premium (+8%).
  assert.equal(line.proposedMrr, 217);
  assert.equal(line.annualCommitment, 2_604);
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
  // The first 50,000 emails a month are free, so 50 units cost nothing and the 51st is the first
  // charged unit -- at the tier-2 rate, which is what proves the bands meet without a gap or an
  // overlap. A gap would leave the 51st unit free; an overlap would charge the 50th.
  assert.equal(first.proposedMrr, 0);
  assert.equal(second.proposedMrr, 0.7);
});
