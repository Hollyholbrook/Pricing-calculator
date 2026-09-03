const assert = require('node:assert/strict');
const test = require('node:test');

const { calculateQuote } = require('./calculator');
const {
  _test: lineItemInternals,
  buildDealLineItems,
  buildQuoteLineItems,
  netPrice,
  normalizeQuoteContent,
} = require('./lineItemModel');

const option = () => {
  const input = {
    startDate: '2026-09-01',
    termMonths: 24,
    paymentFrequency: 'quarterly_in_advance',
    volumes: {
      connect_ca: 2_800,
      calendar_ca: 2_800,
      notetaker_bot_hours: 150,
      agent_accounts: 0,
      agent_email_thousands: 0,
      agent_storage_gb: 0,
      agent_bandwidth_gb: 0,
    },
    supportLevel: 'full',
    onboardingPackage: 'quick_launch_plus',
    addOns: ['enterprise_accelerator'],
    professionalServices: [
      'google_verification_review',
      'architecture_workflow_review',
    ],
    discretionaryDiscount: 0.1,
    autoRenewal: true,
    renewalTermMonths: 12,
    nonRenewalNoticeDays: 60,
    redliningRequested: false,
    nonStandardTerms: false,
    specialTerms: '',
  };
  return { id: 'option-1', name: 'Preferred', input, result: calculateQuote(input) };
};

// Holly, 2026-08-31: "The discounts should be in % not dollars always." Stated as its own test
// rather than only as a side effect of the reconciliation tests, so that a change back to a flat
// amount fails loudly here with the reason attached.
test('a concession is always a percentage and never a dollar amount', () => {
  const selected = option();
  const content = normalizeQuoteContent({});
  const everyLine = [
    ...buildDealLineItems(selected),
    ...buildQuoteLineItems(selected, content),
  ];
  let discounted = 0;
  for (const item of everyLine) {
    assert.equal(
      item.properties.discount,
      undefined,
      `${item.key} must not carry a flat dollar discount`,
    );
    const percentage = item.properties.hs_discount_percentage;
    if (percentage == null) continue;
    discounted += 1;
    const value = Number(percentage);
    assert.ok(
      Number.isFinite(value) && value > 0 && value < 100,
      `${item.key}: ${percentage} is not a usable discount percentage`,
    );
    // The reconstruction HubSpot performs. If the percentage does not reproduce proposed_rate to
    // the cent, the quote's rate column and its money columns disagree -- the exact objection the
    // old flat-amount approach was chosen to avoid, so it has to be proven, not assumed.
    assert.equal(
      netPrice(item.properties),
      Math.round(Number(item.properties.proposed_rate) * 100) / 100,
      `${item.key}: the percentage must reproduce proposed_rate to the cent`,
    );
  }
  // Otherwise this passes vacuously on a fixture where nothing was discounted.
  assert.ok(discounted > 0, 'the fixture must discount something or this proves nothing');
});

// The awkward cases, direct against the helper. Support is priced as a share of platform ARR, so
// its effective concession is not the round number the rep typed -- 15% entered, 23.41...% out --
// and a percentage rounded to 2 decimals against a five-figure base drifts by tens of cents. The
// helper is required to widen precision until the cent is exact, and to stay legible when it can.
test('a discount percentage keeps the cent exact and stays legible when it can', () => {
  const { discountPercentageFor } = lineItemInternals;
  assert.equal(discountPercentageFor(100, 85), 15, 'a round concession stays round');
  assert.equal(discountPercentageFor(0.2, 0.18), 10, 'and does so at rate-sized numbers');
  assert.equal(discountPercentageFor(100, 100), 0, 'no concession is 0, not null');
  assert.equal(discountPercentageFor(0, 0), null, 'nothing to express against a zero list price');
  for (const [list, net] of [
    [22257.88, 20032.1],
    [13457.31, 10306.44],
    [1.7, 1.3599],
    [99999.99, 76543.21],
    [3.33, 2.22],
  ]) {
    const percentage = discountPercentageFor(list, net);
    assert.equal(
      Math.round(list * (1 - percentage / 100) * 100) / 100,
      Math.round(net * 100) / 100,
      `${list} -> ${net} at ${percentage}% must land on the same cent`,
    );
  }
});

test('Deal line items reconcile to the approved calculation', () => {
  const selected = option();
  const items = buildDealLineItems(selected);
  // An absent price means "use the product default" and always sits on a quantity-0 rate
  // schedule line, so it contributes nothing either way.
  // Net of the discount PERCENTAGE: `price` is the LIST price on any discounted line, so this is
  // what HubSpot will actually bill, which is the number that has to reconcile to the calculation.
  const lineAmount = (properties) =>
    properties.price == null ? 0 : netPrice(properties) * Number(properties.quantity);
  const recurring = items
    .filter(({ properties }) => properties.recurringbillingfrequency)
    .reduce((sum, { properties }) => sum + lineAmount(properties), 0);
  const oneTime = items
    .filter(({ properties }) => !properties.recurringbillingfrequency)
    .reduce((sum, { properties }) => sum + lineAmount(properties), 0);

  assert.equal(Math.round(recurring * 100) / 100, selected.result.recurringPerPeriod);
  assert.equal(Math.round(oneTime * 100) / 100, selected.result.oneTime);
  assert.equal(new Set(items.map(({ key }) => key)).size, items.length);
  // Recurring charges are itemized: the product-commitment subscription, the support tier, and
  // one line per recurring add-on. The reconciliation above still holds because the subscription
  // line is priced off proposedPlatformArr rather than committedArr - pricing it off committedArr
  // while support and add-ons also had their own lines would bill both of them twice.
  const recurringItems = items.filter(
    ({ properties }) => properties.recurringbillingfrequency,
  );
  // Drawdown fee first, then the committed products as a zero-priced rate schedule in the fixed
  // product order, then the charges that sit outside the bundle.
  assert.deepEqual(
    recurringItems.map(({ key }) => key),
    [
      'subscription:nylas_enterprise',
      // All seven bundle products, in the fixed order, committed or not.
      'metered:connect_ca',
      'metered:calendar_ca',
      'metered:notetaker_bot_hours',
      'metered:agent_accounts',
      'metered:agent_storage_gb',
      'metered:agent_bandwidth_gb',
      'metered:agent_email_thousands',
      'support:full',
      'addon:enterprise_accelerator',
    ],
  );
  assert.equal(recurringItems[0].properties.hs_product_id, '46037350773');
  // No `name`: the product library owns it and hs_product_id is how HubSpot resolves it. Sending
  // our own copy is what kept reverting the product's rename on every Lock in.
  assert.equal(recurringItems[0].properties.name, undefined);

  // Positions are stamped in order, because HubSpot orders by hs_position_on_quote, not creation.
  assert.deepEqual(
    items.map(({ properties }) => properties.hs_position_on_quote),
    items.map((_item, index) => String(index)),
  );

  // Bundle members carry quantity 0 so they add nothing to the total. Price is left to HubSpot
  // unless the rep discounted the product, in which case the agreed monthly rate is sent.
  for (const item of items.filter(({ key }) => key.startsWith('metered:'))) {
    assert.equal(Number(item.properties.quantity), 0, `${item.key} quantity`);
    assert.notEqual(item.properties.price, 'NaN', `${item.key} price is never the string NaN`);
  }
  // Every rate schedule line states this deal's rate, discounted or not -- leaving it to the
  // product's flat default is what put $1.20 on a quote whose agreed rate was $0.96.
  //
  // Agent Email is excluded: it is graduated, its tiers live on the product, and one blended
  // figure would collapse four rates into one.
  for (const item of items.filter(
    ({ key }) => key.startsWith('metered:') && key !== 'metered:agent_email_thousands',
  )) {
    assert.ok(
      Number(item.properties.price) > 0,
      `${item.key} must carry this deal's rate, not the product default`,
    );
  }

  // Everything outside the bundle keeps a real quantity: drawdown, support, add-ons, one-times.
  for (const item of items.filter(({ key }) => !key.startsWith('metered:'))) {
    assert.ok(
      Number(item.properties.quantity) > 0,
      `${item.key} is outside the bundle and keeps its quantity`,
    );
  }

  // A discounted product prices at the discounted rate. The app writes no description: the
  // customer-facing quote shows the product library's own copy, not text assembled here.
  const discounted = items.find(({ key }) => key === 'metered:connect_ca');
  assert.equal(discounted.properties.description, undefined);
  assert.equal(recurringItems[0].properties.quantity, '1');
  assert.equal(
    recurringItems[0].properties.nylas_pricing_component,
    'subscription_drawdown',
  );
  // The drawdown line is priced at the platform ARR divided across the payments in a year, and
  // that per-payment figure is rounded to cents, because it is money someone is invoiced.
  //
  // So it cannot always multiply back to the exact ARR: 80128.38 / 4 is 20032.095, which is not a
  // chargeable amount. At 20032.10 a quarter the year comes to 80128.40. The invoice is right and
  // the calculator's figure is the theoretical one; the gap is at most half a cent per payment.
  // Net of the discount: on a discounted deal `price` is the LIST per-payment figure and the
  // concession is a PERCENTAGE off it, so what the customer pays is what netPrice works out.
  // Read through netPrice rather than restated here, so the representation lives in one file.
  const drawdownPrice = netPrice(recurringItems[0].properties);
  const perPayment = selected.result.proposedPlatformArr / selected.result.paymentsPerYear;
  assert.equal(drawdownPrice, Math.round((perPayment + Number.EPSILON) * 100) / 100);
  assert.ok(
    Math.abs(drawdownPrice * selected.result.paymentsPerYear - selected.result.proposedPlatformArr) <=
      selected.result.paymentsPerYear * 0.005,
    'annual total may differ from ARR only by the per-payment rounding',
  );
  assert.equal(recurringItems[1].properties.hs_product_id, '45820463620');
  assert.equal(recurringItems[1].properties.name, undefined);
});

test('every bundle product appears even with no commitment or discount', () => {
  const input = {
    termMonths: 12,
    paymentFrequency: 'annual_in_advance',
    // Only one product committed; the other six must still appear.
    volumes: { connect_ca: 1_000 },
    supportLevel: 'basic',
    onboardingPackage: 'none',
    professionalServices: [],
    addOns: [],
  };
  const items = buildDealLineItems({ id: 'o', input, result: calculateQuote(input) });
  const metered = items.filter(({ key }) => key.startsWith('metered:'));
  assert.deepEqual(
    metered.map(({ key }) => key.replace('metered:', '')),
    [
      'connect_ca',
      'calendar_ca',
      'notetaker_bot_hours',
      'agent_accounts',
      'agent_storage_gb',
      'agent_bandwidth_gb',
      'agent_email_thousands',
    ],
  );
  // An uncommitted product still states the rate it would draw down at -- and it states OUR rate.
  //
  // This assertion used to require the OPPOSITE: that price was left undefined so HubSpot would
  // hydrate "the product default". That is what put the wrong rate on live quotes. The product
  // library holds one flat price per product; our rates are blended across the volume bands and
  // adjusted for term and payment schedule, so they differ on every line. Shane Tjin found
  // Calendar-Only quoted at $1.20 against an agreed $0.96.
  //
  // So the test that was enforcing the bug now asserts the fix. This fixture is 12-month Annual In
  // Advance, where the term discount and payment premium are both zero, so storage is its $0.20
  // base rate unchanged -- which is exactly why it needs stating: even when our rate happens to
  // equal the product's, it must be OURS that is sent.
  const uncommitted = metered.find(({ key }) => key === 'metered:agent_storage_gb');
  assert.equal(Number(uncommitted.properties.quantity), 0);
  assert.equal(
    uncommitted.properties.price,
    '0.2',
    'an undiscounted line still carries this deal rate, not the product default',
  );
  assert.equal(
    uncommitted.properties.hs_discount_percentage,
    undefined,
    'and no discount, because none was given',
  );
  assert.equal(
    uncommitted.properties.discount,
    undefined,
    'and never a dollar concession -- discounts are percentages',
  );

  // Agent Email is the one exception: it is graduated, and the product carries its four tiers.
  // One blended figure would collapse them, so its price is still left alone.
  const graduated = metered.find(({ key }) => key === 'metered:agent_email_thousands');
  assert.equal(
    graduated.properties.price,
    undefined,
    'a graduated product keeps its tiers rather than being flattened to one rate',
  );
  assert.equal(uncommitted.properties.description, undefined);
  // The committed volume rides on committed_quantity, not in prose, and not in quantity -- these
  // lines must keep quantity 0 so they add nothing to the Deal total.
  assert.equal(uncommitted.properties.committed_quantity, '0');
  const committed = metered.find(({ key }) => key === 'metered:connect_ca');
  assert.equal(committed.properties.committed_quantity, '1000');
  assert.equal(committed.properties.quantity, '0');
  // Nothing outside the rate schedule carries it.
  for (const item of items.filter(({ key }) => !key.startsWith('metered:'))) {
    assert.equal(
      item.properties.committed_quantity,
      undefined,
      `${item.key} is not a metered product line`,
    );
  }
});

test('every quote carries a support line, Basic at $0 included', () => {
  const input = {
    termMonths: 12,
    paymentFrequency: 'annual_in_advance',
    volumes: { connect_ca: 1_000 },
    supportLevel: 'basic',
    onboardingPackage: 'none',
    professionalServices: [],
    addOns: [],
  };
  const items = buildDealLineItems({ id: 'o', input, result: calculateQuote(input) });
  const support = items.find(({ key }) => key === 'support:basic');
  assert.ok(support, 'Basic support must still produce a line item');
  assert.equal(support.properties.hs_product_id, '40270989858');
  assert.equal(support.properties.name, undefined);
  assert.equal(Number(support.properties.price), 0);
  // "None" onboarding is a real selection meaning none was sold, so it produces no line.
  assert.equal(
    items.some(({ key }) => key.startsWith('onboarding:')),
    false,
  );
});

test('onboarding packages map to their own products, not the next one up', () => {
  const forPackage = (onboardingPackage) => {
    const input = {
      termMonths: 12,
      paymentFrequency: 'annual_in_advance',
      volumes: { connect_ca: 1_000 },
      supportLevel: 'basic',
      onboardingPackage,
      professionalServices: [],
      addOns: [],
    };
    const items = buildDealLineItems({ id: 'o', input, result: calculateQuote(input) });
    return items.find(({ key }) => key.startsWith('onboarding:'))?.properties;
  };
  // Each key previously resolved to the NEXT package's product, and quick_launch had no entry.
  // hs_product_id is the whole guard now: no `name` is sent, so a mis-mapped key would put the
  // wrong package on the customer's quote with nothing in the payload to reveal it.
  assert.equal(forPackage('quick_launch').hs_product_id, '42724377715');
  assert.equal(forPackage('quick_launch').name, undefined);
  assert.equal(forPackage('quick_launch_plus').hs_product_id, '42724501576');
  assert.equal(forPackage('quick_launch_plus').name, undefined);
  assert.equal(forPackage('strategic').hs_product_id, '42724439648');
  assert.equal(forPackage('strategic').name, undefined);
});

test('Quote can collapse only the subscription products, not other charges', () => {
  const selected = option();
  const content = normalizeQuoteContent({
    title: 'Acme – Nylas Enterprise',
    expirationDate: '2026-09-30',
    presentation: 'subscription_summary',
    includeUncommittedRateSchedule: true,
    includeRenewalTerms: true,
    includeSpecialTerms: true,
  });
  const items = buildQuoteLineItems(selected, content);

  assert.equal(items.filter(({ key }) => key === 'subscription:drawdown').length, 1);
  assert.equal(items.filter(({ key }) => key.startsWith('metered:')).length, 0);
  assert.equal(items.filter(({ key }) => key.startsWith('addon:')).length, 1);
  assert.equal(items.filter(({ key }) => key.startsWith('support:')).length, 1);
  assert.equal(items.filter(({ key }) => key.startsWith('professional_service:')).length, 2);
});

test('itemized Quote line items reconcile to recurring and one-time totals', () => {
  const selected = option();
  const items = buildQuoteLineItems(selected, normalizeQuoteContent({
    title: 'Acme – Itemized',
    expirationDate: '2026-09-30',
    presentation: 'itemized_products',
  }));
  // An absent price means "use the product default" and always sits on a quantity-0 rate
  // schedule line, so it contributes nothing either way.
  // Net of the discount PERCENTAGE: `price` is the LIST price on any discounted line, so this is
  // what HubSpot will actually bill, which is the number that has to reconcile to the calculation.
  const lineAmount = (properties) =>
    properties.price == null ? 0 : netPrice(properties) * Number(properties.quantity);
  const recurring = items
    .filter(({ properties }) => properties.recurringbillingfrequency)
    .reduce((sum, { properties }) => sum + lineAmount(properties), 0);
  const oneTime = items
    .filter(({ properties }) => !properties.recurringbillingfrequency)
    .reduce((sum, { properties }) => sum + lineAmount(properties), 0);
  assert.equal(Math.round(recurring * 100) / 100, selected.result.recurringPerPeriod);
  assert.equal(Math.round(oneTime * 100) / 100, selected.result.oneTime);
});

test('Quote content rejects unknown fields', () => {
  assert.throws(
    () => normalizeQuoteContent({ title: 'Test', unexpected: true }),
    /INVALID_QUOTE_CONTENT/,
  );
});

// The Quote title field in the card relies on all three of these. An untouched field must omit
// the key rather than send '', because a present-but-empty title is a validation error rather
// than a request for the default.
test('Quote title falls back only when the key is absent, never when it is blank', () => {
  assert.equal(normalizeQuoteContent({}, 'Acme – Live calculator').title, 'Acme – Live calculator');
  assert.equal(normalizeQuoteContent({ title: '  Renewal FY27  ' }).title, 'Renewal FY27');
  assert.throws(() => normalizeQuoteContent({ title: '' }), /INVALID_QUOTE_CONTENT/);
  assert.throws(() => normalizeQuoteContent({ title: '   ' }), /INVALID_QUOTE_CONTENT/);
  assert.throws(() => normalizeQuoteContent({ title: 'x'.repeat(161) }), /INVALID_QUOTE_CONTENT/);
  assert.equal(normalizeQuoteContent({ title: 'x'.repeat(160) }).title.length, 160);
});

// The Quote and the Deal must show the customer the same thing. They diverged once -- only in the
// drawdown fee's description wording -- and that difference was read, during a real debugging
// session, as evidence that two different systems were writing line items. Both sets were ours.
//
// The nylas_* properties are excluded: they are stripped by hubSpotLineItemProperties before any
// create, so they never reach HubSpot. Everything HubSpot actually receives must match.
const sentToHubSpot = ({ properties }) =>
  Object.fromEntries(
    Object.entries(properties).filter(([key]) => !key.startsWith('nylas_')),
  );

test('Quote and Deal line items carry identical properties', () => {
  const selected = option();
  const dealItems = buildDealLineItems(selected);
  const quoteItems = buildQuoteLineItems(
    selected,
    // What the card actually sends: itemized, with the uncommitted products in the rate schedule.
    normalizeQuoteContent({
      presentation: 'itemized_products',
      includeUncommittedRateSchedule: true,
    }),
  );

  assert.equal(quoteItems.length, dealItems.length);
  for (const [index, dealItem] of dealItems.entries()) {
    assert.deepEqual(
      sentToHubSpot(quoteItems[index]),
      sentToHubSpot(dealItem),
      `line ${index} (${dealItem.properties.hs_product_id}) must match on the Quote and the Deal`,
    );
  }
});

// The app writes no line item descriptions at all, on either surface.
//
// The drawdown fee was the last holdout: it carried the whole per-product rate schedule, and
// HubSpot collapses newlines when rendering a line item description, so it arrived on the
// customer-facing quote as one unbroken paragraph. Omitting the property lets HubSpot fall back to
// the product library's own copy; sending '' would blank that instead.
test('no line item carries an app-authored description', () => {
  const selected = option();
  const content = normalizeQuoteContent({ includeUncommittedRateSchedule: true });
  for (const [surface, items] of [
    ['deal', buildDealLineItems(selected)],
    ['quote', buildQuoteLineItems(selected, content)],
  ]) {
    for (const item of items) {
      assert.equal(
        item.properties.description,
        undefined,
        `${surface} line ${item.properties.hs_product_id} must leave description to the product library`,
      );
    }
  }
});

// The same principle, widened, and the guard that stops this recurring.
//
// "Enterprise Drawdown Fee" was sent as the line item `name` long after the product had been
// renamed to "Enterprise Drawdown Commitment", so every Lock in silently reverted the rename on
// the customer's quote. It survived a full round of removal and reappeared when that work was
// reverted, which is why it now has a test rather than only a comment.
//
// The rule: the product library owns what a product IS -- its name, its category, its description,
// its SKU. This app owns what was SOLD -- quantities, rates, discounts, fees. hs_product_id is all
// HubSpot needs to fill in the first set, and anything this app sends there overwrites the
// library's own value.
test('no line item overwrites a product-owned field', () => {
  const selected = option();
  const content = normalizeQuoteContent({ includeUncommittedRateSchedule: true });
  // product_category is deliberately NOT in this list. It IS still built, but it is blocked one
  // layer later by HUBSPOT_LINE_ITEM_PROPERTIES in QuoteOptionsFunction.js -- because it is not a
  // HubSpot-defined Line Item property, and a portal that never created it rejects the whole
  // create. That the allow-list excludes it is asserted separately below, so both layers are
  // covered without pretending the builder omits it.
  const productOwned = ['name', 'description', 'hs_sku', 'hs_url'];
  for (const [surface, items] of [
    ['deal', buildDealLineItems(selected)],
    ['quote', buildQuoteLineItems(selected, content)],
  ]) {
    for (const item of items) {
      assert.ok(
        item.properties.hs_product_id,
        `${surface} line must carry hs_product_id so HubSpot can resolve the product`,
      );
      for (const property of productOwned) {
        assert.equal(
          item.properties[property],
          undefined,
          `${surface} line ${item.properties.hs_product_id} leaks ${property}`,
        );
      }
    }
  }
});

// The second layer. `name` is dropped by the builder above; this asserts the allow-list would
// refuse it even if some future change started building it again, and that product_category --
// which IS built -- never reaches HubSpot.
test('the HubSpot allow-list refuses product-owned fields', () => {
  const source = require('node:fs').readFileSync(
    require('node:path').join(__dirname, 'QuoteOptionsFunction.js'),
    'utf8',
  );
  const block = source.match(
    /const HUBSPOT_LINE_ITEM_PROPERTIES = new Set\(\[([\s\S]*?)^\]\);/m,
  );
  assert.ok(block, 'HUBSPOT_LINE_ITEM_PROPERTIES must be findable');
  const allowed = new Set(
    block[1]
      .split('\n')
      .filter((line) => !line.trim().startsWith('//'))
      .flatMap((line) => [...line.matchAll(/'([^']+)'/g)].map(([, name]) => name)),
  );
  for (const property of ['name', 'product_category', 'hs_sku', 'hs_url']) {
    assert.equal(allowed.has(property), false, `${property} must not be in the allow-list`);
  }
  // And the link itself must survive, or nothing resolves to a product at all.
  assert.equal(allowed.has('hs_product_id'), true);
});

// The fee columns, carried on every line that holds money.
//
// The guarantee worth protecting is that they reconcile: summed across the line items they must
// equal the calculation's own oneTime, recurringPerPeriod and tcv. If they ever drift, the quote
// and the Contract Summary are telling the customer two different things.
test('fee columns sum to the calculation', () => {
  const selected = option();
  const items = buildDealLineItems(selected);
  let oneTime = 0;
  let recurring = 0;
  let term = 0;
  for (const item of items) {
    if (item.key.startsWith('metered:')) {
      // A rate-schedule line carries no money, so it carries none of these.
      assert.equal(item.properties.one_time_fees, undefined, `${item.key} one_time_fees`);
      assert.equal(item.properties.recurring_fees, undefined, `${item.key} recurring_fees`);
      assert.equal(item.properties.total_fees_for_term, undefined, `${item.key} term total`);
      continue;
    }
    oneTime += Number(item.properties.one_time_fees);
    recurring += Number(item.properties.recurring_fees);
    term += Number(item.properties.total_fees_for_term);
    // A line is one or the other, never both.
    assert.ok(
      Number(item.properties.one_time_fees) === 0 ||
        Number(item.properties.recurring_fees) === 0,
      `${item.key} cannot be both one-time and recurring`,
    );
  }
  // One-time and per-period are exact: those prices are what the line is billed.
  assert.equal(Math.round(oneTime * 100) / 100, selected.result.oneTime);
  assert.equal(Math.round(recurring * 100) / 100, selected.result.recurringPerPeriod);

  // The term total is not, and cannot be. Each recurring line's price is rounded to cents, and
  // the term multiplies that by every payment in the contract, so the half-cent rounding on each
  // line is amplified by payments x years. The line items are right -- they say what will actually
  // be invoiced -- and tcv is the unrounded arithmetic. The gap is bounded, not arbitrary.
  const recurringLines = items.filter(
    ({ key, properties }) =>
      !key.startsWith('metered:') && properties.recurringbillingfrequency,
  ).length;
  const payments = selected.result.paymentsPerYear * (selected.input.termMonths / 12);
  const tolerance = recurringLines * payments * 0.005;
  assert.ok(
    Math.abs(term - selected.result.tcv) <= tolerance,
    `term total ${term} differs from tcv ${selected.result.tcv} by more than the ` +
      `${tolerance} that per-payment cent rounding can explain`,
  );
});

// The Contract Summary in the card is modelled on section VI of the pricing workbook, and its row
// labels are that table's, verbatim. "Subscription Drawdown" had drifted -- it matched neither the
// workbook (which says "Enterprise Drawdown Commitment", row 51) nor the HubSpot product of the
// same name, while the other four labels were already exact.
//
// The labels live in the card, which has no test runner of its own, so this reads the source. Not
// elegant, but the alternative is that the one label a customer reads on the summary is the only
// string in this repo nothing checks.
test('the Contract Summary row labels match the workbook section VI table', () => {
  const source = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '..', 'cards', 'NylasPricingBuilder.tsx'),
    'utf8',
  );
  const block = source.slice(
    source.indexOf('const summaryTable ='),
    source.indexOf('const summaryTable =') + 1_400,
  );
  const labels = [...block.matchAll(/label: "([^"]+)"/g)].map(([, label]) => label);
  assert.deepEqual(labels, [
    'Onboarding',
    'Professional Services',
    'Enterprise Drawdown Commitment',
    'Subscription Add-ons',
    'Subscription Support',
  ]);
});

// Reported by Shane Tjin from a live quote, 2026-08-27: "the Calendar-only price is completely
// wrong", and Notetaker showing the list rate rather than the proposed one.
//
// Every UNDISCOUNTED metered line used to omit `price` so HubSpot would hydrate "the product
// default". The product library holds ONE FLAT PRICE per product; our rates are blended across the
// volume bands and adjusted for the contract term and payment schedule, so they differ from that
// flat price on essentially every line. The quote therefore showed the library's numbers, not the
// deal's -- and the error ran in both directions, so nothing about the totals looked odd.
//
// His configuration: 24-month term, Quarterly In Advance (x1.035), Calendar-Only 5,000,
// Notetaker 1,000 at 10%, Agent Email 400.
test("every metered line carries this deal's rate, not the product library's flat price", () => {
  const input = {
    termMonths: 24,
    paymentFrequency: 'quarterly_in_advance',
    volumes: {
      connect_ca: 0,
      calendar_ca: 5_000,
      notetaker_bot_hours: 1_000,
      agent_accounts: 0,
      agent_email_thousands: 400,
      agent_storage_gb: 0,
      agent_bandwidth_gb: 0,
    },
    productDiscounts: { notetaker_bot_hours: 0.1 },
    supportLevel: 'premium',
    onboardingPackage: 'strategic',
    professionalServices: [],
    addOns: [],
  };
  const result = calculateQuote(input);
  const items = buildDealLineItems({ id: 'o', input, result });
  const priceOf = (key) => items.find((item) => item.key === `metered:${key}`).properties;

  // The figure that started this. The library's flat Calendar-Only price is $1.20; the agreed rate
  // at 5,000 accounts on this term is $0.96. Quoting $1.20 overstates it by 25%.
  // Sent rounded to the cent, because it is a price on an invoice line.
  assert.equal(
    priceOf('calendar_ca').price,
    '0.96',
    'Calendar-Only quotes at $0.96, not the library $1.20',
  );

  // It ran the other way too: Email + Calendar's library price is $1.60 against an agreed $1.76,
  // so the same defect also UNDER-quoted. Uncommitted, and still stating its rate.
  assert.equal(
    Math.round(Number(priceOf('connect_ca').price) * 100) / 100,
    1.76,
    'Email + Calendar quotes at $1.76, not the library $1.60',
  );

  // Discounted lines keep Holly's model: `price` is the LIST rate and the concession is stated
  // separately -- as a PERCENTAGE -- so HubSpot's net is the proposed rate. Shane expected $0.56.
  const notetaker = priceOf('notetaker_bot_hours');
  assert.ok(
    Number(notetaker.hs_discount_percentage) > 0,
    'the concession is stated separately, as a percentage',
  );
  assert.equal(notetaker.discount, undefined, 'and never as a dollar amount');
  assert.equal(
    Math.round(netPrice(notetaker) * 100) / 100,
    0.56,
    'Notetaker nets to the proposed $0.56',
  );
  assert.equal(
    Math.round(Number(notetaker.price) * 100) / 100,
    0.62,
    'and its list rate stays visible at $0.62',
  );

  // The exception, and the reason this is not a blanket "always send a price": Agent Email is
  // graduated and the product carries its four tiers, which the quote renders as "View tiered
  // rates". One blended figure would collapse them, which is a worse misstatement than the bug
  // being fixed here.
  assert.equal(
    priceOf('agent_email_thousands').price,
    undefined,
    'a graduated product keeps its tiers',
  );

  // Every rate sent is this deal's rate, to the cent.
  for (const key of ['connect_ca', 'calendar_ca', 'agent_accounts', 'agent_bandwidth_gb']) {
    const line = result.lines.find(({ productKey }) => productKey === key);
    assert.equal(
      Math.round(Number(priceOf(key).price) * 100) / 100,
      Math.round(line.billingUnitRate * 100) / 100,
      `${key} price must equal the calculated rate`,
    );
  }
});

// "Proposed Rate" -- the agreed (net) monthly rate, stored rather than derived.
//
// Shane's review: the Order Form printed $0.62 on Notetaker where the agreed rate was $0.56. The
// number was never missing -- `price` is the LIST rate and `discount` the concession, deliberately,
// so that the concession stays visible -- but the standard quote template cannot subtract one
// column from another, so the net has to exist as a field of its own.
//
// This carried the name `monthly_unit_price` from the initial commit and no test at all, which is
// how it reached a customer-facing quote as a field that was never a property in the portal.
test('every metered line carries proposed_rate, and it agrees with the discounted price', () => {
  const selected = option();
  const metered = buildDealLineItems(selected).filter((item) =>
    String(item.key).startsWith('metered:'),
  );
  assert.equal(metered.length, 7, 'all seven metered products must appear');

  for (const item of metered) {
    const rate = item.properties.proposed_rate;
    assert.ok(rate != null, `${item.key} must carry proposed_rate`);
    assert.ok(Number.isFinite(Number(rate)), `${item.key} proposed_rate must be a number`);

    // Agent Email is graduated: no price is sent, because one blended figure would collapse four
    // tiers into one. proposed_rate is still written, but there is nothing to reconcile it against.
    if (item.properties.price == null) continue;

    const net = netPrice(item.properties);
    assert.equal(
      Math.round(net * 100) / 100,
      Math.round(Number(rate) * 100) / 100,
      `${item.key}: proposed_rate must equal the discounted price to the cent`,
    );
  }

  // The fixture discounts by 10%, so at least one line must actually exercise the gap -- otherwise
  // this passes vacuously against list == net, which is the failure mode that let the original
  // metered-price bug through.
  assert.ok(
    metered.some((item) => Number(item.properties.hs_discount_percentage || 0) > 0),
    'the fixture must include a discounted metered line or this proves nothing',
  );
});

// Both layers, because the property is custom and the sync archives before it creates: it has to
// be allowed through, and it has to be droppable if a portal never created it.
test('proposed_rate is allowed through and is droppable', () => {
  const source = require('node:fs').readFileSync(
    require('node:path').join(__dirname, 'QuoteOptionsFunction.js'),
    'utf8',
  );
  const names = (block) =>
    new Set(
      block
        .split('\n')
        .filter((line) => !line.trim().startsWith('//'))
        .flatMap((line) => [...line.matchAll(/'([^']+)'/g)].map(([, name]) => name)),
    );

  const allowed = source.match(/const HUBSPOT_LINE_ITEM_PROPERTIES = new Set\(\[([\s\S]*?)^\]\);/m);
  assert.ok(allowed, 'HUBSPOT_LINE_ITEM_PROPERTIES must be findable');
  assert.equal(names(allowed[1]).has('proposed_rate'), true, 'proposed_rate must be allowed');
  assert.equal(
    names(allowed[1]).has('monthly_unit_price'),
    false,
    'monthly_unit_price was never a property in this portal and must not be sent',
  );

  const optional = source.match(
    /const OPTIONAL_CUSTOM_LINE_ITEM_PROPERTIES = \[([\s\S]*?)^\];/m,
  );
  assert.ok(optional, 'OPTIONAL_CUSTOM_LINE_ITEM_PROPERTIES must be findable');
  assert.equal(
    names(optional[1]).has('proposed_rate'),
    true,
    'a portal without proposed_rate must degrade, not empty the Deal',
  );
});

// Agent Email's adjusted tier table.
//
// The defect: HubSpot renders a graduated line's tier table from the PRODUCT when the line item
// carries no tiers of its own, and the product holds the raw rate card -- no term discount, no
// payment premium, no discretionary discount. On a 12-month monthly-in-advance deal that prints
// $1.00/$0.70/$0.35/$0.25 on a contract the customer is actually billed $1.08/$0.76/$0.38/$0.27
// under. 8% understated, in a signed document.
const emailOption = (discretionaryDiscount = 0) => {
  const input = {
    ...option().input,
    termMonths: 12,
    paymentFrequency: 'monthly_in_advance',
    volumes: { ...option().input.volumes, agent_email_thousands: 75 },
    discretionaryDiscount,
  };
  return { id: 'option-1', name: 'Preferred', input, result: calculateQuote(input) };
};

const emailLine = (selected) => {
  const item = buildDealLineItems(selected).find((line) =>
    String(line.key).includes('agent_email'),
  );
  assert.ok(item, 'the Agent Email line must exist');
  return item.properties;
};

test('the Agent Email line carries its own adjusted tiers, in thousands', () => {
  const properties = emailLine(emailOption());

  assert.equal(properties.hs_pricing_model, 'graduated');

  // Bands are [0,50) [50,100) [100,500) [500,null) in THOUSANDS, exclusive upper. The printed
  // ranges are in SINGLE EMAILS -- Shane Tjin, 2026-08-28: the bounds must read "0 - 49,999
  // emails", not "0 - 49". HubSpot's `end` is INCLUSIVE, so it is upper * 1000 - 1, and the last
  // tier omits `end`. The PRICES stay per 1,000 emails; see the units note in lineItemModel.js.
  assert.deepEqual(JSON.parse(properties.hs_tier_ranges), [
    { start: 0, end: 49_999 },
    { start: 50_000, end: 99_999 },
    { start: 100_000, end: 499_999 },
    { start: 500_000 },
  ]);

  // 12 months (no term discount) monthly in advance (+8%): the workbook's additive adjustment.
  assert.deepEqual(JSON.parse(properties.hs_tier_prices), [
    { index: 0, price: 1.08 },
    { index: 1, price: 0.76 },
    { index: 2, price: 0.38 },
    { index: 3, price: 0.27 },
  ]);

  // These are the PRODUCT's rates, which is exactly what must no longer reach the quote.
  const printed = JSON.parse(properties.hs_tier_prices).map(({ price }) => price);
  assert.notDeepEqual(printed, [1, 0.7, 0.35, 0.25], 'unadjusted rates reached the quote');

  // HubSpot derives a tiered line's price from the tiers; sending `price` too is documented as
  // wrong, and a single blended figure would collapse four tiers into one.
  assert.equal(properties.price, undefined, 'a tiered line must not carry a flat price');

  // `units` is an ENUMERATION in this portal (/GB's, /Emails, /Agent Accounts, /CA's, /Bot Hours).
  // Sending "1,000 emails" returned INVALID_OPTION and, because the sync archives before it
  // creates, emptied the Deal. Asserted as absent so it cannot come back by accident.
  assert.equal(properties.units, undefined, 'units is an enumeration this value is not in');
});

test('the discretionary discount is baked into each Agent Email tier', () => {
  const list = JSON.parse(emailLine(emailOption(0)).hs_tier_prices).map((t) => t.price);
  const net = JSON.parse(emailLine(emailOption(0.1)).hs_tier_prices).map((t) => t.price);

  assert.deepEqual(net, [0.97, 0.68, 0.34, 0.24]);
  for (const [index, price] of net.entries()) {
    assert.ok(price < list[index], `tier ${index} must be discounted, got ${price}`);
  }
});

test('flat metered lines carry no tier properties', () => {
  const flat = buildDealLineItems(emailOption()).filter(
    (item) => String(item.key).startsWith('metered:') && !String(item.key).includes('agent_email'),
  );
  assert.equal(flat.length, 6);
  for (const item of flat) {
    for (const property of ['hs_pricing_model', 'hs_tier_ranges', 'hs_tier_prices']) {
      assert.equal(item.properties[property], undefined, `${item.key} leaked ${property}`);
    }
    assert.ok(item.properties.price != null, `${item.key} must still carry a flat price`);
  }
});

test('the tier properties are allowed through and are droppable', () => {
  const source = require('node:fs').readFileSync(
    require('node:path').join(__dirname, 'QuoteOptionsFunction.js'),
    'utf8',
  );
  const names = (block) =>
    new Set(
      block
        .split('\n')
        .filter((line) => !line.trim().startsWith('//'))
        .flatMap((line) => [...line.matchAll(/'([^']+)'/g)].map(([, name]) => name)),
    );
  const allowed = names(
    source.match(/const HUBSPOT_LINE_ITEM_PROPERTIES = new Set\(\[([\s\S]*?)^\]\);/m)[1],
  );
  const optional = names(
    source.match(/const OPTIONAL_CUSTOM_LINE_ITEM_PROPERTIES = \[([\s\S]*?)^\];/m)[1],
  );
  // Revenue Hub gated: a portal without it must fall back to the product's tiers, not lose the Deal.
  // 'units' is deliberately absent -- see the units test below.
  for (const property of ['hs_pricing_model', 'hs_tier_ranges', 'hs_tier_prices']) {
    assert.equal(allowed.has(property), true, `${property} must be allowed`);
    assert.equal(optional.has(property), true, `${property} must be droppable`);
  }
});

// proposed_rate on the charge lines too, not only the metered ones.
//
// Redundant in a strict sense -- a charge line has quantity 1, so HubSpot derives the net from
// price minus discount and prints it itself. Sent anyway so one template column can bind to one
// property and be right on every row, instead of reading blank on drawdown, support, add-ons,
// onboarding and professional services. Holly asked for this on 2026-08-28.
test('every line that carries a price also carries proposed_rate', () => {
  const selected = option();
  const items = buildDealLineItems(selected);
  const priced = items.filter((item) => item.properties.price != null);
  assert.ok(priced.length >= 10, `expected the charge lines too, got ${priced.length}`);

  for (const item of priced) {
    const rate = item.properties.proposed_rate;
    assert.ok(rate != null, `${item.key} carries a price but no proposed_rate`);
    // The three fields have to agree to the cent, or the quote contradicts itself: the rate column
    // would state one number while the money columns are computed from another.
    const net = netPrice(item.properties);
    assert.equal(
      Math.round(net * 100) / 100,
      Math.round(Number(rate) * 100) / 100,
      `${item.key}: proposed_rate must equal the discounted price`,
    );
  }

  // Named explicitly rather than inferred from the loop, so this fails if a builder stops
  // producing one of them rather than silently checking fewer lines.
  for (const key of [
    'subscription:nylas_enterprise',
    'support:full',
    'addon:enterprise_accelerator',
    'onboarding:quick_launch_plus',
  ]) {
    const item = items.find((line) => line.key === key);
    assert.ok(item, `${key} must be built`);
    assert.ok(item.properties.proposed_rate != null, `${key} must carry proposed_rate`);
  }

  // The fixture discounts, so at least one charge line must show a real list-to-net gap.
  assert.ok(
    priced.some(
      (item) =>
        !String(item.key).startsWith('metered:') &&
        Number(item.properties.hs_discount_percentage || 0) > 0,
    ),
    'a discounted charge line is needed or this proves nothing',
  );
});

// No line item may send `units`, on either surface.
//
// It is a real property in this portal but an ENUMERATION -- /GB's, /Emails, /Agent Accounts,
// /CA's, /Bot Hours. A value outside that list is rejected with INVALID_OPTION, and because
// syncDealLineItems archives before it creates, that emptied the Deal on 2026-08-28. The tier
// bounds are in thousands, so /Emails is not a substitute: it would state a range 1000x too small
// on a customer's contract.
test('no line item sends units, and the allow-list would refuse it', () => {
  const selected = option();
  const content = normalizeQuoteContent({ includeUncommittedRateSchedule: true });
  for (const [surface, items] of [
    ['deal', buildDealLineItems(selected)],
    ['quote', buildQuoteLineItems(selected, content)],
  ]) {
    for (const item of items) {
      assert.equal(item.properties.units, undefined, `${surface} line ${item.key} sends units`);
    }
  }

  const source = require('node:fs').readFileSync(
    require('node:path').join(__dirname, 'QuoteOptionsFunction.js'),
    'utf8',
  );
  const block = source.match(/const HUBSPOT_LINE_ITEM_PROPERTIES = new Set\(\[([\s\S]*?)^\]\);/m);
  const allowed = new Set(
    block[1]
      .split('\n')
      .filter((line) => !line.trim().startsWith('//'))
      .flatMap((line) => [...line.matchAll(/'([^']+)'/g)].map(([, name]) => name)),
  );
  assert.equal(allowed.has('units'), false, 'units must not be in the allow-list');
});

// The Agent Email line must stay at quantity 0.
//
// Its tier RANGES are in single emails while its tier PRICES are per 1,000 emails -- deliberate,
// so the printed bounds read "0 - 49,999" rather than "0 - 49". HubSpot computes a tiered line's
// amount as quantity x tier price, so the two units only stay harmless while the quantity is zero.
// The metered lines are a rate schedule; the committed money is carried by the drawdown fee.
//
// If this test ever fails, do NOT just change the number: the units in graduatedTierProperties
// have to change with it, or the line bills 1000x.
test('the Agent Email line stays at quantity 0, because its tier units differ', () => {
  const selected = emailOption(0.2);
  const content = normalizeQuoteContent({ includeUncommittedRateSchedule: true });
  for (const [surface, items] of [
    ['deal', buildDealLineItems(selected)],
    ['quote', buildQuoteLineItems(selected, content)],
  ]) {
    const item = items.find((line) => String(line.key).includes('agent_email'));
    assert.ok(item, `${surface}: the Agent Email line must exist`);
    assert.equal(item.properties.quantity, '0', `${surface}: quantity must be 0`);

    const ranges = JSON.parse(item.properties.hs_tier_ranges);
    const prices = JSON.parse(item.properties.hs_tier_prices);
    // Ranges in emails: the first boundary is five figures, not two.
    assert.equal(ranges[0].end, 49_999, `${surface}: bounds must be in emails`);
    // Prices per thousand: a per-email price would round to $0.00 at HubSpot's precision.
    assert.ok(
      prices.every(({ price }) => price >= 0.01),
      `${surface}: a per-email price would render as $0.00`,
    );
  }
});

// AN UPLIFT MUST NEVER REACH HUBSPOT AS A NEGATIVE hs_discount_percentage.
//
// HubSpot models a discounted line as list `price` plus a discount. It has no representation for a
// line priced ABOVE list, so an uplifted line is sent at its uplifted price with no discount field
// at all -- which is what priceProperties already does, because its guard is `list - net < 0.01`
// rather than an inequality. That is load-bearing now rather than incidental, so it is asserted.
test('an uplifted line is sent at its price with no discount field', () => {
  const input = { ...option().input, productDiscounts: { connect_ca: -0.15 } };
  const selected = { id: 'option-1', name: 'Uplift', input, result: calculateQuote(input) };
  const content = normalizeQuoteContent({});
  const everyLine = [
    ...buildDealLineItems(selected),
    ...buildQuoteLineItems(selected, content),
  ];

  let uplifted = 0;
  for (const item of everyLine) {
    const percentage = item.properties.hs_discount_percentage;
    if (percentage != null) {
      assert.ok(
        Number(percentage) > 0,
        `${item.key}: hs_discount_percentage ${percentage} must never be negative`,
      );
    }
    if (!String(item.key).includes('connect')) continue;
    uplifted += 1;
    // The uplifted rate is the price, and netPrice reads it back unchanged -- no phantom discount
    // is reconstructed from a field that is not there.
    assert.equal(percentage, undefined, `${item.key} must carry no discount`);
    assert.equal(netPrice(item.properties), Number(item.properties.price));
  }
  assert.ok(uplifted > 0, 'the fixture must actually produce an uplifted Connect line');
});

// ===========================================================================
// A rep-entered list price must reach the HubSpot line item
// ===========================================================================
//
// Holly, 2026-09-03: "An edited list price must be used when creating or updating the
// corresponding HubSpot line item." The line builders read supportAnnual / onboardingAmount /
// professionalServicesAmount off the result, all of which now incorporate an override -- so this
// holds by construction. Asserted anyway, because "by construction" is how the units incident got
// shipped: nothing was checking the thing everyone assumed.

test('an entered onboarding price is what lands on the line item', () => {
  const input = {
    termMonths: 12,
    paymentFrequency: 'annual_in_advance',
    volumes: { connect_ca: 5000 },
    supportLevel: 'basic',
    onboardingPackage: 'quick_launch',
    professionalServices: [],
    addOns: [],
  };
  const catalogue = buildDealLineItems({ id: 'o', input, result: calculateQuote(input) });
  const overridden = buildDealLineItems({
    id: 'o',
    input,
    result: calculateQuote({ ...input, listPriceOverrides: { onboarding: 3500 } }),
  });

  const onboardingLine = (items) =>
    items.find(({ properties }) => properties.nylas_pricing_component === 'onboarding');

  assert.equal(Number(onboardingLine(catalogue).properties.price), 5000, 'the catalogue price');
  const line = onboardingLine(overridden).properties;
  assert.equal(
    Number(line.price),
    3500,
    'the rep entered 3500, so 3500 IS the price -- not 5000 with a discount beside it',
  );
  // NO DISCOUNT PRINTED. An entered price is the price, not a concession off a catalogue figure.
  // Printing "5,000, 30% off" is the leak the flat override exists to close.
  assert.equal(Number(line.hs_discount_percentage || 0), 0);
  assert.equal(Number(line.proposed_rate), 3500);
  assert.equal(Number(line.total_fees_for_term), 3500);
});

test('an entered flat support price is what lands on the support line item', () => {
  const input = {
    termMonths: 12,
    paymentFrequency: 'annual_in_advance',
    volumes: { connect_ca: 5000 },
    supportLevel: 'full',
    onboardingPackage: 'none',
    professionalServices: [],
    addOns: [],
  };
  const calculated = calculateQuote(input);
  const flat = calculateQuote({ ...input, listPriceOverrides: { support: 9000 } });
  // Prove the fixture actually moves, so the assertion below is the override and not a coincidence.
  assert.notEqual(calculated.supportAnnual, 9000);

  const supportLine = (result) =>
    buildDealLineItems({ id: 'o', input, result }).find(
      ({ properties }) => properties.nylas_pricing_component === 'support',
    );
  assert.equal(Number(supportLine(flat).properties.price), 9000);
  // This is the whole point of the flat override: the customer sees one flat number, with no
  // discount printed beside it to reveal that the figure was derived.
  assert.equal(Number(supportLine(flat).properties.hs_discount_percentage || 0), 0);
});

test('an entered add-on price is what lands on the add-on line item', () => {
  const input = {
    termMonths: 12,
    paymentFrequency: 'annual_in_advance',
    volumes: { connect_ca: 5000 },
    supportLevel: 'basic',
    onboardingPackage: 'none',
    professionalServices: [],
    addOns: ['shared_oauth_app'],
  };
  const items = buildDealLineItems({
    id: 'o',
    input,
    result: calculateQuote({
      ...input,
      listPriceOverrides: { addOns: { shared_oauth_app: 1200 } },
    }),
  });
  const line = items.find(
    ({ properties }) => properties.nylas_line_item_key === 'addon:shared_oauth_app',
  );
  // The entered annual figure, and no discount printed beside it.
  assert.equal(Number(line.properties.price), 1200);
  assert.equal(Number(line.properties.hs_discount_percentage || 0), 0);
});

test('an entered professional-services bundle price is what lands on those line items', () => {
  const input = {
    termMonths: 12,
    paymentFrequency: 'annual_in_advance',
    volumes: { connect_ca: 5000 },
    supportLevel: 'basic',
    onboardingPackage: 'none',
    professionalServices: ['gtm_review', 'provider_oauth_app_creation'],
    addOns: [],
  };
  const catalogue = calculateQuote(input);
  // Two services price at 3,800 on the ladder -- prove the fixture moves before asserting.
  assert.equal(catalogue.professionalServicesAmount, 3800);

  const psLines = (result) =>
    buildDealLineItems({ id: 'o', input, result }).filter(
      ({ properties }) => properties.nylas_pricing_component === 'professional_services',
    );

  const overridden = psLines(
    calculateQuote({ ...input, listPriceOverrides: { professionalServices: 3000 } }),
  );
  assert.equal(overridden.length, 2, 'one line per service, the bundle price spread across them');

  // The entered bundle price, and it still SUMS exactly -- allocateBundle gives the remainder to
  // the last line rather than letting rounding lose a cent.
  const sum = overridden.reduce((total, { properties }) => total + Number(properties.price), 0);
  assert.equal(sum, 3000);

  // And no discount printed on any of them: an entered price is the price.
  for (const { properties } of overridden) {
    assert.equal(Number(properties.hs_discount_percentage || 0), 0);
  }

  // Against the catalogue path, which DOES carry the ladder figure.
  const plain = psLines(catalogue);
  assert.equal(
    plain.reduce((total, { properties }) => total + Number(properties.price), 0),
    3800,
  );
});
