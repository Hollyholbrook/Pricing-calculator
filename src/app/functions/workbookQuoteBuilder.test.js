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

  // Row 17 as the workbook printed it: "$1.02 /k for 1 - 50K · $0.76 /k for 50K - 100K · $0.36 /k
  // for 100K - 500K". Tier 2 now reads 0.71, not 0.76 -- see the note below the assertion.
  // Row 17, verbatim: "$1.02 /k for 1 - 50K · $0.76 /k for 50K - 100K · $0.36 /k for 100K - 500K
  // · $0.25 /k for 500K+". Each is its base rate x 1.015, rounded to the cent, per band.
  assert.deepEqual(
    email.listBandRates.map(({ rate }) => rate),
    [1.02, 0.71, 0.36, 0.25],
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

  // RESOLVED 2026-08-31, and this is the record of how.
  //
  // The workbook contradicted itself: its RATE CARD sheet (row 71) gave Agent Email tier 2 as
  // $0.70 while PRICING TABLES (row 20) said $0.75, and the QUOTE BUILDER computed from 0.75 --
  // which is why row 17 printed $0.76 (0.75 x 1.015). The FY26 MRD settles it at $0.70 in BOTH
  // its Enterprise and Pro Annual tables and states that Enterprise holds at the Pro Annual
  // rates, which agrees with the workbook's own RATE CARD sheet. Holly confirmed and corrected
  // the HubSpot product.
  //
  // So the rate card is 0.70 and this row now reads $0.71. CONFIRMED: workbook v7 prints
  // "$1.02 /k for 1 - 50K, $0.71 /k for 50K - 100K, $0.36 /k for 100K - 500K, $0.25 /k for 500K+"
  // at row 17 -- the card and the workbook agree again. Both arithmetic facts are kept: the first
  // explains any older copy still printing $0.76, the second is what both produce now.
  assert.equal(Math.round(0.75 * 1.015 * 100) / 100, 0.76);
  assert.equal(Math.round(0.7 * 1.015 * 100) / 100, 0.71);
});

// A SECOND workbook scenario, at volumes that cross five bands rather than three.
//
// Holly compared the card against the workbook side by side and they disagreed on every rate --
// $1.36 against $1.27, $0.88 against $0.83. Neither was wrong: the card was set to 12 months and
// Monthly In Advance (x1.08) and the workbook to 24 months and Semi-Annual In Advance (x1.015).
// Same rate card, different modifiers.
//
// Worth keeping as a test because "the numbers don't match the spreadsheet" is the report that has
// cost the most time on this project, and the answer has twice been that the two were not the same
// deal. This pins the arithmetic at both settings so the next comparison starts from a known good.
//
// Workbook, SUBSCRIPTION PRICE BUILDER, 10,000 / 10,000 / 2,000 with 10% on Connect and Notetaker:
//
//   Product         Rate Card   List    Discretionary   Proposed   Annualized
//   Email + Cal     $1.26       $1.27   10%             $1.15      $137,573
//   Calendar Only   $0.82       $0.83   -               $0.83      $99,267
//   Bot hrs         $0.55       $0.56   10%             $0.50      $12,058
//   # of AAs        $0.2000     $0.2030 -               $0.2030    -
//   Email banded    tiers       $1.02 / $0.71 / $0.36 / $0.25   (workbook printed $0.76 at tier 2)
const HIGH_VOLUME_INPUT = Object.freeze({
  termMonths: 24,
  paymentFrequency: 'semi_annual_in_advance',
  volumes: {
    connect_ca: 10_000,
    calendar_ca: 10_000,
    notetaker_bot_hours: 2_000,
    agent_accounts: 0,
    agent_email_thousands: 0,
    agent_storage_gb: 0,
    agent_bandwidth_gb: 0,
  },
  productDiscounts: { connect_ca: 0.1, notetaker_bot_hours: 0.1 },
  supportLevel: 'basic',
  onboardingPackage: 'none',
  professionalServices: [],
  addOns: [],
});

test('workbook parity: a five-band scenario matches rate card, list, proposed and annualized', () => {
  const result = calculateQuote(HIGH_VOLUME_INPUT);
  const line = (key) => result.lines.find(({ productKey }) => productKey === key);

  // Rate Card $/u/mo -- the blended base across every band the volume reaches. Connect at 10,000
  // crosses five: 500 at 1.70, 500 at 1.60, 1,000 at 1.50, 3,000 at 1.30, 5,000 at 1.10.
  assert.equal(line('connect_ca').baseBlendedRate, 1.255, 'workbook prints 1.26, rounded');
  assert.equal(line('calendar_ca').baseBlendedRate, 0.815, 'workbook prints 0.82, rounded');
  assert.equal(line('notetaker_bot_hours').baseBlendedRate, 0.55);

  // List rate $/u/mo, after x(1 - 0.025 + 0.04).
  assert.equal(line('connect_ca').listUnitRate, 1.27);
  assert.equal(line('calendar_ca').listUnitRate, 0.83);
  assert.equal(line('notetaker_bot_hours').listUnitRate, 0.56);

  // Proposed rate $/u/mo, after the discretionary discount. Calendar has none, so it holds.
  assert.equal(line('connect_ca').proposedUnitRate, 1.15);
  assert.equal(line('calendar_ca').proposedUnitRate, 0.83);
  assert.equal(line('notetaker_bot_hours').proposedUnitRate, 0.5);

  // Annualized Minimum Subscription Fees. The workbook prints whole dollars; the cents below are
  // ours and are what the unrounded rate actually produces.
  assert.equal(line('connect_ca').annualCommitment, 137_573.1);
  assert.equal(line('calendar_ca').annualCommitment, 99_267);
  assert.equal(line('notetaker_bot_hours').annualCommitment, 12_058.2);

  // Agent Email at zero volume still publishes its adjusted tiers.
  assert.deepEqual(
    line('agent_email_thousands').listBandRates.map(({ rate }) => rate),
    [1.02, 0.71, 0.36, 0.25],
  );
});

test('the same volumes on a 12-month monthly deal give the card figures, not the workbook ones', () => {
  // The comparison that looked broken. Identical volumes, no discounts, 12 months Monthly In
  // Advance: no term discount and an 8% premium, so x1.08 instead of x1.015. Every rate is
  // legitimately higher, and this is what the card showed.
  const result = calculateQuote({
    ...HIGH_VOLUME_INPUT,
    termMonths: 12,
    paymentFrequency: 'monthly_in_advance',
    productDiscounts: {},
  });
  const line = (key) => result.lines.find(({ productKey }) => productKey === key);

  assert.equal(result.termDiscount, 0);
  assert.equal(result.paymentPremium, 0.08);

  // The blended base rates are IDENTICAL to the workbook scenario -- only the modifiers differ.
  assert.equal(line('connect_ca').baseBlendedRate, 1.255);
  assert.equal(line('calendar_ca').baseBlendedRate, 0.815);
  assert.equal(line('notetaker_bot_hours').baseBlendedRate, 0.55);

  // And these are the figures on the card: $1.36, $0.88, $0.59, $0.22.
  assert.equal(Math.round(line('connect_ca').displayListUnitRate * 100) / 100, 1.36);
  assert.equal(Math.round(line('calendar_ca').displayListUnitRate * 100) / 100, 0.88);
  assert.equal(Math.round(line('notetaker_bot_hours').displayListUnitRate * 100) / 100, 0.59);
  assert.equal(Math.round(line('agent_accounts').displayListUnitRate * 100) / 100, 0.22);
  assert.deepEqual(
    line('agent_email_thousands').listBandRates.map(({ rate }) => rate),
    [1.08, 0.76, 0.38, 0.27],
  );
});

// NEGATIVE DISCOUNTS: AN UPLIFT IS A RATE ABOVE LIST
//
// The workbook permits this and always has. QUOTE BUILDER's discount cells (column J, rows 13-19,
// 26-28, 33, 38, 40) carry NO data validation -- the sheet's only validations are the three
// dropdowns for support level, payment frequency and onboarding package. K = I * (1 - J), so a
// negative J prices above list arithmetically, with nothing in the sheet to stop it.
//
// Renewals are the case: a legacy rate being moved back toward the current rate card is a real
// term of the deal, and before 2026-09-02 the calculator refused it, leaving a rep to misstate the
// rate card instead.
//
// These figures are derived from the workbook's own formulas, not read back from this calculator.

test('workbook parity: a negative discount prices ABOVE list, by the workbook formula', () => {
  const result = calculateQuote({
    ...WORKBOOK_INPUT,
    // Connect uplifted 10%. Notetaker keeps the worked example's 10% discount, so one run holds
    // both directions and neither can be satisfied by a sign error that flips them together.
    productDiscounts: { connect_ca: -0.1, notetaker_bot_hours: 0.1 },
  });
  const connect = result.lines.find(({ productKey }) => productKey === 'connect_ca');
  const notetaker = result.lines.find(({ productKey }) => productKey === 'notetaker_bot_hours');

  // Nothing about the LIST side moves. Rate card 1.575, adjusted additively by
  // (1 - 0.025 + 0.04) = 1.015, is 1.598625 whatever the discretionary cell holds.
  assert.equal(connect.baseBlendedRate, 1.575);
  assert.equal(connect.listUnitRate, 1.6);

  // K13 = I13 * (1 - J13) with J13 = -0.1: 1.598625 x 1.1 = 1.7584875, displayed 1.76.
  assert.equal(connect.proposedUnitRate, 1.76);
  assert.ok(
    connect.proposedUnitRate > connect.listUnitRate,
    'an uplifted line must price above its own list rate',
  );
  // L13 = D13 x K13 x 12, from the UNROUNDED rate: 1.7584875 x 2,000 x 12.
  assert.equal(connect.annualCommitment, 42_203.7);
  assert.equal(Math.round(1.7584875 * 2_000 * 12 * 100) / 100, connect.annualCommitment);

  // The discounted line is untouched by the uplift on the other one.
  assert.equal(notetaker.proposedUnitRate, 0.55);
  assert.equal(notetaker.annualCommitment, 6_577.2);

  // Row 20, and then row 33: support is 10% of the drawdown the customer actually pays, so the
  // uplift carries into it exactly as a discount would.
  assert.equal(result.proposedPlatformArr, 48_780.9);
  assert.equal(result.supportAnnual, 4_878.09);
  assert.equal(result.committedArr, 53_658.99);

  // And the list side stays the list side, so the blended effective figure reads NEGATIVE --
  // above list -- rather than being floored to zero somewhere.
  assert.ok(result.tcv > result.listTcv, 'an uplifted quote must exceed its own list TCV');
});

test('the largest line discount reports 0 when every entry is an uplift', () => {
  // The reported FIGURE still floors at zero even though the approval ladder no longer does. The
  // two are separate on purpose: largestDiscretionaryDiscount is what was given away, and it is
  // what the Deal and the option document report as a discount. A -10% entry reported there as
  // -10% would read as a concession that was never made.
  //
  // Every other discount surface is removed from this scenario so the uplift is the ONLY entry --
  // with support, onboarding, an add-on or a PS item present, each contributes a 0 of its own and
  // the floor is never reached.
  const result = calculateQuote({
    ...WORKBOOK_INPUT,
    productDiscounts: { connect_ca: -0.1 },
    volumes: { ...WORKBOOK_INPUT.volumes, notetaker_bot_hours: 0 },
    supportLevel: 'basic',
    onboardingPackage: 'none',
    onboardingDiscount: 0,
    professionalServices: [],
    addOns: [],
    addOnDiscounts: {},
  });
  assert.equal(result.largestDiscretionaryDiscount, 0, 'must floor at 0, not report -0.1');
  // Reported separately, as a positive magnitude, so nothing has to infer it from a sign.
  assert.equal(result.largestDiscretionaryUplift, 0.1);
  // The uplift is still in the money, so the floor is a reporting rule and not a lost input.
  assert.ok(result.tcv > result.listTcv);
});

// THE ONE DELIBERATE DEPARTURE FROM THE WORKBOOK, AND THE REASON FOR IT
//
// The sheet routes on MAX(J13:J19,J26:J28,J33,J38,J40) against >0.3, >0.1 and >0.0001, so an
// uplift clears none of them and E62 prints "None - Auto Approved (rate card)". This calculator
// does NOT follow it here. Shane, 2026-09-02, asking before release: "With absolute approval
// thresholds working? Meaning -11% premium pricing (avg TCV) will go to Ana/Chris?" -- yes.
//
// The case that settles it: under the sheet's rule a -45% entry, pricing a line at nearly twice
// the rate card, goes out with no approver and no reason recorded. Off the rate card is off the
// rate card, whichever way it points.
//
// Every OTHER approval behaviour still matches the sheet, and the tests above hold it there. This
// is the single exception and it is asserted so that a future "restore workbook parity" cannot
// quietly undo it.
test('an uplift routes on magnitude, the one place this departs from the sheet', () => {
  const uplift = (value) =>
    calculateQuote({
      ...WORKBOOK_INPUT,
      productDiscounts: { connect_ca: value },
      onboardingDiscount: 0,
      addOnDiscounts: { enterprise_accelerator: 0 },
    });

  // Same ladder, same thresholds, read as a magnitude.
  const small = uplift(-0.05);
  assert.equal(small.approvalTierRequired, 'sales_director');
  const medium = uplift(-0.11);
  assert.equal(medium.approvalTierRequired, 'head_sales', '-11% must reach the second tier');
  const large = uplift(-0.45);
  assert.equal(large.approvalTierRequired, 'finance');

  // The approver is told which direction it went. "Discount" on an uplifted deal would send them
  // looking for a concession that does not exist.
  assert.ok(
    medium.approvalReasons.some((reason) => reason.startsWith('Discretionary uplift is greater')),
    `expected an uplift-worded reason, got: ${medium.approvalReasons.join(' | ')}`,
  );
  assert.ok(
    !medium.approvalReasons.some((reason) => reason.includes('Discretionary discount')),
    'an uplift must not be described to the approver as a discount',
  );

  // Renewals keep their own approver names on the same rungs.
  const renewal = calculateQuote(
    {
      ...WORKBOOK_INPUT,
      productDiscounts: { connect_ca: -0.11 },
      onboardingDiscount: 0,
      addOnDiscounts: { enterprise_accelerator: 0 },
    },
    {},
    0,
    'renewal',
  );
  assert.equal(renewal.approvalTierRequired, 'ccso');
});

test('routing takes the larger of the two, and a tie is described as the discount', () => {
  const both = (discount, upliftValue) =>
    calculateQuote({
      ...WORKBOOK_INPUT,
      productDiscounts: { connect_ca: upliftValue, notetaker_bot_hours: discount },
      onboardingDiscount: 0,
      addOnDiscounts: { enterprise_accelerator: 0 },
    });

  // A big uplift beats a small discount. Under the old rule this was sales_director on the 3%.
  const upliftWins = both(0.03, -0.11);
  assert.equal(upliftWins.largestDiscretionaryDiscount, 0.03);
  assert.equal(upliftWins.largestDiscretionaryUplift, 0.11);
  assert.equal(upliftWins.approvalTierRequired, 'head_sales');

  // And the reverse.
  const discountWins = both(0.35, -0.02);
  assert.equal(discountWins.approvalTierRequired, 'finance');
  assert.ok(
    discountWins.approvalReasons.some((reason) => reason.includes('Discretionary discount')),
  );

  // A tie is named as the discount: if a deal holds a 12% discount and a 12% uplift, the discount
  // is the half that needs defending.
  const tied = both(0.12, -0.12);
  assert.equal(tied.approvalTierRequired, 'head_sales');
  assert.ok(
    tied.approvalReasons.some((reason) => reason.startsWith('Discretionary discount is greater')),
    `a tie must read as a discount, got: ${tied.approvalReasons.join(' | ')}`,
  );
});

test('a 100% uplift is not reported as a line discounted 100%', () => {
  // -1 doubles a line. It reaches Finance on magnitude like any other large departure, but the
  // "A line is discounted 100%" reason belongs to a free line and must not appear here.
  const result = calculateQuote({
    ...WORKBOOK_INPUT,
    productDiscounts: { connect_ca: -1 },
    onboardingDiscount: 0,
    addOnDiscounts: { enterprise_accelerator: 0 },
  });
  assert.equal(result.approvalTierRequired, 'finance');
  assert.equal(result.largestDiscretionaryDiscount, 0);
  assert.ok(
    !result.approvalReasons.includes('A line is discounted 100%.'),
    'nothing was given away, so nothing was discounted 100%',
  );
});

test('the uplift floor is -100%, and a mistyped -20 is refused like a mistyped 20', () => {
  // The mirror of the onboarding-discount test above. -20 meaning -20% would otherwise price a
  // line at twenty-one times list, which is the same class of error the upper bound catches.
  for (const value of [-20, -1.01]) {
    assert.throws(
      () => calculateQuote({ ...WORKBOOK_INPUT, onboardingDiscount: value }),
      (error) =>
        error instanceof QuoteValidationError &&
        error.code === 'INVALID_PERCENTAGE' &&
        error.field === 'onboardingDiscount',
      `${value} must fail closed`,
    );
  }
  // -1 is the floor itself and is accepted: Quick Launch at $5,000 x (1 - -1) = $10,000.
  const result = calculateQuote({ ...WORKBOOK_INPUT, onboardingDiscount: -1 });
  assert.equal(result.onboardingAmount, 10_000);
});
