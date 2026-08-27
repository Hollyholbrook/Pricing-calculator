const assert = require('node:assert/strict');
const test = require('node:test');

const { QuoteValidationError, calculateQuote } = require('./calculator');

// END-TO-END PARITY AGAINST THE WORKBOOK'S OWN WORKED EXAMPLE
//
// Every other test in this repo compares the calculator against figures a human transcribed from
// the workbook. This one compares it against a quote the WORKBOOK ITSELF computed: the scenario
// saved in "4 OneSubscription Pricing Workbook 3.xlsx", sheet QUOTE BUILDER, with its own outputs
// read out of the cells. That makes it an independent oracle rather than another transcription --
// if the two engines disagree, one of them is wrong and this says so.
//
// The scenario, from QUOTE BUILDER sections I to V:
//
//   Term 24 months, starting 2026-07-01, Semi-Annual In Advance
//   Connect Email + Calendar    2,000 CA        10% discretionary discount
//   Notetaker                   1,000 bot-hrs   10% discretionary discount
//   every other meter           0
//   Add-on: Enterprise Accelerator, discounted 100%
//   Support: Full
//   Onboarding: Quick Launch                    20% discount
//   Professional services: Go-to-Market (GTM) Review only
//
// Multi-year discount 2.5% and payment premium 4% are the workbook's own cells (rows 13-19), and
// it combines them ADDITIVELY: rate x (1 - 0.025 + 0.04) = rate x 1.015. That is what
// calculationMethod 'excel_compatible' means, and this test is what pins it.

const WORKBOOK_INPUT = Object.freeze({
  startDate: '2026-07-01',
  termMonths: 24,
  paymentFrequency: 'semi_annual_in_advance',
  volumes: {
    connect_ca: 2_000,
    calendar_ca: 0,
    notetaker_bot_hours: 1_000,
    agent_accounts: 0,
    agent_email_thousands: 0,
    agent_storage_gb: 0,
    agent_bandwidth_gb: 0,
  },
  productDiscounts: { connect_ca: 0.1, notetaker_bot_hours: 0.1 },
  supportLevel: 'full',
  onboardingPackage: 'quick_launch',
  onboardingDiscount: 0.2,
  professionalServices: ['gtm_review'],
  addOns: ['enterprise_accelerator'],
  addOnDiscounts: { enterprise_accelerator: 1 },
});

test('workbook parity: the modifiers the whole quote is built on', () => {
  const result = calculateQuote(WORKBOOK_INPUT);
  // QUOTE BUILDER rows 13-19, columns "Multi-Year Discount" and "Pmt Frequency Adjustment".
  assert.equal(result.termDiscount, 0.025);
  assert.equal(result.paymentPremium, 0.04);
  assert.equal(result.paymentsPerYear, 2);
});

test('workbook parity: every money figure in the worked example', () => {
  const result = calculateQuote(WORKBOOK_INPUT);
  const connect = result.lines.find(({ productKey }) => productKey === 'connect_ca');
  const notetaker = result.lines.find(({ productKey }) => productKey === 'notetaker_bot_hours');

  // Money is asserted EXACTLY. These are the figures the workbook printed, to the cent.
  const exact = [
    // Annualized Minimum Subscription Fees, rows 13 and 15.
    ['Connect annualized', connect.annualCommitment, 34_530.3],
    ['Notetaker annualized', notetaker.annualCommitment, 6_577.2],
    // Drawdown Fee per Year / per Half-Year, rows 20 and 21.
    ['drawdown per year', result.proposedPlatformArr, 41_107.5],
    ['drawdown per half-year', result.proposedPlatformArr / result.paymentsPerYear, 20_553.75],
    // Section III TOTAL, row 29. The one selected add-on is discounted 100%, so nothing is due --
    // it is a real case, not an empty one, and it catches a discount that fails to apply.
    ['add-ons committed annual', result.annualAddOns, 0],
    // Section IV, row 33: Full Support is 10% of committed ARR, under the $10,000 cap.
    ['support committed annual', result.supportAnnual, 4_110.75],
    ['support per half-year', result.supportAnnual / result.paymentsPerYear, 2_055.375],
    // Section V, row 40: one PS item selected, so the bundled ladder's first rung.
    ['professional services', result.professionalServicesAmount, 2_000],
    // Section VI Contract Summary, "Recurring Fees Per Year (ARR)" total, row 54.
    ['committed ARR', result.committedArr, 45_218.25],
    // Row 51 "Total Fees for Term": ARR x 2 years.
    ['drawdown total for term', result.proposedPlatformArr * 2, 82_215],
    ['support total for term', result.supportAnnual * 2, 8_221.5],
  ];
  for (const [label, actual, expected] of exact) {
    assert.equal(actual, expected, `${label}: ${actual} !== workbook ${expected}`);
  }
});

test('workbook parity: rates agree to the cent, and totals are built from the unrounded rate', () => {
  const result = calculateQuote(WORKBOOK_INPUT);
  const connect = result.lines.find(({ productKey }) => productKey === 'connect_ca');
  const notetaker = result.lines.find(({ productKey }) => productKey === 'notetaker_bot_hours');

  // The workbook carries full precision in its rate cells; this calculator rounds a DISPLAYED rate
  // to the cent, because no line item can be priced at $1.598625. So rates are compared at the
  // precision each side actually means.
  //
  // Rate Card $/u/mo, blended across the bands at the selected volume (RATE CARD row 21).
  assert.equal(connect.baseBlendedRate, 1.575);
  assert.equal(notetaker.baseBlendedRate, 0.6);
  // List rate $/u/mo: 1.575 x 1.015 = 1.598625, and 0.6 x 1.015 = 0.609.
  assert.equal(connect.listUnitRate, 1.6);
  assert.equal(notetaker.listUnitRate, 0.61);
  // Proposed rate $/u/mo, after the 10% discretionary discount: 1.4387625 and 0.5481.
  assert.equal(connect.proposedUnitRate, 1.44);
  assert.equal(notetaker.proposedUnitRate, 0.55);

  // The point of the above: the ANNUAL figures must come from the unrounded rate, not the
  // displayed one. 1.44 x 2000 x 12 would be $34,560 -- $30 over the workbook. The rounding is for
  // display only and must never reach a total.
  assert.notEqual(connect.proposedUnitRate * 2_000 * 12, connect.annualCommitment);
  assert.equal(connect.annualCommitment, 34_530.3);
  assert.equal(
    Math.round(1.4387625 * 2_000 * 12 * 100) / 100,
    34_530.3,
    'the workbook total is the unrounded rate x volume x 12',
  );
});

test('workbook parity: the one deliberate difference is rounding an invoice to the cent', () => {
  const result = calculateQuote(WORKBOOK_INPUT);
  // The workbook prints $22,609.125 as the half-yearly recurring fee (row 54). That is not an
  // amount anyone can be invoiced, so this calculator rounds it. The difference is half a cent per
  // payment and it is the ONLY figure in the worked example where the two disagree.
  assert.equal(result.recurringPerPeriod, 22_609.13);
  // Stated exactly rather than with a tolerance: our figure IS the workbook's, rounded to the
  // cent. A tolerance of "<= 0.005" fails here anyway, because 22609.13 - 22609.125 lands a hair
  // above half a cent in binary floating point -- which is the sort of thing that gets a real
  // assertion loosened until it stops meaning anything.
  assert.equal(Math.round(22_609.125 * 100) / 100, result.recurringPerPeriod);
  // The annual figure it divides is exact, so the rounding is introduced here and nowhere earlier.
  assert.equal(result.committedArr, 45_218.25);
});

// The workbook's own Contract Summary reports a NEGATIVE total contract value of -$2,563.50 for
// this scenario. That is a bug in the spreadsheet, not a target to match.
//
// Its onboarding discount cell (row 38) holds 20.0 where every other discount cell holds a
// fraction, and the formula computes 5,000 x (1 - 20) = -$95,000. That single cell drags one-time
// fees to -$93,000 and TCV below zero.
//
// Worth a test because the temptation on finding a parity failure is to make the code match the
// sheet. Here the sheet is wrong, and this calculator refuses the input rather than reproducing it.
test('the workbook onboarding-discount bug is refused, not reproduced', () => {
  assert.throws(
    () => calculateQuote({ ...WORKBOOK_INPUT, onboardingDiscount: 20 }),
    (error) =>
      error instanceof QuoteValidationError &&
      error.code === 'INVALID_PERCENTAGE' &&
      error.field === 'onboardingDiscount',
    'a discount of 20 (meaning 20%) must fail closed, not compute -$95,000',
  );

  // Read as the 20% it was meant to be, the figures are ordinary and TCV is positive.
  const result = calculateQuote({ ...WORKBOOK_INPUT, onboardingDiscount: 0.2 });
  assert.equal(result.onboardingAmount, 4_000, 'Quick Launch $5,000 less 20%');
  assert.equal(result.oneTime, 6_000, 'plus $2,000 of professional services');
  // ARR x 2 years + one-time. The workbook's own -$2,563.50 differs from this by exactly the
  // $99,000 its broken cell invents.
  assert.equal(result.tcv, 96_436.5);
  assert.equal(round2(result.tcv - -2_563.5), 99_000);
});

const round2 = (value) => Math.round(value * 100) / 100;

// The graduated path is a SECOND implementation of the rate adjustment.
//
// Ordinary products adjust inline (calculateQuote); Agent Email goes through
// calculateAdjustedBandPricing, which applies the same formula per band. Mutating one leaves the
// other untouched, so a parity test that commits no email volume proves nothing about it -- as
// this file originally did not.
//
// The workbook covers it in the same worked example: QUOTE BUILDER row 17 prints the adjusted band
// rates for Agent Email even at zero volume, in its "List rate $/u/mo" column.
test('workbook parity: the graduated Agent Email bands adjust exactly as the workbook prints them', () => {
  const result = calculateQuote(WORKBOOK_INPUT);
  const email = result.lines.find(({ productKey }) => productKey === 'agent_email_thousands');

  // Row 17, verbatim: "$1.02 /k for 1 - 50K · $0.76 /k for 50K - 100K · $0.36 /k for 100K - 500K
  // · $0.25 /k for 500K+". Each is its base rate x 1.015, rounded to the cent, per band.
  assert.deepEqual(
    email.listBandRates.map(({ rate }) => rate),
    [1.02, 0.76, 0.36, 0.25],
  );
  // The band boundaries are in thousands of emails, matching the workbook's "per k" labels.
  assert.deepEqual(
    email.listBandRates.map(({ lower, upper }) => [lower, upper]),
    [
      [0, 50],
      [50, 100],
      [100, 500],
      [500, null],
    ],
  );

  // This row is also EVIDENCE about a disagreement inside the workbook itself. Its RATE CARD sheet
  // (row 71) gives Agent Email tier 2 as $0.70, while PRICING TABLES (row 20) says $0.75. Row 17
  // settles which one the QUOTE BUILDER actually quotes: $0.76 is 0.75 x 1.015. At $0.70 the same
  // cell would read $0.71. Do not change the tier without resolving that first -- and if it ever
  // does change, this assertion is the one that will fail and say so.
  assert.equal(Math.round(0.75 * 1.015 * 100) / 100, 0.76);
  assert.equal(Math.round(0.7 * 1.015 * 100) / 100, 0.71);
});
